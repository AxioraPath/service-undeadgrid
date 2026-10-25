import {
  ARMORY,
  ARMORY_LOOT,
  BODY,
  KNIFE,
  MEDKIT_HEAL,
  ROCKET,
  BUILD_REACH,
  BULLET,
  PLAYER_START,
  difficultyOf,
  perksOf,
  TICK_RATE,
  TURRET,
  CORE_HP,
  EXPLOSIVES,
  CRATE_REFILL,
  CRATE_START,
  MATCH_DURATION,
  PHASES,
  PLAYER,
  REWARDS,
  STRUCTURES,
  WEAPONS,
  ZOMBIE,
  type BuildId,
  type ExplosiveKind,
  type HeavyId,
  type ProjectileKind,
  type Slot,
  type Stock,
  type WeaponId,
} from './constants'
import { applyDamage, heal, zombieCount, zombieDamage, zombieHp } from './formulas'
import { BUILDINGS, blocksBullets, generateMap, inRect, mapThemeOf, isSolidTileKind, tileAt, tileIndex, Tile, type GameMapData, type Point } from './mapgen'
import { createRng, type Rng } from './rng'

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export interface PlayerInput {
  up: boolean
  down: boolean
  left: boolean
  right: boolean
  action: boolean
  /** Optional aim vector (player -> mouse, world space). Sanitized by the engine; absent = legacy facing. */
  aim?: { x: number; y: number }
  /** Disparar siempre (clic izquierdo / stick de apuntar), también dentro de tu base. */
  fire?: boolean
}

/** Cantidad de ticks simulados (el servidor avanza a paso fijo de 1/30 s). */
export const ticksFor = (seconds: number) => Math.floor(seconds * TICK_RATE + 1e-6)

export type Command =
  | { type: 'hotbar'; slot: 1 | 2 | 3 | 4 | 5 | 6 | 7 }
  | { type: 'crateTake'; item: keyof Stock }
  /** Construir en una casilla concreta de tu base (clic derecho / tocar la casilla). */
  | { type: 'build'; x: number; y: number }

export interface Player {
  id: string
  slot: Slot
  name: string
  survivor: string
  x: number
  y: number
  px: number
  py: number
  dirX: number
  dirY: number
  /** Unit aim direction while the latest input carries a valid aim; null otherwise. */
  aim: { x: number; y: number } | null
  hp: number
  alive: boolean
  respawnAt: number | null
  weapon: WeaponId
  build: BuildId
  wood: number
  metal: number
  medkits: number
  shells: number
  /** Arma pesada de la caja de armamento (ametralladora, sniper o lanzacohetes) y su munición. */
  heavy: HeavyId | null
  heavyAmmo: number
  /** Torretas listas para colocar (solo de la caja de armamento). */
  turrets: number
  kills: number
  zombieKills: number
  deaths: number
  /** Paredes y trampas colocadas o mejoradas (estadística). */
  structuresBuilt: number
  fireCd: number
  prevAction: boolean
  timeAlive: number
  /** Fracciones de daño de trampa acumuladas (8/s se redondea hacia abajo por golpe). */
  trapAcc: number
  /** Solo visual: momento del último disparo y del último daño (tiempo de partida). */
  shotAt: number
  hurtAt: number
  /** Cuchillo: golpe pendiente (se aplica al llegar a `at` si el zombi sigue cerca), último ataque y hacia dónde. */
  knife: { target: number; at: number } | null
  knifeAt: number
  knifeDir: { x: number; y: number }
}

export type ZombieKind = 'normal' | 'fast' | 'tank'

export interface Zombie {
  id: number
  x: number
  y: number
  px: number
  py: number
  hp: number
  maxHp: number
  damage: number
  attackCd: number
  retargetAt: number
  trapAcc: number
  /** Solo visual: el sprite depende de la oleada. */
  kind: ZombieKind
  attackAt: number
  hurtAt: number
  target: { kind: 'player'; id: string } | { kind: 'core'; slot: Slot } | null
}

export interface Bullet {
  id: number
  owner: string
  ownerSlot: Slot
  x: number
  y: number
  px: number
  py: number
  vx: number
  vy: number
  damage: number
  traveled: number
  kind: ProjectileKind
  speed: number
  range: number
  /** Zombis que aún puede atravesar y los que ya tocó. */
  pierce: number
  hits: number[]
  /** Daño de la explosión (solo cohetes). */
  splash: number
}

export type WallOrient = 'h' | 'v'

export interface Structure {
  type: 'wood' | 'reinforced' | 'trap' | 'turret'
  hp: number
  maxHp: number
  owner: Slot
  /** Wall orientation chosen at build time (traps use 'h' and ignore it). */
  orient: WallOrient
  /** Solo torretas: tiros en el cargador, enfriamiento, fin de la recarga y hacia dónde apunta. */
  ammo?: number
  cd?: number
  reloadUntil?: number
  aimX?: number
  aimY?: number
  /** Solo visual: último disparo de la torreta. */
  shotAt?: number
}

/** Barril o tanque de combustible del mapa: casillas que ocupa, centro y vida. */
export interface Prop {
  kind: ExplosiveKind
  hp: number
  maxHp: number
  cells: number[]
  x: number
  y: number
}

/** Caja de armamento del centro del mapa. */
export interface Armory {
  x: number
  y: number
  available: boolean
  /** Segundos acumulados por cada jugador que la está abriendo. */
  progress: Record<string, number>
  openedBy: Slot | null
}

export interface Core {
  slot: Slot
  hp: number
}

export type GameEvent =
  | { type: 'shot'; x: number; y: number; dirX: number; dirY: number; slot: Slot }
  | { type: 'explosion'; x: number; y: number; big?: boolean }
  | { type: 'propDestroyed'; index: number }
  | { type: 'knife'; slot: Slot; x: number; y: number }
  | { type: 'hit'; x: number; y: number }
  | { type: 'zombieDied'; x: number; y: number; kind: ZombieKind }
  | { type: 'playerDied'; slot: Slot; x: number; y: number }
  | { type: 'built'; x: number; y: number; what: string }
  | { type: 'rejected'; slot: Slot; reason: string }
  | { type: 'phase'; label: string }
  | { type: 'coreHit'; slot: Slot }
  | { type: 'armoryOpened'; slot: Slot; weapon: HeavyId }
  | { type: 'armoryReady'; weapon: HeavyId }

export interface MatchResult {
  winner: Slot | 0 // 0 = empate
  reason: string
  durationS: number
  /** true si terminó por tiempo; false si fue por núcleo destruido + enemigo eliminado. */
  byTime: boolean
}

export interface MatchState {
  map: GameMapData
  rng: Rng
  time: number
  phaseIndex: number
  players: Player[]
  zombies: Zombie[]
  bullets: Bullet[]
  structures: Map<number, Structure>
  cores: Record<Slot, Core>
  /** HP of the ENEMY core removed by each slot's player bullets (stat only, never read by the simulation). */
  coreDamageDealt: Record<Slot, number>
  crates: Record<Slot, Stock>
  /** Explosivos del mapa por índice de objeto, la casilla → objeto, y los que ya explotaron. */
  props: Map<number, Prop>
  propAt: Map<number, number>
  destroyedProps: number[]
  /** Multiplicadores de la dificultad elegida en la sala. */
  difficulty: { count: number; hp: number; damage: number }
  armory: Armory
  /** Mapas de distancia (zombis): se recalculan cada medio segundo por objetivo. */
  flows: Map<string, { dist: Float32Array; at: number }>
  spawn: { remaining: number; nextAt: number; interval: number; wave: number; cursor: number }
  nextId: number
  maxWave: number
  /** Ticks simulados desde el inicio. */
  ticks: number
  result: MatchResult | null
  events: GameEvent[]
}

