import type { Store } from '../../state/store.ts'
import type { AppState, Category, Filters, Transaction } from '../../types.ts'
import { computeCategoryBreakdown } from '../../utils/insights.ts'
import { formatCurrency, formatMonthLabel } from '../../utils/format.ts'
import { periodPresetToFilter, type PeriodPreset } from '../../utils/filters.ts'

const MONTHLY_SERIES_LENGTH = 6

const PERIOD_LABEL: Record<PeriodPreset, string> = {
  'this-month': 'this month',
  'last-month': 'last month',
  'last-3': 'the last 3 months',
  'last-6': 'the last 6 months',
  'this-year': 'this year',
  all: 'all time',
}

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

function computePersonBreakdown(transactions: Transaction[], categories: Category[], period: Filters['period']): { category: Category; reut: number; keren: number }[] {
  const reutBreakdown = computeCategoryBreakdown(transactions, { categoryId: 'all', person: 'Reut' }, new Date(), period)
  const kerenBreakdown = computeCategoryBreakdown(transactions, { categoryId: 'all', person: 'Keren' }, new Date(), period)
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

export function mountAnalyticsView(root: HTMLElement, store: Store<AppState>): void {
  let period: PeriodPreset = 'this-month'

  root.innerHTML = `
    <section class="band band--hero">
      <div class="band__inner">
        <p class="eyebrow">Household finance</p>
        <h1>Analytics.</h1>
        <p class="hero__subtitle">Spending trends and how expenses split between the two of you.</p>
      </div>
    </section>

    <section class="band">
      <div class="band__inner">
        <div class="chart-card">
          <div class="chart-card__header">
            <h2 class="chart-card__title" id="distribution-title">Spending distribution — this month</h2>
            <label class="toolbar-control">
              <span class="toolbar-control__label">Period</span>
              <select class="toolbar-control__input" id="analytics-period-select">
                <option value="this-month">This month</option>
                <option value="last-month">Last month</option>
                <option value="last-3">Last 3 months</option>
                <option value="last-6">Last 6 months</option>
                <option value="this-year">This year</option>
                <option value="all">All time</option>
              </select>
            </label>
          </div>
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
            <h2 class="chart-card__title" id="person-chart-title">Reut vs. Keren — this month</h2>
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

  const distributionEl = root.querySelector<HTMLElement>('#distribution-chart')!
  const distributionTitleEl = root.querySelector<HTMLElement>('#distribution-title')!
  const monthlyEl = root.querySelector<HTMLElement>('#monthly-chart')!
  const personEl = root.querySelector<HTMLElement>('#person-chart')!
  const personTitleEl = root.querySelector<HTMLElement>('#person-chart-title')!

  const periodSelect = root.querySelector<HTMLSelectElement>('#analytics-period-select')!
  periodSelect.value = period
  periodSelect.addEventListener('change', () => {
    period = periodSelect.value as PeriodPreset
    const state = store.getState()
    renderDistribution(state)
    renderPersonChart(state)
  })

  function renderDistribution(state: AppState): void {
    const breakdown = computeCategoryBreakdown(state.transactions, { categoryId: 'all', person: 'all' }, new Date(), periodPresetToFilter(period))
    const categoryById = new Map(state.categories.map((category) => [category.id, category]))
    const max = Math.max(1, ...breakdown.map((entry) => entry.amount))

    distributionTitleEl.textContent = `Spending distribution — ${PERIOD_LABEL[period]}`

    if (breakdown.length === 0) {
      distributionEl.innerHTML = `<p class="chart-empty">No spending recorded for ${PERIOD_LABEL[period]}.</p>`
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
    const rows = computePersonBreakdown(state.transactions, state.categories, periodPresetToFilter(period))
    personTitleEl.textContent = `Reut vs. Keren — ${PERIOD_LABEL[period]}`
    if (rows.length === 0) {
      personEl.innerHTML = `<p class="chart-empty">No spending recorded for ${PERIOD_LABEL[period]}.</p>`
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
    renderDistribution(state)
    renderMonthly(state)
    renderPersonChart(state)
  })

  const initial = store.getState()
  renderDistribution(initial)
  renderMonthly(initial)
  renderPersonChart(initial)
}
