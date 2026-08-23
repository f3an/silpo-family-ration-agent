import type { Request, Response } from 'express';
import { SilpoAuthController } from './silpo-auth.controller';
import { SilpoAuthSessionStore } from './silpoAuthSession.service';
import type { DbService } from '../db/db.service';

jest.mock('@modelcontextprotocol/sdk/client/auth.js', () => ({
  auth: jest.fn(),
}));
import { auth } from '@modelcontextprotocol/sdk/client/auth.js';

const mockAuth = auth as jest.MockedFunction<typeof auth>;

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

function fakeSessions(): SilpoAuthSessionStore {
  return new SilpoAuthSessionStore(fakeAuthDb());
}

function fakeReq(): Request {
  return {
    protocol: 'http',
    get: (name: string) => (name === 'host' ? 'localhost:3000' : undefined),
  } as unknown as Request;
}

// Plain object (not typed as Response) so `res.redirect` reads as an
// ordinary jest.fn() property in assertions, not an unbound Express method.
function fakeRes() {
  return { redirect: jest.fn() };
}

describe('SilpoAuthController', () => {
  beforeEach(() => {
    mockAuth.mockReset();
  });

  describe('status', () => {
    it('reflects SilpoAuthSessionStore.isAuthenticated', async () => {
      const sessions = fakeSessions();
      const controller = new SilpoAuthController(sessions);

      await expect(controller.status('s1')).resolves.toEqual({
        authenticated: false,
      });

      await sessions.saveTokens('s1', {
        access_token: 'tok',
        token_type: 'bearer',
      });

      await expect(controller.status('s1')).resolves.toEqual({
        authenticated: true,
      });
    });

    it('rejects a missing sessionId', async () => {
      const controller = new SilpoAuthController(fakeSessions());

      await expect(controller.status(undefined)).rejects.toThrow();
    });
  });

  describe('logout', () => {
    it('clears the session so isAuthenticated goes back to false', async () => {
      const sessions = fakeSessions();
      await sessions.saveTokens('s1', {
        access_token: 'tok',
        token_type: 'bearer',
      });
      const controller = new SilpoAuthController(sessions);

      await expect(controller.logout('s1')).resolves.toEqual({
        success: true,
      });
      await expect(sessions.isAuthenticated('s1')).resolves.toBe(false);
    });

    it('rejects a missing sessionId', async () => {
      const controller = new SilpoAuthController(fakeSessions());

      await expect(controller.logout(undefined)).rejects.toThrow();
    });
  });

  describe('authorize', () => {
    it('redirects to the client with ?silpoAuth=already when already authorized', async () => {
      mockAuth.mockResolvedValue('AUTHORIZED');
      const controller = new SilpoAuthController(fakeSessions());
      const res = fakeRes();

      await controller.authorize('s1', fakeReq(), res as unknown as Response);

      expect(res.redirect).toHaveBeenCalledWith(
        expect.stringContaining('silpoAuth=already'),
      );
    });

    it('redirects to the Silpo authorization URL when a login round is needed', async () => {
      mockAuth.mockImplementation((provider) => {
        void provider.redirectToAuthorization(
          new URL('https://auth.silpo.ua/authorize?client_id=abc'),
        );
        return Promise.resolve('REDIRECT');
      });
      const controller = new SilpoAuthController(fakeSessions());
      const res = fakeRes();

      await controller.authorize('s1', fakeReq(), res as unknown as Response);

      expect(res.redirect).toHaveBeenCalledWith(
        'https://auth.silpo.ua/authorize?client_id=abc',
      );
    });

    it('rejects a missing sessionId', async () => {
      const controller = new SilpoAuthController(fakeSessions());

      await expect(
        controller.authorize(
          undefined,
          fakeReq(),
          fakeRes() as unknown as Response,
        ),
      ).rejects.toThrow();
    });
  });

  describe('callback', () => {
    it('exchanges the code and redirects to the client with ?silpoAuth=success', async () => {
      mockAuth.mockResolvedValue('AUTHORIZED');
      const controller = new SilpoAuthController(fakeSessions());
      const res = fakeRes();

      await controller.callback(
        'code-123',
        's1',
        undefined,
        fakeReq(),
        res as unknown as Response,
      );

      expect(res.redirect).toHaveBeenCalledWith(
        expect.stringContaining('silpoAuth=success'),
      );
    });

    it('redirects with ?silpoAuth=error when Silpo reports an error', async () => {
      const controller = new SilpoAuthController(fakeSessions());
      const res = fakeRes();

      await controller.callback(
        undefined,
        's1',
        'access_denied',
        fakeReq(),
        res as unknown as Response,
      );

      expect(res.redirect).toHaveBeenCalledWith(
        expect.stringContaining('silpoAuth=error'),
      );
      expect(mockAuth).not.toHaveBeenCalled();
    });

    it('redirects with ?silpoAuth=error when the token exchange throws', async () => {
      mockAuth.mockRejectedValue(new Error('exchange failed'));
      const controller = new SilpoAuthController(fakeSessions());
      const res = fakeRes();

      await controller.callback(
        'code-123',
        's1',
        undefined,
        fakeReq(),
        res as unknown as Response,
      );

      expect(res.redirect).toHaveBeenCalledWith(
        expect.stringContaining('silpoAuth=error'),
      );
    });
  });
});
