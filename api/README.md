# api

NestJS-бекенд агента. Частина монорепо [silpo-family-ration-agent](../README.md); клієнт — у [`../client`](../client/README.md).

## Проблема

Планування раціону на сім'ю — це рутина: підібрати меню під бюджет і обмеження (алергії, вік дітей), знайти правильні товари (а не перший-ліпший збіг за назвою), зібрати кошик і не вилізти за бюджет. Зараз це робить людина вручну, товар за товаром.

## Що робить агент

Один чат поверх одного MCP-підключення — картковий раціон і вільний текст обидва живуть в одному Postgres-треді, не в паралельних режимах (`client/` це так і показує: один екран, sidenav тредів, картки й бульбашки в одній стрічці):

0. `GET /agent/profile` — "особистий кабінет": `people`/`allergens` читаються прямо з акаунту Сільпо (`silpo_get_my_family`, `silpo_get_my_food_restrictions` — read-only, MCP не дає tool для запису туди), `firstName`/`lastName`/`phone` — звідти ж, `silpo_get_my_profile` (той самий виклик, що дає `accountId`), а `preferences` (кухня/обладнання/бюджет/формат готування) — це те, що гість зберіг раніше через `POST /agent/preferences`; зберігається в Postgres (`user_preferences`), прив'язано до стабільного `accountId` (`silpo_get_my_profile().profile.id`), тож переживає інший браузер/пристрій і рестарт сервера, поки це той самий акаунт Сільпо.
1. `POST /agent/plan` — структурований шлях: агент визначає філію/слот доставки (`silpo_get_my_shopping_cart` → `silpo_get_shopping_cart_by_id`), будує список страв під профіль (`PlanRequestSchema` — форма, не вільний текст), шукає товари під кожен інгредієнт (`silpo_find_products_batch`) і **відбирає релевантні, а не найдешевші** збіги (див. «Відомі edge-кейси» нижче). `conversationId` у тілі — опційний, той самий тред, куди пише `/agent/messages`; без нього створюється новий. Результат не просто повертається клієнту — він одразу лягає в цей тред: короткий текстовий підсумок у `messages` (те, що бачить Claude — щоб follow-up у чаті мав контекст) і повний `dishes[]` (БЖУ/калораж, фото інгредієнтів, `productId`) окремо в `widgets` (те, що бачить клієнт як картку — **ніколи** не йде назад у Claude, щоб не роздувати вартість кожного наступного ходу розміром раціону). Відповідь: `{ dishes, conversationId, title, requestText, summaryText }` — `requestText`/`summaryText` дають клієнту оптимістично намалювати ті самі дві репліки, які покаже перезавантаження треду, без зайвого GET.
2. Гість обирає страви карточками на клієнті (в межах картки того ходу — регенерація додає новий рядок у тред, не переписує попередній).
3. `POST /agent/checkout` — без жодного виклику Claude, лише агрегує обрані інгредієнти за `productId` і додає їх у реальний кошик гостя (`silpo_add_or_update_cart_products`).

**Вільний текст у тому самому треді** (`POST /agent/messages`) — гість пише повідомлення, агент сам вирішує які MCP tools викликати (може обговорити раціон, відповісти на питання про товари/бонуси/купони/акції). `POST /agent/messages` без `conversationId` починає нову розмову, авто-титул береться з першого повідомлення; далі `conversationId` — з відповіді, той самий, що повертає й `/agent/plan`. Треди — Postgres (`chat_conversations`, `agent/chatConversation.service.ts`), прив'язані до `accountId`, з повною історією повідомлень (включно з tool-use/tool-result раундами — потрібні Claude, щоб продовжувати розмову) як JSONB, плюс окрема `widgets` колонка (те саме, що записує `/agent/plan`). `GET /agent/chats` — список тредів (id/title/updatedAt) для sidenav клієнта; `GET /agent/chats/:id` — одна розмова, повідомлення звужені до plain `{role, text, widget?}` (`agent/chatTranscript.ts` — прибирає tool-use "шум" і по індексу підклеює `widget`, якщо на цьому ході був `/agent/plan` **або** одна конкретна страва — див. нижче); `DELETE /agent/chats/:id`. Усі маршрути — під `getAccountId`, тож 401 без активного логіну.

