import type { AccountBalance, Category, Filters, Person, Transaction, TransactionStatus } from '../types.ts'
import { budgetPercent, budgetStatus } from './budget.ts'
import { matchesPeriod } from './filters.ts'

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
 * Per-category totals scoped by the category/person filters, sorted highest
 * spend first. Defaults to the current calendar month (referenceDate); pass
 * `period` to scope to any Transactions-style period instead — used by the
 * Budgets and Analytics pages' period selectors.
 */
export function computeCategoryBreakdown(
  transactions: Transaction[],
  filters: Pick<Filters, 'categoryId' | 'person'>,
  referenceDate = new Date(),
  period?: Filters['period'],
): CategoryBreakdownEntry[] {
  const scoped = scopeByPersonAndCategory(transactions, filters)
  const currentTx = period ? scoped.filter((tx) => matchesPeriod(tx.date, period)) : scoped.filter((tx) => tx.date.startsWith(monthKey(referenceDate)))

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

/** Budgeted categories (limit set) with their spend for the given period
 * (defaults to this month), sorted by how close each is to blowing its
 * limit — the "which budgets need attention" ordering shared by the
 * Overview and Transactions pages, and the Budgets page's period selector. */
export function topBudgetedCategories(
  transactions: Transaction[],
  categories: Category[],
  period?: Filters['period'],
): { category: Category; spent: number }[] {
  const breakdown = computeCategoryBreakdown(transactions, { categoryId: 'all', person: 'all' }, new Date(), period)
  const spentByCategory = new Map(breakdown.map((entry) => [entry.categoryId, entry.amount]))
  return categories
    .filter((category) => category.monthlyBudgetLimit !== null && category.monthlyBudgetLimit > 0)
    .map((category) => ({ category, spent: spentByCategory.get(category.id) ?? 0 }))
    .sort((a, b) => budgetPercent(b.spent, b.category.monthlyBudgetLimit) - budgetPercent(a.spent, a.category.monthlyBudgetLimit))
}

/** The status a pending transaction snapshots to when reviewed — its
 * category's current budget standing. Shared by TransactionsView's "Mark
 * reviewed" actions (row, bulk, and new-manual-transaction default) and
 * Overview's Review center quick-approve. */
export function computeReviewedStatus(transactions: Transaction[], categories: Category[], categoryId: string): TransactionStatus {
  const category = categories.find((c) => c.id === categoryId)
  const breakdown = computeCategoryBreakdown(transactions, { categoryId: 'all', person: 'all' })
  const spent = breakdown.find((entry) => entry.categoryId === categoryId)?.amount ?? 0
  return budgetStatus(spent, category?.monthlyBudgetLimit ?? null) === 'critical' ? 'exceeded' : 'on_budget'
}

/**
 * Settlement is driven by `account`, not who's tagged as the spender:
 * - 'shared' transactions come out of the joint pool directly — $0 effect
 *   on who-owes-who.
 * - 'reut_personal' transactions were a shared expense Reut fronted from her
 *   own pocket, so Keren owes half of it back to Reut (and symmetrically for
 *   'keren_personal'). Returns null when nothing is owed either way.
 *
 * `settledAfter`, if given, excludes transactions dated on/before that ISO
 * date — this is how "mark as settled" clears the balance without touching
 * the underlying transactions.
 */
export function computeSplitBalance(transactions: Transaction[], referenceDate = new Date(), settledAfter?: string | null): SplitBalance | null {
  const currentMonth = monthKey(referenceDate)
  const currentTx = transactions.filter((tx) => tx.date.startsWith(currentMonth) && (!settledAfter || tx.date > settledAfter))
  const owedToReut = sum(currentTx.filter((tx) => tx.account === 'reut_personal')) / 2
  const owedToKeren = sum(currentTx.filter((tx) => tx.account === 'keren_personal')) / 2
  const diff = owedToReut - owedToKeren
  const amount = Math.round(Math.abs(diff))
  if (amount === 0) return null
  return diff > 0 ? { owingPerson: 'Keren', owedPerson: 'Reut', amount } : { owingPerson: 'Reut', owedPerson: 'Keren', amount }
}

/**
 * "Total Available" — the household enters the shared account's real
 * balance once (AccountBalance.startingBalance, as of setAt), and this
 * subtracts every 'shared'-account transaction logged since then. Personal
 * account transactions don't touch it, same as computeSplitBalance's model:
 * 'shared' spending comes out of this pool directly, personal spending
 * doesn't. Null in, null out — nothing to show until a balance is set.
 */
export function computeTotalAvailable(transactions: Transaction[], balance: AccountBalance | null): number | null {
  if (!balance) return null
  const spentSinceSet = sum(transactions.filter((tx) => tx.account === 'shared' && tx.date >= balance.setAt))
  return balance.startingBalance - spentSinceSet
}
