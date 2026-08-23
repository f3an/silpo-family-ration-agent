import type Anthropic from '@anthropic-ai/sdk';
import { LocalOpenAiLlmClient } from './localOpenAiLlmClient';
import type { LlmCreateMessageParams } from './llm.types';

function fakeFetch(response: unknown, ok = true, status = 200) {
  return jest.fn().mockResolvedValue({
    ok,
    status,
    json: () => Promise.resolve(response),
    text: () => Promise.resolve(JSON.stringify(response)),
  });
}

/** `fetchMock` is an untyped jest.fn(), so `.mock.calls[0][1]` reads as
 * `any` — this gives that one access a concrete type so every call site
 * below stays a safe, typed JSON.parse instead. */
function requestBody(fetchMock: jest.Mock): unknown {
  const call = fetchMock.mock.calls[0] as [string, { body: string }];
  return JSON.parse(call[1].body);
}

function baseParams(
  overrides: Partial<LlmCreateMessageParams> = {},
): LlmCreateMessageParams {
  return {
    model: 'ignored-by-local-client',
    max_tokens: 1000,
    system: [{ type: 'text', text: 'Ти агент.' }],
    tools: [],
    messages: [],
    ...overrides,
  };
}

describe('LocalOpenAiLlmClient', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('posts to {baseUrl}/chat/completions with the configured model', async () => {
    const fetchMock = fakeFetch({
      choices: [{ finish_reason: 'stop', message: { content: 'Привіт!' } }],
    });
    global.fetch = fetchMock;
    const client = new LocalOpenAiLlmClient(
      'http://192.168.1.50:1234/v1',
      'my-model',
    );

    await client.createMessage(
      baseParams({ messages: [{ role: 'user', content: 'привіт' }] }),
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'http://192.168.1.50:1234/v1/chat/completions',
      expect.objectContaining({ method: 'POST' }),
    );
    const body = requestBody(fetchMock) as {
      model: string;
    };
    expect(body.model).toBe('my-model');
  });

  it('translates a plain end_turn text reply into an Anthropic-shaped Message', async () => {
    global.fetch = fakeFetch({
      choices: [{ finish_reason: 'stop', message: { content: 'Привіт!' } }],
    });
    const client = new LocalOpenAiLlmClient('http://localhost:1234/v1', 'm');

    const result = await client.createMessage(
      baseParams({ messages: [{ role: 'user', content: 'привіт' }] }),
    );

    expect(result.stop_reason).toBe('end_turn');
    expect(result.content).toEqual([
      { type: 'text', text: 'Привіт!', citations: null },
    ]);
  });

  it('translates a tool_calls finish into tool_use content blocks with stop_reason tool_use', async () => {
    global.fetch = fakeFetch({
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            content: null,
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: { name: 'silpo_get_my_family', arguments: '{}' },
              },
            ],
          },
        },
      ],
    });
    const client = new LocalOpenAiLlmClient('http://localhost:1234/v1', 'm');

    const result = await client.createMessage(baseParams());

    expect(result.stop_reason).toBe('tool_use');
    expect(result.content).toEqual([
      {
        type: 'tool_use',
        id: 'call_1',
        name: 'silpo_get_my_family',
        input: {},
      },
    ]);
  });

  it('maps finish_reason "length" to stop_reason "max_tokens"', async () => {
    global.fetch = fakeFetch({
      choices: [{ finish_reason: 'length', message: { content: 'обірвано' } }],
    });
    const client = new LocalOpenAiLlmClient('http://localhost:1234/v1', 'm');

    const result = await client.createMessage(baseParams());

    expect(result.stop_reason).toBe('max_tokens');
  });

  it('splits an Anthropic tool_result content block into its own role:"tool" message', async () => {
    const fetchMock = fakeFetch({
      choices: [{ finish_reason: 'stop', message: { content: 'ок' } }],
    });
    global.fetch = fetchMock;
    const client = new LocalOpenAiLlmClient('http://localhost:1234/v1', 'm');

    await client.createMessage(
      baseParams({
        messages: [
          { role: 'user', content: 'привіт' },
          {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: 'call_1',
                name: 'silpo_get_my_family',
                input: {},
              },
            ],
          },
          {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'call_1',
                content: '{"members":[]}',
              },
            ],
          },
        ],
      }),
    );

    const body = requestBody(fetchMock) as {
      messages: Array<{
        role: string;
        content: string | null;
        tool_calls?: unknown[];
        tool_call_id?: string;
      }>;
    };
    // system + user + assistant(tool_calls) + tool
    expect(body.messages).toHaveLength(4);
    expect(body.messages[2]).toEqual({
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'silpo_get_my_family', arguments: '{}' },
        },
      ],
    });
    expect(body.messages[3]).toEqual({
      role: 'tool',
      tool_call_id: 'call_1',
      content: '{"members":[]}',
    });
  });

  it('translates Anthropic tools (name/description/input_schema) into OpenAI function tools', async () => {
    const fetchMock = fakeFetch({
      choices: [{ finish_reason: 'stop', message: { content: 'ок' } }],
    });
    global.fetch = fetchMock;
    const client = new LocalOpenAiLlmClient('http://localhost:1234/v1', 'm');
    const tools: Anthropic.Tool[] = [
      {
        name: 'silpo_get_products',
        description: 'Get products',
        input_schema: { type: 'object', properties: {} },
      },
    ];

    await client.createMessage(baseParams({ tools }));

    const body = requestBody(fetchMock) as {
      tools: Array<{
        type: string;
        function: { name: string; description: string; parameters: unknown };
      }>;
    };
    expect(body.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'silpo_get_products',
          description: 'Get products',
          parameters: { type: 'object', properties: {} },
        },
      },
    ]);
  });

  it("translates output_config.format (zodOutputFormat()'s shape) into a grammar-constrained json_schema response_format", async () => {
    const fetchMock = fakeFetch({
      choices: [{ finish_reason: 'stop', message: { content: '{}' } }],
    });
    global.fetch = fetchMock;
    const client = new LocalOpenAiLlmClient('http://localhost:1234/v1', 'm');
    const schema = { type: 'object', properties: { name: { type: 'string' } } };

    await client.createMessage(
      baseParams({
        output_config: {
          format: { type: 'json_schema', schema, parse: () => undefined },
        },
      }),
    );

    const body = requestBody(fetchMock) as {
      response_format?: {
        type: string;
        json_schema: { schema: unknown; strict: boolean };
      };
    };
    expect(body.response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'response', strict: true, schema },
    });
  });

  it('wraps a non-object root schema (e.g. a zod discriminatedUnion) in a single-property object, and unwraps the reply back out', async () => {
    const fetchMock = fakeFetch({
      choices: [
        {
          finish_reason: 'stop',
          message: {
            content: '{"value":{"type":"clarify","question":"скільки?"}}',
          },
        },
      ],
    });
    global.fetch = fetchMock;
    const client = new LocalOpenAiLlmClient('http://localhost:1234/v1', 'm');
    const unionSchema = {
      anyOf: [
        { type: 'object', properties: { type: { const: 'clarify' } } },
        { type: 'object', properties: { type: { const: 'plan' } } },
      ],
    };

    const result = await client.createMessage(
      baseParams({
        output_config: {
          format: {
            type: 'json_schema',
            schema: unionSchema,
            parse: () => undefined,
          },
        },
      }),
    );

    const body = requestBody(fetchMock) as {
      response_format: { json_schema: { schema: unknown } };
    };
    expect(body.response_format.json_schema.schema).toEqual({
      type: 'object',
      properties: { value: unionSchema },
      required: ['value'],
      additionalProperties: false,
    });
    expect(result.content).toEqual([
      {
        type: 'text',
        text: '{"type":"clarify","question":"скільки?"}',
        citations: null,
      },
    ]);
  });

  it('does not wrap a schema whose root is already type: object', async () => {
    const fetchMock = fakeFetch({
      choices: [
        { finish_reason: 'stop', message: { content: '{"name":"борщ"}' } },
      ],
    });
    global.fetch = fetchMock;
    const client = new LocalOpenAiLlmClient('http://localhost:1234/v1', 'm');
    const objectSchema = {
      type: 'object',
      properties: { name: { type: 'string' } },
    };

    const result = await client.createMessage(
      baseParams({
        output_config: {
          format: {
            type: 'json_schema',
            schema: objectSchema,
            parse: () => undefined,
          },
        },
      }),
    );

    const body = requestBody(fetchMock) as {
      response_format: { json_schema: { schema: unknown } };
    };
    expect(body.response_format.json_schema.schema).toEqual(objectSchema);
    expect(result.content).toEqual([
      { type: 'text', text: '{"name":"борщ"}', citations: null },
    ]);
  });

  it('sends no response_format when output_config.format is absent', async () => {
    const fetchMock = fakeFetch({
      choices: [{ finish_reason: 'stop', message: { content: '{}' } }],
    });
    global.fetch = fetchMock;
    const client = new LocalOpenAiLlmClient('http://localhost:1234/v1', 'm');

    await client.createMessage(baseParams());

    const body = requestBody(fetchMock) as { response_format?: unknown };
    expect(body.response_format).toBeUndefined();
  });

  it('forwards temperature when given', async () => {
    const fetchMock = fakeFetch({
      choices: [{ finish_reason: 'stop', message: { content: 'ок' } }],
    });
    global.fetch = fetchMock;
    const client = new LocalOpenAiLlmClient('http://localhost:1234/v1', 'm');

    await client.createMessage(baseParams({ temperature: 0 }));

    const body = requestBody(fetchMock) as { temperature?: number };
    expect(body.temperature).toBe(0);
  });

  it('sends no temperature field when omitted', async () => {
    const fetchMock = fakeFetch({
      choices: [{ finish_reason: 'stop', message: { content: 'ок' } }],
    });
    global.fetch = fetchMock;
    const client = new LocalOpenAiLlmClient('http://localhost:1234/v1', 'm');

    await client.createMessage(baseParams());

    const body = requestBody(fetchMock) as { temperature?: number };
    expect(body.temperature).toBeUndefined();
  });

  it('throws a clear error when the server responds with a non-2xx status', async () => {
    global.fetch = fakeFetch({ error: 'model not loaded' }, false, 500);
    const client = new LocalOpenAiLlmClient('http://localhost:1234/v1', 'm');

    await expect(client.createMessage(baseParams())).rejects.toThrow(/500/);
  });

  describe('429 rate-limit retry', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    function fetchSequence(
      ...responses: Array<{ ok: boolean; status: number; body: unknown }>
    ) {
      const mock = jest.fn();
      for (const r of responses) {
        mock.mockResolvedValueOnce({
          ok: r.ok,
          status: r.status,
          headers: { get: () => null },
          json: () => Promise.resolve(r.body),
          text: () => Promise.resolve(JSON.stringify(r.body)),
        });
      }
      return mock;
    }

    it('retries after the server-reported wait and succeeds', async () => {
      const rateLimited = {
        ok: false,
        status: 429,
        body: {
          error: { message: 'Rate limit reached. Please try again in 1.443s.' },
        },
      };
      const success = {
        ok: true,
        status: 200,
        body: {
          choices: [{ finish_reason: 'stop', message: { content: 'ок' } }],
        },
      };
      const fetchMock = fetchSequence(rateLimited, success);
      global.fetch = fetchMock;
      const client = new LocalOpenAiLlmClient(
        'https://api.openai.com/v1',
        'gpt-5.6-luna',
      );

      const promise = client.createMessage(baseParams());
      // let the first (429) call's microtasks settle before advancing timers
      await Promise.resolve();
      await Promise.resolve();
      await jest.advanceTimersByTimeAsync(1693); // 1443ms + 250ms padding
      const result = await promise;

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(result.content).toEqual([
        { type: 'text', text: 'ок', citations: null },
      ]);
    });

    it('gives up after 3 retries and throws', async () => {
      const rateLimited = {
        ok: false,
        status: 429,
        body: {
          error: { message: 'Rate limit reached. Please try again in 0.01s.' },
        },
      };
      const fetchMock = fetchSequence(
        rateLimited,
        rateLimited,
        rateLimited,
        rateLimited,
      );
      global.fetch = fetchMock;
      const client = new LocalOpenAiLlmClient(
        'https://api.openai.com/v1',
        'gpt-5.6-luna',
      );

      const promise = client.createMessage(baseParams());
      const expectation = expect(promise).rejects.toThrow(/429/);
      await jest.advanceTimersByTimeAsync(10_000);
      await expectation;

      expect(fetchMock).toHaveBeenCalledTimes(4); // initial + 3 retries
    });

    it('does not retry a non-429 error status', async () => {
      const fetchMock = fetchSequence({
        ok: false,
        status: 500,
        body: { error: 'boom' },
      });
      global.fetch = fetchMock;
      const client = new LocalOpenAiLlmClient(
        'https://api.openai.com/v1',
        'gpt-5.6-luna',
      );

      await expect(client.createMessage(baseParams())).rejects.toThrow(/500/);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    // Confirmed live: a 429 saying the SINGLE request needs 210,661 tokens
    // against a 200,000 TPM cap is not transient — waiting never shrinks
    // that one request, so this must fail immediately instead of burning
    // 3 retries (with backoff delays) on a request that will 429 the exact
    // same way every time.
    it('does not retry a "Request too large" 429 — it is not transient', async () => {
      const fetchMock = fetchSequence({
        ok: false,
        status: 429,
        body: {
          error: {
            message:
              'Request too large for gpt-5.6-luna in organization org-test on tokens per min (TPM): Limit 200000, Requested 210661. The input or output tokens must be reduced in order to run successfully.',
            type: 'tokens',
            code: 'rate_limit_exceeded',
          },
        },
      });
      global.fetch = fetchMock;
      const client = new LocalOpenAiLlmClient(
        'https://api.openai.com/v1',
        'gpt-5.6-luna',
      );

      await expect(client.createMessage(baseParams())).rejects.toThrow(
        /not a transient rate limit/,
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('with OpenAiClientOptions (real hosted OpenAI API)', () => {
    it('defaults to max_tokens with no options (unchanged local-server body)', async () => {
      const fetchMock = fakeFetch({
        choices: [{ finish_reason: 'stop', message: { content: 'ок' } }],
      });
      global.fetch = fetchMock;
      const client = new LocalOpenAiLlmClient('http://localhost:1234/v1', 'm');

      await client.createMessage(baseParams({ max_tokens: 500 }));

      const body = requestBody(fetchMock) as Record<string, unknown>;
      expect(body.max_tokens).toBe(500);
      expect(body.max_completion_tokens).toBeUndefined();
    });

    it('sends max_completion_tokens instead of max_tokens when tokenParam is set', async () => {
      const fetchMock = fakeFetch({
        choices: [{ finish_reason: 'stop', message: { content: 'ок' } }],
      });
      global.fetch = fetchMock;
      const client = new LocalOpenAiLlmClient(
        'https://api.openai.com/v1',
        'gpt-5.6-luna',
        undefined,
        { tokenParam: 'max_completion_tokens' },
      );

      await client.createMessage(baseParams({ max_tokens: 500 }));

      const body = requestBody(fetchMock) as Record<string, unknown>;
      expect(body.max_completion_tokens).toBe(500);
      expect(body.max_tokens).toBeUndefined();
    });

    it('sends an Authorization header when apiKey is set', async () => {
      const fetchMock = fakeFetch({
        choices: [{ finish_reason: 'stop', message: { content: 'ок' } }],
      });
      global.fetch = fetchMock;
      const client = new LocalOpenAiLlmClient(
        'https://api.openai.com/v1',
        'gpt-5.6-luna',
        undefined,
        { apiKey: 'sk-test' },
      );

      await client.createMessage(baseParams());

      const call = fetchMock.mock.calls[0] as [
        string,
        { headers: Record<string, string> },
      ];
      expect(call[1].headers.Authorization).toBe('Bearer sk-test');
    });

    it('omits the Authorization header when apiKey is unset', async () => {
      const fetchMock = fakeFetch({
        choices: [{ finish_reason: 'stop', message: { content: 'ок' } }],
      });
      global.fetch = fetchMock;
      const client = new LocalOpenAiLlmClient('http://localhost:1234/v1', 'm');

      await client.createMessage(baseParams());

      const call = fetchMock.mock.calls[0] as [
        string,
        { headers: Record<string, string> },
      ];
      expect(call[1].headers.Authorization).toBeUndefined();
    });

    it('strips temperature even when the caller passes it, when sendTemperature is false', async () => {
      const fetchMock = fakeFetch({
        choices: [{ finish_reason: 'stop', message: { content: 'ок' } }],
      });
      global.fetch = fetchMock;
      const client = new LocalOpenAiLlmClient(
        'https://api.openai.com/v1',
        'gpt-5.6-luna',
        undefined,
        { sendTemperature: false },
      );

      await client.createMessage(baseParams({ temperature: 0 }));

      const body = requestBody(fetchMock) as { temperature?: number };
      expect(body.temperature).toBeUndefined();
    });

    it('sends reasoning_effort when configured', async () => {
      const fetchMock = fakeFetch({
        choices: [{ finish_reason: 'stop', message: { content: 'ок' } }],
      });
      global.fetch = fetchMock;
      const client = new LocalOpenAiLlmClient(
        'https://api.openai.com/v1',
        'gpt-5.6-luna',
        undefined,
        { reasoningEffort: 'none' },
      );

      await client.createMessage(baseParams());

      const body = requestBody(fetchMock) as { reasoning_effort?: string };
      expect(body.reasoning_effort).toBe('none');
    });

    it('sends no reasoning_effort field when unset', async () => {
      const fetchMock = fakeFetch({
        choices: [{ finish_reason: 'stop', message: { content: 'ок' } }],
      });
      global.fetch = fetchMock;
      const client = new LocalOpenAiLlmClient('http://localhost:1234/v1', 'm');

      await client.createMessage(baseParams());

      const body = requestBody(fetchMock) as { reasoning_effort?: string };
      expect(body.reasoning_effort).toBeUndefined();
    });
  });
});
