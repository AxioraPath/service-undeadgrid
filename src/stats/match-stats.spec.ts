import { RoomService } from '../room/room.service';
import { matchOverDetails, matchSummary } from './match-stats.service';

describe('matchSummary', () => {
  it('toma kills, zombis, muertes, estructuras y oleada del motor de la partida', () => {
    const svc = new RoomService();
    let clock = 1_000_000;
    jest.spyOn(svc, 'now').mockImplementation(() => clock);
    const { room } = svc.create({ name: 'Ana', socketId: 's1' });
    svc.join({ code: room.code, name: 'Bob', socketId: 's2' });
    svc.setReady(room.code, 's1', true);
    svc.setReady(room.code, 's2', true);
    svc.start(room.code, 's1');
    svc.beginCombat(room);
    for (let t = 0; t < 40; t++) {
      clock += 1000;
      svc.tickCombat(room);
    }

    const ana = room.match!.players.find((p) => p.slot === 1)!;
    Object.assign(ana, { kills: 2, zombieKills: 9, deaths: 1, structuresBuilt: 4 });

    const s = matchSummary(room);
    expect(s.durationS).toBe(40);
    expect(s.maxWave).toBe(1);
    expect(s.bySlot[1]).toMatchObject({ kills: 2, zombieKills: 9, deaths: 1, structuresBuilt: 4 });
    expect(s.bySlot[1].timeAliveS).toBeGreaterThan(0);
  });

  it('sin partida devuelve ceros', () => {
    const svc = new RoomService();
    const { room } = svc.create({ name: 'Ana', socketId: 's1' });
    expect(matchSummary(room)).toEqual({
      durationS: 0,
      maxWave: 0,
      bySlot: {
        1: { kills: 0, zombieKills: 0, deaths: 0, structuresBuilt: 0, timeAliveS: 0 },
        2: { kills: 0, zombieKills: 0, deaths: 0, structuresBuilt: 0, timeAliveS: 0 },
      },
    });
  });
});

describe('matchOverDetails', () => {
  it('extrae stats por slot, duración, ganador, razón y nombre del mapa', () => {
    const svc = new RoomService();
    let clock = 1_000_000;
    jest.spyOn(svc, 'now').mockImplementation(() => clock);
    const { room } = svc.create({ name: 'Ana', socketId: 's1' });
    svc.join({ code: room.code, name: 'Bob', socketId: 's2' });
    svc.setReady(room.code, 's1', true);
    svc.setReady(room.code, 's2', true);
    svc.start(room.code, 's1');
    svc.beginCombat(room);
    clock += 61_000;
    svc.tickCombat(room);

    const match = room.match!;
    Object.assign(match.players.find((p) => p.slot === 1)!, { zombieKills: 7, structuresBuilt: 3 });
    match.coreDamageDealt[1] = 500;
    match.cores[2].hp = 0;
    const bob = match.players.find((p) => p.slot === 2)!;
    bob.alive = false;
    bob.respawnAt = null;
    match.cores[1].hp = 250;
    clock += 100;
    svc.tickCombat(room);

    const d = matchOverDetails(room);
    expect(d.winner).toBe(1);
    expect(d.reason).toBe('core_destroyed');
    expect(d.mapName).toBe('Ciudad abandonada');
    expect(d.durationS).toBe(Math.round(match.time));
    expect(d.stats[1]).toEqual({ team: 1, zombieKills: 7, structuresBuilt: 3, coreDamageDealt: 500, coreHpPct: 50, kills: 0, deaths: 0 });
    expect(d.stats[2].coreHpPct).toBe(0);
    expect(d.stats[2].coreDamageDealt).toBe(0);
  });
});
