import type Anthropic from '@anthropic-ai/sdk';
import { AnthropicLlmClient } from './anthropicLlmClient';
import type { LlmCreateMessageParams } from './llm.types';

function baseParams(): LlmCreateMessageParams {
  return {
    model: 'claude-sonnet-5',
    max_tokens: 1000,
    system: [{ type: 'text', text: 'Ти агент.' }],
    tools: [],
    messages: [{ role: 'user', content: 'привіт' }],
  };
}

describe('AnthropicLlmClient', () => {
  it('streams by default — calls messages.stream().finalMessage(), not messages.create()', async () => {
    const finalMessage = jest
      .fn()
      .mockResolvedValue({ stop_reason: 'end_turn' });
    const stream = jest.fn().mockReturnValue({ finalMessage });
    const create = jest.fn();
    const anthropic = { messages: { stream, create } } as unknown as Anthropic;
    const client = new AnthropicLlmClient(anthropic);

    await client.createMessage(baseParams());

    expect(stream).toHaveBeenCalledTimes(1);
    expect(finalMessage).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
  });

  it('streaming: false calls messages.create() directly instead — see comment on why (local LM Studio tool-call parsing)', async () => {
    const stream = jest.fn();
    const create = jest.fn().mockResolvedValue({ stop_reason: 'tool_use' });
    const anthropic = { messages: { stream, create } } as unknown as Anthropic;
    const client = new AnthropicLlmClient(anthropic, false);

    const result = await client.createMessage(baseParams());

    expect(create).toHaveBeenCalledTimes(1);
    expect(stream).not.toHaveBeenCalled();
    expect(result).toEqual({ stop_reason: 'tool_use' });
  });

  it('streaming: false passes an explicit timeout — the SDK otherwise refuses a non-streaming call above ~21333 max_tokens (we request 32000)', async () => {
    const create = jest.fn().mockResolvedValue({ stop_reason: 'end_turn' });
    const anthropic = {
      messages: { stream: jest.fn(), create },
    } as unknown as Anthropic;
    const client = new AnthropicLlmClient(anthropic, false, 120_000);

    await client.createMessage(baseParams());

    expect(create).toHaveBeenCalledWith(expect.anything(), {
      timeout: 120_000,
    });
  });
});