export interface CreateMatchOptions {
  seed: number
  players: { id: string; slot: Slot; name: string; survivor: string }[]
  /** 'Estándar' (por defecto) o 'Difícil'. */
  difficulty?: string
  /** Mapa elegido en la sala (define el tema del generador). */
  mapId?: string
}

// ---------------------------------------------------------------------------
// Creación
// ---------------------------------------------------------------------------

/** Barriles (kind 'barrel') y tanques de combustible (estructura 'tanque-combustible') del mapa. */
function explosivesOf(map: GameMapData) {
  const props = new Map<number, Prop>()
  const propAt = new Map<number, number>()
  map.objects.forEach((o, i) => {
    const kind: ExplosiveKind | null =
      o.kind === 'barrel' ? 'barrel' : o.kind === 'building' && BUILDINGS[o.variant]?.name === 'tanque-combustible' ? 'tank' : null
    if (!kind) return
    const cells: number[] = []
    for (let y = o.y; y < o.y + o.h; y++)
      for (let x = o.x; x < o.x + o.w; x++) if (isSolidTileKind(map.tiles[tileIndex(x, y)])) cells.push(tileIndex(x, y))
    const hp = EXPLOSIVES[kind].hp
    props.set(i, { kind, hp, maxHp: hp, cells, x: o.x + o.w / 2, y: o.y + o.h / 2 })
    for (const c of cells) propAt.set(c, i)
  })
  return { props, propAt, destroyedProps: [] as number[] }
}

const coreCenter = (map: GameMapData, slot: Slot): Point => ({ x: map.cores[slot].x + 1, y: map.cores[slot].y + 1 })

function spawnPoint(map: GameMapData, slot: Slot): Point {
  // Junto al núcleo, del lado que mira al centro del mapa.
  const c = map.cores[slot]
  return slot === 1 ? { x: c.x + 0.5, y: c.y + 2.5 } : { x: c.x + 1.5, y: c.y - 0.5 }
}

export function createMatch({ seed, players, difficulty, mapId }: CreateMatchOptions): MatchState {
  const map = generateMap(seed, mapThemeOf(mapId))
  return {
    map,
    rng: createRng(seed ^ 0x9e3779b9),
    time: 0,
    phaseIndex: 0,
    players: players.map((p) => {
      const sp = spawnPoint(map, p.slot)
      const extra = perksOf(p.survivor).start
      return {
        ...p,
        x: sp.x,
        y: sp.y,
        px: sp.x,
        py: sp.y,
        dirX: p.slot === 1 ? 1 : -1,
        dirY: 0,
        aim: null,
        hp: PLAYER.maxHp,
        alive: true,
        respawnAt: null,
        weapon: 'pistol',
        build: 'wall',
        wood: PLAYER_START.wood + (extra.wood ?? 0),
        metal: PLAYER_START.metal + (extra.metal ?? 0),
        medkits: PLAYER_START.medkits + (extra.medkits ?? 0),
        shells: PLAYER_START.shells + (extra.shells ?? 0),
        heavy: null,
        heavyAmmo: 0,
        knife: null,
        knifeAt: -1,
        knifeDir: { x: 0, y: 1 },
        turrets: 0,
        kills: 0,
        zombieKills: 0,
        deaths: 0,
        structuresBuilt: 0,
        fireCd: 0,
        prevAction: false,
        timeAlive: 0,
        trapAcc: 0,
        shotAt: -1,
        hurtAt: -1,
      }
    }),
    zombies: [],
    bullets: [],
    structures: new Map(),
    cores: { 1: { slot: 1, hp: CORE_HP }, 2: { slot: 2, hp: CORE_HP } },
    coreDamageDealt: { 1: 0, 2: 0 },
    crates: { 1: { ...CRATE_START }, 2: { ...CRATE_START } },
    ...explosivesOf(map),
    difficulty: { ...difficultyOf(difficulty) },
    armory: { x: map.armory.x, y: map.armory.y, available: false, progress: {}, openedBy: null },
    flows: new Map(),
    spawn: { remaining: 0, nextAt: 0, interval: 1, wave: 0, cursor: 0 },
    nextId: 1,
    maxWave: 0,
    ticks: 0,
    result: null,
    events: [],
  }
}

// ---------------------------------------------------------------------------
// Consultas de mapa y colisión
// ---------------------------------------------------------------------------

const isCoreTile = (s: MatchState, x: number, y: number) =>
  ([1, 2] as Slot[]).some((slot) => {
    const c = s.map.cores[slot]
    return s.cores[slot].hp > 0 && x >= c.x && x < c.x + 2 && y >= c.y && y < c.y + 2
  })

const wallAt = (s: MatchState, x: number, y: number) => {
  const st = s.structures.get(tileIndex(x, y))
  return st && st.type !== 'trap' ? st : undefined
}

/** `owner`: el jugador que se mueve atraviesa sus propias paredes y torretas (así nunca queda encerrado). */
export const isBlocked = (s: MatchState, x: number, y: number, owner?: Slot) => {
  if (isSolidTileKind(tileAt(s.map, x, y)) || isCoreTile(s, x, y)) return true
  const w = wallAt(s, x, y)
  return w !== undefined && w.owner !== owner
}

const bulletBlocked = (s: MatchState, x: number, y: number) =>
  blocksBullets(tileAt(s.map, x, y)) || isCoreTile(s, x, y) || wallAt(s, x, y) !== undefined

/** Devuelve la primera casilla sólida que toca el cuerpo (caja a la altura de los pies, ver BODY). */
function overlapSolid(s: MatchState, x: number, y: number, r: number, owner?: Slot): Point | null {
  for (let ty = Math.floor(y + BODY.top); ty <= Math.floor(y + BODY.bottom - 1e-6); ty++)
    for (let tx = Math.floor(x - r); tx <= Math.floor(x + r); tx++) if (isBlocked(s, tx, ty, owner)) return { x: tx, y: ty }
  return null
}

/** Mueve por ejes separados para deslizar contra paredes. Devuelve la casilla que bloqueó, si hubo. */
function moveEntity(s: MatchState, e: { x: number; y: number }, dx: number, dy: number, r: number, owner?: Slot): Point | null {
  let hit: Point | null = null
  if (dx !== 0) {
    const h = overlapSolid(s, e.x + dx, e.y, r, owner)
    if (h) hit = h
    else e.x += dx
  }
  if (dy !== 0) {
    const h = overlapSolid(s, e.x, e.y + dy, r, owner)
    if (h) hit = hit ?? h
    else e.y += dy
  }
  return hit
}

export const playerInOwnBase = (s: MatchState, p: Player) => inRect(s.map.bases[p.slot], Math.floor(p.x), Math.floor(p.y))

export const playerOnOwnCrate = (s: MatchState, p: Player) => {
  const c = s.map.crates[p.slot]
  return p.alive && Math.floor(p.x) === c.x && Math.floor(p.y) === c.y
}

