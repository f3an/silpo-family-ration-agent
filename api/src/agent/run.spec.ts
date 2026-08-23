import type Anthropic from '@anthropic-ai/sdk';
// `runFullToolLoopTurn` is the renamed original `runAgentTurn` body (see
// run.ts) — every test below still exercises the exact same full-MCP-tool-
// loop behavior, just reached directly instead of via the new router
// dispatcher. Aliased to keep this file's diff minimal.
import {
  runFullToolLoopTurn as runAgentTurn,
  runAgentTurn as dispatchAgentTurn,
} from './run';
import type { LlmClient } from '../llm/llm.types';

/** `runAgentTurn` calls `llm.createMessage(params)` — this wires
 * `createMessage` to hand back queued responses, one per call. Named
 * `anthropic`/`create` for minimal diff against this file's history
 * (before the LlmClient abstraction, this really was the Anthropic SDK). */
function fakeAnthropic(responses: unknown[]) {
  let i = 0;
  const create = jest
    .fn()
    .mockImplementation(() => Promise.resolve(responses[i++]));
  const anthropic = { createMessage: create } as unknown as LlmClient;
  return { anthropic, create };
}

function fakeMcp(overrides: Record<string, unknown> = {}) {
  return {
    listTools: jest.fn().mockResolvedValue({
      tools: [
        {
          name: 'silpo_get_my_family',
          description: "Get the guest's family",
          inputSchema: { type: 'object', properties: {} },
        },
      ],
    }),
    callTool: jest.fn().mockResolvedValue({
      isError: false,
      content: [{ type: 'text', text: JSON.stringify({ members: [] }) }],
    }),
    ...overrides,
  };
}

const VALID_DISH = {
  name: 'Борщ класичний',
  description: 'Традиційний борщ на м’ясному бульйоні',
  cuisine: 'українська',
  prepTimeMinutes: 90,
  daysCovered: 1,
  calories: 350,
  proteinGrams: 15,
  fatGrams: 12,
  carbsGrams: 40,
  ingredients: [
    {
      name: 'Буряк',
      quantityLabel: '2 шт',
      productId: '1ed07609-566a-6c24-829d-dd63763181f9',
      companyId: '1ec88c5d-a050-669c-8467-570a157f3e31',
      branchId: '1f0b89b8-e353-66f6-9767-6fb06842c14f',
      cartQuantity: 2,
      imageUrl: 'https://images.silpo.ua/example.png',
    },
  ],
};

const VALID_BASKET = {
  theme: 'День народження на 8 осіб',
  description: 'Набір для святкового столу',
  guestCount: 8,
  items: [
    {
      name: 'Чіпси',
      quantityLabel: '2 упаковки',
      productId: '1ed07609-566a-6c24-829d-dd63763181f9',
      companyId: '1ec88c5d-a050-669c-8467-570a157f3e31',
      branchId: '1f0b89b8-e353-66f6-9767-6fb06842c14f',
      cartQuantity: 2,
      imageUrl: 'https://images.silpo.ua/example.png',
    },
  ],
};

