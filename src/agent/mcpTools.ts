import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type Anthropic from '@anthropic-ai/sdk';

/** Converts the Silpo MCP server's tool list into Anthropic Messages API tool definitions. */
export async function listAnthropicTools(
  mcp: Client,
): Promise<Anthropic.Tool[]> {
  const { tools } = await mcp.listTools();
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description ?? '',
    input_schema: tool.inputSchema ?? {
      type: 'object',
      properties: {},
    },
  }));
}

export async function callMcpTool(
  mcp: Client,
  name: string,
  input: unknown,
): Promise<string> {
  const result = await mcp.callTool({
    name,
    arguments: input as Record<string, unknown>,
  });
  if (result.isError) {
    return `Error: ${JSON.stringify(result.content)}`;
  }
  return JSON.stringify(result.content);
}
