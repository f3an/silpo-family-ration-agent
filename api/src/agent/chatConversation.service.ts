import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type Anthropic from '@anthropic-ai/sdk';
import { DbService } from '../db/db.service';
import type { Dish, OccasionBasket, IngredientOption } from './dishPlan.schema';

const DEFAULT_TITLE = 'Нова розмова';

export interface ChatConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
}

/** Rich UI content attached to one message by index — kept separate from
 * `messages` so it's never resent to Claude (a dish plan's full ingredient
 * list/images/productIds would otherwise bloat every follow-up turn). */
export type ChatWidget =
  | { messageIndex: number; kind: 'dish_plan'; dishes: Dish[] }
  | { messageIndex: number; kind: 'occasion_basket'; basket: OccasionBasket }
  | {
      messageIndex: number;
      kind: 'ingredient_options';
      ingredientName: string;
      options: IngredientOption[];
    };

export interface ChatConversation extends ChatConversationSummary {
  messages: Anthropic.MessageParam[];
  widgets: ChatWidget[];
}

interface SummaryRow {
  id: string;
  title: string;
  updated_at: string;
}

interface ConversationRow extends SummaryRow {
  messages: Anthropic.MessageParam[];
  widgets: ChatWidget[];
}

/**
 * Multiple named chat threads per Silpo account (see agent/chatConversation
 * .service.ts callers in agent.service.ts) — keyed by the stable accountId,
 * same as UserPreferencesStore, so the sidenav's history follows the guest
 * across browsers/devices. Full message history stored inline as JSONB per
 * row rather than a separate messages table — small hackathon scale, and it
 * matches how `runAgentTurn` already wants a flat `MessageParam[]`.
 */
@Injectable()
export class ChatConversationStore {
  constructor(private readonly db: DbService) {}

  async list(accountId: string): Promise<ChatConversationSummary[]> {
    const { rows } = await this.db.query<SummaryRow>(
      `SELECT id, title, updated_at FROM chat_conversations
       WHERE account_id = $1 ORDER BY updated_at DESC`,
      [accountId],
    );
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      updatedAt: row.updated_at,
    }));
  }

  async get(
    accountId: string,
    id: string,
  ): Promise<ChatConversation | undefined> {
    const { rows } = await this.db.query<ConversationRow>(
      `SELECT id, title, messages, widgets, updated_at FROM chat_conversations
       WHERE account_id = $1 AND id = $2`,
      [accountId, id],
    );
    const row = rows[0];
    if (!row) return undefined;
    return {
      id: row.id,
      title: row.title,
      messages: row.messages,
      widgets: row.widgets,
      updatedAt: row.updated_at,
    };
  }

  async create(accountId: string): Promise<ChatConversation> {
    const id = randomUUID();
    const { rows } = await this.db.query<SummaryRow>(
      `INSERT INTO chat_conversations (id, account_id, title, messages, widgets)
       VALUES ($1, $2, $3, '[]', '[]')
       RETURNING id, title, updated_at`,
      [id, accountId, DEFAULT_TITLE],
    );
    const row = rows[0];
    return {
      id: row.id,
      title: row.title,
      updatedAt: row.updated_at,
      messages: [],
      widgets: [],
    };
  }

  /** `title` is only passed once, the first time a conversation gets a
   * reply — see AgentService.sendMessage — so a guest's own rename (not
   * built yet, but this keeps the door open) is never silently overwritten
   * on a later turn. */
  async saveMessages(
    accountId: string,
    id: string,
    messages: Anthropic.MessageParam[],
    title?: string,
  ): Promise<void> {
    if (title !== undefined) {
      await this.db.query(
        `UPDATE chat_conversations SET messages = $3, title = $4, updated_at = now()
         WHERE account_id = $1 AND id = $2`,
        [accountId, id, JSON.stringify(messages), title],
      );
    } else {
      await this.db.query(
        `UPDATE chat_conversations SET messages = $3, updated_at = now()
         WHERE account_id = $1 AND id = $2`,
        [accountId, id, JSON.stringify(messages)],
      );
    }
  }

  /** Caller passes the full array (same convention as saveMessages) — no
   * diffing here, whoever's appending already holds the current list. */
  async saveWidgets(
    accountId: string,
    id: string,
    widgets: ChatWidget[],
  ): Promise<void> {
    await this.db.query(
      `UPDATE chat_conversations SET widgets = $3, updated_at = now()
       WHERE account_id = $1 AND id = $2`,
      [accountId, id, JSON.stringify(widgets)],
    );
  }

  async remove(accountId: string, id: string): Promise<void> {
    await this.db.query(
      'DELETE FROM chat_conversations WHERE account_id = $1 AND id = $2',
      [accountId, id],
    );
  }
}