describe('runAgentTurn — propose_occasion_basket', () => {
  it('ends the turn immediately on a valid propose_occasion_basket call', async () => {
    const { anthropic, create } = fakeAnthropic([
      {
        stop_reason: 'tool_use',
        content: [
          { type: 'text', text: 'Ось набір на день народження:' },
          {
            type: 'tool_use',
            id: 'toolu_1',
            name: 'propose_occasion_basket',
            input: VALID_BASKET,
          },
        ],
      },
    ]);
    const mcp = fakeMcp();

    const result = await runAgentTurn(
      anthropic,
      mcp as never,
      [],
      'набір на день народження на 8 осіб',
    );

    expect(create).toHaveBeenCalledTimes(1);
    expect(result.basket).toEqual(VALID_BASKET);
    expect(result.dishes).toBeUndefined();
    expect(result.basketMessageIndex).toBe(1);
    expect(result.finalText).toBe('Ось набір на день народження:');

    const toolResultMessage = result.history[result.history.length - 1];
    const toolResults =
      toolResultMessage.content as Anthropic.ToolResultBlockParam[];
    expect(toolResults[0].is_error).toBeUndefined();
  });

  it('retries instead of finalizing when propose_occasion_basket is called with an invalid shape', async () => {
    const { anthropic, create } = fakeAnthropic([
      {
        stop_reason: 'tool_use',
        content: [
          {
            type: 'tool_use',
            id: 'toolu_1',
            name: 'propose_occasion_basket',
            input: { theme: 'День народження' }, // missing guestCount/items/description
          },
        ],
      },
      {
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'Скільки гостей очікується?' }],
      },
    ]);
    const mcp = fakeMcp();

    const result = await runAgentTurn(
      anthropic,
      mcp as never,
      [],
      'зроби набір на день народження',
    );

    expect(create).toHaveBeenCalledTimes(2);
    expect(result.basket).toBeUndefined();
    expect(result.finalText).toBe('Скільки гостей очікується?');

    const firstToolResultMessage = result.history[2];
    const toolResults =
      firstToolResultMessage.content as Anthropic.ToolResultBlockParam[];
    expect(toolResults[0].is_error).toBe(true);
  });

  // See systemPrompt.ts's occasion scenario: an event turn can call BOTH
  // propose_dish_card (dishes that need cooking) and propose_occasion_basket
  // (ready-to-buy extras like snacks) in the same response — the turn must
  // surface both, not just whichever one the old if/else-if picked first.
  it('ends the turn with BOTH dishes and a basket when the agent calls propose_dish_card and propose_occasion_basket in the same response', async () => {
    const { anthropic, create } = fakeAnthropic([
      {
        stop_reason: 'tool_use',
        content: [
          { type: 'text', text: 'Ось гарячі страви й набір закусок:' },
          {
            type: 'tool_use',
            id: 'toolu_1',
            name: 'propose_dish_card',
            input: VALID_DISH,
          },
          {
            type: 'tool_use',
            id: 'toolu_2',
            name: 'propose_occasion_basket',
            input: VALID_BASKET,
          },
        ],
      },
    ]);
    const mcp = fakeMcp();

    const result = await runAgentTurn(
      anthropic,
      mcp as never,
      [],
      'День народження на 6 гостей — щось гаряче і набір закусок',
    );

    expect(create).toHaveBeenCalledTimes(1);
    expect(result.dishes).toEqual([VALID_DISH]);
    expect(result.basket).toEqual(VALID_BASKET);
    expect(result.dishMessageIndex).toBe(1);
    expect(result.basketMessageIndex).toBe(1);
    expect(result.finalText).toBe('Ось гарячі страви й набір закусок:');
  });
});

const VALID_OPTIONS = {
  ingredientName: 'Креветки з часником',
  options: [
    {
      label: 'Креветки «Премія» очищені варено-морожені',
      note: 'майже 1:1 заміна',
      quantityLabel: '250 г',
      price: 309,
      productId: '1ed07609-566a-6c24-829d-dd63763181f9',
      companyId: '1ec88c5d-a050-669c-8467-570a157f3e31',
      branchId: '1f0b89b8-e353-66f6-9767-6fb06842c14f',
      cartQuantity: 1,
      imageUrl: 'https://images.silpo.ua/v2/products/500x500/webp/example.png',
    },
  ],
};

describe('runAgentTurn — propose_ingredient_options', () => {
  it('ends the turn immediately on a valid propose_ingredient_options call', async () => {
    const { anthropic, create } = fakeAnthropic([
      {
        stop_reason: 'tool_use',
        content: [
          { type: 'text', text: 'Ось варіанти заміни:' },
          {
            type: 'tool_use',
            id: 'toolu_1',
            name: 'propose_ingredient_options',
            input: VALID_OPTIONS,
          },
        ],
      },
    ]);
    const mcp = fakeMcp();

    const result = await runAgentTurn(
      anthropic,
      mcp as never,
      [],
      'заміни креветки з часником',
    );

    expect(create).toHaveBeenCalledTimes(1);
    expect(result.options).toEqual(VALID_OPTIONS);
    expect(result.dishes).toBeUndefined();
    expect(result.basket).toBeUndefined();
    expect(result.optionsMessageIndex).toBe(1);
    expect(result.finalText).toBe('Ось варіанти заміни:');
  });

  it('retries instead of finalizing when propose_ingredient_options is called with an invalid shape', async () => {
    const { anthropic, create } = fakeAnthropic([
      {
        stop_reason: 'tool_use',
        content: [
          {
            type: 'tool_use',
            id: 'toolu_1',
            name: 'propose_ingredient_options',
            input: { ingredientName: 'Креветки' }, // missing options
          },
        ],
      },
      {
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'Не знайшла жодного варіанту.' }],
      },
    ]);
    const mcp = fakeMcp();

    const result = await runAgentTurn(
      anthropic,
      mcp as never,
      [],
      'заміни креветки',
    );

    expect(create).toHaveBeenCalledTimes(2);
    expect(result.options).toBeUndefined();

    const firstToolResultMessage = result.history[2];
    const toolResults =
      firstToolResultMessage.content as Anthropic.ToolResultBlockParam[];
    expect(toolResults[0].is_error).toBe(true);
  });
});

