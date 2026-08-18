import 'dotenv/config';
import { createInterface } from 'node:readline/promises';
import Anthropic from '@anthropic-ai/sdk';
import { connectSilpoMcp } from '../mcp/client';
import { runAgentTurn } from '../agent/run';

/** Manual smoke-test CLI — bypasses the Nest HTTP layer for quick local testing. */
async function main() {
  console.log('Підключаюсь до Silpo MCP...');
  const mcp = await connectSilpoMcp();
  console.log(
    "Підключено. Пиши запит (напр. «зроби раціон на 3 дні для сім'ї з дитиною»). Ctrl+C для виходу.\n",
  );

  const anthropic = new Anthropic();
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let history: Anthropic.MessageParam[] = [];

  while (true) {
    const userMessage = await rl.question('> ');
    if (!userMessage.trim()) continue;

    const result = await runAgentTurn(anthropic, mcp, history, userMessage);
    history = result.history;
    console.log(`\n${result.finalText}\n`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
