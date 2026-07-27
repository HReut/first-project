export type BudgetStatus = 'good' | 'warning' | 'critical' | 'no-limit'

/** Green under 80% of the limit, yellow 80-100%, red over — 'no-limit' when
 * the category has no monthly_budget_limit set. */
export function budgetStatus(spent: number, limit: number | null): BudgetStatus {
  if (limit === null || limit <= 0) return 'no-limit'
  const ratio = spent / limit
  if (ratio > 1) return 'critical'
  if (ratio >= 0.8) return 'warning'
  return 'good'
}

export function budgetPercent(spent: number, limit: number | null): number {
  if (limit === null || limit <= 0) return 0
  return Math.min(100, (spent / limit) * 100)
}
