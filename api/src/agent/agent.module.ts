import { Module } from '@nestjs/common';
import { McpModule } from '../mcp/mcp.module';
import { AnthropicModule } from '../anthropic/anthropic.module';
import { DbModule } from '../db/db.module';
import { CacheModule } from '../cache/cache.module';
import { AgentService } from './agent.service';
import { AgentController } from './agent.controller';
import { UserPreferencesStore } from './userPreferences.service';
import { ChatConversationStore } from './chatConversation.service';
import { FamilyStore } from './family.service';
import { DeliveryService } from './delivery.service';

@Module({
  imports: [McpModule, AnthropicModule, DbModule, CacheModule],
  controllers: [AgentController],
  providers: [
    AgentService,
    UserPreferencesStore,
    ChatConversationStore,
    FamilyStore,
    DeliveryService,
  ],
})
export class AgentModule {}
