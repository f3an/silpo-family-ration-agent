import { z } from 'zod';

/**
 * `cookingStyle` drives how many dishes the agent proposes and how it sizes
 * them — 'fast' still cooks daily but keeps recipes minimal-effort, 'daily'
 * is a normal fresh dish per day, 'batch' is meal-prep: 1-2 dishes cooked
 * once in bulk and eaten across several days (see Dish.daysCovered).
 */
export const CookingStyleSchema = z.enum(['fast', 'daily', 'batch']);
export type CookingStyle = z.infer<typeof CookingStyleSchema>;

/**
 * The part of the profile Silpo has no concept of — cuisine/equipment/
 * budget/cooking style. Saved server-side per Silpo account (see
 * userPreferences.service.ts), separately from `people`/`allergens`, which
 * come read-only from the account itself (silpo_get_my_family /
 * silpo_get_my_food_restrictions) and are never stored by us.
 */
export const PreferencesSchema = z.object({
  cuisine: z.string().default(''),
  equipment: z.array(z.string()).default([]),
  cookingStyle: CookingStyleSchema,
  budgetUah: z.number().min(0),
  notes: z.string().default(''),
});
export type Preferences = z.infer<typeof PreferencesSchema>;

export const SavePreferencesRequestSchema = PreferencesSchema.extend({
  sessionId: z.string().min(1),
});
export type SavePreferencesRequest = z.infer<
  typeof SavePreferencesRequestSchema
>;

/** `GET /agent/profile` response — `people`/`allergens` read straight from
 * the Silpo account (never stored by us); `preferences` is whatever this
 * account last saved via `POST /agent/preferences`, or null on first visit. */
export interface UserProfile {
  accountId: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  people: number;
  allergens: string[];
  preferences: Preferences | null;
  bonusBalance: number | null;
}

/** What the client's plan-request form collects. */
export const PlanRequestSchema = z
  .object({
    /** The guest's own browser-generated id — routes to their logged-in Silpo
     * MCP connection (see silpo-auth.controller.ts / McpService.getClientForSession). */
    sessionId: z.string().min(1),
    /** Omitted to start a new chat conversation for this plan — see
     * AgentService.planMeals / chatConversation.service.ts. */
    conversationId: z.string().optional(),
    people: z.number().int().min(1).max(20),
    days: z.number().int().min(1).max(14),
    allergens: z.array(z.string()).default([]),
    /** When true, planSystemPrompt.ts steers every dish toward kid-friendly
     * flavors/portions/prep — see plan.ts's describeProfile(). */
    forChildren: z.boolean().default(false),
    /** When true, the resulting card is appended to this account's family
     * conversation instead of its personal one — see
     * AgentService.planMeals/family.service.ts. The generation step itself
     * is unchanged (still built from the CURRENT account's own profile —
     * see FAMILY_CHAT_CONTEXT for the free-text-chat equivalent caveat). */
    familyChat: z.boolean().default(false),
  })
  .merge(PreferencesSchema);
export type PlanRequest = z.infer<typeof PlanRequestSchema>;

/** One ingredient line in a dish — the Silpo product fields are null when the
 * agent couldn't confidently match a real product (see api/README.md edge cases).
 * Also reused as-is for occasion-basket items (see OccasionBasketSchema) — same
 * shape, just not tied to a recipe. */
export const DishIngredientSchema = z.object({
  name: z.string(),
  quantityLabel: z.string(),
  productId: z.string().nullable(),
  companyId: z.string().nullable(),
  branchId: z.string().nullable(),
  cartQuantity: z.number().nullable(),
  imageUrl: z.string().nullable(),
});
export type DishIngredient = z.infer<typeof DishIngredientSchema>;

export const DishSchema = z.object({
  name: z.string(),
  description: z.string(),
  cuisine: z.string(),
  prepTimeMinutes: z.number(),
  /** How many days of the period one batch of this dish feeds the whole
   * household — 1 for 'fast'/'daily' style, >1 for 'batch' (meal-prep). */
  daysCovered: z.number().int().min(1),
  calories: z.number(),
  proteinGrams: z.number(),
  fatGrams: z.number(),
  carbsGrams: z.number(),
  ingredients: z.array(DishIngredientSchema),
});
export type Dish = z.infer<typeof DishSchema>;

