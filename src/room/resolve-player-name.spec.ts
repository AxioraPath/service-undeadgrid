import { LIMITS } from '../config/game.config';
import { resolvePlayerName } from './resolve-player-name';

describe('resolvePlayerName', () => {
  it('uses the account display name over the payload name', () => {
    expect(resolvePlayerName('Alice', 'Bob')).toBe('Alice');
  });

  it('trims the account name', () => {
    expect(resolvePlayerName('  Alice  ', 'Bob')).toBe('Alice');
  });

  it('caps the account name to the max length', () => {
    const long = 'x'.repeat(LIMITS.nameMaxLength + 10);
    expect(resolvePlayerName(long, 'Bob')).toHaveLength(LIMITS.nameMaxLength);
  });

  it('uses the payload name for guests', () => {
    expect(resolvePlayerName(null, '  Bob ')).toBe('Bob');
    expect(resolvePlayerName(undefined, 'Bob')).toBe('Bob');
  });

  it('falls back to the payload when the account name is blank', () => {
    expect(resolvePlayerName('   ', 'Bob')).toBe('Bob');
  });

  it('caps the guest name', () => {
    const long = 'y'.repeat(LIMITS.nameMaxLength + 5);
    expect(resolvePlayerName(null, long)).toBe('y'.repeat(LIMITS.nameMaxLength));
  });

  it('returns null when nothing usable', () => {
    expect(resolvePlayerName(null, '   ')).toBeNull();
    expect(resolvePlayerName('', undefined)).toBeNull();
  });
});
