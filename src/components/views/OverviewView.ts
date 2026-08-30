import type { Store } from '../../state/store.ts'
import type { Account, AppState, BudgetLimitOverride, Category, Person, Transaction } from '../../types.ts'
import { computeCategoryBreakdown, computeSplitBalance, computeTotalAvailable, topBudgetedCategories } from '../../utils/insights.ts'
import { resolveSettledAfter } from '../../utils/activity.ts'
import { formatCurrency, formatDateShort, personLabel } from '../../utils/format.ts'
import { logActivity } from '../../data/activityLogRepo.ts'
import { renderProgressBar } from '../shared/ProgressBar.ts'
import { renderCategoryBadge, renderMerchantCell, renderPersonBadge } from '../shared/transactionCells.ts'
import { showToast } from '../shared/Toast.ts'

const RECENT_ACTIVITY_LIMIT = 5
const BUDGET_PROGRESS_LIMIT = 3
const EXPENSE_LIST_LIMIT = 6
const TREND_MONTHS = 4

interface Tip {
  icon: string
  html: string
  /** How notable this is, so the most worth-mentioning tip(s) win the
   * limited slots in the insights row when several apply at once. */
  significance: number
}

const CATEGORY_DELTA_THRESHOLD = 10 // % swing before a category move is worth mentioning at all

/** Every category with a big enough month-over-month swing — a drop reads
 * as good news (money saved), a jump as a heads-up. Real, computed from
 * actual transactions, not canned copy. */
function computeCategoryDeltaTips(transactions: Transaction[], categories: Category[]): Tip[] {
  const thisMonth = computeCategoryBreakdown(transactions, { categoryId: 'all', person: 'all' })
  const lastMonthDate = new Date()
  lastMonthDate.setMonth(lastMonthDate.getMonth() - 1)
  const lastMonth = computeCategoryBreakdown(transactions, { categoryId: 'all', person: 'all' }, lastMonthDate)
  const lastByCategory = new Map(lastMonth.map((entry) => [entry.categoryId, entry.amount]))
  const categoryById = new Map(categories.map((category) => [category.id, category]))

  const tips: Tip[] = []
  for (const entry of thisMonth) {
    const prev = lastByCategory.get(entry.categoryId) ?? 0
    if (prev <= 0) continue
    const deltaPercent = ((entry.amount - prev) / prev) * 100
    if (Math.abs(deltaPercent) < CATEGORY_DELTA_THRESHOLD) continue
    const category = categoryById.get(entry.categoryId)
    if (!category) continue

    if (deltaPercent < 0) {
      const saved = prev - entry.amount
      tips.push({
        icon: '💡',
        html: `ההוצאה על ${category.name} <strong class="is-good">נמוכה ב-${Math.round(Math.abs(deltaPercent))}%</strong> מהחודש שעבר — את/ה בדרך לחסוך עוד ${formatCurrency(saved)}.`,
        significance: Math.abs(deltaPercent),
      })
    } else {
      const extra = entry.amount - prev
      tips.push({
        icon: '📈',
        html: `ההוצאה על ${category.name} <strong class="is-bad">עלתה ב-${Math.round(deltaPercent)}%</strong> מהחודש שעבר — ${formatCurrency(extra)} יותר.`,
        significance: Math.abs(deltaPercent),
      })
    }
  }
  return tips
}

/** How the household's total spend compares to its total budgeted limits
 * this month — only categories that actually have a limit set count toward
 * either side. Null when nothing's budgeted, or the pace isn't notable
 * either way (comfortably mid-range). */
