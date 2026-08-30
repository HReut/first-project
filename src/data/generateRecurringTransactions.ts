import type { Store } from '../state/store.ts'
import type { AppState } from '../types.ts'
import { createTransactions, updateTransaction } from './transactionsRepo.ts'
import { updateRecurringRule } from './recurringRulesRepo.ts'
import { dueMonthsForRule, matchesRuleTransaction, transactionForDueRule } from '../utils/recurring.ts'
import { computeReviewedStatus } from '../utils/insights.ts'
import { monthKeyFromDate } from '../utils/format.ts'

// Guards against two overlapping calls both reading the same
// pre-generation state and both writing the same "missing" months —
// generateDueRecurringTransactions reads state, does async network writes,
// then applies the result, so a second call arriving before the first
// finishes would see the exact same due months as still-missing and
// duplicate every one of them. Module-level is fine: this app has one
// store per page load, so a real concurrent call can only come from this
// same tab (app-load's automatic call overlapping a save-triggered one).
let inFlight: Promise<void> | null = null

/** Generates every transaction due for every active recurring rule, up
 * through `monthKey` (defaults to the current month) — not just that one
 * month, so a rule created (or edited) with a backdated start month
 * backfills every missed month in one pass instead of only ever adding one
 * transaction per app load. Called on every app load (App.ts) and again
 * right after creating/editing a rule (BudgetsView.ts) so a backfill shows
 * up immediately rather than waiting for the next reload. Safe to call
 * repeatedly, including concurrently — a rule with nothing new due is a
 * no-op, and an overlapping call reuses the in-flight run instead of
 * racing it (see `inFlight` above). Which months are "already covered" is
 * decided by matching real transactions (see dueMonthsForRule /
 * matchesRuleTransaction), not by trusting lastGeneratedMonth/
 * occurrencesGenerated — those are just a display summary of past runs and
 * can drift from reality, so a rule can never get permanently stuck the
 * way trusting them could. New rows snapshot their category's budget
 * standing the same as any other transaction (see transactionForDueRule)
 * rather than landing 'pending'; this also one-time-resolves any
 * transaction still stuck 'pending' from before that was true (e.g. a
 * backfill run before this fix), since there's no "מרכז בדיקה"/"סמן כנבדק"
 * workflow left to clear it otherwise. */
export function generateDueRecurringTransactions(store: Store<AppState>, monthKey = monthKeyFromDate(new Date())): Promise<void> {
  if (inFlight) return inFlight
  inFlight = runGeneration(store, monthKey).finally(() => {
    inFlight = null
  })
  return inFlight
}

async function runGeneration(store: Store<AppState>, monthKey: string): Promise<void> {
  const { recurringRules: rules, transactions, categories, budgetLimitOverrides } = store.getState()
  const due = rules.map((rule) => ({ rule, months: dueMonthsForRule(rule, monthKey, transactions) })).filter((entry) => entry.months.length > 0)
  const stalePending = transactions.filter((tx) => tx.status === 'pending')
  if (due.length === 0 && stalePending.length === 0) return

  const newTransactions = due.flatMap(({ rule, months }) => months.map((m) => transactionForDueRule(rule, m, transactions, categories, budgetLimitOverrides)))
  const ruleUpdates = due.map(({ rule, months }) => ({
    id: rule.id,
    lastGeneratedMonth: months[months.length - 1],
    // Derived from real matching transactions plus what this run adds —
    // not rule.occurrencesGenerated + months.length, which would just keep
    // compounding a value that's already drifted from reality (see
    // matchesRuleTransaction's doc comment).
    occurrencesGenerated: transactions.filter((tx) => matchesRuleTransaction(rule, tx)).length + months.length,
  }))

  const [created, updatedRules, resolvedStale] = await Promise.all([
    due.length === 0 ? Promise.resolve([]) : createTransactions(newTransactions),
    Promise.all(ruleUpdates.map((u) => updateRecurringRule(u.id, { lastGeneratedMonth: u.lastGeneratedMonth, occurrencesGenerated: u.occurrencesGenerated }))),
    Promise.all(stalePending.map((tx) => updateTransaction(tx.id, { status: computeReviewedStatus(transactions, categories, tx.categoryId, budgetLimitOverrides) }))),
  ])

  const updatedById = new Map(updatedRules.map((rule) => [rule.id, rule]))
  const resolvedById = new Map(resolvedStale.map((tx) => [tx.id, tx]))
  const state = store.getState()
  store.setState({
    transactions: [...created, ...state.transactions.map((tx) => resolvedById.get(tx.id) ?? tx)],
    recurringRules: state.recurringRules.map((rule) => updatedById.get(rule.id) ?? rule),
  })
}
