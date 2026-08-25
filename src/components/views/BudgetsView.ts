import type { Store } from '../../state/store.ts'
import type { AppState, Category } from '../../types.ts'
import { computeCategoryBreakdown } from '../../utils/insights.ts'
import { formatCurrency } from '../../utils/format.ts'
import { budgetStatus } from '../../utils/budget.ts'
import { periodPresetToFilter, type PeriodPreset } from '../../utils/filters.ts'
import { updateCategory } from '../../data/categoriesRepo.ts'
import { renderProgressBar } from '../shared/ProgressBar.ts'

const PERIOD_LABEL: Record<PeriodPreset, string> = {
  'this-month': 'This month',
  'last-month': 'Last month',
  'last-3': 'Last 3 months',
  'last-6': 'Last 6 months',
  'this-year': 'This year',
  all: 'All time',
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
    if (!cell || cell.classList.contains('is-editing')) return
    const categoryId = cell.dataset.categoryId!
    const category = store.getState().categories.find((c) => c.id === categoryId)
    if (!category) return
    editBudgetCell(cell, category)
  })

  function editBudgetCell(cell: HTMLElement, category: Category): void {
    cell.classList.add('is-editing')
    cell.innerHTML = `<input type="number" class="cell-input" min="0" step="10" value="${category.monthlyBudgetLimit ?? ''}" placeholder="No limit">`
    const input = cell.querySelector<HTMLInputElement>('.cell-input')!
    input.focus()
    input.select()

    let settled = false
    const commit = () => {
      if (settled) return
      settled = true
      const raw = input.value.trim()
      const monthlyBudgetLimit = raw === '' ? null : Number(raw)
      updateCategory(category.id, { monthlyBudgetLimit }).then((updated) => {
        const { categories } = store.getState()
        store.setState({ categories: categories.map((c) => (c.id === updated.id ? updated : c)) })
      })
    }
    input.addEventListener('blur', commit)
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') input.blur()
      else if (event.key === 'Escape') {
        settled = true
        renderBudgets(store.getState())
      }
    })
  }

  function renderBudgets(state: AppState): void {
    const breakdown = computeCategoryBreakdown(state.transactions, { categoryId: 'all', person: 'all' }, new Date(), periodPresetToFilter(period))
    const spentByCategory = new Map(breakdown.map((entry) => [entry.categoryId, entry.amount]))

    budgetListEl.innerHTML = state.categories
      .map((category) => {
        const spent = spentByCategory.get(category.id) ?? 0
        const status = budgetStatus(spent, category.monthlyBudgetLimit)
        return `
          <div class="budget-row" data-status="${status}">
            <span class="budget-row__name">${category.icon} ${category.name}</span>
            <span class="budget-row__spent">${formatCurrency(spent)}</span>
            <span class="budget-row__limit editable-cell" data-category-id="${category.id}">
              ${category.monthlyBudgetLimit === null ? 'Set limit' : `of ${formatCurrency(category.monthlyBudgetLimit)}`}
            </span>
            ${renderProgressBar(spent, category.monthlyBudgetLimit)}
          </div>
        `
      })
      .join('')
  }

  store.subscribe((state) => renderBudgets(state))
  renderBudgets(store.getState())
}
