import type Anthropic from '@anthropic-ai/sdk';
import { AgentService } from './agent.service';
import type { McpService } from '../mcp/mcp.service';
import type { AnthropicService } from '../anthropic/anthropic.service';
import { UserPreferencesStore } from './userPreferences.service';
import type { DbService } from '../db/db.service';
import type { CacheService } from '../cache/cache.service';
import type { FamilyStore } from './family.service';
import type { DeliveryService } from './delivery.service';
import type { LlmClient } from '../llm/llm.types';
import type {
  ChatConversationStore,
  ChatWidget,
} from './chatConversation.service';

// sendMessage (the only thing exercised below) never touches preferences,
// family linking, or the cache — these stand-ins are just enough to satisfy
// the constructor. Family-specific tests build their own FamilyStore fake
// (see the AgentService — family chats describe block).
const fakePreferencesStore = () =>
  new UserPreferencesStore({} as unknown as DbService);
const fakeCache = () => ({}) as unknown as CacheService;
// None of the tests below exercise delivery — just enough to satisfy the
// constructor (see DeliveryService's own spec for real coverage, once it
// exists).
const fakeDeliveryService = () => ({}) as unknown as DeliveryService;
const fakeFamilyStore = () =>
  ({
    getFamilyIdForAccount: jest.fn(),
    sync: jest.fn(),
  }) as unknown as FamilyStore;

interface FakeConversation {
  id: string;
  title: string;
  messages: Anthropic.MessageParam[];
  widgets: ChatWidget[];
}

/** In-memory stand-in for ChatConversationStore, keyed by `accountId:id`. */
function fakeChatConversations() {
  const store = new Map<string, FakeConversation>();
  let counter = 0;

  return {
    get: jest.fn((accountId: string, id: string) => {
      const conv = store.get(`${accountId}:${id}`);
      return Promise.resolve(conv ? { ...conv } : undefined);
    }),
    create: jest.fn((accountId: string) => {
      counter += 1;
      const conv: FakeConversation = {
        id: `conv-${counter}`,
        title: 'Нова розмова',
        messages: [],
        widgets: [],
      };
      store.set(`${accountId}:${conv.id}`, conv);
      return Promise.resolve({ ...conv });
    }),
    saveMessages: jest.fn(
      (
        accountId: string,
        id: string,
        messages: Anthropic.MessageParam[],
        title?: string,
      ) => {
        const key = `${accountId}:${id}`;
        const existing = store.get(key);
        if (existing) {
          store.set(key, {
            ...existing,
            messages,
            title: title ?? existing.title,
          });
        }
        return Promise.resolve();
      },
    ),
    saveWidgets: jest.fn(
      (accountId: string, id: string, widgets: ChatWidget[]) => {
        const key = `${accountId}:${id}`;
        const existing = store.get(key);
        if (existing) store.set(key, { ...existing, widgets });
        return Promise.resolve();
      },
    ),
    list: jest.fn().mockResolvedValue([]),
    remove: jest.fn().mockResolvedValue(undefined),
  };
}

/**
 * `runAgentTurn` mutates its `messages` array in place (push) across the
 * whole conversation, so a plain jest mock's `mock.calls` — which stores a
 * live reference, not a copy — would show every call's argument as the
 * FINAL state of the array, not its state at call-time. `callSnapshots`
 * deep-clones `messages` the moment `create` is invoked so assertions see
 * what was actually sent to the API on each turn.
 */
/** `runAgentTurn` (run.ts) now always makes a lean router call first (see
 * leanChatRouter.ts) before anything else — every test in this file that
 * exercises `sendMessage`/`sendFamilyMessage`/`retryLastMessage` predates
 * that and queues responses for what used to be the very first call into
 * the old tool-loop directly. Rather than manually interleaving a router
 * response into every queue below (fragile — a test can invoke sendMessage
 * more than once, each needing its own router call), detect a router call
 * by its telltale empty `tools` array (leanChatRouter.ts/plan.ts always
 * pass `tools: []`; the old tool-loop never does) and answer it with a
 * 'fallback' route automatically, leaving `responses` free to mean exactly
 * what it always did: the old loop's own call sequence for that turn. This
 * file tests AgentService's own persistence/widget/title/retry logic, not
 * run.ts's routing decision, which has its own dedicated tests
 * (leanChatRouter.spec.ts, run.spec.ts). */
