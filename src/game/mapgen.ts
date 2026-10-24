import { BASE_SIZE, MAP_H, MAP_W, type Slot } from './constants'
import { createRng, type Rng } from './rng'

/** Capa de colisión: qué ocupa cada casilla. */
export const Tile = {
  GRASS: 0,
  BORDER: 1,
  ROCK: 2,
  CAR: 3,
  DEBRIS: 4,
  BASE: 5,
  ROAD: 6,
  WATER: 7,
  TREE: 8,
  CONTAINER: 9,
  BARREL: 10,
  BARRIER: 11,
} as const

export type TileKind = (typeof Tile)[keyof typeof Tile]

/** Capa de suelo (solo visual). */
export const Ground = {
  GRASS: 0,
  DIRT: 1,
  ROAD: 2,
  BASE: 3,
  WATER: 4,
  GRAVEL: 5,
  /** Puente de madera sobre el agua (se camina). */
  BRIDGE: 6,
  /** Plazoleta de concreto en el centro del mapa. */
  PLAZA: 7,
} as const

/** `lamp` es solo decoración (no bloquea); el resto ocupa sus casillas. `building` usa BUILDINGS[variant]. */
export type ObjectKind = 'tree' | 'rock' | 'car' | 'container' | 'debris' | 'barrel' | 'tires' | 'barrier' | 'water' | 'lamp' | 'building'

/** Estructuras del paquete de arte: nombre del sprite y casillas que ocupan (colisión = lo que se ve). */
export const BUILDINGS = [
  { name: 'almacen', w: 3, h: 3 },
  { name: 'tienda', w: 3, h: 2 },
  { name: 'torre-vigilancia', w: 2, h: 3 },
  { name: 'torre-agua', w: 2, h: 3 },
  { name: 'generador', w: 2, h: 2 },
  { name: 'tanque-combustible', w: 3, h: 2 },
  { name: 'muro-piedra-h', w: 2, h: 1 },
  { name: 'valla-madera', w: 2, h: 1 },
  { name: 'sacos-h', w: 2, h: 1 },
] as const
const BIG_BUILDINGS = [0, 1, 2, 3, 4, 5]
const SMALL_STRUCTURES = [6, 7, 8]

export interface MapObject {
  kind: ObjectKind
  x: number
  y: number
  w: number
  h: number
  variant: number
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Point {
  x: number
  y: number
}

export interface GameMapData {
  seed: number
  w: number
  h: number
  tiles: Uint8Array
  ground: Uint8Array
  objects: MapObject[]
  bases: Record<Slot, Rect>
  /** Casilla superior izquierda del núcleo (ocupa 2 × 2). */
  cores: Record<Slot, Point>
  crates: Record<Slot, Point>
  spawns: Point[]
  /** Punto (en casillas) de la caja de armamento, en el centro de la plazoleta. */
  armory: Point
}

const SOLID_TILES = new Set<number>([
  Tile.BORDER, Tile.ROCK, Tile.CAR, Tile.DEBRIS, Tile.WATER, Tile.TREE, Tile.CONTAINER, Tile.BARREL, Tile.BARRIER,
])

export const isSolidTileKind = (k: number) => SOLID_TILES.has(k)

/** El agua frena el paso pero no las balas. */
export const blocksBullets = (k: number) => SOLID_TILES.has(k) && k !== Tile.WATER

export const inRect = (r: Rect, x: number, y: number) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h

const idx = (x: number, y: number) => y * MAP_W + x

/** Paso 5: BFS desde la base 1; deben alcanzarse la base 2 y todos los puntos de zombis. */
export function isMapReachable(map: GameMapData): boolean {
  const blocked = (x: number, y: number) =>
    isSolidTileKind(map.tiles[idx(x, y)]) ||
    ([1, 2] as Slot[]).some((s) => x >= map.cores[s].x && x < map.cores[s].x + 2 && y >= map.cores[s].y && y < map.cores[s].y + 2)

  const start = { x: map.bases[1].x + 1, y: map.bases[1].y + 1 }
  const seen = new Uint8Array(MAP_W * MAP_H)
  const queue: Point[] = [start]
  seen[idx(start.x, start.y)] = 1
  while (queue.length) {
    const { x, y } = queue.shift()!
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue
      if (seen[idx(nx, ny)] || blocked(nx, ny)) continue
      seen[idx(nx, ny)] = 1
      queue.push({ x: nx, y: ny })
    }
  }
  const targets = [{ x: map.bases[2].x + 1, y: map.bases[2].y + 1 }, ...map.spawns]
  return targets.every((t) => seen[idx(t.x, t.y)] === 1)
}

