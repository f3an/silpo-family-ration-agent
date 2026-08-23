import 'dotenv/config';
import { createInterface } from 'node:readline/promises';
import Anthropic from '@anthropic-ai/sdk';
import { connectSilpoMcp } from '../mcp/client';
import { runAgentTurn } from '../agent/run';
import type { LlmClient } from '../llm/llm.types';
import { AnthropicLlmClient } from '../llm/anthropicLlmClient';
import { LocalOpenAiLlmClient } from '../llm/localOpenAiLlmClient';

/** No Nest DI here (standalone CLI) — same LLM_PROVIDER switch as
 * AnthropicService, just read straight from process.env, so this stays
 * the fastest way to smoke-test a local model (e.g. LM Studio) before
 * wiring up the whole HTTP layer: `LLM_PROVIDER=local npm run chat`. */
function buildLlmClient(): LlmClient {
  if (process.env.LLM_PROVIDER === 'local') {
    const baseUrl = process.env.LOCAL_LLM_BASE_URL;
    const model = process.env.LOCAL_LLM_MODEL;
    if (!baseUrl || !model) {
      throw new Error(
        'LLM_PROVIDER=local requires LOCAL_LLM_BASE_URL and LOCAL_LLM_MODEL (see .env.example).',
      );
    }
    if (process.env.LOCAL_LLM_API === 'openai') {
      console.log(
        `Використовую локальну модель ${model} на ${baseUrl} (OpenAI-діалект).`,
      );
      return new LocalOpenAiLlmClient(baseUrl, model);
    }
    console.log(
      `Використовую локальну модель ${model} на ${baseUrl} (Anthropic-діалект).`,
    );
    return new AnthropicLlmClient(
      new Anthropic({ apiKey: 'local', baseURL: baseUrl }),
    );
  }
  return new AnthropicLlmClient(new Anthropic());
}

/** Manual smoke-test CLI — bypasses the Nest HTTP layer for quick local testing. */
async function main() {
  console.log('Підключаюсь до Silpo MCP...');
  const mcp = await connectSilpoMcp();
  console.log(
    "Підключено. Пиши запит (напр. «зроби раціон на 3 дні для сім'ї з дитиною»). Ctrl+C для виходу.\n",
  );

  const llm = buildLlmClient();
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let history: Anthropic.MessageParam[] = [];

  while (true) {
    const userMessage = await rl.question('> ');
    if (!userMessage.trim()) continue;

    const result = await runAgentTurn(llm, mcp, history, userMessage);
    history = result.history;
    console.log(`\n${result.finalText}\n`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