/** Casilla de enfrente según hacia dónde mira (eje dominante): la primera que queda completamente
 * delante del cuerpo, para que el jugador nunca se estorbe a sí mismo al construir. */
export function frontTile(p: Player): Point {
  const r = PLAYER.radius
  if (Math.abs(p.dirX) >= Math.abs(p.dirY)) {
    const x = p.dirX >= 0 ? Math.floor(p.x + r) + 1 : Math.floor(p.x - r) - 1
    return { x, y: Math.floor(p.y) }
  }
  const y = p.dirY >= 0 ? Math.floor(p.y + BODY.bottom - 1e-6) + 1 : Math.floor(p.y + BODY.top) - 1
  return { x: Math.floor(p.x), y }
}

/** Orientation of a wall placed by this player: facing up/down => vertical, left/right => horizontal.
 * Uses the same dominant axis as frontTile. */
export const wallOrientFor = (p: Player): WallOrient => (Math.abs(p.dirX) >= Math.abs(p.dirY) ? 'h' : 'v')

export type BuildPreview = { x: number; y: number; ok: boolean; lacks: boolean; label: string; orient: WallOrient }

/** Qué haría el botón de acción en la casilla de enfrente (orden del documento). */
export function previewBuild(s: MatchState, p: Player): BuildPreview {
  const { x, y } = frontTile(p)
  return previewBuildAt(s, p, x, y, wallOrientFor(p))
}

/** Orientación de una pared nueva colocada con clic/toque: sigue a las paredes vecinas; si no hay, la vista. */
function wallOrientAt(s: MatchState, p: Player, x: number, y: number): WallOrient {
  const wall = (dx: number, dy: number) => {
    const st = s.structures.get(tileIndex(x + dx, y + dy))
    return !!st && (st.type === 'wood' || st.type === 'reinforced')
  }
  if (wall(-1, 0) || wall(1, 0)) return 'h'
  if (wall(0, -1) || wall(0, 1)) return 'v'
  return wallOrientFor(p)
}

/** Qué pasaría al construir en la casilla (x, y): reparar, reforzar o colocar lo seleccionado. */
export function previewBuildAt(s: MatchState, p: Player, x: number, y: number, newOrient: WallOrient): BuildPreview {
  const existing = s.structures.get(tileIndex(x, y))
  // Upgrading/repairing keeps the existing wall's orientation; new walls use the given one.
  const orient: WallOrient = existing && existing.type !== 'trap' ? existing.orient : newOrient
  const need = (has: boolean, label: string): BuildPreview => ({ x, y, ok: has, lacks: !has, label, orient })
  const base = s.map.bases[p.slot]
  const crate = s.map.crates[p.slot]
  if (!inRect(base, x, y) || isCoreTile(s, x, y) || (crate.x === x && crate.y === y))
    return { x, y, ok: false, lacks: false, label: 'No se puede construir aquí', orient }

  const st = s.structures.get(tileIndex(x, y))
  if (st && st.type !== 'trap' && st.type !== 'turret' && st.hp < st.maxHp)
    return need(p.wood >= STRUCTURES.repair.wood, `Reparar pared (${STRUCTURES.repair.wood} madera)`)
  if (st?.type === 'wood')
    return need(p.metal >= STRUCTURES.reinforced.metal, `Reforzar pared (${STRUCTURES.reinforced.metal} metal)`)
  if (st) {
    const label = st.type === 'trap' ? 'Ya hay una trampa' : st.type === 'turret' ? 'Ya hay una torreta' : 'Pared al máximo'
    return { x, y, ok: false, lacks: false, label, orient }
  }

  const occupied =
    p.build !== 'trap' &&
    [...s.players.filter((o) => o.alive), ...s.zombies].some((e) => Math.abs(e.x - (x + 0.5)) < 0.8 && Math.abs(e.y - (y + 0.5)) < 0.8)
  if (occupied) return { x, y, ok: false, lacks: false, label: 'Casilla ocupada', orient }
  if (p.build === 'wall') return need(p.wood >= STRUCTURES.woodWall.wood, `Pared de madera (${STRUCTURES.woodWall.wood} madera)`)
  if (p.build === 'turret') return need(p.turrets > 0, 'Torreta (de la caja de armamento)')
  return need(p.metal >= STRUCTURES.trap.metal, `Trampa de púas (${STRUCTURES.trap.metal} metal)`)
}

const currentPhase = (s: MatchState) => PHASES[s.phaseIndex]
export const isCombat = (s: MatchState) => currentPhase(s).wave > 0

// ---------------------------------------------------------------------------
// Acciones de jugador
// ---------------------------------------------------------------------------

function applyCommand(s: MatchState, p: Player, cmd: Command) {
  if (cmd.type === 'hotbar') {
    if (cmd.slot === 1) p.weapon = 'pistol'
    else if (cmd.slot === 2) p.weapon = 'shotgun'
    else if (cmd.slot === 4) p.build = 'wall'
    else if (cmd.slot === 5) p.build = 'trap'
    else if (cmd.slot === 6) {
      if (p.heavy && p.heavyAmmo > 0) p.weapon = p.heavy
      else s.events.push({ type: 'rejected', slot: p.slot, reason: 'Sin arma pesada: ábrela en la caja del centro' })
    } else if (cmd.slot === 7) {
      if (p.turrets > 0) p.build = 'turret'
      else s.events.push({ type: 'rejected', slot: p.slot, reason: 'Sin torretas: están en la caja del centro' })
    }
    else if (cmd.slot === 3 && p.alive) {
      if (p.medkits <= 0) s.events.push({ type: 'rejected', slot: p.slot, reason: 'No tienes botiquines' })
      else if (p.hp >= PLAYER.maxHp) s.events.push({ type: 'rejected', slot: p.slot, reason: 'Tu vida está llena' })
      else {
        p.medkits--
        p.hp = heal(p.hp, MEDKIT_HEAL * perksOf(p.survivor).heal)
      }
    }
    return
  }
  if (cmd.type === 'build') {
    if (!p.alive || !Number.isInteger(cmd.x) || !Number.isInteger(cmd.y)) return
    if (Math.hypot(cmd.x + 0.5 - p.x, cmd.y + 0.5 - p.y) > BUILD_REACH) {
      s.events.push({ type: 'rejected', slot: p.slot, reason: 'Muy lejos: acércate para construir' })
      return
    }
    applyBuild(s, p, previewBuildAt(s, p, cmd.x, cmd.y, wallOrientAt(s, p, cmd.x, cmd.y)))
    return
  }
  if (cmd.type === 'crateTake') {
    // El servidor es el único que decide quién saca qué: solo desde tu propia caja.
    if (!playerOnOwnCrate(s, p)) return
    const crate = s.crates[p.slot]
    p[cmd.item] += crate[cmd.item]
    crate[cmd.item] = 0
  }
}

function tryBuild(s: MatchState, p: Player) {
  applyBuild(s, p, previewBuild(s, p))
}

