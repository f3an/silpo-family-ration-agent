import type Anthropic from '@anthropic-ai/sdk';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { listAnthropicTools, callMcpTool } from './mcpTools';
import { selectRelevantTools } from './toolSelection';
import { SYSTEM_PROMPT } from './systemPrompt';
import { currentDateLine } from './currentDate';
import { supportsEffort } from './modelCapabilities';
import { routeChatMessage, resolveGuestSafetyContext } from './leanChatRouter';
import {
  resolveDeliveryContext,
  pickProductsAndAssemble,
  draftSingleDish,
} from './leanProductResolver';
import { planMeals } from './plan';
import type { LlmClient } from '../llm/llm.types';
import {
  DishSchema,
  type Dish,
  OccasionBasketSchema,
  type OccasionBasket,
  IngredientOptionsSchema,
  type IngredientOptions,
  type PlanRequest,
} from './dishPlan.schema';

// Ignored by the local-Anthropic-dialect path (LM Studio serves whatever
// model is loaded regardless of what's requested — confirmed live), so this
// only matters for the real Claude API. Configurable rather than hardcoded
// so swapping models (e.g. cheaper Haiku 4.5 vs Sonnet 5) is a .env change,
// not a code change.
const MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5';

/**
 * A local tool, not an MCP one — `callMcpTool` never sees it (see the
 * special-case in the loop below). Lets any chat scenario that needs to end
 * a turn with a structured dish card (see systemPrompt.ts: the single-dish
 * scenario, the full multi-day plan when requested as free text, and the
 * ingredient-swap scenario) do so instead of only ever replying with plain
 * text — called once per dish, so a multi-dish plan means multiple calls in
 * the same turn (see the loop below collecting them into `finalDishes`).
 * Deliberately hand-written JSON Schema (same approach mcpTools.ts already
 * uses for real MCP tools) rather than a zod→JSON-schema dependency —
 * `DishSchema` is still the actual validation gate once the model calls it.
 */
const PROPOSE_DISH_CARD_TOOL: Anthropic.Tool = {
  name: 'propose_dish_card',
  description:
    'Додає ОДНУ страву до фінальної відповіді як картку (фото/БЖУ/кнопка купівлі) — якщо страв декілька (повний раціон, або оновлення багатостравного плану), виклич цей інструмент ОКРЕМО для КОЖНОЇ страви в тому самому ході. Викликай лише коли для ЦІЄЇ страви вже точно відомі назва, кількість порцій, і (якщо було кілька суттєво різних поширених варіантів приготування) гість підтвердив, який саме. Перед викликом знайди реальні товари Сільпо під кожен інгредієнт (silpo_find_products_batch/silpo_get_product_details), так само чесно завжди — productId лиши null, якщо не впевнений у збігу. Не викликай, поки не маєш достатньо інформації для цієї страви — постав уточнювальне питання звичайним текстом натомість.',
  input_schema: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      description: { type: 'string' },
      cuisine: { type: 'string' },
      prepTimeMinutes: { type: 'number' },
      daysCovered: {
        type: 'number',
        description:
          '1 для окремої страви чи страви, що готується щодня заново. Більше 1 — лише для meal-prep страви, одна партія якої зберігається й з’їдається кілька днів поспіль (стільки, скільки днів охоплює).',
      },
      calories: { type: 'number' },
      proteinGrams: { type: 'number' },
      fatGrams: { type: 'number' },
      carbsGrams: { type: 'number' },
      ingredients: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            quantityLabel: { type: 'string' },
            productId: { type: ['string', 'null'] },
            companyId: { type: ['string', 'null'] },
            branchId: { type: ['string', 'null'] },
            cartQuantity: { type: ['number', 'null'] },
            imageUrl: { type: ['string', 'null'] },
          },
          required: [
            'name',
            'quantityLabel',
            'productId',
            'companyId',
            'branchId',
            'cartQuantity',
            'imageUrl',
          ],
        },
      },
    },
    required: [
      'name',
      'description',
      'cuisine',
      'prepTimeMinutes',
      'daysCovered',
      'calories',
      'proteinGrams',
      'fatGrams',
      'carbsGrams',
      'ingredients',
    ],
  },
};

