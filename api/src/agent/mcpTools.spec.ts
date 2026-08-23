import { listAnthropicTools, callMcpTool } from './mcpTools';

function fakeMcp(overrides: Record<string, unknown> = {}) {
  return {
    listTools: jest.fn().mockResolvedValue({
      tools: [
        {
          name: 'silpo_get_products',
          description: 'Get products',
          inputSchema: {
            type: 'object',
            properties: { query: { type: 'string' } },
          },
        },
      ],
    }),
    callTool: jest.fn().mockResolvedValue({
      isError: false,
      content: [{ type: 'text', text: 'ok' }],
    }),
    ...overrides,
  };
}

describe('listAnthropicTools', () => {
  it('converts an MCP tool list into Anthropic Messages API tool schema', async () => {
    const mcp = fakeMcp();

    const tools = await listAnthropicTools(mcp as never);

    expect(tools).toEqual([
      {
        name: 'silpo_get_products',
        description: 'Get products',
        input_schema: {
          type: 'object',
          properties: { query: { type: 'string' } },
        },
      },
    ]);
  });

  it('falls back to an empty description and object schema when missing', async () => {
    const mcp = fakeMcp({
      listTools: jest
        .fn()
        .mockResolvedValue({ tools: [{ name: 'no_schema_tool' }] }),
    });

    const tools = await listAnthropicTools(mcp as never);

    expect(tools).toEqual([
      {
        name: 'no_schema_tool',
        description: '',
        input_schema: { type: 'object', properties: {} },
      },
    ]);
  });
});

describe('callMcpTool', () => {
  it('calls the MCP tool with the given arguments and returns JSON content', async () => {
    const mcp = fakeMcp();

    const result = await callMcpTool(mcp as never, 'silpo_get_products', {
      query: 'молоко',
    });

    expect(mcp.callTool).toHaveBeenCalledWith(
      { name: 'silpo_get_products', arguments: { query: 'молоко' } },
      expect.anything(),
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- jest matcher typing
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
    expect(result).toBe(JSON.stringify([{ type: 'text', text: 'ok' }]));
  });

  it('surfaces an MCP tool error as text instead of throwing', async () => {
    const mcp = fakeMcp({
      callTool: jest.fn().mockResolvedValue({
        isError: true,
        content: [{ type: 'text', text: 'product.offer.stock.max' }],
      }),
    });

    const result = await callMcpTool(
      mcp as never,
      'silpo_add_or_update_cart_products',
      {},
    );

    expect(result).toContain('Error:');
    expect(result).toContain('product.offer.stock.max');
  });

  it('rejects instead of hanging forever when the MCP call never resolves', async () => {
    const mcp = fakeMcp({
      callTool: jest.fn().mockRejectedValue(new Error('Request timed out')),
    });

    await expect(
      callMcpTool(mcp as never, 'silpo_find_products_batch', {}),
    ).rejects.toThrow('Request timed out');
  });
});
