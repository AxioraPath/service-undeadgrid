import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service';

export interface AuthedRequest extends Request {
  user?: { sub: string; email: string };
}

/** Protege rutas HTTP exigiendo un access token válido (Bearer o cookie). */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization;
    const token =
      header && header.startsWith('Bearer ')
        ? header.slice(7)
        : (req.cookies?.['access_token'] as string | undefined);
    if (!token) throw new UnauthorizedException('No autenticado.');
    try {
      req.user = await this.auth.verifyAccess(token);
      return true;
    } catch {
      throw new UnauthorizedException('Token inválido o expirado.');
    }
  }
}
