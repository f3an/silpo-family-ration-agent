import { Injectable } from '@nestjs/common';
import type { OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { DbService } from '../db/db.service';

export interface SilpoSessionAuthState {
  tokens?: OAuthTokens;
  accountId?: string;
}

interface SessionRow {
  account_id: string | null;
  tokens: OAuthTokens | null;
}

/**
 * Per-browser-session Silpo OAuth state, keyed by the guest sessionId the
 * client generates and persists in localStorage. Tokens/accountId live in
 * Postgres (`silpo_sessions`) — they used to be in-memory and got wiped on
 * every server restart, which meant re-logging in constantly during dev.
 *
 * The PKCE codeVerifier is the one piece kept in-memory: it's only needed
 * for the few seconds between redirectToAuthorization and the callback,
 * losing it on a restart mid-login just means retrying that one click —
 * not worth a DB round-trip on every login attempt.
 */
@Injectable()
export class SilpoAuthSessionStore {
  private readonly codeVerifiers = new Map<string, string>();

  constructor(private readonly db: DbService) {}

  async get(sessionId: string): Promise<SilpoSessionAuthState> {
    const { rows } = await this.db.query<SessionRow>(
      'SELECT account_id, tokens FROM silpo_sessions WHERE session_id = $1',
      [sessionId],
    );
    const row = rows[0];
    if (!row) return {};
    return {
      accountId: row.account_id ?? undefined,
      tokens: row.tokens ?? undefined,
    };
  }

  async saveTokens(sessionId: string, tokens: OAuthTokens): Promise<void> {
    await this.db.query(
      `INSERT INTO silpo_sessions (session_id, tokens, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (session_id)
       DO UPDATE SET tokens = $2, updated_at = now()`,
      [sessionId, JSON.stringify(tokens)],
    );
  }

  async saveAccountId(sessionId: string, accountId: string): Promise<void> {
    await this.db.query(
      `INSERT INTO silpo_sessions (session_id, account_id, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (session_id)
       DO UPDATE SET account_id = $2, updated_at = now()`,
      [sessionId, accountId],
    );
  }

  async isAuthenticated(sessionId: string): Promise<boolean> {
    const state = await this.get(sessionId);
    return Boolean(state.tokens);
  }

  async clear(sessionId: string): Promise<void> {
    await this.db.query('DELETE FROM silpo_sessions WHERE session_id = $1', [
      sessionId,
    ]);
    this.codeVerifiers.delete(sessionId);
  }

  getCodeVerifier(sessionId: string): string | undefined {
    return this.codeVerifiers.get(sessionId);
  }

  saveCodeVerifier(sessionId: string, codeVerifier: string): void {
    this.codeVerifiers.set(sessionId, codeVerifier);
  }
}
