import { Injectable } from '@nestjs/common';
import { RATE_LIMITS, type RateLimitedEvent } from '../config/game.config';

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Rate limiter en memoria con ventana fija por (socketId, evento).
 * Suficiente para un único nodo (sin Redis). Si se escala a varios nodos habrá
 * que mover esto a un store compartido.
 */
@Injectable()
export class RateLimiterService {
  private readonly buckets = new Map<string, Bucket>();

  /** Devuelve true si la acción se permite; false si excede el límite. */
  allow(socketId: string, event: string, now = Date.now()): boolean {
    const rule =
      (RATE_LIMITS as Record<string, { points: number; windowMs: number }>)[event] ??
      RATE_LIMITS.default;
    const key = `${socketId}:${event}`;
    const bucket = this.buckets.get(key);

    if (!bucket || now >= bucket.resetAt) {
      this.buckets.set(key, { count: 1, resetAt: now + rule.windowMs });
      return true;
    }
    if (bucket.count >= rule.points) return false;
    bucket.count++;
    return true;
  }

  /** Limpia todos los buckets de un socket (al desconectar). */
  clear(socketId: string): void {
    for (const key of this.buckets.keys()) {
      if (key.startsWith(`${socketId}:`)) this.buckets.delete(key);
    }
  }

  /** Mantenimiento: elimina buckets expirados. */
  sweep(now = Date.now()): void {
    for (const [key, bucket] of this.buckets) {
      if (now >= bucket.resetAt) this.buckets.delete(key);
    }
  }

  /** Expuesto por tipado; evita import no usado si cambia la config. */
  knownEvents(): RateLimitedEvent[] {
    return Object.keys(RATE_LIMITS) as RateLimitedEvent[];
  }
}
