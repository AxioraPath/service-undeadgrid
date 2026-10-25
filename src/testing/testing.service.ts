import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { buildSyntheticMatches, SEED_CODE_PREFIX } from './seed';
import { computeTelemetry, type Telemetry } from './telemetry';

const BATCH = 1000;

@Injectable()
export class TestingService {
  constructor(private readonly prisma: PrismaService) {}

  async telemetry(): Promise<Telemetry & { generatedAt: string; queryMs: number }> {
    const t0 = performance.now();
    const [matchAgg, reasons, playerAgg, playerWinners, coresAlive, winsBySlot] = await Promise.all([
      this.prisma.matchHistory.aggregate({ _count: { _all: true }, _avg: { durationS: true, maxWave: true } }),
      this.prisma.matchHistory.groupBy({ by: ['reason'], _count: { _all: true } }),
      this.prisma.matchPlayer.aggregate({
        _count: { _all: true },
        _sum: { kills: true, zombieKills: true, deaths: true, timeAliveS: true },
      }),
      this.prisma.matchPlayer.count({ where: { isWinner: true } }),
      this.prisma.matchPlayer.count({ where: { coreHpEnd: { gt: 0 } } }),
      this.prisma.matchPlayer.groupBy({ by: ['slot'], where: { isWinner: true }, _count: { _all: true } }),
    ]);

    const sum = playerAgg._sum;
    const result = computeTelemetry({
      totalMatches: matchAgg._count._all,
      avgDurationS: matchAgg._avg.durationS,
      avgMaxWave: matchAgg._avg.maxWave,
      reasonCounts: Object.fromEntries(reasons.map((r) => [r.reason, r._count._all])),
      winsBySlot: Object.fromEntries(winsBySlot.map((w) => [w.slot, w._count._all])),
      players: {
        total: playerAgg._count._all,
        winners: playerWinners,
        kills: sum.kills ?? 0,
        zombieKills: sum.zombieKills ?? 0,
        deaths: sum.deaths ?? 0,
        timeAliveS: sum.timeAliveS ?? 0,
        coresAlive,
      },
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
    // One transaction, one multi-row INSERT per table. Synthetic rows do not need a WAL fsync on commit
    // (synchronous_commit only applies to this transaction), which is most of the insert latency.
    for (let i = 0; i < data.matches.length; i += BATCH) {
      await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL synchronous_commit = off`;
        await tx.matchHistory.createMany({ data: data.matches.slice(i, i + BATCH) });
        await tx.matchPlayer.createMany({ data: data.players.slice(i * 2, (i + BATCH) * 2) });
      });
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
