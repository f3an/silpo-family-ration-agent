export class FamilyMessageDto {
  sessionId!: string;
  message!: string;
  /** Omitted to start a new family conversation — see
   * AgentService.sendFamilyMessage. */
  conversationId?: string;
  /** See SendMessageDto's own displayMessage — same mechanism, needed here
   * too since the ingredient-swap/basket-item-swap widgets compose a
   * JSON-carrying `message` regardless of which chat scope they're
   * rendered in. */
  displayMessage?: string;
}
