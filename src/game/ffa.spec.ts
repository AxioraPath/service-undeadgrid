import { FFA, MAP_W, PHASES_FFA, ZOMBIE_TRAITS } from './constants';
import { createMatch, eliminatePlayer, step, type MatchState } from './engine';
import { encodeMap, encodeState } from './snapshot';
import { isSolidTileKind, Ground } from './mapgen';

/** Pruebas del modo todos contra todos (y de los rasgos de los zombis). */
const idle = { up: false, down: false, left: false, right: false, action: false };
const four = (lives = 3, seed = 5) =>
  createMatch({
    seed,
    ffa: true,
    lives,
    players: ([1, 2, 3, 4] as const).map((slot) => ({ id: `p${slot}`, slot, name: `P${slot}`, survivor: 'base' })),
  });
const tick = (s: MatchState, n = 1, inputs: Record<string, object> = {}) => {
  for (let i = 0; i < n; i++) step(s, inputs as never, [], 1 / 30);
};

describe('todos contra todos', () => {
  it('sin núcleos; cada jugador es su propio bando, con vidas, pistola, 2 botiquines y un poco de madera', () => {
    const s = four(5);
    expect(s.ffa).toBe(true);
    expect([s.cores[1].hp, s.cores[2].hp]).toEqual([0, 0]);
    expect(s.players.map((p) => p.side)).toEqual([1, 2, 3, 4]);
    for (const p of s.players) {
      expect(p.lives).toBe(5);
      expect(p.weapon).toBe('pistol');
      expect(p.medkits).toBe(FFA.start.medkits);
      expect(p.wood).toBe(FFA.start.wood);
      expect(p.shells).toBe(0);
    }
  });

  it('aparece cada uno en una esquina distinta, en casillas libres', () => {
    const s = four();
    const keys = new Set(s.players.map((p) => `${Math.floor(p.x)},${Math.floor(p.y)}`));
    expect(keys.size).toBe(4);
    for (const p of s.players) expect(isSolidTileKind(s.map.tiles[Math.floor(p.y) * MAP_W + Math.floor(p.x)])).toBe(false);
    expect(encodeMap(s).ffa).toBe(true);
  });

  it('morir quita una vida; sin vidas queda eliminado y no reaparece', () => {
    const s = four(3);
    const p = s.players[1];
    for (let life = 0; life < 3; life++) {
      p.alive = true;
      p.respawnAt = null;
      p.hp = 1;
      s.zombies.push({ id: 900 + life, x: p.x, y: p.y, px: p.x, py: p.y, hp: 40, maxHp: 40, damage: 50, attackCd: 0, retargetAt: 0, trapAcc: 0, kind: 'normal', speedMul: 1, attackAt: -1, hurtAt: -1, target: { kind: 'player', id: p.id } });
      s.time = 70; // en oleada
      tick(s, 3);
      s.zombies = [];
      expect(p.alive).toBe(false);
    }
    expect(p.lives).toBe(0);
    expect(p.respawnAt).toBeNull();
  });

  it('gana el último con vidas', () => {
    const s = four();
    for (const slot of [2, 3, 4] as const) eliminatePlayer(s, slot);
    tick(s);
    expect(s.result?.winnerSlot).toBe(1);
    expect(encodeState(s).result?.winnerSlot).toBe(1);
  });

  it('las balas dañan a cualquier otro jugador (no hay aliados)', () => {
    const s = four();
    const [a, , c] = s.players;
    s.time = 70;
    Object.assign(c, { x: a.x + 2, y: a.y });
    tick(s, 1, { p1: { ...idle, fire: true, aim: { x: 1, y: 0 } } });
    tick(s, 10);
    expect(c.hp).toBeLessThan(100);
  });

  it('aparecen armas en el suelo y se recogen al pasar encima', () => {
    const s = four();
    tick(s, 1);
    expect(s.pickups.length).toBe(FFA.initialPickups);
    const it = s.pickups[0];
    const p = s.players[0];
    Object.assign(p, { x: it.x, y: it.y });
    tick(s, 1);
    expect(s.pickups.find((o) => o.id === it.id)).toBeUndefined();
    if (it.kind === 'medkit') expect(p.medkits).toBe(FFA.start.medkits + 1);
    else expect(p.weapon).toBe(it.kind);
    expect(encodeState(s).pickups.length).toBe(s.pickups.length);
  });

  it('se construye en cualquier parte del mapa, menos en la plazoleta del centro', () => {
    const s = four();
    const p = s.players[0];
    // Una casilla libre cerca del jugador, fuera de su punto de aparición.
    Object.assign(p, { x: s.map.armory.x - 6.5, y: s.map.armory.y + 0.5 });
    let tx = Math.floor(p.x) + 1;
    const ty = Math.floor(p.y);
    while (isSolidTileKind(s.map.tiles[ty * MAP_W + tx])) tx++;
    step(s, {}, [{ playerId: 'p1', cmd: { type: 'build', x: tx, y: ty } }], 1 / 30);
    expect(s.structures.get(ty * MAP_W + tx)?.side).toBe(1);
    // En la plazoleta no.
    const ax = Math.floor(s.map.armory.x);
    const ay = Math.floor(s.map.armory.y);
    expect(s.map.ground[ay * MAP_W + ax]).toBe(Ground.PLAZA);
    Object.assign(p, { x: ax + 0.5, y: ay + 2.5 });
    step(s, {}, [{ playerId: 'p1', cmd: { type: 'build', x: ax, y: ay } }], 1 / 30);
    expect(s.structures.has(ay * MAP_W + ax)).toBe(false);
  });
});

