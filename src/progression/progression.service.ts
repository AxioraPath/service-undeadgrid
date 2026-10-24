import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MILESTONE_MISSIONS, MISSION_BY_KEY, type MissionDef } from './missions.catalog';
import {
  MILESTONE_PERIOD,
  checkClaim,
  dayKey,
  missionStatus,
  nextProgress,
  nextUtcMidnight,
  pickDailyMissions,
  type MetricUpdate,
} from './missions.logic';
import { applyXp, xpToNext, type ApplyXpResult } from './xp';

type Db = Prisma.TransactionClient;

export interface MatchProgressInput {
  xpGained: number;
  /** Counter deltas of this match (matches_played, zombie_kills, ...). */
  deltas: MetricUpdate;
}

@Injectable()
export class ProgressionService {
  constructor(private readonly prisma: PrismaService) {}

  /** Public profile shape shared by /me and claim responses. */
  static profileView(p: { level: number; xp: number }): { level: number; xp: number; xpToNext: number } {
    return { level: p.level, xp: p.xp, xpToNext: xpToNext(p.level) };
  }

  /** Lazily creates today's daily rows and the permanent milestone rows. */
  async ensureRows(db: Db, userId: string, now: Date): Promise<void> {
    const today = dayKey(now);
    const dailies = pickDailyMissions(userId, today);
    const existing = await db.userMission.findMany({
      where: { userId, periodKey: { in: [today, MILESTONE_PERIOD] } },
      select: { missionKey: true, periodKey: true },
    });
    const have = new Set(existing.map((r) => `${r.missionKey}|${r.periodKey}`));
    const missingDaily = dailies.filter((d) => !have.has(`${d.key}|${today}`));
    const missingMs = MILESTONE_MISSIONS.filter((m) => !have.has(`${m.key}|${MILESTONE_PERIOD}`));
    if (!missingDaily.length && !missingMs.length) return;

    const data: Prisma.UserMissionCreateManyInput[] = missingDaily.map((d) => ({
      userId,
      missionKey: d.key,
      periodKey: today,
    }));

    if (missingMs.length) {
      // Milestones start from the lifetime totals so existing players are not reset.
      const [stats, profile] = await Promise.all([
        db.playerStats.findUnique({ where: { userId } }),
        db.playerProfile.findUnique({ where: { userId } }),
      ]);
      const totals: MetricUpdate = {
        matches_played: stats?.matchesPlayed ?? 0,
        matches_won: stats?.wins ?? 0,
        zombie_kills: stats?.zombiesKilled ?? 0,
        player_kills: stats?.playerKills ?? 0,
        structures_built: stats?.structuresBuilt ?? 0,
        level_reached: profile?.level ?? 1,
      };
      for (const m of missingMs) {
        const progress = nextProgress(m, 0, { [m.metric]: totals[m.metric] ?? 0 });
        data.push({
          userId,
          missionKey: m.key,
          periodKey: MILESTONE_PERIOD,
          progress,
          completedAt: progress >= m.goal ? now : null,
        });
      }
    }
    await db.userMission.createMany({ data, skipDuplicates: true });
  }

  /** Adds XP to the profile (creating it if needed), under a row lock. */
  async awardXp(db: Db, userId: string, gained: number): Promise<ApplyXpResult> {
    await db.playerProfile.createMany({ data: [{ userId }], skipDuplicates: true });
    await db.$queryRaw`SELECT "userId" FROM "player_profiles" WHERE "userId" = ${userId} FOR UPDATE`;
    const profile = await db.playerProfile.findUniqueOrThrow({ where: { userId } });
    const res = applyXp(profile.level, profile.xp, gained);
    await db.playerProfile.update({ where: { userId }, data: { level: res.level, xp: res.xp } });
    return res;
  }

  /**
   * Called from persistMatch (inside its transaction) BEFORE stats are updated:
   * awards match XP and advances today's dailies + milestones.
   */
  async recordMatch(db: Db, userId: string, now: Date, input: MatchProgressInput): Promise<ApplyXpResult> {
    await this.ensureRows(db, userId, now);
    const xp = await this.awardXp(db, userId, input.xpGained);
    await this.advance(db, userId, now, { ...input.deltas, level_reached: xp.level });
    return xp;
  }

  private async advance(db: Db, userId: string, now: Date, update: MetricUpdate): Promise<void> {
    const rows = await db.userMission.findMany({
      where: { userId, periodKey: { in: [dayKey(now), MILESTONE_PERIOD] }, claimedAt: null },
    });
    for (const row of rows) {
      const def = MISSION_BY_KEY.get(row.missionKey);
      if (!def) continue;
      const progress = nextProgress(def, row.progress, update);
      if (progress === row.progress) continue;
      await db.userMission.update({
        where: { id: row.id },
        data: {
          progress,
          completedAt: progress >= def.goal && !row.completedAt ? now : undefined,
        },
      });
    }
  }

  async getMissions(userId: string) {
    const now = new Date();
    const today = dayKey(now);
    const reset = nextUtcMidnight(now).toISOString();
    await this.ensureRows(this.prisma, userId, now);
    const rows = await this.prisma.userMission.findMany({
      where: { userId, periodKey: { in: [today, MILESTONE_PERIOD] } },
    });
    const byKey = new Map(rows.map((r) => [`${r.missionKey}|${r.periodKey}`, r]));
    const defs: Array<{ def: MissionDef; period: string }> = [
      ...pickDailyMissions(userId, today).map((def) => ({ def, period: today })),
      ...MILESTONE_MISSIONS.map((def) => ({ def, period: MILESTONE_PERIOD })),
    ];
    const missions = defs.flatMap(({ def, period }) => {
      const row = byKey.get(`${def.key}|${period}`);
      if (!row) return [];
      return [
        {
          key: def.key,
          type: def.type,
          title: def.title,
          description: def.description,
          goal: def.goal,
          progress: Math.min(row.progress, def.goal),
          reward: def.reward,
          status: missionStatus(row),
          ...(def.type === 'daily' ? { resetsAt: reset } : {}),
        },
      ];
    });
    return { missions, dailyResetsAt: reset };
  }

  async claim(userId: string, key: string) {
    const def = MISSION_BY_KEY.get(key);
    if (!def) throw new NotFoundException('Misión no encontrada.');
    const now = new Date();
    const periodKey = def.type === 'daily' ? dayKey(now) : MILESTONE_PERIOD;
    if (def.type === 'daily' && !pickDailyMissions(userId, periodKey).some((d) => d.key === key)) {
      throw new NotFoundException('Misión no encontrada.');
    }

    return this.prisma.$transaction(async (tx) => {
      await this.ensureRows(tx, userId, now);
      // Atomic claim: only one concurrent request can flip claimedAt.
      const { count } = await tx.userMission.updateMany({
        where: { userId, missionKey: key, periodKey, completedAt: { not: null }, claimedAt: null },
        data: { claimedAt: now },
      });
      if (count === 0) {
        const row = await tx.userMission.findUnique({
          where: { userId_missionKey_periodKey: { userId, missionKey: key, periodKey } },
        });
        if (!row) throw new NotFoundException('Misión no encontrada.');
        if (checkClaim(row) === 'already_claimed') throw new ConflictException('Recompensa ya reclamada.');
        throw new BadRequestException('La misión aún no está completada.');
      }
      const res = await this.awardXp(tx, userId, def.reward);
      await this.advance(tx, userId, now, { level_reached: res.level });
      return {
        reward: def.reward,
        leveledUp: res.leveledUp,
        newLevel: res.level,
        profile: ProgressionService.profileView(res),
      };
    });
  }
}
