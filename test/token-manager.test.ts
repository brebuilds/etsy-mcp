import { describe, it, expect } from 'vitest';
import { TokenManager, DEFAULT_REFRESH_BUFFER_MS } from '../src/token-manager.js';

describe('TokenManager.isExpiredOrNeedsRefresh', () => {
  const tm = new TokenManager();
  const now = 1_000_000_000_000; // fixed reference point

  it('is false well before expiry', () => {
    const tokenExpiry = now + 10 * 60 * 1000; // 10 minutes out
    expect(tm.isExpiredOrNeedsRefresh(tokenExpiry, now)).toBe(false);
  });

  it('is true once the token has already expired', () => {
    const tokenExpiry = now - 1;
    expect(tm.isExpiredOrNeedsRefresh(tokenExpiry, now)).toBe(true);
  });

  it('is true exactly at the refresh buffer boundary (now === expiry - buffer)', () => {
    const tokenExpiry = now + DEFAULT_REFRESH_BUFFER_MS;
    expect(tm.isExpiredOrNeedsRefresh(tokenExpiry, now)).toBe(true);
  });

  it('is false one millisecond before the refresh buffer boundary', () => {
    const tokenExpiry = now + DEFAULT_REFRESH_BUFFER_MS + 1;
    expect(tm.isExpiredOrNeedsRefresh(tokenExpiry, now)).toBe(false);
  });

  it('is true one millisecond after the refresh buffer boundary', () => {
    const tokenExpiry = now + DEFAULT_REFRESH_BUFFER_MS - 1;
    expect(tm.isExpiredOrNeedsRefresh(tokenExpiry, now)).toBe(true);
  });

  it('honors a custom buffer when supplied', () => {
    const tokenExpiry = now + 5000;
    expect(tm.isExpiredOrNeedsRefresh(tokenExpiry, now, 10_000)).toBe(true);
    expect(tm.isExpiredOrNeedsRefresh(tokenExpiry, now, 1_000)).toBe(false);
  });

  it('defaults `now` to the current time when not supplied', () => {
    const farFuture = Date.now() + 60 * 60 * 1000; // 1 hour out
    expect(tm.isExpiredOrNeedsRefresh(farFuture)).toBe(false);

    const past = Date.now() - 1;
    expect(tm.isExpiredOrNeedsRefresh(past)).toBe(true);
  });
});

describe('TokenManager storage placeholders', () => {
  it('getTokens resolves null (no secure storage implemented yet)', async () => {
    const tm = new TokenManager();
    await expect(tm.getTokens('some-shop')).resolves.toBeNull();
  });

  it('storeTokens resolves without throwing', async () => {
    const tm = new TokenManager();
    await expect(
      tm.storeTokens('some-shop', { accessToken: 'a', refreshToken: 'b', expiresAt: 0 })
    ).resolves.toBeUndefined();
  });
});