function applyBuild(s: MatchState, p: Player, pv: BuildPreview) {
  if (!pv.ok) {
    s.events.push({ type: 'rejected', slot: p.slot, reason: pv.lacks ? `Te falta material: ${pv.label}` : pv.label })
    return
  }
  const key = tileIndex(pv.x, pv.y)
  const st = s.structures.get(key)
  const repaired = !!st && st.type !== 'trap' && st.type !== 'turret' && st.hp < st.maxHp
  if (repaired) {
    p.wood -= STRUCTURES.repair.wood
    st.hp = Math.min(st.maxHp, st.hp + STRUCTURES.repair.hp * perksOf(p.survivor).repair)
  } else if (st?.type === 'wood') {
    p.metal -= STRUCTURES.reinforced.metal
    st.type = 'reinforced'
    const maxHp = Math.round(STRUCTURES.reinforced.hp * perksOf(p.survivor).wallHp)
    st.hp += maxHp - st.maxHp
    st.maxHp = maxHp
  } else if (p.build === 'turret') {
    p.turrets--
    s.structures.set(key, { type: 'turret', hp: TURRET.hp, maxHp: TURRET.hp, owner: p.slot, orient: 'h', ammo: TURRET.magazine, cd: 0, reloadUntil: 0, aimX: 0, aimY: 1 })
    if (p.turrets <= 0) p.build = 'wall'
  } else if (p.build === 'wall') {
    p.wood -= STRUCTURES.woodWall.wood
    const hp = Math.round(STRUCTURES.woodWall.hp * perksOf(p.survivor).wallHp)
    s.structures.set(key, { type: 'wood', hp, maxHp: hp, owner: p.slot, orient: pv.orient })
  } else {
    p.metal -= STRUCTURES.trap.metal
    s.structures.set(key, { type: 'trap', hp: 1, maxHp: 1, owner: p.slot, orient: 'h' })
  }
  if (!repaired) p.structuresBuilt++
  s.events.push({ type: 'built', x: pv.x, y: pv.y, what: pv.label })
}

const AIM_CLAMP = 1000
const AIM_MIN_MAGNITUDE = 1e-3

/** Validates an aim vector: finite, clamped, magnitude > 1e-3. Returns a unit vector or null (treated as absent). */
export function sanitizeAim(aim: unknown): { x: number; y: number } | null {
  if (!aim || typeof aim !== 'object') return null
  const { x, y } = aim as { x?: unknown; y?: unknown }
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return null
  const cx = Math.max(-AIM_CLAMP, Math.min(AIM_CLAMP, x))
  const cy = Math.max(-AIM_CLAMP, Math.min(AIM_CLAMP, y))
  const len = Math.hypot(cx, cy)
  if (!(len > AIM_MIN_MAGNITUDE)) return null
  return { x: cx / len, y: cy / len }
}

/** Quantizes a direction to the same 8 unit directions that movement produces. */
export function quantizeFacing(x: number, y: number): { x: number; y: number } {
  const a = Math.round(Math.atan2(y, x) / (Math.PI / 4)) * (Math.PI / 4)
  const r = (v: number) => (Math.abs(v) < 1e-9 ? 0 : v)
  return { x: r(Math.cos(a)), y: r(Math.sin(a)) }
}

const isHeavy = (w: string): w is HeavyId => w === 'smg' || w === 'sniper' || w === 'rocket'

function shoot(s: MatchState, p: Player) {
  const w = WEAPONS[p.weapon]
  if (isHeavy(p.weapon)) {
    if (p.heavy !== p.weapon || p.heavyAmmo <= 0) {
      p.weapon = 'pistol'
      s.events.push({ type: 'rejected', slot: p.slot, reason: `Sin munición de ${w.name.toLowerCase()}` })
      return
    }
    p.heavyAmmo--
  }
  if (w.usesShell) {
    if (p.shells <= 0) {
      s.events.push({ type: 'rejected', slot: p.slot, reason: 'Sin cartuchos: tómalos de tu caja' })
      p.fireCd = 0.4
      return
    }
    p.shells--
  }
  p.fireCd = 1 / w.rate
  p.shotAt = s.time
  const dmg = perksOf(p.survivor).damage
  // Shots follow the continuous aim when present; otherwise the (quantized) facing, as before.
  const len = Math.hypot(p.dirX, p.dirY) || 1
  const base = p.aim ? Math.atan2(p.aim.y, p.aim.x) : Math.atan2(p.dirY / len, p.dirX / len)
  for (let i = 0; i < w.pellets; i++) {
    const a = w.pellets === 1 ? base : base - w.spread / 2 + (w.spread * i) / (w.pellets - 1)
    const vx = Math.cos(a) * w.speed
    const vy = Math.sin(a) * w.speed
    const x = p.x + Math.cos(a) * 0.45
    const y = p.y + Math.sin(a) * 0.45
    s.bullets.push({
      id: s.nextId++, owner: p.id, ownerSlot: p.slot, x, y, px: x, py: y, vx, vy,
      damage: w.damage * dmg, traveled: 0, kind: w.projectile, speed: w.speed, range: w.range,
      pierce: w.pierce, hits: [], splash: w.projectile === 'rocket' ? ROCKET.damage * dmg : 0,
    })
  }
  s.events.push({ type: 'shot', x: p.x, y: p.y, dirX: Math.cos(base), dirY: Math.sin(base), slot: p.slot })
  // Sin munición: vuelve a la pistola y el arma pesada se pierde.
  if (isHeavy(p.weapon) && p.heavyAmmo <= 0) {
    p.heavy = null
    p.weapon = 'pistol'
  }
}

/** Zombi vivo más cercano dentro del alcance del cuchillo. */
function zombieInKnifeRange(s: MatchState, p: Player): Zombie | null {
  let best: Zombie | null = null
  let bestD = KNIFE.range
  for (const z of s.zombies) {
    const d = Math.hypot(z.x - p.x, z.y - p.y)
    if (z.hp > 0 && d <= bestD) {
      best = z
      bestD = d
    }
  }
  return best
}

/** Atacar: con un zombi pegado usa el cuchillo (sin gastar munición); si no, dispara el arma en mano. */
function attack(s: MatchState, p: Player) {
  if (p.fireCd > 0) return
  const z = zombieInKnifeRange(s, p)
  if (!z) {
    shoot(s, p)
    return
  }
  p.knife = { target: z.id, at: s.time + KNIFE.impactS }
  p.knifeAt = s.time
  p.knifeDir = quantizeFacing(z.x - p.x, z.y - p.y)
  p.fireCd = KNIFE.cooldownS
  s.events.push({ type: 'knife', slot: p.slot, x: p.x, y: p.y })
}

/** El golpe del cuchillo se aplica una sola vez, comprobando otra vez la distancia. */
function resolveKnife(s: MatchState, p: Player) {
  if (!p.knife || s.time < p.knife.at) return
  const id = p.knife.target
  p.knife = null
  const z = s.zombies.find((o) => o.id === id && o.hp > 0)
  if (!z || Math.hypot(z.x - p.x, z.y - p.y) > KNIFE.range + 0.15) return
  z.hp = applyDamage(z.hp, KNIFE.damage * perksOf(p.survivor).damage)
  z.hurtAt = s.time
  s.events.push({ type: 'hit', x: z.x, y: z.y })
  if (z.hp <= 0) rewardZombieKill(s, p.slot)
}

function killPlayer(s: MatchState, p: Player, killerSlot: Slot | null) {
  p.alive = false
  p.hp = 0
  p.deaths++
  p.respawnAt = s.cores[p.slot].hp > 0 ? s.time + PLAYER.respawnS : null
  if (killerSlot && killerSlot !== p.slot) {
    const killer = s.players.find((o) => o.slot === killerSlot)
    if (killer) killer.kills++
  }
  s.events.push({ type: 'playerDied', slot: p.slot, x: p.x, y: p.y })
}

