import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  AgentService,
  type SendMessageResult,
  type PlanChatResult,
} from './agent.service';
import { SendMessageDto } from './dto/send-message.dto';
import { RetryMessageDto } from './dto/retry-message.dto';
import { FamilyMessageDto } from './dto/family-message.dto';
import type { ChatConversationSummary } from './chatConversation.service';
import type { ChatTurn } from './chatTranscript';
import type { FamilyInfo } from './family.service';
import type {
  DeliveryInfo,
  DeliverySlot,
  DeliveryAddressOption,
  AddressTimeslots,
} from './delivery.service';
import { SetTimeslotDto, SetAddressDto } from './dto/delivery.dto';
import {
  PlanRequestSchema,
  CheckoutRequestSchema,
  SavePreferencesRequestSchema,
  type UserProfile,
} from './dishPlan.schema';
import type { CheckoutResult } from './checkout';

@Controller('agent')
export class AgentController {
  constructor(private readonly agentService: AgentService) {}

  @Post('messages')
  async sendMessage(@Body() body: SendMessageDto): Promise<SendMessageResult> {
    if (!body?.sessionId || !body?.message) {
      throw new BadRequestException('sessionId and message are required');
    }

    return this.agentService.sendMessage(
      body.sessionId,
      body.message,
      body.conversationId,
      body.displayMessage,
    );
  }

  @Post('messages/retry')
  async retryMessage(
    @Body() body: RetryMessageDto,
  ): Promise<SendMessageResult> {
    if (!body?.sessionId || !body?.conversationId) {
      throw new BadRequestException(
        'sessionId and conversationId are required',
      );
    }

    return this.agentService.retryLastMessage(
      body.sessionId,
      body.conversationId,
    );
  }

  @Get('chats')
  async listChats(
    @Query('sessionId') sessionId?: string,
  ): Promise<ChatConversationSummary[]> {
    if (!sessionId) throw new BadRequestException('sessionId is required');
    return this.agentService.listChats(sessionId);
  }

  @Get('chats/:id')
  async getChat(
    @Param('id') id: string,
    @Query('sessionId') sessionId?: string,
  ): Promise<{ id: string; title: string; messages: ChatTurn[] }> {
    if (!sessionId) throw new BadRequestException('sessionId is required');
    return this.agentService.getChat(sessionId, id);
  }

  @Delete('chats/:id')
  async deleteChat(
    @Param('id') id: string,
    @Query('sessionId') sessionId?: string,
  ): Promise<{ success: true }> {
    if (!sessionId) throw new BadRequestException('sessionId is required');
    await this.agentService.deleteChat(sessionId, id);
    return { success: true };
  }

  @Post('plan')
  async plan(@Body() body: unknown): Promise<PlanChatResult> {
    const parsed = PlanRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues);
    }

    return this.agentService.planMeals(parsed.data);
  }

  @Post('checkout')
  async checkout(@Body() body: unknown): Promise<CheckoutResult> {
    const parsed = CheckoutRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues);
    }

    return this.agentService.checkout(parsed.data.sessionId, parsed.data.items);
  }

  @Get('family')
  async getFamily(@Query('sessionId') sessionId?: string): Promise<FamilyInfo> {
    if (!sessionId) throw new BadRequestException('sessionId is required');
    return this.agentService.getFamily(sessionId);
  }

  @Post('family-messages')
  async sendFamilyMessage(
    @Body() body: FamilyMessageDto,
  ): Promise<SendMessageResult> {
    if (!body?.sessionId || !body?.message) {
      throw new BadRequestException('sessionId and message are required');
    }

    return this.agentService.sendFamilyMessage(
      body.sessionId,
      body.message,
      body.conversationId,
      body.displayMessage,
    );
  }

  @Get('family-chats')
  async listFamilyChats(
    @Query('sessionId') sessionId?: string,
  ): Promise<ChatConversationSummary[]> {
    if (!sessionId) throw new BadRequestException('sessionId is required');
    return this.agentService.listFamilyChats(sessionId);
  }

  @Get('family-chats/:id')
  async getFamilyChat(
    @Param('id') id: string,
    @Query('sessionId') sessionId?: string,
  ): Promise<{ id: string; title: string; messages: ChatTurn[] }> {
    if (!sessionId) throw new BadRequestException('sessionId is required');
    return this.agentService.getFamilyChat(sessionId, id);
  }

  @Delete('family-chats/:id')
  async deleteFamilyChat(
    @Param('id') id: string,
    @Query('sessionId') sessionId?: string,
  ): Promise<{ success: true }> {
    if (!sessionId) throw new BadRequestException('sessionId is required');
    await this.agentService.deleteFamilyChat(sessionId, id);
    return { success: true };
  }

  @Get('profile')
  async profile(@Query('sessionId') sessionId?: string): Promise<UserProfile> {
    if (!sessionId) throw new BadRequestException('sessionId is required');
    return this.agentService.getProfile(sessionId);
  }

  @Post('preferences')
  async savePreferences(@Body() body: unknown): Promise<{ success: true }> {
    const parsed = SavePreferencesRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues);
    }

    const { sessionId, ...preferences } = parsed.data;
    await this.agentService.savePreferences(sessionId, preferences);
    return { success: true };
  }

  @Get('delivery')
  async getDelivery(
    @Query('sessionId') sessionId?: string,
  ): Promise<DeliveryInfo> {
    if (!sessionId) throw new BadRequestException('sessionId is required');
    return this.agentService.getDeliveryInfo(sessionId);
  }

  @Get('delivery/timeslots')
  async getDeliveryTimeslots(
    @Query('sessionId') sessionId?: string,
  ): Promise<DeliverySlot[]> {
    if (!sessionId) throw new BadRequestException('sessionId is required');
    return this.agentService.listDeliveryTimeslots(sessionId);
  }

  @Post('delivery/timeslot')
  async setDeliveryTimeslot(
    @Body() body: SetTimeslotDto,
  ): Promise<{ success: true }> {
    if (!body?.sessionId || !body?.start || !body?.end) {
      throw new BadRequestException('sessionId, start and end are required');
    }
    await this.agentService.setDeliveryTimeslot(
      body.sessionId,
      body.start,
      body.end,
    );
    return { success: true };
  }

  @Get('delivery/addresses')
  async getDeliveryAddresses(
    @Query('sessionId') sessionId?: string,
  ): Promise<DeliveryAddressOption[]> {
    if (!sessionId) throw new BadRequestException('sessionId is required');
    return this.agentService.listDeliveryAddresses(sessionId);
  }

  @Get('delivery/addresses/:id/timeslots')
  async getDeliveryAddressTimeslots(
    @Param('id') addressId: string,
    @Query('sessionId') sessionId?: string,
  ): Promise<AddressTimeslots> {
    if (!sessionId) throw new BadRequestException('sessionId is required');
    return this.agentService.listDeliveryTimeslotsForAddress(
      sessionId,
      addressId,
    );
  }

  @Post('delivery/address')
  async setDeliveryAddress(
    @Body() body: SetAddressDto,
  ): Promise<{ success: true }> {
    if (!body?.sessionId || !body?.addressId || !body?.start || !body?.end) {
      throw new BadRequestException(
        'sessionId, addressId, start and end are required',
      );
    }
    await this.agentService.setDeliveryAddress(
      body.sessionId,
      body.addressId,
      body.start,
      body.end,
    );
    return { success: true };
  }
}
