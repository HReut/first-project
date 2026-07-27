import type { Filters, Person, Transaction } from '../types.ts'

export interface MonthlyInsights {
  currentMonthTotal: number
  previousMonthTotal: number
  deltaAmount: number
  deltaPercent: number | null // null when there is no prior-month spending to compare against
  topCategoryId: string | null
  topCategoryAmount: number
  transactionCount: number
}

export interface CategoryBreakdownEntry {
  categoryId: string
  amount: number
  share: number // 0-100, share of this month's scoped total
}

export interface SplitBalance {
  owingPerson: Person
  owedPerson: Person
  amount: number
}

function monthKey(date: Date): string {
  return date.toISOString().slice(0, 7)
}

function sum(transactions: Transaction[]): number {
  return transactions.reduce((total, tx) => total + tx.amount, 0)
}

function scopeByPersonAndCategory(transactions: Transaction[], filters: Pick<Filters, 'categoryId' | 'person'>): Transaction[] {
  return transactions.filter((tx) => {
    if (filters.categoryId !== 'all' && tx.categoryId !== filters.categoryId) return false
    if (filters.person !== 'all' && tx.person !== filters.person) return false
    return true
  })
}

/**
 * Per-category totals for the current calendar month, scoped by the
 * category/person filters, sorted highest spend first.
 */
export function computeCategoryBreakdown(
  transactions: Transaction[],
  filters: Pick<Filters, 'categoryId' | 'person'>,
  referenceDate = new Date(),
): CategoryBreakdownEntry[] {
  const currentMonth = monthKey(referenceDate)
  const currentTx = scopeByPersonAndCategory(transactions, filters).filter((tx) => tx.date.startsWith(currentMonth))

  const byCategory = new Map<string, number>()
  for (const tx of currentTx) {
    byCategory.set(tx.categoryId, (byCategory.get(tx.categoryId) ?? 0) + tx.amount)
  }

  const total = sum(currentTx)
  return Array.from(byCategory, ([categoryId, amount]) => ({
    categoryId,
    amount,
    share: total === 0 ? 0 : (amount / total) * 100,
  })).sort((a, b) => b.amount - a.amount)
}

/**
 * Always compares "this calendar month" vs "last calendar month", scoped by the
 * category/person filters but independent of the table's period filter — the
 * summary cards answer "how am I doing this month", not "how much is in view".
 */
export function computeMonthlyInsights(
  transactions: Transaction[],
  filters: Pick<Filters, 'categoryId' | 'person'>,
  referenceDate = new Date(),
): MonthlyInsights {
  const currentMonth = monthKey(referenceDate)
  const previousDate = new Date(referenceDate)
  previousDate.setMonth(previousDate.getMonth() - 1)
  const previousMonth = monthKey(previousDate)

  const scoped = scopeByPersonAndCategory(transactions, filters)

  const currentTx = scoped.filter((tx) => tx.date.startsWith(currentMonth))
  const previousTx = scoped.filter((tx) => tx.date.startsWith(previousMonth))

  const currentMonthTotal = sum(currentTx)
  const previousMonthTotal = sum(previousTx)
  const deltaAmount = currentMonthTotal - previousMonthTotal
  const deltaPercent = previousMonthTotal === 0 ? null : (deltaAmount / previousMonthTotal) * 100

  const breakdown = computeCategoryBreakdown(transactions, filters, referenceDate)
  const top = breakdown[0] ?? null

  return {
    currentMonthTotal,
    previousMonthTotal,
    deltaAmount,
    deltaPercent,
    topCategoryId: top?.categoryId ?? null,
    topCategoryAmount: top?.amount ?? 0,
    transactionCount: currentTx.length,
  }
}

/**
 * Household expenses are assumed split 50/50 regardless of who paid — the
 * balance is half the gap between what each person actually spent this
 * calendar month. Returns null when the two are (near) even.
 */
export function computeSplitBalance(transactions: Transaction[], referenceDate = new Date()): SplitBalance | null {
  const currentMonth = monthKey(referenceDate)
  const currentTx = transactions.filter((tx) => tx.date.startsWith(currentMonth))
  const reutTotal = sum(currentTx.filter((tx) => tx.person === 'Reut'))
  const kerenTotal = sum(currentTx.filter((tx) => tx.person === 'Keren'))
  const diff = reutTotal - kerenTotal
  const amount = Math.round(Math.abs(diff) / 2)
  if (amount === 0) return null
  return diff > 0 ? { owingPerson: 'Keren', owedPerson: 'Reut', amount } : { owingPerson: 'Reut', owedPerson: 'Keren', amount }
}
