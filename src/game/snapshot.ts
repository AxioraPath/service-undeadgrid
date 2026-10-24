import type { GameMapDto, GameStateDto, ZombieTuple } from '../contracts/game';
import type { Slot } from './constants';
import { phaseOf, playerInOwnBase, playerOnOwnCrate, previewBuild, type MatchState } from './engine';

const ZOMBIE_KIND = { normal: 0, fast: 1, tank: 2 } as const;
const STRUCTURE_TYPE = { wood: 0, reinforced: 1, trap: 2 } as const;

/** Redondea a milésimas para que el JSON viaje más ligero. */
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function encodeMap(s: MatchState): GameMapDto {
  const m = s.map;
  return {
    seed: m.seed,
    w: m.w,
    h: m.h,
    tiles: Array.from(m.tiles),
    ground: Array.from(m.ground),
    objects: m.objects.map((o) => ({ ...o })),
    bases: { 1: { ...m.bases[1] }, 2: { ...m.bases[2] } },
    cores: { 1: { ...m.cores[1] }, 2: { ...m.cores[2] } },
    crates: { 1: { ...m.crates[1] }, 2: { ...m.crates[2] } },
    spawns: m.spawns.map((p) => ({ ...p })),
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
        name: p.name,
        survivor: p.survivor,
        x: r3(p.x),
        y: r3(p.y),
        dirX: r3(p.dirX),
        dirY: r3(p.dirY),
        hp: p.hp,
        alive: p.alive,
        respawnIn: p.respawnAt !== null ? r3(Math.max(0, p.respawnAt - s.time)) : null,
        weapon: p.weapon,
        build: p.build,
        wood: p.wood,
        metal: p.metal,
        medkits: p.medkits,
        shells: p.shells,
        kills: p.kills,
        zombieKills: p.zombieKills,
        deaths: p.deaths,
        shotAt: r3(p.shotAt),
        hurtAt: r3(p.hurtAt),
        inBase,
        onCrate: playerOnOwnCrate(s, p),
        buildHint: hint ? { x: hint.x, y: hint.y, ok: hint.ok, label: hint.label } : null,
      };
    }),
    zombies: s.zombies.map((z): ZombieTuple => [z.id, r3(z.x), r3(z.y), z.hp, z.maxHp, ZOMBIE_KIND[z.kind], r3(z.attackAt), r3(z.hurtAt)]),
    bullets: s.bullets.map((b) => [b.id, r3(b.x), r3(b.y), r3(b.vx), r3(b.vy)]),
    structures: [...s.structures].map(([key, st]) => [key, STRUCTURE_TYPE[st.type], st.hp, st.maxHp, st.owner as Slot]),
    cores: { 1: s.cores[1].hp, 2: s.cores[2].hp },
    crates: { 1: { ...s.crates[1] }, 2: { ...s.crates[2] } },
    events,
    result: s.result ? { ...s.result } : null,
  };
}
