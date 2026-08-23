import { BadRequestException } from '@nestjs/common';
import { AgentController } from './agent.controller';
import type { AgentService } from './agent.service';

describe('AgentController', () => {
  describe('sendMessage', () => {
    it('delegates to AgentService.sendMessage, passing conversationId through', async () => {
      const sendMessage = jest.fn().mockResolvedValue({
        reply: 'відповідь агента',
        conversationId: 'c1',
        title: 'привіт',
      });
      const agentService = { sendMessage } as unknown as AgentService;
      const controller = new AgentController(agentService);

      const result = await controller.sendMessage({
        sessionId: 's1',
        message: 'привіт',
        conversationId: 'c1',
      });

      expect(sendMessage).toHaveBeenCalledWith('s1', 'привіт', 'c1', undefined);
      expect(result).toEqual({
        reply: 'відповідь агента',
        conversationId: 'c1',
        title: 'привіт',
      });
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

  describe('listChats', () => {
    it('delegates to AgentService.listChats', async () => {
      const summaries = [{ id: 'c1', title: 'Раціон', updatedAt: 'now' }];
      const listChats = jest.fn().mockResolvedValue(summaries);
      const agentService = { listChats } as unknown as AgentService;
      const controller = new AgentController(agentService);

      await expect(controller.listChats('s1')).resolves.toEqual(summaries);
      expect(listChats).toHaveBeenCalledWith('s1');
    });

    it('rejects a missing sessionId', async () => {
      const controller = new AgentController({} as unknown as AgentService);

      await expect(controller.listChats(undefined)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('getChat', () => {
    it('delegates to AgentService.getChat', async () => {
      const conversation = { id: 'c1', title: 'Раціон', messages: [] };
      const getChat = jest.fn().mockResolvedValue(conversation);
      const agentService = { getChat } as unknown as AgentService;
      const controller = new AgentController(agentService);

      await expect(controller.getChat('c1', 's1')).resolves.toEqual(
        conversation,
      );
      expect(getChat).toHaveBeenCalledWith('s1', 'c1');
    });

    it('rejects a missing sessionId', async () => {
      const controller = new AgentController({} as unknown as AgentService);

      await expect(controller.getChat('c1', undefined)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('deleteChat', () => {
    it('delegates to AgentService.deleteChat', async () => {
      const deleteChat = jest.fn().mockResolvedValue(undefined);
      const agentService = { deleteChat } as unknown as AgentService;
      const controller = new AgentController(agentService);

      await expect(controller.deleteChat('c1', 's1')).resolves.toEqual({
        success: true,
      });
      expect(deleteChat).toHaveBeenCalledWith('s1', 'c1');
    });

    it('rejects a missing sessionId', async () => {
      const controller = new AgentController({} as unknown as AgentService);

      await expect(
        controller.deleteChat('c1', undefined),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('plan', () => {
    function validPlanBody(overrides: Record<string, unknown> = {}) {
      return {
        sessionId: 's1',
        people: 2,
        days: 3,
        allergens: [],
        cuisine: 'українська',
        equipment: ['плита'],
        cookingStyle: 'daily',
        budgetUah: 1500,
        notes: '',
        ...overrides,
      };
    }

    it('delegates to AgentService.planMeals and returns the full PlanChatResult', async () => {
      const result = {
        dishes: [],
        conversationId: 'c1',
        title: 'Раціон',
        requestText: 'Склади раціон: ...',
        summaryText: 'Раціон готовий: ...',
      };
      const planMeals = jest.fn().mockResolvedValue(result);
      const agentService = { planMeals } as unknown as AgentService;
      const controller = new AgentController(agentService);
      const body = validPlanBody({ conversationId: 'c1' });

      await expect(controller.plan(body)).resolves.toEqual(result);
      expect(planMeals).toHaveBeenCalledWith(expect.objectContaining(body));
    });

    it('rejects an invalid body without calling AgentService', async () => {
      const planMeals = jest.fn();
      const agentService = { planMeals } as unknown as AgentService;
      const controller = new AgentController(agentService);

      await expect(controller.plan({ sessionId: 's1' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(planMeals).not.toHaveBeenCalled();
    });
  });

  describe('getFamily', () => {
    it('delegates to AgentService.getFamily', async () => {
      const info = { familyId: 'fam-1', members: [] };
      const getFamily = jest.fn().mockResolvedValue(info);
      const agentService = { getFamily } as unknown as AgentService;
      const controller = new AgentController(agentService);

      await expect(controller.getFamily('s1')).resolves.toEqual(info);
      expect(getFamily).toHaveBeenCalledWith('s1');
    });

    it('rejects a missing sessionId', async () => {
      const controller = new AgentController({} as unknown as AgentService);

      await expect(controller.getFamily(undefined)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('sendFamilyMessage', () => {
    it('delegates to AgentService.sendFamilyMessage, passing conversationId through', async () => {
      const sendFamilyMessage = jest.fn().mockResolvedValue({
        reply: 'відповідь',
        conversationId: 'c1',
        title: 'привіт',
      });
      const agentService = { sendFamilyMessage } as unknown as AgentService;
      const controller = new AgentController(agentService);

      await controller.sendFamilyMessage({
        sessionId: 's1',
        message: 'привіт',
        conversationId: 'c1',
      });

      expect(sendFamilyMessage).toHaveBeenCalledWith(
        's1',
        'привіт',
        'c1',
        undefined,
      );
    });

    it('rejects a request missing sessionId or message', async () => {
      const sendFamilyMessage = jest.fn();
      const agentService = { sendFamilyMessage } as unknown as AgentService;
      const controller = new AgentController(agentService);

      await expect(
        controller.sendFamilyMessage({ sessionId: '', message: '' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(sendFamilyMessage).not.toHaveBeenCalled();
    });
  });

  describe('listFamilyChats/getFamilyChat/deleteFamilyChat', () => {
    it('delegate to AgentService with sessionId, rejecting when it is missing', async () => {
      const listFamilyChats = jest.fn().mockResolvedValue([]);
      const getFamilyChat = jest
        .fn()
        .mockResolvedValue({ id: 'c1', title: 't', messages: [] });
      const deleteFamilyChat = jest.fn().mockResolvedValue(undefined);
      const agentService = {
        listFamilyChats,
        getFamilyChat,
        deleteFamilyChat,
      } as unknown as AgentService;
      const controller = new AgentController(agentService);

      await controller.listFamilyChats('s1');
      expect(listFamilyChats).toHaveBeenCalledWith('s1');
      await expect(
        controller.listFamilyChats(undefined),
      ).rejects.toBeInstanceOf(BadRequestException);

      await controller.getFamilyChat('c1', 's1');
      expect(getFamilyChat).toHaveBeenCalledWith('s1', 'c1');
      await expect(
        controller.getFamilyChat('c1', undefined),
      ).rejects.toBeInstanceOf(BadRequestException);

      await expect(controller.deleteFamilyChat('c1', 's1')).resolves.toEqual({
        success: true,
      });
      expect(deleteFamilyChat).toHaveBeenCalledWith('s1', 'c1');
      await expect(
        controller.deleteFamilyChat('c1', undefined),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
