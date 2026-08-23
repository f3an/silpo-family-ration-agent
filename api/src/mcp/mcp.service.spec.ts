import { UnauthorizedException } from '@nestjs/common';
import { McpService } from './mcp.service';
import { SilpoAuthSessionStore } from './silpoAuthSession.service';
import type { DbService } from '../db/db.service';

/** In-memory stand-in for the `silpo_sessions` table. */
function fakeAuthDb(): DbService {
  const rows = new Map<
    string,
    { account_id: string | null; tokens: unknown }
  >();
  return {
    query: jest.fn((text: string, params: unknown[] = []) => {
      const sessionId = params[0] as string;
      if (text.startsWith('SELECT')) {
        const row = rows.get(sessionId);
        return Promise.resolve({ rows: row ? [row] : [] });
      }
      const existing = rows.get(sessionId) ?? {
        account_id: null,
        tokens: null,
      };
      if (text.includes('tokens =')) {
        rows.set(sessionId, {
          ...existing,
          tokens: JSON.parse(params[1] as string) as unknown,
        });
      } else {
        rows.set(sessionId, { ...existing, account_id: params[1] as string });
      }
      return Promise.resolve({ rows: [] });
    }),
  } as unknown as DbService;
}

describe('McpService.getClientForSession', () => {
  it('throws UnauthorizedException for a session that never logged in', async () => {
    const service = new McpService(new SilpoAuthSessionStore(fakeAuthDb()));

    await expect(
      service.getClientForSession('never-logged-in'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

jest.mock('./client', () => ({
  connectSilpoMcpWithProvider: jest.fn(),
}));
import { connectSilpoMcpWithProvider } from './client';

const mockConnect = connectSilpoMcpWithProvider as jest.MockedFunction<
  typeof connectSilpoMcpWithProvider
>;

describe('McpService.getAccountId', () => {
  beforeEach(() => {
    mockConnect.mockReset();
  });

  async function loggedInService() {
    const sessions = new SilpoAuthSessionStore(fakeAuthDb());
    await sessions.saveTokens('s1', {
      access_token: 'tok',
      token_type: 'bearer',
    });
    return { service: new McpService(sessions), sessions };
  }

  it('resolves the account id from silpo_get_my_profile', async () => {
    const callTool = jest.fn().mockResolvedValue({
      structuredContent: { profile: { id: 'acc-123' } },
    });
    mockConnect.mockResolvedValue({ callTool } as never);
    const { service } = await loggedInService();

    const accountId = await service.getAccountId('s1');

    expect(accountId).toBe('acc-123');
    expect(callTool).toHaveBeenCalledWith({
      name: 'silpo_get_my_profile',
      arguments: {},
    });
  });

  it('caches the account id on the session — only one MCP call across two lookups', async () => {
    const callTool = jest.fn().mockResolvedValue({
      structuredContent: { profile: { id: 'acc-123' } },
    });
    mockConnect.mockResolvedValue({ callTool } as never);
    const { service } = await loggedInService();

    await service.getAccountId('s1');
    await service.getAccountId('s1');

    expect(callTool).toHaveBeenCalledTimes(1);
  });

  it('throws when silpo_get_my_profile has no profile id', async () => {
    const callTool = jest.fn().mockResolvedValue({ structuredContent: {} });
    mockConnect.mockResolvedValue({ callTool } as never);
    const { service } = await loggedInService();

    await expect(service.getAccountId('s1')).rejects.toThrow();
  });
});
