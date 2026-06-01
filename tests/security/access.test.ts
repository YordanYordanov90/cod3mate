import { describe, it, expect, vi } from 'vitest';
import type { Context } from 'grammy';
import {
  isAllowedUser,
  createOwnerWhitelistMiddleware,
} from '../../src/security/access.js';

describe('security access control', () => {
  it('allows exact match on allowed user id', () => {
    expect(isAllowedUser(123456789, 123456789)).toBe(true);
  });

  it('rejects different user id', () => {
    expect(isAllowedUser(987654321, 123456789)).toBe(false);
  });

  it('rejects undefined user id (channels, anonymous, etc.)', () => {
    expect(isAllowedUser(undefined, 123456789)).toBe(false);
  });

  it('rejects non-number types safely', () => {
    expect(isAllowedUser('123' as unknown as number, 123)).toBe(false);
    expect(isAllowedUser(123, '123' as unknown as number)).toBe(false);
  });

  it('rejects when allowed id is invalid', () => {
    expect(isAllowedUser(123, NaN)).toBe(false);
  });
});

describe('owner whitelist middleware', () => {
  const OWNER_ID = 123456789;

  // Minimal ctx factory — only the fields the middleware reads.
  // Cast through unknown because we are intentionally building a partial Context.
  function makeCtx(fromId: number | undefined): Context {
    return { from: fromId === undefined ? undefined : { id: fromId } } as unknown as Context;
  }

  it('calls next() for the owner', async () => {
    const middleware = createOwnerWhitelistMiddleware(OWNER_ID);
    const next = vi.fn(async () => {});

    await middleware(makeCtx(OWNER_ID), next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('does NOT call next() for a foreign user id', async () => {
    const middleware = createOwnerWhitelistMiddleware(OWNER_ID);
    const next = vi.fn(async () => {});

    await middleware(makeCtx(999999999), next);

    expect(next).not.toHaveBeenCalled();
  });

  it('does NOT call next() when ctx.from is undefined (channel/anonymous)', async () => {
    const middleware = createOwnerWhitelistMiddleware(OWNER_ID);
    const next = vi.fn(async () => {});

    await middleware(makeCtx(undefined), next);

    expect(next).not.toHaveBeenCalled();
  });

  it('silently drops (does not throw, does not reply) for non-owners', async () => {
    const middleware = createOwnerWhitelistMiddleware(OWNER_ID);
    const next = vi.fn(async () => {});
    // ctx has NO reply method — if the middleware ever tried to respond, it would throw.
    const ctx = makeCtx(42);

    await expect(middleware(ctx, next)).resolves.toBeUndefined();
    expect(next).not.toHaveBeenCalled();
  });

  it('blocks before downstream handlers run (handler spy stays untouched)', async () => {
    const middleware = createOwnerWhitelistMiddleware(OWNER_ID);
    const downstreamHandler = vi.fn(async () => {});
    // Simulate the real chain: middleware -> next() -> downstream handler.
    const next = vi.fn(async () => {
      await downstreamHandler();
    });

    await middleware(makeCtx(987654321), next);

    expect(next).not.toHaveBeenCalled();
    expect(downstreamHandler).not.toHaveBeenCalled();
  });
});