const FALLBACK_ROUTE_RESPONSE = {
  stop_reason: 'end_turn',
  content: [
    {
      type: 'text',
      text: JSON.stringify({
        type: 'fallback',
        reason: 'agent.service.spec.ts exercises the old tool-loop directly',
      }),
    },
  ],
};

function fakeAnthropicService(responses: unknown[]) {
  const callSnapshots: Array<{ messages: unknown[] }> = [];
  let i = 0;
  // run.ts/plan.ts call `llm.createMessage(params)` directly now (see
  // llm/llm.types.ts) — see plan.spec.ts/run.spec.ts's fakeAnthropic for
  // the same pattern.
  const createMessage = jest.fn(
    (params: { messages: unknown[]; tools: unknown[] }) => {
      callSnapshots.push({
        messages: JSON.parse(JSON.stringify(params.messages)) as unknown[],
      });
      if (params.tools.length === 0) {
        return Promise.resolve(FALLBACK_ROUTE_RESPONSE);
      }
      return Promise.resolve(responses[i++]);
    },
  );
  const client = { createMessage } as unknown as LlmClient;
  const anthropicService = {
    getClient: () => client,
    // Same client for both — draft-model split is a separate opt-in
    // (LOCAL_DRAFT_LLM_MODEL, see anthropic.service.ts) this file doesn't
    // exercise; every test here only cares that *some* client is used.
    getDraftClient: () => client,
  } as unknown as AnthropicService;
  return { anthropicService, callSnapshots };
}

function fakeMcpService(accountId = 'acc-1') {
  const client = {
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
  };
  const mcpService = {
    getClient: () => client,
    getClientForSession: jest.fn().mockResolvedValue(client),
    getAccountId: jest.fn().mockResolvedValue(accountId),
  } as unknown as McpService;
  return { mcpService, client };
}

