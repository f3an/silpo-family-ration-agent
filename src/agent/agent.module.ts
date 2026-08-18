import { Module } from '@nestjs/common';
import { McpModule } from '../mcp/mcp.module';
import { AnthropicModule } from '../anthropic/anthropic.module';
import { AgentService } from './agent.service';
import { AgentController } from './agent.controller';

@Module({
  imports: [McpModule, AnthropicModule],
  controllers: [AgentController],
  providers: [AgentService],
})
export class AgentModule {}
