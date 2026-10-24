import type { Slot } from '../config/game.config';
import { DEFAULT_SURVIVOR } from '../config/game.config';
import type { PlayerSnapshot } from '../contracts';

/**
 * Jugador dentro de una sala. Es un objeto de dominio mutable; el servidor es
 * el único que lo modifica. Guarda datos internos (sessionId, socketId) que NO
 * se exponen en los snapshots públicos salvo el id público (= sessionId).
 */
export class Player {
  /** Token de sesión: identidad estable del asiento, sobrevive a reconexiones. */
  readonly sessionId: string;
  /** Socket.IO id del cliente conectado ahora mismo; null si está desconectado. */
  socketId: string | null;
  name: string;
  readonly slot: Slot;
  isHost: boolean;
  ready = false;
  survivor: string = DEFAULT_SURVIVOR;
  survivorConfirmed = false;
  /** Id de la cuenta real (si el socket venía autenticado con JWT); null si invitado. */
  userId: string | null = null;
  /** Epoch ms en que se desconectó; null si está conectado. */
  disconnectedAt: number | null = null;

  constructor(params: {
    sessionId: string;
    socketId: string;
    name: string;
    slot: Slot;
    isHost: boolean;
    survivor?: string;
    userId?: string | null;
  }) {
    this.sessionId = params.sessionId;
    this.socketId = params.socketId;
    this.name = params.name;
    this.slot = params.slot;
    this.isHost = params.isHost;
    if (params.survivor) this.survivor = params.survivor;
    this.userId = params.userId ?? null;
  }

  get connected(): boolean {
    return this.socketId !== null && this.disconnectedAt === null;
  }

  markDisconnected(now: number): void {
    this.socketId = null;
    this.disconnectedAt = now;
    // Al caerse, el jugador deja de estar "listo" para evitar inicios fantasma.
    this.ready = false;
  }

  markReconnected(socketId: string): void {
    this.socketId = socketId;
    this.disconnectedAt = null;
  }

  toSnapshot(): PlayerSnapshot {
    return {
      id: this.sessionId,
      name: this.name,
      slot: this.slot,
      isHost: this.isHost,
      ready: this.ready,
      survivor: this.survivor,
      survivorConfirmed: this.survivorConfirmed,
      connected: this.connected,
    };
  }
}
