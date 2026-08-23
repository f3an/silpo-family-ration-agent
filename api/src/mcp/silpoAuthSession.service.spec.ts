import { SilpoAuthSessionStore } from './silpoAuthSession.service';
import type { DbService } from '../db/db.service';

/** In-memory stand-in for the `silpo_sessions` table. */
function fakeDb(): DbService {
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
      if (text.startsWith('DELETE')) {
        rows.delete(sessionId);
        return Promise.resolve({ rows: [] });
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

describe('SilpoAuthSessionStore', () => {
  it('returns an empty state for a session never seen before', async () => {
    const store = new SilpoAuthSessionStore(fakeDb());

    await expect(store.get('s1')).resolves.toEqual({});
  });

  it('persists tokens and reads them back', async () => {
    const store = new SilpoAuthSessionStore(fakeDb());
    const tokens = { access_token: 'tok', token_type: 'bearer' };

    await store.saveTokens('s1', tokens);

    await expect(store.get('s1')).resolves.toEqual({ tokens });
  });

  it('persists accountId and reads it back', async () => {
    const store = new SilpoAuthSessionStore(fakeDb());

    await store.saveAccountId('s1', 'acc-1');

    const state = await store.get('s1');
    expect(state.accountId).toBe('acc-1');
  });

  it('isolates state between different sessionIds', async () => {
    const store = new SilpoAuthSessionStore(fakeDb());

    await store.saveTokens('a', {
      access_token: 'tok-a',
      token_type: 'bearer',
    });
    await store.saveTokens('b', {
      access_token: 'tok-b',
      token_type: 'bearer',
    });

    const a = await store.get('a');
    const b = await store.get('b');
    expect(a.tokens?.access_token).toBe('tok-a');
    expect(b.tokens?.access_token).toBe('tok-b');
  });

  it('isAuthenticated is false until tokens are saved', async () => {
    const store = new SilpoAuthSessionStore(fakeDb());

    await expect(store.isAuthenticated('s1')).resolves.toBe(false);

    await store.saveTokens('s1', { access_token: 'tok', token_type: 'bearer' });

    await expect(store.isAuthenticated('s1')).resolves.toBe(true);
  });

  it('clear removes tokens/accountId and the in-memory codeVerifier', async () => {
    const store = new SilpoAuthSessionStore(fakeDb());
    await store.saveTokens('s1', { access_token: 'tok', token_type: 'bearer' });
    await store.saveAccountId('s1', 'acc-1');
    store.saveCodeVerifier('s1', 'verifier-123');

    await store.clear('s1');

    await expect(store.get('s1')).resolves.toEqual({});
    await expect(store.isAuthenticated('s1')).resolves.toBe(false);
    expect(store.getCodeVerifier('s1')).toBeUndefined();
  });

  it('keeps the PKCE codeVerifier in memory, independent of the DB', () => {
    const store = new SilpoAuthSessionStore(fakeDb());

    expect(store.getCodeVerifier('s1')).toBeUndefined();

    store.saveCodeVerifier('s1', 'verifier-123');

    expect(store.getCodeVerifier('s1')).toBe('verifier-123');
  });
});
