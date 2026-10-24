import { createHash, randomBytes } from 'crypto';
import {
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface PublicUser {
  id: string;
  email: string;
  displayName: string;
}

const ACCESS_TTL = '15m';
const REFRESH_TTL_DAYS = 30;
const RESET_TTL_MS = 60 * 60 * 1000; // 1 hora

/** Hash SHA-256 para tokens opacos que guardamos en BD (no reversibles). */
const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly email: EmailService,
  ) {}

  private accessSecret(): string {
    return this.config.get<string>('JWT_ACCESS_SECRET') ?? 'dev-access-secret-change-me';
  }

  private refreshSecret(): string {
    return this.config.get<string>('JWT_REFRESH_SECRET') ?? 'dev-refresh-secret-change-me';
  }

  private toPublic(u: { id: string; email: string; displayName: string }): PublicUser {
    return { id: u.id, email: u.email, displayName: u.displayName };
  }

  /** Registro: crea usuario + perfil + stats en una transacción. */
  async register(displayName: string, email: string, password: string): Promise<{ user: PublicUser; tokens: AuthTokens }> {
    const normEmail = email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email: normEmail } });
    if (existing) throw new ConflictException('Ya existe una cuenta con ese correo.');

    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await this.prisma.user.create({
      data: {
        email: normEmail,
        displayName: displayName.trim().slice(0, 16),
        passwordHash,
        profile: { create: {} },
        stats: { create: {} },
      },
    });
    this.logger.log(`Usuario registrado: ${normEmail}`);
    const tokens = await this.issueTokens(user.id, user.email);
    return { user: this.toPublic(user), tokens };
  }

  /** Login: valida credenciales y emite tokens. */
  async login(email: string, password: string): Promise<{ user: PublicUser; tokens: AuthTokens }> {
    const normEmail = email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email: normEmail } });
    // Mensaje genérico para no revelar si el correo existe.
    const invalid = () => new UnauthorizedException('Correo o contraseña incorrectos.');
    if (!user) {
      // Trabajo ficticio para igualar tiempos y mitigar enumeración por timing.
      await argon2.hash(password).catch(() => undefined);
      throw invalid();
    }
    const ok = await argon2.verify(user.passwordHash, password).catch(() => false);
    if (!ok) throw invalid();

    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    const tokens = await this.issueTokens(user.id, user.email);
    return { user: this.toPublic(user), tokens };
  }

  /** Emite access (JWT corto) + refresh (opaco, hasheado en BD). */
  async issueTokens(userId: string, email: string): Promise<AuthTokens> {
    const accessToken = await this.jwt.signAsync(
      { sub: userId, email },
      { secret: this.accessSecret(), expiresIn: ACCESS_TTL },
    );
    const refreshRaw = randomBytes(48).toString('hex');
    const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);
    await this.prisma.refreshToken.create({
      data: { userId, tokenHash: sha256(refreshRaw), expiresAt },
    });
    return { accessToken, refreshToken: refreshRaw };
  }

  /** Renueva tokens a partir de un refresh válido (rotación). */
  async refresh(refreshRaw: string): Promise<AuthTokens> {
    const tokenHash = sha256(refreshRaw);
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash }, include: { user: true } });
    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Sesión inválida o expirada.');
    }
    // Rotación: revoca el actual y emite uno nuevo.
    await this.prisma.refreshToken.update({ where: { tokenHash }, data: { revokedAt: new Date() } });
    return this.issueTokens(stored.userId, stored.user.email);
  }

  /** Cierra sesión revocando el refresh token. */
  async logout(refreshRaw: string | undefined): Promise<void> {
    if (!refreshRaw) return;
    const tokenHash = sha256(refreshRaw);
    await this.prisma.refreshToken.updateMany({ where: { tokenHash }, data: { revokedAt: new Date() } });
  }

  /** Verifica un access token (usado por el guard HTTP y el socket). */
  async verifyAccess(token: string): Promise<{ sub: string; email: string }> {
    return this.jwt.verifyAsync(token, { secret: this.accessSecret() });
  }

  /**
   * Inicia recuperación. Siempre responde igual (no revela si el correo existe).
   * Genera un token opaco, guarda su hash con expiración, y envía el email.
   */
  async forgotPassword(email: string): Promise<void> {
    const normEmail = email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email: normEmail } });
    if (!user) return; // respuesta uniforme

    const raw = randomBytes(32).toString('hex');
    await this.prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash: sha256(raw), expiresAt: new Date(Date.now() + RESET_TTL_MS) },
    });
    await this.email.sendPasswordReset(normEmail, raw);
  }

  /** Aplica el reset: valida token, cambia contraseña, invalida sesiones. */
  async resetPassword(rawToken: string, newPassword: string): Promise<void> {
    const tokenHash = sha256(rawToken);
    const token = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash } });
    if (!token || token.usedAt || token.expiresAt < new Date()) {
      throw new UnauthorizedException('El enlace es inválido o ha expirado.');
    }
    const passwordHash = await argon2.hash(newPassword, { type: argon2.argon2id });
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: token.userId }, data: { passwordHash } }),
      this.prisma.passwordResetToken.update({ where: { tokenHash }, data: { usedAt: new Date() } }),
      // Revoca todas las sesiones activas por seguridad.
      this.prisma.refreshToken.updateMany({ where: { userId: token.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    this.logger.log(`Contraseña restablecida para userId=${token.userId}`);
  }
}
