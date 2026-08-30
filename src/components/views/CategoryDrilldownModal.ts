import type { Store } from '../../state/store.ts'
import type { AppState, Category, Filters, NewTransaction, Person, TransactionDeletedBefore } from '../../types.ts'
import { matchesPeriod } from '../../utils/filters.ts'
import { resolveIlsAmount } from '../../utils/currency.ts'
import { formatCurrency, personLabel } from '../../utils/format.ts'
import { deleteTransactions, updateTransaction } from '../../data/transactionsRepo.ts'
import { logActivity } from '../../data/activityLogRepo.ts'
import { Modal } from '../shared/Modal.ts'
import { confirmDialog } from '../shared/confirmDialog.ts'
import { showToast } from '../shared/Toast.ts'

const PEOPLE: Person[] = ['Reut', 'Keren']

/** Opens from clicking a category anywhere on Analytics (distribution bar,
 * the person-comparison chart, the "top category" highlight) — every
 * transaction in that category for the currently-viewed period/person
 * filter, editable right there. Fixing a miscategorized transaction here
 * drops it out of the list immediately, same as it would drop out of this
 * category's slice of the chart once the modal closes. */
export function openCategoryDrilldown(
  store: Store<AppState>,
  currentPerson: Person,
  category: Category,
  period: Filters['period'],
  periodLabel: string,
  personFilter: Person | 'all',
): void {
  let currentRows = store
    .getState()
    .transactions.filter((tx) => tx.categoryId === category.id && matchesPeriod(tx.date, period) && (personFilter === 'all' || tx.person === personFilter))
    .sort((a, b) => (a.date < b.date ? 1 : -1))

  const pendingEdits = new Map<string, Partial<NewTransaction>>()

  const modal = new Modal(
    `
      <h2 class="modal__title">${category.icon} ${category.name} — ${periodLabel}</h2>
      <p class="import-preview__hint" id="drilldown-summary"></p>
      <div class="import-preview__table-wrap">
        <table class="import-preview__table">
          <thead>
            <tr>
              <th>תאריך</th>
              <th>בית עסק</th>
              <th>קטגוריה</th>
              <th>מי שילם/ה</th>
              <th>סכום</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="drilldown-body"></tbody>
        </table>
      </div>
      <div class="pending-bar" id="drilldown-pending-bar" hidden>
        <span class="pending-bar__count" id="drilldown-pending-count"></span>
        <button type="button" class="btn btn--sm" id="drilldown-discard-btn">ביטול שינויים</button>
        <button type="button" class="btn btn--primary btn--sm" id="drilldown-save-btn">שמירת שינויים</button>
      </div>
      <div class="modal__actions">
        <button type="button" class="btn" id="drilldown-close">סגירה</button>
      </div>
    `,
    {
      ariaLabel: `${category.name} — תנועות`,
      onBeforeClose: async () => {
        if (pendingEdits.size === 0) return true
        return confirmDialog('יש שינויים שלא נשמרו בחלון זה. לצאת בכל זאת?', 'צא')
      },
    },
  )
  modal.element.classList.add('modal--import-preview')

  const summaryEl = modal.element.querySelector<HTMLElement>('#drilldown-summary')!
  const bodyEl = modal.element.querySelector<HTMLElement>('#drilldown-body')!
  const pendingBarEl = modal.element.querySelector<HTMLElement>('#drilldown-pending-bar')!
  const pendingCountEl = modal.element.querySelector<HTMLElement>('#drilldown-pending-count')!

  function renderPendingBar(): void {
    pendingBarEl.hidden = pendingEdits.size === 0
    pendingCountEl.textContent = `${pendingEdits.size} שינויים לא שמורים`
  }

  /** Overlays unsaved staged edits over the real fetched rows, same
   * "display what you typed without touching the store yet" pattern as
   * TransactionsView's visibleRows() — a row stays in this list even after
   * an edit would move it out of the category/period/person filter, until
   * Save actually commits it. */
  function overlaidRows(): typeof currentRows {
    return currentRows.map((tx) => {
      const pending = pendingEdits.get(tx.id)
      return pending ? { ...tx, ...pending } : tx
    })
  }

  function renderRows(): void {
    const { categories } = store.getState()
    const categoryOptions = (selectedId: string) => categories.map((c) => `<option value="${c.id}" ${c.id === selectedId ? 'selected' : ''}>${c.icon} ${c.name}</option>`).join('')
    const rows = overlaidRows()

    summaryEl.textContent =
      rows.length === 0 ? 'אין תנועות בקטגוריה זו לתקופה שנבחרה.' : `${rows.length} תנועות · סה"כ ${formatCurrency(rows.reduce((sum, tx) => sum + tx.amount, 0))}`

    bodyEl.innerHTML = rows
      .map(
        (tx) => `
      <tr data-id="${tx.id}" class="${pendingEdits.has(tx.id) ? 'tx-row--pending' : ''}">
        <td><input type="date" class="filter-input" data-field="date" value="${tx.date}"></td>
        <td><input type="text" class="filter-input" data-field="merchant" value="${tx.merchant}" placeholder="בית עסק (לא חובה)"></td>
        <td><select class="filter-select" data-field="categoryId">${categoryOptions(tx.categoryId)}</select></td>
        <td>
          <select class="filter-select" data-field="person" ${tx.account !== 'shared' ? 'disabled title="חשבון אישי — מי שילם/ה קבוע"' : ''}>
            ${PEOPLE.map((p) => `<option value="${p}" ${p === tx.person ? 'selected' : ''}>${personLabel(p)}</option>`).join('')}
          </select>
        </td>
        <td><input type="number" class="filter-input${tx.originalAmount < 0 ? ' is-credit' : ''}" data-field="amount" step="0.01" value="${tx.originalAmount.toFixed(2)}"></td>
        <td><button type="button" class="btn btn--sm btn--danger" data-delete-tx="${tx.id}">מחיקה</button></td>
      </tr>
    `,
      )
      .join('')
    renderPendingBar()
  }

  function logTx(action: 'updated' | 'deleted', summary: string, beforeData: unknown = null): void {
    logActivity({ entityType: 'transaction', action, summary, beforeData, performedBy: currentPerson })
      .then((entry) => {
        const { activityLog } = store.getState()
        store.setState({ activityLog: [entry, ...activityLog] })
      })
      .catch((err: unknown) => console.warn('Could not write to History — has migration 0009 been run?', err))
  }

  renderRows()

  bodyEl.addEventListener('change', async (event) => {
    const input = (event.target as HTMLElement).closest<HTMLElement>('[data-field]') as HTMLInputElement | HTMLSelectElement | null
    if (!input) return
    const id = input.closest<HTMLTableRowElement>('tr')!.dataset.id!
    const tx = overlaidRows().find((t) => t.id === id)
    if (!tx) return
    const field = input.dataset.field!

    let patch: Partial<NewTransaction>
    if (field === 'amount') {
      const value = Number(input.value)
      // Negative is valid — a real refund/credit row, not an error.
      if (Number.isNaN(value) || value === 0) {
        renderRows()
        return
      }
      const { amount, usedFallback } = await resolveIlsAmount(value, tx.currency, tx.date, store.getState().exchangeRate)
      patch = { originalAmount: value, amount }
      if (usedFallback) showToast('לא ניתן היה לאתר את שער החליפין האמיתי לתאריך זה — נעשה שימוש בשער הגיבוי שהוגדר בהגדרות.')
    } else if (field === 'date') {
      if (!input.value) {
        renderRows()
        return
      }
      if (tx.currency !== 'ILS') {
        const { amount, usedFallback } = await resolveIlsAmount(tx.originalAmount, tx.currency, input.value, store.getState().exchangeRate)
        patch = { date: input.value, amount }
        if (usedFallback) showToast('לא ניתן היה לאתר את שער החליפין האמיתי לתאריך זה — נעשה שימוש בשער הגיבוי שהוגדר בהגדרות.')
      } else {
        patch = { date: input.value }
      }
    } else if (field === 'merchant') {
      patch = { merchant: input.value.trim() }
    } else if (field === 'categoryId') {
      patch = { categoryId: input.value }
    } else if (field === 'person') {
      patch = { person: input.value as Person }
    } else {
      return
    }

    pendingEdits.set(id, { ...pendingEdits.get(id), ...patch })
    renderRows()
  })

  async function savePendingEdits(): Promise<void> {
    const entries = [...pendingEdits]
    if (entries.length === 0) return

    try {
      const updated = await Promise.all(entries.map(([id, patch]) => updateTransaction(id, patch)))
      const updatedById = new Map(updated.map((tx) => [tx.id, tx]))
      const { transactions } = store.getState()
      store.setState({ transactions: transactions.map((t) => updatedById.get(t.id) ?? t) })
      pendingEdits.clear()
      showToast(entries.length === 1 ? 'השינוי נשמר.' : `${entries.length} שינויים נשמרו.`, [], 2000)
      logTx('updated', entries.length === 1 ? `עודכנה תנועה ${updated[0]?.merchant || 'ללא שם'}` : `${entries.length} תנועות עודכנו`)

      // Rows that moved out of this category (or out of the person filter)
      // no longer belong in this list, now that the edit is actually saved.
      currentRows = currentRows
        .map((t) => updatedById.get(t.id) ?? t)
        .filter((t) => t.categoryId === category.id && (personFilter === 'all' || t.person === personFilter))
      renderRows()
    } catch {
      showToast('שמירת השינויים נכשלה — נסה/י שוב.')
    }
  }

  modal.element.querySelector<HTMLButtonElement>('#drilldown-save-btn')!.addEventListener('click', () => {
    void savePendingEdits()
  })
  modal.element.querySelector<HTMLButtonElement>('#drilldown-discard-btn')!.addEventListener('click', () => {
    pendingEdits.clear()
    renderRows()
  })

  bodyEl.addEventListener('click', (event) => {
    const deleteBtn = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-delete-tx]')
    if (!deleteBtn) return
    const id = deleteBtn.dataset.deleteTx!
    // Deliberately the real saved row, not the overlaid preview — an
    // unsaved staged edit was never written to the database, so undo must
    // restore what deleteTransactions() actually removes.
    const tx = currentRows.find((t) => t.id === id)
    if (!tx) return

    confirmDialog(`למחוק את ${tx.merchant || 'התנועה'} (${formatCurrency(tx.originalAmount, tx.currency)})? ניתן לבטל זאת מההיסטוריה.`, 'מחיקה').then((confirmed) => {
      if (!confirmed) return
      deleteTransactions([id]).then(() => {
        const { transactions } = store.getState()
        store.setState({ transactions: transactions.filter((t) => t.id !== id) })
        const before: TransactionDeletedBefore = { transactions: [tx] }
        logTx('deleted', `נמחקה ${tx.merchant || 'תנועה'} (${formatCurrency(tx.originalAmount, tx.currency)})`, before)
        pendingEdits.delete(id)
        currentRows = currentRows.filter((t) => t.id !== id)
        renderRows()
      })
    })
  })

  modal.element.querySelector<HTMLButtonElement>('#drilldown-close')!.addEventListener('click', () => void modal.requestClose())
}
