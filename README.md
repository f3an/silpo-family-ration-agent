# silpo-family-ration-agent

Agentic AI that plans a family's weekly meals and builds the cart via Silpo's official MCP server — built for «Сільпо» AI Factory: Хакатон ідей.

## Структура репозиторію

- **[`api/`](api/README.md)** — NestJS-бекенд: агентний tool-use цикл (Claude Sonnet 5 + офіційний Silpo MCP), HTTP API. Web-логін у власний акаунт Сільпо, картковий flow (`/agent/plan` → `/agent/checkout`), особистий кабінет (`/agent/profile`, преференції в Postgres), чат-флоу (`/agent/messages`). Уся логіка, edge-кейси й тести — там.
- **[`client/`](client/README.md)** — чат-клієнт поверх API. React + Vite + Redux Toolkit/RTK Query + react-router-dom.
- **`docker-compose.yml`** (корінь) — Postgres (сесії Сільпо + збережені преференції гостей) і Redis (кеш `/agent/plan`, щоб повторний запит не платив за Claude вдруге) для `api/`.

Кожна папка — окремий Node-проєкт зі своїм `package.json`; спільних залежностей немає.

## Швидкий старт

```bash
docker compose up -d                                             # Postgres :5432 + Redis :6379
cd api && npm install && cp .env.example .env && npm run dev    # HTTP API на :3000
```

В іншому терміналі:

```bash
cd client && npm install && npm run dev                          # клієнт на :5173
```

Відкрий http://localhost:5173 — API-адресу видно і можна змінити прямо в шапці.

## Хакатон

«Сільпо» AI Factory: Хакатон ідей — [ai-factory.silpo.ua](https://ai-factory.silpo.ua). Дедлайн подачі: 14.09.2026. Критерії журі: цінність для гостя/бізнесу, якість використання MCP, агентність рішення, реалістичність інтеграції, якість прототипу, валідація та масштабування.
