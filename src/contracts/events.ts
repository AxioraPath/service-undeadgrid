import type { Slot } from '../config/game.config';
import type { Ack, MatchOverPayload, RematchStateData } from './common';
import type {
  ChatSendPayload,
  CreateRoomPayload,
  JoinRoomPayload,
  ReadyPayload,
  RenamePayload,
  SelectSurvivorPayload,
  SetDifficultyPayload,
  SetMapPayload,
} from './payloads';
import type { GameCommandPayload, GameInputPayload, GameStateDto, GameSyncData } from './game';
import type {
  ChatMessageSnapshot,
  CombatSnapshot,
  RoomSnapshot,
} from './snapshots';

/** Datos que el servidor devuelve al crear/unirse correctamente. */
export interface JoinedData {
  /** Token de sesión del jugador (persistir en el cliente para reconectar). */
  sessionId: string;
  /** Slot asignado (1 azul, 2 rojo). */
  slot: Slot;
  /** Si este jugador es el host de la sala. */
  isHost: boolean;
  /** Snapshot inicial completo de la sala. */
  room: RoomSnapshot;
}

/**
 * Eventos CLIENTE → SERVIDOR.
 * Cada handler recibe su payload y un callback de ack tipado como último argumento.
 * Socket.IO reconoce el ack si el último argumento es una función.
 */
export interface ClientToServerEvents {
  'lobby:create': (p: CreateRoomPayload, ack: (r: Ack<JoinedData>) => void) => void;
  'lobby:join': (p: JoinRoomPayload, ack: (r: Ack<JoinedData>) => void) => void;
  'lobby:leave': (ack: (r: Ack) => void) => void;
  'lobby:rename': (p: RenamePayload, ack: (r: Ack<RoomSnapshot>) => void) => void;
  'lobby:ready': (p: ReadyPayload, ack: (r: Ack<RoomSnapshot>) => void) => void;
  'lobby:selectSurvivor': (
    p: SelectSurvivorPayload,
    ack: (r: Ack<RoomSnapshot>) => void,
  ) => void;
  'lobby:confirmSurvivor': (ack: (r: Ack<RoomSnapshot>) => void) => void;
  'lobby:setMap': (p: SetMapPayload, ack: (r: Ack<RoomSnapshot>) => void) => void;
  'lobby:setDifficulty': (
    p: SetDifficultyPayload,
    ack: (r: Ack<RoomSnapshot>) => void,
  ) => void;
  'lobby:start': (ack: (r: Ack<RoomSnapshot>) => void) => void;
  /** Back to the lobby for both players. Only valid in `results`. */
  'lobby:backToLobby': (ack: (r: Ack<RoomSnapshot>) => void) => void;
  /** Ask for a rematch (same map/difficulty/survivors, new seed). Only valid in `results`. */
  'match:rematchRequest': (ack: (r: Ack) => void) => void;
  /** Withdraw the rematch request. Only valid in `results`. */
  'match:rematchCancel': (ack: (r: Ack) => void) => void;
  'chat:send': (p: ChatSendPayload, ack: (r: Ack<ChatMessageSnapshot>) => void) => void;
  /** Controles del jugador (el servidor guarda el último). Sin respuesta para no gastar red. */
  'game:input': (p: GameInputPayload, ack?: (r: Ack) => void) => void;
  /** Barra rápida (1-5) o sacar de la caja propia. */
  'game:command': (p: GameCommandPayload, ack?: (r: Ack) => void) => void;
  /** Mapa + estado completo al entrar o volver a la partida. */
  'game:sync': (ack: (r: Ack<GameSyncData>) => void) => void;
  ping: (p: { t?: number } | undefined, ack: (r: Ack<{ t: number }>) => void) => void;
}

/**
 * Eventos SERVIDOR → CLIENTE (broadcast/push, sin ack).
 */
export interface ServerToClientEvents {
  /** Snapshot completo de la sala tras cualquier cambio relevante. */
  'lobby:state': (room: RoomSnapshot) => void;
  /** Un jugador entró. */
  'lobby:playerJoined': (data: { slot: Slot; name: string }) => void;
  /** Un jugador salió/abandonó. */
  'lobby:playerLeft': (data: { slot: Slot; name: string; reason: 'left' | 'disconnected' }) => void;
  /** Un jugador se reconectó dentro de la ventana de gracia. */
  'lobby:playerReconnected': (data: { slot: Slot; name: string }) => void;
  /** La sala fue cerrada por el servidor (host se fue, limpieza, etc.). */
  'lobby:closed': (data: { reason: string }) => void;
  /** Nuevo mensaje de chat. */
  'chat:message': (msg: ChatMessageSnapshot) => void;
  /** Cambio de fase durante el combate. */
  'combat:phase': (data: CombatSnapshot) => void;
  /** Tick de reloj de combate (1 Hz). */
  'combat:tick': (data: CombatSnapshot) => void;
  /** La partida terminó. */
  'match:over': (room: RoomSnapshot & MatchOverPayload) => void;
  /** Slots requesting a rematch; emitted on every change (and with [] when cleared). */
  'match:rematchState': (data: RematchStateData) => void;
  /** Estado de la simulación, 30 veces por segundo durante el combate. */
  'game:state': (state: GameStateDto) => void;
}

/** Datos por-socket (namespace de datos del lado servidor). */
export interface SocketData {
  sessionId?: string;
  roomCode?: string;
  slot?: Slot;
  /** Id de la cuenta real si el socket se autenticó con JWT. */
  userId?: string;
  /** displayName de la cuenta (cacheado al autenticar); fuente de verdad del nombre en partida. */
  displayName?: string;
}

/** No usamos eventos entre servidores (sin adaptador multi-nodo por ahora). */
export type InterServerEvents = Record<string, never>;
