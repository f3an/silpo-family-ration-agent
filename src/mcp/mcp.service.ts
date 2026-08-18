import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { connectSilpoMcp } from './client';

/** Owns the single long-lived connection to the official Silpo MCP server. */
@Injectable()
export class McpService implements OnModuleInit, OnModuleDestroy {
  private client: Client | undefined;

  async onModuleInit(): Promise<void> {
    this.client = await connectSilpoMcp();
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.close();
  }

  getClient(): Client {
    if (!this.client) {
      throw new Error('Silpo MCP client is not connected yet');
    }
    return this.client;
  }
}
