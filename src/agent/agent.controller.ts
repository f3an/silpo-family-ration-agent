import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { AgentService } from './agent.service';
import { SendMessageDto } from './dto/send-message.dto';

@Controller('agent')
export class AgentController {
  constructor(private readonly agentService: AgentService) {}

  @Post('messages')
  async sendMessage(@Body() body: SendMessageDto): Promise<{ reply: string }> {
    if (!body?.sessionId || !body?.message) {
      throw new BadRequestException('sessionId and message are required');
    }

    const reply = await this.agentService.sendMessage(
      body.sessionId,
      body.message,
    );
    return { reply };
  }
}
