import type Anthropic from '@anthropic-ai/sdk';
import type { LlmClient, LlmCreateMessageParams } from './llm.types';

interface OpenAiToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface OpenAiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  tool_calls?: OpenAiToolCall[];
  tool_call_id?: string;
}

interface OpenAiChatCompletionResponse {
  choices: Array<{
    finish_reason: string;
    message: { content: string | null; tool_calls?: OpenAiToolCall[] };
  }>;
}

const STOP_REASON_MAP: Record<string, Anthropic.Message['stop_reason']> = {
  stop: 'end_turn',
  tool_calls: 'tool_use',
  length: 'max_tokens',
  content_filter: 'end_turn',
};

/**
 * Overrides needed to point this same client at the REAL hosted OpenAI API
 * (as opposed to a local no-auth server) — e.g. for `gpt-5.6-luna`. All
 * default to the classic local-server behavior, so passing no options at
 * all keeps every existing local-dev call site byte-identical.
 */
export interface OpenAiClientOptions {
  /** Sent as `Authorization: Bearer <apiKey>` when present. Local servers
   * (LM Studio, Ollama, vLLM, llama.cpp) don't check auth at all. */
  apiKey?: string;
  /** GPT-5.6+ rejects the classic `max_tokens` outright and wants
   * `max_completion_tokens` instead (confirmed via OpenAI's own docs and
   * widely reported — e.g. https://github.com/BerriAI/litellm/issues/13381).
   * Local servers still expect `max_tokens`. */
  tokenParam?: 'max_tokens' | 'max_completion_tokens';
  /** GPT-5.6+ rejects `temperature` entirely — same class of "deprecated
   * for this model" 400 we hit on Claude's newest models (see
   * modelCapabilities.ts) — even `0` 400s. Local servers still want it (see
   * llm.types.ts's `temperature` doc on why local models need it at all).
   * Defaults to `true` (forward whatever the caller passed) to match prior
   * behavior. */
  sendTemperature?: boolean;
  /** On GPT-5.6+, a Chat Completions request that includes `tools` 400s
   * unless this is explicitly `'none'` — confirmed via OpenAI's own docs.
   * Also matches this app's actual needs everywhere but run.ts's
   * conversational full-tool-loop: the lean pipeline wants a fast,
   * deterministic single-shot answer, not open-ended "thinking". Omitted
   * (not sent) when unset, matching local-server behavior. */
  reasoningEffort?: string;
}

/**
 * Talks to any OpenAI-compatible `/chat/completions` server — LM Studio's
 * local server is the primary target (run a model on your own machine,
 * point this at it over the LAN — see api/README.md), but Ollama's
 * OpenAI-compat endpoint, vLLM, llama.cpp server, and (via `options` above)
 * the real hosted OpenAI API all speak close enough to the same dialect.
 * Translates Anthropic's request/response shape at this one seam — see
 * llm.types.ts for why nothing else in the app needs to know.
 *
 * No streaming (unlike anthropicLlmClient.ts) — kept simple for v1; a
 * generous AbortSignal.timeout stands in for the SDK's own timeout
 * handling instead.
 */
export class LocalOpenAiLlmClient implements LlmClient {
  constructor(
    private readonly baseUrl: string,
    private readonly model: string,
    private readonly timeoutMs = 300_000,
    private readonly options: OpenAiClientOptions = {},
  ) {}

  async createMessage(
    params: LlmCreateMessageParams,
  ): Promise<Anthropic.Message> {
    const sendTemperature = this.options.sendTemperature ?? true;
    const { response_format, wrapKey } = this.toResponseFormat(
      params.output_config?.format,
    );
    const body = {
      model: this.model,
      [this.options.tokenParam ?? 'max_tokens']: params.max_tokens,
      messages: this.toOpenAiMessages(params),
      ...(sendTemperature && params.temperature !== undefined
        ? { temperature: params.temperature }
        : {}),
      ...(this.options.reasoningEffort
        ? { reasoning_effort: this.options.reasoningEffort }
        : {}),
      ...(params.tools.length
        ? { tools: this.toOpenAiTools(params.tools) }
        : {}),
      ...(response_format ? { response_format } : {}),
    };

    const data = await this.postWithRetry(body);
    return this.toAnthropicMessage(data, wrapKey);
  }

