import type { Store } from '../state/store.ts'
import type { AppState } from '../types.ts'
import { createTransactions } from './transactionsRepo.ts'
import { updateRecurringRule } from './recurringRulesRepo.ts'
import { dueMonthsForRule, transactionForDueRule } from '../utils/recurring.ts'

/** Generates every transaction due for every active recurring rule, up
 * through `monthKey` (defaults to the current month) — not just that one
 * month, so a rule created (or edited) with a backdated start month
 * backfills every missed month in one pass instead of only ever adding one
 * transaction per app load. Called on every app load (App.ts) and again
 * right after creating/editing a rule (BudgetsView.ts) so a backfill shows
 * up immediately rather than waiting for the next reload. Safe to call
 * repeatedly — a rule with nothing new due is a no-op. New rows land
 * 'pending' so they go through the normal review flow, same as an import. */
export async function generateDueRecurringTransactions(store: Store<AppState>, monthKey = new Date().toISOString().slice(0, 7)): Promise<void> {
  const rules = store.getState().recurringRules
  const due = rules.map((rule) => ({ rule, months: dueMonthsForRule(rule, monthKey) })).filter((entry) => entry.months.length > 0)
  if (due.length === 0) return

  const newTransactions = due.flatMap(({ rule, months }) => months.map((m) => transactionForDueRule(rule, m)))
  const ruleUpdates = due.map(({ rule, months }) => ({
    id: rule.id,
    lastGeneratedMonth: months[months.length - 1],
    occurrencesGenerated: rule.occurrencesGenerated + months.length,
  }))

  const [created, updatedRules] = await Promise.all([
    createTransactions(newTransactions),
    Promise.all(ruleUpdates.map((u) => updateRecurringRule(u.id, { lastGeneratedMonth: u.lastGeneratedMonth, occurrencesGenerated: u.occurrencesGenerated }))),
  ])

  const updatedById = new Map(updatedRules.map((rule) => [rule.id, rule]))
  const state = store.getState()
  store.setState({
    transactions: [...created, ...state.transactions],
    recurringRules: state.recurringRules.map((rule) => updatedById.get(rule.id) ?? rule),
  })
}
