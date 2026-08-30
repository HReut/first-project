import type { BudgetLimitOverride, Category, NewTransaction, RecurringRule, Transaction } from '../types.ts'
import { computeReviewedStatus } from './insights.ts'

/** True when `monthKey` (YYYY-MM) is one of the rule's due months: its
 * anchor month, or anchor month plus a whole multiple of intervalMonths.
 * A rule due every 2 months from 2025-01 is due in 01, 03, 05… not 02, 04. */
export function isRuleDueForMonth(rule: RecurringRule, monthKey: string): boolean {
  const [anchorYear, anchorMonth] = rule.anchorMonth.split('-').map(Number)
  const [year, month] = monthKey.split('-').map(Number)
  const monthsSinceAnchor = (year - anchorYear) * 12 + (month - anchorMonth)
  if (monthsSinceAnchor < 0) return false
  return monthsSinceAnchor % rule.intervalMonths === 0
}

/** Every one of a rule's due months, from its anchor up through `upToMonthKey`
 * inclusive, that hasn't already generated a transaction — not just the
 * current month. This is what lets a rule with a backdated anchorMonth (set
 * up to retroactively cover months already gone by) backfill all of them in
 * one pass, and also means a household that skips opening the app for a
 * stretch doesn't silently lose whichever month fell in the gap — every due
 * month since lastGeneratedMonth gets caught up, not just the latest one.
 * An installment plan (totalOccurrences set) stops once it's produced that
 * many transactions total, even mid-backfill. */
export function dueMonthsForRule(rule: RecurringRule, upToMonthKey: string, existingTransactions: Transaction[] = []): string[] {
  if (!rule.isActive) return []
  const [anchorYear, anchorMonth] = rule.anchorMonth.split('-').map(Number)
  const [upToYear, upToMonth] = upToMonthKey.split('-').map(Number)
  const span = (upToYear - anchorYear) * 12 + (upToMonth - anchorMonth)
  if (span < 0) return []

  // Self-heals a rule whose lastGeneratedMonth claims its most recent month
  // is already generated but no matching transaction actually exists for
  // it — e.g. an insert that silently failed, or a generation race that
  // left the counter and the real data out of sync. Only checked for the
  // exact claimed month (not every earlier one — that'd be a full audit on
  // every call) since that's the one a write race would actually affect.
  const hasTransactionForMonth = (monthKey: string) =>
    existingTransactions.some(
      (tx) => tx.source === 'recurring' && tx.merchant === rule.merchant && tx.categoryId === rule.categoryId && tx.account === rule.account && tx.date.startsWith(monthKey),
    )

  let remaining = rule.totalOccurrences === null ? Infinity : rule.totalOccurrences - rule.occurrencesGenerated
  const months: string[] = []
  for (let offset = 0; offset <= span && remaining > 0; offset++) {
    const d = new Date(anchorYear, anchorMonth - 1 + offset, 1)
    const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    if (!isRuleDueForMonth(rule, monthKey)) continue
    const claimedDone = rule.lastGeneratedMonth !== null && monthKey <= rule.lastGeneratedMonth
    if (claimedDone && (monthKey !== rule.lastGeneratedMonth || hasTransactionForMonth(monthKey))) continue
    months.push(monthKey)
    remaining--
  }
  return months
}

/** Builds the transaction a due rule generates for `monthKey`, dated to the
 * rule's configured day of month. Snapshots its category's current budget
 * standing the same way a manually-typed or imported transaction does
 * (computeReviewedStatus) instead of landing 'pending' — a scheduled bill
 * firing automatically needs no separate "mark as reviewed" step, same
 * reasoning as CSV/PDF imports. */
export function transactionForDueRule(
  rule: RecurringRule,
  monthKey: string,
  transactions: Transaction[],
  categories: Category[],
  overrides: BudgetLimitOverride[],
): NewTransaction {
  const day = String(rule.dayOfMonth).padStart(2, '0')
  return {
    date: `${monthKey}-${day}`,
    merchant: rule.merchant,
    amount: rule.amount,
    currency: 'ILS',
    originalAmount: rule.amount,
    categoryId: rule.categoryId,
    account: rule.account,
    person: rule.person,
    status: computeReviewedStatus(transactions, categories, rule.categoryId, overrides),
    source: 'recurring',
  }
}
