import type Anthropic from '@anthropic-ai/sdk';

export interface LlmCreateMessageParams {
  model: string;
  max_tokens: number;
  system: Anthropic.Messages.TextBlockParam[];
  tools: Anthropic.Tool[];
  messages: Anthropic.MessageParam[];
  /** Omitted (provider default) for the conversational full-tool-loop path
   * (run.ts's runFullToolLoopTurn) — deciding what to say/ask benefits from
   * some variance. Explicitly `0` on every lean structured-output call
   * (leanChatRouter.ts/plan.ts/leanProductResolver.ts) — a judgment/
   * extraction task wants the model's single most coherent answer, not
   * variety. Confirmed live this session: without this, a local model's
   * default sampling temperature produced garbled non-word ingredient
   * names ("гарнійон", "булочковий бульйон") that of course matched no
   * real product. */
  temperature?: number;
  /** `effort` is forwarded as-is (only the real Anthropic client uses it).
   * `format` is whatever `zodOutputFormat()` produced (plan.ts) — opaque
   * here; a local provider only checks whether it's set, to opt into
   * best-effort JSON mode, not what shape it is. */
  output_config?: { effort?: 'low' | 'medium' | 'high'; format?: unknown };
}

/**
 * Provider-neutral seam for "send this turn to a model, get back a
 * message" — everything ABOVE this line (run.ts, plan.ts, Postgres message
 * storage, widgets) keeps speaking Anthropic's own Message/MessageParam
 * shape natively. Translating at this one boundary is far less invasive
 * than rewriting the whole domain model into a third neutral format that
 * neither the real API nor a local OpenAI-compatible server actually uses
 * as-is — see anthropicLlmClient.ts / localOpenAiLlmClient.ts for the two
 * implementations, and anthropic/anthropic.service.ts for how one gets
 * picked at boot via LLM_PROVIDER.
 */
export interface LlmClient {
  createMessage(params: LlmCreateMessageParams): Promise<Anthropic.Message>;
}
