import type Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { callMcpToolStructured } from './mcpTools';
import {
  PLAN_PICK_SYSTEM_PROMPT,
  SINGLE_DISH_DRAFT_SYSTEM_PROMPT,
} from './planSystemPrompt';
import { supportsEffort, supportsTemperature } from './modelCapabilities';
import {
  DishDraftSchema,
  DishPicksResponseSchema,
  DishSchema,
  type Dish,
  type DishDraft,
  type DishPicksResponse,
} from './dishPlan.schema';
import type { LlmClient } from '../llm/llm.types';

// See run.ts's identical constant for why this reads from env instead of
// being hardcoded — ignored by the local-Anthropic-dialect path, only
// matters for the real Claude API.
const MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5';

export interface DeliveryContext {
  branchId: string;
  companyId: string;
  deliveryType: string;
  timeslotStart: string;
  timeslotEnd: string;
}

/**
 * Code-side replacement for the model orchestrating
 * `silpo_get_my_shopping_cart` → `silpo_get_shopping_cart_by_id` itself —
 * validated live this session: a weak local model reliably invents
 * placeholder IDs ("some_branch_id") for exactly this resolution chain
 * instead of calling the tools first. Doing it here means no model, weak or
 * strong, ever has the chance to hallucinate these values — see
 * plan.ts's planMeals.
 *
 * Real response shape confirmed live: the resolved fields sit under
 * `.cart.shipments[0]` / `.cart.deliveryType` / `.cart.timeslot`, not at the
 * top level of `silpo_get_shopping_cart_by_id`'s structuredContent.
 */
export async function resolveDeliveryContext(
  mcp: Client,
): Promise<DeliveryContext | null> {
  const cart = (await callMcpToolStructured(
    mcp,
    'silpo_get_my_shopping_cart',
    {},
  )) as { shoppingCartId?: string } | undefined;
  if (!cart?.shoppingCartId) return null;

  const details = (await callMcpToolStructured(
    mcp,
    'silpo_get_shopping_cart_by_id',
    {
      shoppingCartId: cart.shoppingCartId,
    },
  )) as
    | {
        cart?: {
          deliveryType?: string;
          timeslot?: { start?: string; end?: string };
          shipments?: { branchId?: string; companyId?: string }[];
        };
      }
    | undefined;
  const innerCart = details?.cart;
  const shipment = innerCart?.shipments?.[0];
  if (!shipment?.branchId || !shipment.companyId || !innerCart?.deliveryType) {
    return null;
  }
  if (!innerCart.timeslot?.start || !innerCart.timeslot.end) return null;

  return {
    branchId: shipment.branchId,
    companyId: shipment.companyId,
    deliveryType: innerCart.deliveryType,
    timeslotStart: innerCart.timeslot.start,
    timeslotEnd: innerCart.timeslot.end,
  };
}

export interface ProductCandidate {
  id: string;
  name: string;
  price: number;
  image: string | null;
  displayRatio: string | null;
  weighted: boolean;
  step: number;
  stock: number;
}

interface FindProductsBatchResponse {
  queries?: {
    query: string;
    products: {
      id: string;
      name: string;
      price: number;
      image: string | null;
      displayRatio: string | null;
      weighted: boolean;
      step: number;
      stock: number;
    }[];
  }[];
}

/** `silpo_find_products_batch`'s real per-call cap, confirmed live — see
 * systemPrompt.ts's "products приймає до 30 назв за раз". */
const MAX_PRODUCTS_PER_BATCH_CALL = 30;

/** One batched `silpo_find_products_batch` pass over `queries`, chunked at
 * the tool's 30-name cap — the shared core `searchIngredientCandidates`
 * calls twice (the real queries, then a fallback pass on simplified ones). */
async function searchOnce(
  mcp: Client,
  ctx: DeliveryContext,
  queries: string[],
  limitPerQuery: number,
): Promise<Record<string, ProductCandidate[]>> {
  const byQuery: Record<string, ProductCandidate[]> = {};
  for (let i = 0; i < queries.length; i += MAX_PRODUCTS_PER_BATCH_CALL) {
    const chunk = queries.slice(i, i + MAX_PRODUCTS_PER_BATCH_CALL);
    const data = (await callMcpToolStructured(
      mcp,
      'silpo_find_products_batch',
      {
        branchId: ctx.branchId,
        deliveryType: ctx.deliveryType,
        timeslotStart: ctx.timeslotStart,
        timeslotEnd: ctx.timeslotEnd,
        products: chunk,
        limit: limitPerQuery,
      },
    )) as FindProductsBatchResponse | undefined;

    for (const q of data?.queries ?? []) {
      byQuery[q.query] = q.products.map((p) => ({
        id: p.id,
        name: p.name,
        price: p.price,
        image: p.image,
        displayRatio: p.displayRatio,
        weighted: p.weighted,
        step: p.step,
        stock: p.stock,
      }));
    }
  }
  return byQuery;
}

