import { ChatConversationStore } from './chatConversation.service';
import type { DbService } from '../db/db.service';

interface Row {
  id: string;
  account_id: string;
  title: string;
  messages: unknown[];
  widgets: unknown[];
  updated_at: string;
}

/** In-memory stand-in for the `chat_conversations` table — good enough to
 * exercise ChatConversationStore's own SQL without a real Postgres. */
function fakeDb(): DbService {
  const rows = new Map<string, Row>();
  let now = 0;

  return {
    query: jest.fn((text: string, params: unknown[] = []) => {
      if (text.includes('INSERT')) {
        const [id, accountId, title] = params as [string, string, string];
        const row: Row = {
          id,
          account_id: accountId,
          title,
          messages: [],
          widgets: [],
          updated_at: String(now++),
        };
        rows.set(id, row);
        return Promise.resolve({
          rows: [{ id: row.id, title: row.title, updated_at: row.updated_at }],
        });
      }

      if (text.includes('UPDATE')) {
        const setsMessages = text.includes('messages = $3');
        const setsWidgets = text.includes('widgets = $3');
        const hasTitle = text.includes('title = $4');

        if (setsMessages) {
          const [accountId, id, messagesJson, title] = params as [
            string,
            string,
            string,
            string | undefined,
          ];
          const row = rows.get(id);
          if (row && row.account_id === accountId) {
            row.messages = JSON.parse(messagesJson) as unknown[];
            if (hasTitle) row.title = title as string;
            row.updated_at = String(now++);
          }
        } else if (setsWidgets) {
          const [accountId, id, widgetsJson] = params as [
            string,
            string,
            string,
          ];
          const row = rows.get(id);
          if (row && row.account_id === accountId) {
            row.widgets = JSON.parse(widgetsJson) as unknown[];
            row.updated_at = String(now++);
          }
        }
        return Promise.resolve({ rows: [] });
      }

      if (text.includes('DELETE')) {
        const [accountId, id] = params as [string, string];
        const row = rows.get(id);
        if (row && row.account_id === accountId) rows.delete(id);
        return Promise.resolve({ rows: [] });
      }

      // SELECT — either list (account_id only) or get (account_id + id)
      const [accountId, id] = params as [string, string | undefined];
      const matches = [...rows.values()]
        .filter((row) => row.account_id === accountId)
        .filter((row) => id === undefined || row.id === id)
        .sort((a, b) => Number(b.updated_at) - Number(a.updated_at));
      return Promise.resolve({ rows: matches });
    }),
  } as unknown as DbService;
}

describe('ChatConversationStore', () => {
  it('create starts an empty, default-titled conversation', async () => {
    const store = new ChatConversationStore(fakeDb());

    const conversation = await store.create('acc-1');

    expect(conversation.title).toBe('Нова розмова');
    expect(conversation.messages).toEqual([]);
    expect(conversation.widgets).toEqual([]);
    expect(conversation.id).toBeTruthy();
  });

  it('get returns undefined for a conversation that does not exist', async () => {
    const store = new ChatConversationStore(fakeDb());

    await expect(store.get('acc-1', 'no-such-id')).resolves.toBeUndefined();
  });

  it('saveMessages persists messages and is read back via get', async () => {
    const store = new ChatConversationStore(fakeDb());
    const conversation = await store.create('acc-1');
    const messages = [{ role: 'user', content: 'привіт' }];

    await store.saveMessages('acc-1', conversation.id, messages as never);

    const reloaded = await store.get('acc-1', conversation.id);
    expect(reloaded?.messages).toEqual(messages);
    expect(reloaded?.title).toBe('Нова розмова');
  });

  it('saveMessages with a title renames the conversation (used on its first turn)', async () => {
    const store = new ChatConversationStore(fakeDb());
    const conversation = await store.create('acc-1');

    await store.saveMessages(
      'acc-1',
      conversation.id,
      [] as never,
      'Раціон на тиждень',
    );

    const reloaded = await store.get('acc-1', conversation.id);
    expect(reloaded?.title).toBe('Раціон на тиждень');
  });

  it('saveWidgets persists widgets and is read back via get, independent of messages', async () => {
    const store = new ChatConversationStore(fakeDb());
    const conversation = await store.create('acc-1');
    const widgets = [
      { messageIndex: 1, kind: 'dish_plan' as const, dishes: [] },
    ];

    await store.saveWidgets('acc-1', conversation.id, widgets);

    const reloaded = await store.get('acc-1', conversation.id);
    expect(reloaded?.widgets).toEqual(widgets);
    expect(reloaded?.messages).toEqual([]);
  });

  it('list returns summaries for that account only, newest first', async () => {
    const store = new ChatConversationStore(fakeDb());
    const a1 = await store.create('acc-a');
    await store.create('acc-b');
    const a2 = await store.create('acc-a');

    const list = await store.list('acc-a');

    expect(list.map((c) => c.id)).toEqual([a2.id, a1.id]);
  });

  it('remove deletes the conversation for that account only', async () => {
    const store = new ChatConversationStore(fakeDb());
    const conversation = await store.create('acc-1');

    await store.remove('acc-1', conversation.id);

    await expect(store.get('acc-1', conversation.id)).resolves.toBeUndefined();
  });

  it('isolates conversations between accounts (get/remove ignore a mismatched account)', async () => {
    const store = new ChatConversationStore(fakeDb());
    const conversation = await store.create('acc-a');

    await expect(store.get('acc-b', conversation.id)).resolves.toBeUndefined();

    await store.remove('acc-b', conversation.id);
    await expect(store.get('acc-a', conversation.id)).resolves.toBeDefined();
  });
});