const OBJECT_TILE: Record<Exclude<ObjectKind, 'lamp'>, TileKind> = {
  building: Tile.CONTAINER,
  tree: Tile.TREE,
  rock: Tile.ROCK,
  car: Tile.CAR,
  container: Tile.CONTAINER,
  debris: Tile.DEBRIS,
  barrel: Tile.BARREL,
  tires: Tile.BARREL,
  barrier: Tile.BARRIER,
  water: Tile.WATER,
}

/** Punto simétrico (rotación de 180°): lo que hay en un lado del mapa aparece igual en el otro. */
const mirror = (x: number, y: number): Point => ({ x: MAP_W - 1 - x, y: MAP_H - 1 - y })

/** Grosor del bosque que rodea el mapa. */
const FOREST = 2

/**
 * Trazado tomado de las referencias (Diseños/Mapas): bases en esquinas opuestas, una
 * plazoleta abierta en el centro (ahí está la caja de armamento) rodeada por cuatro
 * estanques con pasillos anchos entre ellos, carreteras desde cada base y hasta las 4
 * orillas (donde salen los zombis), estructuras y obstáculos repartidos con la semilla,
 * siempre en espejo.
 */
const CX = Math.floor(MAP_W / 2) - 1 // columna de la carretera vertical (mitad superior)
const CY = Math.floor(MAP_H / 2) - 1 // fila de la carretera horizontal (mitad izquierda)
const PLAZA = { x: CX - 1, y: CY - 1, w: 4, h: 4 } // simétrica por sí misma
/** Estanque de arriba a la izquierda y de arriba a la derecha (los otros dos son su espejo). */
const PONDS = [
  { x: CX - 8, y: CY - 6, w: 5, h: 4 },
  { x: CX + 5, y: CY - 6, w: 5, h: 4 },
]
/** Zona que se deja libre alrededor de la plazoleta para que el centro no quede cerrado. */
const CENTER_CLEAR = { x: CX - 4, y: CY - 3, w: 10, h: 8 }

