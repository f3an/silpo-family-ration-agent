import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type Anthropic from '@anthropic-ai/sdk';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { LlmClient } from '../llm/llm.types';
import { McpService } from '../mcp/mcp.service';
import { AnthropicService } from '../anthropic/anthropic.service';
import { runAgentTurn } from './run';
import { planMeals } from './plan';
import { checkoutCart, type CheckoutResult } from './checkout';
import { getUserProfile } from './userProfile';
import { UserPreferencesStore } from './userPreferences.service';
import { FamilyStore, type FamilyInfo } from './family.service';
import {
  DeliveryService,
  type DeliveryInfo,
  type DeliverySlot,
  type DeliveryAddressOption,
  type AddressTimeslots,
} from './delivery.service';
import { FAMILY_CHAT_CONTEXT } from './systemPrompt';
import {
  ChatConversationStore,
  type ChatConversationSummary,
  type ChatWidget,
} from './chatConversation.service';
import { toChatTranscript, deriveConversationTitle } from './chatTranscript';
import type { ChatTurn } from './chatTranscript';
import { CacheService } from '../cache/cache.service';
import { planCacheKey, PLAN_CACHE_TTL_SECONDS } from './planCache';
import type {
  Dish,
  PlanRequest,
  CheckoutRequest,
  Preferences,
  UserProfile,
} from './dishPlan.schema';

export interface SendMessageResult {
  reply: string;
  conversationId: string;
  title: string;
  /** Set when the agent finished this turn by calling propose_dish_card
   * (once, or once per dish for a multi-dish plan/swap — see run.ts),
   * propose_occasion_basket, or propose_ingredient_options. Usually one
   * entry — an event turn can produce both a dish_plan AND an
   * occasion_basket widget on the same message (dishes that need cooking +
   * ready-to-buy extras, see systemPrompt.ts's occasion scenario). */
  widgets?: ChatWidget[];
}

/** `requestText`/`summaryText` are the exact strings that were (or will be,
 * on reload) stored as the conversation's user/assistant turns — the client
 * uses them to optimistically render the same two bubbles it'd see on a
 * fresh GET, no extra round-trip. */
export interface PlanChatResult {
  dishes: Dish[];
  conversationId: string;
  title: string;
  requestText: string;
  summaryText: string;
}

function buildPlanRequestText(profile: PlanRequest): string {
  const parts = [
    `${profile.people} осіб`,
    `${profile.days} дн.`,
    `бюджет ${profile.budgetUah} грн`,
  ];
  if (profile.cuisine) parts.push(`кухня: ${profile.cuisine}`);
  if (profile.allergens.length)
    parts.push(`алергії: ${profile.allergens.join(', ')}`);
  if (profile.forChildren) parts.push('дитяче меню');
  if (profile.notes.trim()) parts.push(profile.notes.trim());
  return `Склади раціон: ${parts.join(', ')}.`;
}

function buildPlanSummaryText(dishes: Dish[], profile: PlanRequest): string {
  const names = dishes.slice(0, 5).map((d) => d.name);
  const suffix = dishes.length > 5 ? '…' : '';
  return `Раціон готовий: ${names.join(', ')}${suffix} — ${dishes.length} страв(и) на ${profile.days} дн.`;
}

/**
 * Orchestrates chat-mode turns (runs the Claude + Silpo MCP tool-use loop —
 * see run.ts — against one of the guest's persisted conversations, see
 * chatConversation.service.ts) and the structured plan/checkout flow — a
 * plan is now also just a turn in that same conversation (see planMeals /
 * appendPlanToConversation), rendered client-side as a rich card rather
 * than plain text — plus the account profile (see userProfile.ts /
 * userPreferences.service.ts).
 */
@Injectable()
export class AgentService {
  constructor(
    private readonly mcpService: McpService,
    private readonly anthropicService: AnthropicService,
    private readonly preferencesStore: UserPreferencesStore,
    private readonly chatConversations: ChatConversationStore,
    private readonly familyStore: FamilyStore,
    private readonly cache: CacheService,
    private readonly deliveryService: DeliveryService,
  ) {}

