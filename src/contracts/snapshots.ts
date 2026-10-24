import type { Slot } from '../config/game.config';
import type { MatchResult, PhaseId, RoomStatus } from './common';

/**
 * Vista pública de un jugador dentro de una sala.
 * No incluye datos sensibles (sessionId/socketId quedan en el servidor).
 */
export interface PlayerSnapshot {
  /** Id público y estable del jugador dentro de la sala (= sessionId). */
  id: string;
  name: string;
  slot: Slot;
  isHost: boolean;
  ready: boolean;
  survivor: string;
  /** true cuando confirmó su superviviente en la pantalla de selección. */
  survivorConfirmed: boolean;
  /** false mientras está en ventana de reconexión tras caerse. */
  connected: boolean;
}

/** Mensaje de chat tal como lo ve el cliente (espeja ChatMessage del front). */
export interface ChatMessageSnapshot {
  id: number;
  slot: Slot;
  author: string;
  text: string;
  /** Epoch ms en el que el servidor recibió el mensaje. */
  at: number;
}

/** Estado de combate autoritativo (reloj y fase). */
export interface CombatSnapshot {
  /** Segundos transcurridos desde el inicio del combate. */
  elapsed: number;
  /** Fase actual derivada del reloj. */
  phase: PhaseId;
  /** Número de oleada (0 = preparación). */
  wave: number;
  /** Vida actual de cada núcleo. */
  cores: Record<Slot, number>;
}

/**
 * Snapshot COMPLETO de la sala. Es la fuente de verdad que el cliente usa para
 * renderizar lobby/selección/partida. Se envía en `lobby:state` ante cualquier
 * cambio relevante. Diseñado para reemplazar directamente el mock `useLobbyRoom`.
 */
export interface RoomSnapshot {
  code: string;
  status: RoomStatus;
  /** Semilla determinista del mapa (el cliente genera el mapa con mapgen.ts). */
  seed: number;
  mapId: string;
  difficulty: string;
  /** Slot del host (quien puede iniciar y editar ajustes). */
  hostSlot: Slot;
  players: PlayerSnapshot[];
  /** Presente solo cuando status === 'combat'. */
  combat: CombatSnapshot | null;
  /** Presente solo cuando status === 'results'. */
  result: MatchResult | null;
  /** Versión monotónica del snapshot para detectar/ordenar actualizaciones. */
  version: number;
  /** Epoch ms del servidor al generar el snapshot. */
  at: number;
}
