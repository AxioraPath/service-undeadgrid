import { computeTelemetry } from './telemetry';
import { buildSyntheticMatches, seedBodySchema } from './seed';
import { testEndpointsEnabled } from './test-endpoints.guard';

const base = {
  totalMatches: 0,
  avgDurationS: null,
  avgMaxWave: null,
  reasonCounts: {},
  winsBySlot: {},
  players: { total: 0, winners: 0, kills: 0, zombieKills: 0, deaths: 0, timeAliveS: 0, coresAlive: 0 },
};

describe('computeTelemetry', () => {
  it('handles empty data', () => {
    expect(computeTelemetry(base)).toEqual({
      totalMatches: 0,
      winRate: 0,
      winRateBySlot: { host: 0, challenger: 0 },
      kdr: 0,
      zombiesPerDeath: 0,
      avgDurationS: 0,
      survival: { avgDurationS: 0, timeOutPct: 0, avgWaveReached: 0, avgTimeAliveS: 0, coresSurvivedPct: 0 },
    });
  });

  it('calcula win rate, KDR y supervivencia a partir de las partidas', () => {
    const t = computeTelemetry({
      ...base,
      totalMatches: 4,
      avgDurationS: 200.5,
      avgMaxWave: 2.5,
      reasonCounts: { time_out: 1, core_destroyed: 3 },
      winsBySlot: { 1: 3, 2: 1 },
      players: { total: 8, winners: 4, kills: 12, zombieKills: 60, deaths: 6, timeAliveS: 1200, coresAlive: 5 },
    });
    expect(t.winRate).toBe(0.5);
    expect(t.winRateBySlot).toEqual({ host: 0.75, challenger: 0.25 });
    expect(t.kdr).toBe(2);
    expect(t.zombiesPerDeath).toBe(10);
    expect(t.avgDurationS).toBe(200.5);
    expect(t.survival).toEqual({ avgDurationS: 200.5, timeOutPct: 25, avgWaveReached: 2.5, avgTimeAliveS: 150, coresSurvivedPct: 62.5 });
  });

  it('evita dividir entre cero cuando no hay muertes', () => {
    const t = computeTelemetry({ ...base, totalMatches: 1, players: { ...base.players, total: 2, kills: 3, zombieKills: 5 } });
    expect(t.kdr).toBe(3);
    expect(t.zombiesPerDeath).toBe(5);
  });
});

describe('seedBodySchema', () => {
  it('accepts valid bodies', () => {
    expect(seedBodySchema.safeParse({ matches: 100 }).success).toBe(true);
    expect(seedBodySchema.safeParse({ matches: 1000, seed: 42 }).success).toBe(true);
  });
  it('rejects out-of-range or malformed bodies', () => {
    expect(seedBodySchema.safeParse({ matches: 99 }).success).toBe(false);
    expect(seedBodySchema.safeParse({ matches: 1001 }).success).toBe(false);
    expect(seedBodySchema.safeParse({ matches: 150.5 }).success).toBe(false);
    expect(seedBodySchema.safeParse({ matches: '200' }).success).toBe(false);
    expect(seedBodySchema.safeParse({ matches: 200, seed: 'x' }).success).toBe(false);
    expect(seedBodySchema.safeParse({}).success).toBe(false);
  });
});

describe('buildSyntheticMatches', () => {
  it('is deterministic per seed and shapes rows', () => {
    const strip = (r: ReturnType<typeof buildSyntheticMatches>) =>
      r.matches.map(({ id: _id, ...m }) => m);
    const a = buildSyntheticMatches(100, 7);
    const b = buildSyntheticMatches(100, 7);
    expect(strip(a)).toEqual(strip(b));
    expect(a.matches).toHaveLength(100);
    expect(a.players).toHaveLength(200);
    expect(a.matches.every((m) => m.code.startsWith('SEED'))).toBe(true);
    expect(a.players[0]).toMatchObject({ userId: null, slot: 1, name: 'seed-bot-1' });
    expect(a.players[1]).toMatchObject({ slot: 2, name: 'seed-bot-2' });
  });

  it('respeta las reglas del juego (duración, oleadas, tiempo vivo)', () => {
    const { matches, players } = buildSyntheticMatches(500, 11);
    for (const m of matches) {
      expect(m.durationS).toBeLessThanOrEqual(240);
      expect(m.maxWave).toBe(Math.min(3, Math.floor(m.durationS / 60)));
      if (m.reason === 'time_out') expect(m.durationS).toBe(240);
    }
    const byId = new Map(matches.map((m) => [m.id, m]));
    for (const p of players) expect(p.timeAliveS).toBeLessThanOrEqual(byId.get(p.matchId)!.durationS);
  });
});

describe('testEndpointsEnabled', () => {
  it('follows env rules', () => {
    expect(testEndpointsEnabled({ NODE_ENV: 'production' })).toBe(false);
    expect(testEndpointsEnabled({ NODE_ENV: 'production', ENABLE_TEST_ENDPOINTS: 'true' })).toBe(true);
    expect(testEndpointsEnabled({ NODE_ENV: 'development' })).toBe(true);
    expect(testEndpointsEnabled({ NODE_ENV: 'development', ENABLE_TEST_ENDPOINTS: 'false' })).toBe(false);
  });
});
