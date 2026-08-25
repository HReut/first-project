import type { Store } from '../../state/store.ts'
import type { AppState, Category } from '../../types.ts'
import { computeCategoryBreakdown, resolveBudgetLimitForMonth, resolveBudgetLimitForPeriod } from '../../utils/insights.ts'
import { formatCurrency } from '../../utils/format.ts'
import { budgetStatus } from '../../utils/budget.ts'
import { periodPresetToFilter, type PeriodPreset } from '../../utils/filters.ts'
import { updateCategory } from '../../data/categoriesRepo.ts'
import { createBudgetLimitOverride, deleteBudgetLimitOverridesForCategory } from '../../data/budgetLimitOverridesRepo.ts'
import { renderProgressBar } from '../shared/ProgressBar.ts'
import { Modal } from '../shared/Modal.ts'
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

function currentMonthKey(): string {
  return new Date().toISOString().slice(0, 7)
}

export function mountBudgetsView(root: HTMLElement, store: Store<AppState>): void {
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
  `

  const budgetListEl = root.querySelector<HTMLElement>('#budget-list')!
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
    try {
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
        const { budgetLimitOverrides } = store.getState()
        store.setState({ budgetLimitOverrides: [...budgetLimitOverrides, created] })
      }
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

  store.subscribe((state) => renderBudgets(state))
  renderBudgets(store.getState())
}
