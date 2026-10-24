/**
 * Configuración centralizada y PROVISIONAL del juego.
 *
 * Estos valores son un espejo de `undeadgrid-web-app/src/game/constants.ts`
 * y de `.../modules/Lobby/data/catalog.ts`. El servidor es autoritativo sobre
 * las SALAS y las FASES; la simulación de combate sigue viviendo en el cliente
 * (engine.ts) por ahora, por lo que aquí solo se centraliza lo que el servidor
 * necesita para orquestar el flujo 1v1 y para enviar snapshots coherentes.
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
 * Fases de la partida (espeja PHASES y MATCH_DURATION de constants.ts).
 * El servidor avanza estas fases de forma autoritativa por tiempo.
 * wave 0 = preparación (sin zombis ni PvP).
 */
export interface PhaseDef {
  id: 'prep' | 'wave1' | 'wave2' | 'horde';
  label: string;
  start: number; // segundos desde el inicio del combate
  end: number;
  wave: number;
}

export const PHASES: readonly PhaseDef[] = [
  { id: 'prep', label: 'Fase de preparación', start: 0, end: 60, wave: 0 },
  { id: 'wave1', label: 'Oleada 1', start: 60, end: 120, wave: 1 },
  { id: 'wave2', label: 'Oleada 2', start: 120, end: 180, wave: 2 },
  { id: 'horde', label: 'Horda final', start: 180, end: 240, wave: 3 },
];

/** Duración total del combate en segundos (espeja MATCH_DURATION). */
export const MATCH_DURATION = 240;

/** Vida del núcleo (espeja CORE_HP). Destruir el núcleo rival = victoria. */
export const CORE_HP = 500;

/** Ritmo con el que el servidor emite el tick de fase/reloj de combate. */
export const PHASE_TICK_MS = 1000;

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
