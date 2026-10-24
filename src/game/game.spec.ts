import { gameInputSchema } from '../contracts/game';
import { MAP_H, MAP_W, PLAYER, STRUCTURES, WEAPONS } from './constants';
import { createMatch, frontTile, previewBuild, quantizeFacing, sanitizeAim, step } from './engine';
import { encodeState } from './snapshot';
import { applyDamage, clamp, heal, lerp, zombieCount, zombieDamage, zombieHp } from './formulas';
import { generateMap, Ground, isMapReachable, Tile } from './mapgen';

/** Pruebas unitarias de las reglas del juego (matriz del PDF: mapa, daño, Zod, interpolación). */
describe('Generador de mapas', () => {
  it(`la cuadrícula mide ${MAP_W} × ${MAP_H} y tiene borde de muros`, () => {
    const map = generateMap(1234);
    expect(map.w).toBe(MAP_W);
    expect(map.h).toBe(MAP_H);
    expect(map.tiles).toHaveLength(MAP_W * MAP_H);
    for (let x = 0; x < MAP_W; x++) {
      expect(map.tiles[x]).toBe(Tile.BORDER);
      expect(map.tiles[(MAP_H - 1) * MAP_W + x]).toBe(Tile.BORDER);
    }
    for (let y = 0; y < MAP_H; y++) {
      expect(map.tiles[y * MAP_W]).toBe(Tile.BORDER);
      expect(map.tiles[y * MAP_W + MAP_W - 1]).toBe(Tile.BORDER);
    }
  });

  it('la misma semilla produce el mismo mapa', () => {
    const a = generateMap(42);
    const b = generateMap(42);
    expect(Array.from(a.tiles)).toEqual(Array.from(b.tiles));
    expect(a.objects).toEqual(b.objects);
  });

  it('el estanque central se cruza por puentes y el mapa es simétrico', () => {
    const map = generateMap(77);
    const bridges = [...map.ground].filter((g) => g === Ground.BRIDGE).length;
    expect(bridges).toBeGreaterThanOrEqual(8);
    for (let y = 0; y < MAP_H; y++)
      for (let x = 0; x < MAP_W; x++)
        expect(map.tiles[y * MAP_W + x]).toBe(map.tiles[(MAP_H - 1 - y) * MAP_W + (MAP_W - 1 - x)]);
  });

  it('las bases y los puntos de zombis son alcanzables (BFS)', () => {
    for (const seed of [1, 7, 99, 2024, 31337]) expect(isMapReachable(generateMap(seed))).toBe(true);
  });
});

describe('Daño y escalado', () => {
  it('cada arma hace el daño de la tabla', () => {
    expect(WEAPONS.pistol.damage).toBe(15);
    expect(WEAPONS.shotgun.damage * WEAPONS.shotgun.pellets).toBe(50);
  });

  it('la vida y el daño de los zombis escalan por oleada', () => {
    expect(zombieHp(1)).toBe(40);
    expect(zombieHp(2)).toBe(50);
    expect(zombieDamage(2)).toBeCloseTo(11.5);
    expect(zombieCount(1)).toBe(8);
    expect(zombieCount(3)).toBe(24);
  });

  it('la vida nunca baja de 0, el botiquín no pasa de 100 y construir sin material se rechaza', () => {
    expect(applyDamage(10, 15.9)).toBe(0);
    expect(heal(80)).toBe(PLAYER.maxHp);
    const s = createMatch({ seed: 5, players: [{ id: 'a', slot: 1, name: 'A', survivor: 'explorador' }] });
    const p = s.players[0];
    p.wood = STRUCTURES.woodWall.wood - 1;
    expect(previewBuild(s, p).ok).toBe(false);
  });
});

describe('Esquemas Zod', () => {
  it('un input válido pasa y uno malformado se rechaza', () => {
    expect(gameInputSchema.safeParse({ seq: 1, up: true, down: false, left: false, right: false, action: false }).success).toBe(true);
    expect(gameInputSchema.safeParse({ seq: -1, up: 'sí' }).success).toBe(false);
  });
});

describe('Interpolación', () => {
  it('con t = 0.5 da el punto medio entre dos posiciones', () => {
    expect(lerp(2, 6, 0.5)).toBe(4);
  });

  it('t se limita entre 0 y 1', () => {
    expect(lerp(2, 6, -1)).toBe(2);
    expect(lerp(2, 6, 3)).toBe(6);
    expect(clamp(5, 0, 1)).toBe(1);
  });
});

describe('Simulación', () => {
  it('editar el cliente no cambia la velocidad: el servidor aplica 4 casillas/s', () => {
    const s = createMatch({ seed: 9, players: [{ id: 'a', slot: 1, name: 'A', survivor: 'explorador' }] });
    const p = s.players[0];
    const y0 = p.y;
    for (let i = 0; i < 6; i++) step(s, { a: { up: false, down: true, left: false, right: false, action: false } }, [], 1 / 30);
    expect(p.y - y0).toBeCloseTo((PLAYER.speed * 6) / 30, 5);
  });
});

