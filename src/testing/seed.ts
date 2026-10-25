import { randomUUID } from 'crypto';
import { z } from 'zod';
import { DIFFICULTIES, MAP_IDS, MATCH_DURATION, PHASES, UNLOCKED_SURVIVORS } from '../config/game.config';

export const SEED_CODE_PREFIX = 'SEED';

export const seedBodySchema = z.object({
  matches: z.number().int().min(100).max(1000),
  seed: z.number().int().optional(),
});
export type SeedBody = z.infer<typeof seedBodySchema>;

/** Small deterministic PRNG (mulberry32). */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const REASONS = ['core_destroyed', 'time_out', 'opponent_left'] as const;
/** La preparación dura 60 s; luego una oleada por minuto (la horda final cuenta como 3). */
/** Oleada más alta alcanzada a los `seconds` de partida (fases de 1v1/2v2). */
const waveAt = (seconds: number) => PHASES.filter((p) => p.wave > 0 && seconds >= p.start).length;

export interface SyntheticMatch {
  id: string;
  code: string;
  mapId: string;
  difficulty: string;
  seed: bigint;
  durationS: number;
  reason: string;
  maxWave: number;
}
export interface SyntheticPlayer {
  matchId: string;
  userId: null;
  slot: number;
  name: string;
  survivor: string;
  isWinner: boolean;
  coreHpEnd: number;
  kills: number;
  zombieKills: number;
  deaths: number;
  structuresBuilt: number;
  timeAliveS: number;
}

/** Builds synthetic rows; fields are deterministic for a given seed (ids are random). */
export function buildSyntheticMatches(
  count: number,
  seed: number,
): { matches: SyntheticMatch[]; players: SyntheticPlayer[] } {
  const rng = createRng(seed);
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)];
  const matches: SyntheticMatch[] = [];
  const players: SyntheticPlayer[] = [];
  for (let i = 0; i < count; i++) {
    const id = randomUUID();
    const reason = pick(REASONS);
    const winnerSlot = rng() < 0.5 ? 1 : 2;
    // Duraciones dentro de las reglas: por tiempo = MATCH_DURATION; el resto termina antes.
    const durationS =
      reason === 'time_out'
        ? MATCH_DURATION
        : reason === 'core_destroyed'
          ? 90 + Math.floor(rng() * (MATCH_DURATION - 90))
          : 20 + Math.floor(rng() * (MATCH_DURATION - 20));
    const maxWave = waveAt(durationS);
    matches.push({
      id,
      code: `${SEED_CODE_PREFIX}${String(i).padStart(4, '0')}`,
      mapId: pick(MAP_IDS),
      difficulty: pick(DIFFICULTIES),
      seed: BigInt(Math.floor(rng() * 2 ** 31)),
      durationS,
      reason,
      maxWave,
    });
    for (const slot of [1, 2]) {
      const isWinner = slot === winnerSlot;
      // Valores plausibles: más zombis y combate cuanto más avanza la partida.
      const combatS = Math.max(0, durationS - PHASES[0].end);
      const deaths = Math.floor(rng() * (1 + combatS / 50)) + (isWinner ? 0 : 1);
      const kills = Math.floor(rng() * (1 + combatS / 70)) + (isWinner ? 1 : 0);
      players.push({
        matchId: id,
        userId: null,
        slot,
        name: `seed-bot-${i * 2 + slot}`,
        survivor: pick(UNLOCKED_SURVIVORS),
        isWinner,
        coreHpEnd: reason === 'core_destroyed' && !isWinner ? 0 : 50 + Math.floor(rng() * 451),
        kills,
        zombieKills: Math.floor(rng() * (2 + combatS / 6)),
        deaths,
        structuresBuilt: 2 + Math.floor(rng() * 12),
        timeAliveS: Math.max(0, durationS - deaths * 5 - Math.floor(rng() * 20)),
      });
    }
  }
  return { matches, players };
}
