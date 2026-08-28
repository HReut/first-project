import type { Store } from '../../state/store.ts'
import type { Account, AppState, Category, Person, Transaction } from '../../types.ts'
import { computeCategoryBreakdown, computeReviewedStatus, computeSplitBalance, computeTotalAvailable, topBudgetedCategories } from '../../utils/insights.ts'
import { resolveSettledAfter } from '../../utils/activity.ts'
import { formatCurrency, formatDateShort, personLabel } from '../../utils/format.ts'
import { updateTransaction } from '../../data/transactionsRepo.ts'
import { logActivity } from '../../data/activityLogRepo.ts'
import { renderProgressBar } from '../shared/ProgressBar.ts'
import { renderCategoryBadge, renderMerchantCell, renderPersonBadge } from '../shared/transactionCells.ts'
import { showToast } from '../shared/Toast.ts'

const RECENT_ACTIVITY_LIMIT = 5
const REVIEW_CENTER_LIMIT = 6
const BUDGET_PROGRESS_LIMIT = 3
const EXPENSE_LIST_LIMIT = 6
const TREND_MONTHS = 4

interface Improvement {
  category: Category
  deltaPercent: number
  savedAmount: number
}

/** Category with the biggest month-over-month spend decrease, for the
 * "Smart Insight" card — real, computed from actual transactions (unlike
 * the placeholder figures above). Null when nothing improved or there's
 * not enough history yet. */
function computeBiggestImprovement(transactions: Transaction[], categories: Category[]): Improvement | null {
  const thisMonth = computeCategoryBreakdown(transactions, { categoryId: 'all', person: 'all' })
  const lastMonthDate = new Date()
  lastMonthDate.setMonth(lastMonthDate.getMonth() - 1)
  const lastMonth = computeCategoryBreakdown(transactions, { categoryId: 'all', person: 'all' }, lastMonthDate)
  const lastByCategory = new Map(lastMonth.map((entry) => [entry.categoryId, entry.amount]))
  const categoryById = new Map(categories.map((category) => [category.id, category]))

  let best: Improvement | null = null
  for (const entry of thisMonth) {
    const prev = lastByCategory.get(entry.categoryId) ?? 0
    if (prev <= 0) continue
    const deltaPercent = ((entry.amount - prev) / prev) * 100
    if (deltaPercent >= 0) continue
    const category = categoryById.get(entry.categoryId)
    if (!category) continue
    if (!best || deltaPercent < best.deltaPercent) {
      best = { category, deltaPercent, savedAmount: prev - entry.amount }
    }
  }
  return best
}

interface SpendTrend {
  series: number[] // oldest → newest, TREND_MONTHS entries
  deltaPercent: number | null // current month vs. the average of the prior months; null with no prior history
}

/** Real month-over-month total spend, used as the trend widget next to Total
 * Available — there's no account-balance history to chart, so this is the
 * closest honest proxy for "how are things moving". */
function computeSpendTrend(transactions: Transaction[]): SpendTrend {
  const series: number[] = []
  for (let i = TREND_MONTHS - 1; i >= 0; i--) {
    const date = new Date()
    date.setMonth(date.getMonth() - i)
    const breakdown = computeCategoryBreakdown(transactions, { categoryId: 'all', person: 'all' }, date)
    series.push(breakdown.reduce((sum, entry) => sum + entry.amount, 0))
  }
  const priorMonths = series.slice(0, -1)
  const priorAvg = priorMonths.reduce((sum, v) => sum + v, 0) / (priorMonths.length || 1)
  const current = series[series.length - 1]
  const deltaPercent = priorAvg === 0 ? null : ((current - priorAvg) / priorAvg) * 100
  return { series, deltaPercent }
}

function renderSparkline(values: number[]): string {
  const max = Math.max(...values, 1)
  const min = Math.min(...values, 0)
  const range = max - min || 1
  const width = 64
  const height = 24
  const step = width / (values.length - 1 || 1)
  const points = values.map((v, i) => `${(i * step).toFixed(1)},${(height - ((v - min) / range) * height).toFixed(1)}`).join(' ')
  return `<svg class="hero-card__sparkline" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${points}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>`
}

