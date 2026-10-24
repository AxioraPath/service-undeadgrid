import { RoomService } from './room.service';
import { DomainError } from '../common/domain-error';
import { CORE_HP, MATCH_DURATION } from '../config/game.config';

/**
 * Test de humo del servicio autoritativo de salas. Cubre el flujo completo:
 * crear → unir → listo → start → selección → confirmación → combate simulado
 * en el servidor → victoria, además de validaciones y reconexión.
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

  /** Lleva una sala nueva hasta el combate y devuelve la sala. */
  const startMatch = () => {
    const { room } = svc.create({ name: 'Ana', socketId: 's1', survivor: 'explorador' });
    svc.join({ code: room.code, name: 'Bob', socketId: 's2', survivor: 'mecanica' });
    svc.setReady(room.code, 's1', true);
    svc.setReady(room.code, 's2', true);
    svc.start(room.code, 's1');
    svc.confirmSurvivor(room.code, 's1');
    svc.confirmSurvivor(room.code, 's2');
    svc.beginCombat(room);
    return room;
  };

  it('el servidor simula el combate a 30 ticks por segundo', () => {
    const room = startMatch();
    expect(room.status).toBe('combat');
    expect(room.match).not.toBeNull();

    advance(1000);
    const { stepped } = svc.tickCombat(room);
    expect(stepped).toBe(30);
    expect(room.match!.time).toBeCloseTo(1, 5);
  });

  it('mueve al jugador con su input sin pasar la velocidad máxima', () => {
    const room = startMatch();
    const ana = room.match!.players.find((p) => p.slot === 1)!;
    const x0 = ana.x;

    // Aunque el cliente mande el input muchas veces, el servidor aplica la velocidad del motor.
    for (let i = 0; i < 50; i++) {
      svc.input(room.code, 's1', { up: false, down: false, left: false, right: true, action: false });
    }
    advance(500);
    svc.tickCombat(room);

    const moved = ana.x - x0;
    expect(moved).toBeGreaterThan(0);
    expect(moved).toBeLessThanOrEqual(4 * 0.5 + 1e-6); // 4 casillas/s durante 0.5 s
  });

  it('gana quien destruye el núcleo rival y elimina al enemigo', () => {
    const room = startMatch();
    advance(61_000);
    svc.tickCombat(room);

    const match = room.match!;
    match.cores[2].hp = 0;
    const bob = match.players.find((p) => p.slot === 2)!;
    bob.alive = false;
    bob.respawnAt = null;

    advance(100);
    const { finished } = svc.tickCombat(room);
    expect(finished).toBe(true);
    expect(room.status).toBe('results');
    expect(room.result?.winner).toBe(1);
    expect(room.result?.reason).toBe('core_destroyed');
  });

  it('termina por tiempo con victoria del núcleo con más vida', () => {
    const room = startMatch();
    advance(61_000);
    svc.tickCombat(room);
    room.match!.cores[2].hp = 400; // núcleo 2 queda con menos vida

    // El bucle real avanza cada 33 ms; aquí se avanza de segundo en segundo.
    let finished = false;
    for (let t = 0; t < MATCH_DURATION && !finished; t++) {
      room.match!.zombies.length = 0; // sin zombis: solo se prueba la regla del tiempo
      advance(1000);
      finished = svc.tickCombat(room).finished;
    }
    expect(finished).toBe(true);
    expect(room.status).toBe('results');
    expect(room.result?.reason).toBe('time_out');
    expect(room.result?.winner).toBe(1);
    expect(room.cores[2]).toBeLessThan(CORE_HP);
  });

  it('rechaza inputs fuera del combate', () => {
    const { room } = svc.create({ name: 'Ana', socketId: 's1' });
    expect(() =>
      svc.input(room.code, 's1', { up: true, down: false, left: false, right: false, action: false }),
    ).toThrow(/combate/i);
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
