import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { buildSyntheticMatches, SEED_CODE_PREFIX } from './seed';
import { computeTelemetry, type Telemetry } from './telemetry';

const BATCH = 500;

@Injectable()
export class TestingService {
  constructor(private readonly prisma: PrismaService) {}

  async telemetry(): Promise<Telemetry & { generatedAt: string; queryMs: number }> {
    const t0 = performance.now();
    const [matchAgg, reasons, statsAgg, playerTotal, playerWinners] = await Promise.all([
      this.prisma.matchHistory.aggregate({ _count: { _all: true }, _avg: { durationS: true } }),
      this.prisma.matchHistory.groupBy({ by: ['reason'], _count: { _all: true } }),
      this.prisma.playerStats.aggregate({
        _sum: {
          matchesPlayed: true,
          wins: true,
          losses: true,
          coresDestroyed: true,
          zombiesKilled: true,
        },
      }),
      this.prisma.matchPlayer.count(),
      this.prisma.matchPlayer.count({ where: { isWinner: true } }),
    ]);

    const s = statsAgg._sum;
    const result = computeTelemetry({
      totalMatches: matchAgg._count._all,
      avgDurationS: matchAgg._avg.durationS,
      reasonCounts: Object.fromEntries(reasons.map((r) => [r.reason, r._count._all])),
      stats: {
        matchesPlayed: s.matchesPlayed ?? 0,
        wins: s.wins ?? 0,
        losses: s.losses ?? 0,
        coresDestroyed: s.coresDestroyed ?? 0,
        zombiesKilled: s.zombiesKilled ?? 0,
      },
      players: { total: playerTotal, winners: playerWinners },
    });
    return {
      ...result,
      generatedAt: new Date().toISOString(),
      queryMs: Math.round(performance.now() - t0),
    };
  }

  async seed(matches: number, seed?: number): Promise<{ inserted: number; durationMs: number }> {
    const t0 = performance.now();
    const data = buildSyntheticMatches(matches, seed ?? Date.now() % 2 ** 31);
    for (let i = 0; i < data.matches.length; i += BATCH) {
      await this.prisma.$transaction([
        this.prisma.matchHistory.createMany({ data: data.matches.slice(i, i + BATCH) }),
        this.prisma.matchPlayer.createMany({ data: data.players.slice(i * 2, (i + BATCH) * 2) }),
      ]);
    }
    return { inserted: data.matches.length, durationMs: Math.round(performance.now() - t0) };
  }

  /** Deletes synthetic matches (code prefix "SEED"); players cascade. */
  async clean(): Promise<{ deleted: number }> {
    const r = await this.prisma.matchHistory.deleteMany({
      where: { code: { startsWith: SEED_CODE_PREFIX } },
    });
    return { deleted: r.count };
  }
}
