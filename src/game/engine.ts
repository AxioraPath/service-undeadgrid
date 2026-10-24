import {
  BULLET,
  TICK_RATE,
  CORE_HP,
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
  type Slot,
  type Stock,
  type WeaponId,
} from './constants'
import { applyDamage, heal, zombieCount, zombieDamage, zombieHp } from './formulas'
import { blocksBullets, generateMap, inRect, isSolidTileKind, tileAt, tileIndex, Tile, type GameMapData, type Point } from './mapgen'
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
}

/** Cantidad de ticks simulados (el servidor avanza a paso fijo de 1/30 s). */
export const ticksFor = (seconds: number) => Math.floor(seconds * TICK_RATE + 1e-6)

export type Command =
  | { type: 'hotbar'; slot: 1 | 2 | 3 | 4 | 5 }
  | { type: 'crateTake'; item: keyof Stock }

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
  hp: number
  alive: boolean
  respawnAt: number | null
  weapon: WeaponId
  build: BuildId
  wood: number
  metal: number
  medkits: number
  shells: number
  kills: number
  zombieKills: number
  deaths: number
  fireCd: number
  prevAction: boolean
  timeAlive: number
  /** Fracciones de daño de trampa acumuladas (8/s se redondea hacia abajo por golpe). */
  trapAcc: number
  /** Solo visual: momento del último disparo y del último daño (tiempo de partida). */
  shotAt: number
  hurtAt: number
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
}

export interface Structure {
  type: 'wood' | 'reinforced' | 'trap'
  hp: number
  maxHp: number
  owner: Slot
}

export interface Core {
  slot: Slot
  hp: number
}

export type GameEvent =
  | { type: 'shot'; x: number; y: number; dirX: number; dirY: number; slot: Slot }
  | { type: 'hit'; x: number; y: number }
  | { type: 'zombieDied'; x: number; y: number; kind: ZombieKind }
  | { type: 'playerDied'; slot: Slot; x: number; y: number }
  | { type: 'built'; x: number; y: number; what: string }
  | { type: 'rejected'; slot: Slot; reason: string }
  | { type: 'phase'; label: string }
  | { type: 'coreHit'; slot: Slot }

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
  crates: Record<Slot, Stock>
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
}

// ---------------------------------------------------------------------------
// Creación
// ---------------------------------------------------------------------------

const coreCenter = (map: GameMapData, slot: Slot): Point => ({ x: map.cores[slot].x + 1, y: map.cores[slot].y + 1 })

function spawnPoint(map: GameMapData, slot: Slot): Point {
  // Junto al núcleo, del lado que mira al centro del mapa.
  const c = map.cores[slot]
  return slot === 1 ? { x: c.x + 0.5, y: c.y + 2.5 } : { x: c.x + 1.5, y: c.y - 0.5 }
}

