/**
 * A calendar-day key ("2026-08-13") — the unit both the Story Decisions
 * journal (`services/journal-export.ts`) and the single-chooser fairness
 * tally (`services/decision-service.ts`) treat as one "session": everything
 * resolved the same day counts as the same session, no explicit start/end
 * needed.
 *
 * Local time, not UTC/ISO — a table playing past midnight server-time
 * shouldn't have its session split in two, and the table's own clock is what
 * "the same day" means to them.
 */
export function sessionDateKey(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
