import { RoomService } from './room.service';
import { DomainError } from '../common/domain-error';
import { CORE_HP, MATCH_DURATION } from '../config/game.config';

/**
 * Test de humo del servicio autoritativo de salas. Cubre el flujo completo:
 * crear → unir → listo → start → selección → confirmación → combate →
 * daño al núcleo → victoria, además de validaciones y reconexión.
 *
 * Se controla el reloj (`now`) para hacer el combate determinista.
 */
describe('RoomService (flujo 1v1)', () => {
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

  it('crea una sala con el host en el slot 1', () => {
    const { room, player } = svc.create({ name: 'Ana', socketId: 's1' });
    expect(room.code).toHaveLength(5);
    expect(player.slot).toBe(1);
    expect(player.isHost).toBe(true);
    expect(room.status).toBe('lobby');
  });

  it('rechaza unirse a una sala inexistente', () => {
    expect(() => svc.join({ code: 'ZZZZZ', name: 'Bob', socketId: 's2' })).toThrow(DomainError);
  });

  it('asigna el slot 2 al segundo jugador y rechaza un tercero', () => {
    const { room } = svc.create({ name: 'Ana', socketId: 's1' });
    const join = svc.join({ code: room.code, name: 'Bob', socketId: 's2' });
    expect(join.player.slot).toBe(2);
    expect(() =>
      svc.join({ code: room.code, name: 'Cid', socketId: 's3' }),
    ).toThrow(/llena/i);
  });

  it('no permite iniciar si no están todos listos; el host inicia cuando sí', () => {
    const { room } = svc.create({ name: 'Ana', socketId: 's1' });
    svc.join({ code: room.code, name: 'Bob', socketId: 's2' });

    expect(() => svc.start(room.code, 's1')).toThrow(/listos/i);

    svc.setReady(room.code, 's1', true);
    svc.setReady(room.code, 's2', true);

    // Solo el host puede iniciar.
    expect(() => svc.start(room.code, 's2')).toThrow(/host/i);

    svc.start(room.code, 's1');
    expect(room.status).toBe('selection');
  });

  it('avanza a preparación cuando ambos confirman superviviente', () => {
    const { room } = svc.create({ name: 'Ana', socketId: 's1', survivor: 'explorador' });
    svc.join({ code: room.code, name: 'Bob', socketId: 's2', survivor: 'mecanica' });
    svc.setReady(room.code, 's1', true);
    svc.setReady(room.code, 's2', true);
    svc.start(room.code, 's1');

    svc.confirmSurvivor(room.code, 's1');
    expect(room.status).toBe('selection');
    svc.confirmSurvivor(room.code, 's2');
    expect(room.status).toBe('preparation');
  });

  it('corre el combate y gana quien destruye el núcleo rival', () => {
    const { room } = svc.create({ name: 'Ana', socketId: 's1' });
    svc.join({ code: room.code, name: 'Bob', socketId: 's2' });
    svc.setReady(room.code, 's1', true);
    svc.setReady(room.code, 's2', true);
    svc.start(room.code, 's1');
    svc.confirmSurvivor(room.code, 's1');
    svc.confirmSurvivor(room.code, 's2');

    svc.beginCombat(room);
    expect(room.status).toBe('combat');
    expect(room.cores[2]).toBe(CORE_HP);

    // Durante la preparación interna (wave 0) el núcleo es invulnerable.
    expect(() => svc.coreDamage(room.code, 's1', 2, 50)).toThrow(/invulnerable/i);

    // Avanza a la oleada 1 (a los 60 s).
    advance(61_000);
    svc.tickCombat(room);

    // No puede dañar su propio núcleo.
    expect(() => svc.coreDamage(room.code, 's1', 1, 50)).toThrow(/propio/i);

    // Ana (slot 1) destruye el núcleo de Bob (slot 2).
    svc.coreDamage(room.code, 's1', 2, CORE_HP);
    expect(room.status).toBe('results');
    expect(room.result?.winner).toBe(1);
    expect(room.result?.reason).toBe('core_destroyed');
  });

  it('termina por tiempo con victoria del núcleo con más vida', () => {
    const { room } = svc.create({ name: 'Ana', socketId: 's1' });
    svc.join({ code: room.code, name: 'Bob', socketId: 's2' });
    svc.setReady(room.code, 's1', true);
    svc.setReady(room.code, 's2', true);
    svc.start(room.code, 's1');
    svc.confirmSurvivor(room.code, 's1');
    svc.confirmSurvivor(room.code, 's2');
    svc.beginCombat(room);

    advance(61_000);
    svc.tickCombat(room);
    svc.coreDamage(room.code, 's1', 2, 100); // núcleo 2 queda con menos vida

    advance(MATCH_DURATION * 1000);
    const { finished } = svc.tickCombat(room);
    expect(finished).toBe(true);
    expect(room.status).toBe('results');
    expect(room.result?.reason).toBe('time_out');
    expect(room.result?.winner).toBe(1);
  });

  it('reconecta a un asiento desconectado durante el combate', () => {
    const { room } = svc.create({ name: 'Ana', socketId: 's1' });
    svc.join({ code: room.code, name: 'Bob', socketId: 's2' });
    svc.setReady(room.code, 's1', true);
    svc.setReady(room.code, 's2', true);
    svc.start(room.code, 's1');
    svc.confirmSurvivor(room.code, 's1');
    const bobSession = room.getBySocket('s2')!.sessionId;
    svc.confirmSurvivor(room.code, 's2');
    svc.beginCombat(room);

    // Bob se cae: en combate el asiento se reserva (no termina la partida).
    const out = svc.handleDisconnect('s2');
    expect(out?.kept).toBe(true);
    expect(room.status).toBe('combat');
    expect(room.getBySession(bobSession)!.connected).toBe(false);

    // Bob reconecta con su sessionId.
    const rejoin = svc.join({
      code: room.code,
      name: 'Bob',
      socketId: 's2b',
      sessionId: bobSession,
    });
    expect(rejoin.reconnected).toBe(true);
    expect(room.getBySession(bobSession)!.connected).toBe(true);
  });

  it('en lobby, el abandono libera el asiento y elimina la sala vacía', () => {
    const { room } = svc.create({ name: 'Ana', socketId: 's1' });
    const code = room.code;
    const res = svc.leave(code, 's1');
    expect(res.closed).toBe(true);
    expect(svc.get(code)).toBeUndefined();
  });

  it('reasigna el host cuando el host abandona en lobby', () => {
    const { room } = svc.create({ name: 'Ana', socketId: 's1' });
    svc.join({ code: room.code, name: 'Bob', socketId: 's2' });
    svc.leave(room.code, 's1');
    expect(room.hostSlot).toBe(2);
    expect(room.players.get(2)!.isHost).toBe(true);
  });
});
