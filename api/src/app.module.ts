import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AgentModule } from './agent/agent.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), AgentModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
