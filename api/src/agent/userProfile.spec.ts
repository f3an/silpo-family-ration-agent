import { getUserProfile } from './userProfile';
import { UserPreferencesStore } from './userPreferences.service';
import type { DbService } from '../db/db.service';
import type { Preferences } from './dishPlan.schema';

function fakeMcp(
  profileOverrides: Record<string, unknown> = {
    firstName: 'Тест',
    lastName: 'Тестовий',
    phone: '380000000000',
  },
) {
  return {
    callTool: jest.fn().mockImplementation(({ name }: { name: string }) => {
      if (name === 'silpo_get_my_family') {
        return Promise.resolve({
          structuredContent: {
            success: true,
            members: [{ profileId: 'p1', itsMe: true }],
            children: [{ id: 'c1' }],
          },
        });
      }
      if (name === 'silpo_get_my_food_restrictions') {
        return Promise.resolve({
          structuredContent: {
            success: true,
            restrictions: [
              { slug: 'gluten-free', name: 'Без глютену' },
              { slug: 'nut-free', name: null },
            ],
          },
        });
      }
      if (name === 'silpo_get_my_profile') {
        return Promise.resolve({
          structuredContent: { success: true, profile: profileOverrides },
        });
      }
      if (name === 'silpo_get_loyalty_info') {
        return Promise.resolve({
          structuredContent: {
            success: true,
            loyalty: {
              card: {
                barcode: '0000000000000',
                typeName: 'Постійна',
                memberId: 1,
              },
              balance: { total: 176.04, currency: 'UAH', accounts: [] },
            },
          },
        });
      }
      throw new Error(`unexpected tool ${name}`);
    }),
  };
}

/** Same in-memory stand-in as userPreferences.service.spec.ts. */
function fakeDb(): DbService {
  const rows = new Map<string, Record<string, unknown>>();
  return {
    query: jest.fn((text: string, params: unknown[] = []) => {
      if (text.startsWith('SELECT')) {
        const row = rows.get(params[0] as string);
        return Promise.resolve({ rows: row ? [row] : [] });
      }
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

const PREFS: Preferences = {
  cuisine: 'українська',
  equipment: ['плита'],
  cookingStyle: 'daily',
  budgetUah: 1500,
  notes: '',
};

describe('getUserProfile', () => {
  it('sums family members + children for people, and maps restrictions to display names', async () => {
    const mcp = fakeMcp();
    const store = new UserPreferencesStore(fakeDb());

    const profile = await getUserProfile(mcp as never, 'acc-1', store);

    expect(profile).toEqual({
      accountId: 'acc-1',
      firstName: 'Тест',
      lastName: 'Тестовий',
      phone: '+380 00 *** ** 00',
      people: 2,
      allergens: ['Без глютену', 'nut-free'],
      preferences: null,
      bonusBalance: 176.04,
    });
  });

  it("masks the account's own phone number — the full digits never leave the server", async () => {
    const mcp = fakeMcp();
    const store = new UserPreferencesStore(fakeDb());

    const profile = await getUserProfile(mcp as never, 'acc-1', store);

    expect(profile.phone).toBe('+380 00 *** ** 00');
    expect(profile.phone).not.toContain('380000000000');
  });

  it('leaves a non-12-digit phone unmasked rather than mangling it', async () => {
    const mcp = fakeMcp({
      firstName: 'Тест',
      lastName: 'Тестовий',
      phone: '123',
    });
    const store = new UserPreferencesStore(fakeDb());

    const profile = await getUserProfile(mcp as never, 'acc-1', store);

    expect(profile.phone).toBe('123');
  });

  it('returns null phone when the account has none', async () => {
    const mcp = fakeMcp({ firstName: 'Тест', lastName: 'Тестовий' });
    const store = new UserPreferencesStore(fakeDb());

    const profile = await getUserProfile(mcp as never, 'acc-1', store);

    expect(profile.phone).toBeNull();
  });

  it('defaults people to 1 when the account has no family data', async () => {
    const mcp = {
      callTool: jest.fn().mockResolvedValue({
        structuredContent: { success: true, members: [], children: [] },
      }),
    };
    const store = new UserPreferencesStore(fakeDb());

    const profile = await getUserProfile(mcp as never, 'acc-1', store);

    expect(profile.people).toBe(1);
  });

  it('includes previously saved preferences for this account', async () => {
    const mcp = fakeMcp();
    const store = new UserPreferencesStore(fakeDb());
    await store.set('acc-1', PREFS);

    const profile = await getUserProfile(mcp as never, 'acc-1', store);

    expect(profile.preferences).toEqual(PREFS);
  });
});
