import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import { SilpoOAuthProvider } from './oauthProvider';

const SILPO_MCP_URL = process.env.SILPO_MCP_URL ?? 'https://mcp.silpo.ua/mcp';

/**
 * Connects to the official Silpo MCP server, running the browser-based
 * OAuth 2.1 + PKCE flow on first use. Cached tokens (.silpo-tokens.json)
 * let subsequent runs skip the browser entirely.
 */
function makeTransport(
  authProvider: SilpoOAuthProvider,
): StreamableHTTPClientTransport {
  return new StreamableHTTPClientTransport(new URL(SILPO_MCP_URL), {
    authProvider,
  });
}

export async function connectSilpoMcp(): Promise<Client> {
  const authProvider = new SilpoOAuthProvider();
  const client = new Client(
    { name: 'silpo-family-ration-agent', version: '0.1.0' },
    { capabilities: {} },
  );
  const failedTransport = makeTransport(authProvider);

  try {
    await client.connect(failedTransport);
  } catch (err) {
    if (!(err instanceof UnauthorizedError)) throw err;
    if (!authProvider.lastAuthorizationCode) throw err;

    // finishAuth() on the SAME transport that 401'd reuses the OAuth
    // discovery info (resourceMetadataUrl/scope) it captured from the
    // WWW-Authenticate header. The retry connect() needs a FRESH transport
    // instance though — start() already ran once on failedTransport, and
    // calling connect() on it again throws "already started".
    await failedTransport.finishAuth(authProvider.lastAuthorizationCode);
    await client.connect(makeTransport(authProvider));
  }

  return client;
}