describe('rasgos de los zombis (todos los modos)', () => {
  it('los rápidos corren más y aguantan menos; los tanques al revés', () => {
    expect(ZOMBIE_TRAITS.fast.speed).toBeGreaterThan(1);
    expect(ZOMBIE_TRAITS.fast.hp).toBeLessThan(1);
    expect(ZOMBIE_TRAITS.tank.hp).toBeGreaterThan(2);
    expect(ZOMBIE_TRAITS.tank.speed).toBeLessThan(1);
    // Oleada 2 en 1v1: aparecen rápidos con su multiplicador de velocidad.
    const s = createMatch({ seed: 9, players: [{ id: 'a', slot: 1, name: 'A', survivor: 'base' }] });
    s.time = 120;
    for (let i = 0; i < 30 * 6; i++) step(s, {}, [], 1 / 30);
    const fast = s.zombies.find((z) => z.kind === 'fast');
    expect(fast?.speedMul).toBe(ZOMBIE_TRAITS.fast.speed);
  });
});

describe('forma de choque de los objetos (medida del dibujo)', () => {
  it('se puede entrar en la parte vacía de la casilla de un objeto y se choca donde está su dibujo', () => {
    const s = createMatch({ seed: 3, players: [{ id: 'a', slot: 1, name: 'A', survivor: 'base' }] });
    const p = s.players[0];
    p.x = s.map.armory.x - 6.5;
    p.y = s.map.armory.y + 2.3;
    const tx = Math.floor(p.x) + 2;
    const ty = Math.floor(p.y);
    const i = ty * MAP_W + tx;
    s.map.tiles[i] = 11; // barrera
    s.map.shapes.set(i, [0.5, 0, 1, 1]);
    for (let k = 0; k < 40; k++) step(s, { a: { up: false, down: false, left: false, right: true, action: false } }, [], 1 / 30);
    // Llega hasta la mitad de la casilla (donde empieza el dibujo), no se queda en el borde.
    expect(p.x + 0.32).toBeGreaterThan(tx + 0.45);
    expect(p.x + 0.32).toBeLessThanOrEqual(tx + 0.5 + 1e-6);
  });

  it('las formas existen para los objetos del mapa generado', () => {
    const s = createMatch({ seed: 7, players: [] });
    expect(s.map.shapes.size).toBeGreaterThan(20);
    for (const [, sh] of s.map.shapes) {
      expect(sh[0]).toBeGreaterThanOrEqual(0);
      expect(sh[2]).toBeLessThanOrEqual(1);
      expect(sh[2] - sh[0]).toBeGreaterThan(0.2);
    }
  });
});

describe('duración de la preparación según el modo', () => {
  const one = [{ id: 'a', slot: 1 as const, name: 'A', survivor: 'base' }, { id: 'b', slot: 2 as const, name: 'B', survivor: 'base' }];
  const runTo = (s: MatchState, seconds: number) => {
    while (s.time < seconds && !s.result) step(s, {}, [], 1 / 30);
    return encodeState(s);
  };

  it('1v1/2v2: 25 s de preparación y luego la oleada 1', () => {
    const s = createMatch({ seed: 5, players: one });
    expect(encodeState(s).phase).toMatchObject({ id: 'prep', end: 25 });
    expect(runTo(s, 24.9).phase.id).toBe('prep');
    expect(runTo(s, 25.1).phase).toMatchObject({ id: 'wave1', start: 25, end: 85 });
    expect(encodeState(s).duration).toBe(205);
  });

  it('todos contra todos: solo 5 s de preparación y hasta 5 minutos de partida', () => {
    const s = createMatch({ seed: 5, players: one, ffa: true, lives: 3 });
    expect(encodeState(s).phase).toMatchObject({ id: 'prep', end: 5 });
    expect(runTo(s, 5.1).phase).toMatchObject({ id: 'wave1', start: 5, end: 65 });
    expect(encodeState(s).duration).toBe(300);
    expect(PHASES_FFA[3]).toMatchObject({ id: 'horde', start: 125, end: 300 });
  });
});
