import type { Store } from '../state/store.ts'
import type { AppState, Person, Transaction, TransactionDeletedBefore } from '../types.ts'
import { deleteTransactions } from './transactionsRepo.ts'
import { updateRecurringRule } from './recurringRulesRepo.ts'
import { logActivity } from './activityLogRepo.ts'
import { formatCurrency } from '../utils/format.ts'
import { matchesRuleTransaction } from '../utils/recurring.ts'

/** Shared delete-and-log step for the two cleanups below: removes the given
 * transactions, updates the store, and logs one undo-capable History entry
 * (same shape as TransactionsView's bulkDelete) so the removal is visible
 * and reversible, not a silent background change. */
async function removeTransactionsAndLog(store: Store<AppState>, currentPerson: Person, toRemove: Transaction[], summary: string): Promise<void> {
  if (toRemove.length === 0) return
  const ids = toRemove.map((tx) => tx.id)
  const idSet = new Set(ids)

  await deleteTransactions(ids)
  const { transactions: current } = store.getState()
  store.setState({ transactions: current.filter((tx) => !idSet.has(tx.id)) })

  const before: TransactionDeletedBefore = { transactions: toRemove }
  try {
    const entry = await logActivity({ entityType: 'transaction', action: 'bulk_deleted', summary, beforeData: before, performedBy: currentPerson })
    const { activityLog } = store.getState()
    store.setState({ activityLog: [entry, ...activityLog] })
  } catch (err) {
    console.warn('Could not write to History — has migration 0009 been run?', err)
  }
}

/** One-time cleanup for the exact-duplicate recurring transactions a since-
 * fixed race condition could create (generateDueRecurringTransactions
 * running twice concurrently, both inserting the same "missing" months —
 * see its own doc comment). Scoped tightly to source:'recurring' rows that
 * are identical on every money-relevant field, so a manually-entered or
 * imported transaction that merely happens to look similar is never
 * touched. Naturally idempotent — once a group is down to one row, it's no
 * longer a duplicate, so this is a no-op on every later run and safe to
 * call on every app load indefinitely (see App.ts). */
export async function dedupeRecurringTransactions(store: Store<AppState>, currentPerson: Person): Promise<void> {
  const { transactions } = store.getState()

  const groups = new Map<string, Transaction[]>()
  for (const tx of transactions) {
    if (tx.source !== 'recurring') continue
    const key = [tx.date, tx.merchant, tx.amount, tx.currency, tx.originalAmount, tx.categoryId, tx.account, tx.person].join('|')
    const group = groups.get(key)
    if (group) group.push(tx)
    else groups.set(key, [tx])
  }

  const toDelete: Transaction[] = []
  for (const group of groups.values()) {
    if (group.length < 2) continue
    const sorted = [...group].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1))
    toDelete.push(...sorted.slice(1)) // keep the earliest, drop the rest
  }

  const total = toDelete.reduce((sum, tx) => sum + tx.amount, 0)
  await removeTransactionsAndLog(store, currentPerson, toDelete, `${toDelete.length} תנועות כפולות (מתשלומים קבועים) הוסרו אוטומטית (סה"כ ${formatCurrency(total)})`)
}

/** One-time cleanup for a second, larger piece of the same fallout: a
 * corrupted lastGeneratedMonth (see dueMonthsForRule's doc comment) could
 * make the old counter-trusting generation logic compute a due-months list
 * stretching centuries into the future before that logic was replaced.
 * No recurring-generated transaction can legitimately be dated after
 * today — generation only ever creates rows through the current month —
 * so any source:'recurring' row dated later than today is unambiguously
 * bogus and safe to remove outright, regardless of what it looks like.
 * Naturally idempotent, same as dedupeRecurringTransactions above. */
export async function removeFutureRecurringTransactions(store: Store<AppState>, currentPerson: Person): Promise<void> {
  const { transactions } = store.getState()
  const today = new Date().toISOString().slice(0, 10)
  const bogus = transactions.filter((tx) => tx.source === 'recurring' && tx.date > today)

  const total = bogus.reduce((sum, tx) => sum + tx.amount, 0)
  await removeTransactionsAndLog(
    store,
    currentPerson,
    bogus,
    `${bogus.length} תנועות עתידיות שגויות (מתשלומים קבועים) הוסרו אוטומטית (סה"כ ${formatCurrency(total)})`,
  )
}

/** Fixes a rule's displayed lastGeneratedMonth/occurrencesGenerated when
 * they've drifted from the real data (e.g. the corruption described in
 * removeFutureRecurringTransactions's doc comment) — generation itself no
 * longer depends on these being correct (see dueMonthsForRule), but a rule
 * that's actually fully up to date still deserves to *say* so instead of
 * permanently showing "עדיין לא נוצרה החודש". No-op once the stored
 * values already match reality, so safe on every app load. */
export async function resyncRecurringRuleCounters(store: Store<AppState>): Promise<void> {
  const { recurringRules, transactions } = store.getState()

  const updates = recurringRules
    .map((rule) => {
      const matching = transactions.filter((tx) => matchesRuleTransaction(rule, tx))
      const trueLastMonth = matching.reduce<string | null>((latest, tx) => {
        const month = tx.date.slice(0, 7)
        return latest === null || month > latest ? month : latest
      }, null)
      return { rule, trueLastMonth, trueCount: matching.length }
    })
    .filter(({ rule, trueLastMonth, trueCount }) => rule.lastGeneratedMonth !== trueLastMonth || rule.occurrencesGenerated !== trueCount)

  if (updates.length === 0) return

  const updated = await Promise.all(
    updates.map(({ rule, trueLastMonth, trueCount }) => updateRecurringRule(rule.id, { lastGeneratedMonth: trueLastMonth, occurrencesGenerated: trueCount })),
  )
  const updatedById = new Map(updated.map((rule) => [rule.id, rule]))
  const state = store.getState()
  store.setState({ recurringRules: state.recurringRules.map((rule) => updatedById.get(rule.id) ?? rule) })
}