export function mountOverviewView(root: HTMLElement, store: Store<AppState>, currentPerson: Person): void {
  root.innerHTML = `
    <section class="band band--page-header">
      <div class="band__inner">
        <div class="page-header">
          <h1 class="page-header__title">סקירה כללית</h1>
          <div class="page-header__tools">
            <span class="badge-pill">🔒 סביבה מוצפנת</span>
            <div class="segmented" role="group" aria-label="היקף נתונים">
              <button type="button" class="segmented-btn is-active" data-context="shared">משותף</button>
              <button type="button" class="segmented-btn" data-context="private">פרטי</button>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="band">
      <div class="band__inner">
        <div class="status-banner panel-card" id="status-banner"></div>
      </div>
    </section>

    <section class="band">
      <div class="band__inner">
        <div class="monthly-expenses-card panel-card" id="monthly-expenses"></div>
      </div>
    </section>

    <section class="band">
      <div class="band__inner">
        <div class="review-center" id="review-center" aria-label="בבדיקה"></div>
      </div>
    </section>

    <section class="band">
      <div class="band__inner">
        <div class="budget-summary" id="budget-summary" aria-label="התקדמות תקציב חודשי"></div>
      </div>
    </section>

    <section class="band" id="insights-band" hidden>
      <div class="band__inner">
        <div class="insights-row panel-card panel-card--muted" id="insights-row"></div>
      </div>
    </section>

    <section class="band">
      <div class="band__inner">
        <div class="section-header">
          <p class="eyebrow">פעילות אחרונה</p>
          <a class="card-link" href="#transactions">צפייה בהכול ←</a>
        </div>
        <div class="activity-list" id="activity-list" aria-label="תנועות אחרונות"></div>
      </div>
    </section>
  `

  const statusBannerEl = root.querySelector<HTMLElement>('#status-banner')!
  const reviewEl = root.querySelector<HTMLElement>('#review-center')!
  const budgetEl = root.querySelector<HTMLElement>('#budget-summary')!
  const monthlyExpensesEl = root.querySelector<HTMLElement>('#monthly-expenses')!
  const insightsBandEl = root.querySelector<HTMLElement>('#insights-band')!
  const insightsRowEl = root.querySelector<HTMLElement>('#insights-row')!
  const activityEl = root.querySelector<HTMLElement>('#activity-list')!

  // Shared = the household view (all transactions). Private = just what
  // currentPerson paid from their own personal-account pocket. Total
  // Available and Settlement stay on the real, full transaction list either
  // way — both are inherently joint figures with no meaningful "just mine"
  // version; everything else (spend trend, breakdown, budgets, activity)
  // scopes to the toggle.
  let dataContext: 'shared' | 'private' = 'shared'
  const personalAccount: Account = currentPerson === 'Reut' ? 'reut_personal' : 'keren_personal'

  function scopedTransactions(state: AppState): Transaction[] {
    return dataContext === 'shared' ? state.transactions : state.transactions.filter((tx) => tx.account === personalAccount)
  }

  const contextButtons = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-context]'))
  contextButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      dataContext = (btn.dataset.context as 'shared' | 'private') ?? 'shared'
      contextButtons.forEach((b) => b.classList.toggle('is-active', b === btn))
      render(store.getState())
    })
  })

  statusBannerEl.addEventListener('click', (event) => {
    if (!(event.target as HTMLElement).closest('[data-mark-settled]')) return
    const state = store.getState()
    const balance = computeSplitBalance(state.transactions, new Date(), resolveSettledAfter(state.activityLog))
    if (!balance) return
    logActivity({
      entityType: 'settlement',
      action: 'settled',
      summary: `סגירת חוב: ${personLabel(balance.owingPerson)} שילם/ה ל${personLabel(balance.owedPerson)} ${formatCurrency(balance.amount)}`,
      beforeData: null,
      performedBy: currentPerson,
    })
      .then((entry) => {
        const { activityLog } = store.getState()
        store.setState({ activityLog: [entry, ...activityLog] })
      })
      .catch(() => {
        showToast('לא ניתן היה לסגור את החוב — האם הרצת את מיגרציה 0009?')
      })
  })

  reviewEl.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-mark-reviewed-id]')
    if (!button) return
    const id = button.dataset.markReviewedId!
    const state = store.getState()
    const tx = state.transactions.find((t) => t.id === id)
    if (!tx) return
    button.disabled = true
    updateTransaction(id, { status: computeReviewedStatus(state.transactions, state.categories, tx.categoryId, state.budgetLimitOverrides) })
      .then((updated) => {
        const { transactions } = store.getState()
        store.setState({ transactions: transactions.map((t) => (t.id === id ? updated : t)) })
      })
      .catch(() => {
        button.disabled = false
      })
  })

  function render(state: AppState): void {
    renderStatusBanner(state)
    renderMonthlyExpenses(state)
    renderReviewCenter(state)
    renderBudgetSummary(state)
    renderInsightsRow(state)
    renderActivity(state)
  }

  function renderStatusBanner(state: AppState): void {
    const total = computeTotalAvailable(state.transactions, state.accountBalance)
    const trend = computeSpendTrend(scopedTransactions(state))
    const balance = computeSplitBalance(state.transactions, new Date(), resolveSettledAfter(state.activityLog))

    statusBannerEl.innerHTML = `
      <div class="card-header">
        <div>
          <h2 class="card-header__title">סה"כ זמין</h2>
          <p class="card-header__meta">
            ${
              total === null
                ? 'עדיין לא נמדד'
                : `<span class="status-dot" aria-hidden="true"></span>נכון ל-${formatDateShort(state.accountBalance!.setAt)}`
            }
            ${dataContext === 'private' ? ' · תמיד הסכום המשותף הכולל, ללא קשר למתג הזה' : ''}
          </p>
        </div>
        <a class="card-link" href="#settings">${total === null ? 'הגדרת יתרה ←' : 'עדכון יתרה ←'}</a>
      </div>
      <div class="hero-card__split">
        <div class="hero-card__left">
          ${
            total === null
              ? `<p class="total-available__empty">הזן/י את יתרת החשבון המשותף בהגדרות כדי לעקוב אחרי זה.</p>`
              : `<p class="total-available__value">${formatCurrency(total)}</p>
                 ${
                   trend.deltaPercent === null
                     ? ''
                     : `<div class="hero-card__trend">
                          ${renderSparkline(trend.series)}
                          <span class="hero-card__trend-label ${trend.deltaPercent <= 0 ? 'is-good' : 'is-bad'}">
                            ${trend.deltaPercent <= 0 ? '↓' : '↑'} ${Math.abs(Math.round(trend.deltaPercent * 10) / 10)}% <span class="hero-card__trend-caption">לעומת ממוצע 3 החודשים האחרונים</span>
                          </span>
                        </div>`
                 }`
          }
        </div>
        <div class="hero-card__right">
          <div class="hero-card__right-header">
            <span class="hero-card__right-title">התחשבנות</span>
            <a class="card-link" href="#history">צפייה בפירוט ←</a>
          </div>
          ${
            balance
              ? `<p class="settlement-card__debt">
                   <span class="settlement-card__debt-names">${personLabel(balance.owingPerson)} חייב/ת ל${personLabel(balance.owedPerson)}</span>
                   <span class="settlement-card__debt-amount">${formatCurrency(balance.amount)}</span>
                 </p>
                 <button type="button" class="btn btn--primary btn--sm" data-mark-settled>סגירת חוב</button>`
              : `<p class="settlement-card__settled"><span class="review-center__empty-check" aria-hidden="true">✓</span>מסודר החודש</p>`
          }
        </div>
      </div>
    `
  }

  function renderMonthlyExpenses(state: AppState): void {
    const breakdown = computeCategoryBreakdown(scopedTransactions(state), { categoryId: 'all', person: 'all' })
    const categoryById = new Map(state.categories.map((category) => [category.id, category]))
    const total = breakdown.reduce((sum, entry) => sum + entry.amount, 0)

    const header = `
      <div class="card-header">
        <h2 class="card-header__title">הוצאות חודשיות</h2>
        <a class="card-link" href="#analytics">צפייה בהכול ←</a>
      </div>
    `

    if (total === 0) {
      monthlyExpensesEl.innerHTML = `${header}<p class="chart-empty">לא נרשמו הוצאות החודש עדיין.</p>`
      return
    }

    const top = breakdown.slice(0, EXPENSE_LIST_LIMIT)
    const otherAmount = breakdown.slice(EXPENSE_LIST_LIMIT).reduce((sum, entry) => sum + entry.amount, 0)
    const slices = top.map((entry) => ({
      id: entry.categoryId,
      label: categoryById.get(entry.categoryId)?.name ?? 'אחר',
      color: categoryById.get(entry.categoryId)?.colorCode ?? 'var(--text)',
      amount: entry.amount,
    }))
    if (otherAmount > 0) slices.push({ id: 'other', label: 'אחר', color: 'var(--text)', amount: otherAmount })

    // Percentage-of-circumference donut: r is chosen so 2πr ≈ 100, so
    // stroke-dasharray/offset can be plain percentages. The whole <svg> is
    // rotated -90deg (in CSS) so offset 0 sits at 12 o'clock.
    let cumulative = 0
    const arcs = slices.map((slice) => {
      const percent = (slice.amount / total) * 100
      const arc = { ...slice, percent, offset: -cumulative }
      cumulative += percent
      return arc
    })

    monthlyExpensesEl.innerHTML = `
      ${header}
      <div class="expense-breakdown">
        <div class="expense-breakdown__chart">
          <svg class="donut-svg" viewBox="0 0 42 42" role="img" aria-label="פילוח הוצאות לפי קטגוריה">
            <circle class="donut-svg__bg" cx="21" cy="21" r="15.9155" fill="transparent" stroke-width="6" />
            ${arcs
              .map(
                (arc) => `
              <circle
                class="donut-svg__slice"
                data-slice-id="${arc.id}"
                cx="21" cy="21" r="15.9155"
                fill="transparent"
                stroke="${arc.color}"
                stroke-width="6"
                stroke-dasharray="${arc.percent} ${100 - arc.percent}"
                stroke-dashoffset="${arc.offset}"
              />
            `,
              )
              .join('')}
          </svg>
          <div class="donut-svg__hole">
            <span class="donut-chart__total">${formatCurrency(total)}</span>
            <span class="donut-chart__total-label">החודש</span>
          </div>
        </div>
        <ul class="expense-breakdown__legend">
          ${arcs
            .map(
              (arc) => `
            <li class="expense-breakdown__row" data-slice-id="${arc.id}">
              <span class="expense-breakdown__label"><span class="expense-breakdown__dot" style="background: ${arc.color}"></span>${arc.label}</span>
              <span class="expense-breakdown__amount">${formatCurrency(arc.amount)}</span>
              <span class="expense-breakdown__pct">${Math.round(arc.percent)}%</span>
            </li>
          `,
            )
            .join('')}
        </ul>
      </div>
    `

    // Interactive legend: hovering a row highlights its donut slice, and vice versa.
    const rows = Array.from(monthlyExpensesEl.querySelectorAll<HTMLElement>('.expense-breakdown__row'))
    const slicesById = new Map(
      Array.from(monthlyExpensesEl.querySelectorAll<SVGCircleElement>('.donut-svg__slice')).map((el) => [el.dataset.sliceId, el]),
    )
    rows.forEach((row) => {
      const slice = slicesById.get(row.dataset.sliceId)
      row.addEventListener('mouseenter', () => {
        row.classList.add('is-active')
        slice?.classList.add('is-active')
      })
      row.addEventListener('mouseleave', () => {
        row.classList.remove('is-active')
        slice?.classList.remove('is-active')
      })
    })
    slicesById.forEach((slice, id) => {
      const row = rows.find((r) => r.dataset.sliceId === id)
      slice.addEventListener('mouseenter', () => {
        slice.classList.add('is-active')
        row?.classList.add('is-active')
      })
      slice.addEventListener('mouseleave', () => {
        slice.classList.remove('is-active')
        row?.classList.remove('is-active')
      })
    })
  }

  function renderReviewCenter(state: AppState): void {
    const categoryById = new Map(state.categories.map((category) => [category.id, category]))
    const pending = scopedTransactions(state)
      .filter((tx) => tx.status === 'pending')
      .sort((a, b) => (a.date < b.date ? 1 : -1))

    reviewEl.classList.toggle('review-center--compact', pending.length === 0)

    if (pending.length === 0) {
      reviewEl.innerHTML = `
        <div class="review-center__header">
          <h2 class="review-center__title">מרכז בדיקה</h2>
          <a class="card-link" href="#transactions">צפייה בהכול ←</a>
        </div>
        <div class="review-center__empty-state">
          <span class="review-center__empty-check" aria-hidden="true">✓</span>
          <span>הכול מעודכן — אין דבר שממתין לך.</span>
        </div>
      `
      return
    }

    const visible = pending.slice(0, REVIEW_CENTER_LIMIT)
    reviewEl.innerHTML = `
      <div class="review-center__header">
        <h2 class="review-center__title">מרכז בדיקה</h2>
        <div class="review-center__header-right">
          <span class="review-center__count">${pending.length} ממתינות לאישור</span>
          <a class="card-link" href="#transactions">צפייה בהכול ←</a>
        </div>
      </div>
      <div class="review-center__rows">
        ${visible
          .map(
            (tx) => `
          <div class="review-row">
            <span class="review-row__date">${formatDateShort(tx.date)}</span>
            ${renderMerchantCell(tx, categoryById.get(tx.categoryId))}
            ${renderCategoryBadge(categoryById.get(tx.categoryId))}
            <span class="review-row__amount">${formatCurrency(tx.originalAmount, tx.currency)}</span>
            <button type="button" class="btn btn--approve" data-mark-reviewed-id="${tx.id}">סמן כנבדק</button>
          </div>
        `,
          )
          .join('')}
      </div>
    `
  }

  function renderBudgetSummary(state: AppState): void {
    const budgeted = topBudgetedCategories(scopedTransactions(state), state.categories, state.budgetLimitOverrides)

    if (budgeted.length === 0) {
      budgetEl.innerHTML = `
        <div class="budget-summary__header">
          <h2 class="budget-summary__title">התקדמות תקציב</h2>
          <a class="card-link" href="#budgets">צפייה בהכול ←</a>
        </div>
        <p class="budget-summary__empty">עדיין לא הוגדרו תקציבי קטגוריה — הגדר/י בעמוד התקציבים.</p>
      `
      return
    }

    const visible = budgeted.slice(0, BUDGET_PROGRESS_LIMIT)
    budgetEl.innerHTML = `
      <div class="budget-summary__header">
        <h2 class="budget-summary__title">התקדמות תקציב</h2>
        <a class="card-link" href="#budgets">צפייה בכל ${budgeted.length} ←</a>
      </div>
      <div class="budget-progress-grid">
        ${visible
          .map(
            (row) => `
          <div class="budget-progress-item">
            <div class="budget-progress-item__row">
              <span class="budget-progress-item__name">${row.category.icon} ${row.category.name}</span>
              <span class="budget-progress-item__amounts">${formatCurrency(row.spent)} / ${formatCurrency(row.limit ?? 0)}</span>
            </div>
            ${renderProgressBar(row.spent, row.limit)}
          </div>
        `,
          )
          .join('')}
      </div>
    `
  }

  /** Invoice Sync and Smart Insight collapse into a single row and vanish
   * entirely (not just show an empty state) when neither has anything to say —
   * two near-empty cards read as more clutter than help. */
  function renderInsightsRow(state: AppState): void {
    const categoryById = new Map(state.categories.map((category) => [category.id, category]))
    const scoped = scopedTransactions(state)
    const latestAutoTx = [...scoped].filter((tx) => tx.source === 'email_auto').sort((a, b) => (a.date < b.date ? 1 : -1))[0]
    const insight = computeBiggestImprovement(scoped, state.categories)

    const rows: string[] = []
    if (latestAutoTx) {
      rows.push(`
        <div class="insights-row__item">
          <span class="insights-row__icon" aria-hidden="true">${categoryById.get(latestAutoTx.categoryId)?.icon ?? '🧾'}</span>
          <span class="insights-row__text"><strong>${latestAutoTx.merchant}</strong> נלכד אוטומטית מתיבת הדואר שלך · ${formatCurrency(latestAutoTx.originalAmount, latestAutoTx.currency)} · ${formatDateShort(latestAutoTx.date)}</span>
        </div>
      `)
    }
    if (insight) {
      rows.push(`
        <div class="insights-row__item">
          <span class="insights-row__icon" aria-hidden="true">💡</span>
          <span class="insights-row__text">ההוצאה על ${insight.category.name} <strong class="is-good">נמוכה ב-${Math.round(Math.abs(insight.deltaPercent))}%</strong> מהחודש שעבר — את/ה בדרך לחסוך עוד ${formatCurrency(insight.savedAmount)}.</span>
        </div>
      `)
    }

    insightsBandEl.hidden = rows.length === 0
    insightsRowEl.innerHTML = rows.join('')
  }

  function renderActivity(state: AppState): void {
    const categoryById = new Map(state.categories.map((category) => [category.id, category]))
    const recent = [...scopedTransactions(state)].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, RECENT_ACTIVITY_LIMIT)

    activityEl.innerHTML = recent
      .map(
        (tx) => `
      <div class="activity-row">
        <span class="activity-row__date">${formatDateShort(tx.date)}</span>
        ${renderMerchantCell(tx, categoryById.get(tx.categoryId))}
        ${renderCategoryBadge(categoryById.get(tx.categoryId))}
        <span class="activity-row__person">${renderPersonBadge(tx.person)}</span>
        <span class="activity-row__amount">${formatCurrency(tx.originalAmount, tx.currency)}</span>
      </div>
    `,
      )
      .join('')
  }

  store.subscribe(render)
  render(store.getState())
}
