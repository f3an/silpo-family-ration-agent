import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { createClient, type RedisClientType } from 'redis';

/**
 * Best-effort cache over Redis — every method swallows its own errors and
 * logs a warning instead of throwing. Caching is an optimization (avoid
 * re-running an expensive Claude tool-use loop for a repeat request); a
 * Redis outage should degrade to "always a cache miss," never take down
 * `/agent/plan` itself. Connects lazily on first use, same reasoning as
 * DbService/McpService — no service should require Redis just to boot.
 */
@Injectable()
export class CacheService implements OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);
  private client: RedisClientType | undefined;

  private async getClient(): Promise<RedisClientType> {
    if (!this.client) {
      const client: RedisClientType = createClient({
        url: process.env.REDIS_URL ?? 'redis://localhost:6379',
      });
      client.on('error', (err: unknown) => {
        this.logger.warn(`Redis client error: ${String(err)}`);
      });
      await client.connect();
      this.client = client;
    }
    return this.client;
  }

  async get<T>(key: string): Promise<T | undefined> {
    try {
      const client = await this.getClient();
      const raw = await client.get(key);
      return raw ? (JSON.parse(raw) as T) : undefined;
    } catch (err) {
      this.logger.warn(
        `Cache get(${key}) failed, treating as a miss: ${String(err)}`,
      );
      return undefined;
    }
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    try {
      const client = await this.getClient();
      await client.set(key, JSON.stringify(value), { EX: ttlSeconds });
    } catch (err) {
      this.logger.warn(
        `Cache set(${key}) failed, continuing uncached: ${String(err)}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) await this.client.quit();
  }
}
