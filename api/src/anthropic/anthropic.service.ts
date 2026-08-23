import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import type { LlmClient } from '../llm/llm.types';
import { AnthropicLlmClient } from '../llm/anthropicLlmClient';
import { LocalOpenAiLlmClient } from '../llm/localOpenAiLlmClient';

const DEFAULT_LOCAL_TIMEOUT_MS = 300_000;

/**
 * Picks ONE model backend for the whole app at boot, based on
 * `LLM_PROVIDER` (default `'anthropic'`):
 * - `'anthropic'` — the real Claude API, needs `ANTHROPIC_API_KEY`. No
 *   credential-chain fallback: an `ant auth login` subscription profile
 *   authenticates fine but bills against the org's separate API credit
 *   balance, which is a confusing failure mode for local dev.
 * - `'openai'` — the real hosted OpenAI API, needs `OPENAI_API_KEY`.
 *   `OPENAI_MODEL` picks the model (default `gpt-5.6-luna` — OpenAI's
 *   cheap/fast tier, ~4-5x cheaper than Claude Haiku 4.5). Reuses
 *   `LocalOpenAiLlmClient` (same `/chat/completions` dialect) with the
 *   `OpenAiClientOptions` overrides GPT-5.6+ actually requires: auth
 *   header, `max_completion_tokens` instead of `max_tokens`, no
 *   `temperature` at all (400s if present, like Claude's newest models),
 *   and `reasoning_effort:'none'` (a Chat Completions request with `tools`
 *   400s without it) — see localOpenAiLlmClient.ts's `OpenAiClientOptions`
 *   doc for sources. Untested against this app's actual quality bar as of
 *   this writing — worth an empirical run (same kind of diagnostic script
 *   used to validate Haiku) before trusting it over Sonnet/Haiku for real.
 * - `'local'` — a server on your own machine/LAN, reachable at
 *   `LOCAL_LLM_BASE_URL`, running `LOCAL_LLM_MODEL` — for when Anthropic
 *   credits run out but you still want to demo end-to-end. `LOCAL_LLM_API`
 *   picks the dialect it speaks:
 *   - `'anthropic'` (default) — confirmed live against LM Studio's local
 *     server, which (as of its 0.4+ line) also exposes a native
 *     Anthropic-compatible `/v1/messages` alongside the OpenAI one, real
 *     `tool_use`/`system`/`output_config` and all. Just the real
 *     `@anthropic-ai/sdk` pointed at a different `baseURL` — zero
 *     translation, so none of the dialect-mismatch bugs the OpenAI path
 *     hit (e.g. LM Studio 400s on `response_format:{type:'json_object'}`,
 *     which the OpenAI dialect otherwise wants to send for plan.ts).
 *   - `'openai'` — the OpenAI-compatible `/chat/completions` dialect
 *     (Ollama, vLLM, llama.cpp server, or an older LM Studio without the
 *     Anthropic endpoint) — see llm/localOpenAiLlmClient.ts for the
 *     request/response translation this needs.
 *   Either way run.ts/plan.ts call the exact same `getClient().
 *   createMessage()` — see llm/llm.types.ts.
 */
@Injectable()
export class AnthropicService {
  private readonly logger = new Logger(AnthropicService.name);
  private readonly client: LlmClient;
  // Set only for LLM_PROVIDER=local + LOCAL_LLM_API=openai +
  // LOCAL_DRAFT_LLM_MODEL — a second fixed-model client for dish/plan
  // drafting specifically. Validated live: qwen2.5-7b-instruct (this app's
  // default local model — fast/accurate at picking real productIds from
  // candidates) hallucinates non-word ingredient names when asked to draft
  // a dish from scratch, even at temperature 0; meta-llama-3.1-8b-instruct
  // produced real Ukrainian ingredient words for the same prompt. The
  // OpenAI dialect is the only one confirmed to route by the request's
  // `model` field — the Anthropic-dialect path always serves whatever's
  // loaded regardless (see the `api === 'openai'` branch below) — so a
  // second client instance, not a per-call model override, is how this
  // works.
  private readonly draftClient?: LlmClient;

