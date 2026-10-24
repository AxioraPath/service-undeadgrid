// Valores de la sección 5 del documento. Todo lo de src/game es TS puro (sin DOM)
// para moverlo a shared/ cuando exista el servidor autoritativo.

export const TILE = 32
// Tamaño tomado de los mapas de referencia (Diseños/Mapas): ~1408 × 1024 px con casillas de 32 px.
export const MAP_W = 44
export const MAP_H = 32
export const BASE_SIZE = 8

export const TICK_RATE = 30
export const TICK_DT = 1 / TICK_RATE

export type Slot = 1 | 2

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

export type WeaponId = 'pistol' | 'shotgun'

export const WEAPONS: Record<WeaponId, { name: string; damage: number; rate: number; pellets: number; spread: number; usesShell: boolean }> = {
  pistol: { name: 'Pistola', damage: 15, rate: 3, pellets: 1, spread: 0, usesShell: false },
  shotgun: { name: 'Escopeta', damage: 10, rate: 1, pellets: 5, spread: 0.32, usesShell: true },
}

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

export type BuildId = 'wall' | 'trap'

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

export const CRATE_START: Stock = { wood: 10, metal: 4, medkits: 2, shells: 12 }
export const CRATE_REFILL: Stock = { wood: 4, metal: 2, medkits: 1, shells: 6 }

export const REWARDS = { woodPerZombie: 1, zombiesPerMetal: 5 }
