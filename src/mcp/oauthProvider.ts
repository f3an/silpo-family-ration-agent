import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientInformationFull,
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';

const TOKENS_FILE = '.silpo-tokens.json';

interface StoredState {
  clientInformation?: OAuthClientInformationFull;
  tokens?: OAuthTokens;
  codeVerifier?: string;
}

function load(): StoredState {
  if (!existsSync(TOKENS_FILE)) return {};
  return JSON.parse(readFileSync(TOKENS_FILE, 'utf-8')) as StoredState;
}

function save(state: StoredState) {
  writeFileSync(TOKENS_FILE, JSON.stringify(state, null, 2));
}

/**
 * Browser-based OAuth provider for the official Silpo MCP server.
 * On first run it opens auth.silpo.ua in the default browser and
 * catches the redirect on a local HTTP server; tokens are then
 * cached in .silpo-tokens.json so subsequent runs don't need a browser.
 */
export class SilpoOAuthProvider implements OAuthClientProvider {
  private port: number;
  /** Set once the local callback server receives ?code=... from auth.silpo.ua */
  lastAuthorizationCode: string | undefined;

  constructor(port = Number(process.env.OAUTH_CALLBACK_PORT ?? 8765)) {
    this.port = port;
  }

  get redirectUrl(): string {
    return `http://localhost:${this.port}/callback`;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      redirect_uris: [this.redirectUrl],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      client_name: 'Silpo Family Ration Agent (Hackathon)',
    };
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    return load().clientInformation;
  }

  saveClientInformation(clientInformation: OAuthClientInformationFull) {
    save({ ...load(), clientInformation });
  }

  tokens(): OAuthTokens | undefined {
    return load().tokens;
  }

  saveTokens(tokens: OAuthTokens) {
    save({ ...load(), tokens });
  }

  saveCodeVerifier(codeVerifier: string) {
    save({ ...load(), codeVerifier });
  }

  codeVerifier(): string {
    const verifier = load().codeVerifier;
    if (!verifier) throw new Error('No PKCE code verifier saved');
    return verifier;
  }

  /**
   * Opens the authorization URL in the user's browser and waits for the
   * redirect carrying the ?code= param, resolving the outer auth() call
   * by writing the code where index.ts can pick it up.
   */
  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    console.log('\nВідкриваю браузер для авторизації в Сільпо...');
    console.log(
      `Якщо браузер не відкрився сам, перейди за посиланням:\n${authorizationUrl.toString()}\n`,
    );

    const open = (await import('open')).default;
    await open(authorizationUrl.toString());

    this.lastAuthorizationCode = await this.waitForCallback();
  }

  private waitForCallback(): Promise<string> {
    return new Promise((resolve, reject) => {
      const server = createServer((req, res) => {
        const url = new URL(req.url ?? '', `http://localhost:${this.port}`);
        const code = url.searchParams.get('code');
        const error = url.searchParams.get('error');

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(
          error
            ? `<h2>Авторизація не вдалась: ${error}</h2>`
            : '<h2>Готово! Можеш закрити цю вкладку і повернутись у термінал.</h2>',
        );

        server.close();
        if (error || !code)
          reject(new Error(error ?? 'No authorization code received'));
        else resolve(code);
      });

      server.listen(this.port);
    });
  }
}
