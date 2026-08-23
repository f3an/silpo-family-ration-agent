import { currentDateLine } from './currentDate';

describe('currentDateLine', () => {
  it("includes today's date in YYYY-MM-DD form", () => {
    const today = new Date().toISOString().slice(0, 10);

    expect(currentDateLine()).toContain(today);
  });

  it('ends with a blank line so it reads as its own paragraph before the prompt it prefixes', () => {
    expect(currentDateLine().endsWith('\n\n')).toBe(true);
  });
});
