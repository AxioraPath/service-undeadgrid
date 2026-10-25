/**
 * Configuración centralizada y PROVISIONAL del juego.
 *
 * Las reglas de la partida viven en `src/game` (motor autoritativo). Aquí se
 * centraliza lo que el servidor necesita para orquestar el flujo 1v1 (salas,
 * límites, catálogo del lobby, rate limits y tiempos de vida).
 *
 * REGLA: no inventar reglas de balance aquí. Si un valor difiere del frontend,
 * es un bug. Cuando el equipo defina balance real, se actualiza en ambos lados
 * (idealmente moviendo esto a un paquete `shared/`).
 */

/** Códigos de sala: espeja catalog.ts (CODE_LENGTH y alfabeto sin caracteres confusos). */
export const ROOM_CODE = {
  length: 5,
  // Sin I, O, 0, 1 para evitar confusiones al dictar el código.
  alphabet: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
} as const;

/** Game modes. Rooms are created as '1v1' and the host can switch in the lobby. */
export const GAME_MODES = ['1v1', '2v2'] as const;
export type GameMode = (typeof GAME_MODES)[number];
export const DEFAULT_MODE: GameMode = '1v1';

/** Room capacity per mode (1v1: 2 players, 2v2: 4 players). */
export const MODE_CAPACITY: Record<GameMode, number> = { '1v1': 2, '2v2': 4 };
/** Players per team in 2v2. */
export const TEAM_SIZE = 2;
/** 1v1 capacity (kept for compatibility). */
export const ROOM_CAPACITY = MODE_CAPACITY['1v1'];

/**
 * Slots: 1v1 uses 1 and 2; 2v2 uses 1-4.
 * Team 1 (blue) = slots 1 and 3; team 2 (red) = slots 2 and 4. In 1v1 team == slot.
 */
export { teamOf, seatOf, slotFor, type Slot, type Team } from '../game/constants';
import type { Slot, Team } from '../game/constants';
export const SLOTS: readonly Slot[] = [1, 2, 3, 4] as const;
export const TEAMS: readonly Team[] = [1, 2] as const;

/** Slots that exist in a mode, in order. */
export const slotsOf = (mode: GameMode): readonly Slot[] => SLOTS.slice(0, MODE_CAPACITY[mode]);

/** Visual theme/base per team (blue / red lobby convention). */
export const TEAM_BASE: Record<Team, 'blue' | 'red'> = {
  1: 'blue',
  2: 'red',
};
/** Same convention keyed by slot (a slot uses its team's base). */
export const SLOT_BASE: Record<Slot, 'blue' | 'red'> = {
  1: 'blue',
  2: 'red',
  3: 'blue',
  4: 'red',
};

/** Límites de validación de entrada del usuario. */
export const LIMITS = {
  nameMinLength: 1,
  nameMaxLength: 16, // espeja rename(): name.trim().slice(0, 16)
  chatMaxLength: 120, // espeja sendMessage(): text.trim().slice(0, 120)
} as const;

/** Supervivientes desbloqueados (espeja UNLOCKED_SURVIVORS de catalog.ts). */
export const UNLOCKED_SURVIVORS = ['explorador', 'mecanica', 'militar', 'medica', 'obrero'] as const;
export type SurvivorId = string;
export const DEFAULT_SURVIVOR = UNLOCKED_SURVIVORS[0];

/** Mapas disponibles (espeja MAPS de catalog.ts). */
export const MAP_IDS = ['ciudad-abandonada', 'desierto-ferroviario', 'distrito-industrial'] as const;

/** Spanish display names for the maps (used in the match results payload). */
export const MAP_NAMES: Record<(typeof MAP_IDS)[number], string> = {
  'ciudad-abandonada': 'Ciudad abandonada',
  'desierto-ferroviario': 'Desierto ferroviario',
  'distrito-industrial': 'Distrito industrial',
};

/** Dificultades (espeja DIFFICULTIES de catalog.ts). */
export const DIFFICULTIES = ['Estándar', 'Difícil'] as const;

/**
 * Fases, duración y vida del núcleo: vienen del motor de la partida (src/game),
 * que es la única fuente de las reglas.
 */
export { CORE_HP, MATCH_DURATION, PHASES, type PhaseDef } from '../game/constants';

/** Ritmo con el que el servidor emite el tick de fase/reloj de combate. */
export const PHASE_TICK_MS = 1000;

/** Bucle de simulación: 30 ticks por segundo (ver TICK_RATE en src/game/constants). */
export const SIM_TICK_MS = 1000 / 30;

/**
 * Rate limiting por socket y por tipo de evento (ventana deslizante simple).
 * Valores provisionales, ajustar con datos reales de uso.
 */
export const RATE_LIMITS = {
  // eventos de muy baja frecuencia
  'lobby:create': { points: 5, windowMs: 10_000 },
  'lobby:join': { points: 10, windowMs: 10_000 },
  'lobby:ready': { points: 20, windowMs: 10_000 },
  'lobby:selectSurvivor': { points: 30, windowMs: 10_000 },
  'lobby:confirmSurvivor': { points: 20, windowMs: 10_000 },
  'lobby:setMap': { points: 30, windowMs: 10_000 },
  'lobby:setDifficulty': { points: 30, windowMs: 10_000 },
  'lobby:setMode': { points: 30, windowMs: 10_000 },
  'room:setTeam': { points: 30, windowMs: 10_000 },
  'lobby:start': { points: 10, windowMs: 10_000 },
  'lobby:leave': { points: 10, windowMs: 10_000 },
  'lobby:rename': { points: 20, windowMs: 10_000 },
  'lobby:backToLobby': { points: 10, windowMs: 10_000 },
  // revancha en la pantalla de resultados
  'match:rematchRequest': { points: 10, windowMs: 10_000 },
  'match:rematchCancel': { points: 10, windowMs: 10_000 },
  // chat: más permisivo pero acotado
  'chat:send': { points: 10, windowMs: 5_000 },
  // ping de latencia
  ping: { points: 60, windowMs: 10_000 },
  // partida: el cliente manda su input al cambiar y como latido (~15/s)
  'game:input': { points: 600, windowMs: 10_000 },
  'game:command': { points: 100, windowMs: 10_000 },
  'game:sync': { points: 20, windowMs: 10_000 },
  // fallback para cualquier evento no listado
  default: { points: 30, windowMs: 10_000 },
} as const;

export type RateLimitedEvent = keyof typeof RATE_LIMITS;

/**
 * Tiempos de ciclo de vida de sala (limpieza de salas vacías/huérfanas
 * y ventana de reconexión). Valores provisionales.
 */
export const LIFECYCLE = {
  // Tras desconectarse, un jugador conserva su asiento este tiempo para reconectar.
  reconnectGraceMs: 30_000,
  // Una sala sin jugadores conectados se elimina tras este tiempo.
  emptyRoomTtlMs: 60_000,
  // Barrido periódico de limpieza.
  sweepIntervalMs: 15_000,
  // TTL máximo absoluto de una sala en lobby sin empezar (anti-huérfanas).
  lobbyMaxAgeMs: 30 * 60_000,
} as const;
