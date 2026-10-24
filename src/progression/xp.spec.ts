import { applyXp, computeMatchXp, MAX_LEVEL, xpToNext } from './xp';

const base = { won: false, draw: false, zombieKills: 0, playerKills: 0, structuresBuilt: 0, coreDestroyedWin: false, durationS: 120 };

describe('computeMatchXp', () => {
  it('gives participation only on a plain loss', () => expect(computeMatchXp(base)).toBe(50));
  it('adds win and draw bonuses', () => {
    expect(computeMatchXp({ ...base, won: true })).toBe(150);
    expect(computeMatchXp({ ...base, draw: true })).toBe(90);
  });
  it('adds kills, structures (capped) and core bonus', () => {
    expect(computeMatchXp({ ...base, zombieKills: 10, playerKills: 2 })).toBe(50 + 30 + 40);
    expect(computeMatchXp({ ...base, structuresBuilt: 10 })).toBe(70);
    expect(computeMatchXp({ ...base, structuresBuilt: 500 })).toBe(150);
    expect(computeMatchXp({ ...base, won: true, coreDestroyedWin: true })).toBe(200);
  });
  it('anti-farm: short matches give 10 xp', () => {
    expect(computeMatchXp({ ...base, won: true, zombieKills: 99, durationS: 29 })).toBe(10);
    expect(computeMatchXp({ ...base, durationS: 30 })).toBe(50);
  });
});

describe('xpToNext / applyXp', () => {
  it('xpToNext grows linearly', () => {
    expect(xpToNext(1)).toBe(100);
    expect(xpToNext(3)).toBe(200);
  });
  it('keeps progress inside the level', () => {
    expect(applyXp(1, 20, 30)).toEqual({ level: 1, xp: 50, leveledUp: false, levelsGained: 0 });
  });
  it('levels up and carries remainder', () => {
    expect(applyXp(1, 90, 20)).toEqual({ level: 2, xp: 10, leveledUp: true, levelsGained: 1 });
  });
  it('supports multiple level-ups', () => {
    // 100 + 150 + 200 = 450 to reach level 4
    expect(applyXp(1, 0, 460)).toEqual({ level: 4, xp: 10, leveledUp: true, levelsGained: 3 });
  });
  it('caps at max level', () => {
    const r = applyXp(MAX_LEVEL - 1, 0, 1_000_000);
    expect(r).toMatchObject({ level: MAX_LEVEL, xp: 0, leveledUp: true, levelsGained: 1 });
    expect(applyXp(MAX_LEVEL, 0, 500)).toMatchObject({ level: MAX_LEVEL, xp: 0, leveledUp: false });
  });
});
