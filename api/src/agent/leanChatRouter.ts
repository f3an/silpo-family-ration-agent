import type Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { callMcpToolStructured } from './mcpTools';
import { parseStructuredResponse } from './leanProductResolver';
import { supportsEffort, supportsTemperature } from './modelCapabilities';
import { CookingStyleSchema } from './dishPlan.schema';
import type { LlmClient } from '../llm/llm.types';

const MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5';

interface FamilyResult {
  members?: unknown[];
  children?: unknown[];
}

interface RestrictionsResult {
  restrictions?: Array<{ slug: string; name: string | null }>;
}

/**
 * Same member-count/allergen-name math `userProfile.ts`'s `getUserProfile`
 * already does, but only the two MCP calls the chat router actually needs
 * (no `preferencesStore`/name/loyalty) — keeps `run.ts`'s signature free of
 * new dependencies.
 */
export async function resolveGuestSafetyContext(
  mcp: Client,
): Promise<{ people: number; allergens: string[] }> {
  const [familyResult, restrictionsResult] = await Promise.all([
    callMcpToolStructured(mcp, 'silpo_get_my_family', {}),
    callMcpToolStructured(mcp, 'silpo_get_my_food_restrictions', {}),
  ]);
  const family = familyResult as FamilyResult | undefined;
  const restrictions = restrictionsResult as RestrictionsResult | undefined;

  const memberCount =
    (family?.members?.length ?? 0) + (family?.children?.length ?? 0);
  const people = memberCount > 0 ? memberCount : 1;
  const allergens = (restrictions?.restrictions ?? []).map(
    (r) => r.name ?? r.slug,
  );

  return { people, allergens };
}

const ChatRouteSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('clarify'), question: z.string() }),
  z.object({
    type: z.literal('plan'),
    days: z.number().int().min(1).max(14),
    peopleOverride: z.number().int().min(1).nullable(),
    budgetUah: z.number().min(0),
    cuisine: z.string(),
    cookingStyle: CookingStyleSchema,
    forChildren: z.boolean(),
    notes: z.string(),
  }),
  z.object({
    type: z.literal('dish'),
    dishName: z.string(),
    portions: z.number().int().min(1),
  }),
  z.object({ type: z.literal('fallback'), reason: z.string() }),
]);
export type ChatRoute = z.infer<typeof ChatRouteSchema>;

const CHAT_ROUTER_SYSTEM_PROMPT = `Ти визначаєш, що саме просить гість чату «Раціон під сім'ю» (Сільпо), і — для двох найпоширеніших випадків — одразу готуєш концепцію відповіді. Дані про сім'ю гостя (кількість осіб, алергії) уже відомі й дані нижче як факт — НЕ став уточнювальне питання про них, якщо гість сам явно не називає іншу кількість осіб.

Виведи ЛИШЕ JSON одного з чотирьох варіантів (поле "type"):

1. "plan" — гість хоче повний раціон/меню на кілька днів вільним текстом (наприклад "склади раціон на 5 днів, бюджет 1500 грн"). Постав days/budgetUah/cuisine/cookingStyle/forChildren/notes із повідомлення. peopleOverride — null, ОКРІМ випадку коли гість явно називає іншу кількість осіб, ніж дано нижче як факт.

2. "dish" — гість хоче ОДНУ конкретну страву (назва + кількість порцій), не повний раціон. Заповни лише dishName (точна назва страви, з варіантом приготування якщо гість його назвав) і portions — сам рецепт і інгредієнти складе інший крок, не ти.

3. "clarify" — постав чітке коротке питання звичайним текстом замість здогадок, якщо:
   - назва страви має кілька суттєво різних поширених варіантів приготування (наприклад "борщ" — класичний/пісний/з м'ясом; "плов" — з бараниною/курячий/вегетаріанський) і гість не уточнив який;
   - для "plan" бракує кількості днів чи бюджету і їх не можна розумно вивести з контексту розмови.

4. "fallback" — все інше: гість хоче зібрати курований набір товарів під подію (день народження, гриль, пікнік — не рецепт), АБО хоче замінити один інгредієнт у вже показаній картці страви (повідомлення міститиме JSON поточних страв разом із назвою інгредієнта на заміну — "заміни X" / "чогось нема"), АБО щось, що не підпадає під жоден з варіантів вище. Коротко вкажи причину в полі "reason" — це піде іншому обробнику, гість цього не побачить.`;

/**
 * One lean LLM call (no MCP tools) that classifies the chat turn —
 * classification only, no drafting (see run.ts's runAgentTurn: the 'plan'
 * route's own draft call lives in plan.ts, the 'dish' route's in
 * leanProductResolver.ts's draftSingleDish — kept as separate calls so
 * they can run on a different, draft-capable model than this fast
 * classification-only one; see anthropic.service.ts's getDraftClient).
 * `safety` comes from the caller (a single `resolveGuestSafetyContext` call
 * shared with the 'plan' route's own need for it — see run.ts) rather than
 * being resolved again in here, to avoid hitting `silpo_get_my_family`/
 * `silpo_get_my_food_restrictions` twice per turn.
 */
export async function routeChatMessage(
  llm: LlmClient,
  history: Anthropic.MessageParam[],
  userMessage: string,
  safety: { people: number; allergens: string[] },
  extraSystemContext?: string,
): Promise<ChatRoute> {
  const knownFacts = `Вже відомі дані про гостя (не запитуй про це): кількість осіб у сім'ї — ${safety.people}; алергії/обмеження — ${safety.allergens.length ? safety.allergens.join(', ') : 'немає'}.`;

  const response = await llm.createMessage({
    model: MODEL,
    max_tokens: 4000,
    ...(supportsTemperature(MODEL) ? { temperature: 0 } : {}),
    system: [
      {
        type: 'text',
        text: `${CHAT_ROUTER_SYSTEM_PROMPT}\n\n${knownFacts}`,
        cache_control: { type: 'ephemeral' },
      },
      ...(extraSystemContext
        ? [{ type: 'text' as const, text: extraSystemContext }]
        : []),
    ],
    output_config: {
      ...(supportsEffort(MODEL) ? { effort: 'medium' as const } : {}),
      format: zodOutputFormat(ChatRouteSchema),
    },
    tools: [],
    messages: [...history, { role: 'user', content: userMessage }],
  });

  return parseStructuredResponse(response, ChatRouteSchema, 'route');
}