  /**
   * `conversationId` omitted/undefined starts a new thread (see chat-mode's
   * "нова розмова" button); otherwise the turn is appended to that guest's
   * existing conversation. Auto-titles a new conversation from the guest's
   * first message, same as Claude/ChatGPT's own chat history.
   */
  async sendMessage(
    sessionId: string,
    message: string,
    conversationId?: string,
    displayMessage?: string,
  ): Promise<SendMessageResult> {
    const accountId = await this.mcpService.getAccountId(sessionId);
    const mcp = await this.mcpService.getClientForSession(sessionId);
    const anthropic = this.anthropicService.getClient();
    return this.runChatTurn(
      accountId,
      mcp,
      anthropic,
      conversationId,
      message,
      displayMessage,
    );
  }

  /**
   * Same turn as sendMessage, but `ownerId` is a families.id instead of an
   * accountId — see family.service.ts for why chat_conversations.account_id
   * can safely hold either. `extraSystemContext` nudges the agent that
   * several accounts share this thread (see systemPrompt.ts's
   * FAMILY_CHAT_CONTEXT) — omitted for personal chats, whose cached system
   * prefix stays byte-identical to before this feature existed.
   */
  private async runChatTurn(
    ownerId: string,
    mcp: Client,
    llm: LlmClient,
    conversationId: string | undefined,
    message: string,
    displayMessage?: string,
    extraSystemContext?: string,
  ): Promise<SendMessageResult> {
    const conversation = conversationId
      ? await this.chatConversations.get(ownerId, conversationId)
      : await this.chatConversations.create(ownerId);
    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    const result = await runAgentTurn(
      llm,
      mcp,
      conversation.messages,
      message,
      extraSystemContext,
      this.anthropicService.getDraftClient(),
    );

    // `displayMessage` swaps out just the user turn we added (index
    // conversation.messages.length in the returned history) for a short
    // human-readable stand-in before persisting — same "keep full data out
    // of what gets resent to Claude/shown to the guest" idea as widgets vs
    // messages, but for a client-composed message (e.g. an ingredient swap
    // request) that embeds full JSON Claude needs for *this* turn only.
    const historyToSave = displayMessage
      ? result.history.map((m, i) =>
          i === conversation.messages.length
            ? { ...m, content: displayMessage }
            : m,
        )
      : result.history;

    const isFirstTurn = conversation.messages.length === 0;
    const title = isFirstTurn
      ? deriveConversationTitle(displayMessage ?? message)
      : undefined;
    await this.chatConversations.saveMessages(
      ownerId,
      conversation.id,
      historyToSave,
      title,
    );

    const widgets = this.buildWidgetsFromResult(result);
    if (widgets.length > 0) {
      await this.chatConversations.saveWidgets(ownerId, conversation.id, [
        ...conversation.widgets,
        ...widgets,
      ]);
    }

    return {
      reply: result.finalText,
      conversationId: conversation.id,
      title: title ?? conversation.title,
      ...(widgets.length > 0 && { widgets }),
    };
  }

  /**
   * Family-shared chat: any member of the guest's Silpo family (see
   * family.service.ts) can write into and see the same thread. 403s if this
   * account isn't linked to a family yet — the guest needs to hit
   * `GET /agent/family` first (the client only shows the family-chat UI
   * once that returns a non-null familyId anyway).
   */
  async sendFamilyMessage(
    sessionId: string,
    message: string,
    conversationId?: string,
    displayMessage?: string,
  ): Promise<SendMessageResult> {
    const familyId = await this.resolveFamilyId(sessionId);
    const mcp = await this.mcpService.getClientForSession(sessionId);
    const anthropic = this.anthropicService.getClient();
    return this.runChatTurn(
      familyId,
      mcp,
      anthropic,
      conversationId,
      message,
      displayMessage,
      FAMILY_CHAT_CONTEXT,
    );
  }

