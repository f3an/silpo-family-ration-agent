# silpo-family-ration-agent

Agentic AI that plans a family's weekly meals and builds the cart via Silpo's official MCP server — built for «Сільпо» AI Factory: Хакатон ідей.

## Проблема

Планування раціону на сім'ю — це рутина: підібрати меню під бюджет і обмеження (алергії, вік дітей), знайти правильні товари (а не перший-ліпший збіг за назвою), зібрати кошик і не вилізти за бюджет. Зараз це робить людина вручну, товар за товаром.

## Що робить агент

За описом сім'ї (склад, дієтичні обмеження, бюджет, кількість днів) агент:

1. Читає контекст користувача через `silpo_get_my_family`, `silpo_get_my_food_restrictions`, `silpo_get_my_profile`.
2. Визначає філію/слот доставки (`silpo_get_my_shopping_cart` → `silpo_get_shopping_cart_by_id` → `silpo_get_time_slots`).
3. Будує меню і зводить його до списку інгредієнтів.
4. Шукає товари (`silpo_find_products_batch`) і **відбирає релевантні, а не найдешевші** збіги — наївний підхід «бери перший/найдешевший результат» системно ламається (див. «Відомі edge-кейси» нижче).
5. Додає товари в кошик (`silpo_add_or_update_cart_products`), перевіряє валідацію кошика і за потреби підрізає кількість під реальний залишок.
6. Перевіряє бонуси/купони/акції (`silpo_get_loyalty_info`, `silpo_get_my_coupons`, `silpo_get_promotions`) і повідомляє, чим можна скористатись.
7. Дає підсумок: що в кошику, скільки коштує, які рішення прийняв і чому.

## Відомі edge-кейси (знайдені живим тестуванням MCP)

Ці знахідки — основа «агентності» рішення, а не просто обгортка над API:

- **Найдешевший результат пошуку ≠ правильний товар.** Сортування за ціною серед `find_products_batch` результатів для «куряче філе» видає корм для котів, для «морква» — приправу, для «лимон» — жуйку. Потрібен відбір за релевантністю.
- **Навіть без сортування за ціною топ-5 часто хибний.** Дефолтна видача для «куряче філе» — качка, копчені делікатеси, корм для котів/собак (усі 7 результатів нерелевантні); для «локшина»/«вермішель» — 24-30 результатів суцільно ароматизованої локшини швидкого приготування. Правильний товар («Вироби макаронні La Pasta вермішель») знайшовся аж на 23-й позиції з 24 — агент має переглядати список повністю, а не тільки топ-5.
- **Багатослівні запити повертають 0 результатів** (`"петрушка зелень"`, `"фарш яловичий"`), однослівні працюють. Потрібна нормалізація назв інгредієнтів.
- **Товару може не бути на конкретній філії** — тоді потрібна заміна страви/інгредієнта, а не мовчазний пропуск.
- **Доступність товару в пошуку залежить від дати доставки, не тільки від філії.** Той самий запит «цибуля» на слот «сьогодні» повертає «Цибуля ріпчаста рання» серед 30 результатів; той самий запит на слот «завтра» — теж 30 результатів, але без цього товару взагалі. Товар не можна вважати «відсутнім на філії» без перевірки на конкретну дату.
- **Складські ліміти:** валідація кошика (`product.offer.stock.max`) може відрізнятись від стоку, який показують `find_products_batch`/`get_similar_products` для того самого товару — довіряти варто тільки числу з кошика.
- **`silpo_get_replacements` часто повертає порожній список** навіть коли товар відсутній — потрібен fallback на `silpo_get_similar_products`.

Ці правила закодовані в `src/agent/systemPrompt.ts` як інструкції агенту; повноцінна обробка кожного edge-кейсу — предмет доробки під час хакатону.

## Стек

