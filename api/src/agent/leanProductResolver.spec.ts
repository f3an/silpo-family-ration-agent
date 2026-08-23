import {
  resolveDeliveryContext,
  searchIngredientCandidates,
  draftSingleDish,
  pickProductsAndAssemble,
  type DeliveryContext,
} from './leanProductResolver';
import type { DishDraft } from './dishPlan.schema';
import type { LlmClient } from '../llm/llm.types';

function fakeLlm(response: unknown) {
  const createMessage = jest.fn().mockResolvedValue(response);
  const llm = { createMessage } as unknown as LlmClient;
  return { llm, createMessage };
}

function textResponse(json: unknown) {
  return {
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: JSON.stringify(json) }],
  };
}

/** `jest.fn()` without an explicit generic infers `any` for `.mock.calls`,
 * which trips `no-unsafe-member-access` at every access site below — one
 * typed helper instead of an eslint-disable per call site. */
function callArg(
  mock: jest.Mock,
  callIndex: number,
): { arguments: { products: string[] } } {
  return (mock.mock.calls[callIndex] as unknown[])[0] as {
    arguments: { products: string[] };
  };
}

function fakeMcp(structuredContentByTool: Record<string, unknown>) {
  return {
    callTool: jest.fn().mockImplementation(({ name }: { name: string }) =>
      Promise.resolve({
        isError: false,
        structuredContent: structuredContentByTool[name],
      }),
    ),
  };
}

describe('resolveDeliveryContext', () => {
  it('resolves branchId/companyId/deliveryType/timeslot from the real nested cart shape', async () => {
    const mcp = fakeMcp({
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
    });

    const ctx = await resolveDeliveryContext(mcp as never);

    expect(ctx).toEqual<DeliveryContext>({
      branchId: 'branch-1',
      companyId: 'company-1',
      deliveryType: 'WideAssortDelivery',
      timeslotStart: '2026-08-24T11:00:00+00:00',
      timeslotEnd: '2026-08-24T13:00:00+00:00',
    });
    expect(mcp.callTool).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'silpo_get_shopping_cart_by_id',
        arguments: { shoppingCartId: 'cart-1' },
      }),
      expect.anything(),
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest matcher typing
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
  });

  it('returns null when the cart has no shoppingCartId', async () => {
    const mcp = fakeMcp({ silpo_get_my_shopping_cart: { success: false } });

    expect(await resolveDeliveryContext(mcp as never)).toBeNull();
  });

  it('returns null when the cart has no shipment yet', async () => {
    const mcp = fakeMcp({
      silpo_get_my_shopping_cart: { shoppingCartId: 'cart-1' },
      silpo_get_shopping_cart_by_id: {
        cart: {
          deliveryType: 'WideAssortDelivery',
          timeslot: null,
          shipments: [],
        },
      },
    });

    expect(await resolveDeliveryContext(mcp as never)).toBeNull();
  });
});

