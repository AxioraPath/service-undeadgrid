import {
  CORE_HP,
  DEFAULT_MODE,
  DIFFICULTIES,
  MAP_IDS,
  MATCH_DURATION,
  MODE_CAPACITY,
  PHASES,
  SLOTS,
  TEAM_SIZE,
  TEAMS,
  slotFor,
  slotsOf,
  type GameMode,
  type PhaseDef,
  type Slot,
  type Team,
} from '../config/game.config';
import type {
  ChatMessageSnapshot,
  CombatSnapshot,
  MatchResult,
  PhaseId,
  RoomSnapshot,
  RoomStatus,
} from '../contracts';
import type { Command, MatchState, PlayerInput } from '../game/engine';
import { Player } from './player';

/** Transiciones permitidas de la máquina de estados de sala. */
const TRANSITIONS: Record<RoomStatus, readonly RoomStatus[]> = {
  lobby: ['selection', 'results'],
  selection: ['preparation', 'lobby', 'results'],
  preparation: ['combat', 'results'],
  combat: ['results'],
  results: ['preparation', 'lobby'],
};

/** Deriva la fase de combate a partir de los segundos transcurridos. */
export function phaseAt(elapsed: number): PhaseDef {
  for (const p of PHASES) {
    if (elapsed >= p.start && elapsed < p.end) return p;
  }
  return PHASES[PHASES.length - 1];
}

/**
 * Sala de juego. Objeto de dominio mutable y autoritativo. No conoce Socket.IO;
 * solo expone operaciones de dominio y genera snapshots. Toda emisión de red la
 * hace el gateway a partir de estos snapshots.
 */
export class Room {
  readonly code: string;
  status: RoomStatus = 'lobby';
  seed: number;
  mapId: string = MAP_IDS[0];
  difficulty: string = DIFFICULTIES[0];
  mode: GameMode = DEFAULT_MODE;
  hostSlot: Slot = SLOTS[0];

  readonly players = new Map<Slot, Player>();
  readonly chat: ChatMessageSnapshot[] = [];

  /** HP of each TEAM's shared core (authoritative; copied from the engine during combat). */
  cores: Record<Team, number> = { 1: CORE_HP, 2: CORE_HP };

  /** Simulación de la partida (src/game/engine). Existe desde que empieza el combate. */
  match: MatchState | null = null;
  /** Último input recibido de cada jugador (por sessionId). */
  readonly inputs = new Map<string, PlayerInput>();
  /** Toques de acción recibidos desde el último tick (para no perder un toque rápido). */
  readonly actionTaps = new Set<string>();
  /** Igual para el disparo (`fire`): un clic rápido entre dos ticks no se pierde. */
  readonly fireTaps = new Set<string>();
  /** Igual para un toque de autoapuntado (`fire` + `autoAim`). */
  readonly autoAimTaps = new Set<string>();
  /** Comandos pendientes de aplicar en el siguiente tick. */
  commands: { playerId: string; cmd: Command }[] = [];

  /** Epoch ms del inicio del combate; null fuera de combate. */
  combatStartedAt: number | null = null;
  /** Fase emitida por última vez (para detectar cambios). */
  lastPhaseId: PhaseId | null = null;
  result: MatchResult | null = null;
  /** Slots that asked for a rematch on the results screen. */
  readonly rematch = new Set<Slot>();

  readonly createdAt: number;
  private version = 0;
  private chatSeq = 0;

  constructor(code: string, seed: number, now: number) {
    this.code = code;
    this.seed = seed;
    this.createdAt = now;
  }

  // ---- Consultas ----

  /** Max players for the current mode (1v1: 2, 2v2: 4). */
  get capacity(): number {
    return MODE_CAPACITY[this.mode];
  }

  get isFull(): boolean {
    return this.players.size >= this.capacity;
  }

  playersOfTeam(team: Team): Player[] {
    return [...this.players.values()].filter((p) => p.team === team);
  }

  get host(): Player | undefined {
    return this.players.get(this.hostSlot);
  }

