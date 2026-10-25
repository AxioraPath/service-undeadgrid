import { RoomService } from './room.service';
import { DomainError } from '../common/domain-error';
import { ErrorCode } from '../contracts';
import { CORE_HP } from '../config/game.config';
import { matchOverDetails, matchSummary, matchXpBySlot } from '../stats/match-stats.service';

describe('RoomService (modo 2v2)', () => {
  let svc: RoomService;
  let clock: number;

  beforeEach(() => {
    svc = new RoomService();
    clock = 1_000_000;
    jest.spyOn(svc, 'now').mockImplementation(() => clock);
  });

  const advance = (ms: number) => {
    clock += ms;
  };

  const codeOf = (fn: () => unknown): string | undefined => {
    try {
      fn();
    } catch (e) {
      return e instanceof DomainError ? e.code : 'other';
    }
    return undefined;
  };

  /** Room in 2v2 mode with `n` players (sockets s1..sn). */
  const lobby2v2 = (n: number) => {
    const { room } = svc.create({ name: 'P1', socketId: 's1' });
    svc.setMode(room.code, 's1', '2v2');
    for (let i = 2; i <= n; i++) svc.join({ code: room.code, name: `P${i}`, socketId: `s${i}` });
    return room;
  };

  const readyAll = (code: string, n = 4) => {
    for (let i = 1; i <= n; i++) svc.setReady(code, `s${i}`, true);
  };

  const startMatch = () => {
    const room = lobby2v2(4);
    readyAll(room.code);
    svc.start(room.code, 's1');
    svc.beginCombat(room);
    return room;
  };

  const finishMatch = () => {
    const room = startMatch();
    advance(61_000);
    svc.tickCombat(room);
    room.match!.cores[2].hp = 0;
    for (const p of room.match!.players.filter((o) => o.team === 2)) {
      p.alive = false;
      p.respawnAt = null;
    }
    advance(100);
    svc.tickCombat(room);
    expect(room.status).toBe('results');
    return room;
  };

  it('rooms default to 1v1 with capacity 2', () => {
    const { room } = svc.create({ name: 'Ana', socketId: 's1' });
    expect(room.mode).toBe('1v1');
    const snap = room.toSnapshot(clock);
    expect(snap.mode).toBe('1v1');
    expect(snap.capacity).toBe(2);
    expect(snap.players[0].team).toBe(1);
  });

  describe('lobby: mode and team assignment', () => {
    it('only the host can change the mode, and only in the lobby', () => {
      const { room } = svc.create({ name: 'Ana', socketId: 's1' });
      svc.join({ code: room.code, name: 'Bob', socketId: 's2' });
      expect(codeOf(() => svc.setMode(room.code, 's2', '2v2'))).toBe(ErrorCode.NOT_HOST);
      svc.setMode(room.code, 's1', '2v2');
      expect(room.mode).toBe('2v2');
      expect(room.toSnapshot(clock).capacity).toBe(4);
      room.status = 'combat';
      expect(codeOf(() => svc.setMode(room.code, 's1', '1v1'))).toBe(ErrorCode.BAD_STATE);
    });

    it('assigns joiners to alternating teams: slots 1,2,3,4 -> teams 1,2,1,2', () => {
      const room = lobby2v2(4);
      const bySlot = [...room.players.values()].map((p) => [p.slot, p.team]);
      expect(bySlot).toEqual([[1, 1], [2, 2], [3, 1], [4, 2]]);
      expect(room.toSnapshot(clock).players.map((p) => p.team)).toEqual([1, 2, 1, 2]);
    });

    it('refuses a 5th player and a 3rd player in 1v1', () => {
      const room = lobby2v2(4);
      expect(codeOf(() => svc.join({ code: room.code, name: 'P5', socketId: 's5' }))).toBe(ErrorCode.ROOM_FULL);
      expect(room.players.size).toBe(4);

      const { room: duel } = svc.create({ name: 'A', socketId: 'd1' });
      svc.join({ code: duel.code, name: 'B', socketId: 'd2' });
      expect(codeOf(() => svc.join({ code: duel.code, name: 'C', socketId: 'd3' }))).toBe(ErrorCode.ROOM_FULL);
    });

    it('setTeam moves a player to the free seat of the other team and the host slot follows', () => {
      const room = lobby2v2(2); // slot 1 (T1, host), slot 2 (T2)
      svc.setTeam(room.code, 's1', 2); // host -> team 2, seat 1 = slot 4
      expect(room.players.get(4)!.name).toBe('P1');
      expect(room.players.has(1)).toBe(false);
      expect(room.hostSlot).toBe(4);
      expect(room.players.get(4)!.team).toBe(2);
      expect(room.players.get(4)!.isHost).toBe(true);
      svc.setTeam(room.code, 's1', 1); // back to team 1 seat 0
      expect(room.players.get(1)!.name).toBe('P1');
      expect(room.hostSlot).toBe(1);
    });

    it('setTeam on a full team errors, in 1v1 or outside the lobby too', () => {
      const room = lobby2v2(4);
      expect(codeOf(() => svc.setTeam(room.code, 's2', 1))).toBe(ErrorCode.TEAM_FULL);
      expect(room.players.get(2)!.team).toBe(2);

      const { room: duel } = svc.create({ name: 'A', socketId: 'd1' });
      expect(codeOf(() => svc.setTeam(duel.code, 'd1', 2))).toBe(ErrorCode.BAD_STATE);

      room.status = 'combat';
      expect(codeOf(() => svc.setTeam(room.code, 's2', 2))).toBe(ErrorCode.BAD_STATE);
    });

    it('switching 2v2 -> 1v1 with more than 2 players is rejected; with 2 it re-seats into slots 1 and 2', () => {
      const room = lobby2v2(3);
      expect(codeOf(() => svc.setMode(room.code, 's1', '1v1'))).toBe(ErrorCode.TOO_MANY_PLAYERS);
      expect(room.mode).toBe('2v2');

      svc.leave(room.code, 's2');
      // Remaining: slot 1 (host) and slot 3.
      expect([...room.players.keys()]).toEqual([1, 3]);
      svc.setReady(room.code, 's1', true);
      svc.setMode(room.code, 's1', '1v1');
      expect(room.mode).toBe('1v1');
      expect([...room.players.keys()].sort()).toEqual([1, 2]);
      expect(room.players.get(2)!.name).toBe('P3');
      expect(room.players.get(1)!.ready).toBe(false); // ready flags are cleared
      expect(room.hostSlot).toBe(1);
    });
  });

  describe('start rules', () => {
    it('needs 4 players, 2 per team, all connected and ready', () => {
      const room = lobby2v2(3);
      expect(() => svc.start(room.code, 's1')).toThrow(/Faltan jugadores/);
      svc.join({ code: room.code, name: 'P4', socketId: 's4' });
      expect(() => svc.start(room.code, 's1')).toThrow(/listos/i);

      readyAll(room.code, 3);
      expect(() => svc.start(room.code, 's1')).toThrow(/listos/i); // P4 not ready
      svc.setReady(room.code, 's4', true);
      expect(() => svc.start(room.code, 's2')).toThrow(/host/i);
      svc.start(room.code, 's1');
      expect(room.status).toBe('preparation');
    });
  });

  describe('combat', () => {
    it('creates a match with 4 engine players, one core per team and teams on the right sides', () => {
      const room = startMatch();
      const match = room.match!;
      expect(match.players.map((p) => [p.slot, p.team])).toEqual([[1, 1], [2, 2], [3, 1], [4, 2]]);
      expect(Object.keys(match.cores)).toEqual(['1', '2']);
      expect(room.toSnapshot(clock).combat!.cores).toEqual({ 1: CORE_HP, 2: CORE_HP });
    });

    it('applies inputs of all four players', () => {
      const room = startMatch();
      const p3 = room.match!.players.find((p) => p.slot === 3)!;
      const x0 = p3.x;
      svc.input(room.code, 's3', { up: false, down: false, left: false, right: true, action: false });
      advance(500);
      svc.tickCombat(room);
      expect(p3.x).toBeGreaterThan(x0);
    });

    it('the shared core ends the match: team 1 wins, both of its members are winners', () => {
      const room = finishMatch();
      expect(room.result?.winner).toBe(1);
      expect(room.result?.reason).toBe('core_destroyed');
      const d = matchOverDetails(room);
      expect(d.winner).toBe(1);
      expect(Object.keys(d.stats)).toEqual(['1', '2', '3', '4']);
      expect(d.stats[1].team).toBe(1);
      expect(d.stats[3].team).toBe(1);
      expect(d.stats[2].team).toBe(2);
      expect(d.stats[4].team).toBe(2);
      expect(d.stats[3].coreHpPct).toBe(100);
      expect(d.stats[4].coreHpPct).toBe(0);
      room.match!.time = 100; // the simulated clock skipped ahead; pretend a normal-length match
      const xp = matchXpBySlot(room);
      expect(Object.keys(xp)).toEqual(['1', '2', '3', '4']);
      expect(xp[1]).toBe(xp[3]);
      expect(xp[1]).toBeGreaterThan(xp[2]);
      expect(Object.keys(matchSummary(room).bySlot)).toHaveLength(4);
    });

    it('a teammate leaving mid-match does not end it; the whole team leaving makes the rival win', () => {
      const room = startMatch();
      svc.leave(room.code, 's3');
      expect(room.status).toBe('combat');
      expect(room.players.size).toBe(3);
      svc.leave(room.code, 's1'); // team 1 is gone now
      expect(room.status).toBe('results');
      expect(room.result).toMatchObject({ winner: 2, reason: 'opponent_left' });
      expect(room.host?.connected).toBe(true); // host reassigned to a remaining player
    });

    it('reconnects any of the four seats during combat', () => {
      const room = startMatch();
      const session = room.getBySocket('s4')!.sessionId;
      const out = svc.handleDisconnect('s4');
      expect(out?.kept).toBe(true);
      const back = svc.join({ code: room.code, name: 'P4', socketId: 's4b', sessionId: session });
      expect(back.reconnected).toBe(true);
      expect(back.player.slot).toBe(4);
      expect(back.player.team).toBe(2);
    });
  });

  describe('results: rematch and back to lobby with 4 players', () => {
    it('needs all four requests; each request only marks its slot', () => {
      const room = finishMatch();
      const oldSeed = room.seed;
      expect(svc.requestRematch(room.code, 's1').started).toBe(false);
      expect(svc.requestRematch(room.code, 's2').started).toBe(false);
      expect(svc.requestRematch(room.code, 's3').started).toBe(false);
      expect([...room.rematch].sort()).toEqual([1, 2, 3]);
      svc.cancelRematch(room.code, 's3');
      expect([...room.rematch].sort()).toEqual([1, 2]);
      svc.requestRematch(room.code, 's3');
      const last = svc.requestRematch(room.code, 's4');

      expect(last.started).toBe(true);
      expect(room.status).toBe('preparation');
      expect(room.seed).not.toBe(oldSeed);
      expect(room.mode).toBe('2v2');
      expect(room.players.size).toBe(4);
      expect([...room.players.values()].map((p) => p.team)).toEqual([1, 2, 1, 2]);
      expect(room.cores).toEqual({ 1: CORE_HP, 2: CORE_HP });

      svc.beginCombat(room);
      expect(room.match!.players).toHaveLength(4);
      expect(room.match!.cores[2].hp).toBe(CORE_HP);
    });

    it('rematch is refused when a player is gone', () => {
      const room = finishMatch();
      svc.leave(room.code, 's4');
      expect(codeOf(() => svc.requestRematch(room.code, 's1'))).toBe(ErrorCode.BAD_STATE);
    });

    it('backToLobby keeps the 4 players, mode and teams, and the flow works again', () => {
      const room = finishMatch();
      svc.backToLobby(room.code, 's2');
      expect(room.status).toBe('lobby');
      expect(room.mode).toBe('2v2');
      expect(room.players.size).toBe(4);
      for (const p of room.players.values()) expect(p.ready).toBe(false);
      readyAll(room.code);
      svc.start(room.code, 's1');
      expect(room.status).toBe('preparation');
    });
  });
});
