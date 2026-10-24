/** Pure XP / level helpers (no I/O). */

export const MAX_LEVEL = 100;
export const MIN_MATCH_DURATION_S = 30;
export const SHORT_MATCH_XP = 10;

export interface MatchXpInput {
  won: boolean;
  draw: boolean;
  zombieKills: number;
  playerKills: number;
  structuresBuilt: number;
  coreDestroyedWin: boolean;
  durationS: number;
}

const nonNeg = (n: number): number => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

/** XP earned by a player in one match. Matches under 30 s give a flat 10 xp (anti-farm). */
export function computeMatchXp(i: MatchXpInput): number {
  if (i.durationS < MIN_MATCH_DURATION_S) return SHORT_MATCH_XP;
  let xp = 50;
  if (i.won) xp += 100;
  else if (i.draw) xp += 40;
  xp += 3 * nonNeg(i.zombieKills);
  xp += 20 * nonNeg(i.playerKills);
  xp += Math.min(100, 2 * nonNeg(i.structuresBuilt));
  if (i.won && i.coreDestroyedWin) xp += 50;
  return xp;
}

/** XP needed to go from `level` to `level + 1`. */
export function xpToNext(level: number): number {
  return 100 + 50 * (Math.max(1, level) - 1);
}

export interface ApplyXpResult {
  level: number;
  /** Progress inside the current level (0 <= xp < xpToNext, 0 at max level). */
  xp: number;
  leveledUp: boolean;
  levelsGained: number;
}

export function applyXp(level: number, xp: number, gained: number): ApplyXpResult {
  let lvl = Math.min(MAX_LEVEL, Math.max(1, Math.floor(level)));
  let cur = Math.max(0, Math.floor(xp)) + nonNeg(gained);
  const start = lvl;
  while (lvl < MAX_LEVEL && cur >= xpToNext(lvl)) {
    cur -= xpToNext(lvl);
    lvl++;
  }
  if (lvl >= MAX_LEVEL) cur = 0;
  return { level: lvl, xp: cur, leveledUp: lvl > start, levelsGained: lvl - start };
}
