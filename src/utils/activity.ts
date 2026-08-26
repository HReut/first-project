import type { ActivityLogEntry } from '../types.ts'

/** "Settled as of" — the date portion of the latest non-undone settlement
 * entry, or null if the household has never settled up (or every
 * settlement has since been undone). computeSplitBalance() excludes
 * transactions dated on/before this. Settlement history lives entirely in
 * the activity log (see 0009_activity_log.sql) rather than a separate
 * marker, so undoing a "Settle Up" just falls back to whatever the
 * previous settlement was. */
export function resolveSettledAfter(activityLog: ActivityLogEntry[]): string | null {
  const latest = activityLog
    .filter((entry) => entry.entityType === 'settlement' && entry.action === 'settled' && !entry.undone)
    .sort((a, b) => (a.performedAt < b.performedAt ? 1 : -1))[0]
  return latest ? latest.performedAt.slice(0, 10) : null
}
