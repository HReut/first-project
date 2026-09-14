import type { ActivityLogEntry } from '../types.ts'

/** "Settled as of" — the full timestamp of the latest non-undone settlement
 * entry, or null if the household has never settled up (or every
 * settlement has since been undone). computeSplitBalance() excludes any
 * transaction *entered* (createdAt) on or before this — deliberately not
 * the transaction's own `date`, since a recurring bill can be generated
 * with a date later in the current month (e.g. day_of_month 28, generated
 * on the 14th): comparing by `date` would put it "after" a same-day
 * settlement forever, so no settlement before the 28th could ever clear it
 * even though it already existed at settlement time. Settlement history
 * lives entirely in the activity log (see 0009_activity_log.sql) rather
 * than a separate marker, so undoing a "Settle Up" just falls back to
 * whatever the previous settlement was. */
export function resolveSettledAfter(activityLog: ActivityLogEntry[]): string | null {
  const latest = activityLog
    .filter((entry) => entry.entityType === 'settlement' && entry.action === 'settled' && !entry.undone)
    .sort((a, b) => (a.performedAt < b.performedAt ? 1 : -1))[0]
  return latest ? latest.performedAt : null
}
