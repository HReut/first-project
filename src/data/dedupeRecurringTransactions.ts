import type { Store } from '../state/store.ts'
import type { AppState, Person, Transaction, TransactionDeletedBefore } from '../types.ts'
import { deleteTransactions } from './transactionsRepo.ts'
import { logActivity } from './activityLogRepo.ts'
import { formatCurrency } from '../utils/format.ts'

/** One-time cleanup for the exact-duplicate recurring transactions a since-
 * fixed race condition could create (generateDueRecurringTransactions
 * running twice concurrently, both inserting the same "missing" months —
 * see its own doc comment). Scoped tightly to source:'recurring' rows that
 * are identical on every money-relevant field, so a manually-entered or
 * imported transaction that merely happens to look similar is never
 * touched. Naturally idempotent — once a group is down to one row, it's no
 * longer a duplicate, so this is a no-op on every later run and safe to
 * call on every app load indefinitely (see App.ts). Logs one activity
 * entry with full before-data, so the removal is visible and undoable from
 * History like any other delete. */
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

  if (toDelete.length === 0) return

  const ids = toDelete.map((tx) => tx.id)
  const idSet = new Set(ids)
  const total = toDelete.reduce((sum, tx) => sum + tx.amount, 0)

  await deleteTransactions(ids)
  const { transactions: current } = store.getState()
  store.setState({ transactions: current.filter((tx) => !idSet.has(tx.id)) })

  const before: TransactionDeletedBefore = { transactions: toDelete }
  try {
    const entry = await logActivity({
      entityType: 'transaction',
      action: 'bulk_deleted',
      summary: `${toDelete.length} תנועות כפולות (מתשלומים קבועים) הוסרו אוטומטית (סה"כ ${formatCurrency(total)})`,
      beforeData: before,
      performedBy: currentPerson,
    })
    const { activityLog } = store.getState()
    store.setState({ activityLog: [entry, ...activityLog] })
  } catch (err) {
    console.warn('Could not write to History — has migration 0009 been run?', err)
  }
}
