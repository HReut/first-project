import type { Store } from '../../state/store.ts'
import type { Account, AppState, BudgetLimitChangedBefore, Category, NewRecurringRule, Person } from '../../types.ts'
import { computeCategoryBreakdown, resolveBudgetLimitForMonth, resolveBudgetLimitForPeriod } from '../../utils/insights.ts'
import { formatCurrency } from '../../utils/format.ts'
import { budgetStatus } from '../../utils/budget.ts'
import { periodPresetToFilter, type PeriodPreset } from '../../utils/filters.ts'
import { updateCategory } from '../../data/categoriesRepo.ts'
import { createBudgetLimitOverride, deleteBudgetLimitOverridesForCategory } from '../../data/budgetLimitOverridesRepo.ts'
import { createRecurringRule, deleteRecurringRule, updateRecurringRule } from '../../data/recurringRulesRepo.ts'
import { logActivity } from '../../data/activityLogRepo.ts'
import { ACCOUNT_LABEL } from '../shared/transactionCells.ts'
import { renderProgressBar } from '../shared/ProgressBar.ts'
import { Modal } from '../shared/Modal.ts'
import { confirmDialog } from '../shared/confirmDialog.ts'
import { showToast } from '../shared/Toast.ts'

const PERIOD_LABEL: Record<PeriodPreset, string> = {
  'this-month': 'This month',
  'last-month': 'Last month',
  'last-3': 'Last 3 months',
  'last-6': 'Last 6 months',
  'this-year': 'This year',
  all: 'All time',
}

type BudgetScope = 'this-month' | 'from-now-on' | 'all-months'

const ACCOUNT_VALUES: Account[] = ['shared', 'reut_personal', 'keren_personal']
/** A personal account locks the person, same rule as the transaction form. */
const PERSON_FOR_ACCOUNT: Partial<Record<Account, Person>> = { reut_personal: 'Reut', keren_personal: 'Keren' }

function currentMonthKey(): string {
  return new Date().toISOString().slice(0, 7)
}

