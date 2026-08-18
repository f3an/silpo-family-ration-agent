import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { connectSilpoMcp } from './client';

/**
 * Owns the single long-lived connection to the official Silpo MCP server.
 *
 * Connects lazily on first use rather than in onModuleInit(): the OAuth
 * flow opens a browser and waits for a localhost redirect, which would
 * otherwise block the whole Nest app from ever calling listen() — fatal in
 * a headless container, where there's no browser to open. Deferring the
 * connect means the HTTP server (and its health check) comes up
 * regardless of Silpo auth state; only a request that actually needs MCP
 * pays the connection cost.
 */
@Injectable()
export class McpService implements OnModuleDestroy {
  private readonly logger = new Logger(McpService.name);
  private clientPromise: Promise<Client> | undefined;

  async getClient(): Promise<Client> {
    if (!this.clientPromise) {
      this.clientPromise = connectSilpoMcp().catch((err: unknown) => {
        this.clientPromise = undefined;
        throw err;
      });
    }
    return this.clientPromise;
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.clientPromise) return;
    try {
      const client = await this.clientPromise;
      await client.close();
    } catch (err) {
      this.logger.warn(`Error closing Silpo MCP client: ${String(err)}`);
    }
  }
}
