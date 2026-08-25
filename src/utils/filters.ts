import type { Filters, Transaction } from '../types.ts'

export function matchesPeriod(date: string, period: Filters['period']): boolean {
  if (period.kind === 'all') return true
  if (period.kind === 'month') return date.startsWith(period.month)
  return date >= period.start && date <= period.end
}

export type PeriodPreset = 'this-month' | 'last-month' | 'last-3' | 'last-6' | 'all'

function monthKeyOffset(monthsAgo: number, from: Date): string {
  return new Date(from.getFullYear(), from.getMonth() - monthsAgo, 1).toISOString().slice(0, 7)
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Shared preset -> Filters['period'] conversion for any view that offers a
 * simple period dropdown (Budgets, Analytics) without the Transactions
 * page's extra "custom range" option. */
export function periodPresetToFilter(preset: PeriodPreset, from = new Date()): Filters['period'] {
  if (preset === 'this-month') return { kind: 'month', month: monthKeyOffset(0, from) }
  if (preset === 'last-month') return { kind: 'month', month: monthKeyOffset(1, from) }
  if (preset === 'all') return { kind: 'all' }

  const start = new Date(from)
  start.setMonth(start.getMonth() - (preset === 'last-3' ? 3 : 6))
  return { kind: 'range', start: isoDate(start), end: isoDate(from) }
}

export function filterTransactions(transactions: Transaction[], filters: Filters): Transaction[] {
  const search = filters.search.trim().toLowerCase()
  return transactions.filter((tx) => {
    if (filters.categoryId !== 'all' && tx.categoryId !== filters.categoryId) return false
    if (filters.person !== 'all' && tx.person !== filters.person) return false
    if (!matchesPeriod(tx.date, filters.period)) return false
    if (search && !tx.merchant.toLowerCase().includes(search)) return false
    return true
  })
}
