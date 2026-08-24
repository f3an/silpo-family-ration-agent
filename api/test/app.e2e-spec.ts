import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { McpService } from '../src/mcp/mcp.service';
import { AnthropicService } from '../src/anthropic/anthropic.service';
import { ChatConversationStore } from '../src/agent/chatConversation.service';

/**
 * Exercises the real HTTP pipeline (routing, body parsing, controller,
 * DI-wired service) end to end, with McpService, AnthropicService and
 * ChatConversationStore swapped for fakes — no real Silpo OAuth, Claude API
 * calls, or Postgres connection in CI.
 */
describe('AppController / AgentController (e2e)', () => {
  let app: INestApplication<App>;

  // runAgentTurn (run.ts) resolves this BEFORE routing, for every turn —
  // see leanChatRouter.ts's resolveGuestSafetyContext.
  const fakeMcpClient = {
    listTools: jest.fn().mockResolvedValue({ tools: [] }),
    callTool: jest.fn().mockImplementation(({ name }: { name: string }) => {
      if (name === 'silpo_get_my_family') {
        return Promise.resolve({
          isError: false,
          structuredContent: { members: [], children: [] },
        });
      }
      if (name === 'silpo_get_my_food_restrictions') {
        return Promise.resolve({
          isError: false,
          structuredContent: { restrictions: [] },
        });
      }
      return Promise.resolve({ isError: false, structuredContent: {} });
    }),
  };
  const fakeMcpService = {
    getClient: () => fakeMcpClient,
    getClientForSession: () => Promise.resolve(fakeMcpClient),
    getAccountId: () => Promise.resolve('e2e-account'),
  };

  // run.ts calls `llm.createMessage(params)` twice per turn now: first
  // leanChatRouter.ts's routing call (asks for structured ChatRoute JSON —
  // detected here via `output_config.format`, which only that call sets),
  // then the real reply — for a plain "привіт" with no MCP tools/plan/dish
  // signal, the router picks 'fallback', so the second call is
  // runFullToolLoopTurn's own (see run.spec.ts's fakeAnthropic for the same
  // two-call pattern).
  const fakeAnthropicClient = {
    createMessage: jest
      .fn()
      .mockImplementation(
        (params: { output_config?: { format?: unknown } }) => {
          if (params.output_config?.format) {
            return Promise.resolve({
              stop_reason: 'end_turn',
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    type: 'fallback',
                    reason: 'привітання',
                  }),
                },
              ],
            });
          }
          return Promise.resolve({
            stop_reason: 'end_turn',
            content: [
              { type: 'text', text: 'Привіт! Чим можу допомогти з раціоном?' },
            ],
          });
        },
      ),
  };
  // getDraftClient falls back to the same client, same as the real
  // AnthropicService does when no separate draft model is configured.
  const fakeAnthropicService = {
    getClient: () => fakeAnthropicClient,
    getDraftClient: () => fakeAnthropicClient,
  };

  // In-memory stand-in — real ChatConversationStore would hit Postgres,
  // which isn't running in CI.
  const fakeChatConversations = {
    create: () =>
      Promise.resolve({
        id: 'e2e-conv',
        title: 'Нова розмова',
        messages: [],
        widgets: [],
      }),
    get: () => Promise.resolve(undefined),
    saveMessages: () => Promise.resolve(),
    saveWidgets: () => Promise.resolve(),
    list: () => Promise.resolve([]),
    remove: () => Promise.resolve(),
  };

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(McpService)
      .useValue(fakeMcpService)
      .overrideProvider(AnthropicService)
      .useValue(fakeAnthropicService)
      .overrideProvider(ChatConversationStore)
      .useValue(fakeChatConversations)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('/ (GET) reports service status', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect({ service: 'silpo-family-ration-agent', status: 'ok' });
  });

  it('/agent/messages (POST) runs a turn through the real HTTP pipeline', async () => {
    const response = await request(app.getHttpServer())
      .post('/agent/messages')
      .send({ sessionId: 'e2e-session', message: 'привіт' })
      .expect(201);

    expect(response.body).toEqual({
      reply: 'Привіт! Чим можу допомогти з раціоном?',
      conversationId: 'e2e-conv',
      title: 'привіт',
    });
    expect(fakeAnthropicClient.createMessage).toHaveBeenCalledTimes(2);
  });

  it('/agent/messages (POST) rejects a request without sessionId', () => {
    return request(app.getHttpServer())
      .post('/agent/messages')
      .send({ message: 'привіт' })
      .expect(400);
  });
});
