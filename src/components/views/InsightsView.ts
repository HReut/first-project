import type { Store } from '../../state/store.ts'
import type { AppState, Category, Transaction } from '../../types.ts'
import { computeCategoryBreakdown } from '../../utils/insights.ts'
import { formatCurrency, formatMonthLabel } from '../../utils/format.ts'
import { budgetStatus } from '../../utils/budget.ts'
import { updateCategory } from '../../data/categoriesRepo.ts'
import { renderProgressBar } from '../shared/ProgressBar.ts'

const MONTHLY_SERIES_LENGTH = 6

function monthKeyAgo(monthsAgo: number, from = new Date()): string {
  return new Date(from.getFullYear(), from.getMonth() - monthsAgo, 1).toISOString().slice(0, 7)
}

function computeMonthlySeries(transactions: Transaction[], months: number): { month: string; total: number }[] {
  const series: { month: string; total: number }[] = []
  for (let i = months - 1; i >= 0; i--) {
    const key = monthKeyAgo(i)
    const total = transactions.filter((tx) => tx.date.startsWith(key)).reduce((sum, tx) => sum + tx.amount, 0)
    series.push({ month: key, total })
  }
  return series
}

function computePersonBreakdown(transactions: Transaction[], categories: Category[]): { category: Category; reut: number; keren: number }[] {
  const reutBreakdown = computeCategoryBreakdown(transactions, { categoryId: 'all', person: 'Reut' })
  const kerenBreakdown = computeCategoryBreakdown(transactions, { categoryId: 'all', person: 'Keren' })
  const reutByCategory = new Map(reutBreakdown.map((entry) => [entry.categoryId, entry.amount]))
  const kerenByCategory = new Map(kerenBreakdown.map((entry) => [entry.categoryId, entry.amount]))

  return categories
    .map((category) => ({
      category,
      reut: reutByCategory.get(category.id) ?? 0,
      keren: kerenByCategory.get(category.id) ?? 0,
    }))
    .filter((row) => row.reut > 0 || row.keren > 0)
}

export function mountInsightsView(root: HTMLElement, store: Store<AppState>): void {
  root.innerHTML = `
    <section class="band band--hero">
      <div class="band__inner">
        <p class="eyebrow">Household finance</p>
        <h1>Insights &amp; Budgets.</h1>
        <p class="hero__subtitle">Set targets per category and see where the money actually goes.</p>
      </div>
    </section>

    <section class="band">
      <div class="band__inner">
        <p class="eyebrow">Category budgets</p>
        <div class="budget-list" id="budget-list" aria-label="Category budgets"></div>
      </div>
    </section>

    <section class="band">
      <div class="band__inner">
        <div class="chart-card">
          <h2 class="chart-card__title">Spending distribution — this month</h2>
          <div class="hbar-chart" id="distribution-chart"></div>
        </div>
      </div>
    </section>

    <section class="band">
      <div class="band__inner">
        <div class="chart-card">
          <h2 class="chart-card__title">Last ${MONTHLY_SERIES_LENGTH} months</h2>
          <div class="column-chart" id="monthly-chart"></div>
        </div>
      </div>
    </section>

    <section class="band">
      <div class="band__inner">
        <div class="chart-card">
          <div class="chart-card__header">
            <h2 class="chart-card__title">Reut vs. Keren — this month</h2>
            <ul class="chart-legend">
              <li class="chart-legend__item"><span class="chart-legend__key" style="background: var(--person-reut)"></span>Reut</li>
              <li class="chart-legend__item"><span class="chart-legend__key" style="background: var(--person-keren)"></span>Keren</li>
            </ul>
          </div>
          <div class="grouped-bar-chart" id="person-chart"></div>
        </div>
      </div>
    </section>
  `

  const budgetListEl = root.querySelector<HTMLElement>('#budget-list')!
  const distributionEl = root.querySelector<HTMLElement>('#distribution-chart')!
  const monthlyEl = root.querySelector<HTMLElement>('#monthly-chart')!
  const personEl = root.querySelector<HTMLElement>('#person-chart')!

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
    const breakdown = computeCategoryBreakdown(state.transactions, { categoryId: 'all', person: 'all' })
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

  function renderDistribution(state: AppState): void {
    const breakdown = computeCategoryBreakdown(state.transactions, { categoryId: 'all', person: 'all' })
    const categoryById = new Map(state.categories.map((category) => [category.id, category]))
    const max = Math.max(1, ...breakdown.map((entry) => entry.amount))

    if (breakdown.length === 0) {
      distributionEl.innerHTML = `<p class="chart-empty">No spending recorded yet this month.</p>`
      return
    }

    distributionEl.innerHTML = breakdown
      .map((entry) => {
        const category = categoryById.get(entry.categoryId)
        if (!category) return ''
        const width = (entry.amount / max) * 100
        return `
          <div class="hbar-row" title="${category.name}: ${formatCurrency(entry.amount)}">
            <span class="hbar-row__label">${category.icon} ${category.name}</span>
            <span class="hbar-row__track">
              <span class="hbar-row__fill" style="width: ${width}%; background: ${category.colorCode}"></span>
            </span>
            <span class="hbar-row__value">${formatCurrency(entry.amount)}</span>
          </div>
        `
      })
      .join('')
  }

  function renderMonthly(state: AppState): void {
    const series = computeMonthlySeries(state.transactions, MONTHLY_SERIES_LENGTH)
    const max = Math.max(1, ...series.map((point) => point.total))

    monthlyEl.innerHTML = series
      .map((point) => {
        const height = (point.total / max) * 100
        const label = formatMonthLabel(point.month).split(' ')[0].slice(0, 3)
        return `
          <div class="column" title="${formatMonthLabel(point.month)}: ${formatCurrency(point.total)}">
            <span class="column__value">${formatCurrency(point.total)}</span>
            <span class="column__bar" style="height: ${height}%"></span>
            <span class="column__label">${label}</span>
          </div>
        `
      })
      .join('')
  }

  function renderPersonChart(state: AppState): void {
    const rows = computePersonBreakdown(state.transactions, state.categories)
    if (rows.length === 0) {
      personEl.innerHTML = `<p class="chart-empty">No spending recorded yet this month.</p>`
      return
    }
    const max = Math.max(1, ...rows.flatMap((row) => [row.reut, row.keren]))

    personEl.innerHTML = rows
      .map(
        (row) => `
      <div class="grouped-bar-row">
        <span class="grouped-bar-row__label">${row.category.icon} ${row.category.name}</span>
        <span class="grouped-bar-row__bars">
          <span class="mini-bar" title="Reut: ${formatCurrency(row.reut)}">
            <span class="mini-bar__fill" style="width: ${(row.reut / max) * 100}%; background: var(--person-reut)"></span>
          </span>
          <span class="mini-bar" title="Keren: ${formatCurrency(row.keren)}">
            <span class="mini-bar__fill" style="width: ${(row.keren / max) * 100}%; background: var(--person-keren)"></span>
          </span>
        </span>
      </div>
    `,
      )
      .join('')
  }

  store.subscribe((state) => {
    renderBudgets(state)
    renderDistribution(state)
    renderMonthly(state)
    renderPersonChart(state)
  })

  const initial = store.getState()
  renderBudgets(initial)
  renderDistribution(initial)
  renderMonthly(initial)
  renderPersonChart(initial)
}
