/**
 * Token Manager - handles secure token storage and expiry checks
 * Currently tokens are stored in the config file, but this could be extended
 * to use encrypted storage or a secure keychain
 */

/**
 * How long before actual expiry we treat a token as needing refresh.
 * Etsy access tokens are short-lived; refreshing a little early avoids a
 * request landing right on the expiry boundary and failing.
 */
export const DEFAULT_REFRESH_BUFFER_MS = 60_000;

export class TokenManager {
  // Placeholder for future secure token storage implementation
  // For now, tokens are stored in the config file via the main server

  async storeTokens(shopId: string, tokens: {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
  }): Promise<void> {
    // Implementation would go here for secure storage
    // Currently handled by the main server's config file
  }

  async getTokens(shopId: string): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
  } | null> {
    // Implementation would go here
    return null;
  }

  /**
   * Returns true when `tokenExpiry` (ms since epoch) is at or past the
   * refresh threshold — i.e. already expired, or within `bufferMs` of
   * expiring.
   */
  isExpiredOrNeedsRefresh(
    tokenExpiry: number,
    now: number = Date.now(),
    bufferMs: number = DEFAULT_REFRESH_BUFFER_MS
  ): boolean {
    return now >= tokenExpiry - bufferMs;
  }
}

