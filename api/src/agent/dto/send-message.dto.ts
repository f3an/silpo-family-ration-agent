export class SendMessageDto {
  sessionId!: string;
  message!: string;
  /** Omitted to start a new conversation — see AgentService.sendMessage. */
  conversationId?: string;
  /** Optional short human-readable stand-in for `message` in the persisted/
   * displayed chat turn — see AgentService.sendMessage. Used when the client
   * auto-composes `message` with embedded JSON (e.g. an ingredient-swap
   * request) that Claude needs but a guest shouldn't see as their bubble. */
  displayMessage?: string;
}
