import { computeTelemetry } from './telemetry';
import { buildSyntheticMatches, seedBodySchema } from './seed';
import { testEndpointsEnabled } from './test-endpoints.guard';

const base = {
  totalMatches: 0,
  avgDurationS: null,
  reasonCounts: {},
  stats: { matchesPlayed: 0, wins: 0, losses: 0, coresDestroyed: 0, zombiesKilled: 0 },
  players: { total: 0, winners: 0 },
};

describe('computeTelemetry', () => {
  it('handles empty data', () => {
    expect(computeTelemetry(base)).toEqual({
      totalMatches: 0,
      winRate: 0,
      kdr: 0,
      avgDurationS: 0,
      survival: { avgDurationS: 0, timeOutPct: 0 },
    });
  });

  it('uses PlayerStats for winRate and kdr', () => {
    const t = computeTelemetry({
      ...base,
      totalMatches: 4,
      avgDurationS: 300.5,
      reasonCounts: { time_out: 1, core_destroyed: 3 },
      stats: { matchesPlayed: 10, wins: 6, losses: 4, coresDestroyed: 6, zombiesKilled: 34 },
    });
    expect(t.winRate).toBe(0.6);
    expect(t.kdr).toBe(10);
    expect(t.avgDurationS).toBe(300.5);
    expect(t.survival.timeOutPct).toBe(25);
  });

  it('falls back to MatchPlayer rows and avoids division by zero', () => {
    const t = computeTelemetry({
      ...base,
      totalMatches: 2,
      stats: { ...base.stats, zombiesKilled: 5 },
      players: { total: 4, winners: 2 },
    });
    expect(t.winRate).toBe(0.5);
    expect(t.kdr).toBe(5);
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
});

describe('testEndpointsEnabled', () => {
  it('follows env rules', () => {
    expect(testEndpointsEnabled({ NODE_ENV: 'production' })).toBe(false);
    expect(testEndpointsEnabled({ NODE_ENV: 'production', ENABLE_TEST_ENDPOINTS: 'true' })).toBe(true);
    expect(testEndpointsEnabled({ NODE_ENV: 'development' })).toBe(true);
    expect(testEndpointsEnabled({ NODE_ENV: 'development', ENABLE_TEST_ENDPOINTS: 'false' })).toBe(false);
  });
});
