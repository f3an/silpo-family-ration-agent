import { createHash } from 'node:crypto';
import type { PlanRequest } from './dishPlan.schema';

/** How long a `/agent/plan` result stays cached — long enough to dedupe an
 * accidental double-submit or repeat demo run, short enough that real
 * usage doesn't serve stale prices/availability for long. */
export const PLAN_CACHE_TTL_SECONDS = 15 * 60;

/**
 * Keyed by Silpo accountId (not the browser sessionId — same account on a
 * different device should still hit the cache) plus every field that can
 * change the agent's answer. sessionId itself is excluded on purpose.
 */
export function planCacheKey(accountId: string, profile: PlanRequest): string {
  const normalized = {
    people: profile.people,
    days: profile.days,
    allergens: [...profile.allergens].sort(),
    cuisine: profile.cuisine,
    equipment: [...profile.equipment].sort(),
    cookingStyle: profile.cookingStyle,
    budgetUah: profile.budgetUah,
    notes: profile.notes.trim(),
  };
  const hash = createHash('sha256')
    .update(JSON.stringify(normalized))
    .digest('hex');
  return `plan:${accountId}:${hash}`;
}