/**
 * Code-side product search for a flat list of ingredient names — the other
 * half of the lean pipeline's "code orchestrates MCP, model only judges"
 * split (see plan.ts's planMeals). Dedupes names (case/whitespace-insensitive)
 * so the same ingredient repeated across several draft dishes (e.g. "цибуля"
 * in three different dishes) is only searched once, and chunks at the
 * tool's 30-name cap instead of failing on a large multi-day plan.
 *
 * Any multi-word ingredient that comes back with zero candidates gets one
 * guaranteed retry on just its first word (e.g. "капуста білокочанна" →
 * "капуста") — confirmed live this session that even a strong model
 * (Haiku 4.5) leaves some multi-word ingredients unresolved despite the
 * draft/pick prompts already advising short queries; a code-side retry
 * doesn't depend on the model noticing and re-asking.
 */
export async function searchIngredientCandidates(
  mcp: Client,
  ctx: DeliveryContext,
  ingredientNames: string[],
  // The old full-tool-loop architecture always searched with limit: 30
  // (systemPrompt.ts's own advice: "правильний товар іноді ховається в
  // кінці списку кандидатів... траплялось на позиції 23 з 24") — this
  // used to default to 5, a regression that silently starved the pick
  // phase of candidates for any common ingredient with many real matches
  // (confirmed live: silpo.ua's own search shows 66 results for "капуста",
  // and plain white cabbage isn't in the first handful).
  limitPerQuery = 30,
): Promise<Record<string, ProductCandidate[]>> {
  const seen = new Set<string>();
  const uniqueNames: string[] = [];
  for (const name of ingredientNames) {
    const key = name.trim().toLowerCase();
    if (key && !seen.has(key)) {
      seen.add(key);
      uniqueNames.push(name.trim());
    }
  }

  const byIngredient = await searchOnce(mcp, ctx, uniqueNames, limitPerQuery);

  const emptyMultiWord = uniqueNames.filter(
    (name) => (byIngredient[name]?.length ?? 0) === 0 && name.includes(' '),
  );
  if (emptyMultiWord.length > 0) {
    const fallbackToOriginals = new Map<string, string[]>();
    for (const name of emptyMultiWord) {
      const fallbackQuery = name.split(/\s+/)[0];
      const originals = fallbackToOriginals.get(fallbackQuery) ?? [];
      originals.push(name);
      fallbackToOriginals.set(fallbackQuery, originals);
    }

    const fallbackResults = await searchOnce(
      mcp,
      ctx,
      Array.from(fallbackToOriginals.keys()),
      limitPerQuery,
    );
    for (const [fallbackQuery, originals] of fallbackToOriginals) {
      const candidates = fallbackResults[fallbackQuery];
      if (candidates?.length) {
        for (const original of originals) byIngredient[original] = candidates;
      }
    }
  }

  return byIngredient;
}

function describeDraftsWithCandidates(
  drafts: DishDraft[],
  candidates: Record<string, ProductCandidate[]>,
  people: number,
): string {
  const dishesText = drafts
    .map((draft) => {
      const ingredientsText = draft.ingredientNames
        .map((name) => {
          const list = candidates[name] ?? [];
          const lines = list
            .map(
              (c) =>
                `    - id="${c.id}" name="${c.name}" price=${c.price}грн weighted=${c.weighted} step=${c.step} stock=${c.stock} displayRatio="${c.displayRatio ?? ''}"`,
            )
            .join('\n');
          return `  Інгредієнт "${name}":\n${lines || '    (нічого не знайдено)'}`;
        })
        .join('\n');
      return `Страва "${draft.name}" (охоплює ${draft.daysCovered} дн.):\n${ingredientsText}`;
    })
    .join('\n\n');
  return `Кількість людей: ${people}\n\n${dishesText}`;
}

/** Both `planMeals` and the chat 'dish'/'plan' routes skip straight to
 * parsing — neither call is given any tools, so `stop_reason` is either
 * 'end_turn' (parse the JSON) or 'max_tokens' (the one failure mode worth a
 * clear message instead of a cryptic JSON.parse error on truncated text). */
export function parseStructuredResponse<T>(
  response: Anthropic.Message,
  schema: { parse: (data: unknown) => T },
  phaseName: string,
): T {
  if (response.stop_reason === 'max_tokens') {
    throw new Error(
      `Відповідь агента (${phaseName}) обірвалася на max_tokens, не встигнувши завершити хід — спробуй звузити запит (менше днів/страв за раз) або повтори ще раз.`,
    );
  }
  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
  return schema.parse(JSON.parse(text));
}

/**
 * Shared "search + pick + assemble" half of the lean pipeline — given
 * already-drafted dish concepts (from `plan.ts`'s own draft call, or from
 * `draftSingleDish` below for the chat router's 'dish' route), searches
 * real Silpo products for every ingredient and asks the model to pick the
 * best match per ingredient, then assembles the final `Dish[]` validated
 * against `DishSchema`. No MCP tools in this LLM call either — candidates
 * are handed in as plain text.
 */
