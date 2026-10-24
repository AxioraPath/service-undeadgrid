import { createHash } from 'crypto';
import { DAILY_MISSIONS, type MissionDef, type MissionMetric } from './missions.catalog';

export type MissionStatus = 'active' | 'completed' | 'claimed';
export const DAILIES_PER_DAY = 3;
export const MILESTONE_PERIOD = 'all';

/** UTC day key, e.g. "2026-10-24". */
export function dayKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** Next UTC midnight after `now`. */
export function nextUtcMidnight(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

/** Deterministic PRNG (mulberry32). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Picks `count` distinct daily missions, deterministic for (userId, date). */
export function pickDailyMissions(
  userId: string,
  date: string,
  pool: readonly MissionDef[] = DAILY_MISSIONS,
  count = DAILIES_PER_DAY,
): MissionDef[] {
  const seed = createHash('sha256').update(`${userId}:${date}`).digest().readUInt32BE(0);
  const rnd = mulberry32(seed);
  const arr = [...pool];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, Math.min(count, arr.length));
}

export type MetricUpdate = Partial<Record<MissionMetric, number>>;

/**
 * New progress (capped at goal) after a match. Counter metrics add their delta;
 * level_reached takes the max with the current level.
 */
export function nextProgress(def: MissionDef, current: number, update: MetricUpdate): number {
  const v = update[def.metric];
  if (v === undefined || !Number.isFinite(v)) return Math.min(current, def.goal);
  const next = def.metric === 'level_reached' ? Math.max(current, v) : current + Math.max(0, v);
  return Math.min(def.goal, Math.max(0, Math.floor(next)));
}

export function missionStatus(row: { completedAt: Date | null; claimedAt: Date | null }): MissionStatus {
  if (row.claimedAt) return 'claimed';
  if (row.completedAt) return 'completed';
  return 'active';
}

export type ClaimCheck = 'ok' | 'not_completed' | 'already_claimed';

export function checkClaim(row: { completedAt: Date | null; claimedAt: Date | null }): ClaimCheck {
  if (row.claimedAt) return 'already_claimed';
  if (!row.completedAt) return 'not_completed';
  return 'ok';
}
