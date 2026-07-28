import type { Store } from '../../state/store.ts'
import type { AppState, Category, NewTransaction, Person, Transaction } from '../../types.ts'
import { filterTransactions } from '../../utils/filters.ts'
import { formatCurrency, formatDateShort } from '../../utils/format.ts'
import { createTransaction, deleteTransactions, updateTransaction } from '../../data/transactionsRepo.ts'
import { renderCategoryBadge, renderMerchantCell, renderPersonBadge, renderStatusBadge } from '../shared/transactionCells.ts'
import { Modal } from '../shared/Modal.ts'

type SortColumn = 'date' | 'merchant' | 'category' | 'person' | 'amount'
type PeriodPreset = 'this-month' | 'last-month' | 'last-3' | 'last-6' | 'all' | 'custom'
type GroupBy = 'none' | 'category'
const PEOPLE: Person[] = ['Reut', 'Keren']

interface CategoryGroup {
  category: Category
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
      case 'amount':
        return (a.amount - b.amount) * dir
    }
  })
}

export class TransactionsView {
  #container: HTMLElement
  #store: Store<AppState>
  #preset: PeriodPreset = 'this-month'
  #sort: { column: SortColumn; direction: 'asc' | 'desc' } = { column: 'date', direction: 'desc' }
  #selection = new Set<string>()
  #groupBy: GroupBy = 'none'
  #collapsedGroups = new Set<string>()

  constructor(container: HTMLElement, store: Store<AppState>) {
    this.#container = container
    this.#store = store
    this.renderShell()
    this.wireToolbar()
    this.wireTable()
    store.subscribe((state) => {
      this.updateCategoryOptions(state.categories)
      this.renderTable(state)
    })
    this.renderTable(store.getState())
  }