export function mountBudgetsView(root: HTMLElement, store: Store<AppState>, currentPerson: Person): void {
  let period: PeriodPreset = 'this-month'

  root.innerHTML = `
    <section class="band band--hero">
      <div class="band__inner">
        <p class="eyebrow">Household finance</p>
        <h1>Budgets.</h1>
        <p class="hero__subtitle">Set targets per category and see where the money actually goes.</p>
      </div>
    </section>

    <section class="band">
      <div class="band__inner">
        <div class="tx-page-header">
          <p class="eyebrow">Category budgets</p>
          <label class="toolbar-control">
            <span class="toolbar-control__label">Period</span>
            <select class="toolbar-control__input" id="budgets-period-select">
              ${Object.entries(PERIOD_LABEL)
                .map(([value, label]) => `<option value="${value}">${label}</option>`)
                .join('')}
            </select>
          </label>
        </div>
        <div class="budget-list" id="budget-list" aria-label="Category budgets"></div>
      </div>
    </section>

    <section class="band">
      <div class="band__inner">
        <section class="settings-card" aria-label="Recurring & installment expenses">
          <h2 class="settings-card__title">Recurring &amp; installment expenses</h2>
          <p class="settings-card__desc">
            Bills that repeat every N months (rent, internet, building committee…) — leave "Installments"
            blank for these, they run forever until you switch them off. For a card purchase split into
            fixed payments (e.g. a 12-payment furniture buy), set "Installments" to that count — it stops
            generating on its own once all payments are made. Either way, each due rule adds a Pending
            transaction automatically when the app loads.
          </p>
          <div class="settings-list settings-list--recurring" id="recurring-manager"></div>
        </section>
      </div>
    </section>
  `

  const budgetListEl = root.querySelector<HTMLElement>('#budget-list')!
  const recurringManagerEl = root.querySelector<HTMLElement>('#recurring-manager')!
  const periodSelect = root.querySelector<HTMLSelectElement>('#budgets-period-select')!
  periodSelect.value = period
  periodSelect.addEventListener('change', () => {
    period = periodSelect.value as PeriodPreset
    renderBudgets(store.getState())
  })

  budgetListEl.addEventListener('click', (event) => {
    const cell = (event.target as HTMLElement).closest<HTMLElement>('.budget-row__limit')
    if (!cell) return
    const categoryId = cell.dataset.categoryId!
    const category = store.getState().categories.find((c) => c.id === categoryId)
    if (!category) return
    openBudgetLimitModal(category)
  })

  function openBudgetLimitModal(category: Category): void {
    const currentLimit = resolveBudgetLimitForMonth(category, store.getState().budgetLimitOverrides, currentMonthKey())

    const modal = new Modal(
      `
        <h2 class="modal__title">Update ${category.name} budget</h2>
        <form class="modal__form" id="budget-limit-form">
          <label class="filter-group">
            <span class="filter-group__label">Monthly limit</span>
            <input type="number" class="filter-input" name="limit" min="0" step="10" value="${currentLimit ?? ''}" placeholder="No limit">
          </label>
          <div class="filter-group" role="radiogroup" aria-label="Apply to">
            <span class="filter-group__label">Apply to</span>
            <label class="modal__radio-row"><input type="radio" name="scope" value="this-month" checked> This month only</label>
            <label class="modal__radio-row"><input type="radio" name="scope" value="from-now-on"> This month and every month after</label>
            <label class="modal__radio-row"><input type="radio" name="scope" value="all-months"> All months (replaces any past custom settings for this category)</label>
          </div>
          <div class="modal__actions">
            <button type="button" class="btn" id="modal-cancel">Cancel</button>
            <button type="submit" class="btn btn--primary">Save</button>
          </div>
        </form>
      `,
      { ariaLabel: `Update ${category.name} budget` },
    )

    modal.element.querySelector<HTMLButtonElement>('#modal-cancel')!.addEventListener('click', () => modal.close())
    modal.element.querySelector<HTMLFormElement>('#budget-limit-form')!.addEventListener('submit', (event) => {
      event.preventDefault()
      const form = event.currentTarget as HTMLFormElement
      const data = new FormData(form)
      const raw = String(data.get('limit')).trim()
      const limit = raw === '' ? null : Number(raw)
      const scope = data.get('scope') as BudgetScope
      void applyBudgetLimit(category, limit, scope, modal)
    })
  }

  async function applyBudgetLimit(category: Category, limit: number | null, scope: BudgetScope, modal: Modal): Promise<void> {
    const month = currentMonthKey()
    const previousCategoryLimit = category.monthlyBudgetLimit
    // Only "All months" actually clears existing overrides — capturing them
    // for the other two scopes would make undo try to re-insert overrides
    // that were never deleted, colliding with their still-live rows.
    const previousOverrides = scope === 'all-months' ? store.getState().budgetLimitOverrides.filter((o) => o.categoryId === category.id) : []

    try {
      let createdOverrideId: string | null = null
      if (scope === 'all-months') {
        const [updated] = await Promise.all([updateCategory(category.id, { monthlyBudgetLimit: limit }), deleteBudgetLimitOverridesForCategory(category.id)])
        const { categories, budgetLimitOverrides } = store.getState()
        store.setState({
          categories: categories.map((c) => (c.id === updated.id ? updated : c)),
          budgetLimitOverrides: budgetLimitOverrides.filter((o) => o.categoryId !== category.id),
        })
      } else {
        const endMonth = scope === 'this-month' ? month : null
        const created = await createBudgetLimitOverride({ categoryId: category.id, startMonth: month, endMonth, limit })
        createdOverrideId = created.id
        const { budgetLimitOverrides } = store.getState()
        store.setState({ budgetLimitOverrides: [...budgetLimitOverrides, created] })
      }

      const scopeLabel = scope === 'this-month' ? 'this month only' : scope === 'from-now-on' ? 'this month onward' : 'all months'
      const before: BudgetLimitChangedBefore = { categoryId: category.id, previousCategoryLimit, previousOverrides, createdOverrideId }
      logActivity({
        entityType: 'budget_limit',
        action: 'changed',
        summary: `Changed ${category.name} budget to ${limit === null ? 'no limit' : formatCurrency(limit)} (${scopeLabel})`,
        beforeData: before,
        performedBy: currentPerson,
      })
        .then((entry) => {
          const { activityLog } = store.getState()
          store.setState({ activityLog: [entry, ...activityLog] })
        })
        .catch((err: unknown) => console.warn('Could not write to History — has migration 0009 been run?', err))

      modal.close()
      showToast('Budget updated.', [], 2500)
    } catch {
      showToast('Could not save — has migration 0008 been run?')
    }
  }

  function renderBudgets(state: AppState): void {
    const filterPeriod = periodPresetToFilter(period)
    const breakdown = computeCategoryBreakdown(state.transactions, { categoryId: 'all', person: 'all' }, new Date(), filterPeriod)
    const spentByCategory = new Map(breakdown.map((entry) => [entry.categoryId, entry.amount]))

    budgetListEl.innerHTML = state.categories
      .map((category) => {
        const spent = spentByCategory.get(category.id) ?? 0
        const limit = resolveBudgetLimitForPeriod(category, state.budgetLimitOverrides, filterPeriod)
        const status = budgetStatus(spent, limit)
        return `
          <div class="budget-row" data-status="${status}">
            <span class="budget-row__name">${category.icon} ${category.name}</span>
            <span class="budget-row__spent">${formatCurrency(spent)}</span>
            <span class="budget-row__limit editable-cell" data-category-id="${category.id}">
              ${limit === null ? 'Set limit' : `of ${formatCurrency(limit)}`}
            </span>
            ${renderProgressBar(spent, limit)}
          </div>
        `
      })
      .join('')
  }

  // ---------- Recurring & installment expenses ----------

  function renderRecurringManager(state: AppState): void {
    const categoryOptions = (selectedId: string) =>
      state.categories.map((c) => `<option value="${c.id}" ${c.id === selectedId ? 'selected' : ''}>${c.icon} ${c.name}</option>`).join('')
    const accountOptions = (selected: Account) => ACCOUNT_VALUES.map((a) => `<option value="${a}" ${a === selected ? 'selected' : ''}>${ACCOUNT_LABEL[a]}</option>`).join('')
    const currentMonth = currentMonthKey()

    const statusText = (rule: (typeof state.recurringRules)[number]): string => {
      if (rule.totalOccurrences !== null) return `${rule.occurrencesGenerated} of ${rule.totalOccurrences} paid`
      return rule.lastGeneratedMonth === currentMonth ? 'Generated this month' : 'Not yet generated this month'
    }

    recurringManagerEl.innerHTML = `
      ${state.recurringRules
        .map(
          (rule) => `
        <div class="settings-list__row" data-id="${rule.id}">
          <input type="text" class="name-input" value="${rule.merchant}" placeholder="Bill name" data-rule-field="merchant">
          <input type="number" class="budget-input" value="${rule.amount}" min="0" step="1" title="Amount" data-rule-field="amount">
          <select class="filter-select" data-rule-field="categoryId">${categoryOptions(rule.categoryId)}</select>
          <select class="filter-select" data-rule-field="account">${accountOptions(rule.account)}</select>
          <span class="settings-list__inline-field">
            <span>Every</span>
            <input type="number" class="icon-input" value="${rule.intervalMonths}" min="1" max="24" title="Every N months" data-rule-field="intervalMonths">
            <span>mo · day</span>
            <input type="number" class="icon-input" value="${rule.dayOfMonth}" min="1" max="28" title="Day of month" data-rule-field="dayOfMonth">
          </span>
          <span class="settings-list__inline-field">
            <span>Installments</span>
            <input type="number" class="icon-input" value="${rule.totalOccurrences ?? ''}" min="1" max="60" placeholder="∞" title="Blank = ongoing bill; a number = installment plan that stops after that many payments" data-rule-field="totalOccurrences">
          </span>
          <span class="settings-list__usage">${statusText(rule)}</span>
          <label class="toggle">
            <input type="checkbox" data-rule-field="isActive" ${rule.isActive ? 'checked' : ''}>
            <span class="toggle__track"><span class="toggle__thumb"></span></span>
            <span class="toggle__label">Active</span>
          </label>
          <button type="button" class="btn btn--sm btn--danger" data-delete-recurring="${rule.id}">Delete</button>
        </div>
      `,
        )
        .join('')}
      <div class="settings-list__row settings-list__row--add">
        <input type="text" class="name-input" id="new-recurring-merchant" placeholder="Bill name (e.g. Rent, or Sofa)">
        <input type="number" class="budget-input" id="new-recurring-amount" placeholder="Amount per payment" min="0" step="1">
        <select class="filter-select" id="new-recurring-category">${categoryOptions('')}</select>
        <select class="filter-select" id="new-recurring-account">${accountOptions('shared')}</select>
        <span class="settings-list__inline-field">
          <span>Every</span>
          <input type="number" class="icon-input" id="new-recurring-interval" value="1" min="1" max="24" title="Every N months">
          <span>mo · day</span>
          <input type="number" class="icon-input" id="new-recurring-day" value="1" min="1" max="28" title="Day of month">
        </span>
        <span class="settings-list__inline-field">
          <span>Installments</span>
          <input type="number" class="icon-input" id="new-recurring-installments" min="1" max="60" placeholder="∞" title="Blank = ongoing bill; a number = installment plan that stops after that many payments">
        </span>
        <button type="button" class="btn btn--primary btn--sm" id="add-recurring-btn">+ Add</button>
      </div>
    `
  }

  recurringManagerEl.addEventListener('change', (event) => {
    const input = (event.target as HTMLElement).closest<HTMLElement>('[data-rule-field]') as HTMLInputElement | HTMLSelectElement | null
    if (!input) return
    const row = input.closest<HTMLElement>('.settings-list__row')!
    const id = row.dataset.id
    if (!id) return
    const field = input.dataset.ruleField as keyof NewRecurringRule
    const rule = store.getState().recurringRules.find((r) => r.id === id)
    if (!rule) return

    let patch: Partial<NewRecurringRule>
    if (field === 'isActive') patch = { isActive: (input as HTMLInputElement).checked }
    else if (field === 'totalOccurrences') patch = { totalOccurrences: input.value.trim() === '' ? null : Math.max(1, Number(input.value)) }
    else if (field === 'amount' || field === 'intervalMonths' || field === 'dayOfMonth') patch = { [field]: Number(input.value) }
    else if (field === 'account') {
      const account = input.value as Account
      patch = { account, person: PERSON_FOR_ACCOUNT[account] ?? rule.person }
    } else patch = { [field]: input.value }

    updateRecurringRule(id, patch).then((updated) => {
      const { recurringRules } = store.getState()
      store.setState({ recurringRules: recurringRules.map((r) => (r.id === updated.id ? updated : r)) })
    })
  })

  recurringManagerEl.addEventListener('click', (event) => {
    const deleteBtn = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-delete-recurring]')
    if (deleteBtn) {
      const id = deleteBtn.dataset.deleteRecurring!
      const rule = store.getState().recurringRules.find((r) => r.id === id)
      confirmDialog(`Delete "${rule?.merchant ?? 'this'}"? Future payments will stop generating.`, 'Delete').then((confirmed) => {
        if (!confirmed) return
        deleteRecurringRule(id).then(() => {
          const { recurringRules } = store.getState()
          store.setState({ recurringRules: recurringRules.filter((r) => r.id !== id) })
        })
      })
      return
    }

    if ((event.target as HTMLElement).id === 'add-recurring-btn') {
      const merchantInput = recurringManagerEl.querySelector<HTMLInputElement>('#new-recurring-merchant')!
      const amountInput = recurringManagerEl.querySelector<HTMLInputElement>('#new-recurring-amount')!
      const categorySelect = recurringManagerEl.querySelector<HTMLSelectElement>('#new-recurring-category')!
      const accountSelect = recurringManagerEl.querySelector<HTMLSelectElement>('#new-recurring-account')!
      const intervalInput = recurringManagerEl.querySelector<HTMLInputElement>('#new-recurring-interval')!
      const dayInput = recurringManagerEl.querySelector<HTMLInputElement>('#new-recurring-day')!
      const installmentsInput = recurringManagerEl.querySelector<HTMLInputElement>('#new-recurring-installments')!

      const merchant = merchantInput.value.trim()
      const amount = Number(amountInput.value)
      if (!merchant || !Number.isFinite(amount) || amount <= 0 || !categorySelect.value) return
      const account = accountSelect.value as Account

      createRecurringRule({
        merchant,
        amount,
        categoryId: categorySelect.value,
        account,
        person: PERSON_FOR_ACCOUNT[account] ?? 'Reut',
        intervalMonths: Math.max(1, Number(intervalInput.value) || 1),
        anchorMonth: currentMonthKey(),
        dayOfMonth: Math.min(28, Math.max(1, Number(dayInput.value) || 1)),
        totalOccurrences: installmentsInput.value.trim() === '' ? null : Math.max(1, Number(installmentsInput.value)),
        isActive: true,
      }).then((created) => {
        const { recurringRules } = store.getState()
        store.setState({ recurringRules: [...recurringRules, created] })
      })
    }
  })

  store.subscribe((state) => {
    renderBudgets(state)
    renderRecurringManager(state)
  })
  renderBudgets(store.getState())
  renderRecurringManager(store.getState())
}
