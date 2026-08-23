import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientInformationFull,
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import type { SilpoAuthSessionStore } from './silpoAuthSession.service';

const CLIENT_INFO_FILE = '.silpo-web-client.json';

/**
 * Dynamic client registration (RFC 7591) registers this app ONCE with a
 * given redirect_uri — every end user then runs the Authorization Code
 * flow against that same registered client to get their own tokens. So
 * this part is shared/global (cached on disk), unlike tokens (Postgres,
 * per session — see SilpoAuthSessionStore) below. Kept in its own file,
 * separate from oauthProvider.ts's `.silpo-tokens.json`, because that CLI
 * provider registers a different redirect_uri (a local callback port, not
 * this server's /auth/silpo/callback) — reusing one registration across
 * two different redirect_uris would get rejected by the auth server.
 */
function loadClientInformation(): OAuthClientInformationFull | undefined {
  if (!existsSync(CLIENT_INFO_FILE)) return undefined;
  return JSON.parse(
    readFileSync(CLIENT_INFO_FILE, 'utf-8'),
  ) as OAuthClientInformationFull;
}

function saveClientInformationToDisk(info: OAuthClientInformationFull): void {
  writeFileSync(CLIENT_INFO_FILE, JSON.stringify(info, null, 2));
}

/**
 * One instance per (sessionId, request) — cheap to construct, all the real
 * state lives in `store` (Postgres for tokens/accountId, in-memory for the
 * PKCE codeVerifier — see SilpoAuthSessionStore), so two instances for the
 * same session see the same state.
 *
 * Unlike oauthProvider.ts's CLI provider, `redirectToAuthorization` does
 * NOT open a browser itself — there's no browser to open on a server
 * handling requests from many different users. It just records the URL;
 * the caller (silpo-auth.controller.ts) sends an HTTP redirect to it,
 * putting the interactive part in the end user's own browser.
 */
export class WebSilpoOAuthProvider implements OAuthClientProvider {
  pendingAuthorizationUrl: string | undefined;

  constructor(
    private readonly sessionId: string,
    private readonly redirectUri: string,
    private readonly store: SilpoAuthSessionStore,
  ) {}

  get redirectUrl(): string {
    return this.redirectUri;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      redirect_uris: [this.redirectUri],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      client_name: 'Silpo Family Ration Agent (Web)',
    };
  }

  state(): string {
    return this.sessionId;
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    return loadClientInformation();
  }

  saveClientInformation(clientInformation: OAuthClientInformationFull): void {
    saveClientInformationToDisk(clientInformation);
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    const state = await this.store.get(this.sessionId);
    return state.tokens;
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    await this.store.saveTokens(this.sessionId, tokens);
  }

  saveCodeVerifier(codeVerifier: string): void {
    this.store.saveCodeVerifier(this.sessionId, codeVerifier);
  }

  codeVerifier(): string {
    const verifier = this.store.getCodeVerifier(this.sessionId);
    if (!verifier) {
      throw new Error('No PKCE code verifier saved for this session');
    }
    return verifier;
  }

  redirectToAuthorization(authorizationUrl: URL): void {
    this.pendingAuthorizationUrl = authorizationUrl.toString();
  }
}