async function callPick(
  llm: LlmClient,
  drafts: DishDraft[],
  candidates: Record<string, ProductCandidate[]>,
  people: number,
): Promise<DishPicksResponse['dishes']> {
  const pickResponse = await llm.createMessage({
    model: MODEL,
    max_tokens: 16000,
    ...(supportsTemperature(MODEL) ? { temperature: 0 } : {}),
    system: [
      {
        type: 'text',
        text: PLAN_PICK_SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    output_config: {
      ...(supportsEffort(MODEL) ? { effort: 'medium' as const } : {}),
      format: zodOutputFormat(DishPicksResponseSchema),
    },
    tools: [],
    messages: [
      {
        role: 'user',
        content: describeDraftsWithCandidates(drafts, candidates, people),
      },
    ],
  });
  return parseStructuredResponse(pickResponse, DishPicksResponseSchema, 'pick')
    .dishes;
}

export async function pickProductsAndAssemble(
  llm: LlmClient,
  mcp: Client,
  deliveryContext: DeliveryContext,
  drafts: DishDraft[],
  people: number,
): Promise<Dish[]> {
  const allIngredientNames = drafts.flatMap((d) => d.ingredientNames);
  const candidates = await searchIngredientCandidates(
    mcp,
    deliveryContext,
    allIngredientNames,
  );

  const picks = await callPick(llm, drafts, candidates, people);

  // Claude's real API rejects explicit `temperature` outright (see
  // modelCapabilities.ts), and Haiku also rejects `effort` — so for Haiku
  // specifically neither sampling control is available, and it sometimes
  // silently drops an ingredient from its response despite the prompt's
  // "не пропускай жодного" instruction (confirmed live: same ingredients,
  // same real candidates, a repeat call resolved all of them). One bounded
  // retry asking ONLY for the missing ingredients — never a full loop —
  // catches this without adding real risk of runaway calls.
  const missingByDish = drafts
    .map((draft) => {
      const pickedDish = picks.find((p) => p.name === draft.name);
      const missingNames = draft.ingredientNames.filter(
        (name) => !pickedDish?.picks.some((p) => p.ingredient === name),
      );
      return missingNames.length > 0
        ? { ...draft, ingredientNames: missingNames }
        : null;
    })
    .filter((d): d is DishDraft => d !== null);

  if (missingByDish.length > 0) {
    const retryPicks = await callPick(llm, missingByDish, candidates, people);
    for (const dish of retryPicks) {
      const existing = picks.find((p) => p.name === dish.name);
      if (existing) {
        existing.picks.push(...dish.picks);
      } else {
        picks.push(dish);
      }
    }
  }

  return drafts.map((draft) => {
    const pickedDish = picks.find((p) => p.name === draft.name);
    const ingredients = draft.ingredientNames.map((ingredientName) => {
      const pick = pickedDish?.picks.find(
        (p) => p.ingredient === ingredientName,
      );
      const match = pick?.productId
        ? candidates[ingredientName]?.find((c) => c.id === pick.productId)
        : undefined;
      return {
        name: ingredientName,
        quantityLabel: pick?.quantityLabel ?? '1 шт',
        productId: match?.id ?? null,
        companyId: match ? deliveryContext.companyId : null,
        branchId: match ? deliveryContext.branchId : null,
        cartQuantity: match ? (pick?.cartQuantity ?? null) : null,
        imageUrl: match?.image ?? null,
      };
    });

    return DishSchema.parse({
      name: draft.name,
      description: draft.description,
      cuisine: draft.cuisine,
      prepTimeMinutes: draft.prepTimeMinutes,
      daysCovered: draft.daysCovered,
      calories: draft.calories,
      proteinGrams: draft.proteinGrams,
      fatGrams: draft.fatGrams,
      carbsGrams: draft.carbsGrams,
      ingredients,
    });
  });
}

/**
 * Drafts ONE named dish — the chat router's 'dish' route only classifies
 * (dish name + portions, see leanChatRouter.ts); this is the actual
 * drafting call, run separately so it can go to a different model
 * (`draftLlm`) than the router/pick calls. See run.ts's runAgentTurn for
 * how the resulting DishDraft then flows into `pickProductsAndAssemble`.
 */
export async function draftSingleDish(
  draftLlm: LlmClient,
  dishName: string,
  portions: number,
  allergens: string[],
): Promise<DishDraft> {
  const userText = `Страва: ${dishName}\nКількість порцій: ${portions}\nАлергени/обмеження гостя: ${allergens.length ? allergens.join(', ') : 'немає'}`;

  const response = await draftLlm.createMessage({
    model: MODEL,
    max_tokens: 4000,
    ...(supportsTemperature(MODEL) ? { temperature: 0 } : {}),
    system: [
      {
        type: 'text',
        text: SINGLE_DISH_DRAFT_SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    output_config: {
      ...(supportsEffort(MODEL) ? { effort: 'medium' as const } : {}),
      format: zodOutputFormat(DishDraftSchema),
    },
    tools: [],
    messages: [{ role: 'user', content: userText }],
  });

  return parseStructuredResponse(
    response,
    DishDraftSchema,
    'single-dish draft',
  );
}
