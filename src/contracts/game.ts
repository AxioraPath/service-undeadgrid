import { z } from 'zod';
import type { Slot } from '../config/game.config';

/**
 * Contrato de la simulación de combate (servidor autoritativo a 30 ticks/s).
 * El cliente solo envía inputs/comandos y dibuja lo que llega en `game:state`.
 */

// ---- Cliente → servidor ----

/** Aim limits: components are clamped to +-AIM_CLAMP; vectors shorter than AIM_MIN_MAGNITUDE are treated as absent. */
export const AIM_CLAMP = 1000;
export const AIM_MIN_MAGNITUDE = 1e-3;

/**
 * Optional aim direction (player -> mouse, world space). Not necessarily unit length; the server normalizes.
 * Invalid values (non-finite, wrong type, ~zero vector) are dropped to `undefined` instead of rejecting
 * the whole input, so movement keeps working.
 */
const aimInner = z
  .object({ x: z.number().finite(), y: z.number().finite() })
  .transform((a) => ({
    x: Math.max(-AIM_CLAMP, Math.min(AIM_CLAMP, a.x)),
    y: Math.max(-AIM_CLAMP, Math.min(AIM_CLAMP, a.y)),
  }))
  .refine((a) => Math.hypot(a.x, a.y) > AIM_MIN_MAGNITUDE)
  .optional()
  .catch(undefined);
export const aimSchema = aimInner as unknown as z.ZodType<{ x: number; y: number } | undefined>;

/** Estado de los controles del jugador. El servidor guarda el último recibido. */
export const gameInputSchema = z.object({
  seq: z.number().int().nonnegative(),
  up: z.boolean(),
  down: z.boolean(),
  left: z.boolean(),
  right: z.boolean(),
  action: z.boolean(),
  aim: aimSchema,
  /** Disparar siempre (clic izquierdo / stick de apuntar), también dentro de la base. */
  fire: z.boolean().optional(),
});
export type GameInputPayload = z.infer<typeof gameInputSchema>;

/** Acciones discretas: barra rápida (1-5) y sacar de la caja propia. */
export const gameCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hotbar'), slot: z.number().int().min(1).max(7) as unknown as z.ZodType<1 | 2 | 3 | 4 | 5 | 6 | 7> }),
  /** Construir en una casilla concreta (clic derecho / tocar la casilla); el servidor valida base y alcance. */
  z.object({ type: z.literal('build'), x: z.number().int().min(0).max(255), y: z.number().int().min(0).max(255) }),
  z.object({ type: z.literal('crateTake'), item: z.enum(['wood', 'metal', 'medkits', 'shells']) }),
]);
export type GameCommandPayload = z.infer<typeof gameCommandSchema>;

// ---- Servidor → cliente ----

export interface PointDto {
  x: number;
  y: number;
}

export interface RectDto extends PointDto {
  w: number;
  h: number;
}

/** Mapa completo; se pide una vez con `game:sync` al entrar a la partida. */
export interface GameMapDto {
  seed: number;
  w: number;
  h: number;
  /** Capa de colisión (Tile) por casilla, fila a fila. */
  tiles: number[];
  /** Capa de suelo (Ground) por casilla, solo visual. */
  ground: number[];
  objects: { kind: string; x: number; y: number; w: number; h: number; variant: number }[];
  bases: Record<Slot, RectDto>;
  cores: Record<Slot, PointDto>;
  crates: Record<Slot, PointDto>;
  spawns: PointDto[];
  /** Punto (en casillas) de la caja de armamento del centro. */
  armory: PointDto;
}

export interface StockDto {
  wood: number;
  metal: number;
  medkits: number;
  shells: number;
}

export interface GamePlayerDto {
  id: string;
  slot: Slot;
  name: string;
  survivor: string;
  x: number;
  y: number;
  dirX: number;
  dirY: number;
  /** Continuous unit aim direction; present only while the player has a valid aim (otherwise omitted). */
  aimX?: number;
  aimY?: number;
  hp: number;
  alive: boolean;
  /** Segundos para reaparecer; null si no reaparece (núcleo destruido) o está vivo. */
  respawnIn: number | null;
  weapon: 'pistol' | 'shotgun' | 'smg';
  build: 'wall' | 'trap' | 'turret';
  /** Balas de metralleta y torretas por colocar (de la caja de armamento). */
  smgAmmo: number;
  turrets: number;
  wood: number;
  metal: number;
  medkits: number;
  shells: number;
  kills: number;
  zombieKills: number;
  deaths: number;
  /** Momento (tiempo de partida) del último disparo/daño, para animaciones. -1 = nunca. */
  shotAt: number;
  hurtAt: number;
  inBase: boolean;
  onCrate: boolean;
  /** Qué haría el botón de acción en la casilla de enfrente (solo dentro de la base). */
  buildHint: { x: number; y: number; ok: boolean; label: string; orient: 'h' | 'v' } | null;
}

/** [id, x, y, hp, maxHp, kind(0 normal | 1 rápido | 2 tanque), attackAt, hurtAt] */
export type ZombieTuple = [number, number, number, number, number, number, number, number];
/** [id, x, y, vx, vy] */
export type BulletTuple = [number, number, number, number, number];
/** [casilla, tipo(0 madera | 1 reforzada | 2 trampa), hp, maxHp, dueño, orientación('h' | 'v')] */
export type StructureTuple = [number, number, number, number, Slot, 'h' | 'v'];

export type GameEventDto =
  | { type: 'shot'; x: number; y: number; dirX: number; dirY: number; slot: Slot }
  | { type: 'hit'; x: number; y: number }
  | { type: 'zombieDied'; x: number; y: number; kind: 'normal' | 'fast' | 'tank' }
  | { type: 'playerDied'; slot: Slot; x: number; y: number }
  | { type: 'built'; x: number; y: number; what: string }
  | { type: 'rejected'; slot: Slot; reason: string }
  | { type: 'phase'; label: string }
  | { type: 'coreHit'; slot: Slot }
  | { type: 'armoryOpened'; slot: Slot }
  | { type: 'armoryReady' };

export interface GameStateDto {
  /** Tick del servidor (monotónico). */
  tick: number;
  /** Segundos de partida. */
  time: number;
  phase: { id: string; label: string; start: number; end: number; wave: number };
  maxWave: number;
  players: GamePlayerDto[];
  zombies: ZombieTuple[];
  bullets: BulletTuple[];
  structures: StructureTuple[];
  cores: Record<Slot, number>;
  crates: Record<Slot, StockDto>;
  /** Caja de armamento: disponible, quién la abrió y segundos que lleva abriéndola cada slot. */
  armory: { available: boolean; openedBy: Slot | null; progress: Partial<Record<Slot, number>> };
  /** Torretas: [casilla, aimX, aimY, tiros en el cargador, recargando (0/1)]. */
  turrets: [number, number, number, number, number][];
  /** Eventos ocurridos desde el último estado (efectos visuales). */
  events: GameEventDto[];
  result: { winner: Slot | 0; reason: string; durationS: number; byTime: boolean } | null;
}

export interface GameSyncData {
  map: GameMapDto;
  state: GameStateDto;
}
