import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';
import type { Preferences } from './dishPlan.schema';

interface PreferencesRow {
  cuisine: string;
  equipment: string[];
  cooking_style: Preferences['cookingStyle'];
  budget_uah: string;
  notes: string;
}

/**
 * Cuisine/equipment/budget/cooking-style preferences, keyed by the Silpo
 * account id (McpService.getAccountId) rather than the browser sessionId —
 * so they follow the guest across browsers/devices as long as they log
 * into the same Silpo account. Persisted in Postgres (`user_preferences`).
 */
@Injectable()
export class UserPreferencesStore {
  constructor(private readonly db: DbService) {}

  async get(accountId: string): Promise<Preferences | undefined> {
    const { rows } = await this.db.query<PreferencesRow>(
      `SELECT cuisine, equipment, cooking_style, budget_uah, notes
       FROM user_preferences WHERE account_id = $1`,
      [accountId],
    );
    const row = rows[0];
    if (!row) return undefined;
    return {
      cuisine: row.cuisine,
      equipment: row.equipment,
      cookingStyle: row.cooking_style,
      budgetUah: Number(row.budget_uah),
      notes: row.notes,
    };
  }

  async set(accountId: string, preferences: Preferences): Promise<void> {
    await this.db.query(
      `INSERT INTO user_preferences
         (account_id, cuisine, equipment, cooking_style, budget_uah, notes, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (account_id) DO UPDATE SET
         cuisine = $2, equipment = $3, cooking_style = $4, budget_uah = $5, notes = $6, updated_at = now()`,
      [
        accountId,
        preferences.cuisine,
        JSON.stringify(preferences.equipment),
        preferences.cookingStyle,
        preferences.budgetUah,
        preferences.notes,
      ],
    );
  }
}
