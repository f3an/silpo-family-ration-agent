import { WebSilpoOAuthProvider } from './webOauthProvider';
import type { SilpoAuthSessionStore } from './silpoAuthSession.service';
import type { OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';

jest.mock('node:fs');
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const mockExistsSync = existsSync as jest.MockedFunction<typeof existsSync>;
const mockReadFileSync = readFileSync as jest.MockedFunction<
  typeof readFileSync
>;
const mockWriteFileSync = writeFileSync as jest.MockedFunction<
  typeof writeFileSync
>;

/** Fake of just the SilpoAuthSessionStore surface WebSilpoOAuthProvider uses. */
function fakeStore(): SilpoAuthSessionStore {
  const tokens = new Map<string, OAuthTokens>();
  const verifiers = new Map<string, string>();
  return {
    get: jest.fn((sessionId: string) =>
      Promise.resolve({ tokens: tokens.get(sessionId) }),
    ),
    saveTokens: jest.fn((sessionId: string, t: OAuthTokens) => {
      tokens.set(sessionId, t);
      return Promise.resolve();
    }),
    saveCodeVerifier: jest.fn((sessionId: string, v: string) => {
      verifiers.set(sessionId, v);
    }),
    getCodeVerifier: jest.fn((sessionId: string) => verifiers.get(sessionId)),
  } as unknown as SilpoAuthSessionStore;
}

describe('WebSilpoOAuthProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('exposes the given redirect URI and includes it in clientMetadata', () => {
    const provider = new WebSilpoOAuthProvider(
      's1',
      'http://localhost:3000/auth/silpo/callback',
      fakeStore(),
    );

    expect(provider.redirectUrl).toBe(
      'http://localhost:3000/auth/silpo/callback',
    );
    expect(provider.clientMetadata.redirect_uris).toEqual([
      'http://localhost:3000/auth/silpo/callback',
    ]);
  });

  it('state() returns the sessionId, correlating the callback to this session', () => {
    const provider = new WebSilpoOAuthProvider(
      'session-abc',
      'http://x/callback',
      fakeStore(),
    );

    expect(provider.state()).toBe('session-abc');
  });

  it('records the authorization URL instead of opening a browser', () => {
    const provider = new WebSilpoOAuthProvider(
      's1',
      'http://x/callback',
      fakeStore(),
    );
    const url = new URL('https://auth.silpo.ua/authorize?client_id=abc');

    provider.redirectToAuthorization(url);

    expect(provider.pendingAuthorizationUrl).toBe(url.toString());
  });

  it('reads and writes tokens/codeVerifier through the store', async () => {
    const store = fakeStore();
    const provider = new WebSilpoOAuthProvider(
      's1',
      'http://x/callback',
      store,
    );

    await expect(provider.tokens()).resolves.toBeUndefined();
    await provider.saveTokens({ access_token: 'tok', token_type: 'bearer' });
    await expect(provider.tokens()).resolves.toEqual({
      access_token: 'tok',
      token_type: 'bearer',
    });

    provider.saveCodeVerifier('verifier-123');
    expect(provider.codeVerifier()).toBe('verifier-123');
  });

  it('codeVerifier() throws when none was saved for this session', () => {
    const provider = new WebSilpoOAuthProvider(
      's1',
      'http://x/callback',
      fakeStore(),
    );

    expect(() => provider.codeVerifier()).toThrow();
  });

  it('two providers for different sessions do not see each other tokens', async () => {
    const store = fakeStore();
    const providerA = new WebSilpoOAuthProvider(
      'a',
      'http://x/callback',
      store,
    );
    const providerB = new WebSilpoOAuthProvider(
      'b',
      'http://x/callback',
      store,
    );

    await providerA.saveTokens({ access_token: 'tok-a', token_type: 'bearer' });

    const tokensA = await providerA.tokens();
    const tokensB = await providerB.tokens();
    expect(tokensA?.access_token).toBe('tok-a');
    expect(tokensB).toBeUndefined();
  });

  it('clientInformation() returns undefined when no registration file exists yet', () => {
    mockExistsSync.mockReturnValue(false);
    const provider = new WebSilpoOAuthProvider(
      's1',
      'http://x/callback',
      fakeStore(),
    );

    expect(provider.clientInformation()).toBeUndefined();
    expect(mockReadFileSync).not.toHaveBeenCalled();
  });

  it('clientInformation() reads the shared registration file when it exists', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({ client_id: 'shared-client-id' }),
    );
    const provider = new WebSilpoOAuthProvider(
      's1',
      'http://x/callback',
      fakeStore(),
    );

    expect(provider.clientInformation()).toEqual({
      client_id: 'shared-client-id',
    });
  });

  it('saveClientInformation() persists to the shared registration file', () => {
    const provider = new WebSilpoOAuthProvider(
      's1',
      'http://x/callback',
      fakeStore(),
    );

    provider.saveClientInformation({
      client_id: 'new-client-id',
      redirect_uris: ['http://x/callback'],
    });

    expect(mockWriteFileSync).toHaveBeenCalledWith(
      '.silpo-web-client.json',
      expect.stringContaining('new-client-id'),
    );
  });
});
