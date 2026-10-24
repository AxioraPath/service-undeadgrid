/** Agregados que la base de datos entrega en una sola pasada (ver TestingService.telemetry). */
export interface TelemetryInput {
  totalMatches: number;
  avgDurationS: number | null;
  avgMaxWave: number | null;
  /** Match count per end reason (core_destroyed | time_out | opponent_left). */
  reasonCounts: Record<string, number>;
  /** Partidas ganadas por cada slot (1 = anfitrión/base azul, 2 = retador/base roja). */
  winsBySlot: Record<number, number>;
  /** Sumas sobre MatchPlayer (incluye invitados y partidas sembradas). */
  players: {
    total: number;
    winners: number;
    kills: number;
    zombieKills: number;
    deaths: number;
    timeAliveS: number;
    coresAlive: number;
  };
}

export interface Telemetry {
  totalMatches: number;
  /** Partidas ganadas / filas de jugador (≈ 0.5 sin empates). */
  winRate: number;
  winRateBySlot: { host: number; challenger: number };
  /** Eliminaciones de jugadores / muertes. */
  kdr: number;
  /** Zombis eliminados por cada muerte. */
  zombiesPerDeath: number;
  avgDurationS: number;
  survival: {
    avgDurationS: number;
    /** % de partidas que terminaron por tiempo (nadie cayó antes). */
    timeOutPct: number;
    avgWaveReached: number;
    avgTimeAliveS: number;
    /** % de núcleos que seguían en pie al final. */
    coresSurvivedPct: number;
  };
}

const round = (n: number, d = 4): number => {
  const f = 10 ** d;
  return Math.round(n * f) / f;
};

/**
 * Agregación pura (sin acceso a BD). Todo sale de MatchHistory/MatchPlayer, que
 * guardan tanto partidas reales (stats del motor) como las sembradas con /seed.
 */
export function computeTelemetry(input: TelemetryInput): Telemetry {
  const { totalMatches, players, reasonCounts, winsBySlot } = input;
  const avg = input.avgDurationS ?? 0;
  const perMatch = (n: number) => (totalMatches > 0 ? n / totalMatches : 0);

  return {
    totalMatches,
    winRate: round(players.total > 0 ? players.winners / players.total : 0),
    winRateBySlot: { host: round(perMatch(winsBySlot[1] ?? 0)), challenger: round(perMatch(winsBySlot[2] ?? 0)) },
    kdr: round(players.kills / Math.max(players.deaths, 1), 2),
    zombiesPerDeath: round(players.zombieKills / Math.max(players.deaths, 1), 2),
    avgDurationS: round(avg, 2),
    survival: {
      avgDurationS: round(avg, 2),
      timeOutPct: round(perMatch(reasonCounts['time_out'] ?? 0) * 100, 2),
      avgWaveReached: round(input.avgMaxWave ?? 0, 2),
      avgTimeAliveS: round(players.total > 0 ? players.timeAliveS / players.total : 0, 2),
      coresSurvivedPct: round(players.total > 0 ? (players.coresAlive / players.total) * 100 : 0, 2),
    },
  };
}
