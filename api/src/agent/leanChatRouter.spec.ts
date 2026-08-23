import { resolveGuestSafetyContext, routeChatMessage } from './leanChatRouter';
import type { LlmClient } from '../llm/llm.types';

function fakeMcp(structuredContentByTool: Record<string, unknown> = {}) {
  return {
    callTool: jest.fn().mockImplementation(({ name }: { name: string }) =>
      Promise.resolve({
        isError: false,
        structuredContent: structuredContentByTool[name],
      }),
    ),
  };
}

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

describe('resolveGuestSafetyContext', () => {
  it('sums members + children for people, defaulting to 1 when the family is empty', async () => {
    const mcp = fakeMcp({
      silpo_get_my_family: { members: [{}, {}], children: [{}] },
      silpo_get_my_food_restrictions: { restrictions: [] },
    });

    expect(await resolveGuestSafetyContext(mcp as never)).toEqual({
      people: 3,
      allergens: [],
    });
  });

  it('defaults to 1 person when the family has no members/children', async () => {
    const mcp = fakeMcp({
      silpo_get_my_family: {},
      silpo_get_my_food_restrictions: {},
    });

    expect(await resolveGuestSafetyContext(mcp as never)).toEqual({
      people: 1,
      allergens: [],
    });
  });

  it('maps restrictions to their name, falling back to slug', async () => {
    const mcp = fakeMcp({
      silpo_get_my_family: { members: [{}] },
      silpo_get_my_food_restrictions: {
        restrictions: [
          { slug: 'gluten', name: 'Глютен' },
          { slug: 'nuts', name: null },
        ],
      },
    });

    expect(await resolveGuestSafetyContext(mcp as never)).toEqual({
      people: 1,
      allergens: ['Глютен', 'nuts'],
    });
  });
});

describe('routeChatMessage', () => {
  const safety = { people: 2, allergens: [] as string[] };

  it('parses a "plan" route', async () => {
    const { llm } = fakeLlm(
      textResponse({
        type: 'plan',
        days: 5,
        peopleOverride: null,
        budgetUah: 1500,
        cuisine: 'українська',
        cookingStyle: 'daily',
        forChildren: false,
        notes: '',
      }),
    );

    const route = await routeChatMessage(
      llm,
      [],
      'склади раціон на 5 днів',
      safety,
    );

    expect(route).toEqual({
      type: 'plan',
      days: 5,
      peopleOverride: null,
      budgetUah: 1500,
      cuisine: 'українська',
      cookingStyle: 'daily',
      forChildren: false,
      notes: '',
    });
  });

  it('parses a "dish" route', async () => {
    const dishRoute = {
      type: 'dish',
      dishName: 'Борщ з м’ясом',
      portions: 2,
    };
    const { llm } = fakeLlm(textResponse(dishRoute));

    const route = await routeChatMessage(
      llm,
      [],
      'борщ з м’ясом, 2 порції',
      safety,
    );

    expect(route).toEqual(dishRoute);
  });

  it('parses a "clarify" route', async () => {
    const { llm } = fakeLlm(
      textResponse({
        type: 'clarify',
        question: 'Який борщ — класичний чи пісний?',
      }),
    );

    const route = await routeChatMessage(llm, [], 'борщ', safety);

    expect(route).toEqual({
      type: 'clarify',
      question: 'Який борщ — класичний чи пісний?',
    });
  });

  it('parses a "fallback" route', async () => {
    const { llm } = fakeLlm(
      textResponse({ type: 'fallback', reason: 'occasion basket request' }),
    );

    const route = await routeChatMessage(
      llm,
      [],
      'збери набір на день народження',
      safety,
    );

    expect(route).toEqual({
      type: 'fallback',
      reason: 'occasion basket request',
    });
  });

  it('sends no MCP tools and passes prior history plus the new message natively', async () => {
    const { llm, createMessage } = fakeLlm(
      textResponse({ type: 'fallback', reason: 'x' }),
    );
    const history = [{ role: 'user' as const, content: 'привіт' }];

    await routeChatMessage(llm, history, 'нове повідомлення', safety);

    const params = (createMessage.mock.calls[0] as unknown[])[0] as {
      tools: unknown[];
      temperature?: number;
      messages: unknown[];
    };
    expect(params.tools).toEqual([]);
    // no explicit temperature for a real claude-* model (see modelCapabilities.ts)
    expect(params.temperature).toBeUndefined();
    expect(params.messages).toEqual([
      ...history,
      { role: 'user', content: 'нове повідомлення' },
    ]);
  });

  it('appends extraSystemContext as a second system block', async () => {
    const { llm, createMessage } = fakeLlm(
      textResponse({ type: 'fallback', reason: 'x' }),
    );

    await routeChatMessage(llm, [], 'привіт', safety, 'family chat context');

    const params = (createMessage.mock.calls[0] as unknown[])[0] as {
      system: { text: string }[];
    };
    expect(params.system[1].text).toBe('family chat context');
  });
});