function damagePlayer(s: MatchState, p: Player, dmg: number, sourceSlot: Slot | null) {
  if (!p.alive) return
  p.hurtAt = s.time
  p.hp = applyDamage(p.hp, dmg)
  if (p.hp <= 0) killPlayer(s, p, sourceSlot)
}

function updatePlayer(s: MatchState, p: Player, input: PlayerInput, dt: number) {
  if (!p.alive) {
    p.knife = null
    if (p.respawnAt !== null && s.time >= p.respawnAt) {
      const sp = spawnPoint(s.map, p.slot)
      Object.assign(p, { x: sp.x, y: sp.y, px: sp.x, py: sp.y, hp: PLAYER.maxHp, alive: true, respawnAt: null })
    }
    p.aim = null
    p.prevAction = input.action
    return
  }
  p.timeAlive += dt

  let mx = (input.right ? 1 : 0) - (input.left ? 1 : 0)
  let my = (input.down ? 1 : 0) - (input.up ? 1 : 0)
  // Aim (if valid) drives facing; movement keys then never change it.
  p.aim = sanitizeAim(input.aim)
  if (p.aim) {
    const f = quantizeFacing(p.aim.x, p.aim.y)
    p.dirX = f.x
    p.dirY = f.y
  }
  if (mx !== 0 || my !== 0) {
    const len = Math.hypot(mx, my)
    mx /= len
    my /= len
    if (!p.aim) {
      p.dirX = mx
      p.dirY = my
    }
    // Velocidad máxima validada por el servidor: no depende de los FPS del cliente.
    const speed = PLAYER.speed * perksOf(p.survivor).speed
    moveEntity(s, p, mx * speed * dt, my * speed * dt, PLAYER.radius, p.slot)
  }

  p.fireCd = Math.max(0, p.fireCd - dt)
  resolveKnife(s, p)
  const pressed = input.action && !p.prevAction
  if (input.fire) {
    // Clic izquierdo / stick de apuntar: ataca en cualquier lugar, también dentro de tu base.
    attack(s, p)
  } else if (playerInOwnBase(s, p)) {
    if (pressed) tryBuild(s, p)
  } else if (input.action) {
    attack(s, p)
  }
  p.prevAction = input.action
}

// ---------------------------------------------------------------------------
// Balas, zombis, trampas
// ---------------------------------------------------------------------------

function rewardZombieKill(s: MatchState, slot: Slot) {
  const p = s.players.find((o) => o.slot === slot)
  if (!p) return
  p.zombieKills++
  p.wood += REWARDS.woodPerZombie
  if (p.zombieKills % REWARDS.zombiesPerMetal === 0) p.metal++
}

/** Daña el núcleo enemigo y lo cuenta en la estadística de quien disparó. */
function hitCore(s: MatchState, ownerSlot: Slot, dmg: number) {
  const enemy: Slot = ownerSlot === 1 ? 2 : 1
  if (s.cores[enemy].hp <= 0) return
  const before = s.cores[enemy].hp
  s.cores[enemy].hp = applyDamage(before, dmg)
  s.coreDamageDealt[ownerSlot] += before - s.cores[enemy].hp
  s.events.push({ type: 'coreHit', slot: enemy })
}

/** Explosión del cohete: zombis, y en combate también al rival, sus paredes/torretas/trampas y su núcleo. */
function explode(s: MatchState, b: Bullet) {
  s.events.push({ type: 'explosion', x: b.x, y: b.y })
  const r = ROCKET.radius
  for (const z of s.zombies) {
    if (z.hp <= 0 || Math.hypot(z.x - b.x, z.y - b.y) > r) continue
    z.hp = applyDamage(z.hp, b.splash)
    z.hurtAt = s.time
    if (z.hp <= 0) rewardZombieKill(s, b.ownerSlot)
  }
  for (const [i, prop] of [...s.props]) if (Math.hypot(prop.x - b.x, prop.y - b.y) <= r + 0.5) damageProp(s, i, b.splash, b.ownerSlot)
  if (!isCombat(s)) return
  for (const p of s.players)
    if (p.alive && p.slot !== b.ownerSlot && Math.hypot(p.x - b.x, p.y - b.y) <= r) damagePlayer(s, p, b.splash, b.ownerSlot)
  for (const [key, st] of [...s.structures]) {
    if (st.owner === b.ownerSlot) continue
    const cx = (key % s.map.w) + 0.5
    const cy = Math.floor(key / s.map.w) + 0.5
    if (Math.hypot(cx - b.x, cy - b.y) > r + 0.3) continue
    st.hp = applyDamage(st.hp, b.splash)
    if (st.hp <= 0) s.structures.delete(key)
  }
  const enemy: Slot = b.ownerSlot === 1 ? 2 : 1
  const c = coreCenter(s.map, enemy)
  if (Math.hypot(c.x - b.x, c.y - b.y) <= r + 1) hitCore(s, b.ownerSlot, b.splash)
}

/** Daña un barril o tanque; al llegar a 0 explota y deja libre su casilla. */
function damageProp(s: MatchState, index: number, dmg: number, sourceSlot: Slot | null) {
  const prop = s.props.get(index)
  if (!prop || prop.hp <= 0) return
  prop.hp = applyDamage(prop.hp, dmg)
  if (prop.hp > 0) return
  s.props.delete(index)
  s.destroyedProps.push(index)
  for (const c of prop.cells) {
    s.map.tiles[c] = Tile.GRASS
    s.propAt.delete(c)
  }
  s.events.push({ type: 'propDestroyed', index })
  const ex = EXPLOSIVES[prop.kind]
  blast(s, prop.x, prop.y, ex.radius, ex.damage, sourceSlot, prop.kind === 'tank')
}

/**
 * Explosión del mapa: no distingue equipos. Daña zombis, paredes y torretas de los dos, otros explosivos (en cadena)
 * y, en combate, a los dos jugadores. Las bajas de zombis cuentan para quien la provocó.
 */
function blast(s: MatchState, x: number, y: number, r: number, dmg: number, sourceSlot: Slot | null, big: boolean) {
  s.events.push({ type: 'explosion', x, y, big })
  for (const z of s.zombies) {
    if (z.hp <= 0 || Math.hypot(z.x - x, z.y - y) > r) continue
    z.hp = applyDamage(z.hp, dmg)
    z.hurtAt = s.time
    if (z.hp <= 0 && sourceSlot) rewardZombieKill(s, sourceSlot)
  }
  if (isCombat(s))
    for (const p of s.players) if (p.alive && Math.hypot(p.x - x, p.y - y) <= r) damagePlayer(s, p, dmg, sourceSlot === p.slot ? null : sourceSlot)
  for (const [key, st] of [...s.structures]) {
    const cx = (key % s.map.w) + 0.5
    const cy = Math.floor(key / s.map.w) + 0.5
    if (Math.hypot(cx - x, cy - y) > r + 0.3) continue
    st.hp = applyDamage(st.hp, dmg)
    if (st.hp <= 0) s.structures.delete(key)
  }
  for (const [i, prop] of [...s.props]) if (Math.hypot(prop.x - x, prop.y - y) <= r + 0.5) damageProp(s, i, dmg, sourceSlot)
}

