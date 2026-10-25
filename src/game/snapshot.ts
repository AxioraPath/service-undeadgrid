import type { GameMapDto, GameStateDto, ZombieTuple } from '../contracts/game';
import type { Slot } from './constants';
import { phaseOf, playerInOwnBase, playerOnOwnCrate, previewBuild, type MatchState } from './engine';

const ZOMBIE_KIND = { normal: 0, fast: 1, tank: 2 } as const;
const STRUCTURE_TYPE = { wood: 0, reinforced: 1, trap: 2, turret: 3 } as const;
const PROJECTILE = { bullet: 0, sniper: 1, rocket: 2 } as const;
const PICKUP_KIND = { shotgun: 0, medkit: 1, smg: 2, sniper: 3, rocket: 4 } as const;

/** Redondea a milésimas para que el JSON viaje más ligero. */
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function encodeMap(s: MatchState): GameMapDto {
  const m = s.map;
  return {
    seed: m.seed,
    theme: m.theme,
    ffa: s.ffa,
    w: m.w,
    h: m.h,
    tiles: Array.from(m.tiles),
    ground: Array.from(m.ground),
    objects: m.objects.map((o) => ({ ...o })),
    bases: { 1: { ...m.bases[1] }, 2: { ...m.bases[2] } },
    cores: { 1: { ...m.cores[1] }, 2: { ...m.cores[2] } },
    crates: { 1: { ...m.crates[1] }, 2: { ...m.crates[2] } },
    spawns: m.spawns.map((p) => ({ ...p })),
    armory: { ...m.armory },
  };
}

/** Estado público de la partida. Con `consumeEvents` vacía la lista de eventos pendientes. */
export function encodeState(s: MatchState, consumeEvents = true): GameStateDto {
  const ph = phaseOf(s);
  const events = consumeEvents ? s.events.splice(0) : [];
  return {
    tick: s.ticks,
    time: r3(s.time),
    phase: { id: ph.id, label: ph.label, start: ph.start, end: ph.end, wave: ph.wave },
    maxWave: s.maxWave,
    players: s.players.map((p) => {
      const inBase = p.alive && playerInOwnBase(s, p);
      const hint = inBase ? previewBuild(s, p) : null;
      return {
        id: p.id,
        slot: p.slot,
        team: p.team,
        name: p.name,
        survivor: p.survivor,
        x: r3(p.x),
        y: r3(p.y),
        dirX: r3(p.dirX),
        dirY: r3(p.dirY),
        ...(p.aim ? { aimX: r3(p.aim.x), aimY: r3(p.aim.y) } : {}),
        hp: p.hp,
        alive: p.alive,
        respawnIn: p.respawnAt !== null ? r3(Math.max(0, p.respawnAt - s.time)) : null,
        weapon: p.weapon,
        build: p.build,
        wood: p.wood,
        metal: p.metal,
        medkits: p.medkits,
        shells: p.shells,
        lives: p.lives,
        heavy: p.heavy,
        heavyAmmo: p.heavyAmmo,
        turrets: p.turrets,
        kills: p.kills,
        zombieKills: p.zombieKills,
        deaths: p.deaths,
        shotAt: r3(p.shotAt),
        hurtAt: r3(p.hurtAt),
        knifeAt: r3(p.knifeAt),
        knifeDirX: p.knifeDir.x,
        knifeDirY: p.knifeDir.y,
        inBase,
        onCrate: playerOnOwnCrate(s, p),
        buildHint: hint ? { x: hint.x, y: hint.y, ok: hint.ok, label: hint.label, orient: hint.orient } : null,
      };
    }),
    zombies: s.zombies.map((z): ZombieTuple => [z.id, r3(z.x), r3(z.y), z.hp, z.maxHp, ZOMBIE_KIND[z.kind], r3(z.attackAt), r3(z.hurtAt)]),
    bullets: s.bullets.map((b) => [b.id, r3(b.x), r3(b.y), r3(b.vx), r3(b.vy), PROJECTILE[b.kind]]),
    structures: [...s.structures].map(([key, st]) => [key, STRUCTURE_TYPE[st.type], st.hp, st.maxHp, st.owner as Slot, st.orient]),
    cores: { 1: s.cores[1].hp, 2: s.cores[2].hp },
    crates: { 1: { ...s.crates[1] }, 2: { ...s.crates[2] } },
    armory: {
      available: s.armory.available,
      openedBy: s.armory.openedBy,
      progress: Object.fromEntries(
        s.players.filter((p) => s.armory.progress[p.id] !== undefined).map((p) => [p.slot, r3(s.armory.progress[p.id])]),
      ),
    },
    pickups: s.pickups.map((it): [number, number, number, number] => [it.id, r3(it.x), r3(it.y), PICKUP_KIND[it.kind]]),
    props: {
      destroyed: [...s.destroyedProps],
      damaged: [...s.props].filter(([, p]) => p.hp < p.maxHp).map(([i, p]) => [i, p.hp, p.maxHp]),
    },
    turrets: [...s.structures]
      .filter(([, st]) => st.type === 'turret')
      .map(([key, st]) => [
        key,
        r3(st.aimX ?? 0),
        r3(st.aimY ?? 1),
        st.ammo ?? 0,
        s.time < (st.reloadUntil ?? 0) ? 1 : 0,
        st.shotAt !== undefined && s.time - st.shotAt < 0.15 ? 1 : 0,
      ]),
    events,
    result: s.result ? { ...s.result } : null,
  };
}
