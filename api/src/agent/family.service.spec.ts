import { FamilyStore } from './family.service';
import type { DbService } from '../db/db.service';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';

/** In-memory stand-in for `families`/`family_members` — good enough to
 * exercise FamilyStore's own SQL without a real Postgres. */
function fakeDb() {
  const familyMembers = new Map<string, string>(); // account_id -> family_id
  const families = new Set<string>();

  const db = {
    query: jest.fn((text: string, params: unknown[] = []) => {
      if (
        text.includes('SELECT family_id FROM family_members WHERE account_id')
      ) {
        const familyId = familyMembers.get(params[0] as string);
        return Promise.resolve({
          rows: familyId ? [{ family_id: familyId }] : [],
        });
      }
      if (
        text.includes('SELECT account_id FROM family_members WHERE family_id')
      ) {
        const ids = [...familyMembers.entries()]
          .filter(([, fid]) => fid === params[0])
          .map(([accountId]) => ({ account_id: accountId }));
        return Promise.resolve({ rows: ids });
      }
      if (text.includes('INSERT INTO families')) {
        families.add(params[0] as string);
        return Promise.resolve({ rows: [] });
      }
      if (text.includes('INSERT INTO family_members')) {
        const [accountId, familyId] = params as [string, string];
        if (!familyMembers.has(accountId))
          familyMembers.set(accountId, familyId);
        return Promise.resolve({ rows: [] });
      }
      throw new Error(`fakeDb: unhandled query — ${text}`);
    }),
  } as unknown as DbService;

  return { db, familyMembers, families };
}

function fakeMcp(
  members: Array<{
    profileId?: string;
    name?: string | null;
    phone?: string | null;
    itsMe?: boolean;
  }>,
) {
  return {
    callTool: jest.fn().mockResolvedValue({
      structuredContent: { name: 'Моя сім’я', members },
    }),
  } as unknown as Client;
}

describe('FamilyStore.sync', () => {
  it('returns familyId: null for a solo account (fewer than 2 Silpo family members)', async () => {
    const { db } = fakeDb();
    const store = new FamilyStore(db);
    const mcp = fakeMcp([{ profileId: 'acc-1', itsMe: true }]);

    await expect(store.sync(mcp, 'acc-1')).resolves.toEqual({
      familyId: null,
      members: [],
    });
  });

  it('creates a new family and registers every listed member, including ones who never logged in', async () => {
    const { db, familyMembers } = fakeDb();
    const store = new FamilyStore(db);
    const mcp = fakeMcp([
      { profileId: 'acc-1', name: 'Ігор', phone: '38095*****06', itsMe: true },
      { profileId: 'acc-2', name: null, phone: '38063*****68', itsMe: false },
    ]);

    const result = await store.sync(mcp, 'acc-1');

    expect(result.familyId).toBeTruthy();
    expect(result.members).toEqual([
      { accountId: 'acc-1', name: 'Ігор', phone: '38095*****06', itsMe: true },
      { accountId: 'acc-2', name: null, phone: '38063*****68', itsMe: false },
    ]);
    // acc-2 never called sync itself, but is already linked.
    expect(familyMembers.get('acc-2')).toBe(result.familyId);
  });

  it('links a second account to the family the first account already created', async () => {
    const { db } = fakeDb();
    const store = new FamilyStore(db);
    const mcpForAcc1 = fakeMcp([
      { profileId: 'acc-1', itsMe: true },
      { profileId: 'acc-2', itsMe: false },
    ]);
    const { familyId: firstFamilyId } = await store.sync(mcpForAcc1, 'acc-1');

    const mcpForAcc2 = fakeMcp([
      { profileId: 'acc-1', itsMe: false },
      { profileId: 'acc-2', itsMe: true },
    ]);
    const { familyId: secondFamilyId } = await store.sync(mcpForAcc2, 'acc-2');

    expect(secondFamilyId).toBe(firstFamilyId);
  });

  it('is idempotent — re-syncing the same account does not create a duplicate family', async () => {
    const { db, families } = fakeDb();
    const store = new FamilyStore(db);
    const mcp = fakeMcp([
      { profileId: 'acc-1', itsMe: true },
      { profileId: 'acc-2', itsMe: false },
    ]);

    const first = await store.sync(mcp, 'acc-1');
    const second = await store.sync(mcp, 'acc-1');

    expect(second.familyId).toBe(first.familyId);
    expect(families.size).toBe(1);
  });

  it('ignores members Silpo returns without a profileId', async () => {
    const { db } = fakeDb();
    const store = new FamilyStore(db);
    const mcp = fakeMcp([
      { profileId: 'acc-1', itsMe: true },
      { profileId: 'acc-2', itsMe: false },
      { profileId: undefined, name: 'дитина без акаунту' },
    ]);

    const result = await store.sync(mcp, 'acc-1');

    expect(result.members).toHaveLength(2);
  });
});

describe('FamilyStore.getFamilyIdForAccount / listMemberAccountIds', () => {
  it('returns undefined for an account with no family', async () => {
    const { db } = fakeDb();
    const store = new FamilyStore(db);

    await expect(store.getFamilyIdForAccount('acc-1')).resolves.toBeUndefined();
  });

  it('lists every member of a synced family', async () => {
    const { db } = fakeDb();
    const store = new FamilyStore(db);
    const mcp = fakeMcp([
      { profileId: 'acc-1', itsMe: true },
      { profileId: 'acc-2', itsMe: false },
    ]);
    const { familyId } = await store.sync(mcp, 'acc-1');

    const members = await store.listMemberAccountIds(familyId!);

    expect(members.sort()).toEqual(['acc-1', 'acc-2']);
  });
});
