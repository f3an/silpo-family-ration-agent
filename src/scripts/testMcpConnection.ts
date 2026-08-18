import 'dotenv/config';
import { connectSilpoMcp } from '../mcp/client';

async function main() {
  console.log('Підключаюсь до Silpo MCP (https://mcp.silpo.ua/mcp)...\n');
  const mcp = await connectSilpoMcp();
  console.log('✅ Підключено і авторизовано.\n');

  const { tools } = await mcp.listTools();
  console.log(`Знайдено ${tools.length} tools:`);
  for (const tool of tools) {
    console.log(`  - ${tool.name}`);
  }

  await mcp.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Помилка підключення:', err);
  process.exit(1);
});