/**
 * A second local (non-MCP) finalize tool — for the "curated shopping list
 * for an occasion" scenario (see systemPrompt.ts). Not a recipe, so no
 * macros/prepTime/ingredients-of-a-dish — just a themed list of real
 * products. `OccasionBasketSchema` is still the actual validation gate.
 */
const PROPOSE_OCCASION_BASKET_TOOL: Anthropic.Tool = {
  name: 'propose_occasion_basket',
  description:
    'Завершує розмову карткою кураторського набору товарів під подію (день народження, гриль, пікнік тощо) — НЕ рецепт. Викликай лише коли вже зібрав реальні товари Сільпо (не найдешевший і не перший автоматично) під заявлену кількість гостей. Не викликай, поки не маєш достатньо інформації — постав уточнювальне питання звичайним текстом натомість.',
  input_schema: {
    type: 'object',
    properties: {
      theme: {
        type: 'string',
        description: 'Коротка назва події, напр. "День народження на 8 осіб".',
      },
      description: { type: 'string' },
      guestCount: { type: 'number' },
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            quantityLabel: { type: 'string' },
            productId: { type: ['string', 'null'] },
            companyId: { type: ['string', 'null'] },
            branchId: { type: ['string', 'null'] },
            cartQuantity: { type: ['number', 'null'] },
            imageUrl: { type: ['string', 'null'] },
          },
          required: [
            'name',
            'quantityLabel',
            'productId',
            'companyId',
            'branchId',
            'cartQuantity',
            'imageUrl',
          ],
        },
      },
    },
    required: ['theme', 'description', 'guestCount', 'items'],
  },
};

/**
 * A third local (non-MCP) finalize tool — for the ingredient-swap scenario
 * (see systemPrompt.ts). Ends the turn with 2-3 real product candidates the
 * guest picks from (rendered as cards with photos/prices), instead of
 * listing them in plain text — the guest's pick comes back as a normal
 * follow-up chat message (see IngredientOptionsWidget.jsx), which the agent
 * then applies via propose_dish_card/propose_occasion_basket as usual.
 */
const PROPOSE_INGREDIENT_OPTIONS_TOOL: Anthropic.Tool = {
  name: 'propose_ingredient_options',
  description:
    'Завершує розмову карткою з 2-3 реальними товарами Сільпо — варіантами заміни для одного інгредієнта, замість переліку звичайним текстом. Кожен варіант має бути реальним знайденим товаром (productId), з ціною, якщо відома. Викликай лише коли вже знайшов реальні варіанти — не викликай, поки не маєш що запропонувати.',
  input_schema: {
    type: 'object',
    properties: {
      ingredientName: {
        type: 'string',
        description: 'Назва інгредієнта, який замінюємо.',
      },
      options: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string', description: 'Назва товару-варіанту.' },
            note: {
              type: 'string',
              description:
                'Коротка причина обрати саме цей варіант, напр. "найдешевший".',
            },
            quantityLabel: { type: 'string' },
            price: { type: ['number', 'null'] },
            productId: { type: ['string', 'null'] },
            companyId: { type: ['string', 'null'] },
            branchId: { type: ['string', 'null'] },
            cartQuantity: { type: ['number', 'null'] },
            imageUrl: { type: ['string', 'null'] },
          },
          required: [
            'label',
            'note',
            'quantityLabel',
            'price',
            'productId',
            'companyId',
            'branchId',
            'cartQuantity',
            'imageUrl',
          ],
        },
      },
    },
    required: ['ingredientName', 'options'],
  },
};

export interface RunAgentTurnResult {
  history: Anthropic.MessageParam[];
  finalText: string;
  dishes?: Dish[];
  dishMessageIndex?: number;
  basket?: OccasionBasket;
  basketMessageIndex?: number;
  options?: IngredientOptions;
  optionsMessageIndex?: number;
}

