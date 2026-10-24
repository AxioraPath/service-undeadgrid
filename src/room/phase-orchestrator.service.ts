import { Injectable, Logger } from '@nestjs/common';
import { LIFECYCLE, PHASE_TICK_MS } from '../config/game.config';
import type { Room } from '../domain/room';
import { RoomService } from './room.service';

/**
 * Orquesta el avance de fases/combate de forma AUTORITATIVA en el servidor.
 * El gateway registra callbacks para emitir por red; este servicio no conoce
 * Socket.IO. Mantiene un único temporizador global de 1 Hz que recorre todas
 * las salas en combate, además del barrido de limpieza.
 */
@Injectable()
export class PhaseOrchestrator {
  private readonly logger = new Logger(PhaseOrchestrator.name);
  private combatTimer: NodeJS.Timeout | null = null;
  private sweepTimer: NodeJS.Timeout | null = null;

  /** Temporizadores de arranque de combate por sala (preparation → combat). */
  private readonly startTimers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly rooms: RoomService) {}

  /** Callbacks que inyecta el gateway para emitir por red. */
  onCombatTick: (room: Room) => void = () => {};
  onPhaseChange: (room: Room) => void = () => {};
  onMatchOver: (room: Room) => void = () => {};
  onRoomsClosed: (codes: string[], expired: Room[]) => void = () => {};

  start(): void {
    if (!this.combatTimer) {
      this.combatTimer = setInterval(() => this.tickAll(), PHASE_TICK_MS);
      // No bloquear el cierre del proceso por estos timers.
      this.combatTimer.unref?.();
    }
    if (!this.sweepTimer) {
      this.sweepTimer = setInterval(() => this.sweep(), LIFECYCLE.sweepIntervalMs);
      this.sweepTimer.unref?.();
    }
  }

  stop(): void {
    if (this.combatTimer) clearInterval(this.combatTimer);
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.combatTimer = null;
    this.sweepTimer = null;
    for (const t of this.startTimers.values()) clearTimeout(t);
    this.startTimers.clear();
  }

  /**
   * Programa el arranque del combate: la fase de preparación de sala dura hasta
   * que arranca el reloj. Usamos el primer segmento de PHASES (prep) ya dentro
   * del combate, así que iniciamos el combate de inmediato y el reloj gestiona
   * la preparación interna (wave 0). Se expone un pequeño retardo configurable.
   */
  scheduleCombatStart(room: Room, delayMs = 0): void {
    this.clearStart(room.code);
    const timer = setTimeout(() => {
      this.startTimers.delete(room.code);
      this.rooms.beginCombat(room);
      this.onPhaseChange(room);
    }, delayMs);
    timer.unref?.();
    this.startTimers.set(room.code, timer);
  }

  clearStart(code: string): void {
    const t = this.startTimers.get(code);
    if (t) {
      clearTimeout(t);
      this.startTimers.delete(code);
    }
  }

  private tickAll(): void {
    for (const room of this.rooms.all()) {
      if (room.status !== 'combat') continue;
      const { phaseChanged, finished } = this.rooms.tickCombat(room);
      if (finished) {
        this.onMatchOver(room);
        continue;
      }
      if (phaseChanged) this.onPhaseChange(room);
      this.onCombatTick(room);
    }
  }

  private sweep(): void {
    const { closed, expiredRooms } = this.rooms.sweep();
    if (closed.length || expiredRooms.length) {
      this.onRoomsClosed(closed, expiredRooms);
    }
  }
}
