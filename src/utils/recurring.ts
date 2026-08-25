import type { NewTransaction, RecurringRule } from '../types.ts'

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

/** Active rules due for `monthKey` that haven't already generated a
 * transaction for it — i.e. what App.ts should generate on this load. */
export function findRulesDueForGeneration(rules: RecurringRule[], monthKey: string): RecurringRule[] {
  return rules.filter((rule) => rule.isActive && rule.lastGeneratedMonth !== monthKey && isRuleDueForMonth(rule, monthKey))
}

/** Builds the pending transaction a due rule generates for `monthKey`,
 * dated to the rule's configured day of month. */
export function transactionForDueRule(rule: RecurringRule, monthKey: string): NewTransaction {
  const day = String(rule.dayOfMonth).padStart(2, '0')
  return {
    date: `${monthKey}-${day}`,
    merchant: rule.merchant,
    amount: rule.amount,
    categoryId: rule.categoryId,
    account: rule.account,
    person: rule.person,
    status: 'pending',
    source: 'recurring',
  }
}
