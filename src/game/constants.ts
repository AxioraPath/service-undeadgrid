// Valores de la sección 5 del documento. Todo lo de src/game es TS puro (sin DOM)
// para moverlo a shared/ cuando exista el servidor autoritativo.

export const TILE = 32
// Tamaño tomado de los mapas de referencia (Diseños/Mapas): ~1408 × 1024 px con casillas de 32 px.
export const MAP_W = 44
export const MAP_H = 32
export const BASE_SIZE = 8

export const TICK_RATE = 30
export const TICK_DT = 1 / TICK_RATE

/** Player seat. 1v1 uses 1 and 2; 2v2 uses 1-4. */
export type Slot = 1 | 2 | 3 | 4
/** Team. In 1v1 team == slot. In 2v2: team 1 = slots 1 and 3, team 2 = slots 2 and 4. */
export type Team = 1 | 2

export const teamOf = (slot: Slot): Team => (slot % 2 === 1 ? 1 : 2)
/** Seat index inside the team: 0 for slots 1/2, 1 for slots 3/4. */
export const seatOf = (slot: Slot): 0 | 1 => (slot > 2 ? 1 : 0)
export const slotFor = (team: Team, seat: 0 | 1): Slot => ((seat * 2 + team) as Slot)

export interface PhaseDef {
  id: 'prep' | 'wave1' | 'wave2' | 'horde'
  label: string
  start: number
  end: number
  wave: number // 0 = preparación (sin zombis ni PvP)
}

export const PHASES: PhaseDef[] = [
  { id: 'prep', label: 'Fase de preparación', start: 0, end: 60, wave: 0 },
  { id: 'wave1', label: 'Oleada 1', start: 60, end: 120, wave: 1 },
  { id: 'wave2', label: 'Oleada 2', start: 120, end: 180, wave: 2 },
  { id: 'horde', label: 'Horda final', start: 180, end: 240, wave: 3 },
]

export const MATCH_DURATION = 240

export const PLAYER = {
  maxHp: 100,
  speed: 4, // casillas/s
  radius: 0.32,
  respawnS: 5,
}

export type WeaponId = 'pistol' | 'shotgun' | 'smg' | 'sniper' | 'rocket'
/** Armas pesadas: solo salen de la caja de armamento y gastan su propia munición (heavyAmmo). */
export type HeavyId = 'smg' | 'sniper' | 'rocket'

/** Tipo de proyectil (también lo usa el cliente para dibujarlo). */
export type ProjectileKind = 'bullet' | 'sniper' | 'rocket'

export interface WeaponDef {
  name: string
  damage: number
  /** Disparos por segundo. */
  rate: number
  pellets: number
  spread: number
  usesShell: boolean
  /** Velocidad y alcance del proyectil (casillas/s y casillas). */
  speed: number
  range: number
  projectile: ProjectileKind
  /** Cuántos zombis atraviesa antes de detenerse (1 = el primero que toca). */
  pierce: number
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  pistol: { name: 'Pistola', damage: 15, rate: 3, pellets: 1, spread: 0, usesShell: false, speed: 16, range: 9, projectile: 'bullet', pierce: 1 },
  shotgun: { name: 'Escopeta', damage: 10, rate: 1, pellets: 5, spread: 0.32, usesShell: true, speed: 16, range: 9, projectile: 'bullet', pierce: 1 },
  smg: { name: 'Ametralladora', damage: 8, rate: 8, pellets: 1, spread: 0, usesShell: false, speed: 16, range: 9, projectile: 'bullet', pierce: 1 },
  // Sniper: lento pero de mucho daño y largo alcance; atraviesa hasta 3 zombis.
  sniper: { name: 'Sniper', damage: 70, rate: 0.9, pellets: 1, spread: 0, usesShell: false, speed: 30, range: 18, projectile: 'sniper', pierce: 3 },
  // Lanzacohetes: el cohete explota al chocar o al llegar a su alcance (ver ROCKET).
  rocket: { name: 'Lanzacohetes', damage: 40, rate: 0.7, pellets: 1, spread: 0, usesShell: false, speed: 10, range: 11, projectile: 'rocket', pierce: 1 },
}

/** Barriles explosivos y tanques de combustible del mapa: aguantan unos disparos y explotan (daño a todos cerca). */
export const EXPLOSIVES = {
  barrel: { hp: 30, radius: 1.8, damage: 60 },
  tank: { hp: 120, radius: 2.6, damage: 90 },
} as const
export type ExplosiveKind = keyof typeof EXPLOSIVES

/** Explosión del cohete: daña a todo lo enemigo dentro del radio (casillas). */
export const ROCKET = { radius: 1.6, damage: 55 }

/** Cuchillo automático: con un zombi a esta distancia se ataca cuerpo a cuerpo y no se gasta munición. */
export const KNIFE = { range: 0.95, damage: 25, cooldownS: 0.45, impactS: 0.1 }