**Одна конкретна страва прямо в чаті** — третій спосіб дістати картку, поряд із формою (`/agent/plan`) і звичайною відповіддю текстом. Гість просить одну страву (назва + порції), а не повний раціон; якщо назва неоднозначна (напр. «борщ» — класичний/пісний/з м'ясом), агент коротко пропонує 2-3 варіанти звичайним текстом і чекає відповіді — це просто звичайний хід цього самого tool-use циклу, нічого спеціального не потрібно, щоб дозволити ЦЕ. Коли деталей достатньо — агент шукає реальні товари Сільпо під кожен інгредієнт (ті самі MCP tools, ті самі правила чесності, що й для повного раціону — `systemPrompt.ts`), і завершує хід локальним (не-MCP) tool `propose_dish_card` (`agent/run.ts`) — `runAgentTurn` перехоплює саме цей виклик, `DishSchema.safeParse` його `input`, і повертає хід одразу з готовою стравою, замість продовжувати цикл. `AgentService.sendMessage` перетворює це на той самий `dish_plan` widget, що й `/agent/plan` (масив із однією стравою) і зберігає так само — тому й клієнту не треба нічого нового рендерити. Якщо форма виклику невалідна — `runAgentTurn` віддає модель `tool_result` з `is_error: true` (як для будь-якого невдалого tool-виклику) і дає їй спробувати ще раз у тому самому ході. Промпт явно каже не додавати нічого в кошик самому в цьому сценарії — картка з кнопкою купівлі вже показується гостю в клієнті.

**Дитяче меню** — прапорець `forChildren` на `PlanRequestSchema`/`/agent/plan`, не окремий widget-kind. `plan.ts`'s `describeProfile()` додає рядок "Дитяче меню: так/ні" у профіль, `planSystemPrompt.ts` містить умовну інструкцію (м'які смаки, менші порції, уникати ризику удушення для малюків) — вік дитини в акаунті недоступний (`silpo_get_my_family` дітей повертає без віку), тож промпт за замовчуванням орієнтується на молодший вік, якщо `notes` не кажуть інше.

**Набір під подію** — четвертий спосіб дістати картку: НЕ рецепт, а курована підбірка реальних товарів під тему (день народження, гриль, пікнік). Другий локальний (не-MCP) tool у `run.ts` поряд із `propose_dish_card` — `propose_occasion_basket`, з окремою `OccasionBasketSchema` (`theme`/`description`/`guestCount`/`items` — items тієї ж форми, що й інгредієнти страви, просто не прив'язані до рецепту). Промпт (`systemPrompt.ts`) каже спершу спробувати `silpo_get_product_sets`/`silpo_get_products({set})` для готової кураторської підбірки під тему, і лише якщо нічого не підійшло — `silpo_get_popular_categories`/`silpo_get_categories_tree` + звичайний пошук. `ChatWidget` — тепер дискримінований union (`dish_plan` | `occasion_basket`), `chatTranscript.ts` не змінювався (вже прив'язує widget по індексу незалежно від kind). Клієнт: `OccasionBasketWidget.jsx` (нова, спрощена версія `DishPlanWidget` — без макросів/`daysCovered`, плаский список товарів), `OccasionForm.jsx` (за зразком `DishForm.jsx`).

**Заміна інгредієнта картками (не текстом)** — третій локальний tool `propose_ingredient_options` (поряд із `propose_dish_card`/`propose_occasion_basket`), `IngredientOptionsSchema` (`ingredientName` + 2-3 `options[]`, кожен — реальний товар з `productId`/ціною/фото). Клієнт: `IngredientOptionsWidget.jsx` рендерить картки замість нумерованого тексту; клік на "Обрати" шле нове повідомлення з повним JSON страви/набору (той самий widget, що передував картці варіантів, — `ChatPanel.jsx` шукає його скануванням попередніх повідомлень, бекенд його ніде не зберігає окремо) плюс обраний варіант, і агент фіналізує оновлену картку так само, як звичайну заміну. Також: `SendMessageDto`/`AgentService.sendMessage` тепер приймають опційний `displayMessage` — короткий людський текст, який зберігається/показується в чаті ЗАМІСТЬ повного `message` (той, що реально йде до Claude), коли клієнт сам компонує повідомлення з вбудованим JSON (усі три сценарії заміни — інгредієнт у стравi, товар у наборі, вибір з карток — цим користуються, щоб гість не бачив сирий JSON у своєму бабблі).

