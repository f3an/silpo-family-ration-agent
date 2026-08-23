/**
 * Applied idempotently on every boot (DbService.onModuleInit) — no
 * migration runner for a small hackathon schema. Inlined as a TS string
 * (rather than a .sql file) so it ships in dist/ without extra nest-cli
 * asset-copying config.
 */
export const SCHEMA_SQL = `
  -- Silpo OAuth tokens per guest browser session (see mcp/webOauthProvider.ts).
  -- codeVerifier is deliberately NOT here — it's only needed for the few
  -- seconds of one login round-trip, kept in-memory (SilpoAuthSessionStore).
  CREATE TABLE IF NOT EXISTS silpo_sessions (
    session_id TEXT PRIMARY KEY,
    account_id TEXT,
    tokens JSONB,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  -- Account-level ration preferences (see agent/userPreferences.service.ts),
  -- keyed by the stable Silpo account id, not the browser session — follows
  -- the guest across browsers/devices.
  CREATE TABLE IF NOT EXISTS user_preferences (
    account_id TEXT PRIMARY KEY,
    cuisine TEXT NOT NULL DEFAULT '',
    equipment JSONB NOT NULL DEFAULT '[]',
    cooking_style TEXT NOT NULL,
    budget_uah NUMERIC NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  -- Chat mode conversations (see agent/chatConversation.service.ts), keyed by
  -- the same stable Silpo account id as user_preferences — multiple threads
  -- per account, each its own row, full message history inline as JSONB
  -- (small hackathon scale — no separate messages table). widgets holds
  -- rich UI content (e.g. a dish-plan card) attached to a specific message
  -- by index, kept separate from messages so it's never resent to Claude.
  -- account_id also holds a families.id for shared family threads (see
  -- agent/family.service.ts) — same table, same store, no schema change
  -- needed there; the two id spaces are both random UUIDs from unrelated
  -- generators, so a real collision is not a practical concern.
  CREATE TABLE IF NOT EXISTS chat_conversations (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT 'Нова розмова',
    messages JSONB NOT NULL DEFAULT '[]',
    widgets JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  -- No migration runner (see comment above) — added after chat_conversations
  -- already shipped once, so a fresh CREATE TABLE IF NOT EXISTS above won't
  -- reach existing rows/deployments.
  ALTER TABLE chat_conversations ADD COLUMN IF NOT EXISTS widgets JSONB NOT NULL DEFAULT '[]';

  CREATE INDEX IF NOT EXISTS chat_conversations_account_id_idx
    ON chat_conversations (account_id);

  -- Groups Silpo accounts that Silpo itself already considers family (see
  -- agent/family.service.ts — there's no MCP tool that links separate
  -- accounts directly, so this is built from silpo_get_my_family's own
  -- member list: each member's profileId IS that member's own Silpo
  -- account id, the same one McpService.getAccountId resolves for them
  -- when THEY log in). One row per family group.
  CREATE TABLE IF NOT EXISTS families (
    id TEXT PRIMARY KEY,
    silpo_name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  -- account_id is the primary key (not family_id) — an account belongs to
  -- at most one family group.
  CREATE TABLE IF NOT EXISTS family_members (
    account_id TEXT PRIMARY KEY,
    family_id TEXT NOT NULL,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE INDEX IF NOT EXISTS family_members_family_id_idx
    ON family_members (family_id);
`;