describe('Wall orientation', () => {
  const idle = { up: false, down: false, left: false, right: false, action: false };
  const setup = (dirX: number, dirY: number) => {
    const s = createMatch({ seed: 5, players: [{ id: 'a', slot: 1, name: 'A', survivor: 'explorador' }] });
    const p = s.players[0];
    const b = s.map.bases[1];
    Object.assign(p, { dirX, dirY, wood: 50, metal: 50, build: 'wall' });
    // First spot in the base where the front tile is buildable (cores/crate occupy some tiles).
    for (let y = b.y; y < b.y + b.h; y++)
      for (let x = b.x; x < b.x + b.w; x++) {
        Object.assign(p, { x: x + 0.5, y: y + 0.5 });
        if (previewBuild(s, p).ok) return { s, p };
      }
    throw new Error('no buildable spot');
  };
  const press = (s: ReturnType<typeof setup>['s']) => {
    step(s, { a: { ...idle, action: true } }, [], 1 / 30);
    step(s, { a: idle }, [], 1 / 30);
  };

  it.each([
    [0, -1, 'v'],
    [0, 1, 'v'],
    [1, 0, 'h'],
    [-1, 0, 'h'],
  ])('facing (%i,%i) builds an orient=%s wall on the front tile', (dx, dy, orient) => {
    const { s, p } = setup(dx, dy);
    const t = frontTile(p);
    expect(previewBuild(s, p).orient).toBe(orient);
    press(s);
    const st = s.structures.get(t.y * s.map.w + t.x);
    expect(st?.type).toBe('wood');
    expect(st?.orient).toBe(orient);
  });

  it('keeps the orientation when reinforcing, even facing another axis, and exposes it in the snapshot', () => {
    const { s, p } = setup(0, -1);
    const t = frontTile(p);
    press(s);
    // Damage so first press repairs, then reinforce: face sideways at the same tile is not possible, so only check preview.
    const st = s.structures.get(t.y * s.map.w + t.x)!;
    Object.assign(p, { dirX: 0, dirY: -1 });
    press(s);
    expect(st.type).toBe('reinforced');
    expect(st.orient).toBe('v');
    const snap = encodeState(s, false);
    const tuple = snap.structures.find((x) => x[0] === t.y * s.map.w + t.x)!;
    expect(tuple[1]).toBe(1);
    expect(tuple[5]).toBe('v');
    expect(snap.players[0].buildHint?.orient).toBeDefined();
  });

  it('reports the existing wall orientation in the preview of an upgrade', () => {
    const { s, p } = setup(1, 0);
    const t = frontTile(p);
    press(s);
    // Approach the same tile along the vertical axis: preview must still say 'h'.
    Object.assign(p, { x: t.x + 0.5, y: t.y - 0.5, dirX: 0, dirY: 1 });
    expect(frontTile(p)).toEqual(t);
    expect(previewBuild(s, p).orient).toBe('h');
  });

  it('traps carry a neutral h orientation', () => {
    const { s, p } = setup(0, 1);
    p.build = 'trap';
    const t = frontTile(p);
    press(s);
    expect(s.structures.get(t.y * s.map.w + t.x)).toMatchObject({ type: 'trap', orient: 'h' });
  });
});