Стандартний скелет [Nest CLI](https://docs.nestjs.com/) (`nest new`) — модулі, DI, контролери, ESLint/Prettier, unit + e2e Jest — поверх TypeScript. Офіційний `@modelcontextprotocol/sdk` (OAuth 2.1 + PKCE до `mcp.silpo.ua`) та `@anthropic-ai/sdk` (Claude Sonnet 5, ручний tool-use цикл).

## Запуск

```bash
npm install
cp .env.example .env
npm run dev              # nest start --watch, HTTP API на :3000
```

При першому запуску відкриється браузер для авторизації в Сільпо (`auth.silpo.ua`); токени кешуються в `.silpo-tokens.json`, тож повторна авторизація не потрібна.

**Claude-автентифікація:** `ANTHROPIC_API_KEY` у `.env` — опційний для локальної розробки. Якщо не задати, `AnthropicService` сам фолбекає на локальний credential chain SDK — наприклад профіль підписки з `ant auth login` (перевірити що активно: `ant auth status`). Для CI/продакшену — задай `ANTHROPIC_API_KEY` явно.

**HTTP API:**

```bash
curl http://localhost:3000/                # health-check
curl -X POST http://localhost:3000/agent/messages \
  -H "Content-Type: application/json" \
  -d '{"sessionId": "demo", "message": "зроби раціон на 3 дні для сім'\''ї з дитиною 5 років"}'
```

**Без HTTP-шару** (швидкий ручний тест у консолі): `npm run chat`.
**Лише OAuth/MCP підключення** (без Anthropic-ключа): `npm run test:mcp`.

## Тести

```bash
npm test          # unit — усі зовнішні виклики замокані
npm run test:e2e   # реальний HTTP-пайплайн (routing → controller → service), MCP/Anthropic підмінені
npm run lint        # ESLint + Prettier
```

11 unit-тестів: конвертація MCP tools → Anthropic tool schema (`mcpTools.spec.ts`), сам agentic tool-use цикл із замоканими Anthropic/MCP клієнтами — включно з ізоляцією історії між сесіями (`agent.service.spec.ts`), контролер (`agent.controller.spec.ts`) і health-check (`app.controller.spec.ts`). Плюс 3 e2e-тести (`test/app.e2e-spec.ts`) через `supertest` з `overrideProvider` для `McpService`/`ANTHROPIC_CLIENT` — жодних реальних викликів до Сільпо чи Claude під час тестів.

## Структура

Канонічна структура Nest CLI: `nest-cli.json`, `tsconfig.build.json`, `eslint.config.mjs`/`.prettierrc`, юніт-тести (`*.spec.ts`) поруч із кодом, e2e — в окремому `/test`.

```
src/
  main.ts                       # Nest bootstrap (HTTP API, :3000)
  app.module.ts
  app.controller.ts              # GET / health-check
  app.service.ts
  mcp/
    oauthProvider.ts             # OAuth 2.1 + PKCE провайдер з локальним callback-сервером
    client.ts                     # підключення до https://mcp.silpo.ua/mcp
    mcp.service.ts                 # Nest-обгортка: тримає єдине з'єднання з MCP
    mcp.module.ts
  agent/
    systemPrompt.ts                # сценарій і правила відбору товарів/edge-кейси
    mcpTools.ts                    # конвертація MCP tools у формат Anthropic Messages API
    run.ts                          # чистий agentic loop (Claude Sonnet 5 + tool_use)
    agent.service.ts                 # оркестрація: історія розмов по сесіях + run.ts
    agent.controller.ts              # POST /agent/messages
    agent.module.ts
    tokens.ts                         # DI-токен ANTHROPIC_CLIENT (щоб тести підміняли клієнт)
    *.spec.ts                          # unit-тести
  scripts/
    chat.ts                             # інтерактивний CLI (без HTTP)
    testMcpConnection.ts                 # ізольований тест OAuth/MCP (без Anthropic-ключа)
test/
  app.e2e-spec.ts                          # e2e через supertest
  jest-e2e.json
```

## Хакатон

«Сільпо» AI Factory: Хакатон ідей — [ai-factory.silpo.ua](https://ai-factory.silpo.ua). Дедлайн подачі: 14.09.2026. Критерії журі: цінність для гостя/бізнесу, якість використання MCP, агентність рішення, реалістичність інтеграції, якість прототипу, валідація та масштабування.
