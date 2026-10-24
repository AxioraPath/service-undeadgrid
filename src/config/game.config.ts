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

/** Capacidad de la sala: el juego es estrictamente 1 vs 1. */
export const ROOM_CAPACITY = 2;

/** Slots disponibles. Slot 1 = base azul, Slot 2 = base roja. */
export type Slot = 1 | 2;
export const SLOTS: readonly Slot[] = [1, 2] as const;

/** Tema visual/base por slot (espeja la convención azul/rojo del lobby). */
export const SLOT_BASE: Record<Slot, 'blue' | 'red'> = {
  1: 'blue',
  2: 'red',
};

/** Límites de validación de entrada del usuario. */
export const LIMITS = {
  nameMinLength: 1,
  nameMaxLength: 16, // espeja rename(): name.trim().slice(0, 16)
  chatMaxLength: 120, // espeja sendMessage(): text.trim().slice(0, 120)
} as const;

/** Supervivientes desbloqueados (espeja UNLOCKED_SURVIVORS de catalog.ts). */
export const UNLOCKED_SURVIVORS = ['explorador', 'mecanica'] as const;
export type SurvivorId = string;
export const DEFAULT_SURVIVOR = UNLOCKED_SURVIVORS[0];

/** Mapas disponibles (espeja MAPS de catalog.ts). */
export const MAP_IDS = ['ciudad-abandonada', 'desierto-ferroviario', 'distrito-industrial'] as const;

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
  'lobby:start': { points: 10, windowMs: 10_000 },
  'lobby:leave': { points: 10, windowMs: 10_000 },
  'lobby:rename': { points: 20, windowMs: 10_000 },
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
