import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Pool, type QueryResult, type QueryResultRow } from 'pg';
import { SCHEMA_SQL } from './schema';

/**
 * Thin wrapper around a single `pg` Pool — this app has a handful of small
 * tables (see schema.ts), not enough to justify an ORM.
 *
 * Connects (and applies the schema) lazily on the first query rather than
 * in onModuleInit() — same reasoning as McpService's lazy MCP connect:
 * eagerly requiring Postgres at boot would crash the whole app (including
 * the health check, and e2e tests that never touch a DB-backed store) if
 * it isn't running yet. Only a request that actually needs persistence
 * pays the connection cost.
 */
@Injectable()
export class DbService implements OnModuleDestroy {
  private readonly logger = new Logger(DbService.name);
  private readonly pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });
  private schemaReady: Promise<void> | undefined;

  private ensureSchema(): Promise<void> {
    if (!this.schemaReady) {
      this.schemaReady = this.pool.query(SCHEMA_SQL).then(() => {
        this.logger.log('Connected to Postgres, schema applied.');
      });
    }
    return this.schemaReady;
  }

  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResult<T>> {
    await this.ensureSchema();
    return this.pool.query<T>(text, params);
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
