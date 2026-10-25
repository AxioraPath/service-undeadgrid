import type { GameMode, Slot, Team } from '../config/game.config';
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
  /** Team of the slot (1v1: same number as the slot; 2v2: slots 1/3 -> 1, slots 2/4 -> 2). */
  team: Team;
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
  /** Current HP of each team's shared core (keyed by team; in 1v1 team == slot). */
  cores: Record<Team, number>;
}

/**
 * Snapshot COMPLETO de la sala. Es la fuente de verdad que el cliente usa para
 * renderizar lobby/selección/partida. Se envía en `lobby:state` ante cualquier
 * cambio relevante. Diseñado para reemplazar directamente el mock `useLobbyRoom`.
 */
export interface RoomSnapshot {
  code: string;
  status: RoomStatus;
  /** Semilla determinista del mapa (el servidor lo genera y lo manda en game:sync). */
  seed: number;
  mapId: string;
  difficulty: string;
  /** Game mode chosen by the host in the lobby. */
  mode: GameMode;
  /** Todos contra todos: vidas por jugador. */
  lives: number;
  /** Max players for the mode (2 or 4). */
  capacity: number;
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
