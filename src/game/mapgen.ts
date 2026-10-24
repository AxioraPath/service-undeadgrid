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
} as const

export type ObjectKind = 'tree' | 'rock' | 'car' | 'container' | 'debris' | 'barrel' | 'tires' | 'barrier' | 'water'

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

const OBJECT_TILE: Record<ObjectKind, TileKind> = {
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

// Anillo de carretera alrededor del centro, simétrico por sí mismo.
const RING = { x0: 10, x1: MAP_W - 1 - 10, y0: 5, y1: MAP_H - 1 - 5 }

function buildMap(seed: number): GameMapData {
  const rng = createRng(seed)
  const tiles = new Uint8Array(MAP_W * MAP_H)
  const ground = new Uint8Array(MAP_W * MAP_H)
  const objects: MapObject[] = []

  // 1. Cuadrícula vacía con borde de muros fijos (bosque).
  for (let y = 0; y < MAP_H; y++)
    for (let x = 0; x < MAP_W; x++)
      tiles[idx(x, y)] = x === 0 || y === 0 || x === MAP_W - 1 || y === MAP_H - 1 ? Tile.BORDER : Tile.GRASS

  // 2. Bases 8 × 8 en esquinas opuestas, con núcleo al centro y caja al lado.
  const bases: Record<Slot, Rect> = {
    1: { x: 1, y: 1, w: BASE_SIZE, h: BASE_SIZE },
    2: { x: MAP_W - 1 - BASE_SIZE, y: MAP_H - 1 - BASE_SIZE, w: BASE_SIZE, h: BASE_SIZE },
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

  // Carreteras: anillo central, salida de cada base y ramales hacia las orillas (donde salen zombis).
  const road = (x: number, y: number) => {
    for (const p of [{ x, y }, mirror(x, y)]) {
      tiles[idx(p.x, p.y)] = Tile.ROAD
      ground[idx(p.x, p.y)] = Ground.ROAD
    }
  }
  for (let x = RING.x0; x <= RING.x1; x++) road(x, RING.y0)
  for (let y = RING.y0; y <= RING.y1; y++) road(RING.x0, y)
  for (let x = bases[1].x + bases[1].w; x < RING.x0; x++) road(x, RING.y0) // base 1 → anillo
  const topSpur = Math.floor(MAP_W / 2) - 1
  const sideSpur = Math.floor(MAP_H / 2) - 1
  for (let y = 1; y < RING.y0; y++) road(topSpur, y)
  for (let x = 1; x < RING.x0; x++) road(x, sideSpur)

  // Grava a los lados de la carretera.
  for (let y = 1; y < MAP_H - 1; y++)
    for (let x = 1; x < MAP_W - 1; x++) {
      if (tiles[idx(x, y)] !== Tile.GRASS) continue
      const nearRoad = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => tiles[idx(x + dx, y + dy)] === Tile.ROAD)
      if (nearRoad) ground[idx(x, y)] = Ground.GRAVEL
    }

  // 4. Puntos de aparición de zombis: al final de cada ramal.
  const spawns: Point[] = [{ x: topSpur, y: 1 }, mirror(topSpur, 1), { x: 1, y: sideSpur }, mirror(1, sideSpur)]

  // 3. Obstáculos en espejo para que el mapa sea justo.
  const reserved = (x: number, y: number) =>
    ([1, 2] as Slot[]).some((s) => {
      const b = bases[s]
      return x >= b.x - 1 && x <= b.x + b.w && y >= b.y - 1 && y <= b.y + b.h
    }) || spawns.some((p) => Math.abs(p.x - x) <= 2 && Math.abs(p.y - y) <= 2)

  const fits = (x: number, y: number, w: number, h: number, on: number) => {
    for (let yy = y; yy < y + h; yy++)
      for (let xx = x; xx < x + w; xx++) {
        if (xx <= 0 || yy <= 0 || xx >= MAP_W - 1 || yy >= MAP_H - 1) return false
        if (reserved(xx, yy) || tiles[idx(xx, yy)] !== on) return false
        // No tapar cruces de carretera ni dejar el agua pegada a otra cosa.
        if (on === Tile.ROAD && roadNeighbors(tiles, xx, yy) > 2) return false
      }
    return true
  }

  const place = (kind: ObjectKind, x: number, y: number, w: number, h: number, variant: number, on: number = Tile.GRASS) => {
    const mx = MAP_W - x - w
    const my = MAP_H - y - h
    const overlapsMirror = x < mx + w && mx < x + w && y < my + h && my < y + h
    if (overlapsMirror || !fits(x, y, w, h, on) || !fits(mx, my, w, h, on)) return false
    for (const [ox, oy] of [[x, y], [mx, my]]) {
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

  // Vehículos abandonados sobre la carretera del anillo.
  tryPlace(2, 60, (r) =>
    r.next() < 0.5
      ? place('car', r.int(RING.x0 + 1, RING.x1 - 2), RING.y0, 2, 1, r.int(0, 3), Tile.ROAD)
      : place('car', RING.x0, r.int(RING.y0 + 1, RING.y1 - 2), 1, 2, r.int(0, 3), Tile.ROAD),
  )
  // Lagos (2 × 2 a 3 × 3) dentro del anillo o en los lados.
  tryPlace(1, 60, (r) => place('water', r.int(RING.x0 + 2, RING.x1 - 4), r.int(RING.y0 + 2, RING.y1 - 4), r.int(2, 3), r.int(2, 3), 0))
  tryPlace(1, 60, (r) => place('water', r.int(2, MAP_W - 5), r.int(2, MAP_H - 5), 2, 2, 0))
  tryPlace(2, 80, (r) =>
    r.next() < 0.5 ? place('container', r.int(2, MAP_W - 4), r.int(2, MAP_H - 3), 2, 1, r.int(0, 1)) : place('container', r.int(2, MAP_W - 3), r.int(2, MAP_H - 4), 1, 2, r.int(0, 1)),
  )
  tryPlace(1, 60, (r) => place('barrier', r.int(2, MAP_W - 4), r.int(2, MAP_H - 3), 2, 1, r.int(0, 1)))
  tryPlace(4, 80, (r) => place('rock', r.int(2, MAP_W - 3), r.int(2, MAP_H - 3), 1, 1, r.int(0, 1)))
  tryPlace(6, 100, (r) => place('tree', r.int(2, MAP_W - 3), r.int(2, MAP_H - 3), 1, 1, r.int(0, 2)))
  tryPlace(3, 80, (r) => place('debris', r.int(2, MAP_W - 3), r.int(2, MAP_H - 3), 1, 1, r.int(0, 1)))
  tryPlace(3, 80, (r) => place(r.next() < 0.5 ? 'barrel' : 'tires', r.int(2, MAP_W - 3), r.int(2, MAP_H - 3), 1, 1, 0))

  // Parches de tierra (solo visual, se puede caminar).
  for (let i = 0; i < 6; i++) {
    const x = rng.int(2, MAP_W - 4)
    const y = rng.int(2, MAP_H - 4)
    for (const [ox, oy] of [[x, y], [MAP_W - x - 2, MAP_H - y - 2]])
      for (let yy = oy; yy < oy + 2; yy++)
        for (let xx = ox; xx < ox + 2; xx++) if (tiles[idx(xx, yy)] === Tile.GRASS && ground[idx(xx, yy)] === Ground.GRASS) ground[idx(xx, yy)] = Ground.DIRT
  }

  return { seed, w: MAP_W, h: MAP_H, tiles, ground, objects, bases, cores, crates, spawns }
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
