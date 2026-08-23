import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
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

/** The SDK's own per-request timeout has been observed not to fire reliably
 * against the Silpo MCP server (a real hung `silpo_find_products_batch` call
 * once sat idle for 9+ minutes with no timeout error and no log output) —
 * so this wraps every call in its own AbortController-backed race instead of
 * trusting `RequestOptions.timeout` alone. On timeout/failure this throws
 * (rather than hanging the whole agent turn, and thus the HTTP response,
 * forever); callers see a normal Error and the tool-use loop's caller can
 * report it back to the guest instead of the request silently never resolving. */
const MCP_TOOL_TIMEOUT_MS = 45_000;

export async function callMcpTool(
  mcp: Client,
  name: string,
  input: unknown,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MCP_TOOL_TIMEOUT_MS);
  try {
    const result = await mcp.callTool(
      { name, arguments: input as Record<string, unknown> },
      CallToolResultSchema,
      { timeout: MCP_TOOL_TIMEOUT_MS, signal: controller.signal },
    );
    if (result.isError) {
      return `Error: ${JSON.stringify(result.content)}`;
    }
    return JSON.stringify(result.content);
  } catch (err) {
    console.error(`  ✗ ${name} failed:`, err);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Same timeout-guarded call as `callMcpTool`, but for code that needs the
 * tool's parsed `structuredContent` (a plain object) instead of an
 * LLM-facing JSON-stringified text blob — see leanProductResolver.ts, which
 * calls MCP tools directly from code rather than routing through a model. */
export async function callMcpToolStructured(
  mcp: Client,
  name: string,
  input: unknown,
  timeoutMs = MCP_TOOL_TIMEOUT_MS,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const result = await mcp.callTool(
      { name, arguments: input as Record<string, unknown> },
      CallToolResultSchema,
      { timeout: timeoutMs, signal: controller.signal },
    );
    if (result.isError) {
      throw new Error(
        `${name} returned an error: ${JSON.stringify(result.content)}`,
      );
    }
    return result.structuredContent;
  } catch (err) {
    console.error(`  ✗ ${name} failed:`, err);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
