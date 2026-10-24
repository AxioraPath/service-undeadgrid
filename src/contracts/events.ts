import type { Slot } from '../config/game.config';
import type { Ack } from './common';
import type {
  ChatSendPayload,
  CoreDamagePayload,
  CreateRoomPayload,
  JoinRoomPayload,
  ReadyPayload,
  RenamePayload,
  SelectSurvivorPayload,
  SetDifficultyPayload,
  SetMapPayload,
} from './payloads';
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
  'chat:send': (p: ChatSendPayload, ack: (r: Ack<ChatMessageSnapshot>) => void) => void;
  'combat:coreDamage': (
    p: CoreDamagePayload,
    ack: (r: Ack<CombatSnapshot>) => void,
  ) => void;
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
  'match:over': (room: RoomSnapshot) => void;
}

/** Datos por-socket (namespace de datos del lado servidor). */
export interface SocketData {
  sessionId?: string;
  roomCode?: string;
  slot?: Slot;
}

/** No usamos eventos entre servidores (sin adaptador multi-nodo por ahora). */
export type InterServerEvents = Record<string, never>;
