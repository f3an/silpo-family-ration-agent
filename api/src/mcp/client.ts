import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import { SilpoOAuthProvider } from './oauthProvider';

const SILPO_MCP_URL = process.env.SILPO_MCP_URL ?? 'https://mcp.silpo.ua/mcp';

function makeTransport(
  authProvider: OAuthClientProvider,
): StreamableHTTPClientTransport {
  return new StreamableHTTPClientTransport(new URL(SILPO_MCP_URL), {
    authProvider,
  });
}

/**
 * Connects to the official Silpo MCP server with the given OAuth provider.
 * A provider that already holds valid tokens (the web-login flow, once
 * silpo-auth.controller.ts has completed the exchange) connects on the
 * first try. A provider that still needs an interactive authorization round
 * — the CLI/local-dev `SilpoOAuthProvider`, which opens a browser itself —
 * 401s once, then retries after `authProvider.lastAuthorizationCode` (if the
 * provider exposes one) resolves via `finishAuth()`.
 */
export async function connectSilpoMcpWithProvider(
  authProvider: OAuthClientProvider,
): Promise<Client> {
  const client = new Client(
    { name: 'silpo-family-ration-agent', version: '0.1.0' },
    { capabilities: {} },
  );
  const failedTransport = makeTransport(authProvider);

  try {
    await client.connect(failedTransport);
  } catch (err) {
    if (!(err instanceof UnauthorizedError)) throw err;
    const authorizationCode = (
      authProvider as { lastAuthorizationCode?: string }
    ).lastAuthorizationCode;
    if (!authorizationCode) throw err;

    // finishAuth() on the SAME transport that 401'd reuses the OAuth
    // discovery info (resourceMetadataUrl/scope) it captured from the
    // WWW-Authenticate header. The retry connect() needs a FRESH transport
    // instance though — start() already ran once on failedTransport, and
    // calling connect() on it again throws "already started".
    await failedTransport.finishAuth(authorizationCode);
    await client.connect(makeTransport(authProvider));
  }

  return client;
}

/**
 * Connects using the shared, file-cached CLI provider — what `npm run chat`
 * / `npm run test:mcp` / the legacy single-session `/agent/messages` chat
 * endpoint use. Opens a browser and runs a local callback server on first
 * use; cached tokens (.silpo-tokens.json) skip that on later runs.
 */
export async function connectSilpoMcp(): Promise<Client> {
  return connectSilpoMcpWithProvider(new SilpoOAuthProvider());
}