function updateBullets(s: MatchState, dt: number) {
  const pvp = isCombat(s)
  s.bullets = s.bullets.filter((b) => {
    // Sub-pasos de ~0.4 casillas para que las balas rápidas (sniper) no atraviesen nada.
    const steps = Math.max(2, Math.ceil((b.speed * dt) / 0.4))
    for (let i = 0; i < steps; i++) {
      b.x += (b.vx * dt) / steps
      b.y += (b.vy * dt) / steps
      b.traveled += (b.speed * dt) / steps
      const tx = Math.floor(b.x)
      const ty = Math.floor(b.y)

      for (const z of s.zombies) {
        if (z.hp > 0 && !b.hits.includes(z.id) && Math.abs(z.x - b.x) < 0.45 && Math.abs(z.y - b.y) < 0.45) {
          if (b.kind === 'rocket') {
            explode(s, b)
            return false
          }
          z.hp = applyDamage(z.hp, b.damage)
          z.hurtAt = s.time
          s.events.push({ type: 'hit', x: b.x, y: b.y })
          if (z.hp <= 0) rewardZombieKill(s, b.ownerSlot)
          b.hits.push(z.id)
          if (--b.pierce <= 0) return false
        }
      }
      if (pvp) {
        for (const p of s.players) {
          if (p.alive && p.slot !== b.ownerSlot && Math.abs(p.x - b.x) < 0.4 && Math.abs(p.y - b.y) < 0.4) {
            if (b.kind === 'rocket') {
              explode(s, b)
              return false
            }
            damagePlayer(s, p, b.damage, b.ownerSlot)
            s.events.push({ type: 'hit', x: b.x, y: b.y })
            return false
          }
        }
      }
      // Tus paredes y torretas no frenan tus balas: se puede defender la base desde dentro.
      const own = wallAt(s, tx, ty)
      if (own && own.owner === b.ownerSlot && !isSolidTileKind(tileAt(s.map, tx, ty))) continue
      if (bulletBlocked(s, tx, ty)) {
        if (b.kind === 'rocket') {
          explode(s, b)
          return false
        }
        const prop = s.propAt.get(tileIndex(tx, ty))
        if (prop !== undefined) damageProp(s, prop, b.damage, b.ownerSlot)
        const wall = wallAt(s, tx, ty)
        if (wall && wall.owner !== b.ownerSlot && pvp) {
          wall.hp = applyDamage(wall.hp, b.damage)
          if (wall.hp <= 0) s.structures.delete(tileIndex(tx, ty))
        }
        const enemy: Slot = b.ownerSlot === 1 ? 2 : 1
        const c = s.map.cores[enemy]
        if (pvp && tx >= c.x && tx < c.x + 2 && ty >= c.y && ty < c.y + 2) hitCore(s, b.ownerSlot, b.damage)
        s.events.push({ type: 'hit', x: b.x, y: b.y })
        return false
      }
    }
    if (b.traveled < b.range) return true
    if (b.kind === 'rocket') explode(s, b)
    return false
  })
}

/** Solo visual (mismas reglas): oleada 1 normales, oleada 2 rápidos, horda final mezclada con tanques. */
function zombieKindFor(wave: number, n: number): ZombieKind {
  if (wave === 1) return 'normal'
  if (wave === 2) return n % 3 === 0 ? 'normal' : 'fast'
  return (['normal', 'fast', 'tank'] as const)[n % 3]
}

function spawnZombies(s: MatchState) {
  const sp = s.spawn
  while (sp.remaining > 0 && s.time >= sp.nextAt && s.zombies.length < ZOMBIE.maxAlive) {
    const point = s.map.spawns[sp.cursor++ % s.map.spawns.length]
    const x = point.x + 0.5 + (s.rng.next() - 0.5) * 0.6
    const y = point.y + 0.5 + (s.rng.next() - 0.5) * 0.6
    const hp = Math.round(zombieHp(sp.wave) * s.difficulty.hp)
    s.zombies.push({ id: s.nextId++, x, y, px: x, py: y, hp, maxHp: hp, damage: zombieDamage(sp.wave) * s.difficulty.damage, attackCd: 0, retargetAt: 0, trapAcc: 0, target: null, kind: zombieKindFor(sp.wave, sp.cursor), attackAt: -1, hurtAt: -1 })
    sp.remaining--
    sp.nextAt += sp.interval
  }
}

function targetPoint(s: MatchState, z: Zombie): Point | null {
  if (!z.target) return null
  if (z.target.kind === 'core') return coreCenter(s.map, z.target.slot)
  const id = z.target.id
  const p = s.players.find((o) => o.id === id)
  return p && p.alive ? { x: p.x, y: p.y } : null
}

function chooseTarget(s: MatchState, z: Zombie) {
  let best: Zombie['target'] = null
  let bestD = Infinity
  for (const p of s.players) {
    if (!p.alive) continue
    const d = Math.hypot(p.x - z.x, p.y - z.y)
    if (d < bestD) {
      bestD = d
      best = { kind: 'player', id: p.id }
    }
  }
  for (const slot of [1, 2] as Slot[]) {
    if (s.cores[slot].hp <= 0) continue
    const c = coreCenter(s.map, slot)
    const d = Math.hypot(c.x - z.x, c.y - z.y)
    if (d < bestD) {
      bestD = d
      best = { kind: 'core', slot }
    }
  }
  z.target = best
}

// ---- Caminos de los zombis (mapa de distancias por objetivo) ----

const FLOW_REFRESH_S = 0.5
/** Atravesar una pared de jugador cuesta como rodear varias casillas: prefieren rodear, pero la rompen si conviene. */
const WALL_COST = 6