/** Proyectil por defecto (torretas). */
export const BULLET = { speed: 16, range: 9 }

export const ZOMBIE = {
  baseHp: 40,
  baseDamage: 10,
  speed: 2.5,
  attackRate: 1,
  radius: 0.32,
  maxAlive: 60,
  spawnWindowS: 25, // la oleada termina de aparecer en este tiempo
  retargetS: 0.5,
}

export type BuildId = 'wall' | 'trap' | 'turret'

export const STRUCTURES = {
  woodWall: { hp: 100, wood: 2 },
  reinforced: { hp: 250, metal: 2 },
  repair: { hp: 50, wood: 1 },
  trap: { metal: 2, dps: 8 },
}

export const CORE_HP = 500
export const MEDKIT_HEAL = 50

export interface Stock {
  wood: number
  metal: number
  medkits: number
  shells: number
}

/** Lo que trae cada jugador al empezar (alcanza para cerrar bien la base). */
export const PLAYER_START: Stock = { wood: 30, metal: 10, medkits: 2, shells: 16 }
/** Extra en la caja de la base al empezar; luego se rellena en cada oleada. */
export const CRATE_START: Stock = { wood: 6, metal: 2, medkits: 1, shells: 6 }
export const CRATE_REFILL: Stock = { wood: 4, metal: 2, medkits: 1, shells: 6 }

export const REWARDS = { woodPerZombie: 1, zombiesPerMetal: 5 }

/** Ventajas de cada superviviente (pequeñas, para no desbalancear el 1v1). */
export interface SurvivorPerks {
  /** Multiplica la velocidad al caminar. */
  speed: number
  /** Se suma a lo que trae al empezar. */
  start: Partial<Stock>
  /** Multiplica la vida que recupera una pared al repararla. */
  repair: number
  /** Multiplica el daño de sus disparos y su cuchillo. */
  damage: number
  /** Multiplica lo que cura un botiquín. */
  heal: number
  /** Multiplica la vida de las paredes que construye. */
  wallHp: number
}

const NO_PERKS: SurvivorPerks = { speed: 1, start: {}, repair: 1, damage: 1, heal: 1, wallHp: 1 }

export const SURVIVOR_PERKS: Record<string, SurvivorPerks> = {
  // Explorador: más rápido y con más cartuchos para salir a pelear.
  explorador: { ...NO_PERKS, speed: 1.15, start: { shells: 8 } },
  // Mecánica: más materiales al empezar y repara el doble.
  mecanica: { ...NO_PERKS, start: { wood: 12, metal: 4 }, repair: 2 },
  // Militar: 15 % más daño con todas sus armas.
  militar: { ...NO_PERKS, damage: 1.15 },
  // Médica: 2 botiquines extra y cada uno cura 50 % más.
  medica: { ...NO_PERKS, start: { medkits: 2 }, heal: 1.5 },
  // Obrero: +8 madera y sus paredes aguantan 50 % más.
  obrero: { ...NO_PERKS, start: { wood: 8 }, wallHp: 1.5 },
}

export const perksOf = (survivor: string): SurvivorPerks => SURVIVOR_PERKS[survivor] ?? NO_PERKS

/** Dificultad de la sala: escala la cantidad, la vida y el daño de los zombis. */
export const DIFFICULTY = {
  'Estándar': { count: 1, hp: 1, damage: 1 },
  'Difícil': { count: 1.5, hp: 1.3, damage: 1.25 },
} as const

export type DifficultyId = keyof typeof DIFFICULTY

export const difficultyOf = (id: string | undefined) => DIFFICULTY[id as DifficultyId] ?? DIFFICULTY['Estándar']

/** Construir con clic/toque: casilla de tu base a esta distancia (en casillas) como máximo. */
export const BUILD_REACH = 4.5

/**
 * Colisión de jugadores y zombis: una caja a la altura de los pies (y = posición, en casillas).
 * El dibujo pone los pies ~0.34 casillas debajo de la posición, así que la caja va de -0.1 a +0.34:
 * se choca donde se ve el personaje, no con su cabeza.
 */
export const BODY = { top: -0.1, bottom: 0.34 }

/** Caja de armamento del centro: hay que quedarse junto a ella sin recibir daño para abrirla. */
export const ARMORY = { openS: 5, radius: 1.6, turrets: 1, medkits: 1 }

/** Arma pesada que trae la caja en cada oleada (oleada 1, 2 y horda final) y su munición. */
export const ARMORY_LOOT: Record<number, { weapon: HeavyId; ammo: number }> = {
  1: { weapon: 'smg', ammo: 120 },
  2: { weapon: 'sniper', ammo: 10 },
  3: { weapon: 'rocket', ammo: 5 },
}

/** Torreta: equilibrada, fácil de destruir, dispara lento y recarga. */
export const TURRET = { hp: 120, range: 6, damage: 9, fireInterval: 0.9, magazine: 8, reloadS: 4 }
