import { describe, it, expect } from 'vitest';
import * as crypto from 'crypto';
import { OAuthHandler } from '../src/oauth-handler.js';

describe('OAuthHandler PKCE generation', () => {
  it('produces a code verifier of the length crypto.randomBytes(32) base64url yields (43 chars)', async () => {
    const handler = new OAuthHandler();
    const { codeVerifier } = await handler.getAuthorizationUrl('client-id', 'client-secret');
    expect(codeVerifier).toHaveLength(43);
  });

  it('produces a code verifier using only the base64url charset', async () => {
    const handler = new OAuthHandler();
    const { codeVerifier } = await handler.getAuthorizationUrl('client-id', 'client-secret');
    expect(codeVerifier).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('produces a different code verifier on each call', async () => {
    const handler = new OAuthHandler();
    const first = await handler.getAuthorizationUrl('client-id', 'client-secret');
    const second = await handler.getAuthorizationUrl('client-id', 'client-secret');
    expect(first.codeVerifier).not.toEqual(second.codeVerifier);
  });

  it('embeds a code_challenge that is the base64url(SHA-256(codeVerifier)), per RFC 7636 S256', async () => {
    const handler = new OAuthHandler();
    const { url, codeVerifier } = await handler.getAuthorizationUrl('client-id', 'client-secret');
    const parsed = new URL(url);
    const codeChallenge = parsed.searchParams.get('code_challenge');

    const expectedChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

    expect(codeChallenge).toEqual(expectedChallenge);
  });

  it('always declares code_challenge_method=S256', async () => {
    const handler = new OAuthHandler();
    const { url } = await handler.getAuthorizationUrl('client-id', 'client-secret');
    const parsed = new URL(url);
    expect(parsed.searchParams.get('code_challenge_method')).toEqual('S256');
  });
});

describe('OAuthHandler authorization URL construction', () => {
  it('targets the Etsy OAuth connect endpoint', async () => {
    const handler = new OAuthHandler();
    const { url } = await handler.getAuthorizationUrl('client-id', 'client-secret');
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toEqual('https://www.etsy.com/oauth/connect');
  });

  it('sets response_type=code', async () => {
    const handler = new OAuthHandler();
    const { url } = await handler.getAuthorizationUrl('client-id', 'client-secret');
    const parsed = new URL(url);
    expect(parsed.searchParams.get('response_type')).toEqual('code');
  });

  it('uses the out-of-band redirect URI for CLI flows', async () => {
    const handler = new OAuthHandler();
    const { url } = await handler.getAuthorizationUrl('client-id', 'client-secret');
    const parsed = new URL(url);
    expect(parsed.searchParams.get('redirect_uri')).toEqual('urn:ietf:wg:oauth:2.0:oob');
  });

  it('requests the expected listings/shops/transactions read+write scopes', async () => {
    const handler = new OAuthHandler();
    const { url } = await handler.getAuthorizationUrl('client-id', 'client-secret');
    const parsed = new URL(url);
    const scope = parsed.searchParams.get('scope');
    expect(scope?.split(' ').sort()).toEqual(
      ['listings_r', 'listings_w', 'shops_r', 'shops_w', 'transactions_r', 'transactions_w'].sort()
    );
  });

  it('passes the given client_id through unchanged', async () => {
    const handler = new OAuthHandler();
    const { url } = await handler.getAuthorizationUrl('my-real-client-id', 'client-secret');
    const parsed = new URL(url);
    expect(parsed.searchParams.get('client_id')).toEqual('my-real-client-id');
  });

  it('includes a state parameter and returns the same value alongside the URL', async () => {
    const handler = new OAuthHandler();
    const { url, state } = await handler.getAuthorizationUrl('client-id', 'client-secret');
    const parsed = new URL(url);
    expect(state).toBeTruthy();
    expect(parsed.searchParams.get('state')).toEqual(state);
  });

  it('generates a unique state per call, so concurrent auth attempts cannot collide', async () => {
    const handler = new OAuthHandler();
    const first = await handler.getAuthorizationUrl('client-id', 'client-secret');
    const second = await handler.getAuthorizationUrl('client-id', 'client-secret');
    expect(first.state).not.toEqual(second.state);
  });
});
