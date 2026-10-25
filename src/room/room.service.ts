import { Injectable, Logger } from '@nestjs/common';
import {
  LIFECYCLE,
  ROOM_CAPACITY,
  type Slot,
} from '../config/game.config';
import { ErrorCode, type MatchResult } from '../contracts';
import { DomainError } from '../common/domain-error';
import { newSessionId, randomRoomCode, randomSeed } from '../common/ids';
import { Player } from '../domain/player';
import { Room } from '../domain/room';
import { TICK_DT } from '../game/constants';
import { createMatch, phaseOf, step, ticksFor, type Command, type PlayerInput } from '../game/engine';
import { encodeMap, encodeState } from '../game/snapshot';
import type { GameSyncData } from '../contracts';

const IDLE: PlayerInput = { up: false, down: false, left: false, right: false, action: false };

/** Máximo de ticks que se simulan de golpe (si el proceso se atrasa, no se intenta recuperar de más). */
const MAX_CATCH_UP_TICKS = 15;

/** Resultado de un alta/reingreso en una sala. */
export interface JoinOutcome {
  room: Room;
  player: Player;
  reconnected: boolean;
}

/**
 * Servicio autoritativo de salas. Única fuente de verdad del estado de las
 * salas en memoria (sin base de datos: el juego es efímero y 1v1). Toda la
 * lógica de validación, transiciones y ciclo de vida vive aquí; el gateway
 * solo traduce entre Socket.IO y estos métodos.
 *
 * No emite por red: devuelve dominio/snapshots y el gateway se encarga del push.
 */
@Injectable()
export class RoomService {
  private readonly logger = new Logger(RoomService.name);
  private readonly rooms = new Map<string, Room>();

