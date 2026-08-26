import type { Store } from '../../state/store.ts'
import type { AppState, Category, Filters, Person, Transaction } from '../../types.ts'
import { computeAnalyticsHighlights, computeCategoryBreakdown } from '../../utils/insights.ts'
import { formatCurrency, formatDateShort, formatMonthLabel, formatPercent } from '../../utils/format.ts'
import { periodPresetToFilter, type PeriodPreset } from '../../utils/filters.ts'

const MONTHLY_SERIES_LENGTH = 6
const PEOPLE: Person[] = ['Reut', 'Keren']

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

function computeMonthlySeries(transactions: Transaction[], months: number, filters: Pick<Filters, 'categoryId' | 'person'>): { month: string; total: number }[] {
  const scoped = transactions.filter((tx) => {
    if (filters.categoryId !== 'all' && tx.categoryId !== filters.categoryId) return false
    if (filters.person !== 'all' && tx.person !== filters.person) return false
    return true
  })
  const series: { month: string; total: number }[] = []
  for (let i = months - 1; i >= 0; i--) {
    const key = monthKeyAgo(i)
    const total = scoped.filter((tx) => tx.date.startsWith(key)).reduce((sum, tx) => sum + tx.amount, 0)
    series.push({ month: key, total })
  }
  return series
}

