import type { Store } from '../../state/store.ts'
import type { AppState, Category, Filters, Person, Transaction } from '../../types.ts'
import { computeAnalyticsHighlights, computeCategoryBreakdown } from '../../utils/insights.ts'
import { formatCurrency, formatDateShort, formatPercent, personLabel } from '../../utils/format.ts'
import { periodPresetToFilter, type PeriodPreset } from '../../utils/filters.ts'
import { openCategoryDrilldown } from './CategoryDrilldownModal.ts'

const MONTHLY_SERIES_LENGTH = 6
const PEOPLE: Person[] = ['Reut', 'Keren']

const PERIOD_LABEL: Record<PeriodPreset, string> = {
  'this-month': 'החודש',
  'last-month': 'חודש שעבר',
  'last-3': '3 החודשים האחרונים',
  'last-6': '6 החודשים האחרונים',
  'this-year': 'השנה',
  all: 'כל הזמנים',
}

function monthKeyAgo(monthsAgo: number, from = new Date()): string {
  return new Date(from.getFullYear(), from.getMonth() - monthsAgo, 1).toISOString().slice(0, 7)
}

function monthLabelShort(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number)
  return new Date(year, month - 1, 1).toLocaleDateString('he-IL', { month: 'short' })
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

export function mountAnalyticsView(root: HTMLElement, store: Store<AppState>, currentPerson: Person): void {
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
    if (period === 'custom') return customStart && customEnd ? `${formatDateShort(customStart)} – ${formatDateShort(customEnd)}` : 'החודש'
    return PERIOD_LABEL[period]
  }

  root.innerHTML = `
    <section class="band band--hero">
      <div class="band__inner">
        <p class="eyebrow">כספי משק הבית</p>
        <h1>אנליזות.</h1>
        <p class="hero__subtitle">מגמות הוצאה וכיצד ההוצאות מתחלקות בין שניכם.</p>
      </div>
    </section>

    <section class="band band--tight">
      <div class="band__inner">
        <div class="chart-card">
          <div class="transactions__toolbar" id="analytics-toolbar">
            <label class="toolbar-control">
              <span class="toolbar-control__label">תקופה</span>
              <select class="toolbar-control__input" id="analytics-period-select">
                <option value="this-month">החודש</option>
                <option value="last-month">חודש שעבר</option>
                <option value="last-3">3 החודשים האחרונים</option>
                <option value="last-6">6 החודשים האחרונים</option>
                <option value="this-year">השנה</option>
                <option value="all">כל הזמנים</option>
                <option value="custom">טווח מותאם אישית&hellip;</option>
              </select>
            </label>

            <div class="filter-group filter-group--custom-range" id="analytics-custom-range" hidden>
              <label class="filter-group">
                <span class="filter-group__label">מתאריך</span>
                <input type="date" class="filter-input" id="analytics-range-start">
              </label>
              <label class="filter-group">
                <span class="filter-group__label">עד תאריך</span>
                <input type="date" class="filter-input" id="analytics-range-end">
              </label>
            </div>

            <label class="toolbar-control">
              <span class="toolbar-control__label">קטגוריה</span>
              <select class="toolbar-control__input" id="analytics-category-select">
                <option value="all">כל הקטגוריות</option>
              </select>
            </label>

            <label class="toolbar-control">
              <span class="toolbar-control__label">מי שילם/ה</span>
              <select class="toolbar-control__input" id="analytics-person-select">
                <option value="all">כולם</option>
                ${PEOPLE.map((p) => `<option value="${p}">${personLabel(p)}</option>`).join('')}
              </select>
            </label>
          </div>
        </div>
      </div>
    </section>

    <section class="band band--tight">
      <div class="band__inner">
        <div class="chart-card">
          <h2 class="chart-card__title" id="highlights-title">רגעים בולטים — החודש</h2>
          <div class="highlight-grid" id="highlights-grid"></div>
        </div>
      </div>
    </section>

    <section class="band">
      <div class="band__inner">
        <div class="chart-card">
          <h2 class="chart-card__title" id="distribution-title">פילוח הוצאות — החודש</h2>
          <div class="hbar-chart" id="distribution-chart"></div>
        </div>
      </div>
    </section>

    <section class="band">
      <div class="band__inner">
        <div class="chart-card">
          <h2 class="chart-card__title">${MONTHLY_SERIES_LENGTH} החודשים האחרונים</h2>
          <p class="chart-card__note">תמיד ${MONTHLY_SERIES_LENGTH} החודשים האחרונים בפועל — לא מושפע מהסינון למעלה.</p>
          <div class="column-chart" id="monthly-chart"></div>
        </div>
      </div>
    </section>

    <section class="band">
      <div class="band__inner">
        <div class="chart-card">
          <div class="chart-card__header">
            <h2 class="chart-card__title" id="person-chart-title">רעות מול קרן — החודש</h2>
            <ul class="chart-legend">
              <li class="chart-legend__item"><span class="chart-legend__key" style="background: var(--person-reut)"></span>${personLabel('Reut')}</li>
              <li class="chart-legend__item"><span class="chart-legend__key" style="background: var(--person-keren)"></span>${personLabel('Keren')}</li>
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

  distributionEl.addEventListener('click', (event) => {
    const row = (event.target as HTMLElement).closest<HTMLElement>('[data-category-id]')
    if (row) openDrilldown(row.dataset.categoryId!)
  })
  personEl.addEventListener('click', (event) => {
    const row = (event.target as HTMLElement).closest<HTMLElement>('[data-category-id]')
    if (row) openDrilldown(row.dataset.categoryId!)
  })
  highlightsGridEl.addEventListener('click', (event) => {
    const card = (event.target as HTMLElement).closest<HTMLElement>('[data-category-id]')
    if (card) openDrilldown(card.dataset.categoryId!)
  })

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

  function openDrilldown(categoryId: string): void {
    const category = store.getState().categories.find((c) => c.id === categoryId)
    if (!category) return
    openCategoryDrilldown(store, currentPerson, category, resolvedPeriod(), periodLabel(), person)
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
      `<option value="all">כל הקטגוריות</option>` + state.categories.map((c) => `<option value="${c.id}">${c.icon} ${c.name}</option>`).join('')
    categorySelect.value = selected
  }

  function renderHighlights(state: AppState): void {
    highlightsTitleEl.textContent = `רגעים בולטים — ${periodLabel()}`
    const highlights = computeAnalyticsHighlights(state.transactions, state.categories, { categoryId, person }, resolvedPeriod())

    if (highlights.transactionCount === 0) {
      highlightsGridEl.innerHTML = `<p class="chart-empty">לא נרשמו הוצאות ל${periodLabel()}.</p>`
      return
    }

    const delta = highlights.deltaVsPreviousPeriod
    const deltaSub =
      delta === null
        ? 'אין תקופה קודמת להשוואה'
        : `<span class="${delta.amount <= 0 ? 'is-good' : 'is-bad'}">${delta.amount <= 0 ? '↓' : '↑'} ${delta.percent === null ? formatCurrency(Math.abs(delta.amount)) : formatPercent(Math.abs(delta.percent))}</span> לעומת התקופה הקודמת`

    const cards = [
      { label: 'סה"כ הוצאה', value: formatCurrency(highlights.totalAmount), sub: deltaSub, categoryId: null as string | null },
      {
        label: 'קטגוריה מובילה',
        value: highlights.topCategory ? `${highlights.topCategory.category.icon} ${highlights.topCategory.category.name}` : '—',
        sub: highlights.topCategory ? formatCurrency(highlights.topCategory.amount) : '',
        categoryId: highlights.topCategory?.category.id ?? null,
      },
      {
        label: 'בית העסק המוביל',
        value: highlights.topMerchant?.merchant ?? '—',
        sub: highlights.topMerchant ? `${formatCurrency(highlights.topMerchant.amount)} ב-${highlights.topMerchant.count} תנועות` : '',
        categoryId: null,
      },
      {
        label: 'התנועה הגדולה ביותר',
        value: highlights.biggestTransaction ? formatCurrency(highlights.biggestTransaction.originalAmount, highlights.biggestTransaction.currency) : '—',
        sub: highlights.biggestTransaction ? `${highlights.biggestTransaction.merchant} · ${formatDateShort(highlights.biggestTransaction.date)}` : '',
        categoryId: null,
      },
      { label: 'תנועות', value: String(highlights.transactionCount), sub: `ממוצע ${formatCurrency(highlights.avgAmount)}`, categoryId: null },
    ]

    highlightsGridEl.innerHTML = cards
      .map(
        (card) => `
        <div class="highlight-card${card.categoryId ? ' highlight-card--clickable' : ''}" ${card.categoryId ? `data-category-id="${card.categoryId}" title="לחיצה לפירוט"` : ''}>
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

    distributionTitleEl.textContent = `פילוח הוצאות — ${periodLabel()}`

    if (breakdown.length === 0) {
      distributionEl.innerHTML = `<p class="chart-empty">לא נרשמו הוצאות ל${periodLabel()}.</p>`
      return
    }

    distributionEl.innerHTML = breakdown
      .map((entry) => {
        const category = categoryById.get(entry.categoryId)
        if (!category) return ''
        // Clamped at 0 — a category with net refunds this month has a
        // negative amount, which shouldn't render as a negative-width bar.
        const width = Math.max(0, (entry.amount / max) * 100)
        return `
          <div class="hbar-row hbar-row--clickable" data-category-id="${category.id}" title="${category.name}: ${formatCurrency(entry.amount)} — לחיצה לפירוט">
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
        const label = monthLabelShort(point.month)
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
    personTitleEl.textContent = `רעות מול קרן — ${periodLabel()}`

    if (person !== 'all') {
      personEl.innerHTML = `<p class="chart-empty">הגדר/י מי שילם/ה ל"כולם" כדי להשוות בין רעות לקרן.</p>`
      return
    }

    const rows = computePersonBreakdown(state.transactions, state.categories, categoryId, resolvedPeriod())
    if (rows.length === 0) {
      personEl.innerHTML = `<p class="chart-empty">לא נרשמו הוצאות ל${periodLabel()}.</p>`
      return
    }
    const max = Math.max(1, ...rows.flatMap((row) => [row.reut, row.keren]))

    personEl.innerHTML = rows
      .map(
        (row) => `
      <div class="grouped-bar-row grouped-bar-row--clickable" data-category-id="${row.category.id}" title="לחיצה לפירוט">
        <span class="grouped-bar-row__label">${row.category.icon} ${row.category.name}</span>
        <span class="grouped-bar-row__bars">
          <span class="mini-bar" title="${personLabel('Reut')}: ${formatCurrency(row.reut)}">
            <span class="mini-bar__fill" style="width: ${(row.reut / max) * 100}%; background: var(--person-reut)"></span>
          </span>
          <span class="mini-bar" title="${personLabel('Keren')}: ${formatCurrency(row.keren)}">
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