describe('searchIngredientCandidates', () => {
  const ctx: DeliveryContext = {
    branchId: 'branch-1',
    companyId: 'company-1',
    deliveryType: 'WideAssortDelivery',
    timeslotStart: '2026-08-24T11:00:00+00:00',
    timeslotEnd: '2026-08-24T13:00:00+00:00',
  };

  function fakeSearchMcp(
    queriesByCall: { query: string; products: unknown[] }[][],
  ) {
    let call = 0;
    return {
      callTool: jest.fn().mockImplementation(() =>
        Promise.resolve({
          isError: false,
          structuredContent: { queries: queriesByCall[call++] },
        }),
      ),
    };
  }

  it('dedupes ingredient names (case/whitespace-insensitive) before searching', async () => {
    const mcp = fakeSearchMcp([
      [
        {
          query: 'буряк',
          products: [
            {
              id: 'p1',
              name: 'Буряк',
              price: 10,
              image: null,
              displayRatio: null,
              weighted: true,
              step: 0.5,
              stock: 10,
            },
          ],
        },
      ],
    ]);

    const result = await searchIngredientCandidates(mcp as never, ctx, [
      'буряк',
      ' Буряк ',
      'БУРЯК',
    ]);

    expect(mcp.callTool).toHaveBeenCalledTimes(1);
    const call = callArg(mcp.callTool, 0);
    expect(call.arguments.products).toEqual(['буряк']);
    expect(result['буряк']).toHaveLength(1);
  });

  it('chunks at the 30-name-per-call cap', async () => {
    const names = Array.from({ length: 35 }, (_, i) => `ingredient-${i}`);
    const mcp = fakeSearchMcp([
      names.slice(0, 30).map((query) => ({ query, products: [] })),
      names.slice(30).map((query) => ({ query, products: [] })),
    ]);

    await searchIngredientCandidates(mcp as never, ctx, names);

    expect(mcp.callTool).toHaveBeenCalledTimes(2);
    const firstCall = callArg(mcp.callTool, 0);
    const secondCall = callArg(mcp.callTool, 1);
    expect(firstCall.arguments.products).toHaveLength(30);
    expect(secondCall.arguments.products).toHaveLength(5);
  });

  it('propagates a timeout/error from the underlying MCP call', async () => {
    const mcp = {
      callTool: jest.fn().mockRejectedValue(new Error('timed out')),
    };

    await expect(
      searchIngredientCandidates(mcp as never, ctx, ['буряк']),
    ).rejects.toThrow('timed out');
  });

  it('defaults to limit 30 per query', async () => {
    const mcp = fakeSearchMcp([[{ query: 'буряк', products: [] }]]);

    await searchIngredientCandidates(mcp as never, ctx, ['буряк']);

    const call = mcp.callTool.mock.calls[0] as unknown[];
    const params = call[0] as { arguments: { limit: number } };
    expect(params.arguments.limit).toBe(30);
  });

  it('retries a multi-word ingredient with zero candidates using just its first word', async () => {
    const realCabbage = {
      id: 'p1',
      name: 'Капуста білоголова',
      price: 20,
      image: null,
      displayRatio: null,
      weighted: true,
      step: 0.5,
      stock: 10,
    };
    const mcp = fakeSearchMcp([
      [{ query: 'капуста білокачанна', products: [] }],
      [{ query: 'капуста', products: [realCabbage] }],
    ]);

    const result = await searchIngredientCandidates(mcp as never, ctx, [
      'капуста білокачанна',
    ]);

    expect(mcp.callTool).toHaveBeenCalledTimes(2);
    const secondCall = callArg(mcp.callTool, 1);
    expect(secondCall.arguments.products).toEqual(['капуста']);
    expect(result['капуста білокачанна']).toEqual([
      {
        id: 'p1',
        name: 'Капуста білоголова',
        price: 20,
        image: null,
        displayRatio: null,
        weighted: true,
        step: 0.5,
        stock: 10,
      },
    ]);
  });

  it('does not retry a single-word ingredient that returns zero candidates', async () => {
    const mcp = fakeSearchMcp([[{ query: 'буряк', products: [] }]]);

    const result = await searchIngredientCandidates(mcp as never, ctx, [
      'буряк',
    ]);

    expect(mcp.callTool).toHaveBeenCalledTimes(1);
    expect(result['буряк']).toEqual([]);
  });

  it('leaves the ingredient empty when the fallback also finds nothing', async () => {
    const mcp = fakeSearchMcp([
      [{ query: 'капуста білокачанна', products: [] }],
      [{ query: 'капуста', products: [] }],
    ]);

    const result = await searchIngredientCandidates(mcp as never, ctx, [
      'капуста білокачанна',
    ]);

    expect(result['капуста білокачанна']).toEqual([]);
  });

  it('shares one fallback query across multiple multi-word ingredients with the same first word', async () => {
    const cabbage = {
      id: 'p1',
      name: 'Капуста',
      price: 20,
      image: null,
      displayRatio: null,
      weighted: true,
      step: 0.5,
      stock: 10,
    };
    const mcp = fakeSearchMcp([
      [
        { query: 'капуста білокачанна', products: [] },
        { query: 'капуста пекінська', products: [] },
      ],
      [{ query: 'капуста', products: [cabbage] }],
    ]);

    const result = await searchIngredientCandidates(mcp as never, ctx, [
      'капуста білокачанна',
      'капуста пекінська',
    ]);

    expect(mcp.callTool).toHaveBeenCalledTimes(2);
    const fallbackCall = callArg(mcp.callTool, 1);
    expect(fallbackCall.arguments.products).toEqual(['капуста']);
    expect(result['капуста білокачанна']).toHaveLength(1);
    expect(result['капуста пекінська']).toHaveLength(1);
  });
});

describe('draftSingleDish', () => {
  const VALID_DRAFT = {
    name: 'Борщ',
    description: 'Класичний борщ',
    cuisine: 'українська',
    prepTimeMinutes: 90,
    daysCovered: 1,
    calories: 250,
    proteinGrams: 8,
    fatGrams: 6,
    carbsGrams: 35,
    ingredientNames: ['буряк', 'капуста'],
  };

  it('parses a valid draft response', async () => {
    const { llm } = fakeLlm(textResponse(VALID_DRAFT));

    const draft = await draftSingleDish(llm, 'Борщ', 2, []);

    expect(draft).toEqual(VALID_DRAFT);
  });

  it('sends no MCP tools and no explicit temperature for a real claude-* model', async () => {
    const { llm, createMessage } = fakeLlm(textResponse(VALID_DRAFT));

    await draftSingleDish(llm, 'Борщ', 2, []);

    const params = (createMessage.mock.calls[0] as unknown[])[0] as {
      tools: unknown[];
      temperature?: number;
    };
    expect(params.tools).toEqual([]);
    expect(params.temperature).toBeUndefined();
  });

  it('includes the dish name, portions, and allergens in the prompt sent', async () => {
    const { llm, createMessage } = fakeLlm(textResponse(VALID_DRAFT));

    await draftSingleDish(llm, 'Борщ', 4, ['глютен', 'горіхи']);

    const params = (createMessage.mock.calls[0] as unknown[])[0] as {
      messages: { content: string }[];
    };
    expect(params.messages[0].content).toContain('Борщ');
    expect(params.messages[0].content).toContain('4');
    expect(params.messages[0].content).toContain('глютен');
    expect(params.messages[0].content).toContain('горіхи');
  });

  it('throws a clear error when the response is truncated at max_tokens', async () => {
    const { llm } = fakeLlm({
      stop_reason: 'max_tokens',
      content: [{ type: 'text', text: '{"name": "неповний' }],
    });

    await expect(draftSingleDish(llm, 'Борщ', 2, [])).rejects.toThrow(
      /max_tokens/,
    );
  });
});

