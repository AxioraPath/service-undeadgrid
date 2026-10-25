import { CORE_HP, MATCH_DURATION, slotFor, teamOf, type Slot } from '../config/game.config';
import { createMatch, playerInOwnBase, step, type Bullet, type MatchState } from './engine';
import { encodeMap, encodeState } from './snapshot';
import { inRect } from './mapgen';

const idle = { up: false, down: false, left: false, right: false, action: false };

const make2v2 = (seed = 11): MatchState =>
  createMatch({
    seed,
    players: ([1, 2, 3, 4] as Slot[]).map((slot) => ({ id: `p${slot}`, slot, name: `P${slot}`, survivor: 'explorador' })),
  });

const player = (s: MatchState, slot: Slot) => s.players.find((p) => p.slot === slot)!;

/** Moves the match clock into wave 1 so PvP rules are active. */
const startCombat = (s: MatchState) => {
  s.time = 60;
  step(s, {}, [], 1 / 30);
  expect(s.phaseIndex).toBeGreaterThan(0);
  s.zombies.length = 0;
  s.spawn.remaining = 0;
};

const bullet = (s: MatchState, owner: Slot, x: number, y: number, vx: number, vy: number): Bullet => ({
  id: s.nextId++,
  owner: `p${owner}`,
  ownerSlot: owner,
  ownerTeam: teamOf(owner), ownerSide: teamOf(owner),
  x, y, px: x, py: y, vx, vy,
  damage: 15, traveled: 0, kind: 'bullet', speed: 16, range: 9, pierce: 1, hits: [], splash: 0,
});

describe('teamOf', () => {
  it('maps slots 1/3 to team 1 and 2/4 to team 2', () => {
    expect([1, 2, 3, 4].map((s) => teamOf(s as Slot))).toEqual([1, 2, 1, 2]);
    expect(slotFor(1, 1)).toBe(3);
    expect(slotFor(2, 1)).toBe(4);
    expect(slotFor(1, 0)).toBe(1);
    expect(slotFor(2, 0)).toBe(2);
  });
});

