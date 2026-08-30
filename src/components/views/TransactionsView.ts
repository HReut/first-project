import type { Store } from '../../state/store.ts'
import type { Account, ActivityAction, AppState, Category, Currency, NewTransaction, Person, Transaction, TransactionDeletedBefore, TransactionStatus } from '../../types.ts'
import { filterTransactions } from '../../utils/filters.ts'
import { formatCurrency, formatDateShort, formatMonthLabel, personLabel } from '../../utils/format.ts'
import { computeReviewedStatus, computeTotalAvailable, topBudgetedCategories } from '../../utils/insights.ts'
import { resolveIlsAmount } from '../../utils/currency.ts'
import { fetchHistoricalRateToIls } from '../../data/exchangeRateApi.ts'
import { createTransaction, deleteTransactions, updateTransaction } from '../../data/transactionsRepo.ts'
import { logActivity } from '../../data/activityLogRepo.ts'
import { normalizeMerchantKey, upsertMappingRule } from '../../data/mappingRulesRepo.ts'
import {
  ACCOUNT_LABEL,
  renderAccountBadge,
  renderCategoryBadge,
  renderMerchantCell,
  renderPersonBadge,
  renderStatusBadge,
  renderWaitingBadge,
  STATUS_LABEL,
} from '../shared/transactionCells.ts'
import { renderProgressBar } from '../shared/ProgressBar.ts'
import { Modal } from '../shared/Modal.ts'
import { confirmDialog } from '../shared/confirmDialog.ts'
import { showToast } from '../shared/Toast.ts'
import { columnsIconMarkup, downloadIconMarkup, filterIconMarkup } from '../icons/NavIcons.ts'
import { openImportFlow } from './TransactionsImport.ts'

const BUDGET_CARD_LIMIT = 3

type SortColumn = 'date' | 'merchant' | 'category' | 'person' | 'account' | 'amount' | 'createdAt'
type PeriodPreset = 'this-month' | 'last-month' | 'last-3' | 'last-6' | 'this-year' | 'all' | 'custom'
type GroupBy = 'none' | 'category' | 'person' | 'month'
const PEOPLE: Person[] = ['Reut', 'Keren']
const STATUS_VALUES: TransactionStatus[] = ['pending', 'on_budget', 'exceeded']
const ACCOUNT_VALUES: Account[] = ['shared', 'reut_personal', 'keren_personal']
const CURRENCY_VALUES: Currency[] = ['ILS', 'USD', 'EUR']
const CURRENCY_LABEL: Record<Currency, string> = { ILS: '₪ שקל', USD: '$ דולר', EUR: '€ יורו' }
/** The person a personal account locks the transaction to — 'shared' has no
 * forced person, since either person may have physically paid it. */
const PERSON_FOR_ACCOUNT: Partial<Record<Account, Person>> = { reut_personal: 'Reut', keren_personal: 'Keren' }
const TOGGLEABLE_COLUMNS: { key: SortColumn; label: string }[] = [
  { key: 'date', label: 'תאריך' },
  { key: 'merchant', label: 'בית עסק' },
  { key: 'category', label: 'קטגוריה' },
  { key: 'person', label: 'משלם/ת' },
  { key: 'account', label: 'חשבון' },
  { key: 'amount', label: 'סכום' },
]

interface TxGroup {
  key: string
  label: string
  icon: string
  color: string | null
  rows: Transaction[]
  total: number
}

function monthKey(monthsAgo: number, from = new Date()): string {
  const d = new Date(from.getFullYear(), from.getMonth() - monthsAgo, 1)
  return d.toISOString().slice(0, 7)
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function monthsAgoRange(months: number): { start: string; end: string } {
  const end = new Date()
  const start = new Date()
  start.setMonth(start.getMonth() - months)
  return { start: isoDate(start), end: isoDate(end) }
}

function sortTransactions(rows: Transaction[], sort: { column: SortColumn; direction: 'asc' | 'desc' }, categoryById: Map<string, Category>): Transaction[] {
  const dir = sort.direction === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    switch (sort.column) {
      case 'date':
        return a.date < b.date ? -dir : a.date > b.date ? dir : 0
      case 'merchant':
        return a.merchant.localeCompare(b.merchant) * dir
      case 'category': {
        const nameA = categoryById.get(a.categoryId)?.name ?? ''
        const nameB = categoryById.get(b.categoryId)?.name ?? ''
        return nameA.localeCompare(nameB) * dir
      }
      case 'person':
        return a.person.localeCompare(b.person) * dir
      case 'account':
        return ACCOUNT_LABEL[a.account].localeCompare(ACCOUNT_LABEL[b.account]) * dir
      case 'amount':
        return (a.amount - b.amount) * dir
      case 'createdAt':
        return a.createdAt < b.createdAt ? -dir : a.createdAt > b.createdAt ? dir : 0
    }
  })
}

export class TransactionsView {
  #container: HTMLElement
  #store: Store<AppState>
  #currentPerson: Person
  #preset: PeriodPreset = 'this-month'
  #sort: { column: SortColumn; direction: 'asc' | 'desc' } = { column: 'date', direction: 'desc' }
  #selection = new Set<string>()
  #groupBy: GroupBy = 'none'
  #collapsedGroups = new Set<string>()
  #hiddenColumns = new Set<SortColumn>()
  /** Inline edits (any field, in the table or a card) wait here instead of
   * saving immediately — money data deserves a deliberate "yes, save this"
   * moment, not an accidental save from a stray blur. Merged over the real
   * data for display in visibleRows() so edited cells show what you typed,
   * without touching the real store (and therefore every other page's
   * totals) until Save is actually clicked. The add/edit modal is exempt —
   * its own explicit Save/Add button already *is* that deliberate moment. */
  #pendingEdits = new Map<string, Partial<NewTransaction>>()

  constructor(container: HTMLElement, store: Store<AppState>, currentPerson: Person) {
    this.#container = container
    this.#store = store
    this.#currentPerson = currentPerson
    this.renderShell()
    this.wireToolbar()
    this.wireTable()
    this.wirePendingBar()
    this.wireExport()
    this.wireImport()
    window.addEventListener('opa:new-transaction', () => this.openExpenseModal())
    store.subscribe((state) => {
      this.updateCategoryOptions(state.categories)
      this.renderTotalAvailable(state)
      this.renderBudgetCards(state)
      this.renderTable(state)
    })
    this.renderTotalAvailable(store.getState())
    this.renderBudgetCards(store.getState())
    this.renderTable(store.getState())
  }