  /**
   * Retries ONLY on a *transient* 429 (rate limit) — every other non-2xx
   * status is a real error and throws immediately, as before. Real OpenAI's
   * TPM limit is bursty in practice (confirmed live: a multi-ingredient
   * search + full tool loop can spike well past a 200k-TPM org cap for a
   * few seconds, then succeed on retry) — its 429 body names the wait via
   * "Please try again in N.NNNs", which is more precise than guessing, so
   * that's parsed first; the standard `Retry-After` header and a small
   * exponential fallback back it up for providers that don't include the
   * message. Capped at 3 retries so a persistently exhausted quota still
   * fails loudly instead of hanging.
   *
   * A 429 whose body says "Request too large" (confirmed live: a single
   * request needing 210,661 tokens against a 200,000 TPM cap) is NOT
   * transient — no amount of waiting shrinks that one request, so retrying
   * it 3 times just wastes the backoff delays before failing anyway.
   * Detected via `isRequestTooLarge` and thrown immediately instead.
   */
  private async postWithRetry(
    body: Record<string, unknown>,
  ): Promise<OpenAiChatCompletionResponse> {
    const maxRetries = 3;
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.options.apiKey
            ? { Authorization: `Bearer ${this.options.apiKey}` }
            : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (res.ok) return (await res.json()) as OpenAiChatCompletionResponse;

      const responseText = await res.text();
      if (res.status === 429 && this.isRequestTooLarge(responseText)) {
        throw new Error(
          `Local LLM server at ${this.baseUrl} returned 429: this single request exceeds the provider's tokens-per-minute limit (not a transient rate limit — retrying won't help; the conversation/tool-result history needs to shrink). ${responseText}`,
        );
      }
      if (res.status !== 429 || attempt >= maxRetries) {
        throw new Error(
          `Local LLM server at ${this.baseUrl} returned ${res.status}: ${responseText}`,
        );
      }
      const delayMs =
        this.parseRetryDelayMs(res, responseText) ?? 2000 * 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  private isRequestTooLarge(responseText: string): boolean {
    return /request too large/i.test(responseText);
  }

  /** +250ms padding on top of the server-reported wait — retrying exactly
   * at the boundary it named risks landing a hair early and drawing a
   * second 429 for the same window. */
  private parseRetryDelayMs(
    res: Response,
    responseText: string,
  ): number | undefined {
    const messageMatch = /try again in ([\d.]+)s/i.exec(responseText);
    if (messageMatch) return Math.ceil(Number(messageMatch[1]) * 1000) + 250;

    const header = res.headers.get('retry-after');
    const headerSeconds = header ? Number(header) : NaN;
    return Number.isFinite(headerSeconds)
      ? headerSeconds * 1000 + 250
      : undefined;
  }

  private toOpenAiMessages(params: LlmCreateMessageParams): OpenAiMessage[] {
    const systemText = params.system.map((b) => b.text).join('\n\n');
    const out: OpenAiMessage[] = systemText
      ? [{ role: 'system', content: systemText }]
      : [];

    for (const m of params.messages) {
      if (typeof m.content === 'string') {
        out.push({ role: m.role, content: m.content });
        continue;
      }

      if (m.role === 'user') {
        // Anthropic bundles tool_results as sibling content blocks inside
        // ONE user message; OpenAI wants each as its own role:'tool'
        // message instead.
        for (const block of m.content) {
          if (block.type === 'tool_result') {
            out.push({
              role: 'tool',
              tool_call_id: block.tool_use_id,
              content:
                typeof block.content === 'string'
                  ? block.content
                  : JSON.stringify(block.content ?? ''),
            });
          } else if (block.type === 'text') {
            out.push({ role: 'user', content: block.text });
          }
        }
        continue;
      }

      // assistant — text and tool_use blocks collapse into ONE OpenAI
      // message (content + tool_calls side by side), not separate ones.
      const textParts: string[] = [];
      const toolCalls: OpenAiToolCall[] = [];
      for (const block of m.content) {
        if (block.type === 'text') textParts.push(block.text);
        else if (block.type === 'tool_use') {
          toolCalls.push({
            id: block.id,
            type: 'function',
            function: {
              name: block.name,
              arguments: JSON.stringify(block.input),
            },
          });
        }
      }
      out.push({
        role: 'assistant',
        content: textParts.length ? textParts.join('\n') : null,
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      });
    }

    return out;
  }

  /**
   * `output_config.format` is whatever `zodOutputFormat()` produced —
   * `{type:'json_schema', schema: <real JSON Schema>, parse}` (confirmed by
   * reading `@anthropic-ai/sdk/src/helpers/zod.ts`). The classic
   * `{type:'json_object'}` OpenAI-dialect hint used to be sent here but LM
   * Studio rejects it outright with a 400 ("must be 'json_schema' or
   * 'text'"). `{type:'json_schema', json_schema:{schema,...}}` is not just
   * accepted — confirmed live this session — it's real grammar-constrained
   * token sampling (llama.cpp's GBNF grammar under the hood), unlike
   * `output_config.format` on the Anthropic-dialect endpoint, which LM
   * Studio silently ignores. This is what makes a weak local model reliably
   * produce schema-valid JSON instead of prose or a differently-shaped
   * object.
   *
   * The real hosted OpenAI API additionally requires the ROOT schema to be
   * `type: 'object'` — a zod `discriminatedUnion` (e.g. leanChatRouter.ts's
   * `ChatRouteSchema`) compiles to a rootless `{anyOf: [...]}` instead,
   * which OpenAI 400s on: "schema must be a JSON Schema of 'type: object',
   * got 'type: None'" (confirmed live). So a non-object root schema gets
   * wrapped in a single-property object here — `toAnthropicMessage` below
   * unwraps that property back out of the response, so callers
   * (`parseStructuredResponse`) never know this happened. Harmless for
   * local grammar-constrained servers too (same constraint, just nested one
   * level deeper), so this isn't gated behind `options` — any non-object
   * root schema gets wrapped regardless of provider.
   */
  private toResponseFormat(format: unknown): {
    response_format?: unknown;
    wrapKey?: string;
  } {
    if (
      !format ||
      typeof format !== 'object' ||
      !('schema' in format) ||
      !format.schema
    ) {
      return {};
    }
    const schema = format.schema as { type?: string };
    const wrapKey = schema.type === 'object' ? undefined : 'value';
    const wireSchema = wrapKey
      ? {
          type: 'object',
          properties: { [wrapKey]: schema },
          required: [wrapKey],
          additionalProperties: false,
        }
      : schema;
    return {
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'response', strict: true, schema: wireSchema },
      },
      wrapKey,
    };
  }

  /** Reverses `toResponseFormat`'s request-side wrap. Falls back to the raw
   * text on a parse failure (e.g. truncated output) rather than throwing
   * here — `parseStructuredResponse` already has a clearer max_tokens-aware
   * error path for that; this just shouldn't swallow it into a confusing
   * "no [key] property" failure instead. */
  private unwrap(rawContent: string, key: string): string {
    try {
      const parsed = JSON.parse(rawContent) as Record<string, unknown>;
      return JSON.stringify(parsed[key]);
    } catch {
      return rawContent;
    }
  }

  private toOpenAiTools(tools: Anthropic.Tool[]) {
    return tools.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    }));
  }

  /** Only fields run.ts/plan.ts actually read (content blocks' type/text/
   * id/name/input, and stop_reason) are filled in faithfully — the rest of
   * Anthropic.Message's shape (usage, container, id format, ...) is
   * synthesized filler nothing in this app inspects, hence the cast.
   *
   * `wrapKey` mirrors `toResponseFormat`'s request-side wrapping — when
   * set, the model's JSON came back as `{[wrapKey]: <actual value>}` and
   * needs unwrapping before `parseStructuredResponse` (which validates
   * against the ORIGINAL, unwrapped zod schema) ever sees it. */
  private toAnthropicMessage(
    data: OpenAiChatCompletionResponse,
    wrapKey?: string,
  ): Anthropic.Message {
    const choice = data.choices[0];
    if (!choice) {
      throw new Error('Local LLM server returned no choices in its response.');
    }

    const content: unknown[] = [];
    if (choice.message.content) {
      content.push({
        type: 'text',
        text: wrapKey
          ? this.unwrap(choice.message.content, wrapKey)
          : choice.message.content,
        citations: null,
      });
    }
    for (const call of choice.message.tool_calls ?? []) {
      let input: unknown = {};
      try {
        input = JSON.parse(call.function.arguments || '{}');
      } catch {
        throw new Error(
          `Local LLM produced invalid JSON tool-call arguments for "${call.function.name}": ${call.function.arguments}`,
        );
      }
      content.push({
        type: 'tool_use',
        id: call.id,
        name: call.function.name,
        input,
      });
    }

    return {
      id: `local-${Date.now()}`,
      type: 'message',
      role: 'assistant',
      model: this.model,
      content,
      stop_reason: STOP_REASON_MAP[choice.finish_reason] ?? 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    } as unknown as Anthropic.Message;
  }
}