describe('AgentService.sendMessage', () => {
  it("runs the tool-use loop: calls the MCP tool Claude asked for, then returns Claude's final text", async () => {
    const toolUseResponse = {
      stop_reason: 'tool_use',
      content: [
        {
          type: 'tool_use',
          id: 'toolu_1',
          name: 'silpo_get_my_family',
          input: {},
        },
      ],
    };
    const finalResponse = {
      stop_reason: 'end_turn',
      content: [
        {
          type: 'text',
          text: "У вас немає збереженої сім'ї — розкажи склад, і я побудую раціон.",
        },
      ],
    };
    const { anthropicService, callSnapshots } = fakeAnthropicService([
      toolUseResponse,
      finalResponse,
    ]);
    const { mcpService, client } = fakeMcpService();
    const service = new AgentService(
      mcpService,
      anthropicService,
      fakePreferencesStore(),
      fakeChatConversations() as unknown as ChatConversationStore,
      fakeFamilyStore(),
      fakeCache(),
      fakeDeliveryService(),
    );

    const result = await service.sendMessage('session-1', "хто в моїй сім'ї?");

    expect(result.reply).toBe(
      "У вас немає збереженої сім'ї — розкажи склад, і я побудую раціон.",
    );
    expect(client.callTool).toHaveBeenCalledWith(
      { name: 'silpo_get_my_family', arguments: {} },
      expect.anything(),
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest matcher typing
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
    // router call + tool_use call + final call
    expect(callSnapshots).toHaveLength(3);
  });

  it('starts a new conversation and auto-titles it from the first message', async () => {
    const { anthropicService } = fakeAnthropicService([
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Привіт!' }] },
    ]);
    const { mcpService } = fakeMcpService();
    const chatConversations = fakeChatConversations();
    const service = new AgentService(
      mcpService,
      anthropicService,
      fakePreferencesStore(),
      chatConversations as unknown as ChatConversationStore,
      fakeFamilyStore(),
      fakeCache(),
      fakeDeliveryService(),
    );

    const result = await service.sendMessage('session-1', 'привіт всім');

    expect(result.conversationId).toBeTruthy();
    expect(result.title).toBe('привіт всім');
    expect(chatConversations.create).toHaveBeenCalledTimes(1);
  });

  it('keeps conversation history across turns within the same conversation', async () => {
    const { anthropicService, callSnapshots } = fakeAnthropicService([
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Привіт!' }] },
      {
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: "Твоє ім'я мені ще невідоме." }],
      },
    ]);
    const { mcpService } = fakeMcpService();
    const service = new AgentService(
      mcpService,
      anthropicService,
      fakePreferencesStore(),
      fakeChatConversations() as unknown as ChatConversationStore,
      fakeFamilyStore(),
      fakeCache(),
      fakeDeliveryService(),
    );

    const first = await service.sendMessage('session-2', 'привіт');
    await service.sendMessage(
      'session-2',
      'як мене звати?',
      first.conversationId,
    );

    // snapshots: [0]=turn1 router, [1]=turn1 old-loop call, [2]=turn2
    // router, [3]=turn2 old-loop call — user(1) + assistant(1) + user(2) =
    // 3 messages sent on that last one.
    expect(callSnapshots[3].messages).toHaveLength(3);
  });

  it('isolates history between different conversations', async () => {
    const { anthropicService, callSnapshots } = fakeAnthropicService([
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'A' }] },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'B' }] },
    ]);
    const { mcpService } = fakeMcpService();
    const service = new AgentService(
      mcpService,
      anthropicService,
      fakePreferencesStore(),
      fakeChatConversations() as unknown as ChatConversationStore,
      fakeFamilyStore(),
      fakeCache(),
      fakeDeliveryService(),
    );

    await service.sendMessage('session-a', 'перше повідомлення');
    await service.sendMessage('session-a', 'інша розмова, без conversationId');

    // snapshots: [0]=turn1 router, [1]=turn1 old-loop call, [2]=turn2
    // router, [3]=turn2 old-loop call — a fresh conversation each time, so
    // just the one user message.
    expect(callSnapshots[3].messages).toHaveLength(1);
  });

  it('rejects a conversationId that does not belong to this account', async () => {
    const { anthropicService } = fakeAnthropicService([]);
    const { mcpService } = fakeMcpService();
    const service = new AgentService(
      mcpService,
      anthropicService,
      fakePreferencesStore(),
      fakeChatConversations() as unknown as ChatConversationStore,
      fakeFamilyStore(),
      fakeCache(),
      fakeDeliveryService(),
    );

    await expect(
      service.sendMessage('session-1', 'привіт', 'no-such-conversation'),
    ).rejects.toThrow();
  });

  it('returns and persists a dish_plan widget when the agent finalizes with propose_dish_card', async () => {
    const dish = {
      name: 'Борщ класичний',
      description: 'Традиційний борщ',
      cuisine: 'українська',
      prepTimeMinutes: 90,
      daysCovered: 1,
      calories: 350,
      proteinGrams: 15,
      fatGrams: 12,
      carbsGrams: 40,
      ingredients: [],
    };
    const { anthropicService } = fakeAnthropicService([
      {
        stop_reason: 'tool_use',
        content: [
          { type: 'text', text: 'Ось картка борщу:' },
          {
            type: 'tool_use',
            id: 'toolu_1',
            name: 'propose_dish_card',
            input: dish,
          },
        ],
      },
    ]);
    const { mcpService } = fakeMcpService();
    const chatConversations = fakeChatConversations();
    const service = new AgentService(
      mcpService,
      anthropicService,
      fakePreferencesStore(),
      chatConversations as unknown as ChatConversationStore,
      fakeFamilyStore(),
      fakeCache(),
      fakeDeliveryService(),
    );

    const result = await service.sendMessage('session-1', 'борщ на 4 порції');

    expect(result.widgets).toEqual([
      {
        messageIndex: 1,
        kind: 'dish_plan',
        dishes: [dish],
      },
    ]);
    expect(chatConversations.saveWidgets).toHaveBeenCalledWith(
      'acc-1',
      result.conversationId,
      result.widgets,
    );
  });

  it('returns and persists an occasion_basket widget when the agent finalizes with propose_occasion_basket', async () => {
    const basket = {
      theme: 'День народження на 8 осіб',
      description: 'Набір для святкового столу',
      guestCount: 8,
      items: [],
    };
    const { anthropicService } = fakeAnthropicService([
      {
        stop_reason: 'tool_use',
        content: [
          { type: 'text', text: 'Ось набір на день народження:' },
          {
            type: 'tool_use',
            id: 'toolu_1',
            name: 'propose_occasion_basket',
            input: basket,
          },
        ],
      },
    ]);
    const { mcpService } = fakeMcpService();
    const chatConversations = fakeChatConversations();
    const service = new AgentService(
      mcpService,
      anthropicService,
      fakePreferencesStore(),
      chatConversations as unknown as ChatConversationStore,
      fakeFamilyStore(),
      fakeCache(),
      fakeDeliveryService(),
    );

    const result = await service.sendMessage(
      'session-1',
      'набір на день народження на 8 осіб',
    );

    expect(result.widgets).toEqual([
      {
        messageIndex: 1,
        kind: 'occasion_basket',
        basket,
      },
    ]);
    expect(chatConversations.saveWidgets).toHaveBeenCalledWith(
      'acc-1',
      result.conversationId,
      result.widgets,
    );
  });

  it('returns and persists an ingredient_options widget when the agent finalizes with propose_ingredient_options', async () => {
    const options = [
      {
        label: 'Креветки «Премія» очищені варено-морожені',
        note: 'майже 1:1 заміна',
        quantityLabel: '250 г',
        price: 309,
        productId: 'p1',
        companyId: 'c1',
        branchId: 'b1',
        cartQuantity: 1,
        imageUrl: null,
      },
    ];
    const { anthropicService } = fakeAnthropicService([
      {
        stop_reason: 'tool_use',
        content: [
          { type: 'text', text: 'Ось варіанти заміни:' },
          {
            type: 'tool_use',
            id: 'toolu_1',
            name: 'propose_ingredient_options',
            input: { ingredientName: 'Креветки з часником', options },
          },
        ],
      },
    ]);
    const { mcpService } = fakeMcpService();
    const chatConversations = fakeChatConversations();
    const service = new AgentService(
      mcpService,
      anthropicService,
      fakePreferencesStore(),
      chatConversations as unknown as ChatConversationStore,
      fakeFamilyStore(),
      fakeCache(),
      fakeDeliveryService(),
    );

    const result = await service.sendMessage(
      'session-1',
      'заміни креветки з часником',
    );

    expect(result.widgets).toEqual([
      {
        messageIndex: 1,
        kind: 'ingredient_options',
        ingredientName: 'Креветки з часником',
        options,
      },
    ]);
    expect(chatConversations.saveWidgets).toHaveBeenCalledWith(
      'acc-1',
      result.conversationId,
      result.widgets,
    );
  });
});

