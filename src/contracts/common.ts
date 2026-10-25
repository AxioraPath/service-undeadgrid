import type { Slot, Team } from '../config/game.config';

/**
 * Máquina de estados de la partida (autoritativa en el servidor).
 *
 *   lobby       → jugadores entran, eligen mapa/dificultad y marcan "listo"
 *   selection   → cada jugador elige y CONFIRMA su superviviente
 *   preparation → cuenta atrás previa; el host ha pulsado "start"
 *   combat      → simulación activa (fases prep/wave1/wave2/horde por tiempo)
 *   results     → la partida terminó; se muestra el resultado
 *
 * Nota: "preparation" (estado de sala, previo al combate) es distinto de la
 * FASE "prep" dentro de combat (ver game.config PHASES). El estado de sala
 * cubre todo el ciclo; las fases solo existen durante `combat`.
 */
export type RoomStatus =
  | 'lobby'
  | 'selection'
  | 'preparation'
  | 'combat'
  | 'results';

export const ROOM_STATUSES: readonly RoomStatus[] = [
  'lobby',
  'selection',
  'preparation',
  'combat',
  'results',
] as const;

/** Identificador de fase de combate (espeja PhaseDef.id). */
export type PhaseId = 'prep' | 'wave1' | 'wave2' | 'horde';

/** Resultado final de la partida. */
export interface MatchResult {
  /**
   * Winning TEAM, or null for a draw / unresolved (e.g. simultaneous abandonment).
   * In 1v1 the team number equals the winner's slot.
   */
  winner: Team | null;
  /** Todos contra todos: slot ganador (null = empate). En 1v1/2v2 no existe. */
  winnerSlot?: Slot | null;
  reason: 'core_destroyed' | 'opponent_left' | 'time_out' | 'last_standing';
  /** Final HP of each team's shared core (keyed by team; in 1v1 team == slot). */
  cores: Record<Team, number>;
}

/** Códigos de error estables para acks (el cliente puede mapearlos a UI). */
export const ErrorCode = {
  VALIDATION: 'VALIDATION',
  ROOM_NOT_FOUND: 'ROOM_NOT_FOUND',
  ROOM_FULL: 'ROOM_FULL',
  ROOM_CLOSED: 'ROOM_CLOSED',
  TEAM_FULL: 'TEAM_FULL',
  TOO_MANY_PLAYERS: 'TOO_MANY_PLAYERS',
  NAME_INVALID: 'NAME_INVALID',
  CODE_INVALID: 'CODE_INVALID',
  NOT_IN_ROOM: 'NOT_IN_ROOM',
  NOT_HOST: 'NOT_HOST',
  NOT_ALLOWED: 'NOT_ALLOWED',
  BAD_STATE: 'BAD_STATE',
  SURVIVOR_INVALID: 'SURVIVOR_INVALID',
  RATE_LIMITED: 'RATE_LIMITED',
  ALREADY_IN_ROOM: 'ALREADY_IN_ROOM',
  INTERNAL: 'INTERNAL',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/** Error normalizado que viaja en los acks. */
export interface ApiError {
  code: ErrorCode;
  message: string;
  /** Detalles opcionales (p. ej. issues de validación). */
  details?: unknown;
}

/**
 * Acknowledgement tipado y discriminado.
 * Todo handler cliente→servidor responde con un Ack<T>.
 */
export type Ack<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: ApiError };

export const ok = <T>(data: T): Ack<T> => ({ ok: true, data });
export const fail = (error: ApiError): Ack<never> => ({ ok: false, error });

/** Per-player stats shown on the results screen. */
export interface MatchPlayerStats {
  /** Team of this player (1v1: same as the slot). */
  team: Team;
  zombieKills: number;
  structuresBuilt: number;
  /** HP of the enemy core removed by this player's bullets. */
  coreDamageDealt: number;
  /** Remaining HP percentage (0-100) of this player's team core. */
  coreHpPct: number;
}

/** Payload of `match:over`: the room snapshot plus the results-screen details. */
export interface MatchOverPayload {
  /** XP earned per slot. */
  xp?: Record<number, number>;
  /** Keyed by slot: 1-2 in 1v1, 1-4 in 2v2 (only players that took part). */
  stats: Record<number, MatchPlayerStats>;
  durationS: number;
  /** Winning TEAM (1v1: same number as the winning slot) or null for a draw. */
  winner: Team | null;
  /** Todos contra todos: slot ganador (null = empate). */
  winnerSlot?: Slot | null;
  reason: MatchResult['reason'];
  /** Spanish display name of the map. */
  mapName: string;
}

/** Payload of `match:rematchState`. */
export interface RematchStateData {
  /** Slots currently requesting a rematch. */
  requested: number[];
}