function finalizeDishTurn(
  nextHistory: Anthropic.MessageParam[],
  dishes: Dish[],
): RunAgentTurnResult {
  const finalText = `Ось картка: ${dishes.map((d) => d.name).join(', ')}.`;
  const history = [
    ...nextHistory,
    { role: 'assistant' as const, content: finalText },
  ];
  return {
    history,
    finalText,
    dishes,
    dishMessageIndex: history.length - 1,
  };
}

/** `sessionId`/`conversationId`/`familyChat` are unused inside `planMeals`
 * (it only reads people/days/allergens/cuisine/equipment/cookingStyle/
 * budgetUah/forChildren/notes — see plan.ts's describeProfile) — safe
 * placeholders here since this profile is never persisted or read back. */
function buildPlanRequest(
  route: Extract<
    Awaited<ReturnType<typeof routeChatMessage>>,
    { type: 'plan' }
  >,
  safety: { people: number; allergens: string[] },
): PlanRequest {
  return {
    sessionId: 'chat',
    people: route.peopleOverride ?? safety.people,
    days: route.days,
    allergens: safety.allergens,
    cuisine: route.cuisine,
    equipment: [],
    cookingStyle: route.cookingStyle,
    budgetUah: route.budgetUah,
    notes: route.notes,
    forChildren: route.forChildren,
    familyChat: false,
  };
}

/**
 * Entry point every chat turn actually goes through — a lean router call
 * (see leanChatRouter.ts) classifies the message and, for the two common
 * scenarios (a full multi-day plan or one named dish requested via free
 * text), drives the same code-resolves-MCP/model-only-judges pipeline
 * `plan.ts` uses, instead of handing the model the full MCP tool surface.
 * Everything else (occasion baskets, ingredient swaps, anything the router
 * doesn't recognize) falls back to `runFullToolLoopTurn` unchanged.
 *
 * `draftLlm` (defaults to `llm`) is only used for the 'plan'/'dish'
 * routes' own drafting calls — validated live this session that a
 * different (draft-capable) model measurably beats the router/pick model
 * at composing a coherent dish from scratch; see anthropic.service.ts's
 * getDraftClient.
 */
export async function runAgentTurn(
  llm: LlmClient,
  mcp: Client,
  history: Anthropic.MessageParam[],
  userMessage: string,
  extraSystemContext?: string,
  draftLlm: LlmClient = llm,
): Promise<RunAgentTurnResult> {
  const safety = await resolveGuestSafetyContext(mcp);
  const route = await routeChatMessage(
    llm,
    history,
    userMessage,
    safety,
    extraSystemContext,
  );
  const nextHistory: Anthropic.MessageParam[] = [
    ...history,
    { role: 'user', content: userMessage },
  ];

  switch (route.type) {
    case 'clarify':
      return {
        history: [
          ...nextHistory,
          { role: 'assistant', content: route.question },
        ],
        finalText: route.question,
      };

    case 'plan': {
      const dishes = await planMeals(
        llm,
        mcp,
        buildPlanRequest(route, safety),
        draftLlm,
      );
      return finalizeDishTurn(nextHistory, dishes);
    }

    case 'dish': {
      const draft = await draftSingleDish(
        draftLlm,
        route.dishName,
        route.portions,
        safety.allergens,
      );
      const deliveryContext = await resolveDeliveryContext(mcp);
      if (!deliveryContext) {
        throw new Error(
          'Не вдалося визначити філію чи час доставки — перевірте кошик і спробуйте ще раз.',
        );
      }
      const dishes = await pickProductsAndAssemble(
        llm,
        mcp,
        deliveryContext,
        [draft],
        route.portions,
      );
      return finalizeDishTurn(nextHistory, dishes);
    }

    case 'fallback':
      return runFullToolLoopTurn(
        llm,
        mcp,
        history,
        userMessage,
        extraSystemContext,
      );
  }
}

