import { RoomService } from '../room/room.service';
import { matchSummary } from './match-stats.service';

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
    svc.confirmSurvivor(room.code, 's1');
    svc.confirmSurvivor(room.code, 's2');
    svc.beginCombat(room);
    for (let t = 0; t < 70; t++) {
      clock += 1000;
      svc.tickCombat(room);
    }

    const ana = room.match!.players.find((p) => p.slot === 1)!;
    Object.assign(ana, { kills: 2, zombieKills: 9, deaths: 1, structuresBuilt: 4 });

    const s = matchSummary(room);
    expect(s.durationS).toBe(70);
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
