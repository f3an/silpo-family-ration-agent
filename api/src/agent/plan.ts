import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { PLAN_DRAFT_SYSTEM_PROMPT } from './planSystemPrompt';
import { supportsEffort, supportsTemperature } from './modelCapabilities';
import {
  resolveDeliveryContext,
  pickProductsAndAssemble,
  parseStructuredResponse,
} from './leanProductResolver';
import type { LlmClient } from '../llm/llm.types';
import {
  DishDraftsResponseSchema,
  type Dish,
  type PlanRequest,
} from './dishPlan.schema';

// See run.ts's identical constant for why this reads from env instead of
// being hardcoded — ignored by the local-Anthropic-dialect path, only
// matters for the real Claude API.
const MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5';

const COOKING_STYLE_LABELS: Record<PlanRequest['cookingStyle'], string> = {
  fast: 'швидкі страви — мінімум часу й кроків на готування, кожного дня',
  daily: 'готуємо щодня — окрема свіжа страва на кожен день',
  batch:
    'meal-prep — готуємо 1-2 рази на весь період великими партіями, які їдять кілька днів поспіль',
};

function describeProfile(profile: PlanRequest): string {
  const lines = [
    `Кількість людей: ${profile.people}`,
    `Кількість днів: ${profile.days}`,
    `Алергени/обмеження: ${profile.allergens.length ? profile.allergens.join(', ') : 'немає'}`,
    `Кухня: ${profile.cuisine || 'без переваг'}`,
    `Кухонне обладнання: ${profile.equipment.length ? profile.equipment.join(', ') : 'не вказано'}`,
    `Формат готування: ${COOKING_STYLE_LABELS[profile.cookingStyle]}`,
    `Бюджет: ${profile.budgetUah} грн на весь список страв`,
    `Дитяче меню: ${profile.forChildren ? 'так' : 'ні'}`,
  ];
  if (profile.notes.trim()) {
    lines.push(`Додаткові побажання: ${profile.notes.trim()}`);
  }
  return lines.join('\n');
}

/**
 * Lean 2-call pipeline: code resolves delivery context and searches
 * products directly via MCP (see leanProductResolver.ts), the model only
 * ever does the judgment Claude/local models are both actually good at —
 * drafting dish concepts, then picking the best real product per
 * ingredient. Neither LLM call carries any MCP tool schema, which is both
 * the token/context saving the user asked for and the fix for local models
 * hallucinating IDs when trusted to orchestrate MCP themselves (validated
 * live this session: giving the model the full tool surface reliably
 * produces invented branchId/cartId values and infinite retry loops on
 * weak local models — feeding it pre-resolved context and candidates
 * instead does not). The search+pick+assemble half is shared with the chat
 * router's 'dish'/'plan' routes — see leanProductResolver.ts's
 * pickProductsAndAssemble.
 *
 * `draftLlm` (defaults to `llm`) drives phase 1 only — validated live this
 * session that dish/menu drafting benefits from a different, more
 * Ukrainian-vocabulary-reliable model than the one best at the picking
 * judgment in phase 2 (see anthropic.service.ts's getDraftClient).
 */
export async function planMeals(
  llm: LlmClient,
  mcp: Client,
  profile: PlanRequest,
  draftLlm: LlmClient = llm,
): Promise<Dish[]> {
  const deliveryContext = await resolveDeliveryContext(mcp);
  if (!deliveryContext) {
    throw new Error(
      'Не вдалося визначити філію чи час доставки — перевірте кошик і спробуйте ще раз.',
    );
  }

  // Phase 1: draft dish concepts + short ingredient names.
  const draftResponse = await draftLlm.createMessage({
    model: MODEL,
    max_tokens: 8000,
    ...(supportsTemperature(MODEL) ? { temperature: 0 } : {}),
    system: [
      {
        type: 'text',
        text: PLAN_DRAFT_SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    output_config: {
      ...(supportsEffort(MODEL) ? { effort: 'medium' as const } : {}),
      format: zodOutputFormat(DishDraftsResponseSchema),
    },
    tools: [],
    messages: [{ role: 'user', content: describeProfile(profile) }],
  });
  const drafts = parseStructuredResponse(
    draftResponse,
    DishDraftsResponseSchema,
    'draft',
  ).dishes;

  // Phase 2 (code + 1 LLM call): search real products for every ingredient
  // across every draft dish, pick the best match per ingredient, assemble.
  return pickProductsAndAssemble(
    llm,
    mcp,
    deliveryContext,
    drafts,
    profile.people,
  );
}