describe('AgentService.retryLastMessage', () => {
  it('drops the last turn (reply + widget) and re-runs it, without duplicating the earlier turns', async () => {
    const { anthropicService } = fakeAnthropicService([
      {
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'Привіт!' }],
      },
      {
        stop_reason: 'tool_use',
        content: [
          { type: 'text', text: 'Ось краща відповідь:' },
          {
            type: 'tool_use',
            id: 'toolu_1',
            name: 'propose_dish_card',
            input: {
              name: 'Борщ',
              description: 'Смачний',
              cuisine: 'українська',
              prepTimeMinutes: 60,
              daysCovered: 1,
              calories: 300,
              proteinGrams: 10,
              fatGrams: 10,
              carbsGrams: 30,
              ingredients: [],
            },
          },
        ],
      },
    ]);
    const { mcpService } = fakeMcpService();
    const chatConversations = fakeChatConversations();
    const service = new AgentService(
      mcpService,
      anthropicService,
      fakePreferencesStore(),
      chatConversations as unknown as ChatConversationStore,
      fakeFamilyStore(),
      fakeCache(),
      fakeDeliveryService(),
    );

    // First turn: guest says "привіт", agent replies plainly. This is the
    // "bad" turn we'll retry.
    const first = await service.sendMessage('session-1', 'привіт');
    expect(first.reply).toBe('Привіт!');

    const retried = await service.retryLastMessage(
      'session-1',
      first.conversationId,
    );

    expect(retried.reply).toBe('Ось краща відповідь:');
    expect(retried.widgets).toEqual([
      {
        messageIndex: 1,
        kind: 'dish_plan',
        dishes: [expect.objectContaining({ name: 'Борщ' })],
      },
    ]);

    // The conversation now has the user turn + the new tool-use round —
    // not the old "Привіт!" reply still sitting there alongside the new one.
    const stored = await chatConversations.get('acc-1', first.conversationId);
    expect(stored!.messages).toHaveLength(3);
    expect(stored!.messages[0]).toEqual({ role: 'user', content: 'привіт' });
    expect(stored!.widgets).toEqual(retried.widgets);

    // Before calling the model again, retryLastMessage must persist an
    // interim state that still has the guest's own message — dropping it
    // too (even briefly, while the retry itself runs) would mean a reload
    // during a slow retry sees an empty conversation instead of "the
    // question, minus the bad reply".
    const [, , interimMessages] = chatConversations.saveMessages.mock
      .calls[1] as [string, string, unknown];
    expect(interimMessages).toEqual([{ role: 'user', content: 'привіт' }]);
  });

  it('throws when the conversation has nothing to retry', async () => {
    const { anthropicService } = fakeAnthropicService([]);
    const { mcpService } = fakeMcpService();
    const chatConversations = fakeChatConversations();
    const created = await chatConversations.create('acc-1');
    const service = new AgentService(
      mcpService,
      anthropicService,
      fakePreferencesStore(),
      chatConversations as unknown as ChatConversationStore,
      fakeFamilyStore(),
      fakeCache(),
      fakeDeliveryService(),
    );

    await expect(
      service.retryLastMessage('session-1', created.id),
    ).rejects.toThrow();
  });
});

