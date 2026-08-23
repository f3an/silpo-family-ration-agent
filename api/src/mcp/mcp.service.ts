import {
  Injectable,
  Logger,
  OnModuleDestroy,
  UnauthorizedException,
} from '@nestjs/common';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { connectSilpoMcp, connectSilpoMcpWithProvider } from './client';
import { SilpoAuthSessionStore } from './silpoAuthSession.service';
import { WebSilpoOAuthProvider } from './webOauthProvider';

/**
 * Owns Silpo MCP connections: one shared long-lived connection for the
 * legacy CLI/chat flow (getClient — file-cached tokens, one browser login
 * for whoever runs the server), plus one per-session connection for the
 * web client's own-account login (getClientForSession — see
 * silpo-auth.controller.ts).
 *
 * Both connect lazily on first use rather than in onModuleInit(): the CLI
 * flow's OAuth would otherwise open a browser and block the whole Nest app
 * from ever calling listen() — fatal in a headless container. Deferring
 * connects means the HTTP server (and its health check) comes up
 * regardless of Silpo auth state; only a request that actually needs MCP
 * pays the connection cost.
 */
@Injectable()
export class McpService implements OnModuleDestroy {
  private readonly logger = new Logger(McpService.name);
  private clientPromise: Promise<Client> | undefined;
  private readonly sessionClients = new Map<string, Promise<Client>>();

  constructor(private readonly authSessions: SilpoAuthSessionStore) {}

  async getClient(): Promise<Client> {
    if (!this.clientPromise) {
      this.clientPromise = connectSilpoMcp().catch((err: unknown) => {
        this.clientPromise = undefined;
        throw err;
      });
    }
    return this.clientPromise;
  }

  /**
   * A Client authenticated as whichever Silpo account this browser session
   * logged into via /auth/silpo/authorize. Throws if that session never
   * completed login — callers (AgentService) turn that into a 401 the
   * client's wizard can react to by re-showing the login button.
   */
  async getClientForSession(sessionId: string): Promise<Client> {
    let promise = this.sessionClients.get(sessionId);
    if (!promise) {
      if (!(await this.authSessions.isAuthenticated(sessionId))) {
        throw new UnauthorizedException(
          'This session has not logged in to Silpo yet — call /auth/silpo/authorize first.',
        );
      }
      const provider = new WebSilpoOAuthProvider(
        sessionId,
        '/auth/silpo/callback',
        this.authSessions,
      );
      promise = connectSilpoMcpWithProvider(provider).catch((err: unknown) => {
        this.sessionClients.delete(sessionId);
        throw err;
      });
      this.sessionClients.set(sessionId, promise);
    }
    return promise;
  }

  /**
   * Stable Silpo account id (silpo_get_my_profile().profile.id) for this
   * session — the key UserPreferencesStore uses, so preferences follow the
   * account across browsers/devices rather than the browser-local
   * sessionId. Cached on the session's Postgres row after the first lookup.
   */
  async getAccountId(sessionId: string): Promise<string> {
    const session = await this.authSessions.get(sessionId);
    if (session.accountId) return session.accountId;

    const mcp = await this.getClientForSession(sessionId);
    const result = await mcp.callTool({
      name: 'silpo_get_my_profile',
      arguments: {},
    });
    const structured = result.structuredContent as
      { profile?: { id?: string } } | undefined;
    const accountId = structured?.profile?.id;
    if (!accountId) {
      throw new Error(
        'Could not resolve Silpo account id from silpo_get_my_profile',
      );
    }
    await this.authSessions.saveAccountId(sessionId, accountId);
    return accountId;
  }

  async onModuleDestroy(): Promise<void> {
    const clientPromises = [
      this.clientPromise,
      ...this.sessionClients.values(),
    ].filter((p): p is Promise<Client> => p !== undefined);
    await Promise.all(
      clientPromises.map(async (promise) => {
        try {
          const client = await promise;
          await client.close();
        } catch (err) {
          this.logger.warn(`Error closing Silpo MCP client: ${String(err)}`);
        }
      }),
    );
  }
}
