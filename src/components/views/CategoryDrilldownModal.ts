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
      <div class="modal__actions">
        <button type="button" class="btn" id="drilldown-close">סגירה</button>
      </div>
    `,
    { ariaLabel: `${category.name} — תנועות` },
  )
  modal.element.classList.add('modal--import-preview')

  const summaryEl = modal.element.querySelector<HTMLElement>('#drilldown-summary')!
  const bodyEl = modal.element.querySelector<HTMLElement>('#drilldown-body')!

  function renderRows(): void {
    const { categories } = store.getState()
    const categoryOptions = (selectedId: string) => categories.map((c) => `<option value="${c.id}" ${c.id === selectedId ? 'selected' : ''}>${c.icon} ${c.name}</option>`).join('')

    summaryEl.textContent =
      currentRows.length === 0
        ? 'אין תנועות בקטגוריה זו לתקופה שנבחרה.'
        : `${currentRows.length} תנועות · סה"כ ${formatCurrency(currentRows.reduce((sum, tx) => sum + tx.amount, 0))}`

    bodyEl.innerHTML = currentRows
      .map(
        (tx) => `
      <tr data-id="${tx.id}">
        <td><input type="date" class="filter-input" data-field="date" value="${tx.date}"></td>
        <td><input type="text" class="filter-input" data-field="merchant" value="${tx.merchant}" placeholder="בית עסק (לא חובה)"></td>
        <td><select class="filter-select" data-field="categoryId">${categoryOptions(tx.categoryId)}</select></td>
        <td>
          <select class="filter-select" data-field="person" ${tx.account !== 'shared' ? 'disabled title="חשבון אישי — מי שילם/ה קבוע"' : ''}>
            ${PEOPLE.map((p) => `<option value="${p}" ${p === tx.person ? 'selected' : ''}>${personLabel(p)}</option>`).join('')}
          </select>
        </td>
        <td><input type="number" class="filter-input" data-field="amount" min="0" step="0.01" value="${tx.originalAmount.toFixed(2)}"></td>
        <td><button type="button" class="btn btn--sm btn--danger" data-delete-tx="${tx.id}">מחיקה</button></td>
      </tr>
    `,
      )
      .join('')
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
    const tx = currentRows.find((t) => t.id === id)
    if (!tx) return
    const field = input.dataset.field!

    let patch: Partial<NewTransaction>
    if (field === 'amount') {
      const value = Number(input.value)
      if (Number.isNaN(value) || value < 0) {
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
      if (tx.currency === 'USD') {
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

    updateTransaction(id, patch).then((updated) => {
      const { transactions } = store.getState()
      store.setState({ transactions: transactions.map((t) => (t.id === updated.id ? updated : t)) })
      logTx('updated', `עודכן ${updated.merchant || 'תנועה'} (${field})`)

      // Moved out of this category (or out of the person filter) — it no
      // longer belongs in this list.
      if (updated.categoryId !== category.id || (personFilter !== 'all' && updated.person !== personFilter)) {
        currentRows = currentRows.filter((t) => t.id !== id)
      } else {
        currentRows = currentRows.map((t) => (t.id === id ? updated : t))
      }
      renderRows()
    })
  })

  bodyEl.addEventListener('click', (event) => {
    const deleteBtn = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-delete-tx]')
    if (!deleteBtn) return
    const id = deleteBtn.dataset.deleteTx!
    const tx = currentRows.find((t) => t.id === id)
    if (!tx) return

    confirmDialog(`למחוק את ${tx.merchant || 'התנועה'} (${formatCurrency(tx.originalAmount, tx.currency)})? ניתן לבטל זאת מההיסטוריה.`, 'מחיקה').then((confirmed) => {
      if (!confirmed) return
      deleteTransactions([id]).then(() => {
        const { transactions } = store.getState()
        store.setState({ transactions: transactions.filter((t) => t.id !== id) })
        const before: TransactionDeletedBefore = { transactions: [tx] }
        logTx('deleted', `נמחקה ${tx.merchant || 'תנועה'} (${formatCurrency(tx.originalAmount, tx.currency)})`, before)
        currentRows = currentRows.filter((t) => t.id !== id)
        renderRows()
      })
    })
  })

  modal.element.querySelector<HTMLButtonElement>('#drilldown-close')!.addEventListener('click', () => modal.close())
}