/** A curated shopping list for an occasion (birthday, BBQ, picnic) — not a
 * recipe, so no macros/prepTime. See run.ts's propose_occasion_basket. */
export const OccasionBasketSchema = z.object({
  theme: z.string(),
  description: z.string(),
  guestCount: z.number().int().min(1),
  items: z.array(DishIngredientSchema),
});
export type OccasionBasket = z.infer<typeof OccasionBasketSchema>;

/** One real Silpo product candidate offered as a swap for a specific
 * ingredient — see run.ts's propose_ingredient_options. `note` is a short
 * (few-word) reason to pick it, e.g. "найдешевший варіант". */
export const IngredientOptionSchema = z.object({
  label: z.string(),
  note: z.string(),
  quantityLabel: z.string(),
  price: z.number().nullable(),
  productId: z.string().nullable(),
  companyId: z.string().nullable(),
  branchId: z.string().nullable(),
  cartQuantity: z.number().nullable(),
  imageUrl: z.string().nullable(),
});
export type IngredientOption = z.infer<typeof IngredientOptionSchema>;

export const IngredientOptionsSchema = z.object({
  ingredientName: z.string(),
  options: z.array(IngredientOptionSchema),
});
export type IngredientOptions = z.infer<typeof IngredientOptionsSchema>;

/** The agent's structured final answer for a planning turn — see plan.ts. */
export const PlanResponseSchema = z.object({
  dishes: z.array(DishSchema),
});
export type PlanResponse = z.infer<typeof PlanResponseSchema>;

/**
 * `planMeals`'s lean 2-call pipeline (see plan.ts) — phase 1 output. Same
 * dish concept/macros as `DishSchema`, but `ingredientNames` replaces
 * `ingredients`: short (1-2 word) search terms only, no MCP tool calls made
 * yet — code resolves real products for these names in between the two LLM
 * calls (see leanProductResolver.ts), so the model never sees MCP tool
 * schemas at all.
 */
export const DishDraftSchema = z.object({
  name: z.string(),
  description: z.string(),
  cuisine: z.string(),
  prepTimeMinutes: z.number(),
  daysCovered: z.number().int().min(1),
  calories: z.number(),
  proteinGrams: z.number(),
  fatGrams: z.number(),
  carbsGrams: z.number(),
  ingredientNames: z.array(z.string()),
});
export type DishDraft = z.infer<typeof DishDraftSchema>;

export const DishDraftsResponseSchema = z.object({
  dishes: z.array(DishDraftSchema),
});
export type DishDraftsResponse = z.infer<typeof DishDraftsResponseSchema>;

/**
 * Phase 2 output — for each draft dish (matched back by exact `name` echo),
 * a `productId` (or `null`) per ingredient plus the quantity math that
 * genuinely needs the found product's data (weighted vs unit, stock cap).
 */
export const DishPickSchema = z.object({
  ingredient: z.string(),
  productId: z.string().nullable(),
  quantityLabel: z.string(),
  cartQuantity: z.number().nullable(),
});
export type DishPick = z.infer<typeof DishPickSchema>;

export const DishPicksResponseSchema = z.object({
  dishes: z.array(
    z.object({
      name: z.string(),
      picks: z.array(DishPickSchema),
    }),
  ),
});
export type DishPicksResponse = z.infer<typeof DishPicksResponseSchema>;

/** What `/agent/checkout` accepts — the ingredient fields the client got back from `/agent/plan`. */
export const CheckoutRequestSchema = z.object({
  sessionId: z.string().min(1),
  items: z
    .array(
      z.object({
        productId: z.string(),
        companyId: z.string(),
        branchId: z.string(),
        quantity: z.number().positive(),
      }),
    )
    .min(1),
});
export type CheckoutRequest = z.infer<typeof CheckoutRequestSchema>;