/**
 * The original full-MCP-tool-loop turn: sends `userMessage` (plus prior
 * history), lets Claude call Silpo MCP tools until it produces a final
 * answer, and returns the updated message history along with the final
 * assistant text. If the turn ends by calling `propose_dish_card` (once or,
 * for a multi-dish plan, once per dish) instead, `dishes`/`dishMessageIndex`
 * are set too — see agent.service.ts, which turns that into a persisted
 * chat widget the same way /agent/plan already does.
 *
 * Only reached now via `runAgentTurn`'s 'fallback' route (see below) —
 * occasion baskets and ingredient swaps, plus anything the router doesn't
 * recognize. The full-plan and single-dish scenarios this loop used to
 * handle are now the lean `'plan'`/`'dish'` routes instead — validated live
 * this session: this loop reliably invents branchId/cartId values on weak
 * local models when trusted to orchestrate MCP itself for those scenarios.
 * Kept as-is (still exported, still the same behavior/tests) since occasion
 * baskets and ingredient swaps are lower-cost and more open-ended/
 * exploratory — collapsing them into fixed phases is a bigger redesign for
 * another pass.
 *
 * Cost notes: `tools` is filtered down by `selectRelevantTools` before it's
 * ever sent, and the system prompt carries a `cache_control` breakpoint —
 * since tools render before system in the request, this one breakpoint
 * caches both. That prefix is byte-identical on every iteration of the
 * while-loop below *and* across every turn of a session, so only the first
 * call pays full price for it; every call after is a cache read (~10% of
 * input cost) as long as it lands within the cache's TTL.
 */
