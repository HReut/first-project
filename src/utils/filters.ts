import type { Filters, Transaction } from '../types.ts'

export function matchesPeriod(date: string, period: Filters['period']): boolean {
  if (period.kind === 'all') return true
  if (period.kind === 'month') return date.startsWith(period.month)
  return date >= period.start && date <= period.end
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