  private wireImport(): void {
    window.addEventListener('opa:import-transactions', () => {
      openImportFlow(this.#store, this.#currentPerson)
    })
  }

  private renderTotalAvailable(state: AppState): void {
    const total = computeTotalAvailable(state.transactions, state.accountBalance)
    this.#container.querySelector<HTMLElement>('#tx-total-available')!.textContent = total === null ? 'לא הוגדר' : formatCurrency(total)
  }

  private renderBudgetCards(state: AppState): void {
    const cardsEl = this.#container.querySelector<HTMLElement>('#tx-budget-cards')!
    const budgeted = topBudgetedCategories(state.transactions, state.categories, state.budgetLimitOverrides).slice(0, BUDGET_CARD_LIMIT)

    if (budgeted.length === 0) {
      cardsEl.innerHTML = `<p class="tx-budget-cards__empty">עדיין לא הוגדרו תקציבי קטגוריה — הגדר/י בעמוד התקציבים.</p>`
      return
    }

    cardsEl.innerHTML = budgeted
      .map(
        ({ category, spent, limit }) => `
      <div class="tx-budget-card">
        <div class="tx-budget-card__top">
          <span class="tx-budget-card__icon" style="background: color-mix(in srgb, ${category.colorCode} 16%, var(--surface))">${category.icon}</span>
          <span class="tx-budget-card__tag">החודש</span>
        </div>
        <p class="tx-budget-card__name">תקציב ${category.name}</p>
        <p class="tx-budget-card__amount">${formatCurrency(spent)} <span>מתוך ${formatCurrency(limit ?? 0)}</span></p>
        ${renderProgressBar(spent, limit)}
      </div>
    `,
      )
      .join('')
  }

  private wireExport(): void {
    this.#container.querySelector<HTMLButtonElement>('#export-csv-btn')!.addEventListener('click', () => this.exportVisibleRowsAsCsv())
  }

  private exportVisibleRowsAsCsv(): void {
    const state = this.#store.getState()
    const categoryById = new Map(state.categories.map((category) => [category.id, category]))
    const rows = this.visibleRows(state)

    const header = ['תאריך', 'בית עסק', 'קטגוריה', 'משלם/ת', 'חשבון', 'סטטוס', 'סכום', 'מטבע', 'סכום בש"ח']
    const lines = rows.map((tx) => [
      tx.date,
      tx.merchant,
      categoryById.get(tx.categoryId)?.name ?? 'ללא קטגוריה',
      personLabel(tx.person),
      ACCOUNT_LABEL[tx.account],
      STATUS_LABEL[tx.status],
      tx.originalAmount.toFixed(2),
      tx.currency,
      tx.amount.toFixed(2),
    ])
    const csv = [header, ...lines].map((cols) => cols.map((col) => `"${String(col).replace(/"/g, '""')}"`).join(',')).join('\n')

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `opa-transactions-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  private renderShell(): void {
    const { filters, categories } = this.#store.getState()

    this.#container.innerHTML = `
      <section class="band band--hero band--hero--tight">
        <div class="band__inner">
          <p class="breadcrumb">כספים <span aria-hidden="true">/</span> תנועות</p>
          <div class="tx-page-header">
            <div>
              <h1>תנועות.</h1>
              <p class="hero__subtitle">כל הוצאה, ניתנת לסינון, למיון ולעריכה במקום.</p>
            </div>
            <div class="tx-page-header__actions">
              <div class="tx-page-header__stat">
                <span class="tx-page-header__stat-label">סה"כ זמין</span>
                <span class="tx-page-header__stat-value" id="tx-total-available"></span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section class="band band--tight">
        <div class="band__inner">
          <div class="tx-budget-cards" id="tx-budget-cards" aria-label="תקציבים במבט מהיר"></div>
        </div>
      </section>

      <section class="band band--tight">
        <div class="band__inner">
          <div class="transactions">
            <div class="transactions__toolbar">
              <label class="toolbar-control">
                <span class="toolbar-control__label">קיבוץ לפי</span>
                <select class="toolbar-control__input" id="group-select">
                  <option value="none">ללא</option>
                  <option value="category">קטגוריה</option>
                  <option value="person">משלם/ת</option>
                  <option value="month">חודש</option>
                </select>
              </label>

              <label class="toolbar-control">
                <span class="toolbar-control__label">מיון לפי</span>
                <select class="toolbar-control__input" id="sort-select">
                  <option value="date">תאריך</option>
                  <option value="merchant">בית עסק</option>
                  <option value="category">קטגוריה</option>
                  <option value="person">משלם/ת</option>
                  <option value="amount">סכום</option>
                  <option value="createdAt">נוספו לאחרונה</option>
                </select>
              </label>
              <button type="button" class="icon-btn" id="sort-direction-btn" aria-label="החלפת כיוון המיון"></button>

              <label class="toolbar-control">
                <span class="toolbar-control__label">תקופה</span>
                <select class="toolbar-control__input" id="period-select">
                  <option value="this-month">החודש</option>
                  <option value="last-month">חודש שעבר</option>
                  <option value="last-3">3 החודשים האחרונים</option>
                  <option value="last-6">6 החודשים האחרונים</option>
                  <option value="this-year">השנה</option>
                  <option value="all">כל הזמנים</option>
                  <option value="custom">טווח מותאם אישית&hellip;</option>
                </select>
              </label>

              <label class="toolbar-control toolbar-control--search">
                <input type="search" class="toolbar-control__input" id="search-input" placeholder="סינון לפי תיאור…" value="${filters.search}">
              </label>

              <div class="transactions__toolbar-spacer"></div>

              <button type="button" class="btn btn--sm" id="export-csv-btn">${downloadIconMarkup()}<span>ייצוא</span></button>
              <button type="button" class="btn btn--sm" id="filters-toggle-btn" aria-label="סינון לפי מי שילם/ה או קטגוריה">
                ${filterIconMarkup()}<span>סינון</span><span class="filter-badge" id="filter-badge" hidden>0</span>
              </button>
              <button type="button" class="btn btn--sm" id="columns-toggle-btn" aria-label="בחירת עמודות מוצגות">
                ${columnsIconMarkup()}<span>עמודות</span><span class="filter-badge" id="columns-badge" hidden>0</span>
              </button>

              <div class="filter-bar" id="filter-bar">
                <div class="filter-bar__header">
                  <span class="filter-bar__title">סינון לפי</span>
                  <button type="button" class="filter-bar__clear" id="clear-filters-btn">ניקוי</button>
                </div>

                <div class="filter-group filter-group--person" role="group" aria-label="סינון לפי מי שילם/ה">
                  <button type="button" class="segmented-btn" data-person="all">הכול</button>
                  ${PEOPLE.map((p) => `<button type="button" class="segmented-btn" data-person="${p}">${personLabel(p)}</button>`).join('')}
                </div>

                <label class="filter-group">
                  <span class="filter-group__label">קטגוריה</span>
                  <select class="filter-select" id="category-select">
                    <option value="all">כל הקטגוריות</option>
                    ${categories.map((c) => `<option value="${c.id}">${c.icon} ${c.name}</option>`).join('')}
                  </select>
                </label>

                <div class="filter-group filter-group--custom-range" id="custom-range" hidden>
                  <label class="filter-group">
                    <span class="filter-group__label">מתאריך</span>
                    <input type="date" class="filter-input" id="range-start">
                  </label>
                  <label class="filter-group">
                    <span class="filter-group__label">עד תאריך</span>
                    <input type="date" class="filter-input" id="range-end">
                  </label>
                </div>
              </div>

              <div class="filter-bar" id="columns-bar">
                <div class="filter-bar__header">
                  <span class="filter-bar__title">הצגת עמודות</span>
                  <button type="button" class="filter-bar__clear" id="reset-columns-btn">איפוס</button>
                </div>
                ${TOGGLEABLE_COLUMNS.map(
                  (col) => `
                  <label class="column-toggle">
                    <input type="checkbox" data-column="${col.key}" checked>
                    <span>${col.label}</span>
                  </label>
                `,
                ).join('')}
              </div>
            </div>
            <div class="sheet-backdrop" id="toolbar-backdrop" hidden></div>

            <div class="bulk-bar" id="bulk-bar" hidden></div>
            <div class="pending-bar" id="pending-bar" hidden>
              <span class="pending-bar__count" id="pending-count"></span>
              <button type="button" class="btn btn--sm" id="pending-discard-btn">ביטול שינויים</button>
              <button type="button" class="btn btn--primary btn--sm" id="pending-save-btn">שמירת שינויים</button>
            </div>

            <div class="transactions__header">
              <span class="transactions__count" id="transactions-count"></span>
            </div>

            <div class="transactions__table-wrap">
              <table class="transactions__table">
                <thead>
                  <tr>
                    <th class="select-cell"><input type="checkbox" id="select-all" aria-label="בחירת הכול"></th>
                    <th data-sort="date">תאריך</th>
                    <th data-sort="merchant">בית עסק</th>
                    <th data-sort="category">קטגוריה</th>
                    <th data-sort="person">משלם/ת</th>
                    <th data-sort="account">חשבון</th>
                    <th class="is-numeric" data-sort="amount">סכום</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody id="transactions-body"></tbody>
              </table>
            </div>
            <div class="tx-cards" id="transactions-cards"></div>

            <div class="tx-footer-summary" id="tx-footer-summary"></div>
          </div>
        </div>
      </section>
    `
  }

  private wireToolbar(): void {
    const { filters } = this.#store.getState()

    const searchInput = this.#container.querySelector<HTMLInputElement>('#search-input')!
    searchInput.addEventListener('input', () => this.patchFilters({ search: searchInput.value }))

    const personButtons = Array.from(this.#container.querySelectorAll<HTMLButtonElement>('.segmented-btn[data-person]'))
    const setActivePerson = (person: Person | 'all') => {
      personButtons.forEach((btn) => btn.classList.toggle('is-active', btn.dataset.person === person))
    }
    setActivePerson(filters.person)
    personButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const person = btn.dataset.person as Person | 'all'
        setActivePerson(person)
        this.patchFilters({ person })
      })
    })

    const categorySelect = this.#container.querySelector<HTMLSelectElement>('#category-select')!
    categorySelect.value = filters.categoryId
    categorySelect.addEventListener('change', () => this.patchFilters({ categoryId: categorySelect.value }))

    const groupSelect = this.#container.querySelector<HTMLSelectElement>('#group-select')!
    groupSelect.value = this.#groupBy
    groupSelect.addEventListener('change', () => {
      this.#groupBy = groupSelect.value as GroupBy
      this.renderTable(this.#store.getState())
    })

    const sortSelect = this.#container.querySelector<HTMLSelectElement>('#sort-select')!
    sortSelect.value = this.#sort.column
    sortSelect.addEventListener('change', () => {
      this.#sort = { column: sortSelect.value as SortColumn, direction: this.#sort.direction }
      this.renderTable(this.#store.getState())
    })

    const sortDirBtn = this.#container.querySelector<HTMLButtonElement>('#sort-direction-btn')!
    sortDirBtn.addEventListener('click', () => {
      this.#sort = { column: this.#sort.column, direction: this.#sort.direction === 'asc' ? 'desc' : 'asc' }
      this.renderTable(this.#store.getState())
    })

    this.#container.querySelector<HTMLButtonElement>('#clear-filters-btn')!.addEventListener('click', () => {
      setActivePerson('all')
      categorySelect.value = 'all'
      this.patchFilters({ person: 'all', categoryId: 'all' })
    })

    const periodSelect = this.#container.querySelector<HTMLSelectElement>('#period-select')!
    periodSelect.value = this.#preset
    const customRangeEl = this.#container.querySelector<HTMLElement>('#custom-range')!
    customRangeEl.hidden = this.#preset !== 'custom'
    periodSelect.addEventListener('change', () => {
      this.#preset = periodSelect.value as PeriodPreset
      customRangeEl.hidden = this.#preset !== 'custom'
      if (this.#preset !== 'custom') this.applyPreset(this.#preset)
    })

    const startInput = this.#container.querySelector<HTMLInputElement>('#range-start')!
    const endInput = this.#container.querySelector<HTMLInputElement>('#range-end')!
    const applyCustomRange = () => {
      if (startInput.value && endInput.value) {
        this.patchFilters({ period: { kind: 'range', start: startInput.value, end: endInput.value } })
      }
    }
    startInput.addEventListener('change', applyCustomRange)
    endInput.addEventListener('change', applyCustomRange)

    this.wireToolbarPopovers()
    this.wireColumnToggles()
  }

  /** Filter and Columns are mutually-exclusive popovers anchored to the
   * toolbar, sharing one backdrop — opening one closes the other. */
  private wireToolbarPopovers(): void {
    const backdrop = this.#container.querySelector<HTMLElement>('#toolbar-backdrop')!
    const popovers = [
      { btn: this.#container.querySelector<HTMLButtonElement>('#filters-toggle-btn')!, panel: this.#container.querySelector<HTMLElement>('#filter-bar')! },
      { btn: this.#container.querySelector<HTMLButtonElement>('#columns-toggle-btn')!, panel: this.#container.querySelector<HTMLElement>('#columns-bar')! },
    ]

    const closeAll = () => {
      popovers.forEach(({ panel }) => panel.classList.remove('is-open'))
      backdrop.hidden = true
    }

    popovers.forEach(({ btn, panel }) => {
      btn.addEventListener('click', () => {
        const wasOpen = panel.classList.contains('is-open')
        closeAll()
        if (!wasOpen) {
          panel.classList.add('is-open')
          backdrop.hidden = false
        }
      })
    })

    backdrop.addEventListener('click', closeAll)
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeAll()
    })
  }

  private wireColumnToggles(): void {
    const checkboxes = Array.from(this.#container.querySelectorAll<HTMLInputElement>('#columns-bar [data-column]'))
    checkboxes.forEach((checkbox) => {
      checkbox.addEventListener('change', () => {
        const column = checkbox.dataset.column as SortColumn
        if (checkbox.checked) this.#hiddenColumns.delete(column)
        else this.#hiddenColumns.add(column)
        this.renderTable(this.#store.getState())
      })
    })

    this.#container.querySelector<HTMLButtonElement>('#reset-columns-btn')!.addEventListener('click', () => {
      this.#hiddenColumns.clear()
      checkboxes.forEach((checkbox) => (checkbox.checked = true))
      this.renderTable(this.#store.getState())
    })
  }

  private updateCategoryOptions(categories: Category[]): void {
    const select = this.#container.querySelector<HTMLSelectElement>('#category-select')!
    const current = select.value
    select.innerHTML = `
      <option value="all">כל הקטגוריות</option>
      ${categories.map((c) => `<option value="${c.id}">${c.icon} ${c.name}</option>`).join('')}
    `
    select.value = current
  }

  private patchFilters(patch: Partial<AppState['filters']>): void {
    const current = this.#store.getState().filters
    this.#store.setState({ filters: { ...current, ...patch } })
  }

  private applyPreset(preset: Exclude<PeriodPreset, 'custom'>): void {
    if (preset === 'this-month') this.patchFilters({ period: { kind: 'month', month: monthKey(0) } })
    else if (preset === 'last-month') this.patchFilters({ period: { kind: 'month', month: monthKey(1) } })
    else if (preset === 'last-3') this.patchFilters({ period: { kind: 'range', ...monthsAgoRange(3) } })
    else if (preset === 'last-6') this.patchFilters({ period: { kind: 'range', ...monthsAgoRange(6) } })
    // Full Jan 1 - Dec 31, not "Jan 1 to today" — matches "This month" covering
    // the whole current month regardless of today's date within it.
    else if (preset === 'this-year') this.patchFilters({ period: { kind: 'range', start: `${new Date().getFullYear()}-01-01`, end: `${new Date().getFullYear()}-12-31` } })
    else this.patchFilters({ period: { kind: 'all' } })
  }

  // ---------- Table: sorting, selection, inline editing ----------

  private wireTable(): void {
    const thead = this.#container.querySelector('thead')!
    thead.addEventListener('click', (event) => {
      const th = (event.target as HTMLElement).closest<HTMLElement>('[data-sort]')
      if (!th) return
      const column = th.dataset.sort as SortColumn
      this.#sort = this.#sort.column === column ? { column, direction: this.#sort.direction === 'asc' ? 'desc' : 'asc' } : { column, direction: 'asc' }
      this.renderTable(this.#store.getState())
    })

    const selectAll = this.#container.querySelector<HTMLInputElement>('#select-all')!
    selectAll.addEventListener('change', () => {
      const rows = this.visibleRows(this.#store.getState())
      if (selectAll.checked) rows.forEach((tx) => this.#selection.add(tx.id))
      else this.#selection.clear()
      this.renderTable(this.#store.getState())
    })

    const tbody = this.#container.querySelector<HTMLElement>('#transactions-body')!
    const cards = this.#container.querySelector<HTMLElement>('#transactions-cards')!
    this.wireRowContainer(tbody)
    this.wireRowContainer(cards)

    this.#container.querySelector<HTMLElement>('#bulk-bar')!.addEventListener('click', (event) => {
      const target = event.target as HTMLElement
      if (target.closest('[data-bulk-mark-reviewed]')) this.bulkMarkReviewed()
      else if (target.closest('[data-bulk-delete]')) this.bulkDelete()
    })

    this.#container.querySelector<HTMLElement>('#bulk-bar')!.addEventListener('change', (event) => {
      const select = (event.target as HTMLElement).closest<HTMLSelectElement>('[data-bulk-recategorize]')
      if (select && select.value) this.bulkRecategorize(select.value)
    })
  }

  /** Shared selection/approve/edit wiring for both the desktop `<tbody>` and
   * the mobile `#transactions-cards` container — same data, two markups. */
  private wireRowContainer(container: HTMLElement): void {
    container.addEventListener('change', (event) => {
      const checkbox = (event.target as HTMLElement).closest<HTMLInputElement>('.row-select')
      if (checkbox) {
        const id = checkbox.dataset.id!
        if (checkbox.checked) this.#selection.add(id)
        else this.#selection.delete(id)
        this.renderTable(this.#store.getState())
      }
    })

    container.addEventListener('click', (event) => {
      const target = event.target as HTMLElement

      if (target.closest('.row-select')) return // handled by the 'change' listener above

      const groupToggle = target.closest<HTMLElement>('[data-group-toggle]')
      if (groupToggle) {
        const categoryId = groupToggle.dataset.groupToggle!
        if (this.#collapsedGroups.has(categoryId)) this.#collapsedGroups.delete(categoryId)
        else this.#collapsedGroups.add(categoryId)
        this.renderTable(this.#store.getState())
        return
      }

      const reviewBtn = target.closest<HTMLButtonElement>('[data-mark-reviewed-id]')
      if (reviewBtn) {
        this.markReviewed(reviewBtn.dataset.markReviewedId!)
        return
      }

      const cell = target.closest<HTMLElement>('.editable-cell')
      if (cell) {
        if (cell.classList.contains('is-editing')) return
        const id = cell.dataset.id!
        const field = cell.dataset.field as 'date' | 'merchant' | 'amount' | 'category' | 'person' | 'account' | 'status'
        const tx = this.#store.getState().transactions.find((t) => t.id === id)
        if (!tx) return

        if (field === 'person') {
          // A personal account pins the person — editing it directly would desync the two.
          if (tx.account !== 'shared') return
          this.editPersonCell(cell, tx)
        } else if (field === 'account') {
          this.editAccountCell(cell, tx)
        } else if (field === 'category') {
          this.editCategoryCell(cell, tx)
        } else if (field === 'status') {
          this.editStatusCell(cell, tx)
        } else {
          this.editTextCell(cell, tx, field)
        }
        return
      }

      // Mobile cards have no .editable-cell — tapping the card body opens the edit sheet instead.
      const card = target.closest<HTMLElement>('.tx-card')
      if (card) {
        const tx = this.#store.getState().transactions.find((t) => t.id === card.dataset.id)
        if (tx) this.openExpenseModal(tx)
      }
    })
  }

  private wirePendingBar(): void {
    this.#container.querySelector<HTMLButtonElement>('#pending-save-btn')!.addEventListener('click', () => {
      void this.savePendingEdits()
    })
    this.#container.querySelector<HTMLButtonElement>('#pending-discard-btn')!.addEventListener('click', () => {
      this.#pendingEdits.clear()
      this.renderTable(this.#store.getState())
    })
  }

  /** True while any inline edit hasn't been saved yet — checked by App.ts
   * before letting a nav click leave Transactions, same guard Settings has
   * for its own unsaved "add new" rows. */
  hasUnsavedChanges(): boolean {
    return this.#pendingEdits.size > 0
  }

  /** Stages a field edit instead of writing it — the opposite of
   * commitEdit(), which is still used by the add/edit modal, whose own
   * Save/Add button already is the deliberate "yes, save this" moment. */
  private stageEdit(id: string, patch: Partial<NewTransaction>): void {
    this.#pendingEdits.set(id, { ...this.#pendingEdits.get(id), ...patch })
    this.renderTable(this.#store.getState())
  }

  private renderPendingBar(): void {
    const bar = this.#container.querySelector<HTMLElement>('#pending-bar')!
    const countEl = this.#container.querySelector<HTMLElement>('#pending-count')!
    bar.hidden = this.#pendingEdits.size === 0
    countEl.textContent = `${this.#pendingEdits.size} שינויים לא שמורים`
  }

  private async savePendingEdits(): Promise<void> {
    const entries = [...this.#pendingEdits]
    if (entries.length === 0) return

    try {
      const updated = await Promise.all(entries.map(([id, patch]) => updateTransaction(id, patch)))
      const updatedById = new Map(updated.map((tx) => [tx.id, tx]))
      const { transactions } = this.#store.getState()
      this.#store.setState({ transactions: transactions.map((tx) => updatedById.get(tx.id) ?? tx) })
      this.#pendingEdits.clear()
      showToast(entries.length === 1 ? 'השינוי נשמר.' : `${entries.length} שינויים נשמרו.`, [], 2000)
      this.logTx('updated', entries.length === 1 ? `עודכנה תנועה ${updated[0]?.merchant || 'ללא שם'}` : `${entries.length} תנועות עודכנו`)
      this.renderTable(this.#store.getState())
    } catch {
      showToast('שמירת השינויים נכשלה — נסה/י שוב.')
    }
  }

  /** Merchant is the only field of these three that's allowed to be blank —
   * category matters more than naming the exact store, so an empty merchant
   * commits as-is instead of reverting like a required field would. */
  private editTextCell(cell: HTMLElement, tx: Transaction, field: 'date' | 'merchant' | 'amount'): void {
    cell.classList.add('is-editing')
    const inputType = field === 'amount' ? 'number' : field === 'date' ? 'date' : 'text'
    const currentValue = field === 'amount' ? tx.originalAmount.toFixed(2) : field === 'date' ? tx.date : tx.merchant
    cell.innerHTML = `<input type="${inputType}" class="cell-input" value="${currentValue}" ${field === 'amount' ? 'step="0.01"' : ''}>`
    const input = cell.querySelector<HTMLInputElement>('.cell-input')!
    input.focus()
    input.select()

    let settled = false
    const commit = async () => {
      if (settled) return
      settled = true
      if (field === 'amount') {
        const value = Number(input.value)
        // Negative is valid — a real refund/credit row, not an error.
        if (Number.isNaN(value) || value === 0) {
          this.renderTable(this.#store.getState())
          return
        }
        // Editing amount only changes the number, not the currency/date —
        // the ILS-equivalent that totals/budgets sum is recomputed from it,
        // using the real historical rate for the transaction's own date.
        const { amount, usedFallback } = await resolveIlsAmount(value, tx.currency, tx.date, this.#store.getState().exchangeRate)
        this.stageEdit(tx.id, { originalAmount: value, amount })
        if (usedFallback) showToast('לא ניתן היה לאתר את שער החליפין האמיתי לתאריך זה — נעשה שימוש בשער הגיבוי שהוגדר בהגדרות.')
      } else if (field === 'date') {
        if (!input.value) {
          this.renderTable(this.#store.getState())
          return
        }
        if (tx.currency !== 'ILS') {
          const { amount, usedFallback } = await resolveIlsAmount(tx.originalAmount, tx.currency, input.value, this.#store.getState().exchangeRate)
          this.stageEdit(tx.id, { date: input.value, amount })
          if (usedFallback) showToast('לא ניתן היה לאתר את שער החליפין האמיתי לתאריך זה — נעשה שימוש בשער הגיבוי שהוגדר בהגדרות.')
        } else {
          this.stageEdit(tx.id, { date: input.value })
        }
      } else {
        this.stageEdit(tx.id, { merchant: input.value.trim() })
      }
    }
    const cancel = () => {
      if (settled) return
      settled = true
      this.renderTable(this.#store.getState())
    }

    input.addEventListener('blur', commit)
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') input.blur()
      else if (event.key === 'Escape') cancel()
    })
  }

  private editCategoryCell(cell: HTMLElement, tx: Transaction): void {
    cell.classList.add('is-editing')
    const { categories } = this.#store.getState()
    cell.innerHTML = `
      <select class="cell-input">
        ${categories.map((c) => `<option value="${c.id}" ${c.id === tx.categoryId ? 'selected' : ''}>${c.icon} ${c.name}</option>`).join('')}
      </select>
    `
    const select = cell.querySelector<HTMLSelectElement>('.cell-input')!
    select.focus()

    let settled = false
    select.addEventListener('change', () => {
      settled = true
      this.stageEdit(tx.id, { categoryId: select.value })
      this.promptSaveMappingRule(tx, 'category', select.value)
    })
    select.addEventListener('blur', () => {
      if (!settled) this.renderTable(this.#store.getState())
    })
    select.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        settled = true
        this.renderTable(this.#store.getState())
      }
    })
  }

  /** Matches every other editable cell's click-into-a-dropdown pattern —
   * used to be a silent click-to-flip toggle, which was the only cell in
   * the table that didn't visibly show it was editable or what the other
   * option was. */
  private editPersonCell(cell: HTMLElement, tx: Transaction): void {
    cell.classList.add('is-editing')
    cell.innerHTML = `
      <select class="cell-input">
        ${PEOPLE.map((p) => `<option value="${p}" ${p === tx.person ? 'selected' : ''}>${personLabel(p)}</option>`).join('')}
      </select>
    `
    const select = cell.querySelector<HTMLSelectElement>('.cell-input')!
    select.focus()

    let settled = false
    select.addEventListener('change', () => {
      settled = true
      const nextPerson = select.value as Person
      this.stageEdit(tx.id, { person: nextPerson })
      this.promptSaveMappingRule(tx, 'person', nextPerson)
    })
    select.addEventListener('blur', () => {
      if (!settled) this.renderTable(this.#store.getState())
    })
    select.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        settled = true
        this.renderTable(this.#store.getState())
      }
    })
  }

  private editAccountCell(cell: HTMLElement, tx: Transaction): void {
    cell.classList.add('is-editing')
    cell.innerHTML = `
      <select class="cell-input">
        ${ACCOUNT_VALUES.map((a) => `<option value="${a}" ${a === tx.account ? 'selected' : ''}>${ACCOUNT_LABEL[a]}</option>`).join('')}
      </select>
    `
    const select = cell.querySelector<HTMLSelectElement>('.cell-input')!
    select.focus()

    let settled = false
    select.addEventListener('change', () => {
      settled = true
      const account = select.value as Account
      const forcedPerson = PERSON_FOR_ACCOUNT[account]
      this.stageEdit(tx.id, forcedPerson ? { account, person: forcedPerson } : { account })
    })
    select.addEventListener('blur', () => {
      if (!settled) this.renderTable(this.#store.getState())
    })
    select.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        settled = true
        this.renderTable(this.#store.getState())
      }
    })
  }

  private editStatusCell(cell: HTMLElement, tx: Transaction): void {
    cell.classList.add('is-editing')
    cell.innerHTML = `
      <select class="cell-input">
        ${STATUS_VALUES.map((s) => `<option value="${s}" ${s === tx.status ? 'selected' : ''}>${STATUS_LABEL[s]}</option>`).join('')}
      </select>
    `
    const select = cell.querySelector<HTMLSelectElement>('.cell-input')!
    select.focus()

    let settled = false
    select.addEventListener('change', () => {
      settled = true
      const status = select.value as TransactionStatus
      this.stageEdit(tx.id, { status })
    })
    select.addEventListener('blur', () => {
      if (!settled) this.renderTable(this.#store.getState())
    })
    select.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        settled = true
        this.renderTable(this.#store.getState())
      }
    })
  }

  /** Offers to remember an inline Category/Person edit as a mapping rule for
   * this merchant, so future CSV imports auto-fill it. Self-dismissing toast
   * — no blocking modal, since this is a nice-to-have not a required step. */
  private promptSaveMappingRule(tx: Transaction, field: 'category' | 'person', value: string): void {
    // No merchant to key a future-import rule off of — nothing to offer.
    if (!tx.merchant) return
    const merchantKey = normalizeMerchantKey(tx.merchant)
    const fieldLabel = field === 'category' ? 'הקטגוריה' : 'מי שילם/ה'
    showToast(`לזכור את ${fieldLabel} הזו עבור "${tx.merchant}" בייבואים עתידיים?`, [
      {
        label: 'שמירת כלל',
        primary: true,
        onClick: () => {
          upsertMappingRule(merchantKey, field === 'category' ? { categoryId: value } : { person: value as Person }).catch(() =>
            showToast('לא ניתן היה לשמור את הכלל.'),
          )
        },
      },
      { label: 'התעלמות', onClick: () => {} },
    ])
  }

  /** Fire-and-forget: a logging failure (e.g. migration 0009 not run)
   * shouldn't block or roll back the real action, which has already
   * succeeded by the time this is called — but it shouldn't be silent
   * either, or a missing migration just looks like "History doesn't work"
   * with no clue why. */
  private logTx(action: ActivityAction, summary: string, beforeData: unknown = null): void {
    logActivity({ entityType: 'transaction', action, summary, beforeData, performedBy: this.#currentPerson })
      .then((entry) => {
        const { activityLog } = this.#store.getState()
        this.#store.setState({ activityLog: [entry, ...activityLog] })
      })
      .catch((err: unknown) => console.warn('Could not write to History — has migration 0009 been run?', err))
  }

  private commitEdit(id: string, patch: Partial<NewTransaction>): void {
    updateTransaction(id, patch).then((updated) => {
      const { transactions } = this.#store.getState()
      this.#store.setState({ transactions: transactions.map((tx) => (tx.id === id ? updated : tx)) })
      this.logTx('updated', `עודכן ${updated.merchant || 'תנועה'} (${Object.keys(patch).join(', ')})`)
    })
  }

  private markReviewed(id: string): void {
    const state = this.#store.getState()
    const tx = state.transactions.find((t) => t.id === id)
    if (!tx) return
    this.commitEdit(id, { status: computeReviewedStatus(state.transactions, state.categories, tx.categoryId, state.budgetLimitOverrides) })
    showToast('התנועה אושרה', [], 2000)
  }

  private bulkMarkReviewed(): void {
    const ids = [...this.#selection]
    const state = this.#store.getState()
    const byId = new Map(state.transactions.map((tx) => [tx.id, tx]))
    Promise.all(
      ids.map((id) =>
        updateTransaction(id, { status: computeReviewedStatus(state.transactions, state.categories, byId.get(id)?.categoryId ?? '', state.budgetLimitOverrides) }),
      ),
    ).then((updated) => {
      const updatedById = new Map(updated.map((tx) => [tx.id, tx]))
      const { transactions } = this.#store.getState()
      this.#store.setState({ transactions: transactions.map((tx) => updatedById.get(tx.id) ?? tx) })
      showToast(`${ids.length} תנועות אושרו`, [], 2000)
      this.logTx('bulk_marked_reviewed', `${ids.length} תנועות סומנו כנבדקו`)
    })
  }

  private bulkRecategorize(categoryId: string): void {
    const ids = [...this.#selection]
    for (const id of ids) this.#pendingEdits.set(id, { ...this.#pendingEdits.get(id), categoryId })
    this.renderTable(this.#store.getState())
  }

  private bulkDelete(): void {
    const ids = [...this.#selection]
    const idSet = new Set(ids)
    const { transactions: current } = this.#store.getState()
    const deleted = current.filter((tx) => idSet.has(tx.id))
    const total = deleted.reduce((sum, tx) => sum + tx.amount, 0)

    const message =
      deleted.length === 1
        ? `למחוק את ${deleted[0].merchant || 'התנועה'} (${formatCurrency(deleted[0].originalAmount, deleted[0].currency)})? ניתן לבטל זאת מההיסטוריה.`
        : `למחוק ${deleted.length} תנועות (סה"כ ${formatCurrency(total)})? ניתן לבטל זאת מההיסטוריה.`

    confirmDialog(message, 'מחיקה').then((confirmed) => {
      if (!confirmed) return

      deleteTransactions(ids).then(() => {
        const { transactions } = this.#store.getState()
        this.#selection.clear()
        this.#store.setState({ transactions: transactions.filter((tx) => !idSet.has(tx.id)) })
        const before: TransactionDeletedBefore = { transactions: deleted }
        this.logTx(
          deleted.length === 1 ? 'deleted' : 'bulk_deleted',
          deleted.length === 1
            ? `נמחקה ${deleted[0].merchant || 'תנועה'} (${formatCurrency(deleted[0].originalAmount, deleted[0].currency)})`
            : `נמחקו ${deleted.length} תנועות (סה"כ ${formatCurrency(total)})`,
          before,
        )
      })
    })
  }

  private openExpenseModal(existing?: Transaction): void {
    const { categories } = this.#store.getState()
    const isEdit = !!existing
    const today = isoDate(new Date())
    const modal = new Modal(
      `
        <h2 class="modal__title">${isEdit ? 'עריכת תנועה' : 'הוספת תנועה'}</h2>
        <form class="modal__form" id="add-expense-form">
          <label class="filter-group">
            <span class="filter-group__label">תאריך</span>
            <input type="date" class="filter-input" name="date" value="${existing?.date ?? today}" required>
          </label>
          <label class="filter-group">
            <span class="filter-group__label">קטגוריה</span>
            <select class="filter-select" name="categoryId" required>
              ${categories.map((c) => `<option value="${c.id}" ${c.id === existing?.categoryId ? 'selected' : ''}>${c.icon} ${c.name}</option>`).join('')}
            </select>
          </label>
          <label class="filter-group">
            <span class="filter-group__label">בית עסק (לא חובה)</span>
            <input type="text" class="filter-input" name="merchant" placeholder="לדוגמה: שופרסל" value="${existing?.merchant ?? ''}">
          </label>
          <label class="filter-group">
            <span class="filter-group__label">סכום</span>
            <input type="number" class="filter-input" name="amount" step="0.01" value="${existing ? existing.originalAmount.toFixed(2) : ''}" required>
          </label>
          <label class="filter-group">
            <span class="filter-group__label">מטבע</span>
            <select class="filter-select" name="currency" required>
              ${CURRENCY_VALUES.map((c) => `<option value="${c}" ${c === (existing?.currency ?? 'ILS') ? 'selected' : ''}>${CURRENCY_LABEL[c]}</option>`).join('')}
            </select>
            <span class="filter-group__hint" id="rate-preview" hidden></span>
          </label>
          <label class="filter-group">
            <span class="filter-group__label">חשבון</span>
            <select class="filter-select" name="account" required>
              ${ACCOUNT_VALUES.map((a) => `<option value="${a}" ${a === (existing?.account ?? 'shared') ? 'selected' : ''}>${ACCOUNT_LABEL[a]}</option>`).join('')}
            </select>
          </label>
          <label class="filter-group">
            <span class="filter-group__label">מי שילם/ה</span>
            <select class="filter-select" name="person" required>
              ${PEOPLE.map((p) => `<option value="${p}" ${p === existing?.person ? 'selected' : ''}>${personLabel(p)}</option>`).join('')}
            </select>
          </label>
          <div class="modal__actions">
            <button type="button" class="btn" id="modal-cancel">ביטול</button>
            <button type="submit" class="btn btn--primary">${isEdit ? 'שמירת שינויים' : 'הוספת תנועה'}</button>
          </div>
        </form>
      `,
      { ariaLabel: isEdit ? 'עריכת תנועה' : 'הוספת תנועה' },
    )

    const accountSelect = modal.element.querySelector<HTMLSelectElement>('select[name="account"]')!
    const personSelect = modal.element.querySelector<HTMLSelectElement>('select[name="person"]')!
    // Personal accounts pin the person — keep the (disabled) Person select in
    // sync so its submitted value always matches what the badge will show.
    const syncPersonToAccount = () => {
      const forcedPerson = PERSON_FOR_ACCOUNT[accountSelect.value as Account]
      personSelect.disabled = !!forcedPerson
      if (forcedPerson) personSelect.value = forcedPerson
    }
    syncPersonToAccount()
    accountSelect.addEventListener('change', syncPersonToAccount)

    // Shows the real historical rate that'll actually be used for a
    // USD/EUR entry, before submitting — so it's not a black box.
    const currencySelect = modal.element.querySelector<HTMLSelectElement>('select[name="currency"]')!
    const dateInput = modal.element.querySelector<HTMLInputElement>('input[name="date"]')!
    const ratePreviewEl = modal.element.querySelector<HTMLElement>('#rate-preview')!
    let ratePreviewToken = 0
    const updateRatePreview = () => {
      const currency = currencySelect.value as Currency
      if (currency === 'ILS' || !dateInput.value) {
        ratePreviewEl.hidden = true
        return
      }
      const token = ++ratePreviewToken
      ratePreviewEl.hidden = false
      ratePreviewEl.textContent = 'טוען שער…'
      const symbol = currency === 'USD' ? '$' : '€'
      fetchHistoricalRateToIls(currency, dateInput.value).then((rate) => {
        if (token !== ratePreviewToken) return // a newer request superseded this one
        ratePreviewEl.textContent = rate !== null ? `1${symbol} = ${formatCurrency(rate)} בתאריך זה` : 'לא נמצא שער לתאריך זה — ישמש שער הגיבוי'
      })
    }
    updateRatePreview()
    currencySelect.addEventListener('change', updateRatePreview)
    dateInput.addEventListener('change', updateRatePreview)

    modal.element.querySelector<HTMLButtonElement>('#modal-cancel')!.addEventListener('click', () => modal.close())
    modal.element.querySelector<HTMLFormElement>('#add-expense-form')!.addEventListener('submit', async (event) => {
      event.preventDefault()
      const form = event.currentTarget as HTMLFormElement
      const submitBtn = form.querySelector<HTMLButtonElement>('button[type="submit"]')!
      const data = new FormData(form)
      const categoryId = String(data.get('categoryId'))
      const account = data.get('account') as Account
      const currency = data.get('currency') as Currency
      const originalAmount = Number(data.get('amount'))
      const date = String(data.get('date'))
      const state = this.#store.getState()

      submitBtn.disabled = true
      const { amount, usedFallback } = await resolveIlsAmount(originalAmount, currency, date, state.exchangeRate)
      submitBtn.disabled = false
      if (usedFallback) showToast('לא ניתן היה לאתר את שער החליפין האמיתי לתאריך זה — נעשה שימוש בשער הגיבוי שהוגדר בהגדרות.')

      // A manually-typed transaction is considered reviewed the instant it's
      // entered — 'pending' is reserved for imported rows awaiting a look.
      const input: NewTransaction = {
        date,
        merchant: String(data.get('merchant')).trim(),
        amount,
        currency,
        originalAmount,
        categoryId,
        account,
        person: PERSON_FOR_ACCOUNT[account] ?? (data.get('person') as Person),
        status: existing?.status ?? computeReviewedStatus(state.transactions, state.categories, categoryId, state.budgetLimitOverrides),
        source: existing?.source ?? 'manual',
      }
      if (isEdit) {
        this.commitEdit(existing.id, input)
        modal.close()
      } else {
        createTransaction(input).then((created) => {
          const { transactions } = this.#store.getState()
          this.#store.setState({ transactions: [created, ...transactions] })
          this.logTx('created', `נוספה ${created.merchant || 'תנועה'} (${formatCurrency(created.originalAmount, created.currency)})`)
          modal.close()
          showToast(`✓ נוספה ${created.merchant || 'תנועה'} (${formatCurrency(created.originalAmount, created.currency)})`, [], 2500)
        })
      }
    })
  }

  // ---------- Rendering ----------

  /** Merges unsaved pending edits over the real data before filtering/
   * sorting/displaying — so an edited cell shows what you typed everywhere
   * (row, card, group totals, footer sum, CSV export) without those edits
   * having reached the store (and therefore every other page's totals)
   * until Save is actually clicked. */
  private visibleRows(state: AppState): Transaction[] {
    const categoryById = new Map(state.categories.map((category) => [category.id, category]))
    const overlaid = state.transactions.map((tx) => {
      const pending = this.#pendingEdits.get(tx.id)
      return pending ? { ...tx, ...pending } : tx
    })
    const filtered = filterTransactions(overlaid, state.filters)
    return sortTransactions(filtered, this.#sort, categoryById)
  }

  private renderTable(state: AppState): void {
    const categoryById = new Map(state.categories.map((category) => [category.id, category]))
    const rows = this.visibleRows(state)
    const visibleIds = new Set(rows.map((tx) => tx.id))
    for (const id of [...this.#selection]) {
      if (!visibleIds.has(id)) this.#selection.delete(id)
    }

    this.#container.querySelector<HTMLElement>('#transactions-count')!.textContent = `${rows.length} תוצאות`

    const thead = this.#container.querySelector('thead')!
    thead.querySelectorAll<HTMLElement>('[data-sort]').forEach((th) => {
      const column = th.dataset.sort as SortColumn
      th.classList.toggle('is-sorted', column === this.#sort.column)
      th.dataset.sortDirection = column === this.#sort.column ? this.#sort.direction : ''
    })
    this.#container.querySelector<HTMLSelectElement>('#sort-select')!.value = this.#sort.column
    const sortDirBtn = this.#container.querySelector<HTMLButtonElement>('#sort-direction-btn')!
    sortDirBtn.textContent = this.#sort.direction === 'asc' ? '↑' : '↓'
    sortDirBtn.setAttribute('aria-label', this.#sort.direction === 'asc' ? 'ממוין בסדר עולה — לחיצה למיון יורד' : 'ממוין בסדר יורד — לחיצה למיון עולה')

    const activeFilterCount = (state.filters.person !== 'all' ? 1 : 0) + (state.filters.categoryId !== 'all' ? 1 : 0)
    const filterBadge = this.#container.querySelector<HTMLElement>('#filter-badge')!
    filterBadge.hidden = activeFilterCount === 0
    filterBadge.textContent = String(activeFilterCount)

    const columnsBadge = this.#container.querySelector<HTMLElement>('#columns-badge')!
    columnsBadge.hidden = this.#hiddenColumns.size === 0
    columnsBadge.textContent = String(this.#hiddenColumns.size)

    const selectAll = this.#container.querySelector<HTMLInputElement>('#select-all')!
    selectAll.checked = rows.length > 0 && rows.every((tx) => this.#selection.has(tx.id))

    const tbody = this.#container.querySelector<HTMLElement>('#transactions-body')!
    const cardsContainer = this.#container.querySelector<HTMLElement>('#transactions-cards')!
    const table = this.#container.querySelector<HTMLTableElement>('.transactions__table')!
    table.dataset.groupBy = this.#groupBy
    table.dataset.hideColumns = Array.from(this.#hiddenColumns).join(' ')

    if (rows.length === 0) {
      // Data most often "goes missing" because the Period filter (defaults
      // to this month) is hiding it, not because it doesn't exist — say so
      // explicitly instead of leaving that to guesswork.
      const emptyMessage =
        state.transactions.length > 0
          ? 'אין תנועות התואמות לסינון הזה — נסה/י להרחיב את התקופה (למשל ל"כל הזמנים") או לנקות סינונים אחרים.'
          : 'עדיין אין תנועות — הוסף/י תנועה או ייבא/י קובץ.'
      tbody.innerHTML = `<tr><td colspan="8" class="transactions__empty">${emptyMessage}</td></tr>`
      cardsContainer.innerHTML = `<p class="transactions__empty">${emptyMessage}</p>`
    } else if (this.#groupBy !== 'none') {
      const groups = this.buildGroups(rows, categoryById)
      tbody.innerHTML = groups.map((g) => this.renderGroupRows(g, categoryById)).join('')
      cardsContainer.innerHTML = groups.map((g) => this.renderGroupCards(g, categoryById)).join('')
    } else {
      tbody.innerHTML = rows.map((tx) => this.renderRow(tx, categoryById)).join('')
      cardsContainer.innerHTML = rows.map((tx) => this.renderCard(tx, categoryById)).join('')
    }

    this.renderBulkBar(state.categories)
    this.renderPendingBar()
    this.renderFooterSummary(rows)
  }

  /** Default state totals every currently-filtered row; the moment anything
   * is checked, it switches to totaling just the selection instead. */
  private renderFooterSummary(rows: Transaction[]): void {
    const footerEl = this.#container.querySelector<HTMLElement>('#tx-footer-summary')!
    const selectedRows = rows.filter((tx) => this.#selection.has(tx.id))
    const activeRows = selectedRows.length > 0 ? selectedRows : rows
    const total = activeRows.reduce((sum, tx) => sum + tx.amount, 0)
    const countLabel = selectedRows.length > 0 ? `${selectedRows.length} תנועות נבחרו` : `${rows.length} תנועות`

    footerEl.innerHTML = `
      <span>${countLabel}</span>
      <span class="tx-footer-summary__net"><strong>סה"כ:</strong> ${formatCurrency(total)}</span>
    `
  }

  private buildGroups(rows: Transaction[], categoryById: Map<string, Category>): TxGroup[] {
    if (this.#groupBy === 'person') {
      const byPerson = new Map<Person, Transaction[]>()
      for (const tx of rows) {
        const arr = byPerson.get(tx.person) ?? []
        arr.push(tx)
        byPerson.set(tx.person, arr)
      }
      const groups: TxGroup[] = PEOPLE.filter((p) => byPerson.has(p)).map((p) => {
        const txs = byPerson.get(p)!
        return {
          key: p,
          label: personLabel(p),
          icon: personLabel(p).charAt(0),
          color: `var(--person-${p.toLowerCase()})`,
          rows: txs,
          total: txs.reduce((sum, tx) => sum + tx.amount, 0),
        }
      })
      return groups.sort((a, b) => b.total - a.total)
    }

    if (this.#groupBy === 'month') {
      const byMonth = new Map<string, Transaction[]>()
      for (const tx of rows) {
        const key = tx.date.slice(0, 7)
        const arr = byMonth.get(key) ?? []
        arr.push(tx)
        byMonth.set(key, arr)
      }
      const groups: TxGroup[] = Array.from(byMonth, ([key, txs]) => ({
        key,
        label: formatMonthLabel(key),
        icon: '📅',
        color: null,
        rows: txs,
        total: txs.reduce((sum, tx) => sum + tx.amount, 0),
      }))
      return groups.sort((a, b) => (a.key < b.key ? 1 : -1))
    }

    const byCategory = new Map<string, Transaction[]>()
    for (const tx of rows) {
      const arr = byCategory.get(tx.categoryId) ?? []
      arr.push(tx)
      byCategory.set(tx.categoryId, arr)
    }
    const groups: TxGroup[] = []
    for (const [categoryId, txs] of byCategory) {
      const category = categoryById.get(categoryId)
      if (!category) continue
      groups.push({
        key: category.id,
        label: category.name,
        icon: category.icon,
        color: category.colorCode,
        rows: txs,
        total: txs.reduce((sum, tx) => sum + tx.amount, 0),
      })
    }
    return groups.sort((a, b) => b.total - a.total)
  }

  private renderGroupHeader(g: TxGroup): string {
    const collapsed = this.#collapsedGroups.has(g.key)
    return `
      <button type="button" class="group-header" data-group-toggle="${g.key}" aria-expanded="${!collapsed}">
        <span class="group-header__chevron" aria-hidden="true">${collapsed ? '‹' : '⌄'}</span>
        ${g.color ? `<span class="group-header__dot" style="background: ${g.color}" aria-hidden="true"></span>` : ''}
        <span class="group-header__name">${g.icon} ${g.label}</span>
        <span class="group-header__count">${g.rows.length} פריטים</span>
        <span class="group-header__total">${formatCurrency(g.total)}</span>
      </button>
    `
  }

  private renderGroupRows(g: TxGroup, categoryById: Map<string, Category>): string {
    const collapsed = this.#collapsedGroups.has(g.key)
    return `
      <tr class="group-header-row">
        <td colspan="8">${this.renderGroupHeader(g)}</td>
      </tr>
      ${collapsed ? '' : g.rows.map((tx) => this.renderRow(tx, categoryById)).join('')}
    `
  }

  private renderGroupCards(g: TxGroup, categoryById: Map<string, Category>): string {
    const collapsed = this.#collapsedGroups.has(g.key)
    return `
      <div class="tx-group">
        ${this.renderGroupHeader(g)}
        ${collapsed ? '' : g.rows.map((tx) => this.renderCard(tx, categoryById)).join('')}
      </div>
    `
  }

  private renderRow(tx: Transaction, categoryById: Map<string, Category>): string {
    const pendingClass = this.#pendingEdits.has(tx.id) ? ' tx-row--pending' : ''
    return `
      <tr data-id="${tx.id}" class="${pendingClass.trim()}">
        <td class="select-cell"><input type="checkbox" class="row-select" data-id="${tx.id}" ${this.#selection.has(tx.id) ? 'checked' : ''}></td>
        <td class="editable-cell" data-field="date" data-id="${tx.id}">${formatDateShort(tx.date)}</td>
        <td class="editable-cell" data-field="merchant" data-id="${tx.id}">
          ${renderMerchantCell(tx, categoryById.get(tx.categoryId))}
          <span class="editable-cell editable-cell--status" data-field="status" data-id="${tx.id}">${renderStatusBadge(tx.status)}</span>
          ${renderWaitingBadge(tx)}
        </td>
        <td class="editable-cell" data-field="category" data-id="${tx.id}">${renderCategoryBadge(categoryById.get(tx.categoryId))}</td>
        <td class="editable-cell" data-field="person" data-id="${tx.id}">${renderPersonBadge(tx.person)}</td>
        <td class="editable-cell" data-field="account" data-id="${tx.id}">${renderAccountBadge(tx.account)}</td>
        <td class="is-numeric editable-cell${tx.originalAmount < 0 ? ' is-credit' : ''}" data-field="amount" data-id="${tx.id}">${formatCurrency(tx.originalAmount, tx.currency)}</td>
        <td>${tx.status === 'pending' ? `<button type="button" class="btn btn--approve btn--sm" data-mark-reviewed-id="${tx.id}">סמן כנבדק</button>` : ''}</td>
      </tr>
    `
  }

  private renderCard(tx: Transaction, categoryById: Map<string, Category>): string {
    const pendingClass = this.#pendingEdits.has(tx.id) ? ' tx-card--pending' : ''
    return `
      <article class="tx-card${pendingClass}" data-id="${tx.id}">
        <input type="checkbox" class="row-select tx-card__select" data-id="${tx.id}" aria-label="בחירת תנועה" ${this.#selection.has(tx.id) ? 'checked' : ''}>
        <div class="tx-card__body">
          <div class="tx-card__top">
            ${renderMerchantCell(tx, categoryById.get(tx.categoryId))}
            <span class="tx-card__amount${tx.originalAmount < 0 ? ' is-credit' : ''}">${formatCurrency(tx.originalAmount, tx.currency)}</span>
          </div>
          <div class="tx-card__meta">
            ${renderCategoryBadge(categoryById.get(tx.categoryId))}
            ${renderPersonBadge(tx.person)}
            ${renderAccountBadge(tx.account)}
            ${renderStatusBadge(tx.status)}
            ${renderWaitingBadge(tx)}
            <span class="tx-card__date">${formatDateShort(tx.date)}</span>
          </div>
          ${
            tx.status === 'pending'
              ? `<div class="tx-card__footer"><button type="button" class="btn btn--approve btn--sm" data-mark-reviewed-id="${tx.id}">סמן כנבדק</button></div>`
              : ''
          }
        </div>
      </article>
    `
  }

  private renderBulkBar(categories: Category[]): void {
    const bar = this.#container.querySelector<HTMLElement>('#bulk-bar')!
    if (this.#selection.size === 0) {
      bar.hidden = true
      bar.innerHTML = ''
      return
    }
    bar.hidden = false
    bar.innerHTML = `
      <span class="bulk-bar__count">${this.#selection.size} נבחרו</span>
      <button type="button" class="btn btn--sm" data-bulk-mark-reviewed>סמן כנבדק</button>
      <select class="filter-select filter-select--sm" data-bulk-recategorize>
        <option value="">הגדרת קטגוריה…</option>
        ${categories.map((c) => `<option value="${c.id}">${c.icon} ${c.name}</option>`).join('')}
      </select>
      <button type="button" class="btn btn--sm btn--danger" data-bulk-delete>מחיקה</button>
    `
  }
}

export function mountTransactionsView(root: HTMLElement, store: Store<AppState>, currentPerson: Person): () => boolean {
  const view = new TransactionsView(root, store, currentPerson)
  return () => view.hasUnsavedChanges()
}
