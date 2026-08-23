import { planCacheKey } from './planCache';
import type { PlanRequest } from './dishPlan.schema';

function fakeProfile(overrides: Partial<PlanRequest> = {}): PlanRequest {
  return {
    sessionId: 'session-1',
    people: 2,
    days: 3,
    allergens: [],
    cuisine: 'українська',
    equipment: ['плита'],
    cookingStyle: 'daily',
    budgetUah: 1500,
    notes: '',
    forChildren: false,
    familyChat: false,
    ...overrides,
  };
}

describe('planCacheKey', () => {
  it('is identical for the same account and profile', () => {
    const a = planCacheKey('acc-1', fakeProfile());
    const b = planCacheKey('acc-1', fakeProfile());

    expect(a).toBe(b);
  });

  it('ignores sessionId — same account, different browser session, same key', () => {
    const a = planCacheKey('acc-1', fakeProfile({ sessionId: 'session-a' }));
    const b = planCacheKey('acc-1', fakeProfile({ sessionId: 'session-b' }));

    expect(a).toBe(b);
  });

  it('differs between accounts for an otherwise identical profile', () => {
    const a = planCacheKey('acc-1', fakeProfile());
    const b = planCacheKey('acc-2', fakeProfile());

    expect(a).not.toBe(b);
  });

  it('differs when a profile field changes', () => {
    const base = planCacheKey('acc-1', fakeProfile());
    const differentBudget = planCacheKey(
      'acc-1',
      fakeProfile({ budgetUah: 2000 }),
    );
    const differentStyle = planCacheKey(
      'acc-1',
      fakeProfile({ cookingStyle: 'batch' }),
    );

    expect(differentBudget).not.toBe(base);
    expect(differentStyle).not.toBe(base);
  });

  it('is order-independent for allergens and equipment arrays', () => {
    const a = planCacheKey(
      'acc-1',
      fakeProfile({ allergens: ['горіхи', 'глютен'] }),
    );
    const b = planCacheKey(
      'acc-1',
      fakeProfile({ allergens: ['глютен', 'горіхи'] }),
    );

    expect(a).toBe(b);
  });
});