  getBySession(sessionId: string): Player | undefined {
    for (const p of this.players.values()) {
      if (p.sessionId === sessionId) return p;
    }
    return undefined;
  }

  getBySocket(socketId: string): Player | undefined {
    for (const p of this.players.values()) {
      if (p.socketId === socketId) return p;
    }
    return undefined;
  }

  /**
   * Slot for a new player. 1v1: first free of 1, 2. 2v2: joins the team with fewer players
   * (ties -> team 1) in its first free seat, so teams stay balanced (join order 1, 2, 3, 4).
   */
  freeSlot(): Slot | null {
    if (this.mode === '1v1') {
      for (const s of slotsOf('1v1')) if (!this.players.has(s)) return s;
      return null;
    }
    const byLoad = [...TEAMS].sort((a, b) => this.playersOfTeam(a).length - this.playersOfTeam(b).length || a - b);
    for (const team of byLoad) {
      const slot = this.freeSeatOf(team);
      if (slot !== null) return slot;
    }
    return null;
  }

  /** First free slot of a team (seat 0 before seat 1), or null if the team is full. */
  freeSeatOf(team: Team): Slot | null {
    for (const seat of [0, 1] as const) {
      const slot = slotFor(team, seat);
      if (!this.players.has(slot)) return slot;
    }
    return null;
  }

  /** Moves a seated player to another (free) slot, keeping host/rematch bookkeeping consistent. */
  moveToSlot(player: Player, slot: Slot): void {
    if (player.slot === slot) return;
    this.players.delete(player.slot);
    if (player.isHost) this.hostSlot = slot;
    player.slot = slot;
    this.players.set(slot, player);
    this.touch();
  }

  /**
   * Switches the mode. 2v2 -> 1v1 re-seats the (at most 2) players into slots 1 and 2 keeping
   * their relative order, so slot == team again. Validation (host, lobby, capacity) is the caller's job.
   */
  applyMode(mode: GameMode): void {
    this.mode = mode;
    if (mode === '1v1') {
      const ordered = [...this.players.values()].sort((a, b) => a.slot - b.slot);
      this.players.clear();
      ordered.forEach((p, i) => {
        p.slot = (i + 1) as Slot;
        this.players.set(p.slot, p);
        if (p.isHost) this.hostSlot = p.slot;
      });
    }
    for (const p of this.players.values()) p.ready = false;
    this.touch();
  }

  get connectedCount(): number {
    let n = 0;
    for (const p of this.players.values()) if (p.connected) n++;
    return n;
  }

  // ---- Mutaciones de dominio ----

  addPlayer(player: Player): void {
    this.players.set(player.slot, player);
    this.touch();
  }

  removePlayer(slot: Slot): void {
    this.players.delete(slot);
    this.touch();
  }

  /** Reasigna host al jugador conectado restante, si hace falta. */
  reassignHostIfNeeded(): void {
    if (this.host?.connected) return;
    for (const s of SLOTS) {
      const p = this.players.get(s);
      if (p?.connected) {
        this.hostSlot = p.slot;
        for (const other of this.players.values()) other.isHost = other.slot === p.slot;
        this.touch();
        return;
      }
    }
  }

  addChat(player: Player, text: string, now: number): ChatMessageSnapshot {
    const msg: ChatMessageSnapshot = {
      id: ++this.chatSeq,
      slot: player.slot,
      author: player.name,
      text,
      at: now,
    };
    this.chat.push(msg);
    if (this.chat.length > 200) this.chat.shift();
    return msg;
  }

  /** Comprueba si una transición de estado es válida. */
  canTransition(to: RoomStatus): boolean {
    return TRANSITIONS[this.status].includes(to);
  }

  /** Aplica una transición validada. Lanza si es inválida (error de programación). */
  transition(to: RoomStatus): void {
    if (!this.canTransition(to)) {
      throw new Error(`Transición inválida: ${this.status} → ${to}`);
    }
    this.status = to;
    this.touch();
  }