describe('AgentService — family chats', () => {
  it('sendFamilyMessage rejects with Forbidden when the account has no linked family', async () => {
    const { mcpService } = fakeMcpService('acc-1');
    const familyStore = {
      getFamilyIdForAccount: jest.fn().mockResolvedValue(undefined),
      sync: jest.fn(),
    } as unknown as FamilyStore;
    const service = new AgentService(
      mcpService,
      fakeAnthropicService([]).anthropicService,
      fakePreferencesStore(),
      fakeChatConversations() as unknown as ChatConversationStore,
      familyStore,
      fakeCache(),
      fakeDeliveryService(),
    );

    await expect(
      service.sendFamilyMessage('session-1', 'привіт'),
    ).rejects.toThrow(/family/i);
  });

  it('sendFamilyMessage stores the conversation under the familyId, not the accountId', async () => {
    const { mcpService } = fakeMcpService('acc-1');
    const { anthropicService } = fakeAnthropicService([
      {
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'Привіт родині!' }],
      },
    ]);
    const chatConversations = fakeChatConversations();
    const familyStore = {
      getFamilyIdForAccount: jest.fn().mockResolvedValue('fam-1'),
      sync: jest.fn(),
    } as unknown as FamilyStore;
    const service = new AgentService(
      mcpService,
      anthropicService,
      fakePreferencesStore(),
      chatConversations as unknown as ChatConversationStore,
      familyStore,
      fakeCache(),
      fakeDeliveryService(),
    );

    const result = await service.sendFamilyMessage('session-1', 'привіт');

    expect(result.reply).toBe('Привіт родині!');
    expect(chatConversations.create).toHaveBeenCalledWith('fam-1');
    expect(chatConversations.saveMessages).toHaveBeenCalledWith(
      'fam-1',
      result.conversationId,
      expect.anything(),
      expect.anything(),
    );
  });

  it('a second family member (different accountId, same familyId) sees the same family conversation', async () => {
    const chatConversations = fakeChatConversations();
    const familyStore = {
      getFamilyIdForAccount: jest.fn().mockResolvedValue('fam-1'),
      sync: jest.fn(),
    } as unknown as FamilyStore;

    const { mcpService: mcpA } = fakeMcpService('acc-a');
    const serviceA = new AgentService(
      mcpA,
      fakeAnthropicService([
        {
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: 'Привіт від A' }],
        },
      ]).anthropicService,
      fakePreferencesStore(),
      chatConversations as unknown as ChatConversationStore,
      familyStore,
      fakeCache(),
      fakeDeliveryService(),
    );
    const sent = await serviceA.sendFamilyMessage('session-a', 'привіт від A');

    const { mcpService: mcpB } = fakeMcpService('acc-b');
    const serviceB = new AgentService(
      mcpB,
      fakeAnthropicService([]).anthropicService,
      fakePreferencesStore(),
      chatConversations as unknown as ChatConversationStore,
      familyStore,
      fakeCache(),
      fakeDeliveryService(),
    );
    const seen = await serviceB.getFamilyChat('session-b', sent.conversationId);

    expect(seen.id).toBe(sent.conversationId);
  });

  it('listFamilyChats/getFamilyChat/deleteFamilyChat all reject when not linked to a family', async () => {
    const { mcpService } = fakeMcpService('acc-1');
    const familyStore = {
      getFamilyIdForAccount: jest.fn().mockResolvedValue(undefined),
      sync: jest.fn(),
    } as unknown as FamilyStore;
    const service = new AgentService(
      mcpService,
      fakeAnthropicService([]).anthropicService,
      fakePreferencesStore(),
      fakeChatConversations() as unknown as ChatConversationStore,
      familyStore,
      fakeCache(),
      fakeDeliveryService(),
    );

    await expect(service.listFamilyChats('session-1')).rejects.toThrow();
    await expect(
      service.getFamilyChat('session-1', 'conv-1'),
    ).rejects.toThrow();
    await expect(
      service.deleteFamilyChat('session-1', 'conv-1'),
    ).rejects.toThrow();
  });

  it("getFamily delegates to FamilyStore.sync with this session's account and MCP client", async () => {
    const { mcpService, client } = fakeMcpService('acc-1');
    const familyInfo = {
      familyId: 'fam-1',
      members: [
        {
          accountId: 'acc-1',
          name: 'Ігор',
          phone: '38095*****06',
          itsMe: true,
        },
      ],
    };
    const sync = jest.fn().mockResolvedValue(familyInfo);
    const familyStore = {
      getFamilyIdForAccount: jest.fn(),
      sync,
    } as unknown as FamilyStore;
    const service = new AgentService(
      mcpService,
      fakeAnthropicService([]).anthropicService,
      fakePreferencesStore(),
      fakeChatConversations() as unknown as ChatConversationStore,
      familyStore,
      fakeCache(),
      fakeDeliveryService(),
    );

    await expect(service.getFamily('session-1')).resolves.toEqual(familyInfo);
    expect(sync).toHaveBeenCalledWith(client, 'acc-1');
  });
});

