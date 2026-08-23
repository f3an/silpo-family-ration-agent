/**
 * Neither run.ts's chat loop nor plan.ts's structured loop ever told the
 * model what "today" is — it has to guess from its own training-time
 * knowledge, which a live test caught going wrong: a local model computed
 * `silpo_get_time_slots({start: "2025-05-24T11:00:00Z"})` out of thin air,
 * a year in the past, and got back empty/stale results for it. Prepended
 * to the cached system block (see run.ts/plan.ts) — a daily-changing
 * prefix just means one cache miss per calendar day, not a real cost.
 */
export function currentDateLine(): string {
  return `Сьогоднішня дата: ${new Date().toISOString().slice(0, 10)} (YYYY-MM-DD, UTC).\n\n`;
}