  /** Reloj inyectable para tests deterministas. */
  now(): number {
    return Date.now();
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  /** Lista de salas (solo lectura, para barrido de limpieza). */
  all(): Room[] {
    return [...this.rooms.values()];
  }

  private require(code: string): Room {
    const room = this.get(code);
    if (!room) {
      throw new DomainError(ErrorCode.ROOM_NOT_FOUND, 'La sala no existe');
    }
    return room;
  }

  // ---- Crear / unirse ----

  /** Crea una sala nueva y mete al creador como host en el slot 1. */
  create(params: { name: string; socketId: string; survivor?: string; userId?: string | null }): JoinOutcome {
    const now = this.now();
    const code = this.uniqueCode();
    const room = new Room(code, randomSeed(), now);

    const player = new Player({
      sessionId: newSessionId(),
      socketId: params.socketId,
      name: params.name,
      slot: 1,
      isHost: true,
      survivor: params.survivor,
      userId: params.userId ?? null,
    });
    room.addPlayer(player);
    room.hostSlot = 1;
    this.rooms.set(code, room);

    this.logger.log(`Sala creada ${code} por "${player.name}"`);
    return { room, player, reconnected: false };
  }

  /**
   * Une a una sala por código. Si se aporta un sessionId válido de un asiento
   * desconectado, RECONECTA en lugar de ocupar un slot nuevo.
   */
  join(params: {
    code: string;
    name: string;
    socketId: string;
    survivor?: string;
    sessionId?: string;
    userId?: string | null;
  }): JoinOutcome {
    const room = this.require(params.code);

    // Intento de reconexión a un asiento existente.
    if (params.sessionId) {
      const existing = room.getBySession(params.sessionId);
      if (existing) {
        if (existing.connected) {
          throw new DomainError(
            ErrorCode.ALREADY_IN_ROOM,
            'Esa sesión ya está conectada en la sala',
          );
        }
        existing.markReconnected(params.socketId);
        if (params.userId) existing.userId = params.userId;
        this.logger.log(`Reconexión ${room.code} slot ${existing.slot} "${existing.name}"`);
        return { room, player: existing, reconnected: true };
      }
    }

    if (room.status !== 'lobby') {
      throw new DomainError(
        ErrorCode.BAD_STATE,
        'La partida ya ha comenzado; no se puede unir',
      );
    }
    if (room.isFull) {
      throw new DomainError(ErrorCode.ROOM_FULL, 'La sala está llena');
    }

    const slot = room.freeSlot();
    if (slot === null) {
      throw new DomainError(ErrorCode.ROOM_FULL, 'La sala está llena');
    }

    const player = new Player({
      sessionId: newSessionId(),
      socketId: params.socketId,
      name: params.name,
      slot,
      isHost: false,
      survivor: params.survivor,
      userId: params.userId ?? null,
    });
    room.addPlayer(player);

    this.logger.log(`"${player.name}" se unió a ${room.code} en slot ${slot}`);
    return { room, player, reconnected: false };
  }

  private uniqueCode(): string {
    for (let i = 0; i < 20; i++) {
      const code = randomRoomCode();
      if (!this.rooms.has(code)) return code;
    }
    throw new DomainError(ErrorCode.INTERNAL, 'No se pudo generar un código único');
  }

  // ---- Operaciones de lobby ----

  /** Localiza al jugador propietario del socket dentro de la sala indicada. */
  playerInRoom(code: string, socketId: string): { room: Room; player: Player } {
    const room = this.require(code);
    const player = room.getBySocket(socketId);
    if (!player) {
      throw new DomainError(ErrorCode.NOT_IN_ROOM, 'No perteneces a esta sala');
    }
    return { room, player };
  }

  rename(code: string, socketId: string, name: string): Room {
    const { room, player } = this.playerInRoom(code, socketId);
    player.name = name;
    this.bump(room);
    return room;
  }

  setReady(code: string, socketId: string, ready: boolean): Room {
    const { room, player } = this.playerInRoom(code, socketId);
    if (room.status !== 'lobby' && room.status !== 'selection') {
      throw new DomainError(ErrorCode.BAD_STATE, 'No puedes cambiar "listo" ahora');
    }
    player.ready = ready;
    this.bump(room);
    return room;
  }

  selectSurvivor(code: string, socketId: string, survivor: string): Room {
    const { room, player } = this.playerInRoom(code, socketId);
    if (room.status !== 'lobby' && room.status !== 'selection') {
      throw new DomainError(ErrorCode.BAD_STATE, 'No puedes elegir superviviente ahora');
    }
    player.survivor = survivor;
    // Cambiar de superviviente invalida la confirmación previa.
    player.survivorConfirmed = false;
    this.bump(room);
    return room;
  }

  confirmSurvivor(code: string, socketId: string): Room {
    const { room, player } = this.playerInRoom(code, socketId);
    if (room.status !== 'selection') {
      throw new DomainError(
        ErrorCode.BAD_STATE,
        'La confirmación solo es válida en la fase de selección',
      );
    }
    player.survivorConfirmed = true;
    this.bump(room);

    // Cuando ambos confirman, el servidor avanza a preparación.
    if (room.allSurvivorsConfirmed()) {
      room.transition('preparation');
      this.logger.log(`Sala ${room.code}: ambos confirmaron → preparación`);
    }
    return room;
  }

  setMap(code: string, socketId: string, mapId: string): Room {
    const room = this.requireHostEditable(code, socketId);
    room.mapId = mapId;
    this.bump(room);
    return room;
  }

  setDifficulty(code: string, socketId: string, difficulty: string): Room {
    const room = this.requireHostEditable(code, socketId);
    room.difficulty = difficulty;
    this.bump(room);
    return room;
  }

  /** Valida que el socket sea el host y que la sala esté en un estado editable. */
  private requireHostEditable(code: string, socketId: string): Room {
    const { room, player } = this.playerInRoom(code, socketId);
    if (player.slot !== room.hostSlot) {
      throw new DomainError(ErrorCode.NOT_HOST, 'Solo el host puede cambiar los ajustes');
    }
    if (room.status !== 'lobby') {
      throw new DomainError(ErrorCode.BAD_STATE, 'Los ajustes solo se editan en el lobby');
    }
    return room;
  }

  /**
   * El HOST inicia la partida. Validaciones server-side:
   *  - debe ser el host
   *  - sala llena (2 jugadores), ambos conectados y listos
   * El superviviente ya se eligió en el lobby, así que pasa directo a
   * preparation (lobby → selection → preparation) y de ahí al combate.
   */
  start(code: string, socketId: string): Room {
    const { room, player } = this.playerInRoom(code, socketId);
    if (player.slot !== room.hostSlot) {
      throw new DomainError(ErrorCode.NOT_HOST, 'Solo el host puede iniciar la partida');
    }
    if (room.status !== 'lobby') {
      throw new DomainError(ErrorCode.BAD_STATE, 'La partida no puede iniciarse ahora');
    }
    if (room.players.size !== ROOM_CAPACITY) {
      throw new DomainError(ErrorCode.BAD_STATE, 'Faltan jugadores para empezar');
    }
    if (!room.allReady()) {
      throw new DomainError(ErrorCode.BAD_STATE, 'No todos los jugadores están listos');
    }
    room.transition('selection');
    for (const p of room.players.values()) p.survivorConfirmed = true;
    room.transition('preparation');
    this.logger.log(`Sala ${room.code}: host inició → preparación`);
    return room;
  }

  // ---- Combate ----

  /** Arranca el combate (preparation → combat). Lo invoca el orquestador de fases. */
  beginCombat(room: Room): void {
    if (room.status !== 'preparation') return;
    room.transition('combat');
    room.match = createMatch({
      seed: room.seed,
      difficulty: room.difficulty,
      players: [...room.players.values()].map((p) => ({
        id: p.sessionId,
        slot: p.slot,
        name: p.name,
        survivor: p.survivor,
      })),
    });
    room.inputs.clear();
    room.actionTaps.clear();
    room.fireTaps.clear();
    room.commands = [];
    room.startCombat(this.now());
    this.logger.log(`Sala ${room.code}: combate iniciado (seed ${room.seed})`);
  }

  // ---- Simulación ----

  private requireMatch(code: string, socketId: string) {
    const { room, player } = this.playerInRoom(code, socketId);
    if (room.status !== 'combat' || !room.match) {
      throw new DomainError(ErrorCode.BAD_STATE, 'No hay combate en curso');
    }
    return { room, player, match: room.match };
  }

  /** Guarda el último estado de los controles del jugador; el siguiente tick lo aplica. */
  input(code: string, socketId: string, input: PlayerInput): void {
    const { room, player } = this.requireMatch(code, socketId);
    room.inputs.set(player.sessionId, input);
    if (input.action) room.actionTaps.add(player.sessionId);
    if (input.fire) room.fireTaps.add(player.sessionId);
  }

  /** Encola un comando discreto (barra rápida o caja) para el siguiente tick. */
  command(code: string, socketId: string, cmd: Command): void {
    const { room, player } = this.requireMatch(code, socketId);
    if (room.commands.length < 50) room.commands.push({ playerId: player.sessionId, cmd });
  }

  /** Mapa y estado completos, para entrar (o volver tras recargar) a la partida. */
  sync(code: string, socketId: string): GameSyncData {
    const { room } = this.playerInRoom(code, socketId);
    if (!room.match || (room.status !== 'combat' && room.status !== 'results')) {
      throw new DomainError(ErrorCode.BAD_STATE, 'No hay combate en curso');
    }
    return { map: encodeMap(room.match), state: encodeState(room.match, false) };
  }

  /**
   * Avanza la simulación a paso fijo hasta el tiempo real transcurrido. Devuelve
   * cuántos ticks simuló, si cambió la fase y si terminó la partida.
   */
  tickCombat(room: Room): { stepped: number; phaseChanged: boolean; finished: boolean } {
    const match = room.match;
    if (room.status !== 'combat' || !match || room.combatStartedAt === null) {
      return { stepped: 0, phaseChanged: false, finished: false };
    }
    const target = ticksFor((this.now() - room.combatStartedAt) / 1000);
    let stepped = 0;
    // Si el proceso se atrasó mucho, se descarta el tiempo perdido en lugar de simularlo todo.
    if (target - match.ticks > MAX_CATCH_UP_TICKS * 20) {
      match.ticks = target - MAX_CATCH_UP_TICKS;
    }
    while (match.ticks < target && !match.result) {
      const inputs: Record<string, PlayerInput> = {};
      for (const p of room.players.values()) {
        const last = p.connected ? (room.inputs.get(p.sessionId) ?? IDLE) : IDLE;
        const tapped = room.actionTaps.has(p.sessionId) ? { ...last, action: true } : last;
        inputs[p.sessionId] = room.fireTaps.has(p.sessionId) ? { ...tapped, fire: true } : tapped;
      }
      room.actionTaps.clear();
      room.fireTaps.clear();
      step(match, inputs, room.commands.splice(0), TICK_DT);
      stepped++;
    }

    room.cores = { 1: match.cores[1].hp, 2: match.cores[2].hp };
    const phase = phaseOf(match);
    const phaseChanged = phase.id !== room.lastPhaseId;
    if (phaseChanged) room.lastPhaseId = phase.id;
    if (stepped) room.touch();

    if (match.result) {
      const { winner, byTime } = match.result;
      this.finish(room, {
        winner: winner === 0 ? null : winner,
        reason: byTime ? 'time_out' : 'core_destroyed',
        cores: { ...room.cores },
      });
      return { stepped, phaseChanged, finished: true };
    }
    return { stepped, phaseChanged, finished: false };
  }

  finish(room: Room, result: MatchResult): void {
    room.finish(result);
    this.logger.log(
      `Sala ${room.code}: fin (${result.reason}) ganador=${result.winner ?? 'empate'}`,
    );
  }

  // ---- Resultados: revancha / volver al lobby ----

  private requireResults(code: string, socketId: string) {
    const ctx = this.playerInRoom(code, socketId);
    if (ctx.room.status !== 'results') {
      throw new DomainError(ErrorCode.BAD_STATE, 'Solo disponible en la pantalla de resultados');
    }
    return ctx;
  }

  /**
   * Marks the caller as requesting a rematch. When both players asked, the room
   * is reset into `preparation` with a new seed (same map/difficulty/survivors).
   */
  requestRematch(code: string, socketId: string): { room: Room; started: boolean } {
    const { room, player } = this.requireResults(code, socketId);
    const everyoneHere =
      room.players.size === ROOM_CAPACITY && [...room.players.values()].every((p) => p.connected);
    if (!everyoneHere) {
      throw new DomainError(ErrorCode.BAD_STATE, 'Tu rival ya no está en la sala');
    }
    room.rematch.add(player.slot);
    this.bump(room);
    if (room.rematch.size === ROOM_CAPACITY) {
      room.resetForRematch(randomSeed());
      this.logger.log(`Sala ${room.code}: revancha -> preparación (seed ${room.seed})`);
      return { room, started: true };
    }
    return { room, started: false };
  }

  cancelRematch(code: string, socketId: string): Room {
    const { room, player } = this.requireResults(code, socketId);
    room.rematch.delete(player.slot);
    this.bump(room);
    return room;
  }

  /** Both players go back to the lobby (results -> lobby). */
  backToLobby(code: string, socketId: string): Room {
    const { room } = this.requireResults(code, socketId);
    room.resetToLobby();
    this.logger.log(`Sala ${room.code}: de vuelta al lobby`);
    return room;
  }

  // ---- Chat ----

  chat(code: string, socketId: string, text: string) {
    const { room, player } = this.playerInRoom(code, socketId);
    return room.addChat(player, text, this.now());
  }

  // ---- Desconexión / abandono / limpieza ----

  /**
   * Un jugador abandona voluntariamente. Devuelve info para que el gateway
   * notifique y, si procede, cierre la sala.
   */
  leave(code: string, socketId: string): { room: Room; player: Player; closed: boolean } {
    const { room, player } = this.playerInRoom(code, socketId);
    return this.removeSeat(room, player, true);
  }

  /**
   * El socket se desconectó. Si la sala está en lobby/selección se libera el
   * asiento; si la partida está en curso se conserva para permitir reconexión.
   */
  handleDisconnect(
    socketId: string,
  ): { room: Room; player: Player; closed: boolean; kept: boolean } | null {
    for (const room of this.rooms.values()) {
      const player = room.getBySocket(socketId);
      if (!player) continue;

      const keepSeat = room.status === 'combat' || room.status === 'preparation';
      if (keepSeat) {
        player.markDisconnected(this.now());
        this.bump(room);
        this.logger.log(
          `Desconexión ${room.code} slot ${player.slot} (asiento reservado para reconexión)`,
        );
        return { room, player, closed: false, kept: true };
      }
      const { closed } = this.removeSeat(room, player, false);
      return { room, player, closed, kept: false };
    }
    return null;
  }

  /** Quita un asiento y resuelve host/cierre de sala. */
  private removeSeat(
    room: Room,
    player: Player,
    voluntary: boolean,
  ): { room: Room; player: Player; closed: boolean } {
    room.rematch.clear();
    // Si la partida está en curso y un jugador se va, el rival gana por abandono.
    if (room.status === 'combat' || room.status === 'preparation') {
      const rivalSlot: Slot = player.slot === 1 ? 2 : 1;
      const rival = room.players.get(rivalSlot);
      room.removePlayer(player.slot);
      this.finish(room, {
        winner: rival ? rivalSlot : null,
        reason: 'opponent_left',
        cores: { ...room.cores },
      });
      // La sala queda en results; se limpiará por TTL.
      return { room, player, closed: false };
    }

    room.removePlayer(player.slot);
    // Si se va durante la selección, la sala vuelve al lobby para esperar a otro rival.
    if (room.status === 'selection') {
      room.transition('lobby');
      for (const p of room.players.values()) {
        p.ready = false;
        p.survivorConfirmed = false;
      }
    }
    this.logger.log(
      `${voluntary ? 'Abandono' : 'Baja'} ${room.code} slot ${player.slot} "${player.name}"`,
    );

    if (room.players.size === 0) {
      this.destroy(room.code);
      return { room, player, closed: true };
    }
    room.reassignHostIfNeeded();
    this.bump(room);
    return { room, player, closed: false };
  }

  destroy(code: string): void {
    if (this.rooms.delete(code.toUpperCase())) {
      this.logger.log(`Sala ${code} eliminada`);
    }
  }

  /**
   * Barrido periódico: elimina salas vacías o huérfanas y expira asientos cuya
   * ventana de reconexión venció. Devuelve las salas cerradas para notificar.
   */
  sweep(): { closed: string[]; expiredRooms: Room[] } {
    const now = this.now();
    const closed: string[] = [];
    const expiredRooms: Room[] = [];

    for (const room of [...this.rooms.values()]) {
      // Expira asientos desconectados fuera de la ventana de gracia.
      let changed = false;
      for (const p of [...room.players.values()]) {
        if (
          !p.connected &&
          p.disconnectedAt !== null &&
          now - p.disconnectedAt > LIFECYCLE.reconnectGraceMs
        ) {
          // En results no importa; en otros estados liberamos el asiento.
          if (room.status === 'results') continue;
          room.removePlayer(p.slot);
          changed = true;
        }
      }
      if (changed) {
        if (room.players.size === 0) {
          this.destroy(room.code);
          closed.push(room.code);
          continue;
        }
        room.reassignHostIfNeeded();
        this.bump(room);
        expiredRooms.push(room);
      }

      // Sala sin nadie conectado durante demasiado tiempo.
      if (room.connectedCount === 0) {
        const idleRef = this.lastActivity(room);
        if (now - idleRef > LIFECYCLE.emptyRoomTtlMs) {
          this.destroy(room.code);
          closed.push(room.code);
          continue;
        }
      }

      // Salas en results se limpian pasado el TTL de sala vacía.
      if (room.status === 'results' && now - room.createdAt > LIFECYCLE.lobbyMaxAgeMs) {
        this.destroy(room.code);
        closed.push(room.code);
        continue;
      }

      // Anti-huérfanas: lobby demasiado viejo sin empezar.
      if (
        room.status === 'lobby' &&
        now - room.createdAt > LIFECYCLE.lobbyMaxAgeMs
      ) {
        this.destroy(room.code);
        closed.push(room.code);
      }
    }
    return { closed, expiredRooms };
  }

  private lastActivity(room: Room): number {
    let latest = room.createdAt;
    for (const p of room.players.values()) {
      if (p.disconnectedAt && p.disconnectedAt > latest) latest = p.disconnectedAt;
    }
    if (room.combatStartedAt && room.combatStartedAt > latest) latest = room.combatStartedAt;
    return latest;
  }

  /** Incrementa la versión del snapshot (marca el estado como modificado). */
  private bump(room: Room): void {
    room.touch();
  }
}
