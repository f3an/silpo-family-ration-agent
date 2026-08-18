import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { McpService } from '../src/mcp/mcp.service';
import { AnthropicService } from '../src/anthropic/anthropic.service';

/**
 * Exercises the real HTTP pipeline (routing, body parsing, controller,
 * DI-wired service) end to end, with McpService and AnthropicService
 * swapped for fakes — no real Silpo OAuth or Claude API calls in CI.
 */
describe('AppController / AgentController (e2e)', () => {
  let app: INestApplication<App>;

  const fakeMcpClient = {
    listTools: jest.fn().mockResolvedValue({ tools: [] }),
    callTool: jest.fn(),
  };
  const fakeMcpService = { getClient: () => fakeMcpClient };

  const fakeAnthropicClient = {
    messages: {
      create: jest.fn().mockResolvedValue({
        stop_reason: 'end_turn',
        content: [
          { type: 'text', text: 'Привіт! Чим можу допомогти з раціоном?' },
        ],
      }),
    },
  };
  const fakeAnthropicService = { getClient: () => fakeAnthropicClient };

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(McpService)
      .useValue(fakeMcpService)
      .overrideProvider(AnthropicService)
      .useValue(fakeAnthropicService)
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
    });
    expect(fakeAnthropicClient.messages.create).toHaveBeenCalledTimes(1);
  });

  it('/agent/messages (POST) rejects a request without sessionId', () => {
    return request(app.getHttpServer())
      .post('/agent/messages')
      .send({ message: 'привіт' })
      .expect(400);
  });
});