  private async resolveFamilyId(sessionId: string): Promise<string> {
    const accountId = await this.mcpService.getAccountId(sessionId);
    const familyId = await this.familyStore.getFamilyIdForAccount(accountId);
    if (!familyId) {
      throw new ForbiddenException(
        'This account is not linked to a family yet — call GET /agent/family first.',
      );
    }
    return familyId;
  }

  /** Syncs this account's family from Silpo (see family.service.ts) and
   * returns it — `familyId: null` means this account has no real Silpo
   * family (or hasn't logged in with anyone else who does), so the client
   * shouldn't show family-chat UI at all. */
  async getFamily(sessionId: string): Promise<FamilyInfo> {
    const accountId = await this.mcpService.getAccountId(sessionId);
    const mcp = await this.mcpService.getClientForSession(sessionId);
    return this.familyStore.sync(mcp, accountId);
  }

  async listFamilyChats(sessionId: string): Promise<ChatConversationSummary[]> {
    const familyId = await this.resolveFamilyId(sessionId);
    return this.chatConversations.list(familyId);
  }

  async getFamilyChat(
    sessionId: string,
    conversationId: string,
  ): Promise<{ id: string; title: string; messages: ChatTurn[] }> {
    const familyId = await this.resolveFamilyId(sessionId);
    const conversation = await this.chatConversations.get(
      familyId,
      conversationId,
    );
    if (!conversation) throw new NotFoundException('Conversation not found');

    return {
      id: conversation.id,
      title: conversation.title,
      messages: toChatTranscript(conversation.messages, conversation.widgets),
    };
  }

  async deleteFamilyChat(
    sessionId: string,
    conversationId: string,
  ): Promise<void> {
    const familyId = await this.resolveFamilyId(sessionId);
    await this.chatConversations.remove(familyId, conversationId);
  }

  /** Usually one entry — an event turn can produce BOTH a dish_plan and an
   * occasion_basket widget on the same message (see run.ts's occasion
   * scenario), so these are independent checks, not else-if. */
  private buildWidgetsFromResult(
    result: Awaited<ReturnType<typeof runAgentTurn>>,
  ): ChatWidget[] {
    const widgets: ChatWidget[] = [];
    if (result.dishes?.length && result.dishMessageIndex !== undefined) {
      widgets.push({
        messageIndex: result.dishMessageIndex,
        kind: 'dish_plan',
        dishes: result.dishes,
      });
    }
    if (result.basket && result.basketMessageIndex !== undefined) {
      widgets.push({
        messageIndex: result.basketMessageIndex,
        kind: 'occasion_basket',
        basket: result.basket,
      });
    }
    if (result.options && result.optionsMessageIndex !== undefined) {
      widgets.push({
        messageIndex: result.optionsMessageIndex,
        kind: 'ingredient_options',
        ingredientName: result.options.ingredientName,
        options: result.options.options,
      });
    }
    return widgets;
  }

