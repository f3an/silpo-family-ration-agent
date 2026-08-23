import type Anthropic from '@anthropic-ai/sdk';
import type { LlmClient, LlmCreateMessageParams } from './llm.types';

/** Thin pass-through to the real Anthropic SDK.
 *
 * `streaming` defaults to true — for the real Claude API, streaming
 * (+ .finalMessage()) instead of a plain .create() call avoids the SDK's
 * non-streaming HTTP timeout on a long multi-tool-call turn (see
 * run.ts/plan.ts's own history on this). Pass `false` when this points at
 * a local server instead (see anthropic.service.ts's LOCAL_LLM_API=anthropic
 * branch): a LAN call to your own machine has no such timeout risk, and
 * streaming turned out to be the actual cause of a real bug — LM Studio's
 * tool-call parser only reliably recognizes a `tool_use` block in the
 * non-streamed response; under streaming it sometimes leaks the raw
 * `{"name":...,"arguments":{...}}</tool_call>` text through as plain
 * content instead (confirmed live, matches LM Studio's own bug tracker —
 * see api/README.md). */
export class AnthropicLlmClient implements LlmClient {
  constructor(
    private readonly anthropic: Anthropic,
    private readonly streaming = true,
    // Only used when streaming is false. The SDK refuses a non-streaming
    // call outright above ~21333 max_tokens (run.ts/plan.ts request 32000)
    // UNLESS an explicit request timeout is given — its own heuristic
    // otherwise assumes worst-case generation speed and errors with
    // "Streaming is required for operations that may take longer than 10
    // minutes" before ever sending the request (confirmed live).
    private readonly nonStreamingTimeoutMs = 300_000,
  ) {}

  createMessage(params: LlmCreateMessageParams): Promise<Anthropic.Message> {
    // `output_config.format` is typed `unknown` in the neutral interface
    // (see llm.types.ts — only plan.ts's real zodOutputFormat() ever sets
    // it, and only this client ever needs its exact shape), hence the casts.
    if (this.streaming) {
      return this.anthropic.messages
        .stream(params as unknown as Anthropic.Messages.MessageStreamParams)
        .finalMessage();
    }
    return this.anthropic.messages.create(
      params as unknown as Anthropic.Messages.MessageCreateParamsNonStreaming,
      { timeout: this.nonStreamingTimeoutMs },
    );
  }
}
