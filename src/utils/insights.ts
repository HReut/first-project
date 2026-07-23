import type { Category, Filters, Transaction } from '../types.ts'

export interface MonthlyInsights {
  currentMonthTotal: number
  previousMonthTotal: number
  deltaAmount: number
  deltaPercent: number | null // null when there is no prior-month spending to compare against
  topCategory: { category: Category; amount: number } | null
  transactionCount: number
}

function monthKey(date: Date): string {
  return date.toISOString().slice(0, 7)
}

function sum(transactions: Transaction[]): number {
  return transactions.reduce((total, tx) => total + tx.amount, 0)
}

/**
 * Always compares "this calendar month" vs "last calendar month", scoped by the
 * category/person filters but independent of the table's period filter — the
 * summary cards answer "how am I doing this month", not "how much is in view".
 */
export function computeMonthlyInsights(
  transactions: Transaction[],
  filters: Pick<Filters, 'category' | 'person'>,
  referenceDate = new Date(),
): MonthlyInsights {
  const currentMonth = monthKey(referenceDate)
  const previousDate = new Date(referenceDate)
  previousDate.setMonth(previousDate.getMonth() - 1)
  const previousMonth = monthKey(previousDate)

  const scoped = transactions.filter((tx) => {
    if (filters.category !== 'all' && tx.category !== filters.category) return false
    if (filters.person !== 'all' && tx.person !== filters.person) return false
    return true
  })

  const currentTx = scoped.filter((tx) => tx.date.startsWith(currentMonth))
  const previousTx = scoped.filter((tx) => tx.date.startsWith(previousMonth))

  const currentMonthTotal = sum(currentTx)
  const previousMonthTotal = sum(previousTx)
  const deltaAmount = currentMonthTotal - previousMonthTotal
  const deltaPercent = previousMonthTotal === 0 ? null : (deltaAmount / previousMonthTotal) * 100

  const byCategory = new Map<Category, number>()
  for (const tx of currentTx) {
    byCategory.set(tx.category, (byCategory.get(tx.category) ?? 0) + tx.amount)
  }
  let topCategory: MonthlyInsights['topCategory'] = null
  for (const [category, amount] of byCategory) {
    if (!topCategory || amount > topCategory.amount) topCategory = { category, amount }
  }

  return {
    currentMonthTotal,
    previousMonthTotal,
    deltaAmount,
    deltaPercent,
    topCategory,
    transactionCount: currentTx.length,
  }
}
