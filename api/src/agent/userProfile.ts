import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { UserPreferencesStore } from './userPreferences.service';
import type { UserProfile } from './dishPlan.schema';

interface FamilyResult {
  members?: unknown[];
  children?: unknown[];
}

interface RestrictionsResult {
  restrictions?: Array<{ slug: string; name: string | null }>;
}

interface ProfileResult {
  profile?: {
    firstName?: string | null;
    lastName?: string | null;
    phone?: string | null;
  };
}

interface LoyaltyResult {
  loyalty?: {
    balance?: {
      total?: number;
    };
  };
}

/** `silpo_get_my_profile` returns this account's OWN phone number
 * unmasked (unlike `silpo_get_my_family`, which already masks every OTHER
 * member's number at the source, e.g. "38095*****06") — masked here so the
 * full number never reaches the browser (network tab, Redux state,
 * screen-share) in the first place, matching what Silpo's own UI already
 * does for family members. */
function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length !== 12) return phone;
  return `+${digits.slice(0, 3)} ${digits.slice(3, 5)} *** ** ${digits.slice(10, 12)}`;
}

/**
 * Reads `people`/`allergens`/name/phone straight from the Silpo account
 * (read-only — MCP has no tool to write any of this back) and pairs them
 * with whatever local preferences (cuisine/equipment/budget/cookingStyle)
 * this account previously saved via `POST /agent/preferences`.
 */
export async function getUserProfile(
  mcp: Client,
  accountId: string,
  preferencesStore: UserPreferencesStore,
): Promise<UserProfile> {
  const [familyResult, restrictionsResult, profileResult, loyaltyResult] =
    await Promise.all([
      mcp.callTool({ name: 'silpo_get_my_family', arguments: {} }),
      mcp.callTool({ name: 'silpo_get_my_food_restrictions', arguments: {} }),
      mcp.callTool({ name: 'silpo_get_my_profile', arguments: {} }),
      mcp.callTool({ name: 'silpo_get_loyalty_info', arguments: {} }),
    ]);

  const family = familyResult.structuredContent as FamilyResult | undefined;
  const restrictions = restrictionsResult.structuredContent as
    RestrictionsResult | undefined;
  const profile = (profileResult.structuredContent as ProfileResult | undefined)
    ?.profile;
  const bonusBalance =
    (loyaltyResult.structuredContent as LoyaltyResult | undefined)?.loyalty
      ?.balance?.total ?? null;

  const memberCount =
    (family?.members?.length ?? 0) + (family?.children?.length ?? 0);
  const people = memberCount > 0 ? memberCount : 1;

  const allergens = (restrictions?.restrictions ?? []).map(
    (r) => r.name ?? r.slug,
  );

  return {
    accountId,
    firstName: profile?.firstName ?? null,
    lastName: profile?.lastName ?? null,
    phone: maskPhone(profile?.phone),
    people,
    allergens,
    preferences: (await preferencesStore.get(accountId)) ?? null,
    bonusBalance,
  };
}