**`npm run chat`** — окремий debug-скрипт (`src/scripts/chat.ts`), напряму через `connectSilpoMcp()`/`runAgentTurn`, без Nest HTTP-шару, без акаунта/сесії/історії в Postgres. Для ручного дебагу MCP без піднятого клієнта — не пов'язаний з `/agent/messages`.

**Сімейні чати** — `agent/family.service.ts`'s `FamilyStore` групує Silpo-акаунти в спільні треди без жодного invite-коду з нашого боку: MCP не дає інструменту, який лінкує окремі акаунти напряму, але `silpo_get_my_family`'s `members[].profileId` — це і є Silpo account id того члена сім'ї (підтверджено живим викликом: `profileId` члена дорівнює тому, що `silpo_get_my_profile().profile.id` поверне ЙОМУ САМОМУ, коли він залогіниться). `FamilyStore.sync(mcp, accountId)` читає цей список і реєструє/розширює запис у `families`/`family_members` під ВСІХ перелічених учасників одразу (включно з тими, хто ще жодного разу не заходив в агента) — тож коли другий акаунт реально логіниться, його `account_id` вже прив'язаний до тієї самої сім'ї. Викликається лениво з `GET /agent/family` (ідемпотентно — повторний виклик не створює дублікат) і повертає `familyId: null` для акаунту без реальної сім'ї в Сільпо (менше 2 учасників) — саме так клієнт вирішує, чи показувати "👪 Сімейні чати" в sidenav взагалі.

