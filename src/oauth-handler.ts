import axios from 'axios';
import * as crypto from 'crypto';

const ETSY_AUTH_BASE = 'https://www.etsy.com/oauth';
const ETSY_API_BASE = 'https://openapi.etsy.com/v3';

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

export class OAuthHandler {
  private codeVerifiers: Map<string, string> = new Map();

  /**
   * Generate PKCE code verifier and challenge
   */
  private generatePKCE(): { codeVerifier: string; codeChallenge: string } {
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto
      .createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');

    return { codeVerifier, codeChallenge };
  }

  /**
   * Get authorization URL for OAuth2 flow
   * Returns both the URL and the code verifier/state for storage
   */
  async getAuthorizationUrl(clientId: string, clientSecret: string): Promise<{
    url: string;
    codeVerifier: string;
    state: string;
  }> {
    const { codeVerifier, codeChallenge } = this.generatePKCE();
    
    // Store code verifier temporarily (in production, use a more secure storage)
    const state = crypto.randomBytes(16).toString('hex');
    this.codeVerifiers.set(state, codeVerifier);

    const params = new URLSearchParams({
      response_type: 'code',
      redirect_uri: 'urn:ietf:wg:oauth:2.0:oob', // Out-of-band for CLI
      scope: 'listings_r listings_w shops_r shops_w transactions_r transactions_w',
      client_id: clientId,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    return {
      url: `${ETSY_AUTH_BASE}/connect?${params.toString()}`,
      codeVerifier,
      state,
    };
  }

  /**
   * Exchange authorization code for access token
   */
  async exchangeCode(
    clientId: string,
    clientSecret: string,
    code: string,
    codeVerifier: string
  ): Promise<TokenResponse> {
    // Try to get from memory first (if state was provided)
    let verifier = codeVerifier;
    
    if (!verifier) {
      throw new Error('Code verifier is required');
    }

    const response = await axios.post(
      `${ETSY_API_BASE}/public/oauth/token`,
      new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        redirect_uri: 'urn:ietf:wg:oauth:2.0:oob',
        code,
        code_verifier: codeVerifier,
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        auth: {
          username: clientId,
          password: clientSecret,
        },
      }
    );

    return response.data;
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshToken(
    clientId: string,
    clientSecret: string,
    refreshToken: string
  ): Promise<TokenResponse> {
    const response = await axios.post(
      `${ETSY_API_BASE}/public/oauth/token`,
      new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: clientId,
        refresh_token: refreshToken,
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        auth: {
          username: clientId,
          password: clientSecret,
        },
      }
    );

    return response.data;
  }
}

