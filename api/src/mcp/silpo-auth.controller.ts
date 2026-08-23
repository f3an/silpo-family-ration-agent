import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { auth } from '@modelcontextprotocol/sdk/client/auth.js';
import { SilpoAuthSessionStore } from './silpoAuthSession.service';
import { WebSilpoOAuthProvider } from './webOauthProvider';

const SILPO_MCP_URL = process.env.SILPO_MCP_URL ?? 'https://mcp.silpo.ua/mcp';
const CLIENT_URL = process.env.CLIENT_URL ?? 'http://localhost:5173';

/**
 * Lets the client's own browser drive the Silpo OAuth login, instead of the
 * server opening a browser on its own machine (SilpoOAuthProvider's CLI
 * flow). See webOauthProvider.ts for why `auth()` — the MCP SDK's OAuth
 * orchestrator — is called directly here rather than via `client.connect()`.
 */
@Controller('auth/silpo')
export class SilpoAuthController {
  constructor(private readonly sessions: SilpoAuthSessionStore) {}

  private redirectUri(req: Request): string {
    return `${req.protocol}://${req.get('host')}/auth/silpo/callback`;
  }

  @Get('status')
  async status(
    @Query('sessionId') sessionId?: string,
  ): Promise<{ authenticated: boolean }> {
    if (!sessionId) throw new BadRequestException('sessionId is required');
    return { authenticated: await this.sessions.isAuthenticated(sessionId) };
  }

  @Post('logout')
  async logout(
    @Query('sessionId') sessionId?: string,
  ): Promise<{ success: true }> {
    if (!sessionId) throw new BadRequestException('sessionId is required');
    await this.sessions.clear(sessionId);
    return { success: true };
  }

  @Get('authorize')
  async authorize(
    @Query('sessionId') sessionId: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    if (!sessionId) throw new BadRequestException('sessionId is required');

    const provider = new WebSilpoOAuthProvider(
      sessionId,
      this.redirectUri(req),
      this.sessions,
    );

    const result = await auth(provider, { serverUrl: SILPO_MCP_URL });

    if (result === 'AUTHORIZED') {
      res.redirect(`${CLIENT_URL}/?silpoAuth=already`);
      return;
    }
    if (!provider.pendingAuthorizationUrl) {
      throw new Error(
        'auth() returned REDIRECT but no authorization URL was recorded',
      );
    }
    res.redirect(provider.pendingAuthorizationUrl);
  }

  @Get('callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') sessionId: string | undefined,
    @Query('error') error: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    if (error || !sessionId) {
      res.redirect(`${CLIENT_URL}/?silpoAuth=error`);
      return;
    }
    if (!code) {
      res.redirect(`${CLIENT_URL}/?silpoAuth=error`);
      return;
    }

    const provider = new WebSilpoOAuthProvider(
      sessionId,
      this.redirectUri(req),
      this.sessions,
    );

    try {
      await auth(provider, {
        serverUrl: SILPO_MCP_URL,
        authorizationCode: code,
      });
      res.redirect(`${CLIENT_URL}/?silpoAuth=success`);
    } catch {
      res.redirect(`${CLIENT_URL}/?silpoAuth=error`);
    }
  }
}
