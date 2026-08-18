import { BadRequestException } from '@nestjs/common';
import { AgentController } from './agent.controller';
import type { AgentService } from './agent.service';

describe('AgentController', () => {
  it('delegates to AgentService.sendMessage and wraps the reply', async () => {
    const sendMessage = jest.fn().mockResolvedValue('відповідь агента');
    const agentService = { sendMessage } as unknown as AgentService;
    const controller = new AgentController(agentService);

    const result = await controller.sendMessage({
      sessionId: 's1',
      message: 'привіт',
    });

    expect(sendMessage).toHaveBeenCalledWith('s1', 'привіт');
    expect(result).toEqual({ reply: 'відповідь агента' });
  });

  it('rejects a request missing sessionId or message', async () => {
    const sendMessage = jest.fn();
    const agentService = { sendMessage } as unknown as AgentService;
    const controller = new AgentController(agentService);

    await expect(
      controller.sendMessage({ sessionId: '', message: '' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