describe('runAgentTurn — propose_dish_card', () => {
  it('ends the turn immediately on a valid propose_dish_card call, with a matching non-error tool_result kept in history', async () => {
    const { anthropic, create } = fakeAnthropic([
      {
        stop_reason: 'tool_use',
        content: [
          { type: 'text', text: 'Ось картка борщу:' },
          {
            type: 'tool_use',
            id: 'toolu_1',
            name: 'propose_dish_card',
            input: VALID_DISH,
          },
        ],
      },
    ]);
    const mcp = fakeMcp();

    const result = await runAgentTurn(
      anthropic,
      mcp as never,
      [],
      'борщ класичний на 4 порції',
    );

    // No second round-trip — the turn ended as soon as the dish was finalized.
    expect(create).toHaveBeenCalledTimes(1);
    expect(result.dishes).toEqual([VALID_DISH]);
    // messages = [user(0), assistant(1)] — the assistant turn that called the tool.
    expect(result.dishMessageIndex).toBe(1);
    expect(result.finalText).toBe('Ось картка борщу:');

    const toolResultMessage = result.history[result.history.length - 1];
    expect(toolResultMessage.role).toBe('user');
    const toolResults =
      toolResultMessage.content as Anthropic.ToolResultBlockParam[];
    expect(toolResults).toHaveLength(1);
    expect(toolResults[0].is_error).toBeUndefined();
  });

  it('retries instead of finalizing when propose_dish_card is called with an invalid shape', async () => {
    const { anthropic, create } = fakeAnthropic([
      {
        stop_reason: 'tool_use',
        content: [
          {
            type: 'tool_use',
            id: 'toolu_1',
            name: 'propose_dish_card',
            input: { name: 'Борщ' }, // missing every other required field
          },
        ],
      },
      {
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'Перепрошую, уточню деталі ще раз.' }],
      },
    ]);
    const mcp = fakeMcp();

    const result = await runAgentTurn(
      anthropic,
      mcp as never,
      [],
      'борщ на 4 порції',
    );

    expect(create).toHaveBeenCalledTimes(2);
    expect(result.dishes).toBeUndefined();
    expect(result.finalText).toBe('Перепрошую, уточню деталі ще раз.');

    // The rejected call still got a matching, error-flagged tool_result.
    // history = [user(0), assistant(1, the rejected call), toolResults(2), assistant(3, retry)].
    const firstToolResultMessage = result.history[2];
    const toolResults =
      firstToolResultMessage.content as Anthropic.ToolResultBlockParam[];
    expect(toolResults[0].is_error).toBe(true);
  });

  it('still executes a real MCP tool call batched alongside propose_dish_card in the same response', async () => {
    const { anthropic, create } = fakeAnthropic([
      {
        stop_reason: 'tool_use',
        content: [
          {
            type: 'tool_use',
            id: 'toolu_mcp',
            name: 'silpo_get_my_family',
            input: {},
          },
          {
            type: 'tool_use',
            id: 'toolu_dish',
            name: 'propose_dish_card',
            input: VALID_DISH,
          },
        ],
      },
    ]);
    const mcp = fakeMcp();

    const result = await runAgentTurn(
      anthropic,
      mcp as never,
      [],
      'борщ класичний на 4 порції',
    );

    expect(mcp.callTool).toHaveBeenCalledWith(
      { name: 'silpo_get_my_family', arguments: {} },
      expect.anything(),
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest matcher typing
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
    expect(result.dishes).toEqual([VALID_DISH]);
    expect(create).toHaveBeenCalledTimes(1);

    const toolResultMessage = result.history[result.history.length - 1];
    const toolResults =
      toolResultMessage.content as Anthropic.ToolResultBlockParam[];
    expect(toolResults).toHaveLength(2);
  });

  it('turns a hung/failed MCP tool call into an is_error tool_result instead of throwing out of the whole turn', async () => {
    const { anthropic, create } = fakeAnthropic([
      {
        stop_reason: 'tool_use',
        content: [
          {
            type: 'tool_use',
            id: 'toolu_mcp',
            name: 'silpo_find_products_batch',
            input: { products: ['тунець консервований'] },
          },
        ],
      },
      {
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'Вибач, не вдалося знайти товар.' }],
      },
    ]);
    const mcp = fakeMcp({
      callTool: jest
        .fn()
        .mockRejectedValue(new Error('MCP error -32001: Request timed out')),
    });

    const result = await runAgentTurn(
      anthropic,
      mcp as never,
      [],
      'борщ класичний на 4 порції',
    );

    expect(create).toHaveBeenCalledTimes(2);
    expect(result.finalText).toBe('Вибач, не вдалося знайти товар.');

    const toolResultMessage = result.history[2];
    const toolResults =
      toolResultMessage.content as Anthropic.ToolResultBlockParam[];
    expect(toolResults[0].is_error).toBe(true);
    expect(toolResults[0].content).toContain('Request timed out');
  });

  it('behaves exactly as before when the agent never calls propose_dish_card', async () => {
    const { anthropic } = fakeAnthropic([
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Привіт!' }] },
    ]);
    const mcp = fakeMcp();

    const result = await runAgentTurn(anthropic, mcp as never, [], 'привіт');

    expect(result.dishes).toBeUndefined();
    expect(result.dishMessageIndex).toBeUndefined();
    expect(result.finalText).toBe('Привіт!');
  });

  it('collects multiple propose_dish_card calls in the same turn into one dishes[] — a multi-dish plan swap echoing every dish back', async () => {
    const otherDish = {
      ...VALID_DISH,
      name: 'Грецький салат з курячим філе гриль',
    };
    const { anthropic, create } = fakeAnthropic([
      {
        stop_reason: 'tool_use',
        content: [
          { type: 'text', text: 'Оновила весь раціон:' },
          {
            type: 'tool_use',
            id: 'toolu_1',
            name: 'propose_dish_card',
            input: VALID_DISH,
          },
          {
            type: 'tool_use',
            id: 'toolu_2',
            name: 'propose_dish_card',
            input: otherDish,
          },
        ],
      },
    ]);
    const mcp = fakeMcp();

    const result = await runAgentTurn(
      anthropic,
      mcp as never,
      [],
      'заміни креветки у раціоні',
    );

    expect(create).toHaveBeenCalledTimes(1);
    expect(result.dishes).toEqual([VALID_DISH, otherDish]);
    expect(result.dishMessageIndex).toBe(1);

    const toolResultMessage = result.history[result.history.length - 1];
    const toolResults =
      toolResultMessage.content as Anthropic.ToolResultBlockParam[];
    expect(toolResults).toHaveLength(2);
    expect(toolResults.every((r) => !r.is_error)).toBe(true);
  });
});