/** Dijkstra desde las casillas objetivo; agua, árboles y edificios no se pueden cruzar. */
function computeFlow(s: MatchState, goals: Point[]): Float32Array {
  const w = s.map.w
  const h = s.map.h
  const dist = new Float32Array(w * h).fill(Infinity)
  const heap: [number, number][] = []
  const push = (d: number, i: number) => {
    heap.push([d, i])
    let c = heap.length - 1
    while (c > 0) {
      const parent = (c - 1) >> 1
      if (heap[parent][0] <= heap[c][0]) break
      ;[heap[parent], heap[c]] = [heap[c], heap[parent]]
      c = parent
    }
  }
  const pop = () => {
    const top = heap[0]
    const last = heap.pop()!
    if (heap.length) {
      heap[0] = last
      let c = 0
      for (;;) {
        const l = c * 2 + 1
        const r = l + 1
        let m = c
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r
        if (m === c) break
        ;[heap[m], heap[c]] = [heap[c], heap[m]]
        c = m
      }
    }
    return top
  }
  for (const g of goals) {
    if (g.x < 0 || g.y < 0 || g.x >= w || g.y >= h) continue
    dist[g.y * w + g.x] = 0
    push(0, g.y * w + g.x)
  }
  while (heap.length) {
    const [d, i] = pop()
    if (d > dist[i]) continue
    const x = i % w
    const y = (i / w) | 0
    for (const [ddx, ddy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + ddx
      const ny = y + ddy
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
      if (isSolidTileKind(tileAt(s.map, nx, ny))) continue
      const st = s.structures.get(ny * w + nx)
      const cost = st && st.type !== 'trap' ? WALL_COST : 1
      const nd = d + cost
      const ni = ny * w + nx
      if (nd < dist[ni]) {
        dist[ni] = nd
        push(nd, ni)
      }
    }
  }
  return dist
}

function flowFor(s: MatchState, z: Zombie): Float32Array | null {
  if (!z.target) return null
  let key: string
  let goals: Point[]
  if (z.target.kind === 'core') {
    const c = s.map.cores[z.target.slot]
    key = `core${z.target.slot}`
    goals = [{ x: c.x, y: c.y }, { x: c.x + 1, y: c.y }, { x: c.x, y: c.y + 1 }, { x: c.x + 1, y: c.y + 1 }]
  } else {
    const id = z.target.id
    const p = s.players.find((o) => o.id === id)
    if (!p || !p.alive) return null
    key = `p:${id}`
    goals = [{ x: Math.floor(p.x), y: Math.floor(p.y) }]
  }
  const cached = s.flows.get(key)
  if (cached && s.time - cached.at < FLOW_REFRESH_S) return cached.dist
  const dist = computeFlow(s, goals)
  s.flows.set(key, { dist, at: s.time })
  return dist
}

/** Dirección hacia la casilla vecina más cercana al objetivo; cerca del objetivo va directo. */
function pathDirection(s: MatchState, z: Zombie, t: Point, ux: number, uy: number): Point {
  const flow = flowFor(s, z)
  if (!flow) return { x: ux, y: uy }
  const w = s.map.w
  const tx = Math.floor(z.x)
  const ty = Math.floor(z.y)
  const here = flow[ty * w + tx]
  if (!Number.isFinite(here) || here <= 1.5 || Math.hypot(t.x - z.x, t.y - z.y) < 1.5) return { x: ux, y: uy }
  const free = (x: number, y: number) => !isSolidTileKind(tileAt(s.map, x, y)) && !wallAt(s, x, y)
  let best = here
  let bx = 0
  let by = 0
  for (const [ddx, ddy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const nx = tx + ddx
    const ny = ty + ddy
    if (nx < 0 || ny < 0 || nx >= w || ny >= s.map.h) continue
    // Sin cortar esquinas: en diagonal, las dos casillas laterales deben estar libres.
    if (ddx && ddy && (!free(tx + ddx, ty) || !free(tx, ty + ddy))) continue
    const d = flow[ny * w + nx] + (ddx && ddy ? 0.4 : 0)
    if (d < best) {
      best = d
      bx = ddx
      by = ddy
    }
  }
  if (bx === 0 && by === 0) return { x: ux, y: uy }
  const cx = tx + bx + 0.5 - z.x
  const cy = ty + by + 0.5 - z.y
  const len = Math.hypot(cx, cy) || 1
  return { x: cx / len, y: cy / len }
}

function updateZombies(s: MatchState, dt: number) {
  for (const z of s.zombies) {
    z.attackCd = Math.max(0, z.attackCd - dt)
    if (s.time >= z.retargetAt || !targetPoint(s, z)) {
      chooseTarget(s, z)
      z.retargetAt = s.time + ZOMBIE.retargetS
    }
    const t = targetPoint(s, z)
    if (!t || !z.target) continue

    const dx = t.x - z.x
    const dy = t.y - z.y
    const dist = Math.hypot(dx, dy)
    const reach = z.target.kind === 'core' ? 1.45 : 0.75

    if (dist <= reach) {
      if (z.attackCd <= 0) {
        z.attackCd = 1 / ZOMBIE.attackRate
        z.attackAt = s.time
        if (z.target.kind === 'core') {
          const core = s.cores[z.target.slot]
          core.hp = applyDamage(core.hp, z.damage)
          s.events.push({ type: 'coreHit', slot: z.target.slot })
        } else {
          const id = z.target.id
          const p = s.players.find((o) => o.id === id)
          if (p) damagePlayer(s, p, z.damage, null)
        }
      }
      continue
    }

    // Sigue el camino más corto (rodea agua, árboles y edificios); si una pared estorba, la golpea.
    const dir = pathDirection(s, z, t, dx / dist, dy / dist)
    const step = ZOMBIE.speed * dt
    const hit = moveEntity(s, z, dir.x * step, dir.y * step, ZOMBIE.radius)
    if (hit) {
      const wall = wallAt(s, hit.x, hit.y)
      if (wall && z.attackCd <= 0) {
        z.attackCd = 1 / ZOMBIE.attackRate
        z.attackAt = s.time
        wall.hp = applyDamage(wall.hp, z.damage)
        s.events.push({ type: 'hit', x: hit.x + 0.5, y: hit.y + 0.5 })
        if (wall.hp <= 0) s.structures.delete(tileIndex(hit.x, hit.y))
      }
    }
  }

  // Separación simple para que no se apilen.
  for (let i = 0; i < s.zombies.length; i++)
    for (let j = i + 1; j < s.zombies.length; j++) {
      const a = s.zombies[i]
      const b = s.zombies[j]
      const dx = b.x - a.x
      const dy = b.y - a.y
      const d = Math.hypot(dx, dy)
      if (d > 0 && d < 0.6) {
        const push = (0.6 - d) / 2
        const ux = (dx / d) * push
        const uy = (dy / d) * push
        if (!overlapSolid(s, a.x - ux, a.y - uy, ZOMBIE.radius)) {
          a.x -= ux
          a.y -= uy
        }
        if (!overlapSolid(s, b.x + ux, b.y + uy, ZOMBIE.radius)) {
          b.x += ux
          b.y += uy
        }
      }
    }

  for (const z of s.zombies) if (z.hp <= 0) s.events.push({ type: 'zombieDied', x: z.x, y: z.y, kind: z.kind })
  s.zombies = s.zombies.filter((z) => z.hp > 0)
}

function updateTraps(s: MatchState, dt: number) {
  const dmg = STRUCTURES.trap.dps * dt
  const tick = (e: { trapAcc: number }) => {
    e.trapAcc += dmg
    const whole = Math.floor(e.trapAcc)
    e.trapAcc -= whole
    return whole
  }
  for (const [key, st] of s.structures) {
    if (st.type !== 'trap') continue
    const tx = key % s.map.w
    const ty = Math.floor(key / s.map.w)
    const on = (e: { x: number; y: number }) => Math.floor(e.x) === tx && Math.floor(e.y) === ty
    for (const z of s.zombies) {
      if (!on(z)) continue
      const d = tick(z)
      if (d > 0 && z.hp > 0) {
        z.hp = applyDamage(z.hp, d)
        z.hurtAt = s.time
        if (z.hp <= 0) rewardZombieKill(s, st.owner)
      }
    }
    if (!isCombat(s)) continue
    for (const p of s.players) {
      if (!p.alive || p.slot === st.owner || !on(p)) continue
      const d = tick(p)
      if (d > 0) damagePlayer(s, p, d, st.owner)
    }
  }
}

// ---------------------------------------------------------------------------
// Caja de armamento y torretas
// ---------------------------------------------------------------------------

/** Arma pesada de la caja según la oleada: ametralladora, sniper y en la horda el lanzacohetes. */
export const armoryLoot = (s: MatchState) => ARMORY_LOOT[Math.min(3, Math.max(1, currentPhase(s).wave))]

/** Quien se queda junto a la caja 5 s sin recibir daño se lleva el arma pesada, una torreta y un botiquín. */
function updateArmory(s: MatchState, dt: number) {
  const a = s.armory
  if (!a.available) return
  for (const p of s.players) {
    const near = p.alive && Math.hypot(p.x - a.x, p.y - a.y) <= ARMORY.radius
    if (!near || p.hurtAt === s.time) {
      delete a.progress[p.id]
      continue
    }
    a.progress[p.id] = (a.progress[p.id] ?? 0) + dt
    if (a.progress[p.id] >= ARMORY.openS) {
      const loot = armoryLoot(s)
      if (p.heavy === loot.weapon) p.heavyAmmo += loot.ammo
      else {
        p.heavy = loot.weapon
        p.heavyAmmo = loot.ammo
      }
      p.turrets += ARMORY.turrets
      p.medkits += ARMORY.medkits
      p.weapon = loot.weapon
      a.available = false
      a.openedBy = p.slot
      a.progress = {}
      s.events.push({ type: 'armoryOpened', slot: p.slot, weapon: loot.weapon })
      return
    }
  }
}

/** Torretas: apuntan al zombi (o rival) más cercano en rango; disparan lento y recargan. */
function updateTurrets(s: MatchState, dt: number) {
  const pvp = isCombat(s)
  for (const [key, st] of s.structures) {
    if (st.type !== 'turret') continue
    st.cd = Math.max(0, (st.cd ?? 0) - dt)
    if ((st.ammo ?? 0) <= 0) {
      if (s.time < (st.reloadUntil ?? 0)) continue
      st.ammo = TURRET.magazine
    }
    if (st.cd > 0) continue
    const cx = (key % s.map.w) + 0.5
    const cy = Math.floor(key / s.map.w) + 0.5
    let target: Point | null = null
    let best = TURRET.range
    for (const z of s.zombies) {
      const d = Math.hypot(z.x - cx, z.y - cy)
      if (z.hp > 0 && d < best) {
        best = d
        target = z
      }
    }
    if (!target && pvp)
      for (const p of s.players) {
        const d = Math.hypot(p.x - cx, p.y - cy)
        if (p.alive && p.slot !== st.owner && d < best) {
          best = d
          target = p
        }
      }
    if (!target) continue
    const len = Math.hypot(target.x - cx, target.y - cy) || 1
    const ux = (target.x - cx) / len
    const uy = (target.y - cy) / len
    const x = cx + ux * 0.55
    const y = cy + uy * 0.55
    s.bullets.push({
      id: s.nextId++, owner: `turret:${key}`, ownerSlot: st.owner, x, y, px: x, py: y, vx: ux * BULLET.speed, vy: uy * BULLET.speed,
      damage: TURRET.damage, traveled: 0, kind: 'bullet', speed: BULLET.speed, range: BULLET.range, pierce: 1, hits: [], splash: 0,
    })
    st.shotAt = s.time
    s.events.push({ type: 'shot', x: cx, y: cy, dirX: ux, dirY: uy, slot: st.owner })
    st.aimX = ux
    st.aimY = uy
    st.cd = TURRET.fireInterval
    st.ammo = (st.ammo ?? 0) - 1
    if (st.ammo <= 0) st.reloadUntil = s.time + TURRET.reloadS
  }
}

// ---------------------------------------------------------------------------
// Fases y victoria
// ---------------------------------------------------------------------------

function updatePhase(s: MatchState) {
  let idx = PHASES.findIndex((ph) => s.time >= ph.start && s.time < ph.end)
  if (idx === -1) idx = PHASES.length - 1
  if (idx === s.phaseIndex) return
  s.phaseIndex = idx
  const ph = PHASES[idx]
  s.events.push({ type: 'phase', label: ph.label })
  if (ph.wave > 0) {
    s.maxWave = ph.wave
    // La caja de armamento del centro se rellena en cada oleada.
    s.armory.available = true
    s.armory.openedBy = null
    s.armory.progress = {}
    s.events.push({ type: 'armoryReady', weapon: armoryLoot(s).weapon })
    for (const slot of [1, 2] as Slot[]) {
      const crate = s.crates[slot]
      for (const k of Object.keys(CRATE_REFILL) as (keyof Stock)[]) crate[k] += CRATE_REFILL[k]
    }
    const count = Math.round(zombieCount(ph.wave) * s.difficulty.count)
    s.spawn = {
      remaining: s.spawn.remaining + count,
      nextAt: s.time,
      interval: ZOMBIE.spawnWindowS / count,
      wave: ph.wave,
      cursor: s.spawn.cursor,
    }
  }
}

function checkVictory(s: MatchState) {
  const eliminated = (slot: Slot) => {
    const p = s.players.find((o) => o.slot === slot)
    return s.cores[slot].hp <= 0 && (!p || (!p.alive && p.respawnAt === null))
  }
  const out1 = eliminated(1)
  const out2 = eliminated(2)
  if (out1 || out2) {
    s.result = {
      winner: out1 && out2 ? 0 : out1 ? 2 : 1,
      reason: 'Núcleo rival destruido y enemigo eliminado',
      durationS: s.time,
      byTime: false,
    }
    return
  }
  if (s.time >= MATCH_DURATION) {
    const h1 = s.cores[1].hp
    const h2 = s.cores[2].hp
    if (h1 !== h2) {
      s.result = { winner: h1 > h2 ? 1 : 2, reason: 'Tiempo agotado: núcleo con más vida', durationS: MATCH_DURATION, byTime: true }
      return
    }
    const k = (slot: Slot) => {
      const p = s.players.find((o) => o.slot === slot)
      return p ? p.kills + p.zombieKills : 0
    }
    const k1 = k(1)
    const k2 = k(2)
    s.result = {
      winner: k1 === k2 ? 0 : k1 > k2 ? 1 : 2,
      reason: k1 === k2 ? 'Empate total' : 'Empate de núcleos: más kills',
      durationS: MATCH_DURATION,
      byTime: true,
    }
  }
}

// ---------------------------------------------------------------------------
// Tick
// ---------------------------------------------------------------------------

const IDLE: PlayerInput = { up: false, down: false, left: false, right: false, action: false }

/** Un tick del servidor: inputs → movimiento → balas y zombis → construcción/trampas → fase y victoria. */
export function step(s: MatchState, inputs: Record<string, PlayerInput>, commands: { playerId: string; cmd: Command }[], dt: number) {
  if (s.result) return
  for (const p of s.players) {
    p.px = p.x
    p.py = p.y
  }
  for (const z of s.zombies) {
    z.px = z.x
    z.py = z.y
  }
  for (const b of s.bullets) {
    b.px = b.x
    b.py = b.y
  }

  for (const { playerId, cmd } of commands) {
    const p = s.players.find((o) => o.id === playerId)
    if (p) applyCommand(s, p, cmd)
  }

  s.time += dt
  s.ticks++
  updatePhase(s)

  for (const p of s.players) updatePlayer(s, p, inputs[p.id] ?? IDLE, dt)
  updateBullets(s, dt)
  spawnZombies(s)
  updateZombies(s, dt)
  updateTraps(s, dt)
  updateTurrets(s, dt)
  updateArmory(s, dt)
  for (const z of s.zombies) if (z.hp <= 0) s.events.push({ type: 'zombieDied', x: z.x, y: z.y, kind: z.kind })
  s.zombies = s.zombies.filter((z) => z.hp > 0)

  checkVictory(s)
}

export const phaseOf = (s: MatchState) => currentPhase(s)
export const coreRectCenter = coreCenter
export { Tile }
