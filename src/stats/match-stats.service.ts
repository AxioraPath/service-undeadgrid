import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { Room } from '../domain/room';

/**
 * Persiste el resultado de una partida y actualiza las estadísticas de los
 * jugadores que tenían cuenta (userId). Los invitados se registran en el
 * historial pero sin actualizar stats (no tienen fila).
 */
@Injectable()
export class MatchStatsService {
  private readonly logger = new Logger(MatchStatsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async persistMatch(room: Room): Promise<void> {
    const result = room.result;
    if (!result) return;

    const players = [...room.players.values()];
    const durationS = room.combatStartedAt
      ? Math.round((Date.now() - room.combatStartedAt) / 1000)
      : 0;

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
            players: {
              create: players.map((p) => ({
                userId: p.userId,
                slot: p.slot,
                name: p.name,
                survivor: p.survivor,
                isWinner: result.winner === p.slot,
                coreHpEnd: room.cores[p.slot] ?? 0,
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
