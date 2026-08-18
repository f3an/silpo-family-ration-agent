import Anthropic from '@anthropic-ai/sdk';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { listAnthropicTools, callMcpTool } from './mcpTools';
import { SYSTEM_PROMPT } from './systemPrompt';

const MODEL = 'claude-sonnet-5';

/**
 * Runs one turn of the agent loop: sends `userMessage` (plus prior history),
 * lets Claude call Silpo MCP tools until it produces a final answer, and
 * returns the updated message history along with the final assistant text.
 */
export async function runAgentTurn(
  anthropic: Anthropic,
  mcp: Client,
  history: Anthropic.MessageParam[],
  userMessage: string,
): Promise<{ history: Anthropic.MessageParam[]; finalText: string }> {
  const tools = await listAnthropicTools(mcp);
  const messages: Anthropic.MessageParam[] = [
    ...history,
    { role: 'user', content: userMessage },
  ];

  while (true) {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      output_config: { effort: 'high' },
      tools,
      messages,
    });

    messages.push({ role: 'assistant', content: response.content });

    if (response.stop_reason !== 'tool_use') {
      const finalText = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n');
      return { history: messages, finalText };
    }

    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
    );

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of toolUseBlocks) {
      console.log(`  → ${block.name}(${JSON.stringify(block.input)})`);
      const result = await callMcpTool(mcp, block.name, block.input);
      toolResults.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: result,
      });
    }

    messages.push({ role: 'user', content: toolResults });
  }
}
