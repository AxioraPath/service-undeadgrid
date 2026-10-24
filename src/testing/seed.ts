import { randomUUID } from 'crypto';
import { z } from 'zod';

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
const DIFFICULTIES = ['easy', 'normal', 'hard'];
const MAPS = ['map-1', 'map-2', 'map-3'];
const SURVIVORS = ['soldier', 'engineer', 'medic'];

export interface SyntheticMatch {
  id: string;
  code: string;
  mapId: string;
  difficulty: string;
  seed: bigint;
  durationS: number;
  reason: string;
}
export interface SyntheticPlayer {
  matchId: string;
  userId: null;
  slot: number;
  name: string;
  survivor: string;
  isWinner: boolean;
  coreHpEnd: number;
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
    matches.push({
      id,
      code: `${SEED_CODE_PREFIX}${String(i).padStart(4, '0')}`,
      mapId: pick(MAPS),
      difficulty: pick(DIFFICULTIES),
      seed: BigInt(Math.floor(rng() * 2 ** 31)),
      durationS: 60 + Math.floor(rng() * 840),
      reason,
    });
    for (const slot of [1, 2]) {
      const isWinner = slot === winnerSlot;
      players.push({
        matchId: id,
        userId: null,
        slot,
        name: `seed-bot-${i * 2 + slot}`,
        survivor: pick(SURVIVORS),
        isWinner,
        coreHpEnd: isWinner ? 1 + Math.floor(rng() * 100) : 0,
      });
    }
  }
  return { matches, players };
}
