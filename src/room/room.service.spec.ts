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
    expect(room.status).toBe('preparation');
  });

  it('iniciar va directo a preparación con el superviviente elegido en el lobby', () => {
    const { room } = svc.create({ name: 'Ana', socketId: 's1', survivor: 'explorador' });
    svc.join({ code: room.code, name: 'Bob', socketId: 's2', survivor: 'mecanica' });
    svc.setReady(room.code, 's1', true);
    svc.setReady(room.code, 's2', true);
    svc.selectSurvivor(room.code, 's2', 'explorador');
    svc.start(room.code, 's1');
    expect(room.status).toBe('preparation');
    expect(room.players.get(2)!.survivor).toBe('explorador');
    for (const p of room.players.values()) expect(p.survivorConfirmed).toBe(true);
  });

  it('si el rival se va durante la selección, la sala vuelve al lobby', () => {
    const { room } = svc.create({ name: 'Ana', socketId: 's1' });
    svc.join({ code: room.code, name: 'Bob', socketId: 's2' });
    svc.setReady(room.code, 's1', true);
    svc.setReady(room.code, 's2', true);
    room.transition('selection');
    svc.leave(room.code, 's2');
    expect(room.status).toBe('lobby');
    expect(room.players.size).toBe(1);
    expect(room.players.get(1)!.ready).toBe(false);
  });

  /** Lleva una sala nueva hasta el combate y devuelve la sala. */
  const startMatch = () => {
    const { room } = svc.create({ name: 'Ana', socketId: 's1', survivor: 'explorador' });
    svc.join({ code: room.code, name: 'Bob', socketId: 's2', survivor: 'mecanica' });
    svc.setReady(room.code, 's1', true);
    svc.setReady(room.code, 's2', true);
    svc.start(room.code, 's1');
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
    expect(moved).toBeLessThanOrEqual(4 * 1.15 * 0.5 + 1e-6); // 4 casillas/s (+15 % del explorador) durante 0.5 s
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

  it('fire llega al motor y dispara dentro de la base, aunque el clic dure menos que un tick', () => {
    const room = startMatch();
    const ana = room.match!.players.find((p) => p.slot === 1)!;
    // Clic muy rápido: fire=true y luego fire=false antes del siguiente tick.
    svc.input(room.code, 's1', { up: false, down: false, left: false, right: false, action: false, fire: true });
    svc.input(room.code, 's1', { up: false, down: false, left: false, right: false, action: false, fire: false });
    advance(40);
    svc.tickCombat(room);
    expect(ana.shotAt).toBeGreaterThan(0);
    expect(room.match!.bullets.length).toBeGreaterThan(0);
    expect(room.match!.structures.size).toBe(0);
  });

  it('rechaza inputs fuera del combate', () => {
    const { room } = svc.create({ name: 'Ana', socketId: 's1' });
    expect(() =>
      svc.input(room.code, 's1', { up: true, down: false, left: false, right: false, action: false }),
    ).toThrow(/combate/i);
  });

  it('la misma cuenta no ocupa dos asientos: con la pestaña abierta se rechaza la segunda', () => {
    const { room } = svc.create({ name: 'Ana', socketId: 's1', userId: 'u-ana' });
    expect(() => svc.join({ code: room.code, name: 'Ana', socketId: 's1b', userId: 'u-ana' })).toThrow(/otra pestaña/i);
    expect(room.players.size).toBe(1);
    // Otra cuenta sí entra.
    svc.join({ code: room.code, name: 'Bob', socketId: 's2', userId: 'u-bob' });
    expect(room.players.size).toBe(2);
  });

  it('si la cuenta estaba desconectada recupera su mismo asiento (también a mitad de partida)', () => {
    const { room } = svc.create({ name: 'Ana', socketId: 's1', userId: 'u-ana' });
    svc.join({ code: room.code, name: 'Bob', socketId: 's2', userId: 'u-bob' });
    svc.setReady(room.code, 's1', true);
    svc.setReady(room.code, 's2', true);
    svc.start(room.code, 's1');
    svc.beginCombat(room);
    svc.handleDisconnect('s2');
    const again = svc.join({ code: room.code, name: 'Bob', socketId: 's2b', userId: 'u-bob' });
    expect(again.reconnected).toBe(true);
    expect(again.player.slot).toBe(2);
    expect(room.players.size).toBe(2);
    expect(room.status).toBe('combat');
  });

  it('reconecta a un asiento desconectado durante el combate', () => {
    const { room } = svc.create({ name: 'Ana', socketId: 's1' });
    svc.join({ code: room.code, name: 'Bob', socketId: 's2' });
    svc.setReady(room.code, 's1', true);
    svc.setReady(room.code, 's2', true);
    svc.start(room.code, 's1');
    const bobSession = room.getBySocket('s2')!.sessionId;
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
  describe('resultados: revancha y volver al lobby', () => {
    /** Finishes a match (core 2 destroyed) and returns the room in `results`. */
    const finishMatch = () => {
      const room = startMatch();
      advance(61_000);
      svc.tickCombat(room);
      room.match!.cores[2].hp = 0;
      const bob = room.match!.players.find((p) => p.slot === 2)!;
      bob.alive = false;
      bob.respawnAt = null;
      advance(100);
      svc.tickCombat(room);
      expect(room.status).toBe('results');
      return room;
    };

    it('rechaza revancha y volver al lobby fuera de results con BAD_STATE', () => {
      const room = startMatch();
      expect(() => svc.requestRematch(room.code, 's1')).toThrow(/resultados/i);
      expect(() => svc.cancelRematch(room.code, 's1')).toThrow(/resultados/i);
      expect(() => svc.backToLobby(room.code, 's1')).toThrow(/resultados/i);
    });

    it('con una sola petición solo marca el slot; cancelar lo limpia', () => {
      const room = finishMatch();
      const r = svc.requestRematch(room.code, 's1');
      expect(r.started).toBe(false);
      expect([...room.rematch]).toEqual([1]);
      svc.cancelRematch(room.code, 's1');
      expect(room.rematch.size).toBe(0);
      expect(room.status).toBe('results');
    });

    it('cuando ambos piden revancha: misma config, nueva seed, preparation y combate normal', () => {
      const room = finishMatch();
      const oldSeed = room.seed;
      const map = room.mapId;
      const survivors = [...room.players.values()].map((p) => p.survivor);
      svc.requestRematch(room.code, 's1');
      const r = svc.requestRematch(room.code, 's2');

      expect(r.started).toBe(true);
      expect(room.status).toBe('preparation');
      expect(room.seed).not.toBe(oldSeed);
      expect(room.mapId).toBe(map);
      expect([...room.players.values()].map((p) => p.survivor)).toEqual(survivors);
      expect(room.players.get(1)!.survivorConfirmed).toBe(true);
      expect(room.match).toBeNull();
      expect(room.result).toBeNull();
      expect(room.rematch.size).toBe(0);
      expect(room.cores).toEqual({ 1: CORE_HP, 2: CORE_HP });

      svc.beginCombat(room);
      expect(room.status).toBe('combat');
      expect(room.match!.cores[2].hp).toBe(CORE_HP);
      expect(room.match!.coreDamageDealt).toEqual({ 1: 0, 2: 0 });
    });

    it('una petición de revancha de un jugador solo (rival se fue) da BAD_STATE', () => {
      const room = finishMatch();
      svc.leave(room.code, 's2');
      expect(() => svc.requestRematch(room.code, 's1')).toThrow(/rival/i);
    });

    it('si el rival se va, se limpian las peticiones', () => {
      const room = finishMatch();
      svc.requestRematch(room.code, 's1');
      svc.handleDisconnect('s2');
      expect(room.rematch.size).toBe(0);
    });

    it('backToLobby resetea a lobby para ambos y conserva mapa/dificultad/jugadores', () => {
      const room = finishMatch();
      room.mapId = 'distrito-industrial';
      room.difficulty = 'Difícil';
      svc.requestRematch(room.code, 's1');
      svc.backToLobby(room.code, 's2');

      expect(room.status).toBe('lobby');
      expect(room.match).toBeNull();
      expect(room.result).toBeNull();
      expect(room.rematch.size).toBe(0);
      expect(room.mapId).toBe('distrito-industrial');
      expect(room.difficulty).toBe('Difícil');
      expect(room.players.size).toBe(2);
      for (const p of room.players.values()) {
        expect(p.ready).toBe(false);
        expect(p.survivorConfirmed).toBe(false);
      }
      // The lobby flow works again.
      svc.setReady(room.code, 's1', true);
      svc.setReady(room.code, 's2', true);
      svc.start(room.code, 's1');
      expect(room.status).toBe('preparation');
    });
  });
});