describe('runAgentTurn — max_tokens truncation', () => {
  it('throws a clear error instead of returning a cut-off reply as if it were final', async () => {
    const { anthropic } = fakeAnthropic([
      {
        stop_reason: 'max_tokens',
        content: [{ type: 'text', text: 'Timeslot invalid, потрібно' }],
      },
    ]);
    const mcp = fakeMcp();

    await expect(
      runAgentTurn(anthropic, mcp as never, [], 'склади раціон'),
    ).rejects.toThrow(/max_tokens/);
  });
});

describe('runAgentTurn — prompt caching across the tool-use loop', () => {
  it('moves a single trailing cache breakpoint onto the newest tool_result each iteration', async () => {
    const { anthropic } = fakeAnthropic([
      {
        stop_reason: 'tool_use',
        content: [
          {
            type: 'tool_use',
            id: 'toolu_1',
            name: 'silpo_get_my_family',
            input: {},
          },
        ],
      },
      {
        stop_reason: 'tool_use',
        content: [
          {
            type: 'tool_use',
            id: 'toolu_2',
            name: 'silpo_find_products_batch',
            input: { products: ['молоко'] },
          },
        ],
      },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Готово.' }] },
    ]);
    const mcp = fakeMcp();

    const result = await runAgentTurn(
      anthropic,
      mcp as never,
      [],
      'борщ на 4 порції',
    );

    // history = [user(0), assistant#1(1), toolResults#1(2), assistant#2(3), toolResults#2(4), assistant#3(5)]
    const firstToolResults = result.history[2]
      .content as Anthropic.ToolResultBlockParam[];
    const secondToolResults = result.history[4]
      .content as Anthropic.ToolResultBlockParam[];

    // The breakpoint that sat on round 1's result moved off it once round 2 ran...
    expect(firstToolResults[0].cache_control).toBeUndefined();
    // ...and landed on round 2's own (newest) result instead.
    expect(secondToolResults[0].cache_control).toEqual({ type: 'ephemeral' });
  });
});