describe('2v2 engine', () => {
  it('spawns each team inside its own base on different tiles', () => {
    const s = make2v2();
    const points = new Set<string>();
    for (const p of s.players) {
      expect(p.team).toBe(teamOf(p.slot));
      expect(inRect(s.map.bases[p.team], Math.floor(p.x), Math.floor(p.y))).toBe(true);
      expect(playerInOwnBase(s, p)).toBe(true);
      points.add(`${Math.floor(p.x)},${Math.floor(p.y)}`);
    }
    expect(points.size).toBe(4);
    expect(Math.hypot(player(s, 1).x - player(s, 3).x, player(s, 1).y - player(s, 3).y)).toBeGreaterThanOrEqual(1);
    expect(Math.hypot(player(s, 2).x - player(s, 4).x, player(s, 2).y - player(s, 4).y)).toBeGreaterThanOrEqual(1);
  });

  it('keeps one core, one crate and one base per team in the map and snapshot', () => {
    const s = make2v2();
    const map = encodeMap(s);
    expect(Object.keys(map.bases)).toEqual(['1', '2']);
    const st = encodeState(s);
    expect(Object.keys(st.cores)).toEqual(['1', '2']);
    expect(Object.keys(st.crates)).toEqual(['1', '2']);
    expect(st.players.map((p) => [p.slot, p.team])).toEqual([[1, 1], [2, 2], [3, 1], [4, 2]]);
  });

  it('teammates share the team crate stock', () => {
    const s = make2v2();
    const c = s.map.crates[1];
    const p1 = player(s, 1);
    const p3 = player(s, 3);
    Object.assign(p1, { x: c.x + 0.5, y: c.y + 0.5 });
    Object.assign(p3, { x: c.x + 0.5, y: c.y + 0.5 });
    const woodBefore = p3.wood;
    const crateWood = s.crates[1].wood;
    step(s, {}, [{ playerId: 'p1', cmd: { type: 'crateTake', item: 'wood' } }], 1 / 30);
    expect(s.crates[1].wood).toBe(0);
    step(s, {}, [{ playerId: 'p3', cmd: { type: 'crateTake', item: 'wood' } }], 1 / 30);
    expect(p3.wood).toBe(woodBefore); // already taken by the teammate
    expect(player(s, 1).wood).toBeGreaterThanOrEqual(crateWood);
  });

  it('friendly fire is off for player bullets but enemies get hurt', () => {
    const s = make2v2();
    startCombat(s);
    const y = s.map.bases[1].y + s.map.bases[1].h - 1.5;
    const x0 = s.map.bases[1].x + 1.5;
    Object.assign(player(s, 1), { x: x0 - 1, y });
    Object.assign(player(s, 3), { x: x0 + 2, y });
    Object.assign(player(s, 2), { x: 30, y: 20 });
    Object.assign(player(s, 4), { x: 31, y: 20 });
    s.bullets.push(bullet(s, 1, x0, y, 16, 0));
    for (let i = 0; i < 10; i++) step(s, {}, [], 1 / 30);
    expect(player(s, 3).hp).toBe(100);

    // Same shot at an enemy standing there does damage.
    Object.assign(player(s, 2), { x: x0 + 2, y });
    Object.assign(player(s, 3), { x: 30, y: 22 });
    s.bullets.length = 0;
    s.bullets.push(bullet(s, 1, x0, y, 16, 0));
    for (let i = 0; i < 10; i++) step(s, {}, [], 1 / 30);
    expect(player(s, 2).hp).toBeLessThan(100);
  });

  it('rockets and traps do not hurt teammates', () => {
    const s = make2v2();
    startCombat(s);
    const b = s.map.bases[1];
    const y = b.y + b.h - 1.5;
    const x = b.x + 1.5;
    Object.assign(player(s, 3), { x, y });
    Object.assign(player(s, 1), { x: x + 3, y });
    Object.assign(player(s, 2), { x: 30, y: 20 });
    Object.assign(player(s, 4), { x: 31, y: 20 });
    // Team trap under the teammate.
    s.structures.set(Math.floor(y) * s.map.w + Math.floor(x), { type: 'trap', hp: 1, maxHp: 1, owner: 1, team: 1, side: 1, orient: 'h' });
    // Rocket explosion right on the teammate.
    s.bullets.push({ ...bullet(s, 1, x, y, 0, 0), kind: 'rocket', speed: 10, splash: 55, damage: 40 });
    for (let i = 0; i < 20; i++) step(s, {}, [], 1 / 30);
    expect(player(s, 3).hp).toBe(100);
    // The enemy standing on the same trap does take damage.
    Object.assign(player(s, 2), { x, y });
    for (let i = 0; i < 20; i++) step(s, {}, [], 1 / 30);
    expect(player(s, 2).hp).toBeLessThan(100);
  });

  it('teammate walls do not stop your bullets; enemy walls do and take damage', () => {
    const s = make2v2();
    startCombat(s);
    const b = s.map.bases[1];
    const ty = b.y + b.h - 2;
    const tx = b.x + 2;
    const key = ty * s.map.w + tx;
    s.structures.set(key, { type: 'wood', hp: 100, maxHp: 100, owner: 3, team: 1, side: 1, orient: 'h' });
    s.bullets.push(bullet(s, 1, tx - 0.4, ty + 0.5, 16, 0));
    step(s, {}, [], 1 / 30);
    expect(s.structures.get(key)!.hp).toBe(100); // passed through, no damage
    expect(s.bullets).toHaveLength(1);

    s.bullets.length = 0;
    s.bullets.push(bullet(s, 2, tx - 0.4, ty + 0.5, 16, 0));
    step(s, {}, [], 1 / 30);
    expect(s.structures.get(key)!.hp).toBe(85);
  });

  it('a team only loses when the shared core is down AND both players are out', () => {
    const s = make2v2();
    startCombat(s);
    s.cores[2].hp = 0;
    const kill = (slot: Slot) => Object.assign(player(s, slot), { alive: false, hp: 0, respawnAt: null });

    kill(2);
    step(s, {}, [], 1 / 30);
    expect(s.result).toBeNull(); // slot 4 still standing

    kill(4);
    step(s, {}, [], 1 / 30);
    expect(s.result?.winner).toBe(1);
    expect(s.result?.byTime).toBe(false);
  });

  it('with the shared core destroyed, a killed teammate does not respawn', () => {
    const s = make2v2();
    startCombat(s);
    s.cores[2].hp = 0;
    const b = s.map.bases[1];
    const y = b.y + b.h - 1.5;
    const x = b.x + 3.5;
    Object.assign(player(s, 4), { x, y });
    Object.assign(player(s, 1), { x: x - 3, y });
    Object.assign(player(s, 2), { x: 30, y: 20 });
    s.bullets.push({ ...bullet(s, 1, x - 1, y, 16, 0), damage: 500 });
    for (let i = 0; i < 10; i++) step(s, {}, [], 1 / 30);
    expect(player(s, 4).alive).toBe(false);
    expect(player(s, 4).respawnAt).toBeNull();
    expect(player(s, 1).kills).toBe(1);
    expect(s.result).toBeNull(); // slot 2 is still alive
  });

  it('time-out tiebreak compares core HP, then the summed kills of each team', () => {
    const s = make2v2();
    startCombat(s);
    s.time = MATCH_DURATION;
    s.cores[1].hp = 300;
    s.cores[2].hp = 200;
    step(s, {}, [], 1 / 30);
    expect(s.result).toMatchObject({ winner: 1, byTime: true });

    const t = make2v2();
    startCombat(t);
    t.time = MATCH_DURATION;
    player(t, 2).zombieKills = 3;
    player(t, 4).kills = 2;
    player(t, 1).zombieKills = 4;
    step(t, {}, [], 1 / 30);
    expect(t.cores[1].hp).toBe(CORE_HP);
    expect(t.result?.winner).toBe(2); // 5 vs 4
  });

  it('player bullets damaging the enemy core are credited to the shooter slot', () => {
    const s = make2v2();
    startCombat(s);
    const c = s.map.cores[2];
    s.bullets.push(bullet(s, 3, c.x - 0.6, c.y + 0.5, 16, 0));
    for (let i = 0; i < 5; i++) step(s, {}, [], 1 / 30);
    expect(s.cores[2].hp).toBeLessThan(CORE_HP);
    expect(s.coreDamageDealt[3]).toBeGreaterThan(0);
    expect(s.coreDamageDealt[1]).toBe(0);
  });
});
