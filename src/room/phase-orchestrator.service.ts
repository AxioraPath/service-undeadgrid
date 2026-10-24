import { Injectable, Logger } from '@nestjs/common';
import { LIFECYCLE, PHASE_TICK_MS, SIM_TICK_MS } from '../config/game.config';
import type { GameStateDto } from '../contracts';
import { encodeState } from '../game/snapshot';
import type { Room } from '../domain/room';
import { RoomService } from './room.service';

/**
 * Orquesta el avance de fases/combate de forma AUTORITATIVA en el servidor.
 * El gateway registra callbacks para emitir por red; este servicio no conoce
 * Socket.IO. Mantiene un único bucle de simulación a 30 ticks/s que recorre todas
 * las salas en combate (estado del juego cada tick, reloj cada segundo), además
 * del barrido de limpieza.
 */
@Injectable()
export class PhaseOrchestrator {
  private readonly logger = new Logger(PhaseOrchestrator.name);
  private combatTimer: NodeJS.Timeout | null = null;
  private sweepTimer: NodeJS.Timeout | null = null;

  /** Temporizadores de arranque de combate por sala (preparation → combat). */
  private readonly startTimers = new Map<string, NodeJS.Timeout>();
  /** Último segundo de reloj emitido por sala (combat:tick a 1 Hz). */
  private readonly lastClock = new Map<string, number>();

  constructor(private readonly rooms: RoomService) {}

  /** Callbacks que inyecta el gateway para emitir por red. */
  onCombatTick: (room: Room) => void = () => {};
  onGameState: (room: Room, state: GameStateDto) => void = () => {};
  onPhaseChange: (room: Room) => void = () => {};
  onMatchOver: (room: Room) => void = () => {};
  onRoomsClosed: (codes: string[], expired: Room[]) => void = () => {};

  start(): void {
    if (!this.combatTimer) {
      this.combatTimer = setInterval(() => this.tickAll(), SIM_TICK_MS);
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
      if (room.status !== 'combat' || !room.match) {
        this.lastClock.delete(room.code);
        continue;
      }
      const { stepped, phaseChanged, finished } = this.rooms.tickCombat(room);
      if (stepped || finished) this.onGameState(room, encodeState(room.match));
      if (finished) {
        this.lastClock.delete(room.code);
        this.onMatchOver(room);
        continue;
      }
      if (phaseChanged) this.onPhaseChange(room);
      const second = Math.floor((room.match.time * 1000) / PHASE_TICK_MS);
      if (second !== this.lastClock.get(room.code)) {
        this.lastClock.set(room.code, second);
        this.onCombatTick(room);
      }
    }
  }

  private sweep(): void {
    const { closed, expiredRooms } = this.rooms.sweep();
    if (closed.length || expiredRooms.length) {
      this.onRoomsClosed(closed, expiredRooms);
    }
  }
}