  /**
   * Drops the last user turn (and everything Claude produced after it —
   * tool rounds, the bad reply, any widget) and re-runs it fresh. Truncates
   * and persists FIRST, before calling the model again — if the retry
   * itself then fails, the guest still sees the bad reply gone instead of
   * stuck forever, and can just type a new message instead.
   */
  async retryLastMessage(
    sessionId: string,
    conversationId: string,
  ): Promise<SendMessageResult> {
    const accountId = await this.mcpService.getAccountId(sessionId);
    const conversation = await this.chatConversations.get(
      accountId,
      conversationId,
    );
    if (!conversation) throw new NotFoundException('Conversation not found');

    let lastUserIndex = -1;
    for (let i = conversation.messages.length - 1; i >= 0; i--) {
      const m = conversation.messages[i];
      if (m.role === 'user' && typeof m.content === 'string') {
        lastUserIndex = i;
        break;
      }
    }
    if (lastUserIndex === -1) {
      throw new BadRequestException('Nothing to retry in this conversation');
    }

    const retryMessage = conversation.messages[lastUserIndex].content as string;
    // Everything BEFORE the guest's own last message — this is what
    // `runAgentTurn` needs as `history` (it re-appends the user message
    // itself). Kept out of the interim save below.
    const historyBeforeRetryMessage = conversation.messages.slice(
      0,
      lastUserIndex,
    );
    // What actually gets persisted right away, before calling the model
    // again — INCLUDES the guest's own message, so a reload/second tab
    // during the retry (which can take a while — see run.ts) shows the
    // question still there with just the bad reply gone, not an empty
    // conversation.
    const interimHistory = conversation.messages.slice(0, lastUserIndex + 1);
    const keptWidgets = conversation.widgets.filter(
      (w) => w.messageIndex < lastUserIndex,
    );

    await this.chatConversations.saveMessages(
      accountId,
      conversation.id,
      interimHistory,
    );
    await this.chatConversations.saveWidgets(
      accountId,
      conversation.id,
      keptWidgets,
    );

    const mcp = await this.mcpService.getClientForSession(sessionId);
    const anthropic = this.anthropicService.getClient();
    const result = await runAgentTurn(
      anthropic,
      mcp,
      historyBeforeRetryMessage,
      retryMessage,
      undefined,
      this.anthropicService.getDraftClient(),
    );

    await this.chatConversations.saveMessages(
      accountId,
      conversation.id,
      result.history,
    );

    const widgets = this.buildWidgetsFromResult(result);
    if (widgets.length > 0) {
      await this.chatConversations.saveWidgets(accountId, conversation.id, [
        ...keptWidgets,
        ...widgets,
      ]);
    }

    return {
      reply: result.finalText,
      conversationId: conversation.id,
      title: conversation.title,
      ...(widgets.length > 0 && { widgets }),
    };
  }

  async listChats(sessionId: string): Promise<ChatConversationSummary[]> {
    const accountId = await this.mcpService.getAccountId(sessionId);
    return this.chatConversations.list(accountId);
  }

  async getChat(
    sessionId: string,
    conversationId: string,
  ): Promise<{ id: string; title: string; messages: ChatTurn[] }> {
    const accountId = await this.mcpService.getAccountId(sessionId);
    const conversation = await this.chatConversations.get(
      accountId,
      conversationId,
    );
    if (!conversation) throw new NotFoundException('Conversation not found');

    return {
      id: conversation.id,
      title: conversation.title,
      messages: toChatTranscript(conversation.messages, conversation.widgets),
    };
  }

  async deleteChat(sessionId: string, conversationId: string): Promise<void> {
    const accountId = await this.mcpService.getAccountId(sessionId);
    await this.chatConversations.remove(accountId, conversationId);
  }

  /**
   * Cached per Silpo account + exact profile (see planCache.ts) — a repeat
   * request (double-submit, re-running the same demo profile) skips the
   * whole Claude tool-use loop entirely instead of paying for it again. A
   * cache hit still lands as a fresh turn in the conversation, though —
   * only the expensive generation is skipped, not "show up in my chat".
   */
  async planMeals(profile: PlanRequest): Promise<PlanChatResult> {
    const accountId = await this.mcpService.getAccountId(profile.sessionId);
    const cacheKey = planCacheKey(accountId, profile);

    let dishes = await this.cache.get<Dish[]>(cacheKey);
    if (!dishes) {
      const mcp = await this.mcpService.getClientForSession(profile.sessionId);
      const anthropic = this.anthropicService.getClient();
      dishes = await planMeals(
        anthropic,
        mcp,
        profile,
        this.anthropicService.getDraftClient(),
      );
      await this.cache.set(cacheKey, dishes, PLAN_CACHE_TTL_SECONDS);
    }

    // Generation above is always driven by the logged-in account's own
    // Silpo data (see planMeals/plan.ts) — only WHERE the resulting card is
    // filed changes for a family-chat submission, same split as
    // sendMessage/sendFamilyMessage.
    const ownerId = profile.familyChat
      ? await this.resolveFamilyId(profile.sessionId)
      : accountId;
    return this.appendPlanToConversation(ownerId, profile, dishes);
  }

