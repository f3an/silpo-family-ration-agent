import type Anthropic from '@anthropic-ai/sdk';
import { AgentService } from './agent.service';
import type { McpService } from '../mcp/mcp.service';
import type { AnthropicService } from '../anthropic/anthropic.service';

/**
 * `runAgentTurn` mutates its `messages` array in place (push) across the
 * whole conversation, so a plain jest mock's `mock.calls` — which stores a
 * live reference, not a copy — would show every call's argument as the
 * FINAL state of the array, not its state at call-time. `callSnapshots`
 * deep-clones `messages` the moment `create` is invoked so assertions see
 * what was actually sent to the API on each turn.
 */
function fakeAnthropicService(responses: unknown[]) {
  const callSnapshots: Array<{ messages: unknown[] }> = [];
  let i = 0;
  const create = jest.fn((params: { messages: unknown[] }) => {
    callSnapshots.push({
      messages: JSON.parse(JSON.stringify(params.messages)) as unknown[],
    });
    return responses[i++];
  });
  const client = { messages: { create } } as unknown as Anthropic;
  const anthropicService = {
    getClient: () => client,
  } as unknown as AnthropicService;
  return { anthropicService, callSnapshots };
}

function fakeMcpService() {
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
  const mcpService = { getClient: () => client } as unknown as McpService;
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
    const service = new AgentService(mcpService, anthropicService);

    const reply = await service.sendMessage('session-1', "хто в моїй сім'ї?");

    expect(reply).toBe(
      "У вас немає збереженої сім'ї — розкажи склад, і я побудую раціон.",
    );
    expect(client.callTool).toHaveBeenCalledWith({
      name: 'silpo_get_my_family',
      arguments: {},
    });
    expect(callSnapshots).toHaveLength(2);
  });

  it('keeps conversation history across turns within the same session', async () => {
    const { anthropicService, callSnapshots } = fakeAnthropicService([
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Привіт!' }] },
      {
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: "Твоє ім'я мені ще невідоме." }],
      },
    ]);
    const { mcpService } = fakeMcpService();
    const service = new AgentService(mcpService, anthropicService);

    await service.sendMessage('session-2', 'привіт');
    await service.sendMessage('session-2', 'як мене звати?');

    // user(1) + assistant(1) + user(2) = 3 messages sent on the second call
    expect(callSnapshots[1].messages).toHaveLength(3);
  });

  it('isolates history between different sessions', async () => {
    const { anthropicService, callSnapshots } = fakeAnthropicService([
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'A' }] },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'B' }] },
    ]);
    const { mcpService } = fakeMcpService();
    const service = new AgentService(mcpService, anthropicService);

    await service.sendMessage('session-a', 'перше повідомлення');
    await service.sendMessage('session-b', 'інша сесія');

    expect(callSnapshots[1].messages).toHaveLength(1);
  });

  it('resetSession clears stored history for that session only', async () => {
    const { anthropicService, callSnapshots } = fakeAnthropicService([
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'A' }] },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'B' }] },
    ]);
    const { mcpService } = fakeMcpService();
    const service = new AgentService(mcpService, anthropicService);

    await service.sendMessage('session-1', 'перше');
    service.resetSession('session-1');
    await service.sendMessage('session-1', 'друге, але вже без історії');

    expect(callSnapshots[1].messages).toHaveLength(1);
  });
});
