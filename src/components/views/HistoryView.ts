import type { Store } from '../../state/store.ts'
import type { ActivityLogEntry, AppState, BudgetLimitChangedBefore, CategoryDeletedBefore, RecurringRuleDeletedBefore, TransactionDeletedBefore } from '../../types.ts'
import { formatDateTime } from '../../utils/format.ts'
import { markActivityUndone } from '../../data/activityLogRepo.ts'
import { restoreTransactions } from '../../data/transactionsRepo.ts'
import { updateCategory, restoreCategory } from '../../data/categoriesRepo.ts'
import { deleteBudgetLimitOverride, restoreBudgetLimitOverrides } from '../../data/budgetLimitOverridesRepo.ts'
import { restoreRecurringRule } from '../../data/recurringRulesRepo.ts'
import { showToast } from '../shared/Toast.ts'

/** Only these entity/action combinations get an Undo button — the ones
 * that are genuinely risky to get wrong. Everything else in the log is
 * still shown, just not reversible from here. */
function isUndoable(entry: ActivityLogEntry): boolean {
  if (entry.undone) return false
  if (entry.entityType === 'transaction') return entry.action === 'deleted' || entry.action === 'bulk_deleted'
  if (entry.entityType === 'budget_limit') return entry.action === 'changed'
  if (entry.entityType === 'settlement') return entry.action === 'settled'
  if (entry.entityType === 'category') return entry.action === 'deleted'
  if (entry.entityType === 'recurring_rule') return entry.action === 'deleted'
  return false
}

export function mountHistoryView(root: HTMLElement, store: Store<AppState>): void {
  root.innerHTML = `
    <section class="band band--hero">
      <div class="band__inner">
        <p class="eyebrow">Household finance</p>
        <h1>History.</h1>
        <p class="hero__subtitle">Every change, who made it, and when — undo the ones that are easy to get wrong.</p>
      </div>
    </section>

    <section class="band">
      <div class="band__inner">
        <div class="activity-list history-list" id="history-log" aria-label="Activity history"></div>
      </div>
    </section>
  `

  const logEl = root.querySelector<HTMLElement>('#history-log')!

  logEl.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-undo-id]')
    if (!button || button.disabled) return
    const id = button.dataset.undoId!
    const entry = store.getState().activityLog.find((e) => e.id === id)
    if (!entry) return
    button.disabled = true
    button.textContent = 'Undoing…'
    void undoEntry(entry).catch(() => {
      showToast('Could not undo that.')
      button.disabled = false
      button.textContent = 'Undo'
    })
  })

  async function undoEntry(entry: ActivityLogEntry): Promise<void> {
    if (entry.entityType === 'transaction' && (entry.action === 'deleted' || entry.action === 'bulk_deleted')) {
      const { transactions } = entry.beforeData as TransactionDeletedBefore
      const restored = await restoreTransactions(transactions)
      const state = store.getState()
      store.setState({ transactions: [...restored, ...state.transactions] })
    } else if (entry.entityType === 'budget_limit' && entry.action === 'changed') {
      const before = entry.beforeData as BudgetLimitChangedBefore
      if (before.createdOverrideId) await deleteBudgetLimitOverride(before.createdOverrideId)
      if (before.previousOverrides.length > 0) await restoreBudgetLimitOverrides(before.previousOverrides)
      const updatedCategory = await updateCategory(before.categoryId, { monthlyBudgetLimit: before.previousCategoryLimit })
      const state = store.getState()
      store.setState({
        categories: state.categories.map((c) => (c.id === updatedCategory.id ? updatedCategory : c)),
        budgetLimitOverrides: [...state.budgetLimitOverrides.filter((o) => o.id !== before.createdOverrideId), ...before.previousOverrides],
      })
    } else if (entry.entityType === 'category' && entry.action === 'deleted') {
      const before = entry.beforeData as CategoryDeletedBefore
      const restoredCategory = await restoreCategory(before.category)
      if (before.overrides.length > 0) await restoreBudgetLimitOverrides(before.overrides)
      const state = store.getState()
      store.setState({
        categories: [...state.categories, restoredCategory],
        budgetLimitOverrides: [...state.budgetLimitOverrides, ...before.overrides],
      })
    } else if (entry.entityType === 'recurring_rule' && entry.action === 'deleted') {
      const { rule } = entry.beforeData as RecurringRuleDeletedBefore
      const restored = await restoreRecurringRule(rule)
      const state = store.getState()
      store.setState({ recurringRules: [...state.recurringRules, restored] })
    }
    // 'settlement'/'settled' needs no state restore beyond marking this entry
    // undone — resolveSettledAfter() falls back to the previous settlement
    // (or "never settled") on its own once this one's excluded.

    await markActivityUndone(entry.id)
    const { activityLog } = store.getState()
    store.setState({ activityLog: activityLog.map((e) => (e.id === entry.id ? { ...e, undone: true } : e)) })
    showToast('Undone.', [], 2000)
  }

  function render(state: AppState): void {
    if (state.activityLog.length === 0) {
      logEl.innerHTML = `<p class="budget-summary__empty">Nothing logged yet — changes you make will show up here.</p>`
      return
    }

    logEl.innerHTML = state.activityLog
      .map(
        (entry) => `
      <div class="history-row">
        <div class="history-row__main">
          <span class="history-row__summary">${entry.summary}</span>
          <span class="history-row__meta">${formatDateTime(entry.performedAt)} · ${entry.performedBy}</span>
        </div>
        ${
          isUndoable(entry)
            ? `<button type="button" class="btn btn--sm" data-undo-id="${entry.id}">Undo</button>`
            : entry.undone
              ? `<span class="history-row__undone-tag">Undone</span>`
              : ''
        }
      </div>
    `,
      )
      .join('')
  }

  store.subscribe(render)
  render(store.getState())
}