function computeBudgetPaceTip(transactions: Transaction[], categories: Category[], budgetLimitOverrides: BudgetLimitOverride[]): Tip | null {
  const budgeted = topBudgetedCategories(transactions, categories, budgetLimitOverrides)
  if (budgeted.length === 0) return null
  const spent = budgeted.reduce((sum, row) => sum + row.spent, 0)
  const limit = budgeted.reduce((sum, row) => sum + (row.limit ?? 0), 0)
  if (limit <= 0) return null
  const percent = (spent / limit) * 100

  if (percent >= 100) {
    return {
      icon: '🚨',
      html: `ההוצאות בקטגוריות עם תקציב <strong class="is-bad">חורגות ב-${formatCurrency(spent - limit)}</strong> מהמגבלה הכוללת שהוגדרה החודש.`,
      significance: percent,
    }
  }
  if (percent <= 70) {
    return {
      icon: '🎯',
      html: `את/ה ב-${Math.round(percent)}% מהתקציב הכולל לקטגוריות עם מגבלה החודש — <strong class="is-good">מרווח נשימה של ${formatCurrency(limit - spent)}</strong> עד סוף החודש.`,
      significance: 100 - percent,
    }
  }
  return null
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

    <section class="band" id="reminder-band" hidden>
      <div class="band__inner">
        <div class="reminder-banner" id="reminder-banner">
          <span class="reminder-banner__icon" aria-hidden="true">📝</span>
          <span class="reminder-banner__text">עדיין לא נרשמו הוצאות החודש — זמן לעדכן!</span>
          <button type="button" class="btn btn--primary btn--sm" id="reminder-add-btn">הוספת תנועה</button>
          <button type="button" class="icon-btn" id="reminder-dismiss-btn" aria-label="סגירת התזכורת">✕</button>
        </div>
      </div>
    </section>

    <section class="band">
      <div class="band__inner">
        <div class="monthly-expenses-card panel-card" id="monthly-expenses"></div>
      </div>
    </section>

    <section class="band">
      <div class="band__inner">
        <div class="status-banner panel-card" id="status-banner"></div>
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
  const budgetEl = root.querySelector<HTMLElement>('#budget-summary')!
  const monthlyExpensesEl = root.querySelector<HTMLElement>('#monthly-expenses')!
  const insightsBandEl = root.querySelector<HTMLElement>('#insights-band')!
  const insightsRowEl = root.querySelector<HTMLElement>('#insights-row')!
  const activityEl = root.querySelector<HTMLElement>('#activity-list')!
  const reminderBandEl = root.querySelector<HTMLElement>('#reminder-band')!

  // Session-only — reappears next visit if the household still hasn't
  // logged anything for the month, since dismissing without adding data
  // shouldn't make the gap invisible.
  let reminderDismissed = false
  root.querySelector<HTMLButtonElement>('#reminder-dismiss-btn')!.addEventListener('click', () => {
    reminderDismissed = true
    render(store.getState())
  })
  root.querySelector<HTMLButtonElement>('#reminder-add-btn')!.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('opa:new-transaction'))
  })

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

  function render(state: AppState): void {
    renderReminder(state)
    renderStatusBanner(state)
    renderMonthlyExpenses(state)
    renderBudgetSummary(state)
    renderInsightsRow(state)
    renderActivity(state)
  }

  /** "Remind us each month to log our expenses" — the household's own ask.
   * Fires once nothing's been logged for the current calendar month and
   * we're a few days in (skips day 1-4, since nobody's "behind" yet that
   * early) — not tied to the shared/private toggle, since either person
   * not logging anything is worth a nudge. */
  function renderReminder(state: AppState): void {
    const now = new Date()
    const currentMonth = now.toISOString().slice(0, 7)
    const hasLoggedThisMonth = state.transactions.some((tx) => tx.date.startsWith(currentMonth))
    reminderBandEl.hidden = reminderDismissed || hasLoggedThisMonth || now.getDate() < 5
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
            <span class="hero-card__right-title">מאזן</span>
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

    if (total <= 0) {
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
      // Clamped at 0 — a category with net refunds this month has a
      // negative amount, which can't be drawn as a negative-size arc; its
      // legend row still shows the real (negative) amount below.
      const percent = Math.max(0, (slice.amount / total) * 100)
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

  const MAX_TIPS = 2

  /** Invoice Sync and the tips collapse into a single row and vanish
   * entirely (not just show an empty state) when neither has anything to say —
   * near-empty cards read as more clutter than help. Tips are ranked by
   * how notable they are (biggest swing, furthest off budget pace) so the
   * most worth-mentioning ones win when several apply at once — real
   * variety month to month as the data itself changes, not randomized. */
  function renderInsightsRow(state: AppState): void {
    const categoryById = new Map(state.categories.map((category) => [category.id, category]))
    const scoped = scopedTransactions(state)
    const latestAutoTx = [...scoped].filter((tx) => tx.source === 'email_auto').sort((a, b) => (a.date < b.date ? 1 : -1))[0]

    const budgetPaceTip = computeBudgetPaceTip(scoped, state.categories, state.budgetLimitOverrides)
    const tips = [...computeCategoryDeltaTips(scoped, state.categories), ...(budgetPaceTip ? [budgetPaceTip] : [])]
      .sort((a, b) => b.significance - a.significance)
      .slice(0, MAX_TIPS)

    const rows: string[] = []
    if (latestAutoTx) {
      rows.push(`
        <div class="insights-row__item">
          <span class="insights-row__icon" aria-hidden="true">${categoryById.get(latestAutoTx.categoryId)?.icon ?? '🧾'}</span>
          <span class="insights-row__text"><strong>${latestAutoTx.merchant}</strong> נלכד אוטומטית מתיבת הדואר שלך · ${formatCurrency(latestAutoTx.originalAmount, latestAutoTx.currency)} · ${formatDateShort(latestAutoTx.date)}</span>
        </div>
      `)
    }
    for (const tip of tips) {
      rows.push(`
        <div class="insights-row__item">
          <span class="insights-row__icon" aria-hidden="true">${tip.icon}</span>
          <span class="insights-row__text">${tip.html}</span>
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
