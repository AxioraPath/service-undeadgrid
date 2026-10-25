import { gameInputSchema } from '../contracts/game';
import { ARMORY, ARMORY_LOOT, BODY, EXPLOSIVES, KNIFE, ROCKET, SURVIVOR_PERKS, MAP_H, MAP_W, PLAYER, PLAYER_START, STRUCTURES, TURRET, WEAPONS, perksOf } from './constants';
import { createMatch, frontTile, playerInOwnBase, previewBuild, quantizeFacing, sanitizeAim, step, type Command } from './engine';
import { encodeState } from './snapshot';
import { applyDamage, clamp, heal, lerp, zombieCount, zombieDamage, zombieHp } from './formulas';
import { BUILDINGS, generateMap, Ground, isMapReachable, mapThemeOf, Tile } from './mapgen';

/** Pruebas unitarias de las reglas del juego (matriz del PDF: mapa, daño, Zod, interpolación). */

/**
 * Simetría de punto: los objetos están en espejo y todas las casillas fuera de las estructuras también.
 * Dentro de una estructura la colisión sale del sprite (que no se gira), así que se compara con su espejo sin girar.
 */
function expectSymmetric(map: ReturnType<typeof generateMap>) {
  const key = (o: { kind: string; x: number; y: number; w: number; h: number; variant: number }) => `${o.kind}:${o.x},${o.y},${o.w},${o.h},${o.variant}`;
  const keys = new Set(map.objects.map(key));
  for (const o of map.objects) expect(keys.has(key({ ...o, x: MAP_W - o.x - o.w, y: MAP_H - o.y - o.h }))).toBe(true);
  const inBuilding = new Uint8Array(MAP_W * MAP_H);
  for (const o of map.objects)
    if (o.kind === 'building') for (let y = o.y; y < o.y + o.h; y++) for (let x = o.x; x < o.x + o.w; x++) inBuilding[y * MAP_W + x] = 1;
  for (let y = 0; y < MAP_H; y++)
    for (let x = 0; x < MAP_W; x++)
      if (!inBuilding[y * MAP_W + x]) expect(map.tiles[y * MAP_W + x]).toBe(map.tiles[(MAP_H - 1 - y) * MAP_W + (MAP_W - 1 - x)]);
  for (const o of map.objects) {
    if (o.kind !== 'building') continue;
    const mx = MAP_W - o.x - o.w;
    const my = MAP_H - o.y - o.h;
    for (let y = 0; y < o.h; y++)
      for (let x = 0; x < o.w; x++) expect(map.tiles[(o.y + y) * MAP_W + o.x + x]).toBe(map.tiles[(my + y) * MAP_W + mx + x]);
  }
}

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

  it('el centro es una plazoleta abierta con la caja de armamento y el mapa es simétrico', () => {
    const map = generateMap(77);
    expect([...map.ground].filter((g) => g === Ground.PLAZA)).toHaveLength(16);
    expect(map.armory).toEqual({ x: MAP_W / 2, y: MAP_H / 2 });
    expect(map.objects.some((o) => o.kind === 'building')).toBe(true);
    expectSymmetric(map);
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
    expect(p.y - y0).toBeCloseTo((PLAYER.speed * perksOf('explorador').speed * 6) / 30, 5);
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

describe('Combate nuevo: disparo, construcción, caja de armamento y torretas', () => {
  const idle = { up: false, down: false, left: false, right: false, action: false };
  // Superviviente sin ventajas, para medir las reglas base.
  const one = () => createMatch({ seed: 5, players: [{ id: 'a', slot: 1, name: 'A', survivor: 'base' }] });
  const run = (s: ReturnType<typeof one>, input: object, ticks: number, cmds: { playerId: string; cmd: Command }[] = []) => {
    for (let i = 0; i < ticks; i++) step(s, { a: { ...idle, ...input } }, i === 0 ? cmds : [], 1 / 30);
  };

  it('empieza con recursos suficientes para cerrar la base', () => {
    const p = one().players[0];
    expect(p).toMatchObject(PLAYER_START);
  });

  it('con `fire` dispara aunque esté dentro de su base', () => {
    const s = one();
    expect(playerInOwnBase(s, s.players[0])).toBe(true);
    run(s, { fire: true }, 1);
    expect(s.bullets.length).toBeGreaterThan(0);
    expect(s.structures.size).toBe(0);
  });

  it('construye con clic/toque en una casilla de su base dentro del alcance, y rechaza fuera de ella', () => {
    const s = one();
    const b = s.map.bases[1];
    // El jugador aparece junto a su núcleo; la casilla (x+1, y+5) de la base queda a ~2 casillas.
    run(s, {}, 1, [{ playerId: 'a', cmd: { type: 'build', x: b.x + 1, y: b.y + 5 } }]);
    expect(s.structures.get((b.y + 5) * MAP_W + b.x + 1)?.type).toBe('wood');
    // Dentro de la base pero lejos del jugador: se rechaza.
    run(s, {}, 1, [{ playerId: 'a', cmd: { type: 'build', x: b.x + 7, y: b.y } }]);
    expect(s.structures.size).toBe(1);
    // Cerca pero fuera de la base: se rechaza.
    run(s, {}, 1, [{ playerId: 'a', cmd: { type: 'build', x: b.x + 3, y: b.y + b.h } }]);
    expect(s.structures.size).toBe(1);
  });

  it('la caja de armamento se abre tras 5 s junto a ella (desde la oleada 1) y da metralleta y torreta', () => {
    const s = one();
    const p = s.players[0];
    s.time = 60;
    run(s, {}, 1);
    expect(s.armory.available).toBe(true);
    Object.assign(p, { x: s.armory.x, y: s.armory.y + 0.5 });
    run(s, {}, 30 * 4);
    expect(p.heavy).toBe(null);
    run(s, {}, 30 * 1 + 2);
    expect(p.heavy).toBe('smg');
    expect(p.heavyAmmo).toBe(ARMORY_LOOT[1].ammo);
    expect(p.turrets).toBe(1);
    expect(p.weapon).toBe('smg');
    expect(s.armory.available).toBe(false);
  });

  it('la torreta dispara a zombis cercanos y recarga cuando vacía el cargador', () => {
    const s = one();
    const p = s.players[0];
    p.turrets = 1;
    p.build = 'turret';
    const b = s.map.bases[1];
    run(s, {}, 1, [{ playerId: 'a', cmd: { type: 'build', x: b.x + 1, y: b.y + 5 } }]);
    const key = (b.y + 5) * MAP_W + b.x + 1;
    expect(s.structures.get(key)?.type).toBe('turret');
    expect(p.turrets).toBe(0);
    s.zombies.push({ id: 999, x: b.x + 1.5, y: b.y + 8.5, px: 0, py: 0, hp: 10_000, maxHp: 10_000, damage: 0, attackCd: 99, retargetAt: 1e9, trapAcc: 0, kind: 'tank', attackAt: -1, hurtAt: -1, target: null });
    run(s, {}, Math.ceil(30 * TURRET.fireInterval * TURRET.magazine) + 5);
    const t = s.structures.get(key)!;
    expect(t.ammo).toBe(0);
    expect(t.reloadUntil).toBeGreaterThan(s.time);
  });

  it('la colisión es a la altura de los pies: se acerca a un obstáculo por abajo hasta tocarlo con los pies', () => {
    const s = one();
    const p = s.players[0];
    // Un muro justo arriba del jugador: puede subir hasta que la caja de los pies toca la casilla de arriba.
    const tx = Math.floor(p.x);
    const ty = Math.floor(p.y) - 1;
    s.structures.set(ty * MAP_W + tx, { type: 'wood', hp: 100, maxHp: 100, owner: 2, team: 2, orient: 'h' });
    run(s, { up: true }, 30);
    expect(p.y + BODY.top).toBeGreaterThanOrEqual(ty + 1 - 1e-6);
    expect(p.y + BODY.top).toBeLessThan(ty + 1.05);
  });
});

describe('supervivientes y dificultad', () => {
  const two = (a: string, b: string, difficulty?: string) =>
    createMatch({
      seed: 7,
      difficulty,
      players: [
        { id: 'a', slot: 1, name: 'A', survivor: a },
        { id: 'b', slot: 2, name: 'B', survivor: b },
      ],
    });

  it('la mecánica empieza con más materiales y el explorador con más cartuchos', () => {
    const s = two('mecanica', 'explorador');
    const [m, e] = s.players;
    expect(m.wood).toBe(PLAYER_START.wood + 12);
    expect(m.metal).toBe(PLAYER_START.metal + 4);
    expect(e.shells).toBe(PLAYER_START.shells + 8);
    expect(e.wood).toBe(PLAYER_START.wood);
  });

  it('el explorador camina más rápido', () => {
    const s = two('explorador', 'mecanica');
    const [e, m] = s.players;
    const e0 = e.y;
    const m0 = m.y;
    for (let i = 0; i < 10; i++) step(s, { a: { up: false, down: true, left: false, right: false, action: false }, b: { up: true, down: false, left: false, right: false, action: false } }, [], 1 / 30);
    expect(Math.abs(e.y - e0)).toBeGreaterThan(Math.abs(m.y - m0) * 1.1);
  });

  it('en Difícil salen más zombis y con más vida', () => {
    const normal = two('explorador', 'mecanica');
    const hard = two('explorador', 'mecanica', 'Difícil');
    const toWave = (s: ReturnType<typeof two>) => {
      for (let t = 0; t < 61 * 30; t++) step(s, {}, [], 1 / 30);
    };
    toWave(normal);
    toWave(hard);
    const total = (s: ReturnType<typeof two>) => s.zombies.length + s.spawn.remaining;
    expect(total(hard)).toBeGreaterThan(total(normal));
    expect(hard.zombies[0].maxHp).toBeGreaterThan(normal.zombies[0].maxHp);
  });
});

describe('armas nuevas: cuchillo, sniper y lanzacohetes', () => {
  const idle = { up: false, down: false, left: false, right: false, action: false };
  const setup = () => {
    const s = createMatch({ seed: 11, players: [{ id: 'a', slot: 1, name: 'A', survivor: 'base' }] });
    const p = s.players[0];
    // Fuera de la base, en una casilla libre del centro.
    Object.assign(p, { x: s.map.armory.x + 0.5, y: s.map.armory.y + 1.5 });
    return { s, p };
  };
  const zombie = (s: ReturnType<typeof setup>['s'], x: number, y: number, hp = 200) => {
    const z = { id: s.nextId++, x, y, px: x, py: y, hp, maxHp: hp, damage: 0, attackCd: 99, retargetAt: 999, trapAcc: 0, kind: 'normal' as const, attackAt: -1, hurtAt: -1, target: null };
    s.zombies.push(z);
    return z;
  };
  const tick = (s: ReturnType<typeof setup>['s'], input: object, n = 1) => {
    for (let i = 0; i < n; i++) step(s, { a: { ...idle, ...input } }, [], 1 / 30);
  };

  it('con un zombi pegado usa el cuchillo: no dispara ni gasta munición y golpea una sola vez', () => {
    const { s, p } = setup();
    p.weapon = 'shotgun';
    const shells = p.shells;
    const z = zombie(s, p.x + 0.6, p.y);
    tick(s, { fire: true });
    expect(s.bullets.length).toBe(0);
    expect(p.knifeAt).toBe(s.time);
    tick(s, {}, Math.ceil(KNIFE.impactS * 30) + 1);
    expect(z.hp).toBe(200 - KNIFE.damage);
    tick(s, {}, 10);
    expect(z.hp).toBe(200 - KNIFE.damage);
    expect(p.shells).toBe(shells);
  });

  it('si el zombi se aleja antes del golpe, el cuchillo no hace daño', () => {
    const { s, p } = setup();
    const z = zombie(s, p.x + 0.6, p.y);
    tick(s, { fire: true });
    z.x += 3;
    tick(s, {}, 6);
    expect(z.hp).toBe(200);
  });

  it('el sniper atraviesa varios zombis y gasta su munición', () => {
    const { s, p } = setup();
    Object.assign(p, { heavy: 'sniper', heavyAmmo: 3, weapon: 'sniper', dirX: 1, dirY: 0 });
    const zs = [2, 3, 4].map((dx) => zombie(s, p.x + dx, p.y));
    tick(s, { fire: true });
    tick(s, {}, 10);
    expect(zs.every((z) => z.hp === 200 - 70)).toBe(true);
    expect(p.heavyAmmo).toBe(2);
  });

  it('el cohete explota y daña a todos los zombis cercanos; sin munición vuelve a la pistola', () => {
    const { s, p } = setup();
    Object.assign(p, { heavy: 'rocket', heavyAmmo: 1, weapon: 'rocket', dirX: 1, dirY: 0 });
    const a = zombie(s, p.x + 3, p.y);
    const b = zombie(s, p.x + 3.5, p.y + 0.8);
    tick(s, { fire: true });
    expect(p.weapon).toBe('pistol');
    expect(p.heavy).toBe(null);
    tick(s, {}, 20);
    expect(a.hp).toBeLessThanOrEqual(200 - ROCKET.damage);
    expect(b.hp).toBe(200 - ROCKET.damage);
  });

  it('la caja trae ametralladora, luego sniper y en la horda el lanzacohetes', () => {
    expect([1, 2, 3].map((w) => ARMORY_LOOT[w].weapon)).toEqual(['smg', 'sniper', 'rocket']);
    const s = createMatch({ seed: 3, players: [{ id: 'a', slot: 1, name: 'A', survivor: 'base' }] });
    const p = s.players[0];
    s.time = 120;
    step(s, {}, [], 1 / 30);
    Object.assign(p, { x: s.armory.x, y: s.armory.y + 0.5 });
    for (let i = 0; i < 30 * 5 + 2; i++) step(s, {}, [], 1 / 30);
    expect(p.heavy).toBe('sniper');
    expect(p.weapon).toBe('sniper');
  });
});

describe('Distrito Industrial', () => {
  it('el mapa industrial es simétrico, alcanzable y tiene tren, canales y estructuras industriales', () => {
    expect(mapThemeOf('distrito-industrial')).toBe('industrial');
    expect(mapThemeOf('ciudad-abandonada')).toBe('ciudad');
    for (const seed of [1, 2, 3, 42, 777]) {
      const m = generateMap(seed, 'industrial');
      expect(m.theme).toBe('industrial');
      expect(isMapReachable(m)).toBe(true);
      expect(m.objects.filter((o) => o.kind === 'train').length).toBeGreaterThanOrEqual(2);
      expect(m.ground.some((g) => g === Ground.RAIL)).toBe(true);
      expect(m.ground.filter((g) => g === Ground.WATER).length).toBeGreaterThan(0);
      const names = m.objects.filter((o) => o.kind === 'building').map((o) => BUILDINGS[o.variant].name);
      expect(names.some((n) => n.startsWith('ind-') || n.startsWith('urb-') || n.startsWith('helicoptero'))).toBe(true);
      expectSymmetric(m);
    }
  });

  it('la partida usa el tema del mapa elegido en la sala', () => {
    const s = createMatch({ seed: 5, mapId: 'distrito-industrial', players: [{ id: 'a', slot: 1, name: 'A', survivor: 'base' }] });
    expect(s.map.theme).toBe('industrial');
    expect(createMatch({ seed: 5, players: [] }).map.theme).toBe('ciudad');
  });
});

describe('ventajas de los cinco supervivientes', () => {
  const p1 = (survivor: string) => createMatch({ seed: 4, players: [{ id: 'a', slot: 1, name: 'A', survivor }] });

  it('hay ventajas para los cinco', () => {
    expect(Object.keys(SURVIVOR_PERKS).sort()).toEqual(['explorador', 'mecanica', 'medica', 'militar', 'obrero']);
  });

  it('la médica empieza con 2 botiquines más y cura 50 % más', () => {
    const s = p1('medica');
    const p = s.players[0];
    expect(p.medkits).toBe(PLAYER_START.medkits + 2);
    p.hp = 10;
    step(s, {}, [{ playerId: 'a', cmd: { type: 'hotbar', slot: 3 } }], 1 / 30);
    expect(p.hp).toBe(10 + 75);
  });

  it('las paredes del obrero aguantan 50 % más', () => {
    const s = p1('obrero');
    const p = s.players[0];
    const b = s.map.bases[1];
    step(s, {}, [{ playerId: 'a', cmd: { type: 'build', x: b.x + 1, y: b.y + 5 } }], 1 / 30);
    const st = [...s.structures.values()][0];
    expect(st.maxHp).toBe(Math.round(STRUCTURES.woodWall.hp * 1.5));
  });

  it('el militar hace 15 % más daño', () => {
    const s = p1('militar');
    const p = s.players[0];
    Object.assign(p, { x: s.map.armory.x + 0.5, y: s.map.armory.y + 1.5, dirX: 1, dirY: 0 });
    step(s, { a: { up: false, down: false, left: false, right: false, action: false, fire: true } }, [], 1 / 30);
    expect(s.bullets[0].damage).toBeCloseTo(WEAPONS.pistol.damage * 1.15);
  });
});

describe('colisiones, explosivos y paredes propias', () => {
  const idle = { up: false, down: false, left: false, right: false, action: false };

  it('la colisión de las estructuras sale del dibujo: la fila de techo y las casillas vacías no chocan', () => {
    for (const b of BUILDINGS) expect(b.solid.length).toBe(b.h);
    const heli = BUILDINGS.find((b) => b.name === 'helicoptero-militar-derribado')!;
    expect(heli.solid[0]).toBe('....');
    for (const seed of [1, 9, 77]) {
      const m = generateMap(seed, 'industrial');
      for (const o of m.objects.filter((o) => o.kind === 'building')) {
        const mask = BUILDINGS[o.variant].solid;
        for (let y = 0; y < o.h; y++)
          for (let x = 0; x < o.w; x++) expect(m.tiles[(o.y + y) * MAP_W + o.x + x] !== Tile.GRASS).toBe(mask[y][x] === '#');
      }
    }
  });

  it('un barril aguanta unos disparos, luego explota, daña lo que hay cerca y deja libre su casilla', () => {
    const s = createMatch({ seed: 21, players: [{ id: 'a', slot: 1, name: 'A', survivor: 'base' }] });
    const [index, prop] = [...s.props].find(([, p]) => p.kind === 'barrel')!;
    expect(prop.hp).toBe(EXPLOSIVES.barrel.hp);
    const cell = prop.cells[0];
    const z = { id: 999, x: prop.x + 1, y: prop.y, px: 0, py: 0, hp: 500, maxHp: 500, damage: 0, attackCd: 99, retargetAt: 999, trapAcc: 0, kind: 'normal' as const, attackAt: -1, hurtAt: -1, target: null };
    s.zombies.push(z);
    const p = s.players[0];
    // Dispara desde la izquierda del barril hacia él.
    Object.assign(p, { x: prop.x - 3, y: prop.y, dirX: 1, dirY: 0, alive: true });
    s.structures.clear();
    for (let i = 0; i < 30 * 3 && s.props.has(index); i++) step(s, { a: { ...idle, fire: true } }, [], 1 / 30);
    expect(s.props.has(index)).toBe(false);
    expect(s.destroyedProps).toContain(index);
    expect(s.map.tiles[cell]).toBe(Tile.GRASS);
    expect(z.hp).toBeLessThanOrEqual(500 - EXPLOSIVES.barrel.damage);
  });

  it('el jugador atraviesa sus propias paredes (no queda encerrado); el rival no', () => {
    const s = createMatch({
      seed: 5,
      players: [
        { id: 'a', slot: 1, name: 'A', survivor: 'base' },
        { id: 'b', slot: 2, name: 'B', survivor: 'base' },
      ],
    });
    const [a, b] = s.players;
    const tx = Math.floor(a.x) + 1;
    const ty = Math.floor(a.y);
    s.structures.set(ty * MAP_W + tx, { type: 'wood', hp: 100, maxHp: 100, owner: 1, team: 1, orient: 'v' });
    const x0 = a.x;
    for (let i = 0; i < 20; i++) step(s, { a: { ...idle, right: true } }, [], 1 / 30);
    expect(a.x).toBeGreaterThan(tx + 0.3);
    Object.assign(b, { x: x0, y: a.y });
    for (let i = 0; i < 20; i++) step(s, { b: { ...idle, right: true } }, [], 1 / 30);
    expect(b.x).toBeLessThan(tx);
    expect(x0).toBeLessThan(tx);
  });
});

describe('autoapuntado (celular)', () => {
  const idle = { up: false, down: false, left: false, right: false, action: false };
  const setup = () => {
    const s = createMatch({ seed: 11, players: [{ id: 'a', slot: 1, name: 'A', survivor: 'base' }] });
    const p = s.players[0];
    Object.assign(p, { x: s.map.armory.x + 0.5, y: s.map.armory.y + 1.5, dirX: 1, dirY: 0 });
    return { s, p };
  };
  const zombie = (s: ReturnType<typeof setup>['s'], x: number, y: number) => {
    s.zombies.push({ id: s.nextId++, x, y, px: x, py: y, hp: 500, maxHp: 500, damage: 0, attackCd: 99, retargetAt: 999, trapAcc: 0, kind: 'normal' as const, attackAt: -1, hurtAt: -1, target: null });
  };

  it('un toque dispara hacia el zombi más cercano aunque el jugador mire a otro lado, con un desfase pequeño', () => {
    const { s, p } = setup();
    zombie(s, p.x, p.y - 4); // arriba; el jugador mira a la derecha
    zombie(s, p.x - 7, p.y); // más lejos
    step(s, { a: { ...idle, fire: true, autoAim: true } }, [], 1 / 30);
    expect(s.bullets.length).toBe(1);
    const b = s.bullets[0];
    const angle = Math.atan2(b.vy, b.vx);
    expect(Math.abs(angle - -Math.PI / 2)).toBeLessThanOrEqual(0.14 + 1e-6);
  });

  it('sin objetivos a la vista dispara hacia donde mira', () => {
    const { s } = setup();
    step(s, { a: { ...idle, fire: true, autoAim: true } }, [], 1 / 30);
    expect(s.bullets[0].vx).toBeGreaterThan(0);
    expect(Math.abs(s.bullets[0].vy)).toBeLessThan(1e-9);
  });
});