describe('Mouse aiming', () => {
  const idle = { up: false, down: false, left: false, right: false, action: false };
  const mk = (seed = 5) => {
    const s = createMatch({ seed, players: [{ id: 'a', slot: 1, name: 'A', survivor: 'explorador' }] });
    const p = s.players[0];
    // Open spot in the middle of the player's base, away from walls.
    const b = s.map.bases[1];
    Object.assign(p, { x: b.x + b.w / 2, y: b.y + b.h / 2 });
    return { s, p };
  };
  const fire = (aim?: { x: number; y: number }) => {
    const { s, p } = mk();
    // Leave the base so the action key shoots instead of building.
    p.x = s.map.w / 2;
    p.y = s.map.h / 2;
    step(s, { a: { ...idle, action: true, aim } }, [], 1 / 30);
    return { s, p };
  };
  const angleOf = (b: { vx: number; vy: number }) => Math.atan2(b.vy, b.vx);

  it('aim overrides facing for the bullet direction', () => {
    const { s } = fire({ x: 0, y: -3 });
    expect(s.bullets).toHaveLength(1);
    expect(angleOf(s.bullets[0])).toBeCloseTo(-Math.PI / 2, 5);
  });

  it('non-axis aim is continuous for bullets but quantized for facing', () => {
    const { s, p } = fire({ x: 10, y: 4 });
    expect(angleOf(s.bullets[0])).toBeCloseTo(Math.atan2(4, 10), 5);
    expect(p.dirX).toBeCloseTo(1, 5);
    expect(p.dirY).toBeCloseTo(0, 5);
    expect(p.aim!.x).toBeCloseTo(10 / Math.hypot(10, 4), 5);
  });

  it('absent aim keeps the old behaviour (facing from slot default)', () => {
    const { s, p } = fire(undefined);
    expect(p.aim).toBeNull();
    expect(angleOf(s.bullets[0])).toBeCloseTo(0, 5);
  });

  it('movement keys do not change facing while aiming', () => {
    const { s, p } = mk();
    step(s, { a: { ...idle, up: true, aim: { x: -1, y: 0 } } }, [], 1 / 30);
    expect(p.dirX).toBeCloseTo(-1, 5);
    expect(p.dirY).toBeCloseTo(0, 5);
    step(s, { a: { ...idle, down: true, right: true, aim: { x: -1, y: 0 } } }, [], 1 / 30);
    expect(p.dirX).toBeCloseTo(-1, 5);
    // Without aim movement drives facing again.
    step(s, { a: { ...idle, down: true } }, [], 1 / 30);
    expect(p.dirY).toBeCloseTo(1, 5);
  });

  it('aim drives the build front tile', () => {
    const { s, p } = mk();
    step(s, { a: { ...idle, aim: { x: 0, y: -50 } } }, [], 1 / 30);
    expect(frontTile(p)).toEqual({ x: Math.floor(p.x), y: Math.floor(p.y - PLAYER.radius) - 1 });
  });

  it.each([
    [{ x: NaN, y: 1 }],
    [{ x: 0, y: 0 }],
    [{ x: 0.0005, y: 0 }],
    [{ x: Infinity, y: 0 }],
    [null],
  ])('invalid aim %j is ignored', (aim) => {
    expect(sanitizeAim(aim)).toBeNull();
    const { s, p } = fire(aim as never);
    expect(p.aim).toBeNull();
    expect(angleOf(s.bullets[0])).toBeCloseTo(0, 5);
  });

  it('huge aim is clamped and normalized', () => {
    const a = sanitizeAim({ x: 1e300, y: 0 })!;
    expect(a.x).toBeCloseTo(1, 9);
    expect(Math.hypot(a.x, a.y)).toBeCloseTo(1, 9);
  });

  it('zod keeps valid aim, clamps, and drops invalid aim without rejecting the input', () => {
    const base = { seq: 1, ...idle };
    expect(gameInputSchema.parse({ ...base, aim: { x: 3, y: 4 } }).aim).toEqual({ x: 3, y: 4 });
    expect(gameInputSchema.parse({ ...base, aim: { x: 1e9, y: -1e9 } }).aim).toEqual({ x: 1000, y: -1000 });
    expect(gameInputSchema.parse({ ...base, aim: { x: 0, y: 0 } }).aim).toBeUndefined();
    expect(gameInputSchema.parse({ ...base, aim: { x: null, y: 1 } }).aim).toBeUndefined();
    expect(gameInputSchema.parse({ ...base, aim: 'x' }).aim).toBeUndefined();
    expect(gameInputSchema.parse(base).aim).toBeUndefined();
  });

  it('shotgun pellets are centered on the aim', () => {
    const { s, p } = mk();
    p.x = s.map.w / 2;
    p.y = s.map.h / 2;
    p.weapon = 'shotgun';
    p.shells = 5;
    const aim = { x: -2, y: 1 };
    step(s, { a: { ...idle, action: true, aim } }, [], 1 / 30);
    expect(s.bullets).toHaveLength(WEAPONS.shotgun.pellets);
    const angles = s.bullets.map(angleOf);
    const center = Math.atan2(1, -2);
    expect((Math.min(...angles) + Math.max(...angles)) / 2).toBeCloseTo(center, 5);
    expect(Math.max(...angles) - Math.min(...angles)).toBeCloseTo(WEAPONS.shotgun.spread, 5);
    expect(p.shells).toBe(4);
  });

  it('is deterministic for the same seed and inputs and exposes aim in the snapshot only while aiming', () => {
    const run = () => {
      const { s } = mk(11);
      for (let i = 0; i < 20; i++) step(s, { a: { ...idle, right: i % 2 === 0, action: true, aim: { x: Math.cos(i), y: Math.sin(i) } } }, [], 1 / 30);
      return JSON.stringify(encodeState(s, false));
    };
    expect(run()).toBe(run());
    const { s } = mk();
    step(s, { a: { ...idle, aim: { x: 0, y: 2 } } }, [], 1 / 30);
    expect(encodeState(s, false).players[0]).toMatchObject({ aimX: 0, aimY: 1 });
    step(s, { a: idle }, [], 1 / 30);
    expect('aimX' in encodeState(s, false).players[0]).toBe(false);
  });

  it('quantizeFacing returns the 8 movement directions', () => {
    expect(quantizeFacing(1, 1).x).toBeCloseTo(Math.SQRT1_2, 9);
    const f = quantizeFacing(-0.1, -5);
    expect(f.x).toBeCloseTo(0, 9);
    expect(f.y).toBeCloseTo(-1, 9);
  });
});
