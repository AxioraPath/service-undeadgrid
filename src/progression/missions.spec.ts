import { ALL_MISSIONS, DAILY_MISSIONS, MILESTONE_MISSIONS } from './missions.catalog';
import { checkClaim, dayKey, missionStatus, nextProgress, nextUtcMidnight, pickDailyMissions } from './missions.logic';

describe('catalog', () => {
  it('has unique keys and sane values', () => {
    expect(new Set(ALL_MISSIONS.map((m) => m.key)).size).toBe(ALL_MISSIONS.length);
    expect(DAILY_MISSIONS.length).toBeGreaterThanOrEqual(8);
    for (const m of DAILY_MISSIONS) {
      expect(m.reward).toBeGreaterThanOrEqual(60);
      expect(m.reward).toBeLessThanOrEqual(150);
      expect(m.metric).not.toBe('level_reached');
    }
    for (const m of MILESTONE_MISSIONS) expect(m.goal).toBeGreaterThan(0);
  });
});

describe('pickDailyMissions', () => {
  it('is deterministic and returns 3 distinct dailies', () => {
    const a = pickDailyMissions('user-1', '2026-10-24');
    expect(pickDailyMissions('user-1', '2026-10-24').map((m) => m.key)).toEqual(a.map((m) => m.key));
    expect(a).toHaveLength(3);
    expect(new Set(a.map((m) => m.key)).size).toBe(3);
    expect(a.every((m) => m.type === 'daily')).toBe(true);
  });
  it('varies across users and days', () => {
    const keys = new Set<string>();
    for (let i = 0; i < 20; i++) keys.add(pickDailyMissions(`u${i}`, '2026-10-24').map((m) => m.key).join());
    expect(keys.size).toBeGreaterThan(1);
    const days = new Set<string>();
    for (let i = 1; i < 20; i++) days.add(pickDailyMissions('u', `2026-10-${String(i).padStart(2, '0')}`).map((m) => m.key).join());
    expect(days.size).toBeGreaterThan(1);
  });
});

describe('progress / status', () => {
  const play10 = MILESTONE_MISSIONS.find((m) => m.key === 'ms_play_10')!;
  const lvl5 = MILESTONE_MISSIONS.find((m) => m.key === 'ms_level_5')!;
  it('adds deltas and caps at goal', () => {
    expect(nextProgress(play10, 3, { matches_played: 2 })).toBe(5);
    expect(nextProgress(play10, 9, { matches_played: 5 })).toBe(10);
    expect(nextProgress(play10, 4, { zombie_kills: 9 })).toBe(4);
  });
  it('level_reached takes max, not sum', () => {
    expect(nextProgress(lvl5, 2, { level_reached: 4 })).toBe(4);
    expect(nextProgress(lvl5, 4, { level_reached: 3 })).toBe(4);
    expect(nextProgress(lvl5, 4, { level_reached: 9 })).toBe(5);
  });
  it('status and claim checks', () => {
    const d = new Date();
    expect(missionStatus({ completedAt: null, claimedAt: null })).toBe('active');
    expect(missionStatus({ completedAt: d, claimedAt: null })).toBe('completed');
    expect(missionStatus({ completedAt: d, claimedAt: d })).toBe('claimed');
    expect(checkClaim({ completedAt: null, claimedAt: null })).toBe('not_completed');
    expect(checkClaim({ completedAt: d, claimedAt: null })).toBe('ok');
    expect(checkClaim({ completedAt: d, claimedAt: d })).toBe('already_claimed');
  });
  it('UTC day helpers', () => {
    const now = new Date('2026-10-24T23:59:00Z');
    expect(dayKey(now)).toBe('2026-10-24');
    expect(nextUtcMidnight(now).toISOString()).toBe('2026-10-25T00:00:00.000Z');
  });
});
