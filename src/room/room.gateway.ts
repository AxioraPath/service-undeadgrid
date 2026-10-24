import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { z } from 'zod';

import type { Slot } from '../config/game.config';
import {
  ErrorCode,
  ok,
  fail,
  type Ack,
  type ChatMessageSnapshot,
  type ClientToServerEvents,
  type CombatSnapshot,
  type InterServerEvents,
  type JoinedData,
  type RoomSnapshot,
  type ServerToClientEvents,
  type SocketData,
} from '../contracts';
import {
  chatSendSchema,
  coreDamageSchema,
  createRoomSchema,
  joinRoomSchema,
  readySchema,
  renameSchema,
  selectSurvivorSchema,
  setDifficultySchema,
  setMapSchema,
} from '../contracts/payloads';
import { DomainError } from '../common/domain-error';
import { RateLimiterService } from '../common/rate-limiter.service';
import type { Room } from '../domain/room';
import { PhaseOrchestrator } from './phase-orchestrator.service';
import { RoomService } from './room.service';

type AppServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;
type AppSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

/** Pequeño retardo entre "ambos confirman" y el arranque del combate (ms). */
const COMBAT_START_DELAY_MS = 3000;

@WebSocketGateway({
  cors: {
    origin: (process.env.CORS_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    credentials: true,
  },
  // Optimización de latencia: priorizar WebSocket (evita la fase de long-polling)
  // y permitir upgrade. Esto reduce el ping percibido, importante para jugadores
  // lejanos al datacenter.
  transports: ['websocket', 'polling'],
  // Heartbeat: detectar desconexiones rápido sin saturar la red.
  pingInterval: 10000,
  pingTimeout: 5000,
  // No comprimir mensajes pequeños: ahorra CPU y latencia en payloads chicos.
  perMessageDeflate: false,
  httpCompression: false,
})
export class RoomGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(RoomGateway.name);

  @WebSocketServer()
  server!: AppServer;

  constructor(
    private readonly rooms: RoomService,
    private readonly orchestrator: PhaseOrchestrator,
    private readonly limiter: RateLimiterService,
  ) {}

  // ---- Ciclo de vida del gateway ----

  afterInit(): void {
    // El orquestador emite por red a través de estos callbacks.
    this.orchestrator.onCombatTick = (room) => this.emitCombat(room, 'combat:tick');
    this.orchestrator.onPhaseChange = (room) => {
      this.emitState(room);
      this.emitCombat(room, 'combat:phase');
    };
    this.orchestrator.onMatchOver = (room) => {
      this.emitState(room);
      this.server.to(room.code).emit('match:over', room.toSnapshot(this.rooms.now()));
    };
    this.orchestrator.onRoomsClosed = (codes) => {
      for (const code of codes) {
        this.server.to(code).emit('lobby:closed', { reason: 'Sala cerrada por inactividad' });
      }
    };
    this.orchestrator.start();
    this.logger.log('RoomGateway inicializado');
  }

  handleConnection(client: AppSocket): void {
    this.logger.debug(`Conexión ${client.id}`);
  }

  handleDisconnect(client: AppSocket): void {
    this.limiter.clear(client.id);
    const outcome = this.rooms.handleDisconnect(client.id);
    if (!outcome) return;
    const { room, player, closed, kept } = outcome;

    if (closed) return; // la sala ya no existe

    if (kept) {
      // Asiento reservado para reconexión.
      this.server.to(room.code).emit('lobby:playerLeft', {
        slot: player.slot,
        name: player.name,
        reason: 'disconnected',
      });
      this.emitState(room);
      return;
    }

    // Asiento liberado (o partida terminada por abandono).
    this.server.to(room.code).emit('lobby:playerLeft', {
      slot: player.slot,
      name: player.name,
      reason: 'disconnected',
    });
    if (room.status === 'results') {
      this.server.to(room.code).emit('match:over', room.toSnapshot(this.rooms.now()));
    }
    this.emitState(room);
  }

  // ---- Helpers ----

  private now(): number {
    return this.rooms.now();
  }

  private emitState(room: Room): void {
    this.server.to(room.code).emit('lobby:state', room.toSnapshot(this.now()));
  }

  private emitCombat(room: Room, event: 'combat:tick' | 'combat:phase'): void {
    const snap: CombatSnapshot = room.combatSnapshot(this.now());
    this.server.to(room.code).emit(event, snap);
  }

  /** Valida un payload con Zod y lanza DomainError si falla. */
  private parse<T>(schema: z.ZodType<T>, payload: unknown): T {
    const result = schema.safeParse(payload);
    if (!result.success) {
      throw new DomainError(
        ErrorCode.VALIDATION,
        'Payload inválido',
        result.error.issues.map((i) => ({ path: i.path, message: i.message })),
      );
    }
    return result.data;
  }

  /** Aplica rate limiting; lanza DomainError si se excede. */
  private guardRate(client: AppSocket, event: string): void {
    if (!this.limiter.allow(client.id, event)) {
      throw new DomainError(ErrorCode.RATE_LIMITED, 'Demasiadas solicitudes, espera un momento');
    }
  }

  /** Requiere que el socket pertenezca a una sala; devuelve el código. */
  private requireRoomCode(client: AppSocket): string {
    const code = client.data.roomCode;
    if (!code) {
      throw new DomainError(ErrorCode.NOT_IN_ROOM, 'No estás en ninguna sala');
    }
    return code;
  }

  /**
   * Envuelve un handler: aplica rate limiting, captura DomainError y responde
   * con un ack tipado uniforme. Centraliza el tratamiento de errores para que
   * nunca se filtre un stack trace al cliente.
   */
  private async handle<T>(
    client: AppSocket,
    event: string,
    fn: () => T | Promise<T>,
  ): Promise<Ack<T>> {
    try {
      this.guardRate(client, event);
      const data = await fn();
      return ok(data);
    } catch (err) {
      if (err instanceof DomainError) {
        return fail(err.toApiError());
      }
      this.logger.error(`Error no controlado en ${event}: ${String(err)}`);
      return fail({ code: ErrorCode.INTERNAL, message: 'Error interno del servidor' });
    }
  }

  /** Asocia un socket a un asiento/sala y lo mete en la room de Socket.IO. */
  private bindSocket(client: AppSocket, room: Room, slot: Slot, sessionId: string): void {
    client.data.roomCode = room.code;
    client.data.slot = slot;
    client.data.sessionId = sessionId;
    void client.join(room.code);
  }

  // ---- Handlers cliente → servidor ----

  @SubscribeMessage('lobby:create')
  async onCreate(
    @ConnectedSocket() client: AppSocket,
    @MessageBody() body: unknown,
  ): Promise<Ack<JoinedData>> {
    return this.handle(client, 'lobby:create', () => {
      const payload = this.parse(createRoomSchema, body);
      const { room, player } = this.rooms.create({
        name: payload.name,
        socketId: client.id,
        survivor: payload.survivor,
      });
      this.bindSocket(client, room, player.slot, player.sessionId);
      return {
        sessionId: player.sessionId,
        slot: player.slot,
        isHost: player.isHost,
        room: room.toSnapshot(this.now()),
      };
    });
  }

  @SubscribeMessage('lobby:join')
  async onJoin(
    @ConnectedSocket() client: AppSocket,
    @MessageBody() body: unknown,
  ): Promise<Ack<JoinedData>> {
    return this.handle(client, 'lobby:join', () => {
      const payload = this.parse(joinRoomSchema, body);
      const { room, player, reconnected } = this.rooms.join({
        code: payload.code,
        name: payload.name,
        socketId: client.id,
        survivor: payload.survivor,
        sessionId: payload.sessionId,
      });
      this.bindSocket(client, room, player.slot, player.sessionId);

      if (reconnected) {
        this.server
          .to(room.code)
          .emit('lobby:playerReconnected', { slot: player.slot, name: player.name });
      } else {
        client
          .to(room.code)
          .emit('lobby:playerJoined', { slot: player.slot, name: player.name });
      }
      this.emitState(room);
      return {
        sessionId: player.sessionId,
        slot: player.slot,
        isHost: player.isHost,
        room: room.toSnapshot(this.now()),
      };
    });
  }

  @SubscribeMessage('lobby:leave')
  async onLeave(@ConnectedSocket() client: AppSocket): Promise<Ack> {
    return this.handle(client, 'lobby:leave', () => {
      const code = this.requireRoomCode(client);
      const { room, player, closed } = this.rooms.leave(code, client.id);
      void client.leave(code);
      client.data.roomCode = undefined;
      if (!closed) {
        this.server
          .to(code)
          .emit('lobby:playerLeft', { slot: player.slot, name: player.name, reason: 'left' });
        if (room.status === 'results') {
          this.server.to(code).emit('match:over', room.toSnapshot(this.now()));
        }
        this.emitState(room);
      }
      return undefined;
    });
  }

  @SubscribeMessage('lobby:rename')
  async onRename(
    @ConnectedSocket() client: AppSocket,
    @MessageBody() body: unknown,
  ): Promise<Ack<RoomSnapshot>> {
    return this.handle(client, 'lobby:rename', () => {
      const code = this.requireRoomCode(client);
      const { name } = this.parse(renameSchema, body);
      const room = this.rooms.rename(code, client.id, name);
      this.emitState(room);
      return room.toSnapshot(this.now());
    });
  }

  @SubscribeMessage('lobby:ready')
  async onReady(
    @ConnectedSocket() client: AppSocket,
    @MessageBody() body: unknown,
  ): Promise<Ack<RoomSnapshot>> {
    return this.handle(client, 'lobby:ready', () => {
      const code = this.requireRoomCode(client);
      const { ready } = this.parse(readySchema, body);
      const room = this.rooms.setReady(code, client.id, ready);
      this.emitState(room);
      return room.toSnapshot(this.now());
    });
  }

  @SubscribeMessage('lobby:selectSurvivor')
  async onSelectSurvivor(
    @ConnectedSocket() client: AppSocket,
    @MessageBody() body: unknown,
  ): Promise<Ack<RoomSnapshot>> {
    return this.handle(client, 'lobby:selectSurvivor', () => {
      const code = this.requireRoomCode(client);
      const { survivor } = this.parse(selectSurvivorSchema, body);
      const room = this.rooms.selectSurvivor(code, client.id, survivor);
      this.emitState(room);
      return room.toSnapshot(this.now());
    });
  }

  @SubscribeMessage('lobby:confirmSurvivor')
  async onConfirmSurvivor(
    @ConnectedSocket() client: AppSocket,
  ): Promise<Ack<RoomSnapshot>> {
    return this.handle(client, 'lobby:confirmSurvivor', () => {
      const code = this.requireRoomCode(client);
      const room = this.rooms.confirmSurvivor(code, client.id);
      this.emitState(room);
      // Si la confirmación llevó a "preparation", programa el arranque del combate.
      if (room.status === 'preparation') {
        this.orchestrator.scheduleCombatStart(room, COMBAT_START_DELAY_MS);
      }
      return room.toSnapshot(this.now());
    });
  }

  @SubscribeMessage('lobby:setMap')
  async onSetMap(
    @ConnectedSocket() client: AppSocket,
    @MessageBody() body: unknown,
  ): Promise<Ack<RoomSnapshot>> {
    return this.handle(client, 'lobby:setMap', () => {
      const code = this.requireRoomCode(client);
      const { mapId } = this.parse(setMapSchema, body);
      const room = this.rooms.setMap(code, client.id, mapId);
      this.emitState(room);
      return room.toSnapshot(this.now());
    });
  }

  @SubscribeMessage('lobby:setDifficulty')
  async onSetDifficulty(
    @ConnectedSocket() client: AppSocket,
    @MessageBody() body: unknown,
  ): Promise<Ack<RoomSnapshot>> {
    return this.handle(client, 'lobby:setDifficulty', () => {
      const code = this.requireRoomCode(client);
      const { difficulty } = this.parse(setDifficultySchema, body);
      const room = this.rooms.setDifficulty(code, client.id, difficulty);
      this.emitState(room);
      return room.toSnapshot(this.now());
    });
  }

  @SubscribeMessage('lobby:start')
  async onStart(@ConnectedSocket() client: AppSocket): Promise<Ack<RoomSnapshot>> {
    return this.handle(client, 'lobby:start', () => {
      const code = this.requireRoomCode(client);
      const room = this.rooms.start(code, client.id);
      this.emitState(room);
      return room.toSnapshot(this.now());
    });
  }

  @SubscribeMessage('chat:send')
  async onChat(
    @ConnectedSocket() client: AppSocket,
    @MessageBody() body: unknown,
  ): Promise<Ack<ChatMessageSnapshot>> {
    return this.handle(client, 'chat:send', () => {
      const code = this.requireRoomCode(client);
      const { text } = this.parse(chatSendSchema, body);
      const msg = this.rooms.chat(code, client.id, text);
      this.server.to(code).emit('chat:message', msg);
      return msg;
    });
  }

  @SubscribeMessage('combat:coreDamage')
  async onCoreDamage(
    @ConnectedSocket() client: AppSocket,
    @MessageBody() body: unknown,
  ): Promise<Ack<CombatSnapshot>> {
    return this.handle(client, 'combat:coreDamage', () => {
      const code = this.requireRoomCode(client);
      const payload = this.parse(coreDamageSchema, body);
      const room = this.rooms.coreDamage(code, client.id, payload.target, payload.amount);
      if (room.status === 'results') {
        this.emitState(room);
        this.server.to(code).emit('match:over', room.toSnapshot(this.now()));
      } else {
        this.emitCombat(room, 'combat:tick');
      }
      return room.combatSnapshot(this.now());
    });
  }

  @SubscribeMessage('ping')
  async onPing(
    @ConnectedSocket() client: AppSocket,
  ): Promise<Ack<{ t: number }>> {
    return this.handle(client, 'ping', () => ({ t: this.now() }));
  }
}