  /** 2v2: exactly TEAM_SIZE players on each team. 1v1: always true (one per slot). */
  teamsBalanced(): boolean {
    if (this.mode === '1v1') return true;
    return TEAMS.every((t) => this.playersOfTeam(t).length === TEAM_SIZE);
  }

  /** ¿Todos los asientos ocupados, conectados y listos? (condición de arranque). */
  allReady(): boolean {
    if (this.players.size !== this.capacity) return false;
    for (const p of this.players.values()) {
      if (!p.connected || !p.ready) return false;
    }
    return true;
  }

  /** ¿Todos confirmaron superviviente? (condición para salir de selección). */
  allSurvivorsConfirmed(): boolean {
    if (this.players.size !== this.capacity) return false;
    for (const p of this.players.values()) {
      if (!p.survivorConfirmed) return false;
    }
    return true;
  }

  // ---- Combate (reloj autoritativo) ----

  startCombat(now: number): void {
    this.combatStartedAt = now;
    this.cores = { 1: CORE_HP, 2: CORE_HP };
    this.lastPhaseId = phaseAt(0).id;
    this.touch();
  }

  /** Segundos transcurridos de combate (acotado a MATCH_DURATION). */
  elapsed(now: number): number {
    if (this.match) return Math.min(MATCH_DURATION, Math.floor(this.match.time));
    if (this.combatStartedAt === null) return 0;
    return Math.min(MATCH_DURATION, Math.floor((now - this.combatStartedAt) / 1000));
  }

  combatSnapshot(now: number): CombatSnapshot {
    const elapsed = this.elapsed(now);
    const phase = phaseAt(elapsed);
    return {
      elapsed,
      phase: phase.id,
      wave: phase.wave,
      cores: { ...this.cores },
    };
  }

  /** Aplica daño al núcleo objetivo. Devuelve true si llegó a 0. */
  damageCore(target: Team, amount: number): boolean {
    this.cores[target] = Math.max(0, this.cores[target] - Math.floor(amount));
    this.touch();
    return this.cores[target] === 0;
  }

  /** Marca el fin de partida con un resultado. */
  finish(result: MatchResult): void {
    this.result = result;
    this.status = 'results';
    this.combatStartedAt = null;
    this.touch();
  }

  /** Clears every trace of the previous match (shared by rematch and back-to-lobby). */
  private clearMatchState(): void {
    this.match = null;
    this.result = null;
    this.combatStartedAt = null;
    this.lastPhaseId = null;
    this.cores = { 1: CORE_HP, 2: CORE_HP };
    this.inputs.clear();
    this.actionTaps.clear();
    this.fireTaps.clear();
    this.autoAimTaps.clear();
    this.commands = [];
    this.rematch.clear();
  }

  /** results -> preparation with a new seed; survivors stay confirmed. */
  resetForRematch(seed: number): void {
    this.transition('preparation');
    this.seed = seed;
    this.clearMatchState();
    for (const p of this.players.values()) p.survivorConfirmed = true;
  }

  /** results -> lobby: keeps map/difficulty/players, resets ready/confirmation flags. */
  resetToLobby(): void {
    this.transition('lobby');
    this.clearMatchState();
    for (const p of this.players.values()) {
      p.ready = false;
      p.survivorConfirmed = false;
    }
  }

  // ---- Snapshot ----

  /** Incrementa la versión del snapshot (marca el estado como modificado). */
  touch(): void {
    this.version++;
  }

  toSnapshot(now: number): RoomSnapshot {
    const players = [...this.players.values()]
      .sort((a, b) => a.slot - b.slot)
      .map((p) => p.toSnapshot());
    return {
      code: this.code,
      status: this.status,
      seed: this.seed,
      mapId: this.mapId,
      difficulty: this.difficulty,
      mode: this.mode,
      capacity: this.capacity,
      hostSlot: this.hostSlot,
      players,
      combat: this.status === 'combat' ? this.combatSnapshot(now) : null,
      result: this.result,
      version: this.version,
      at: now,
    };
  }
}