export function createMatch({ seed, players }: CreateMatchOptions): MatchState {
  const map = generateMap(seed)
  return {
    map,
    rng: createRng(seed ^ 0x9e3779b9),
    time: 0,
    phaseIndex: 0,
    players: players.map((p) => {
      const sp = spawnPoint(map, p.slot)
      return {
        ...p,
        x: sp.x,
        y: sp.y,
        px: sp.x,
        py: sp.y,
        dirX: p.slot === 1 ? 1 : -1,
        dirY: 0,
        hp: PLAYER.maxHp,
        alive: true,
        respawnAt: null,
        weapon: 'pistol',
        build: 'wall',
        wood: 0,
        metal: 0,
        medkits: 0,
        shells: 0,
        kills: 0,
        zombieKills: 0,
        deaths: 0,
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
    crates: { 1: { ...CRATE_START }, 2: { ...CRATE_START } },
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

export const isBlocked = (s: MatchState, x: number, y: number) =>
  isSolidTileKind(tileAt(s.map, x, y)) || isCoreTile(s, x, y) || wallAt(s, x, y) !== undefined

const bulletBlocked = (s: MatchState, x: number, y: number) =>
  blocksBullets(tileAt(s.map, x, y)) || isCoreTile(s, x, y) || wallAt(s, x, y) !== undefined

/** Devuelve la primera casilla sólida que toca un círculo (como caja) en esa posición. */
function overlapSolid(s: MatchState, x: number, y: number, r: number): Point | null {
  for (let ty = Math.floor(y - r); ty <= Math.floor(y + r); ty++)
    for (let tx = Math.floor(x - r); tx <= Math.floor(x + r); tx++) if (isBlocked(s, tx, ty)) return { x: tx, y: ty }
  return null
}

/** Mueve por ejes separados para deslizar contra paredes. Devuelve la casilla que bloqueó, si hubo. */
function moveEntity(s: MatchState, e: { x: number; y: number }, dx: number, dy: number, r: number): Point | null {
  let hit: Point | null = null
  if (dx !== 0) {
    const h = overlapSolid(s, e.x + dx, e.y, r)
    if (h) hit = h
    else e.x += dx
  }
  if (dy !== 0) {
    const h = overlapSolid(s, e.x, e.y + dy, r)
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
  const y = p.dirY >= 0 ? Math.floor(p.y + r) + 1 : Math.floor(p.y - r) - 1
  return { x: Math.floor(p.x), y }
}

export type BuildPreview = { x: number; y: number; ok: boolean; lacks: boolean; label: string }

/** Qué haría el botón de acción en la casilla de enfrente (orden del documento). */
export function previewBuild(s: MatchState, p: Player): BuildPreview {
  const { x, y } = frontTile(p)
  const need = (has: boolean, label: string): BuildPreview => ({ x, y, ok: has, lacks: !has, label })
  const base = s.map.bases[p.slot]
  const crate = s.map.crates[p.slot]
  if (!inRect(base, x, y) || isCoreTile(s, x, y) || (crate.x === x && crate.y === y))
    return { x, y, ok: false, lacks: false, label: 'No se puede construir aquí' }

  const st = s.structures.get(tileIndex(x, y))
  if (st && st.type !== 'trap' && st.hp < st.maxHp)
    return need(p.wood >= STRUCTURES.repair.wood, `Reparar pared (${STRUCTURES.repair.wood} madera)`)
  if (st?.type === 'wood')
    return need(p.metal >= STRUCTURES.reinforced.metal, `Reforzar pared (${STRUCTURES.reinforced.metal} metal)`)
  if (st) return { x, y, ok: false, lacks: false, label: st.type === 'trap' ? 'Ya hay una trampa' : 'Pared al máximo' }

  const occupied =
    p.build === 'wall' &&
    [...s.players.filter((o) => o.alive), ...s.zombies].some((e) => Math.abs(e.x - (x + 0.5)) < 0.8 && Math.abs(e.y - (y + 0.5)) < 0.8)
  if (occupied) return { x, y, ok: false, lacks: false, label: 'Casilla ocupada' }
  if (p.build === 'wall') return need(p.wood >= STRUCTURES.woodWall.wood, `Pared de madera (${STRUCTURES.woodWall.wood} madera)`)
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
    else if (cmd.slot === 3 && p.alive) {
      if (p.medkits <= 0) s.events.push({ type: 'rejected', slot: p.slot, reason: 'No tienes botiquines' })
      else if (p.hp >= PLAYER.maxHp) s.events.push({ type: 'rejected', slot: p.slot, reason: 'Tu vida está llena' })
      else {
        p.medkits--
        p.hp = heal(p.hp)
      }
    }
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
  const pv = previewBuild(s, p)
  if (!pv.ok) {
    s.events.push({ type: 'rejected', slot: p.slot, reason: pv.lacks ? `Te falta material: ${pv.label}` : pv.label })
    return
  }
  const key = tileIndex(pv.x, pv.y)
  const st = s.structures.get(key)
  if (st && st.type !== 'trap' && st.hp < st.maxHp) {
    p.wood -= STRUCTURES.repair.wood
    st.hp = Math.min(st.maxHp, st.hp + STRUCTURES.repair.hp)
  } else if (st?.type === 'wood') {
    p.metal -= STRUCTURES.reinforced.metal
    st.type = 'reinforced'
    st.hp += STRUCTURES.reinforced.hp - st.maxHp
    st.maxHp = STRUCTURES.reinforced.hp
  } else if (p.build === 'wall') {
    p.wood -= STRUCTURES.woodWall.wood
    s.structures.set(key, { type: 'wood', hp: STRUCTURES.woodWall.hp, maxHp: STRUCTURES.woodWall.hp, owner: p.slot })
  } else {
    p.metal -= STRUCTURES.trap.metal
    s.structures.set(key, { type: 'trap', hp: 1, maxHp: 1, owner: p.slot })
  }
  s.events.push({ type: 'built', x: pv.x, y: pv.y, what: pv.label })
}

function shoot(s: MatchState, p: Player) {
  const w = WEAPONS[p.weapon]
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
  const len = Math.hypot(p.dirX, p.dirY) || 1
  const base = Math.atan2(p.dirY / len, p.dirX / len)
  for (let i = 0; i < w.pellets; i++) {
    const a = w.pellets === 1 ? base : base - w.spread / 2 + (w.spread * i) / (w.pellets - 1)
    const vx = Math.cos(a) * BULLET.speed
    const vy = Math.sin(a) * BULLET.speed
    const x = p.x + Math.cos(a) * 0.45
    const y = p.y + Math.sin(a) * 0.45
    s.bullets.push({ id: s.nextId++, owner: p.id, ownerSlot: p.slot, x, y, px: x, py: y, vx, vy, damage: w.damage, traveled: 0 })
  }
  s.events.push({ type: 'shot', x: p.x, y: p.y, dirX: Math.cos(base), dirY: Math.sin(base), slot: p.slot })
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
    if (p.respawnAt !== null && s.time >= p.respawnAt) {
      const sp = spawnPoint(s.map, p.slot)
      Object.assign(p, { x: sp.x, y: sp.y, px: sp.x, py: sp.y, hp: PLAYER.maxHp, alive: true, respawnAt: null })
    }
    p.prevAction = input.action
    return
  }
  p.timeAlive += dt

  let mx = (input.right ? 1 : 0) - (input.left ? 1 : 0)
  let my = (input.down ? 1 : 0) - (input.up ? 1 : 0)
  if (mx !== 0 || my !== 0) {
    const len = Math.hypot(mx, my)
    mx /= len
    my /= len
    p.dirX = mx
    p.dirY = my
    // Velocidad máxima validada por el servidor: no depende de los FPS del cliente.
    moveEntity(s, p, mx * PLAYER.speed * dt, my * PLAYER.speed * dt, PLAYER.radius)
  }

  p.fireCd = Math.max(0, p.fireCd - dt)
  const pressed = input.action && !p.prevAction
  if (playerInOwnBase(s, p)) {
    if (pressed) tryBuild(s, p)
  } else if (input.action && p.fireCd <= 0) {
    shoot(s, p)
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

function updateBullets(s: MatchState, dt: number) {
  const pvp = isCombat(s)
  s.bullets = s.bullets.filter((b) => {
    const steps = 2
    for (let i = 0; i < steps; i++) {
      b.x += (b.vx * dt) / steps
      b.y += (b.vy * dt) / steps
      b.traveled += (BULLET.speed * dt) / steps
      const tx = Math.floor(b.x)
      const ty = Math.floor(b.y)

      for (const z of s.zombies) {
        if (z.hp > 0 && Math.abs(z.x - b.x) < 0.45 && Math.abs(z.y - b.y) < 0.45) {
          z.hp = applyDamage(z.hp, b.damage)
          z.hurtAt = s.time
          s.events.push({ type: 'hit', x: b.x, y: b.y })
          if (z.hp <= 0) rewardZombieKill(s, b.ownerSlot)
          return false
        }
      }
      if (pvp) {
        for (const p of s.players) {
          if (p.alive && p.slot !== b.ownerSlot && Math.abs(p.x - b.x) < 0.4 && Math.abs(p.y - b.y) < 0.4) {
            damagePlayer(s, p, b.damage, b.ownerSlot)
            s.events.push({ type: 'hit', x: b.x, y: b.y })
            return false
          }
        }
      }
      if (bulletBlocked(s, tx, ty)) {
        const wall = wallAt(s, tx, ty)
        if (wall && wall.owner !== b.ownerSlot && pvp) {
          wall.hp = applyDamage(wall.hp, b.damage)
          if (wall.hp <= 0) s.structures.delete(tileIndex(tx, ty))
        }
        const enemy: Slot = b.ownerSlot === 1 ? 2 : 1
        const c = s.map.cores[enemy]
        if (pvp && s.cores[enemy].hp > 0 && tx >= c.x && tx < c.x + 2 && ty >= c.y && ty < c.y + 2) {
          s.cores[enemy].hp = applyDamage(s.cores[enemy].hp, b.damage)
          s.events.push({ type: 'coreHit', slot: enemy })
        }
        s.events.push({ type: 'hit', x: b.x, y: b.y })
        return false
      }
    }
    return b.traveled < BULLET.range
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
    const hp = zombieHp(sp.wave)
    s.zombies.push({ id: s.nextId++, x, y, px: x, py: y, hp, maxHp: hp, damage: zombieDamage(sp.wave), attackCd: 0, retargetAt: 0, trapAcc: 0, target: null, kind: zombieKindFor(sp.wave, sp.cursor), attackAt: -1, hurtAt: -1 })
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

    // Línea recta hacia el objetivo; si una pared estorba, la golpea hasta romperla.
    const step = ZOMBIE.speed * dt
    const hit = moveEntity(s, z, (dx / dist) * step, (dy / dist) * step, ZOMBIE.radius)
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
    for (const slot of [1, 2] as Slot[]) {
      const crate = s.crates[slot]
      for (const k of Object.keys(CRATE_REFILL) as (keyof Stock)[]) crate[k] += CRATE_REFILL[k]
    }
    const count = zombieCount(ph.wave)
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
  for (const z of s.zombies) if (z.hp <= 0) s.events.push({ type: 'zombieDied', x: z.x, y: z.y, kind: z.kind })
  s.zombies = s.zombies.filter((z) => z.hp > 0)

  checkVictory(s)
}

export const phaseOf = (s: MatchState) => currentPhase(s)
export const coreRectCenter = coreCenter
export { Tile }