describe('AgentService chat history', () => {
  it('listChats resolves the account id and delegates to the store', async () => {
    const { mcpService } = fakeMcpService('acc-1');
    const chatConversations = fakeChatConversations();
    const service = new AgentService(
      mcpService,
      fakeAnthropicService([]).anthropicService,
      fakePreferencesStore(),
      chatConversations as unknown as ChatConversationStore,
      fakeFamilyStore(),
      fakeCache(),
      fakeDeliveryService(),
    );

    await service.listChats('session-1');

    expect(chatConversations.list).toHaveBeenCalledWith('acc-1');
  });

  it('getChat collapses tool round-trips into a plain transcript', async () => {
    const { anthropicService } = fakeAnthropicService([
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
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'Відповідь' }],
      },
    ]);
    const { mcpService } = fakeMcpService();
    const service = new AgentService(
      mcpService,
      anthropicService,
      fakePreferencesStore(),
      fakeChatConversations() as unknown as ChatConversationStore,
      fakeFamilyStore(),
      fakeCache(),
      fakeDeliveryService(),
    );

    const sent = await service.sendMessage('session-1', 'привіт');
    const chat = await service.getChat('session-1', sent.conversationId);

    expect(chat.messages).toEqual([
      { role: 'user', text: 'привіт' },
      { role: 'assistant', text: 'Відповідь' },
    ]);
  });

  it('deleteChat resolves the account id and delegates to the store', async () => {
    const { mcpService } = fakeMcpService('acc-1');
    const chatConversations = fakeChatConversations();
    const service = new AgentService(
      mcpService,
      fakeAnthropicService([]).anthropicService,
      fakePreferencesStore(),
      chatConversations as unknown as ChatConversationStore,
      fakeFamilyStore(),
      fakeCache(),
      fakeDeliveryService(),
    );

    await service.deleteChat('session-1', 'conv-1');

    expect(chatConversations.remove).toHaveBeenCalledWith('acc-1', 'conv-1');
  });
});