  private renderShell(): void {
    const { filters, categories } = this.#store.getState()

    this.#container.innerHTML = `
      <section class="band band--hero">
        <div class="band__inner">
          <p class="eyebrow">Household finance</p>
          <h1>Transactions.</h1>
          <p class="hero__subtitle">Every expense, filterable, sortable, editable in place.</p>
        </div>
      </section>

      <section class="band">
        <div class="band__inner">
          <div class="transactions">
            <div class="transactions__toolbar">
              <button type="button" class="btn filters-toggle-btn" id="filters-toggle-btn">Filters</button>
              <button type="button" class="btn btn--primary" id="add-expense-btn">+ Add Expense</button>
            </div>

            <div class="filter-bar" id="filter-bar">
              <div class="filter-group filter-group--search">
                <span class="filter-group__label">Search</span>
                <input type="search" class="filter-input" id="search-input" placeholder="Merchant…" value="${filters.search}">
              </div>

              <label class="filter-group">
                <span class="filter-group__label">Group by</span>
                <select class="filter-select" id="group-select">
                  <option value="none">None</option>
                  <option value="category">Category</option>
                </select>
              </label>

              <div class="filter-group filter-group--person" role="group" aria-label="Filter by person">
                <button type="button" class="segmented-btn" data-person="all">All</button>
                ${PEOPLE.map((p) => `<button type="button" class="segmented-btn" data-person="${p}">${p}</button>`).join('')}
              </div>

              <label class="filter-group">
                <span class="filter-group__label">Category</span>
                <select class="filter-select" id="category-select">
                  <option value="all">All categories</option>
                  ${categories.map((c) => `<option value="${c.id}">${c.icon} ${c.name}</option>`).join('')}
                </select>
              </label>

              <label class="filter-group">
                <span class="filter-group__label">Period</span>
                <select class="filter-select" id="period-select">
                  <option value="this-month">This month</option>
                  <option value="last-month">Last month</option>
                  <option value="last-3">Last 3 months</option>
                  <option value="last-6">Last 6 months</option>
                  <option value="all">All time</option>
                  <option value="custom">Custom range&hellip;</option>
                </select>
              </label>

              <div class="filter-group filter-group--custom-range" id="custom-range" hidden>
                <label class="filter-group">
                  <span class="filter-group__label">From</span>
                  <input type="date" class="filter-input" id="range-start">
                </label>
                <label class="filter-group">
                  <span class="filter-group__label">To</span>
                  <input type="date" class="filter-input" id="range-end">
                </label>
              </div>
            </div>
            <div class="sheet-backdrop" id="filters-backdrop" hidden></div>

            <div class="bulk-bar" id="bulk-bar" hidden></div>

            <div class="transactions__header">
              <h2>Transactions</h2>
              <span class="transactions__count" id="transactions-count"></span>
            </div>

            <div class="transactions__table-wrap">
              <table class="transactions__table">
                <thead>
                  <tr>
                    <th class="select-cell"><input type="checkbox" id="select-all" aria-label="Select all"></th>
                    <th data-sort="date">Date</th>
                    <th data-sort="merchant">Merchant</th>
                    <th data-sort="category">Category</th>
                    <th data-sort="person">Person</th>
                    <th class="is-numeric" data-sort="amount">Amount</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody id="transactions-body"></tbody>
              </table>
            </div>
            <div class="tx-cards" id="transactions-cards"></div>
          </div>
        </div>
      </section>
    `
  }

  private wireToolbar(): void {
    const { filters } = this.#store.getState()

    const searchInput = this.#container.querySelector<HTMLInputElement>('#search-input')!
    searchInput.addEventListener('input', () => this.patchFilters({ search: searchInput.value }))

    const personButtons = Array.from(this.#container.querySelectorAll<HTMLButtonElement>('[data-person]'))
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

    this.#container.querySelector<HTMLButtonElement>('#add-expense-btn')!.addEventListener('click', () => this.openExpenseModal())

    this.wireFilterSheet()
  }

  private wireFilterSheet(): void {
    const filterBar = this.#container.querySelector<HTMLElement>('#filter-bar')!
    const backdrop = this.#container.querySelector<HTMLElement>('#filters-backdrop')!
    const toggleBtn = this.#container.querySelector<HTMLButtonElement>('#filters-toggle-btn')!

    const close = () => {
      filterBar.classList.remove('is-open')
      backdrop.hidden = true
    }
    const open = () => {
      filterBar.classList.add('is-open')
      backdrop.hidden = false
    }

    toggleBtn.addEventListener('click', () => (filterBar.classList.contains('is-open') ? close() : open()))
    backdrop.addEventListener('click', close)
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && filterBar.classList.contains('is-open')) close()
    })
  }

  private updateCategoryOptions(categories: Category[]): void {
    const select = this.#container.querySelector<HTMLSelectElement>('#category-select')!
    const current = select.value
    select.innerHTML = `
      <option value="all">All categories</option>
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
      if (target.closest('[data-bulk-approve]')) this.bulkApprove()
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

      const approveBtn = target.closest<HTMLButtonElement>('[data-approve-id]')
      if (approveBtn) {
        this.approveOne(approveBtn.dataset.approveId!)
        return
      }

      const cell = target.closest<HTMLElement>('.editable-cell')
      if (cell) {
        if (cell.classList.contains('is-editing')) return
        const id = cell.dataset.id!
        const field = cell.dataset.field as 'merchant' | 'amount' | 'category' | 'person'
        const tx = this.#store.getState().transactions.find((t) => t.id === id)
        if (!tx) return

        if (field === 'person') {
          this.commitEdit(id, { person: tx.person === 'Reut' ? 'Keren' : 'Reut' })
        } else if (field === 'category') {
          this.editCategoryCell(cell, tx)
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

  private editTextCell(cell: HTMLElement, tx: Transaction, field: 'merchant' | 'amount'): void {
    cell.classList.add('is-editing')
    const isAmount = field === 'amount'
    const currentValue = isAmount ? String(tx.amount) : tx.merchant
    cell.innerHTML = `<input type="${isAmount ? 'number' : 'text'}" class="cell-input" value="${currentValue}" ${isAmount ? 'min="0" step="0.01"' : ''}>`
    const input = cell.querySelector<HTMLInputElement>('.cell-input')!
    input.focus()
    input.select()

    let settled = false
    const commit = () => {
      if (settled) return
      settled = true
      const value = isAmount ? Number(input.value) : input.value.trim()
      if (isAmount && (Number.isNaN(value) || (value as number) < 0)) {
        this.renderTable(this.#store.getState())
        return
      }
      if (!isAmount && !value) {
        this.renderTable(this.#store.getState())
        return
      }
      this.commitEdit(tx.id, isAmount ? { amount: value as number } : { merchant: value as string })
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
      this.commitEdit(tx.id, { categoryId: select.value })
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

  private commitEdit(id: string, patch: Partial<NewTransaction>): void {
    updateTransaction(id, patch).then((updated) => {
      const { transactions } = this.#store.getState()
      this.#store.setState({ transactions: transactions.map((tx) => (tx.id === id ? updated : tx)) })
    })
  }

  private approveOne(id: string): void {
    this.commitEdit(id, { status: 'approved' })
  }

  private bulkApprove(): void {
    const ids = [...this.#selection]
    Promise.all(ids.map((id) => updateTransaction(id, { status: 'approved' }))).then((updated) => {
      const byId = new Map(updated.map((tx) => [tx.id, tx]))
      const { transactions } = this.#store.getState()
      this.#store.setState({ transactions: transactions.map((tx) => byId.get(tx.id) ?? tx) })
    })
  }

  private bulkRecategorize(categoryId: string): void {
    const ids = [...this.#selection]
    Promise.all(ids.map((id) => updateTransaction(id, { categoryId }))).then((updated) => {
      const byId = new Map(updated.map((tx) => [tx.id, tx]))
      const { transactions } = this.#store.getState()
      this.#store.setState({ transactions: transactions.map((tx) => byId.get(tx.id) ?? tx) })
    })
  }

  private bulkDelete(): void {
    const ids = [...this.#selection]
    deleteTransactions(ids).then(() => {
      const idSet = new Set(ids)
      const { transactions } = this.#store.getState()
      this.#selection.clear()
      this.#store.setState({ transactions: transactions.filter((tx) => !idSet.has(tx.id)) })
    })
  }

  private openExpenseModal(existing?: Transaction): void {
    const { categories } = this.#store.getState()
    const isEdit = !!existing
    const today = isoDate(new Date())
    const modal = new Modal(
      `
        <h2 class="modal__title">${isEdit ? 'Edit expense' : 'Add expense'}</h2>
        <form class="modal__form" id="add-expense-form">
          <label class="filter-group">
            <span class="filter-group__label">Date</span>
            <input type="date" class="filter-input" name="date" value="${existing?.date ?? today}" required>
          </label>
          <label class="filter-group">
            <span class="filter-group__label">Merchant</span>
            <input type="text" class="filter-input" name="merchant" placeholder="e.g. Shufersal" value="${existing?.merchant ?? ''}" required>
          </label>
          <label class="filter-group">
            <span class="filter-group__label">Amount</span>
            <input type="number" class="filter-input" name="amount" min="0" step="0.01" value="${existing?.amount ?? ''}" required>
          </label>
          <label class="filter-group">
            <span class="filter-group__label">Category</span>
            <select class="filter-select" name="categoryId" required>
              ${categories.map((c) => `<option value="${c.id}" ${c.id === existing?.categoryId ? 'selected' : ''}>${c.icon} ${c.name}</option>`).join('')}
            </select>
          </label>
          <label class="filter-group">
            <span class="filter-group__label">Person</span>
            <select class="filter-select" name="person" required>
              ${PEOPLE.map((p) => `<option value="${p}" ${p === existing?.person ? 'selected' : ''}>${p}</option>`).join('')}
            </select>
          </label>
          <div class="modal__actions">
            <button type="button" class="btn" id="modal-cancel">Cancel</button>
            <button type="submit" class="btn btn--primary">${isEdit ? 'Save changes' : 'Add expense'}</button>
          </div>
        </form>
      `,
      { ariaLabel: isEdit ? 'Edit expense' : 'Add expense' },
    )

    modal.element.querySelector<HTMLButtonElement>('#modal-cancel')!.addEventListener('click', () => modal.close())
    modal.element.querySelector<HTMLFormElement>('#add-expense-form')!.addEventListener('submit', (event) => {
      event.preventDefault()
      const form = event.currentTarget as HTMLFormElement
      const data = new FormData(form)
      const input: NewTransaction = {
        date: String(data.get('date')),
        merchant: String(data.get('merchant')).trim(),
        amount: Number(data.get('amount')),
        categoryId: String(data.get('categoryId')),
        person: data.get('person') as Person,
        status: existing?.status ?? 'approved',
        source: existing?.source ?? 'manual',
      }
      if (isEdit) {
        this.commitEdit(existing.id, input)
        modal.close()
      } else {
        createTransaction(input).then((created) => {
          const { transactions } = this.#store.getState()
          this.#store.setState({ transactions: [created, ...transactions] })
          modal.close()
        })
      }
    })
  }

  // ---------- Rendering ----------

  private visibleRows(state: AppState): Transaction[] {
    const categoryById = new Map(state.categories.map((category) => [category.id, category]))
    const filtered = filterTransactions(state.transactions, state.filters)
    return sortTransactions(filtered, this.#sort, categoryById)
  }

  private renderTable(state: AppState): void {
    const categoryById = new Map(state.categories.map((category) => [category.id, category]))
    const rows = this.visibleRows(state)
    const visibleIds = new Set(rows.map((tx) => tx.id))
    for (const id of [...this.#selection]) {
      if (!visibleIds.has(id)) this.#selection.delete(id)
    }

    this.#container.querySelector<HTMLElement>('#transactions-count')!.textContent = `${rows.length} ${rows.length === 1 ? 'result' : 'results'}`

    const thead = this.#container.querySelector('thead')!
    thead.querySelectorAll<HTMLElement>('[data-sort]').forEach((th) => {
      const column = th.dataset.sort as SortColumn
      th.classList.toggle('is-sorted', column === this.#sort.column)
      th.dataset.sortDirection = column === this.#sort.column ? this.#sort.direction : ''
    })

    const selectAll = this.#container.querySelector<HTMLInputElement>('#select-all')!
    selectAll.checked = rows.length > 0 && rows.every((tx) => this.#selection.has(tx.id))

    const tbody = this.#container.querySelector<HTMLElement>('#transactions-body')!
    const cardsContainer = this.#container.querySelector<HTMLElement>('#transactions-cards')!
    this.#container.querySelector<HTMLTableElement>('.transactions__table')!.classList.toggle('is-grouped', this.#groupBy === 'category')

    if (rows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="transactions__empty">No transactions match these filters.</td></tr>`
      cardsContainer.innerHTML = `<p class="transactions__empty">No transactions match these filters.</p>`
    } else if (this.#groupBy === 'category') {
      const groups = this.buildGroups(rows, categoryById)
      tbody.innerHTML = groups.map((g) => this.renderGroupRows(g)).join('')
      cardsContainer.innerHTML = groups.map((g) => this.renderGroupCards(g)).join('')
    } else {
      tbody.innerHTML = rows.map((tx) => this.renderRow(tx, categoryById)).join('')
      cardsContainer.innerHTML = rows.map((tx) => this.renderCard(tx, categoryById)).join('')
    }

    this.renderBulkBar(state.categories)
  }

  private buildGroups(rows: Transaction[], categoryById: Map<string, Category>): CategoryGroup[] {
    const byCategory = new Map<string, Transaction[]>()
    for (const tx of rows) {
      const arr = byCategory.get(tx.categoryId) ?? []
      arr.push(tx)
      byCategory.set(tx.categoryId, arr)
    }
    const groups: CategoryGroup[] = []
    for (const [categoryId, txs] of byCategory) {
      const category = categoryById.get(categoryId)
      if (!category) continue
      groups.push({ category, rows: txs, total: txs.reduce((sum, tx) => sum + tx.amount, 0) })
    }
    return groups.sort((a, b) => b.total - a.total)
  }

  private renderGroupHeader(g: CategoryGroup): string {
    const collapsed = this.#collapsedGroups.has(g.category.id)
    return `
      <button type="button" class="group-header" data-group-toggle="${g.category.id}" aria-expanded="${!collapsed}">
        <span class="group-header__chevron" aria-hidden="true">${collapsed ? '›' : '⌄'}</span>
        <span class="group-header__name">${g.category.icon} ${g.category.name}</span>
        <span class="group-header__count">${g.rows.length} ${g.rows.length === 1 ? 'item' : 'items'}</span>
        <span class="group-header__total">${formatCurrency(g.total)}</span>
      </button>
    `
  }

  private renderGroupRows(g: CategoryGroup): string {
    const categoryById = new Map([[g.category.id, g.category]])
    const collapsed = this.#collapsedGroups.has(g.category.id)
    return `
      <tr class="group-header-row">
        <td colspan="7">${this.renderGroupHeader(g)}</td>
      </tr>
      ${collapsed ? '' : g.rows.map((tx) => this.renderRow(tx, categoryById)).join('')}
    `
  }

  private renderGroupCards(g: CategoryGroup): string {
    const categoryById = new Map([[g.category.id, g.category]])
    const collapsed = this.#collapsedGroups.has(g.category.id)
    return `
      <div class="tx-group">
        ${this.renderGroupHeader(g)}
        ${collapsed ? '' : g.rows.map((tx) => this.renderCard(tx, categoryById)).join('')}
      </div>
    `
  }

  private renderRow(tx: Transaction, categoryById: Map<string, Category>): string {
    return `
      <tr data-id="${tx.id}">
        <td class="select-cell"><input type="checkbox" class="row-select" data-id="${tx.id}" ${this.#selection.has(tx.id) ? 'checked' : ''}></td>
        <td>${formatDateShort(tx.date)}</td>
        <td class="editable-cell" data-field="merchant" data-id="${tx.id}">${renderMerchantCell(tx)} ${renderStatusBadge(tx.status)}</td>
        <td class="editable-cell" data-field="category" data-id="${tx.id}">${renderCategoryBadge(categoryById.get(tx.categoryId))}</td>
        <td class="editable-cell" data-field="person" data-id="${tx.id}">${renderPersonBadge(tx.person)}</td>
        <td class="is-numeric editable-cell" data-field="amount" data-id="${tx.id}">${formatCurrency(tx.amount)}</td>
        <td>${tx.status === 'needs_review' ? `<button type="button" class="btn btn--approve btn--sm" data-approve-id="${tx.id}">Approve</button>` : ''}</td>
      </tr>
    `
  }

  private renderCard(tx: Transaction, categoryById: Map<string, Category>): string {
    return `
      <article class="tx-card" data-id="${tx.id}">
        <input type="checkbox" class="row-select tx-card__select" data-id="${tx.id}" aria-label="Select transaction" ${this.#selection.has(tx.id) ? 'checked' : ''}>
        <div class="tx-card__body">
          <div class="tx-card__top">
            ${renderMerchantCell(tx)}
            <span class="tx-card__amount">${formatCurrency(tx.amount)}</span>
          </div>
          <div class="tx-card__meta">
            ${renderCategoryBadge(categoryById.get(tx.categoryId))}
            ${renderPersonBadge(tx.person)}
            ${renderStatusBadge(tx.status)}
            <span class="tx-card__date">${formatDateShort(tx.date)}</span>
          </div>
          ${
            tx.status === 'needs_review'
              ? `<div class="tx-card__footer"><button type="button" class="btn btn--approve btn--sm" data-approve-id="${tx.id}">Approve</button></div>`
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
      <span class="bulk-bar__count">${this.#selection.size} selected</span>
      <button type="button" class="btn btn--sm" data-bulk-approve>Approve</button>
      <select class="filter-select filter-select--sm" data-bulk-recategorize>
        <option value="">Set category…</option>
        ${categories.map((c) => `<option value="${c.id}">${c.icon} ${c.name}</option>`).join('')}
      </select>
      <button type="button" class="btn btn--sm btn--danger" data-bulk-delete>Delete</button>
    `
  }
}

export function mountTransactionsView(root: HTMLElement, store: Store<AppState>): void {
  new TransactionsView(root, store)
}