  /**
   * The full `dishes` (images/ingredients/productIds) go into the
   * conversation's `widgets` column only — never into `messages` — so a
   * plan card doesn't get resent to Claude at full size on every later
   * chat turn. `messages` gets a short text summary instead, just enough
   * for Claude to stay aware a plan exists if the guest follows up in chat.
   */
  private async appendPlanToConversation(
    ownerId: string,
    profile: PlanRequest,
    dishes: Dish[],
  ): Promise<PlanChatResult> {
    const conversation = profile.conversationId
      ? await this.chatConversations.get(ownerId, profile.conversationId)
      : await this.chatConversations.create(ownerId);
    if (!conversation) throw new NotFoundException('Conversation not found');

    const requestText = buildPlanRequestText(profile);
    const summaryText = buildPlanSummaryText(dishes, profile);
    const isFirstTurn = conversation.messages.length === 0;
    const title = isFirstTurn
      ? deriveConversationTitle(requestText)
      : undefined;

    const newMessages: Anthropic.MessageParam[] = [
      ...conversation.messages,
      { role: 'user', content: requestText },
      { role: 'assistant', content: summaryText },
    ];
    await this.chatConversations.saveMessages(
      ownerId,
      conversation.id,
      newMessages,
      title,
    );

    const newWidgets: ChatWidget[] = [
      ...conversation.widgets,
      { messageIndex: newMessages.length - 1, kind: 'dish_plan', dishes },
    ];
    await this.chatConversations.saveWidgets(
      ownerId,
      conversation.id,
      newWidgets,
    );

    return {
      dishes,
      conversationId: conversation.id,
      title: title ?? conversation.title,
      requestText,
      summaryText,
    };
  }

  async checkout(
    sessionId: string,
    items: CheckoutRequest['items'],
  ): Promise<CheckoutResult> {
    const mcp = await this.mcpService.getClientForSession(sessionId);
    return checkoutCart(mcp, items);
  }

  async getProfile(sessionId: string): Promise<UserProfile> {
    const mcp = await this.mcpService.getClientForSession(sessionId);
    const accountId = await this.mcpService.getAccountId(sessionId);
    return getUserProfile(mcp, accountId, this.preferencesStore);
  }

  async savePreferences(
    sessionId: string,
    preferences: Preferences,
  ): Promise<void> {
    const accountId = await this.mcpService.getAccountId(sessionId);
    await this.preferencesStore.set(accountId, preferences);
  }

  async getDeliveryInfo(sessionId: string): Promise<DeliveryInfo> {
    const mcp = await this.mcpService.getClientForSession(sessionId);
    return this.deliveryService.getInfo(mcp);
  }

  async listDeliveryTimeslots(sessionId: string): Promise<DeliverySlot[]> {
    const mcp = await this.mcpService.getClientForSession(sessionId);
    return this.deliveryService.listTimeslots(mcp);
  }

  async setDeliveryTimeslot(
    sessionId: string,
    start: string,
    end: string,
  ): Promise<void> {
    const mcp = await this.mcpService.getClientForSession(sessionId);
    await this.deliveryService.setTimeslot(mcp, start, end);
  }

  async listDeliveryAddresses(
    sessionId: string,
  ): Promise<DeliveryAddressOption[]> {
    const mcp = await this.mcpService.getClientForSession(sessionId);
    return this.deliveryService.listMyAddresses(mcp);
  }

  async listDeliveryTimeslotsForAddress(
    sessionId: string,
    addressId: string,
  ): Promise<AddressTimeslots> {
    const mcp = await this.mcpService.getClientForSession(sessionId);
    return this.deliveryService.listTimeslotsForAddress(mcp, addressId);
  }

  async setDeliveryAddress(
    sessionId: string,
    addressId: string,
    start: string,
    end: string,
  ): Promise<void> {
    const mcp = await this.mcpService.getClientForSession(sessionId);
    await this.deliveryService.setAddress(mcp, addressId, start, end);
  }
}