jest.mock('./plan', () => ({ planMeals: jest.fn() }));
import { planMeals as planMealsFn } from './plan';
import type { Dish, PlanRequest } from './dishPlan.schema';

const mockPlanMeals = planMealsFn as jest.MockedFunction<typeof planMealsFn>;

function fakePlanProfile(overrides: Partial<PlanRequest> = {}): PlanRequest {
  return {
    sessionId: 'session-1',
    people: 2,
    days: 3,
    allergens: [],
    cuisine: 'українська',
    equipment: ['плита'],
    cookingStyle: 'daily',
    budgetUah: 1500,
    notes: '',
    forChildren: false,
    familyChat: false,
    ...overrides,
  };
}

// Not typed as CacheService (whose `set` is a real class method) so
// `cache.set` reads as a plain jest.fn() property in assertions, not an
// unbound method reference.
function fakeCacheWithStore() {
  const store = new Map<string, unknown>();
  return {
    get: jest.fn((key: string) => Promise.resolve(store.get(key))),
    set: jest.fn((key: string, value: unknown) => {
      store.set(key, value);
      return Promise.resolve();
    }),
  };
}

const FAKE_DISHES = [{ name: 'Борщ' } as unknown as Dish];

describe('AgentService.planMeals caching', () => {
  beforeEach(() => {
    mockPlanMeals.mockReset();
    mockPlanMeals.mockResolvedValue(FAKE_DISHES);
  });

  function fakePlanMcpService() {
    return {
      getAccountId: jest.fn().mockResolvedValue('acc-1'),
      getClientForSession: jest.fn().mockResolvedValue({}),
    } as unknown as McpService;
  }

  function fakePlanAnthropicService() {
    return {
      getClient: () => ({}),
      getDraftClient: () => ({}),
    } as unknown as AnthropicService;
  }

  it('calls through to plan.ts on a cache miss and stores the result', async () => {
    const cache = fakeCacheWithStore();
    const service = new AgentService(
      fakePlanMcpService(),
      fakePlanAnthropicService(),
      fakePreferencesStore(),
      fakeChatConversations() as unknown as ChatConversationStore,
      fakeFamilyStore(),
      cache as unknown as CacheService,
      fakeDeliveryService(),
    );

    const result = await service.planMeals(fakePlanProfile());

    expect(result.dishes).toEqual(FAKE_DISHES);
    expect(result.conversationId).toBeTruthy();
    expect(mockPlanMeals).toHaveBeenCalledTimes(1);
    expect(cache.set).toHaveBeenCalledTimes(1);
  });

  it('familyChat: true files the card under the family conversation instead of the personal one', async () => {
    const chatConversations = fakeChatConversations();
    const familyStore = {
      getFamilyIdForAccount: jest.fn().mockResolvedValue('fam-1'),
      sync: jest.fn(),
    } as unknown as FamilyStore;
    const service = new AgentService(
      fakePlanMcpService(),
      fakePlanAnthropicService(),
      fakePreferencesStore(),
      chatConversations as unknown as ChatConversationStore,
      familyStore,
      fakeCacheWithStore() as unknown as CacheService,
      fakeDeliveryService(),
    );

    await service.planMeals(fakePlanProfile({ familyChat: true }));

    expect(chatConversations.create).toHaveBeenCalledWith('fam-1');
  });

  it('familyChat: true rejects when this account has no linked family', async () => {
    const service = new AgentService(
      fakePlanMcpService(),
      fakePlanAnthropicService(),
      fakePreferencesStore(),
      fakeChatConversations() as unknown as ChatConversationStore,
      fakeFamilyStore(),
      fakeCacheWithStore() as unknown as CacheService,
      fakeDeliveryService(),
    );

    await expect(
      service.planMeals(fakePlanProfile({ familyChat: true })),
    ).rejects.toThrow();
  });

  it('appends a turn and a dish_plan widget to the conversation, on a cache hit or miss alike', async () => {
    const cache = fakeCacheWithStore();
    const chatConversations = fakeChatConversations();
    const service = new AgentService(
      fakePlanMcpService(),
      fakePlanAnthropicService(),
      fakePreferencesStore(),
      chatConversations as unknown as ChatConversationStore,
      fakeFamilyStore(),
      cache as unknown as CacheService,
      fakeDeliveryService(),
    );

    const first = await service.planMeals(fakePlanProfile());
    expect(first.title).toBeTruthy();
    expect(first.requestText).toContain('2 осіб');
    expect(first.summaryText).toContain('Борщ');

    // A second plan in the SAME conversation is a cache hit (identical
    // profile) but must still land as a new turn+widget, not be skipped.
    const second = await service.planMeals(
      fakePlanProfile({ conversationId: first.conversationId }),
    );
    expect(second.conversationId).toBe(first.conversationId);

    const stored = await chatConversations.get('acc-1', first.conversationId);
    expect(stored?.widgets).toHaveLength(2);
    expect(stored?.widgets.every((w) => w.kind === 'dish_plan')).toBe(true);
  });

  it('returns the cached result on a hit, without calling plan.ts again', async () => {
    const cache = fakeCacheWithStore();
    const service = new AgentService(
      fakePlanMcpService(),
      fakePlanAnthropicService(),
      fakePreferencesStore(),
      fakeChatConversations() as unknown as ChatConversationStore,
      fakeFamilyStore(),
      cache as unknown as CacheService,
      fakeDeliveryService(),
    );

    await service.planMeals(fakePlanProfile());
    await service.planMeals(fakePlanProfile());

    expect(mockPlanMeals).toHaveBeenCalledTimes(1);
  });

  it('does not share a cache entry across different accounts', async () => {
    const cache = fakeCacheWithStore();
    const mcpAccA = {
      getAccountId: jest.fn().mockResolvedValue('acc-a'),
      getClientForSession: jest.fn().mockResolvedValue({}),
    } as unknown as McpService;
    const mcpAccB = {
      getAccountId: jest.fn().mockResolvedValue('acc-b'),
      getClientForSession: jest.fn().mockResolvedValue({}),
    } as unknown as McpService;
    const serviceA = new AgentService(
      mcpAccA,
      fakePlanAnthropicService(),
      fakePreferencesStore(),
      fakeChatConversations() as unknown as ChatConversationStore,
      fakeFamilyStore(),
      cache as unknown as CacheService,
      fakeDeliveryService(),
    );
    const serviceB = new AgentService(
      mcpAccB,
      fakePlanAnthropicService(),
      fakePreferencesStore(),
      fakeChatConversations() as unknown as ChatConversationStore,
      fakeFamilyStore(),
      cache as unknown as CacheService,
      fakeDeliveryService(),
    );

    await serviceA.planMeals(fakePlanProfile());
    await serviceB.planMeals(fakePlanProfile());

    expect(mockPlanMeals).toHaveBeenCalledTimes(2);
  });
});
