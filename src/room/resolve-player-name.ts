import { LIMITS } from '../config/game.config';

/**
 * Resolves the in-game player name.
 * Authenticated sockets use the account display name (server-trusted, so the
 * client cannot impersonate another account); guests use the name they sent.
 * Returns the trimmed, length-capped name, or null if nothing usable remains.
 */
export function resolvePlayerName(
  accountDisplayName: string | null | undefined,
  payloadName: string | null | undefined,
): string | null {
  const normalize = (s: string | null | undefined): string =>
    (s ?? '').trim().slice(0, LIMITS.nameMaxLength).trim();
  const account = normalize(accountDisplayName);
  if (account.length >= LIMITS.nameMinLength) return account;
  const fallback = normalize(payloadName);
  return fallback.length >= LIMITS.nameMinLength ? fallback : null;
}