describe('pickProductsAndAssemble', () => {
  const ctx: DeliveryContext = {
    branchId: 'branch-1',
    companyId: 'company-1',
    deliveryType: 'WideAssortDelivery',
    timeslotStart: '2026-08-24T11:00:00+00:00',
    timeslotEnd: '2026-08-24T13:00:00+00:00',
  };

  const draft: DishDraft = {
    name: 'Борщ',
    description: 'Борщ',
    cuisine: 'українська',
    prepTimeMinutes: 90,
    daysCovered: 1,
    calories: 350,
    proteinGrams: 15,
    fatGrams: 12,
    carbsGrams: 40,
    ingredientNames: ['буряк', 'капуста'],
  };

  /** Answers `silpo_find_products_batch` with one real-looking candidate
   * per requested ingredient — enough for the pick call(s) to have
   * something to choose from, regardless of how many candidates the model
   * is later asked (or re-asked) to pick from. */
  function fakeSearchMcp() {
    return {
      callTool: jest
        .fn()
        .mockImplementation(
          ({ arguments: args }: { arguments: { products: string[] } }) =>
            Promise.resolve({
              isError: false,
              structuredContent: {
                queries: args.products.map((query) => ({
                  query,
                  products: [
                    {
                      id: `p-${query}`,
                      name: query,
                      price: 10,
                      image: null,
                      displayRatio: null,
                      weighted: true,
                      step: 0.5,
                      stock: 10,
                    },
                  ],
                })),
              },
            }),
        ),
    };
  }

  function fakeQueuedLlm(responses: unknown[]) {
    let i = 0;
    const createMessage = jest
      .fn()
      .mockImplementation(() => Promise.resolve(responses[i++]));
    return { llm: { createMessage } as unknown as LlmClient, createMessage };
  }

  function pickResponse(
    picks: { ingredient: string; productId: string | null }[],
  ) {
    return textResponse({
      dishes: [
        {
          name: 'Борщ',
          picks: picks.map((p) => ({
            ...p,
            quantityLabel: '100 г',
            cartQuantity: p.productId ? 0.5 : null,
          })),
        },
      ],
    });
  }

  it('does not retry when the first pick response already covers every ingredient', async () => {
    const { llm, createMessage } = fakeQueuedLlm([
      pickResponse([
        { ingredient: 'буряк', productId: 'p-буряк' },
        { ingredient: 'капуста', productId: 'p-капуста' },
      ]),
    ]);

    const dishes = await pickProductsAndAssemble(
      llm,
      fakeSearchMcp() as never,
      ctx,
      [draft],
      2,
    );

    expect(createMessage).toHaveBeenCalledTimes(1);
    expect(dishes[0].ingredients.map((i) => i.productId)).toEqual([
      'p-буряк',
      'p-капуста',
    ]);
  });

  it('retries once, asking only for the ingredient the model skipped the first time', async () => {
    const { llm, createMessage } = fakeQueuedLlm([
      // First call: "капуста" silently missing from the response entirely
      // (not productId: null — genuinely absent), matching the real
      // non-deterministic Haiku behavior this retry targets.
      pickResponse([{ ingredient: 'буряк', productId: 'p-буряк' }]),
      pickResponse([{ ingredient: 'капуста', productId: 'p-капуста' }]),
    ]);

    const dishes = await pickProductsAndAssemble(
      llm,
      fakeSearchMcp() as never,
      ctx,
      [draft],
      2,
    );

    expect(createMessage).toHaveBeenCalledTimes(2);
    const retryParams = (createMessage.mock.calls[1] as unknown[])[0] as {
      messages: { content: string }[];
    };
    expect(retryParams.messages[0].content).toContain('капуста');
    expect(retryParams.messages[0].content).not.toContain('буряк');
    expect(dishes[0].ingredients.map((i) => i.productId)).toEqual([
      'p-буряк',
      'p-капуста',
    ]);
  });

  it('leaves an ingredient unresolved if the single retry also skips it — never loops further', async () => {
    const { llm, createMessage } = fakeQueuedLlm([
      pickResponse([{ ingredient: 'буряк', productId: 'p-буряк' }]),
      pickResponse([]), // retry also drops "капуста"
    ]);

    const dishes = await pickProductsAndAssemble(
      llm,
      fakeSearchMcp() as never,
      ctx,
      [draft],
      2,
    );

    expect(createMessage).toHaveBeenCalledTimes(2);
    expect(dishes[0].ingredients.map((i) => i.productId)).toEqual([
      'p-буряк',
      null,
    ]);
  });
});
