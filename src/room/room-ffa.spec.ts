import { matchOverDetails } from '../stats/match-stats.service';
import { RoomService } from './room.service';

/** Sala en modo todos contra todos: de 2 a 4 jugadores, vidas elegibles y abandono. */
describe('RoomService (todos contra todos)', () => {
  let svc: RoomService;
  let clock: number;

  beforeEach(() => {
    svc = new RoomService();
    clock = 1_000_000;
    jest.spyOn(svc, 'now').mockImplementation(() => clock);
  });

  const lobby = (n: number) => {
    const { room } = svc.create({ name: 'P1', socketId: 's1' });
    svc.setMode(room.code, 's1', 'ffa');
    for (let i = 2; i <= n; i++) svc.join({ code: room.code, name: `P${i}`, socketId: `s${i}` });
    for (let i = 1; i <= n; i++) svc.setReady(room.code, `s${i}`, true);
    return room;
  };

  it('admite hasta 4 jugadores y se puede empezar con 2', () => {
    const room = lobby(2);
    expect(room.capacity).toBe(4);
    expect(room.toSnapshot(clock).mode).toBe('ffa');
    svc.start(room.code, 's1');
    expect(room.status).toBe('preparation');
    svc.beginCombat(room);
    expect(room.match?.ffa).toBe(true);
    expect(room.match?.players.map((p) => p.lives)).toEqual([3, 3]);
  });

  it('el anfitrión elige 3 o 5 vidas', () => {
    const room = lobby(3);
    expect(() => svc.setLives(room.code, 's2', 5)).toThrow(/host/i);
    svc.setLives(room.code, 's1', 5);
    expect(room.toSnapshot(clock).lives).toBe(5);
    svc.start(room.code, 's1');
    svc.beginCombat(room);
    expect(room.match?.players.every((p) => p.lives === 5)).toBe(true);
  });

  it('con 1 solo jugador no se puede empezar', () => {
    const room = lobby(1);
    expect(() => svc.start(room.code, 's1')).toThrow(/al menos 2/i);
  });

  it('si alguien se va la partida sigue; cuando queda uno, ese gana', () => {
    const room = lobby(3);
    svc.start(room.code, 's1');
    svc.beginCombat(room);
    svc.leave(room.code, 's3');
    expect(room.status).toBe('combat');
    expect(room.match?.players.find((p) => p.slot === 3)?.lives).toBe(0);
    svc.leave(room.code, 's2');
    expect(room.status).toBe('results');
    expect(room.result?.winnerSlot).toBe(1);
  });

  it('al terminar por último en pie, el resultado lleva el slot ganador', () => {
    const room = lobby(2);
    svc.start(room.code, 's1');
    svc.beginCombat(room);
    const p2 = room.match!.players.find((p) => p.slot === 2)!;
    Object.assign(p2, { alive: false, lives: 0, respawnAt: null });
    clock += 100;
    svc.tickCombat(room);
    expect(room.status).toBe('results');
    expect(room.result).toMatchObject({ winnerSlot: 1, reason: 'last_standing' });
  });

  it('las estadísticas finales solo traen a los que jugaron', () => {
    const room = lobby(2);
    svc.start(room.code, 's1');
    svc.beginCombat(room);
    Object.assign(room.match!.players.find((p) => p.slot === 2)!, { alive: false, lives: 0, respawnAt: null });
    clock += 100;
    svc.tickCombat(room);
    expect(Object.keys(matchOverDetails(room).stats)).toEqual(['1', '2']);
  });
});