  constructor(configService: ConfigService) {
    const provider = configService.get<string>('LLM_PROVIDER') ?? 'anthropic';

    if (provider === 'local') {
      const baseUrl = configService.get<string>('LOCAL_LLM_BASE_URL');
      const model = configService.get<string>('LOCAL_LLM_MODEL');
      if (!baseUrl || !model) {
        throw new Error(
          'LLM_PROVIDER=local requires LOCAL_LLM_BASE_URL (e.g. http://192.168.1.50:1234/v1, no trailing slash) and LOCAL_LLM_MODEL (the model id loaded in your local server).',
        );
      }
      const api = configService.get<string>('LOCAL_LLM_API') ?? 'anthropic';
      const timeoutMs =
        Number(configService.get<string>('LOCAL_LLM_TIMEOUT_MS')) ||
        DEFAULT_LOCAL_TIMEOUT_MS;

      if (api === 'openai') {
        this.client = new LocalOpenAiLlmClient(baseUrl, model, timeoutMs);
        this.logger.log(
          `Using local LLM at ${baseUrl} (OpenAI dialect, model: ${model}).`,
        );
        const draftModel = configService.get<string>('LOCAL_DRAFT_LLM_MODEL');
        if (draftModel) {
          this.draftClient = new LocalOpenAiLlmClient(
            baseUrl,
            draftModel,
            timeoutMs,
          );
          this.logger.log(
            `Using a separate local model for drafting: ${draftModel}.`,
          );
        }
      } else {
        // LOCAL_LLM_BASE_URL is documented (and needed by the OpenAI
        // dialect above) to already include the /v1 suffix — but the
        // Anthropic SDK appends its own /v1/messages onto whatever baseURL
        // it's given, so passing that same value straight through doubles
        // up into .../v1/v1/messages (confirmed live). Strip one trailing
        // /v1 so the same env value works for either dialect unchanged.
        const anthropicBaseUrl = baseUrl.replace(/\/v1\/?$/, '');
        // No apiKey requirement — local servers don't check it, but the SDK
        // requires a non-empty string to construct. streaming: false — see
        // AnthropicLlmClient's own comment on why (LM Studio's tool-call
        // parser is unreliable under streaming, confirmed live).
        this.client = new AnthropicLlmClient(
          new Anthropic({ apiKey: 'local', baseURL: anthropicBaseUrl }),
          false,
          timeoutMs,
        );
        this.logger.log(
          `Using local LLM at ${anthropicBaseUrl} (Anthropic dialect, model: ${model}).`,
        );
      }
    } else if (provider === 'openai') {
      const apiKey = configService.get<string>('OPENAI_API_KEY');
      if (!apiKey) {
        throw new Error(
          'OPENAI_API_KEY is required when LLM_PROVIDER=openai (see https://platform.openai.com/api-keys).',
        );
      }
      const model = configService.get<string>('OPENAI_MODEL') ?? 'gpt-5.6-luna';
      const reasoningEffort =
        configService.get<string>('OPENAI_REASONING_EFFORT') ?? 'none';
      const timeoutMs =
        Number(configService.get<string>('LOCAL_LLM_TIMEOUT_MS')) ||
        DEFAULT_LOCAL_TIMEOUT_MS;
      this.client = new LocalOpenAiLlmClient(
        'https://api.openai.com/v1',
        model,
        timeoutMs,
        {
          apiKey,
          tokenParam: 'max_completion_tokens',
          sendTemperature: false,
          reasoningEffort,
        },
      );
      this.logger.log(`Using real OpenAI API (model: ${model}).`);
    } else {
      const apiKey = configService.get<string>('ANTHROPIC_API_KEY');
      if (!apiKey) {
        throw new Error(
          'ANTHROPIC_API_KEY is required when LLM_PROVIDER=anthropic (see https://console.anthropic.com/) — or set LLM_PROVIDER=local/openai to use a different model backend instead (see .env.example).',
        );
      }
      this.client = new AnthropicLlmClient(new Anthropic({ apiKey }));
      this.logger.log('Using ANTHROPIC_API_KEY.');
    }
  }

  getClient(): LlmClient {
    return this.client;
  }

  getDraftClient(): LlmClient {
    return this.draftClient ?? this.client;
  }
}
