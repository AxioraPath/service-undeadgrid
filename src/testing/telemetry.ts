export interface TelemetryInput {
  totalMatches: number;
  avgDurationS: number | null;
  /** Match count per end reason (core_destroyed | time_out | opponent_left). */
  reasonCounts: Record<string, number>;
  /** Sums over PlayerStats (registered players). */
  stats: {
    matchesPlayed: number;
    wins: number;
    losses: number;
    coresDestroyed: number;
    zombiesKilled: number;
  };
  /** MatchPlayer rows (includes guests): total and winners. */
  players: { total: number; winners: number };
}

export interface Telemetry {
  totalMatches: number;
  winRate: number;
  kdr: number;
  avgDurationS: number;
  survival: { avgDurationS: number; timeOutPct: number };
}

const round = (n: number, d = 4): number => {
  const f = 10 ** d;
  return Math.round(n * f) / f;
};

/**
 * Pure aggregation (no DB access).
 *
 * - winRate: PlayerStats wins / matchesPlayed; when there are no registered
 *   stats, falls back to MatchPlayer winners / rows (guest-only data).
 * - kdr: "kills" (coresDestroyed + zombiesKilled) divided by losses
 *   (min. 1 to avoid division by zero). 0 with no stats.
 * - survival: average match duration and the percentage of matches that
 *   ended by time_out (nobody's core fell before the clock ran out).
 */
export function computeTelemetry(input: TelemetryInput): Telemetry {
  const { totalMatches, stats, players, reasonCounts } = input;
  const avg = input.avgDurationS ?? 0;

  let winRate = 0;
  if (stats.matchesPlayed > 0) winRate = stats.wins / stats.matchesPlayed;
  else if (players.total > 0) winRate = players.winners / players.total;

  const kdr = (stats.coresDestroyed + stats.zombiesKilled) / Math.max(stats.losses, 1);
  const timeOutPct = totalMatches > 0 ? ((reasonCounts['time_out'] ?? 0) / totalMatches) * 100 : 0;

  return {
    totalMatches,
    winRate: round(winRate),
    kdr: round(kdr, 2),
    avgDurationS: round(avg, 2),
    survival: { avgDurationS: round(avg, 2), timeOutPct: round(timeOutPct, 2) },
  };
}
