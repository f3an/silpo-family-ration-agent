import { planMeals } from './plan';
import type { PlanRequest } from './dishPlan.schema';
import type { LlmClient } from '../llm/llm.types';

function fakeProfile(overrides: Partial<PlanRequest> = {}): PlanRequest {
  return {
    sessionId: 'session-1',
    people: 2,
    days: 1,
    allergens: [],
    cuisine: 'українська',
    equipment: ['плита'],
    cookingStyle: 'daily',
    budgetUah: 500,
    notes: '',
    forChildren: false,
    familyChat: false,
    ...overrides,
  };
}

const CART_STRUCTURED_CONTENT: Record<string, unknown> = {
  silpo_get_my_shopping_cart: { success: true, shoppingCartId: 'cart-1' },
  silpo_get_shopping_cart_by_id: {
    success: true,
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

/** Resolves cart/cart-details deterministically, then whatever
 * `searchResults` says for every `silpo_find_products_batch` call after
 * that (queued, one array of queries per call — tests with one search call
 * only need one entry). */
function fakeMcp(
  searchResults: { query: string; products: unknown[] }[][] = [[]],
) {
  let searchCall = 0;
  return {
    callTool: jest.fn().mockImplementation(({ name }: { name: string }) => {
      if (name === 'silpo_find_products_batch') {
        return Promise.resolve({
          isError: false,
          structuredContent: { queries: searchResults[searchCall++] ?? [] },
        });
      }
      return Promise.resolve({
        isError: false,
        structuredContent: CART_STRUCTURED_CONTENT[name],
      });
    }),
  };
}

/** `planMeals` now makes exactly 2 `LlmClient.createMessage` calls (draft,
 * then pick) instead of a variable-length tool-use loop. */
function fakeLlm(responses: unknown[]) {
  let i = 0;
  const createMessage = jest
    .fn()
    .mockImplementation(() => Promise.resolve(responses[i++]));
  const llm = { createMessage } as unknown as LlmClient;
  return { llm, createMessage };
}

const DRAFT_RESPONSE = {
  stop_reason: 'end_turn',
  content: [
    {
      type: 'text',
      text: JSON.stringify({
        dishes: [
          {
            name: 'Куряче філе з рисом',
            description: 'Просто і швидко',
            cuisine: 'українська',
            prepTimeMinutes: 30,
            daysCovered: 1,
            calories: 450,
            proteinGrams: 35,
            fatGrams: 12,
            carbsGrams: 40,
            ingredientNames: ['куряче філе'],
          },
        ],
      }),
    },
  ],
};

const PICK_RESPONSE = {
  stop_reason: 'end_turn',
  content: [
    {
      type: 'text',
      text: JSON.stringify({
        dishes: [
          {
            name: 'Куряче філе з рисом',
            picks: [
              {
                ingredient: 'куряче філе',
                productId: 'p1',
                quantityLabel: '400 г',
                cartQuantity: 0.4,
              },
            ],
          },
        ],
      }),
    },
  ],
};

const SEARCH_RESULTS_FOR_CHICKEN = [
  [
    {
      query: 'куряче філе',
      products: [
        {
          id: 'p1',
          name: 'Куряче філе',
          price: 129.99,
          image: 'https://images.silpo.ua/example.png',
          displayRatio: '100г',
          weighted: true,
          step: 0.4,
          stock: 10,
        },
      ],
    },
  ],
];

describe('planMeals', () => {
  it('resolves delivery context, drafts dishes, searches products, and assembles the final Dish[]', async () => {
    const { llm, createMessage } = fakeLlm([DRAFT_RESPONSE, PICK_RESPONSE]);
    const mcp = fakeMcp(SEARCH_RESULTS_FOR_CHICKEN);

    const dishes = await planMeals(llm, mcp as never, fakeProfile());

    expect(createMessage).toHaveBeenCalledTimes(2);
    expect(dishes).toHaveLength(1);
    expect(dishes[0]).toEqual({
      name: 'Куряче філе з рисом',
      description: 'Просто і швидко',
      cuisine: 'українська',
      prepTimeMinutes: 30,
      daysCovered: 1,
      calories: 450,
      proteinGrams: 35,
      fatGrams: 12,
      carbsGrams: 40,
      ingredients: [
        {
          name: 'куряче філе',
          quantityLabel: '400 г',
          productId: 'p1',
          companyId: 'company-1',
          branchId: 'branch-1',
          cartQuantity: 0.4,
          imageUrl: 'https://images.silpo.ua/example.png',
        },
      ],
    });
  });

  it('sends no MCP tools on either LLM call, with cache_control on system and medium effort — no temperature for a real claude-* model (see modelCapabilities.ts)', async () => {
    const { llm, createMessage } = fakeLlm([DRAFT_RESPONSE, PICK_RESPONSE]);
    const mcp = fakeMcp(SEARCH_RESULTS_FOR_CHICKEN);

    await planMeals(llm, mcp as never, fakeProfile());

    for (const call of createMessage.mock.calls) {
      const params = (call as unknown[])[0] as {
        tools: unknown[];
        temperature?: number;
        system: { cache_control?: unknown }[];
        output_config: { effort?: string };
      };
      expect(params.tools).toEqual([]);
      expect(params.temperature).toBeUndefined();
      expect(params.system[0].cache_control).toEqual({ type: 'ephemeral' });
      expect(params.output_config.effort).toBe('medium');
    }
  });

  it('sends the draft call to draftLlm and the pick call to llm when they differ', async () => {
    const { llm, createMessage: pickCalls } = fakeLlm([PICK_RESPONSE]);
    const { llm: draftLlm, createMessage: draftCalls } = fakeLlm([
      DRAFT_RESPONSE,
    ]);
    const mcp = fakeMcp(SEARCH_RESULTS_FOR_CHICKEN);

    await planMeals(llm, mcp as never, fakeProfile(), draftLlm);

    expect(draftCalls).toHaveBeenCalledTimes(1);
    expect(pickCalls).toHaveBeenCalledTimes(1);
  });

  it('sets productId/companyId/branchId/cartQuantity to null when the model picks no product', async () => {
    const pickNullResponse = {
      stop_reason: 'end_turn',
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            dishes: [
              {
                name: 'Куряче філе з рисом',
                picks: [
                  {
                    ingredient: 'куряче філе',
                    productId: null,
                    quantityLabel: '1 шт',
                    cartQuantity: null,
                  },
                ],
              },
            ],
          }),
        },
      ],
    };
    const { llm } = fakeLlm([DRAFT_RESPONSE, pickNullResponse]);
    const mcp = fakeMcp(SEARCH_RESULTS_FOR_CHICKEN);

    const dishes = await planMeals(llm, mcp as never, fakeProfile());

    expect(dishes[0].ingredients[0]).toEqual({
      name: 'куряче філе',
      quantityLabel: '1 шт',
      productId: null,
      companyId: null,
      branchId: null,
      cartQuantity: null,
      imageUrl: null,
    });
  });

  it('throws when the delivery context cannot be resolved (no cart yet)', async () => {
    const { llm } = fakeLlm([DRAFT_RESPONSE, PICK_RESPONSE]);
    const mcp = {
      callTool: jest.fn().mockResolvedValue({
        isError: false,
        structuredContent: { success: false },
      }),
    };

    await expect(planMeals(llm, mcp as never, fakeProfile())).rejects.toThrow(
      /філію/,
    );
  });

  it('throws when the draft response text does not match the schema', async () => {
    const { llm } = fakeLlm([
      {
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: '{"dishes": [{"name": "х"}]}' }],
      },
    ]);
    const mcp = fakeMcp();

    await expect(planMeals(llm, mcp as never, fakeProfile())).rejects.toThrow();
  });

  it('throws a clear error when the draft response is truncated at max_tokens', async () => {
    const { llm } = fakeLlm([
      {
        stop_reason: 'max_tokens',
        content: [{ type: 'text', text: '{"dishes": [{"name": "неповний' }],
      },
    ]);
    const mcp = fakeMcp();

    await expect(planMeals(llm, mcp as never, fakeProfile())).rejects.toThrow(
      /max_tokens/,
    );
  });

  it('throws a clear error when the pick response is truncated at max_tokens', async () => {
    const { llm } = fakeLlm([
      DRAFT_RESPONSE,
      {
        stop_reason: 'max_tokens',
        content: [{ type: 'text', text: '{"dishes": [{"name": "неповний' }],
      },
    ]);
    const mcp = fakeMcp(SEARCH_RESULTS_FOR_CHICKEN);

    await expect(planMeals(llm, mcp as never, fakeProfile())).rejects.toThrow(
      /max_tokens/,
    );
  });
});