function computePersonBreakdown(transactions: Transaction[], categories: Category[], categoryId: string, period: Filters['period']): { category: Category; reut: number; keren: number }[] {
  const reutBreakdown = computeCategoryBreakdown(transactions, { categoryId, person: 'Reut' }, new Date(), period)
  const kerenBreakdown = computeCategoryBreakdown(transactions, { categoryId, person: 'Keren' }, new Date(), period)
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
  let period: PeriodPreset | 'custom' = 'this-month'
  let categoryId = 'all'
  let person: Person | 'all' = 'all'
  let customStart = ''
  let customEnd = ''

  function resolvedPeriod(): Filters['period'] {
    if (period === 'custom') {
      if (!customStart || !customEnd) return periodPresetToFilter('this-month')
      return { kind: 'range', start: customStart, end: customEnd }
    }
    return periodPresetToFilter(period)
  }

  function periodLabel(): string {
    if (period === 'custom') return customStart && customEnd ? `${formatDateShort(customStart)} – ${formatDateShort(customEnd)}` : 'this month'
    return PERIOD_LABEL[period]
  }

  root.innerHTML = `
    <section class="band band--hero">
      <div class="band__inner">
        <p class="eyebrow">Household finance</p>
        <h1>Analytics.</h1>
        <p class="hero__subtitle">Spending trends and how expenses split between the two of you.</p>
      </div>
    </section>

    <section class="band band--tight">
      <div class="band__inner">
        <div class="chart-card">
          <div class="transactions__toolbar" id="analytics-toolbar">
            <label class="toolbar-control">
              <span class="toolbar-control__label">Period</span>
              <select class="toolbar-control__input" id="analytics-period-select">
                <option value="this-month">This month</option>
                <option value="last-month">Last month</option>
                <option value="last-3">Last 3 months</option>
                <option value="last-6">Last 6 months</option>
                <option value="this-year">This year</option>
                <option value="all">All time</option>
                <option value="custom">Custom range&hellip;</option>
              </select>
            </label>

            <div class="filter-group filter-group--custom-range" id="analytics-custom-range" hidden>
              <label class="filter-group">
                <span class="filter-group__label">From</span>
                <input type="date" class="filter-input" id="analytics-range-start">
              </label>
              <label class="filter-group">
                <span class="filter-group__label">To</span>
                <input type="date" class="filter-input" id="analytics-range-end">
              </label>
            </div>

            <label class="toolbar-control">
              <span class="toolbar-control__label">Category</span>
              <select class="toolbar-control__input" id="analytics-category-select">
                <option value="all">All categories</option>
              </select>
            </label>

            <label class="toolbar-control">
              <span class="toolbar-control__label">Person</span>
              <select class="toolbar-control__input" id="analytics-person-select">
                <option value="all">Everyone</option>
                ${PEOPLE.map((p) => `<option value="${p}">${p}</option>`).join('')}
              </select>
            </label>
          </div>
        </div>
      </div>
    </section>

    <section class="band band--tight">
      <div class="band__inner">
        <div class="chart-card">
          <h2 class="chart-card__title" id="highlights-title">Highlights — this month</h2>
          <div class="highlight-grid" id="highlights-grid"></div>
        </div>
      </div>
    </section>

    <section class="band">
      <div class="band__inner">
        <div class="chart-card">
          <h2 class="chart-card__title" id="distribution-title">Spending distribution — this month</h2>
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

  const highlightsTitleEl = root.querySelector<HTMLElement>('#highlights-title')!
  const highlightsGridEl = root.querySelector<HTMLElement>('#highlights-grid')!
  const distributionEl = root.querySelector<HTMLElement>('#distribution-chart')!
  const distributionTitleEl = root.querySelector<HTMLElement>('#distribution-title')!
  const monthlyEl = root.querySelector<HTMLElement>('#monthly-chart')!
  const personEl = root.querySelector<HTMLElement>('#person-chart')!
  const personTitleEl = root.querySelector<HTMLElement>('#person-chart-title')!

  const periodSelect = root.querySelector<HTMLSelectElement>('#analytics-period-select')!
  const customRangeEl = root.querySelector<HTMLElement>('#analytics-custom-range')!
  const rangeStartInput = root.querySelector<HTMLInputElement>('#analytics-range-start')!
  const rangeEndInput = root.querySelector<HTMLInputElement>('#analytics-range-end')!
  const categorySelect = root.querySelector<HTMLSelectElement>('#analytics-category-select')!
  const personSelect = root.querySelector<HTMLSelectElement>('#analytics-person-select')!

  function renderAll(): void {
    const state = store.getState()
    renderHighlights(state)
    renderDistribution(state)
    renderMonthly(state)
    renderPersonChart(state)
  }

  periodSelect.value = period
  periodSelect.addEventListener('change', () => {
    period = periodSelect.value as PeriodPreset | 'custom'
    customRangeEl.hidden = period !== 'custom'
    renderAll()
  })

  rangeStartInput.addEventListener('change', () => {
    customStart = rangeStartInput.value
    if (period === 'custom') renderAll()
  })
  rangeEndInput.addEventListener('change', () => {
    customEnd = rangeEndInput.value
    if (period === 'custom') renderAll()
  })

  categorySelect.addEventListener('change', () => {
    categoryId = categorySelect.value
    renderAll()
  })

  personSelect.addEventListener('change', () => {
    person = personSelect.value as Person | 'all'
    renderAll()
  })

  function renderCategoryOptions(state: AppState): void {
    const selected = categorySelect.value
    categorySelect.innerHTML =
      `<option value="all">All categories</option>` + state.categories.map((c) => `<option value="${c.id}">${c.icon} ${c.name}</option>`).join('')
    categorySelect.value = selected
  }

  function renderHighlights(state: AppState): void {
    highlightsTitleEl.textContent = `Highlights — ${periodLabel()}`
    const highlights = computeAnalyticsHighlights(state.transactions, state.categories, { categoryId, person }, resolvedPeriod())

    if (highlights.transactionCount === 0) {
      highlightsGridEl.innerHTML = `<p class="chart-empty">No spending recorded for ${periodLabel()}.</p>`
      return
    }

    const delta = highlights.deltaVsPreviousPeriod
    const deltaSub =
      delta === null
        ? 'No prior period to compare'
        : `<span class="${delta.amount <= 0 ? 'is-good' : 'is-bad'}">${delta.amount <= 0 ? '↓' : '↑'} ${delta.percent === null ? formatCurrency(Math.abs(delta.amount)) : formatPercent(Math.abs(delta.percent))}</span> vs previous period`

    const cards = [
      { label: 'Total spent', value: formatCurrency(highlights.totalAmount), sub: deltaSub },
      {
        label: 'Top category',
        value: highlights.topCategory ? `${highlights.topCategory.category.icon} ${highlights.topCategory.category.name}` : '—',
        sub: highlights.topCategory ? formatCurrency(highlights.topCategory.amount) : '',
      },
      {
        label: 'Top merchant',
        value: highlights.topMerchant?.merchant ?? '—',
        sub: highlights.topMerchant ? `${formatCurrency(highlights.topMerchant.amount)} across ${highlights.topMerchant.count} transaction${highlights.topMerchant.count === 1 ? '' : 's'}` : '',
      },
      {
        label: 'Biggest transaction',
        value: highlights.biggestTransaction ? formatCurrency(highlights.biggestTransaction.amount) : '—',
        sub: highlights.biggestTransaction ? `${highlights.biggestTransaction.merchant} · ${formatDateShort(highlights.biggestTransaction.date)}` : '',
      },
      { label: 'Transactions', value: String(highlights.transactionCount), sub: `${formatCurrency(highlights.avgAmount)} average` },
    ]

    highlightsGridEl.innerHTML = cards
      .map(
        (card) => `
        <div class="highlight-card">
          <span class="highlight-card__label">${card.label}</span>
          <span class="highlight-card__value">${card.value}</span>
          ${card.sub ? `<span class="highlight-card__sub">${card.sub}</span>` : ''}
        </div>
      `,
      )
      .join('')
  }

  function renderDistribution(state: AppState): void {
    const breakdown = computeCategoryBreakdown(state.transactions, { categoryId, person }, new Date(), resolvedPeriod())
    const categoryById = new Map(state.categories.map((category) => [category.id, category]))
    const max = Math.max(1, ...breakdown.map((entry) => entry.amount))

    distributionTitleEl.textContent = `Spending distribution — ${periodLabel()}`

    if (breakdown.length === 0) {
      distributionEl.innerHTML = `<p class="chart-empty">No spending recorded for ${periodLabel()}.</p>`
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
    const series = computeMonthlySeries(state.transactions, MONTHLY_SERIES_LENGTH, { categoryId, person })
    const max = Math.max(1, ...series.map((point) => point.total))

    monthlyEl.innerHTML = series
      .map((point) => {
        const height = (point.total / max) * 100
        const label = formatMonthLabel(point.month).split(' ')[0].slice(0, 3)
        return `
          <div class="column" title="${label}: ${formatCurrency(point.total)}">
            <span class="column__value">${formatCurrency(point.total)}</span>
            <span class="column__bar" style="height: ${height}%"></span>
            <span class="column__label">${label}</span>
          </div>
        `
      })
      .join('')
  }

  function renderPersonChart(state: AppState): void {
    personTitleEl.textContent = `Reut vs. Keren — ${periodLabel()}`

    if (person !== 'all') {
      personEl.innerHTML = `<p class="chart-empty">Set Person to "Everyone" to compare Reut and Keren.</p>`
      return
    }

    const rows = computePersonBreakdown(state.transactions, state.categories, categoryId, resolvedPeriod())
    if (rows.length === 0) {
      personEl.innerHTML = `<p class="chart-empty">No spending recorded for ${periodLabel()}.</p>`
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
    renderCategoryOptions(state)
    renderHighlights(state)
    renderDistribution(state)
    renderMonthly(state)
    renderPersonChart(state)
  })

  const initial = store.getState()
  renderCategoryOptions(initial)
  renderHighlights(initial)
  renderDistribution(initial)
  renderMonthly(initial)
  renderPersonChart(initial)
}