Сімейний тред — та сама таблиця `chat_conversations`/сервіс `ChatConversationStore`, що й особисті треди: `account_id`-колонка просто тримає `families.id` замість Silpo `accountId` для таких рядків (два UUID-простори від непов'язаних генераторів, реальна колізія не є практичним ризиком — див. коментар у `db/schema.ts`). `AgentService.sendFamilyMessage`/`listFamilyChats`/`getFamilyChat`/`deleteFamilyChat` — ті самі методи, що й особисті, приватний `runChatTurn()` факторизований з колишнього тіла `sendMessage`, тепер приймає `ownerId` (accountId чи familyId) параметром; кожен family-метод спершу резолвить `familyId` через `FamilyStore.getFamilyIdForAccount(accountId)` і кидає 403, якщо акаунт не в сім'ї. `runAgentTurn` (`run.ts`) приймає опційний `extraSystemContext` — для сімейного треду це `FAMILY_CHAT_CONTEXT` (`systemPrompt.ts`), окремий system-блок ПІСЛЯ основного закешованого промпту, тож особисті чати й далі мають той самий байт-в-байт закешований префікс, що й раніше.

`/agent/plan` (структурований wizard-флоу — не чат-цикл) підтримує сімейні треди так само: `PlanRequestSchema` має `familyChat: boolean` (за замовчуванням `false`). Сама генерація (`planMeals(anthropic, mcp, profile)` — той самий `plan.ts`, той самий Redis-кеш за `accountId`+профілем) не змінюється, бо вона й так завжди йде через дані ПОТОЧНОГО залогіненого акаунту; змінюється лише те, в чий тред (`AgentService#appendPlanToConversation`) лягає готова картка — `accountId` чи резолвлений `familyId`. Живий live-тест: обидва реальні акаунти однієї Silpo-сім'ї бачать той самий сімейний тред одразу після синку через `GET /agent/family`.

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
docker compose up -d      # з кореня репо — Postgres :5432 + Redis :6379
npm install
cp .env.example .env
npm run dev              # nest start --watch, HTTP API на :3000
```

`DbService`/`CacheService` конектяться лінькво (на перший запит, не в `onModuleInit`) — health-check живий, навіть якщо Postgres/Redis не підняті. Без Postgres впаде все, що реально йде в БД: `/agent/profile`, `/agent/preferences`, `/agent/messages`/`/agent/chats/*` (сесія й чат-треди — обидва в Postgres), будь-який web-логін. `/agent/plan`/`/agent/checkout` теж падуть без Postgres — вони йдуть через `getClientForSession`/`getAccountId`, які читають сесію з `silpo_sessions`. Без Redis нічого не падає — `/agent/plan` просто ніколи не хітить кеш, `CacheService` ковтає помилку підключення і логує warning (докладніше нижче).

**Автентифікація в Сільпо — два незалежні шляхи:**

- **Shared CLI-флоу** (`/agent/messages`, `npm run chat`, `npm run test:mcp`) — при першому запуску відкриється браузер на сервері для авторизації (`auth.silpo.ua`); токени кешуються в `.silpo-tokens.json`. Один акаунт на весь процес сервера.
- **Web-флоу** (`/agent/plan`, `/agent/checkout`, `/agent/messages`, `/agent/chats/*` — усе, що використовує `client/`) — кожен гість логіниться у **свій** акаунт Сільпо прямо з клієнта: кнопка "Увійти в Сільпо" веде на `GET /auth/silpo/authorize?sessionId=...`, бекенд редіректить у справжній `auth.silpo.ua` (без відкриття браузера на сервері — це вже браузер гостя), Сільпо повертає на `GET /auth/silpo/callback`, звідти — назад у `client/` з `?silpoAuth=success`. Токени й `accountId` живуть у Postgres (`silpo_sessions`, по рядку на `sessionId` — `SilpoAuthSessionStore`), тож переживають рестарт сервера; PKCE `codeVerifier` — єдине, що лишається в пам'яті (потрібен лише на кілька секунд одного логін-раунду). `McpService.getClientForSession(sessionId)` створює/перевикористовує MCP-з'єднання під ці токени. Реєстрація застосунку (RFC 7591) спільна для всіх гостей і кешується окремо в `.silpo-web-client.json` — токени per-guest, client_id один на всіх. `/agent/plan`/`/agent/checkout` без активного логіну повертають 401. `POST /auth/silpo/logout?sessionId=...` (кнопка "Вийти" в клієнті) видаляє рядок сесії з `silpo_sessions` — токени й `accountId` разом; клієнт після цього генерує собі новий `sessionId` для наступного логіну.

**Claude-автентифікація:** `ANTHROPIC_API_KEY` у `.env` — обов'язковий (коли `LLM_PROVIDER=anthropic`, за замовчуванням), `AnthropicService` падає з помилкою на старті, якщо його не задано. (Підписковий OAuth-профіль з `ant auth login` теж автентифікує, але списує з окремого API-балансу організації, а не з підписки claude.ai — на практиці плутанина не варта того, щоб тримати цей шлях.)

**`ANTHROPIC_MODEL`** (за замовчуванням `claude-sonnet-5`) — яку модель викликати, коли `LLM_PROVIDER=anthropic`; читається з `process.env` прямо в `run.ts`/`plan.ts` (не через `AnthropicService` — той лише обирає провайдера), тож зміна моделі не потребує правок коду. **`claude-haiku-4-5-20251001`** підтверджено живим тестом: вдвічі дешевша за Sonnet 5 на вхід/вихід, і водночас на порядок швидша й надійніша за будь-яку з локальних моделей, протестованих цього дня (3.2с проти 30-160с+ у локальних, чистий `tool_use`, коректна українська) — той самий Claude tool-calling, що й Sonnet 5, просто менша модель. Один нюанс, знайдений тим самим тестом: Haiku 4.5 повертає 400 на `output_config.effort` ("This model does not support the effort parameter") — `agent/modelCapabilities.ts`'s `supportsEffort(model)` вирізає це поле для моделей з `"haiku"` в імені, і `run.ts`/`plan.ts` обидва це враховують.

**Локальна модель замість Claude API (`LLM_PROVIDER=local`)** — на випадок, коли Anthropic-кредити скінчились, а демо все одно треба показати: `src/llm/` абстрагує "надіслати хід моделі, отримати відповідь" за єдиним інтерфейсом `LlmClient` (`createMessage(params): Promise<Anthropic.Message>`), яким користуються `run.ts`/`plan.ts` — вони жодним чином не знають, чи це справжній Claude, чи локальна модель. `AnthropicService` (незважаючи на назву — тепер це точка вибору провайдера, а не Anthropic-специфічний сервіс) читає `LLM_PROVIDER` при старті; для `local` є два діалекти (`LOCAL_LLM_API`):
- `anthropic` (за замовчуванням) — підтверджено живим тестом проти [LM Studio](https://lmstudio.ai/)'s локального сервера: він, крім OpenAI-сумісного, віддає ще й **нативний Anthropic-сумісний `/v1/messages`** (справжні `tool_use`/`system`/`output_config`, той самий протокол). Тому тут просто справжній `@anthropic-ai/sdk` з іншим `baseURL` (`AnthropicLlmClient`, той самий клас, що й для реального Claude) — **нуль перекладу формату**, а не окремий клієнт. Саме це і зняло реальний живий баг: OpenAI-діалект намагався слати `response_format:{type:'json_object'}` для структурованого виводу `plan.ts`, а LM Studio на це 400-в ("must be 'json_schema' or 'text'") — нативний Anthropic-шлях цієї проблеми взагалі не має, бо `output_config.format` (з `zodOutputFormat`) іде як є, без жодної підміни.
- `openai` — `LocalOpenAiLlmClient`, HTTP-запити (нативний `fetch`, без нової залежності) до OpenAI-сумісного `/chat/completions` — для Ollama, vLLM, llama.cpp server чи старішої LM Studio без Anthropic-ендпоінта. Переклад Anthropic-формату (`system`/`tools`/`messages` з `tool_use`/`tool_result` блоками) в OpenAI-формат (`messages` з `tool_calls`/`role:'tool'`) і назад відбувається ЛИШЕ на цьому одному стику — решта застосунку (сховище повідомлень у Postgres, `chatConversation.service.ts`, widgets) і далі говорить Anthropic-форматом нативно, без жодної міграції.

Обидва діалекти впираються в реальну межу самої моделі, не коду: 7B-модель (напр. Qwen2.5-7B-Instruct) надійно викликає інструмент на прямій команді ("виклич X і скажи Y"), але на неявний запит ("хто в моїй сім'ї?") — може просто не здогадатись викликати `silpo_get_my_family` взагалі. На складному багатокроковому завданні (повний раціон на кілька днів — багато ітерацій пошуку товарів + строгий структурований JSON) підтверджено живим тестом: модель заплуталась (повторила той самий провальний пошук 7 разів поспіль) і видала недобудований JSON, що впав на zod-валідації `plan.ts`. Простіші сценарії ("Скласти страву" — одна страва) — набагато надійніші на малій локальній моделі.

`npm run chat` (CLI без Nest) теж читає `LLM_PROVIDER` — найшвидший спосіб перевірити, що локальна модель взагалі відповідає й вміє викликати tools, перш ніж піднімати весь HTTP-шар: `LLM_PROVIDER=local LOCAL_LLM_BASE_URL=... LOCAL_LLM_MODEL=... npm run chat`.

CORS увімкнено (`app.enableCors()` у `main.ts`) — щоб `client/`, який працює на іншому порту, міг звертатись напряму.

**Економія токенів (`run.ts`/`plan.ts`):** `agent/toolSelection.ts` звужує 39 tools MCP до CORE-набору (16 tools) + опціональних груп за ключовими словами в повідомленні — менше tool-визначень на кожен виклик. Системний промпт має `cache_control: { type: 'ephemeral' }` — оскільки tools рендеряться перед system, цей один breakpoint кешує tools+system разом; вони однакові на кожній ітерації tool-use циклу й на кожному ході сесії, тож платиш повну ціну лише за перший виклик. Другий, рухомий breakpoint — на останньому `tool_result` кожної ітерації while-циклу (у обох файлах): без нього кешувався лише system+tools, а вся зростаюча історія ходу (кожен наступний `silpo_find_products_batch` в багатостравному плані переоплачував ПОВНУ історію від початку) — тепер попередній breakpoint знімається і ставиться на найновіший `tool_result`, тож ітерація N+1 платить повну ціну лише за те, що додала ітерація N. `output_config.effort: 'medium'` замість `'high'` — дешевший thinking без критичної втрати якості для ration-planning сценаріїв.

**Redis-кеш для `/agent/plan`** (`agent/planCache.ts`, `cache/`) — це те, що по-справжньому дорого (весь tool-use цикл: пошук товарів + структурована генерація), тож кешується цілий результат, не окремі MCP-виклики. Ключ — `plan:{accountId}:{hash профілю}`: той самий акаунт Сільпо + той самий профіль (люди/дні/алергени/кухня/обладнання/формат/бюджет/побажання, без `sessionId`/`conversationId`) → готова відповідь без жодного нового звернення до Claude чи MCP. TTL 15 хв (`PLAN_CACHE_TTL_SECONDS`) — досить, щоб не платити двічі за повторний сабміт/демо-прогін, і достатньо коротко, щоб не віддавати застарілі ціни/наявність. Кеш-хіт усе одно лягає новим ходом у тред (гість же натиснув кнопку і чекає картку в чаті) — пропускається лише дорога Claude/MCP генерація, не крок "показати в розмові". `/agent/checkout` і `/agent/messages` навмисно НЕ кешуються — перший мутує реальний кошик, другий залежить від історії розмови. `CacheService` best-effort: якщо Redis недоступний, `get`/`set` ковтають помилку й логують warning замість падіння запиту — кеш це оптимізація, а не залежність.

**HTTP API:**

```bash
curl http://localhost:3000/                # health-check

# web-логін гостя (звичайно відкривається браузером з client/, не curl-ом)
open "http://localhost:3000/auth/silpo/authorize?sessionId=demo"
curl "http://localhost:3000/auth/silpo/status?sessionId=demo"

curl "http://localhost:3000/agent/profile?sessionId=demo"
curl -X POST http://localhost:3000/agent/preferences \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"demo","cuisine":"українська","equipment":["плита"],"cookingStyle":"daily","budgetUah":1500,"notes":""}'

curl -X POST http://localhost:3000/agent/plan \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"demo","people":2,"days":3,"allergens":[],"cuisine":"","equipment":["плита"],"cookingStyle":"daily","budgetUah":1500,"notes":""}'
# → {"dishes":[...], "conversationId":"...", "title":"...", "requestText":"...", "summaryText":"..."}
# та сама розмова (картка + подальший вільний текст в одному треді) — додай conversationId:
curl -X POST http://localhost:3000/agent/plan \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"demo","conversationId":"<з попередньої відповіді>","people":4,"days":3,"allergens":[],"cuisine":"","equipment":["плита"],"cookingStyle":"daily","budgetUah":2500,"notes":""}'

curl -X POST http://localhost:3000/agent/messages \
  -H "Content-Type: application/json" \
  -d '{"sessionId": "demo", "message": "зроби раціон на 3 дні для сім'\''ї з дитиною 5 років"}'
# → {"reply": "...", "conversationId": "...", "title": "зроби раціон на 3 дні..."}
# наступне повідомлення в той самий тред — додай conversationId з відповіді вище:
curl -X POST http://localhost:3000/agent/messages \
  -H "Content-Type: application/json" \
  -d '{"sessionId": "demo", "conversationId": "<з попередньої відповіді>", "message": "а без молочки?"}'

curl "http://localhost:3000/agent/chats?sessionId=demo"                 # список тредів для sidenav
curl "http://localhost:3000/agent/chats/<conversationId>?sessionId=demo" # один тред, messages: {role,text,widget?}[]
curl -X DELETE "http://localhost:3000/agent/chats/<conversationId>?sessionId=demo"
```

**Без HTTP-шару** (швидкий ручний тест чат-флоу в консолі): `npm run chat`.
**Лише OAuth/MCP підключення** (без Anthropic-ключа): `npm run test:mcp`.

## Тести

```bash
npm test          # unit — усі зовнішні виклики замокані
npm run test:e2e   # реальний HTTP-пайплайн (routing → controller → service), MCP/Anthropic підмінені
npm run lint        # ESLint + Prettier
```

166 unit-тестів по всьому бекенду (agent/ + mcp/ + anthropic/ + db/ + cache/) — усі зовнішні виклики (Anthropic, MCP, Postgres, Redis, `fs`) замокані, жодного реального мережевого запиту чи БД. Плюс 3 e2e-тести (`test/app.e2e-spec.ts`) через `supertest` з `overrideProvider` для `McpService`/`AnthropicService`/`ChatConversationStore` (той останній — бо `/agent/messages` тепер сам зачіпає Postgres через chat-історію; без підміни впав би в CI, де немає реального Postgres); `DbService`/`CacheService` лишаються непідміненими, але жоден інший e2e-сценарій не хітить код-шлях, що робить запит.

## Структура

Канонічна структура Nest CLI: `nest-cli.json`, `tsconfig.build.json`, `eslint.config.mjs`/`.prettierrc`, юніт-тести (`*.spec.ts`) поруч із кодом, e2e — в окремому `/test`.

```
src/
  main.ts                       # Nest bootstrap (HTTP API, :3000, CORS)
  app.module.ts
  app.controller.ts              # GET / health-check
  app.service.ts
  db/
    schema.ts                    # CREATE TABLE IF NOT EXISTS — silpo_sessions, user_preferences, chat_conversations
    db.service.ts                 # тонка обгортка над pg.Pool; конект+схема лінькво на перший query()
    db.module.ts
  cache/
    cache.service.ts               # best-effort get/set над Redis; помилка з'єднання = тихий cache miss
    cache.module.ts
  mcp/
    oauthProvider.ts             # shared CLI-флоу: OAuth 2.1+PKCE, локальний callback-сервер, .silpo-tokens.json
    webOauthProvider.ts           # web-флоу: per-session provider, реєстрація застосунку в .silpo-web-client.json
    silpoAuthSession.service.ts    # sessionId → {tokens, accountId} у Postgres; codeVerifier — в пам'яті
    silpo-auth.controller.ts        # GET /auth/silpo/{authorize,callback,status}, POST /auth/silpo/logout
    client.ts                        # connectSilpoMcp() (shared) / connectSilpoMcpWithProvider() (web, per-session)
    mcp.service.ts                    # getClient() (shared) + getClientForSession/getAccountId(sessionId) (web)
    mcp.module.ts
  anthropic/
    anthropic.service.ts             # обирає LLM-провайдера за LLM_PROVIDER (anthropic/local) — див. llm/
  llm/
    llm.types.ts                      # LlmClient — провайдер-нейтральний інтерфейс createMessage()
    anthropicLlmClient.ts              # тонка обгортка над реальним Anthropic SDK
    localOpenAiLlmClient.ts             # HTTP до OpenAI-сумісного сервера (LM Studio/Ollama/vLLM/...)
    anthropic.module.ts
  agent/
    systemPrompt.ts                # чат-флоу: сценарій і правила відбору товарів/edge-кейси
    planSystemPrompt.ts             # картковий флоу: структурований dishes[] під профіль з форми
    dishPlan.schema.ts               # zod-схеми: PlanRequest/Preferences/Dish/PlanResponse/CheckoutRequest
    userPreferences.service.ts        # accountId → Preferences у Postgres (кухня/обладнання/бюджет/формат)
    userProfile.ts                     # GET /agent/profile: name/phone/people/allergens з Сільпо + saved preferences
    chatConversation.service.ts         # accountId (або familyId — див. family.service.ts) → чат-треди в Postgres (messages+widgets JSONB)
    family.service.ts                   # FamilyStore: групує Silpo-акаунти в сім'ю з silpo_get_my_family, без invite-коду
    chatTranscript.ts                    # raw MessageParam[]+widgets[] → plain {role,text,widget?}[], авто-титул треду
    planCache.ts                        # Redis-ключ для /agent/plan: accountId + hash профілю
    mcpTools.ts                    # конвертація MCP tools у формат Anthropic Messages API
    run.ts                          # agentic loop для /agent/messages, кеш+medium effort + local propose_dish_card/propose_occasion_basket tools
    plan.ts                          # structured-output loop → Dish[], викликається з agent.service.ts#planMeals
    checkout.ts                       # без Claude — агрегує інгредієнти, додає в реальний кошик
    agent.service.ts                 # оркестрація: чат-треди (accountId, Postgres) + planMeals/checkout/profile (картки)
    agent.controller.ts              # /agent/{messages POST, chats GET/DELETE, plan POST, checkout POST, profile GET, preferences POST,
                                      #         family GET, family-messages POST, family-chats GET/DELETE}
    agent.module.ts
    dto/                               # DTO запитів контролера
    *.spec.ts                          # unit-тести
  scripts/
    chat.ts                             # інтерактивний CLI (без HTTP), shared CLI-флоу
    testMcpConnection.ts                 # ізольований тест OAuth/MCP (без Anthropic-ключа)
test/
  app.e2e-spec.ts                          # e2e через supertest
  jest-e2e.json
```
