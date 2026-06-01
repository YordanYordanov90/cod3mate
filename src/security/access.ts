import type { Context } from 'grammy';

/**
 * Access control helpers.
 * Owner whitelist enforcement lives here (per architecture invariants).
 *
 * These must be applied **before** any command or message handler.
 */

export function isAllowedUser(
  telegramUserId: number | undefined,
  allowedUserId: number
): boolean {
  if (typeof telegramUserId !== 'number' || typeof allowedUserId !== 'number') {
    return false;
  }
  return telegramUserId === allowedUserId;
}

/**
 * Grammy middleware that silently drops updates from non-whitelisted users.
 * No response is sent (avoids revealing bot presence).
 * Registered first in the middleware chain.
 */
export function createOwnerWhitelistMiddleware(allowedUserId: number) {
  return async (ctx: Context, next: () => Promise<void>) => {
    const fromId = ctx.from?.id;

    if (!isAllowedUser(fromId, allowedUserId)) {
      // Intentionally silent. Do not call next().
      // In future we may add sanitized debug logging here.
      return;
    }

    await next();
  };
}