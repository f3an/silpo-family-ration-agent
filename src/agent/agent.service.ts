import { Injectable } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { McpService } from '../mcp/mcp.service';
import { AnthropicService } from '../anthropic/anthropic.service';
import { runAgentTurn } from './run';

/**
 * Orchestrates one conversation turn per session: runs the Claude + Silpo MCP
 * tool-use loop (see run.ts) and keeps per-session message history in memory.
 */
@Injectable()
export class AgentService {
  private readonly histories = new Map<string, Anthropic.MessageParam[]>();

  constructor(
    private readonly mcpService: McpService,
    private readonly anthropicService: AnthropicService,
  ) {}

  async sendMessage(sessionId: string, message: string): Promise<string> {
    const history = this.histories.get(sessionId) ?? [];
    const mcp = this.mcpService.getClient();
    const anthropic = this.anthropicService.getClient();

    const result = await runAgentTurn(anthropic, mcp, history, message);
    this.histories.set(sessionId, result.history);
    return result.finalText;
  }

  resetSession(sessionId: string): void {
    this.histories.delete(sessionId);
  }
}