export async function runFullToolLoopTurn(
  llm: LlmClient,
  mcp: Client,
  history: Anthropic.MessageParam[],
  userMessage: string,
  extraSystemContext?: string,
): Promise<RunAgentTurnResult> {
  const allTools = await listAnthropicTools(mcp);
  const messages: Anthropic.MessageParam[] = [
    ...history,
    { role: 'user', content: userMessage },
  ];
  const conversationText = messages
    .filter(
      (message): message is Anthropic.MessageParam & { content: string } =>
        message.role === 'user' && typeof message.content === 'string',
    )
    .map((message) => message.content)
    .join(' ');
  const tools = [
    ...selectRelevantTools(allTools, conversationText),
    PROPOSE_DISH_CARD_TOOL,
    PROPOSE_OCCASION_BASKET_TOOL,
    PROPOSE_INGREDIENT_OPTIONS_TOOL,
  ];
  // Only system+tools had a cache breakpoint before — fine for a single
  // MCP call, but a multi-dish plan/swap can loop through this while-loop
  // many times (one silpo_find_products_batch per iteration), re-sending
  // and re-billing the *entire* growing message history at full price on
  // every one of those calls. Moves a second breakpoint onto the tail of
  // `messages` each iteration (clearing the previous one first — only the
  // newest matters) so iteration N+1 only pays full price for what
  // iteration N actually added, same idea as system's one-time prefix cache.
  let historyCacheBreakpoint: Anthropic.ToolResultBlockParam | undefined;

  while (true) {
    // See llm/llm.types.ts — createMessage() picks streaming vs not, and
    // Anthropic-vs-local, entirely on its own; this call is provider-agnostic.
    const response = await llm.createMessage({
      model: MODEL,
      max_tokens: 32000,
      system: [
        {
          type: 'text',
          text: currentDateLine() + SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
        ...(extraSystemContext
          ? [{ type: 'text' as const, text: extraSystemContext }]
          : []),
      ],
      ...(supportsEffort(MODEL)
        ? { output_config: { effort: 'medium' as const } }
        : {}),
      tools,
      messages,
    });

    messages.push({ role: 'assistant', content: response.content });
    const assistantMessageIndex = messages.length - 1;

    if (response.stop_reason !== 'tool_use') {
      if (response.stop_reason === 'max_tokens') {
        // Don't return the truncated text as if it were a real answer — a
        // cut-off turn can look exactly like a confused/garbled reply (the
        // model was mid-sentence, possibly mid tool-call-planning) instead
        // of an honest error.
        throw new Error(
          'Відповідь агента обірвалася на max_tokens, не встигнувши завершити хід — спробуй звузити запит (менше днів/страв за раз) або повтори ще раз.',
        );
      }
      const finalText = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n');
      return { history: messages, finalText };
    }

    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
    );

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    // A multi-dish plan swap calls propose_dish_card once PER dish (the
    // changed one plus every unchanged one echoed back as-is) — see
    // systemPrompt.ts — so the resulting widget is always a complete,
    // up-to-date snapshot of the whole plan, not just the touched dish.
    const finalDishes: Dish[] = [];
    let finalBasket: OccasionBasket | undefined;
    let finalOptions: IngredientOptions | undefined;

    for (const block of toolUseBlocks) {
      if (block.name === 'propose_dish_card') {
        const parsed = DishSchema.safeParse(block.input);
        if (parsed.success) {
          finalDishes.push(parsed.data);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: 'Картку сформовано і показано гостю.',
          });
        } else {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: `Error: невалідна структура страви — ${parsed.error.issues
              .map((issue) => issue.message)
              .join('; ')}`,
            is_error: true,
          });
        }
        continue;
      }

      if (block.name === 'propose_occasion_basket') {
        const parsed = OccasionBasketSchema.safeParse(block.input);
        if (parsed.success) {
          finalBasket = parsed.data;
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: 'Набір сформовано і показано гостю.',
          });
        } else {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: `Error: невалідна структура набору — ${parsed.error.issues
              .map((issue) => issue.message)
              .join('; ')}`,
            is_error: true,
          });
        }
        continue;
      }

      if (block.name === 'propose_ingredient_options') {
        const parsed = IngredientOptionsSchema.safeParse(block.input);
        if (parsed.success) {
          finalOptions = parsed.data;
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: 'Варіанти показано гостю.',
          });
        } else {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: `Error: невалідна структура варіантів — ${parsed.error.issues
              .map((issue) => issue.message)
              .join('; ')}`,
            is_error: true,
          });
        }
        continue;
      }

      console.log(`  → ${block.name}(${JSON.stringify(block.input)})`);
      try {
        const result = await callMcpTool(mcp, block.name, block.input);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: result,
        });
      } catch (err) {
        // A timed-out/failed MCP call used to throw straight out of this
        // whole turn, silently killing the HTTP response with no chat-visible
        // error. Feeding it back as an is_error tool_result instead lets
        // Claude react in-turn (retry narrower, apologize, try a different
        // tool) the same way it already does for invalid finalize-tool input.
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: `Error: інструмент не відповів вчасно — ${err instanceof Error ? err.message : String(err)}`,
          is_error: true,
        });
      }
    }

    if (historyCacheBreakpoint) delete historyCacheBreakpoint.cache_control;
    const lastResult = toolResults[toolResults.length - 1];
    lastResult.cache_control = { type: 'ephemeral' };
    historyCacheBreakpoint = lastResult;

    messages.push({ role: 'user', content: toolResults });

    if (finalDishes.length > 0 || finalBasket || finalOptions) {
      const finalText = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
      // An event turn (see systemPrompt.ts's occasion scenario) can call
      // BOTH propose_dish_card (for dishes that need cooking) AND
      // propose_occasion_basket (ready-to-buy extras) in the SAME
      // response — these two are not mutually exclusive like `options` is
      // (a swap-picker turn never also finalizes a dish/basket). Both ride
      // the same assistantMessageIndex since they came from one turn.
      if (finalDishes.length > 0 || finalBasket) {
        const fallbackParts = [
          finalDishes.length > 0 &&
            `Ось картка: ${finalDishes.map((d) => d.name).join(', ')}.`,
          finalBasket && `Ось набір: ${finalBasket.theme}.`,
        ].filter((p): p is string => Boolean(p));
        return {
          history: messages,
          finalText: finalText || fallbackParts.join(' '),
          ...(finalDishes.length > 0 && {
            dishes: finalDishes,
            dishMessageIndex: assistantMessageIndex,
          }),
          ...(finalBasket && {
            basket: finalBasket,
            basketMessageIndex: assistantMessageIndex,
          }),
        };
      } else if (finalOptions) {
        return {
          history: messages,
          finalText:
            finalText ||
            `Варіанти заміни для «${finalOptions.ingredientName}»:`,
          options: finalOptions,
          optionsMessageIndex: assistantMessageIndex,
        };
      }
    }
  }
}
