import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module';
import { McpService } from './mcp.service';
import { SilpoAuthSessionStore } from './silpoAuthSession.service';
import { SilpoAuthController } from './silpo-auth.controller';

@Module({
  imports: [DbModule],
  controllers: [SilpoAuthController],
  providers: [McpService, SilpoAuthSessionStore],
  exports: [McpService],
})
export class McpModule {}
