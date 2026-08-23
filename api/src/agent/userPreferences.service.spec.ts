import { UserPreferencesStore } from './userPreferences.service';
import type { DbService } from '../db/db.service';
import type { Preferences } from './dishPlan.schema';

/** In-memory stand-in for the `user_preferences` table — good enough to
 * exercise UserPreferencesStore's own SQL without a real Postgres. */
function fakeDb(): DbService {
  const rows = new Map<string, Record<string, unknown>>();
  return {
    query: jest.fn((text: string, params: unknown[] = []) => {
      if (text.startsWith('SELECT')) {
        const row = rows.get(params[0] as string);
        return Promise.resolve({ rows: row ? [row] : [] });
      }
      // INSERT ... ON CONFLICT DO UPDATE (upsert)
      const [accountId, cuisine, equipment, cookingStyle, budgetUah, notes] =
        params as [string, string, string, string, number, string];
      rows.set(accountId, {
        cuisine,
        equipment: JSON.parse(equipment) as string[],
        cooking_style: cookingStyle,
        budget_uah: String(budgetUah),
        notes,
      });
      return Promise.resolve({ rows: [] });
    }),
  } as unknown as DbService;
}

function fakePreferences(overrides: Partial<Preferences> = {}): Preferences {
  return {
    cuisine: 'українська',
    equipment: ['плита'],
    cookingStyle: 'daily',
    budgetUah: 1500,
    notes: '',
    ...overrides,
  };
}

describe('UserPreferencesStore', () => {
  it('returns undefined for an account that never saved preferences', async () => {
    const store = new UserPreferencesStore(fakeDb());

    await expect(store.get('acc-1')).resolves.toBeUndefined();
  });

  it('returns what was saved for that account', async () => {
    const store = new UserPreferencesStore(fakeDb());
    const prefs = fakePreferences({ cuisine: 'італійська' });

    await store.set('acc-1', prefs);

    await expect(store.get('acc-1')).resolves.toEqual(prefs);
  });

  it('overwrites the previous save for the same account', async () => {
    const store = new UserPreferencesStore(fakeDb());

    await store.set('acc-1', fakePreferences({ budgetUah: 1000 }));
    await store.set('acc-1', fakePreferences({ budgetUah: 2000 }));

    const saved = await store.get('acc-1');
    expect(saved?.budgetUah).toBe(2000);
  });

  it('isolates preferences between accounts', async () => {
    const store = new UserPreferencesStore(fakeDb());

    await store.set('acc-a', fakePreferences({ cuisine: 'азійська' }));
    await store.set('acc-b', fakePreferences({ cuisine: 'середземноморська' }));

    const a = await store.get('acc-a');
    const b = await store.get('acc-b');
    expect(a?.cuisine).toBe('азійська');
    expect(b?.cuisine).toBe('середземноморська');
  });
});
