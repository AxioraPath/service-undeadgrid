import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { Room } from '../domain/room';
import type { Slot } from '../config/game.config';
import { ProgressionService } from '../progression/progression.service';
import { MIN_MATCH_DURATION_S, computeMatchXp } from '../progression/xp';

/** Estadísticas de combate de un jugador al terminar la partida. */
export interface CombatStats {
  kills: number;
  zombieKills: number;
  deaths: number;
  structuresBuilt: number;
  timeAliveS: number;
}

const EMPTY: CombatStats = { kills: 0, zombieKills: 0, deaths: 0, structuresBuilt: 0, timeAliveS: 0 };

/**
 * Datos de la partida que salen del motor (src/game): duración real simulada,
 * oleada máxima y las estadísticas de combate de cada slot.
 */
export function matchSummary(room: Room): {
  durationS: number;
  maxWave: number;
  bySlot: Record<Slot, CombatStats>;
} {
  const match = room.match;
  const bySlot: Record<Slot, CombatStats> = { 1: { ...EMPTY }, 2: { ...EMPTY } };
  if (!match) return { durationS: 0, maxWave: 0, bySlot };
  for (const p of match.players) {
    bySlot[p.slot] = {
      kills: p.kills,
      zombieKills: p.zombieKills,
      deaths: p.deaths,
      structuresBuilt: p.structuresBuilt,
      timeAliveS: Math.round(p.timeAlive),
    };
  }
  return { durationS: Math.round(match.time), maxWave: match.maxWave, bySlot };
}

/** XP earned per slot for a finished match (same function used for persistence and the match:over event). */
export function matchXpBySlot(room: Room): Record<number, number> {
  const result = room.result;
  const out: Record<number, number> = {};
  if (!result) return out;
  const { durationS, bySlot } = matchSummary(room);
  for (const p of room.players.values()) {
    const won = result.winner === p.slot;
    const c = bySlot[p.slot];
    out[p.slot] = computeMatchXp({
      won,
      draw: result.winner === null,
      zombieKills: c.zombieKills,
      playerKills: c.kills,
      structuresBuilt: c.structuresBuilt,
      coreDestroyedWin: won && result.reason === 'core_destroyed',
      durationS,
    });
  }
  return out;
}

/**
 * Persiste el resultado de una partida y actualiza las estadísticas de los
 * jugadores que tenían cuenta (userId). Los invitados se registran en el
 * historial pero sin actualizar stats (no tienen fila).
 */
@Injectable()
export class MatchStatsService {
  private readonly logger = new Logger(MatchStatsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly progression: ProgressionService,
  ) {}

  async persistMatch(room: Room): Promise<void> {
    const result = room.result;
    if (!result) return;

    const players = [...room.players.values()];
    const { durationS, maxWave, bySlot } = matchSummary(room);
    const xpBySlot = matchXpBySlot(room);
    const now = new Date();

    try {
      await this.prisma.$transaction(async (tx) => {
        const match = await tx.matchHistory.create({
          data: {
            code: room.code,
            mapId: room.mapId,
            difficulty: room.difficulty,
            seed: BigInt(room.seed),
            durationS,
            reason: result.reason,
            maxWave,
            players: {
              create: players.map((p) => ({
                userId: p.userId,
                slot: p.slot,
                name: p.name,
                survivor: p.survivor,
                isWinner: result.winner === p.slot,
                coreHpEnd: room.cores[p.slot] ?? 0,
                ...bySlot[p.slot],
              })),
            },
          },
        });

        // Actualiza stats de cada jugador autenticado.
        for (const p of players) {
          if (!p.userId) continue;
          const won = result.winner === p.slot;
          const draw = result.winner === null;
          const lost = !won && !draw;
          const combat = bySlot[p.slot];
          // XP + missions first, so milestone rows seeded from lifetime stats don't double count this match.
          const counts = durationS >= MIN_MATCH_DURATION_S;
          await this.progression.recordMatch(tx, p.userId, now, {
            xpGained: xpBySlot[p.slot] ?? 0,
            deltas: {
              matches_played: counts ? 1 : 0,
              matches_won: counts && won ? 1 : 0,
              zombie_kills: combat.zombieKills,
              player_kills: combat.kills,
              structures_built: combat.structuresBuilt,
            },
          });
          const existing = await tx.playerStats.findUnique({ where: { userId: p.userId } });
          const newStreak = won ? (existing?.currentStreak ?? 0) + 1 : 0;
          await tx.playerStats.update({
            where: { userId: p.userId },
            data: {
              matchesPlayed: { increment: 1 },
              wins: { increment: won ? 1 : 0 },
              losses: { increment: lost ? 1 : 0 },
              draws: { increment: draw ? 1 : 0 },
              coresDestroyed: { increment: won && result.reason === 'core_destroyed' ? 1 : 0 },
              playerKills: { increment: combat.kills },
              zombiesKilled: { increment: combat.zombieKills },
              deaths: { increment: combat.deaths },
              structuresBuilt: { increment: combat.structuresBuilt },
              totalPlaytimeS: { increment: durationS },
              currentStreak: newStreak,
              bestStreak: Math.max(existing?.bestStreak ?? 0, newStreak),
            },
          });
        }

        return match;
      });
      this.logger.log(`Partida ${room.code} persistida (reason=${result.reason}).`);
    } catch (err) {
      // No romper el flujo del juego si falla la persistencia.
      this.logger.error(`No se pudo persistir la partida ${room.code}: ${String(err)}`);
    }
  }
}