function buildMap(seed: number): GameMapData {
  const rng = createRng(seed)
  const tiles = new Uint8Array(MAP_W * MAP_H)
  const ground = new Uint8Array(MAP_W * MAP_H)
  const objects: MapObject[] = []

  // 1. Cuadrícula vacía con borde de bosque.
  for (let y = 0; y < MAP_H; y++)
    for (let x = 0; x < MAP_W; x++) {
      const edge = x < FOREST || y < FOREST || x >= MAP_W - FOREST || y >= MAP_H - FOREST
      tiles[idx(x, y)] = edge ? Tile.BORDER : Tile.GRASS
    }

  // 2. Bases 8 × 8 en esquinas opuestas, con núcleo al centro y caja al lado.
  const bases: Record<Slot, Rect> = {
    1: { x: FOREST + 1, y: FOREST + 1, w: BASE_SIZE, h: BASE_SIZE },
    2: { x: MAP_W - FOREST - 1 - BASE_SIZE, y: MAP_H - FOREST - 1 - BASE_SIZE, w: BASE_SIZE, h: BASE_SIZE },
  }
  const cores: Record<Slot, Point> = {
    1: { x: bases[1].x + 3, y: bases[1].y + 3 },
    2: { x: bases[2].x + 3, y: bases[2].y + 3 },
  }
  // Una casilla libre entre núcleo y caja para poder pisarla; la de J2 va en espejo.
  const crates: Record<Slot, Point> = {
    1: { x: cores[1].x + 3, y: cores[1].y },
    2: { x: cores[2].x - 2, y: cores[2].y + 1 },
  }
  for (const s of [1, 2] as Slot[]) {
    const b = bases[s]
    for (let y = b.y; y < b.y + b.h; y++)
      for (let x = b.x; x < b.x + b.w; x++) {
        tiles[idx(x, y)] = Tile.BASE
        ground[idx(x, y)] = Ground.BASE
      }
  }

  // Estanques alrededor del centro (cada uno con su espejo).
  for (const pond of PONDS)
    for (let y = pond.y; y < pond.y + pond.h; y++)
      for (let x = pond.x; x < pond.x + pond.w; x++)
        for (const q of [{ x, y }, mirror(x, y)]) {
          tiles[idx(q.x, q.y)] = Tile.WATER
          ground[idx(q.x, q.y)] = Ground.WATER
        }

  // Carreteras (se marcan con su espejo).
  const road = (x: number, y: number) => {
    for (const q of [{ x, y }, mirror(x, y)]) {
      tiles[idx(q.x, q.y)] = Tile.ROAD
      ground[idx(q.x, q.y)] = Ground.ROAD
    }
  }
  for (let y = FOREST; y < PLAZA.y; y++) road(CX, y) // de la orilla de arriba a la plazoleta
  for (let x = FOREST; x < PLAZA.x; x++) road(x, CY) // de la orilla izquierda a la plazoleta
  const b1 = bases[1]
  for (let x = b1.x + b1.w; x < CX; x++) road(x, b1.y + 4) // base 1 → carretera vertical
  for (let y = b1.y + b1.h; y < CY; y++) road(b1.x + 4, y) // base 1 → carretera horizontal

  // Plazoleta abierta en el centro (se camina; ahí está la caja de armamento).
  for (let y = PLAZA.y; y < PLAZA.y + PLAZA.h; y++)
    for (let x = PLAZA.x; x < PLAZA.x + PLAZA.w; x++) {
      tiles[idx(x, y)] = Tile.ROAD
      ground[idx(x, y)] = Ground.PLAZA
    }
  const armory: Point = { x: PLAZA.x + PLAZA.w / 2, y: PLAZA.y + PLAZA.h / 2 }

  // 4. Puntos de aparición de zombis: donde las carreteras tocan el bosque.
  const spawns: Point[] = [{ x: CX, y: FOREST }, mirror(CX, FOREST), { x: FOREST, y: CY }, mirror(FOREST, CY)]

  // 3. Obstáculos en espejo para que el mapa sea justo.
  const reserved = (x: number, y: number) =>
    ([1, 2] as Slot[]).some((s) => {
      const b = bases[s]
      return x >= b.x - 1 && x <= b.x + b.w && y >= b.y - 1 && y <= b.y + b.h
    }) ||
    spawns.some((p) => Math.abs(p.x - x) <= 2 && Math.abs(p.y - y) <= 2) ||
    inRect(CENTER_CLEAR, x, y)

  const fits = (x: number, y: number, w: number, h: number, on: number) => {
    for (let yy = y; yy < y + h; yy++)
      for (let xx = x; xx < x + w; xx++) {
        if (xx < FOREST || yy < FOREST || xx >= MAP_W - FOREST || yy >= MAP_H - FOREST) return false
        const i = idx(xx, yy)
        if (reserved(xx, yy) || tiles[i] !== on) return false
        if (on === Tile.ROAD && (ground[i] !== Ground.ROAD || roadNeighbors(tiles, xx, yy) > 2)) return false
      }
    return true
  }

  /** Deja un pasillo de 1 casilla libre alrededor (para que las estructuras no tapen caminos). */
  const clearAround = (x: number, y: number, w: number, h: number) => {
    for (let yy = y - 1; yy <= y + h; yy++)
      for (let xx = x - 1; xx <= x + w; xx++) {
        if (xx >= x && xx < x + w && yy >= y && yy < y + h) continue
        const t = tiles[idx(xx, yy)]
        if (t !== Tile.GRASS && t !== Tile.ROAD && t !== Tile.BORDER) return false
      }
    return true
  }

  const place = (kind: ObjectKind, x: number, y: number, w: number, h: number, variant: number, on: number = Tile.GRASS, margin = false) => {
    const mx = MAP_W - x - w
    const my = MAP_H - y - h
    const overlapsMirror = x < mx + w && mx < x + w && y < my + h && my < y + h
    if (overlapsMirror || !fits(x, y, w, h, on) || !fits(mx, my, w, h, on)) return false
    if (margin && (!clearAround(x, y, w, h) || !clearAround(mx, my, w, h))) return false
    for (const [ox, oy] of [[x, y], [mx, my]]) {
      if (kind !== 'lamp')
        for (let yy = oy; yy < oy + h; yy++)
          for (let xx = ox; xx < ox + w; xx++) {
            tiles[idx(xx, yy)] = OBJECT_TILE[kind]
            if (kind === 'water') ground[idx(xx, yy)] = Ground.WATER
          }
      objects.push({ kind, x: ox, y: oy, w, h, variant })
    }
    return true
  }

  const tryPlace = (times: number, attempts: number, fn: (r: Rng) => boolean) => {
    let placed = 0
    for (let i = 0; i < attempts && placed < times; i++) if (fn(rng)) placed++
  }
  const anyX = (r: Rng, w = 1) => r.int(FOREST, MAP_W - FOREST - w)
  const anyY = (r: Rng, h = 1) => r.int(FOREST, MAP_H - FOREST - h)

  // Estanques en las esquinas libres (arriba a la derecha y su espejo abajo a la izquierda).
  tryPlace(1, 40, (r) => place('water', r.int(MAP_W - FOREST - 9, MAP_W - FOREST - 6), r.int(FOREST + 1, FOREST + 3), r.int(4, 5), 3, 0))
  // Estructuras grandes (almacén, tienda, torres, generador, tanque) y pequeñas (muros, vallas, sacos).
  tryPlace(4, 300, (r) => {
    const v = r.pick(BIG_BUILDINGS)
    const b = BUILDINGS[v]
    return place('building', anyX(r, b.w), anyY(r, b.h), b.w, b.h, v, Tile.GRASS, true)
  })
  tryPlace(6, 300, (r) => {
    const v = r.pick(SMALL_STRUCTURES)
    const b = BUILDINGS[v]
    return place('building', anyX(r, b.w), anyY(r, b.h), b.w, b.h, v, Tile.GRASS, true)
  })
  // Vehículos abandonados sobre las carreteras (nunca en puentes ni cruces).
  tryPlace(3, 80, (r) =>
    r.next() < 0.5
      ? place('car', r.int(FOREST + 3, CX - 3), CY, 2, 1, r.int(0, 3), Tile.ROAD)
      : place('car', CX, r.int(FOREST + 3, CY - 4), 1, 2, r.int(0, 3), Tile.ROAD),
  )
  tryPlace(4, 120, (r) => (r.next() < 0.5 ? place('container', anyX(r, 2), anyY(r), 2, 1, r.int(0, 1)) : place('container', anyX(r), anyY(r, 2), 1, 2, r.int(0, 1))))
  tryPlace(3, 100, (r) => place('barrier', anyX(r, 2), anyY(r), 2, 1, r.int(0, 1)))
  tryPlace(10, 200, (r) => place('rock', anyX(r), anyY(r), 1, 1, r.int(0, 1)))
  // Arboledas de 2 a 3 árboles juntos, como en las referencias.
  tryPlace(9, 200, (r) => {
    const x = anyX(r, 2)
    const y = anyY(r, 2)
    const ok = place('tree', x, y, 1, 1, r.int(0, 2))
    if (ok) {
      place('tree', x + 1, y, 1, 1, r.int(0, 2))
      if (r.next() < 0.6) place('tree', x, y + 1, 1, 1, r.int(0, 2))
    }
    return ok
  })
  tryPlace(8, 200, (r) => place('debris', anyX(r), anyY(r), 1, 1, r.int(0, 1)))
  tryPlace(5, 120, (r) => place(r.next() < 0.5 ? 'barrel' : 'tires', anyX(r), anyY(r), 1, 1, 0))

  // Faroles a los lados de las carreteras (decoración) y alrededor de la plazoleta.
  for (let y = FOREST + 2; y < PLAZA.y - 4; y += 4) place('lamp', CX - 1, y, 1, 1, 0, Tile.GRASS)
  for (let x = FOREST + 2; x < PLAZA.x - 4; x += 5) place('lamp', x, CY + 1, 1, 1, 0, Tile.GRASS)
  for (const [x, y] of [[PLAZA.x - 1, PLAZA.y - 1], [PLAZA.x + PLAZA.w, PLAZA.y - 1]]) {
    objects.push({ kind: 'lamp', x, y, w: 1, h: 1, variant: 0 })
    const m = mirror(x, y)
    objects.push({ kind: 'lamp', x: m.x, y: m.y, w: 1, h: 1, variant: 0 })
  }

  // Parches de tierra (solo visual, se puede caminar).
  for (let i = 0; i < 10; i++) {
    const x = rng.int(FOREST, MAP_W - FOREST - 2)
    const y = rng.int(FOREST, MAP_H - FOREST - 2)
    for (const [ox, oy] of [[x, y], [MAP_W - x - 2, MAP_H - y - 2]])
      for (let yy = oy; yy < oy + 2; yy++)
        for (let xx = ox; xx < ox + 2; xx++) if (tiles[idx(xx, yy)] === Tile.GRASS && ground[idx(xx, yy)] === Ground.GRASS) ground[idx(xx, yy)] = Ground.DIRT
  }

  return { seed, w: MAP_W, h: MAP_H, tiles, ground, objects, bases, cores, crates, spawns, armory }
}

function roadNeighbors(tiles: Uint8Array, x: number, y: number) {
  return [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => tiles[idx(x + dx, y + dy)] === Tile.ROAD).length
}

/** Genera un mapa válido; si el BFS falla, prueba con la siguiente semilla. */
export function generateMap(seed: number): GameMapData {
  for (let attempt = 0; attempt < 50; attempt++) {
    const map = buildMap(seed + attempt)
    if (isMapReachable(map)) return map
  }
  throw new Error(`No se pudo generar un mapa válido desde la semilla ${seed}`)
}

export const tileAt = (map: GameMapData, x: number, y: number) =>
  x < 0 || y < 0 || x >= map.w || y >= map.h ? Tile.BORDER : map.tiles[idx(x, y)]

export const tileIndex = idx
