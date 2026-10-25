import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { buildSyntheticMatches, SEED_CODE_PREFIX } from './seed';
import { computeTelemetry, type Telemetry } from './telemetry';

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
    // Two multi-row INSERT ... SELECT FROM unnest(...) statements in one transaction: a single round trip per
    // table and no per-row parameters. synchronous_commit only applies to this transaction (no WAL fsync wait).
    const m = data.matches;
    const p = data.players;
    await this.prisma.$transaction([
      this.prisma.$executeRaw`SET LOCAL synchronous_commit = off`,
      this.prisma.$executeRaw`
        INSERT INTO match_history ("id", "code", "mapId", "difficulty", "seed", "durationS", "reason", "maxWave")
        SELECT * FROM unnest(
          ${m.map((x) => x.id)}::text[], ${m.map((x) => x.code)}::text[], ${m.map((x) => x.mapId)}::text[],
          ${m.map((x) => x.difficulty)}::text[], ${m.map((x) => x.seed.toString())}::bigint[],
          ${m.map((x) => x.durationS)}::int[], ${m.map((x) => x.reason)}::text[], ${m.map((x) => x.maxWave)}::int[])`,
      this.prisma.$executeRaw`
        INSERT INTO match_players ("id", "matchId", "slot", "name", "survivor", "isWinner", "coreHpEnd",
                                   "kills", "zombieKills", "deaths", "structuresBuilt", "timeAliveS")
        SELECT gen_random_uuid()::text, t.* FROM unnest(
          ${p.map((x) => x.matchId)}::text[], ${p.map((x) => x.slot)}::int[], ${p.map((x) => x.name)}::text[],
          ${p.map((x) => x.survivor)}::text[], ${p.map((x) => x.isWinner)}::boolean[],
          ${p.map((x) => x.coreHpEnd)}::int[], ${p.map((x) => x.kills)}::int[], ${p.map((x) => x.zombieKills)}::int[],
          ${p.map((x) => x.deaths)}::int[], ${p.map((x) => x.structuresBuilt)}::int[],
          ${p.map((x) => x.timeAliveS)}::int[]) AS t`,
    ]);
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
