import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProgressionService } from '../progression/progression.service';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly progression: ProgressionService,
  ) {}

  /** Perfil público + datos de juego del usuario autenticado. */
  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { profile: true, stats: true },
    });
    if (!user) throw new NotFoundException('Usuario no encontrado.');
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      createdAt: user.createdAt,
      profile: {
        ...ProgressionService.profileView(user.profile ?? { level: 1, xp: 0 }),
        preferredSurvivor: user.profile?.preferredSurvivor ?? 'explorador',
      },
      stats: this.serializeStats(user.stats),
    };
  }

  getMissions(userId: string) {
    return this.progression.getMissions(userId);
  }

  claimMission(userId: string, key: string) {
    return this.progression.claim(userId, key);
  }

  async getStats(userId: string) {
    const stats = await this.prisma.playerStats.findUnique({ where: { userId } });
    if (!stats) throw new NotFoundException('Estadísticas no encontradas.');
    return this.serializeStats(stats);
  }

  /** Actualiza el nombre visible y/o el superviviente preferido. */
  async updateProfile(userId: string, data: { displayName?: string; preferredSurvivor?: string }) {
    if (data.displayName !== undefined) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { displayName: data.displayName.trim().slice(0, 16) },
      });
    }
    if (data.preferredSurvivor !== undefined) {
      await this.prisma.playerProfile.update({
        where: { userId },
        data: { preferredSurvivor: data.preferredSurvivor },
      });
    }
    return this.getMe(userId);
  }

  // BigInt no es serializable a JSON por defecto; aquí no hay BigInt en stats,
  // pero dejamos el passthrough por claridad/futuro.
  private serializeStats<T>(stats: T): T {
    return stats;
  }
}