describe('runAgentTurn — extraSystemContext', () => {
  it('appends it as a second system block when provided', async () => {
    const { anthropic, create } = fakeAnthropic([
      {
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'Привіт родині!' }],
      },
    ]);
    const mcp = fakeMcp();

    await runAgentTurn(
      anthropic,
      mcp as never,
      [],
      'привіт',
      'Це спільний сімейний чат.',
    );

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        system: [
          expect.objectContaining({ cache_control: { type: 'ephemeral' } }),
          { type: 'text', text: 'Це спільний сімейний чат.' },
        ],
      }),
    );
  });

  it('sends only the one cached system block when omitted (personal chat unchanged)', async () => {
    const { anthropic, create } = fakeAnthropic([
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Привіт!' }] },
    ]);
    const mcp = fakeMcp();

    await runAgentTurn(anthropic, mcp as never, [], 'привіт');

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        system: [
          expect.objectContaining({ cache_control: { type: 'ephemeral' } }),
        ],
      }),
    );
  });
});

describe('runAgentTurn — routing (the new dispatcher, not the aliased runFullToolLoopTurn above)', () => {
  const CART_CONTENT: Record<string, unknown> = {
    silpo_get_my_family: { members: [{}, {}] },
    silpo_get_my_food_restrictions: { restrictions: [] },
    silpo_get_my_shopping_cart: { shoppingCartId: 'cart-1' },
    silpo_get_shopping_cart_by_id: {
      cart: {
        deliveryType: 'WideAssortDelivery',
        timeslot: {
          start: '2026-08-24T11:00:00+00:00',
          end: '2026-08-24T13:00:00+00:00',
        },
        shipments: [{ branchId: 'branch-1', companyId: 'company-1' }],
      },
    },
  };

  function fakeRoutingMcp(
    searchQueries: { query: string; products: unknown[] }[] = [],
  ) {
    return {
      listTools: jest.fn().mockResolvedValue({ tools: [] }),
      callTool: jest.fn().mockImplementation(({ name }: { name: string }) => {
        if (name === 'silpo_find_products_batch') {
          return Promise.resolve({
            isError: false,
            structuredContent: { queries: searchQueries },
          });
        }
        return Promise.resolve({
          isError: false,
          structuredContent: CART_CONTENT[name],
        });
      }),
    };
  }

  function routerResponse(json: unknown) {
    return {
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: JSON.stringify(json) }],
    };
  }

  it('"clarify" route returns the question immediately — no plan/dish MCP calls', async () => {
    const { anthropic, create } = fakeAnthropic([
      routerResponse({ type: 'clarify', question: 'На скільки днів?' }),
    ]);
    const mcp = fakeRoutingMcp();

    const result = await dispatchAgentTurn(
      anthropic,
      mcp as never,
      [],
      'склади раціон',
    );

    expect(result.finalText).toBe('На скільки днів?');
    expect(create).toHaveBeenCalledTimes(1);
    expect(mcp.callTool).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: 'silpo_find_products_batch' }),
    );
  });

  it('"plan" route delegates to planMeals and returns dishes', async () => {
    const { anthropic } = fakeAnthropic([
      routerResponse({
        type: 'plan',
        days: 1,
        peopleOverride: null,
        budgetUah: 300,
        cuisine: 'українська',
        cookingStyle: 'daily',
        forChildren: false,
        notes: '',
      }),
      routerResponse({
        dishes: [
          {
            name: 'Борщ',
            description: 'Борщ',
            cuisine: 'українська',
            prepTimeMinutes: 90,
            daysCovered: 1,
            calories: 350,
            proteinGrams: 15,
            fatGrams: 12,
            carbsGrams: 40,
            ingredientNames: ['буряк'],
          },
        ],
      }),
      routerResponse({
        dishes: [
          {
            name: 'Борщ',
            picks: [
              {
                ingredient: 'буряк',
                productId: 'p1',
                quantityLabel: '300 г',
                cartQuantity: 0.3,
              },
            ],
          },
        ],
      }),
    ]);
    const mcp = fakeRoutingMcp([
      {
        query: 'буряк',
        products: [
          {
            id: 'p1',
            name: 'Буряк',
            price: 15,
            image: null,
            displayRatio: '100г',
            weighted: true,
            step: 0.5,
            stock: 10,
          },
        ],
      },
    ]);

    const result = await dispatchAgentTurn(
      anthropic,
      mcp as never,
      [],
      'склади раціон на 1 день',
    );

    expect(result.dishes).toHaveLength(1);
    expect(result.dishes?.[0].name).toBe('Борщ');
    expect(result.dishMessageIndex).toBe(result.history.length - 1);
  });

  it('"dish" route delegates to draftSingleDish then pickProductsAndAssemble and returns one dish', async () => {
    const { anthropic } = fakeAnthropic([
      routerResponse({ type: 'dish', dishName: 'Борщ', portions: 2 }),
      routerResponse({
        name: 'Борщ',
        description: 'Борщ',
        cuisine: 'українська',
        prepTimeMinutes: 90,
        daysCovered: 1,
        calories: 350,
        proteinGrams: 15,
        fatGrams: 12,
        carbsGrams: 40,
        ingredientNames: ['буряк'],
      }),
      routerResponse({
        dishes: [
          {
            name: 'Борщ',
            picks: [
              {
                ingredient: 'буряк',
                productId: 'p1',
                quantityLabel: '300 г',
                cartQuantity: 0.3,
              },
            ],
          },
        ],
      }),
    ]);
    const mcp = fakeRoutingMcp([
      {
        query: 'буряк',
        products: [
          {
            id: 'p1',
            name: 'Буряк',
            price: 15,
            image: null,
            displayRatio: '100г',
            weighted: true,
            step: 0.5,
            stock: 10,
          },
        ],
      },
    ]);

    const result = await dispatchAgentTurn(
      anthropic,
      mcp as never,
      [],
      'борщ, 2 порції',
    );

    expect(result.dishes).toHaveLength(1);
    expect(result.dishes?.[0].ingredients[0].productId).toBe('p1');
  });

  it('"fallback" route delegates to the full tool-loop', async () => {
    const { anthropic } = fakeAnthropic([
      routerResponse({ type: 'fallback', reason: 'occasion basket' }),
      {
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'Ось набір!' }],
      },
    ]);
    const mcp = fakeRoutingMcp();

    const result = await dispatchAgentTurn(
      anthropic,
      mcp as never,
      [],
      'збери набір на день народження',
    );

    expect(result.finalText).toBe('Ось набір!');
  });
});

describe('runAgentTurn — current date in system prompt', () => {
  it("prepends today's date to the cached system block — a local model once hallucinated a stale timeslot date without this", async () => {
    const { anthropic, create } = fakeAnthropic([
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Привіт!' }] },
    ]);
    const mcp = fakeMcp();

    await runAgentTurn(anthropic, mcp as never, [], 'привіт');

    const today = new Date().toISOString().slice(0, 10);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        system: [
          expect.objectContaining({
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest matcher typing
            text: expect.stringContaining(`Сьогоднішня дата: ${today}`),
          }),
        ],
      }),
    );
  });
});
