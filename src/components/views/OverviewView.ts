import type { Store } from '../../state/store.ts'
import type { AppState, Category } from '../../types.ts'
import { computeCategoryBreakdown, computeReviewedStatus, computeSplitBalance, topBudgetedCategories } from '../../utils/insights.ts'
import { formatCurrency, formatDateShort } from '../../utils/format.ts'
import { updateTransaction } from '../../data/transactionsRepo.ts'
import { loadBalanceSettledAt, saveBalanceSettledAt } from '../../data/balanceSettleSettings.ts'
import { renderProgressBar } from '../shared/ProgressBar.ts'
import { renderCategoryBadge, renderMerchantCell, renderPersonBadge } from '../shared/transactionCells.ts'
import { PLACEHOLDER_EMERGENCY_FUND, PLACEHOLDER_SHARED_ACCOUNT } from '../../data/placeholderFigures.ts'

const RECENT_ACTIVITY_LIMIT = 5
const REVIEW_CENTER_LIMIT = 6
const BUDGET_PROGRESS_LIMIT = 3
const EXPENSE_LIST_LIMIT = 3

interface Improvement {
  category: Category
  deltaPercent: number
  savedAmount: number
}

/** Category with the biggest month-over-month spend decrease, for the
 * "Smart Insight" card — real, computed from actual transactions (unlike
 * the placeholder figures above). Null when nothing improved or there's
 * not enough history yet. */
function computeBiggestImprovement(state: AppState): Improvement | null {
  const thisMonth = computeCategoryBreakdown(state.transactions, { categoryId: 'all', person: 'all' })
  const lastMonthDate = new Date()
  lastMonthDate.setMonth(lastMonthDate.getMonth() - 1)
  const lastMonth = computeCategoryBreakdown(state.transactions, { categoryId: 'all', person: 'all' }, lastMonthDate)
  const lastByCategory = new Map(lastMonth.map((entry) => [entry.categoryId, entry.amount]))
  const categoryById = new Map(state.categories.map((category) => [category.id, category]))

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

export function mountOverviewView(root: HTMLElement, store: Store<AppState>): void {
  root.innerHTML = `
    <section class="band band--page-header">
      <div class="band__inner">
        <div class="page-header">
          <h1 class="page-header__title">Overview</h1>
          <div class="page-header__tools">
            <span class="badge-pill">🔒 Encrypted Environment</span>
            <div class="segmented" role="group" aria-label="Data context">
              <button type="button" class="segmented-btn is-active" data-context="shared">Shared</button>
              <button type="button" class="segmented-btn" data-context="private">Private</button>
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
        <div class="overview-top-grid">
          <div class="settlement-card panel-card" id="settlement-balance"></div>
          <div class="monthly-expenses-card panel-card" id="monthly-expenses"></div>
        </div>
      </div>
    </section>

    <section class="band">
      <div class="band__inner">
        <div class="review-center" id="review-center" aria-label="Pending review"></div>
      </div>
    </section>

    <section class="band">
      <div class="band__inner">
        <div class="budget-summary" id="budget-summary" aria-label="Monthly budget progress"></div>
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
          <p class="eyebrow">Recent activity</p>
          <a class="card-link" href="#transactions">View All →</a>
        </div>
        <div class="activity-list" id="activity-list" aria-label="Recent transactions"></div>
      </div>
    </section>
  `

  const statusBannerEl = root.querySelector<HTMLElement>('#status-banner')!
  const reviewEl = root.querySelector<HTMLElement>('#review-center')!
  const budgetEl = root.querySelector<HTMLElement>('#budget-summary')!
  const settlementEl = root.querySelector<HTMLElement>('#settlement-balance')!
  const monthlyExpensesEl = root.querySelector<HTMLElement>('#monthly-expenses')!
  const insightsBandEl = root.querySelector<HTMLElement>('#insights-band')!
  const insightsRowEl = root.querySelector<HTMLElement>('#insights-row')!
  const activityEl = root.querySelector<HTMLElement>('#activity-list')!

  // Shared/Private is a purely visual toggle for now — it doesn't filter
  // anything yet, matching the redesign's look ahead of that feature existing.
  const contextButtons = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-context]'))
  contextButtons.forEach((btn) => {
    btn.addEventListener('click', () => contextButtons.forEach((b) => b.classList.toggle('is-active', b === btn)))
  })

  settlementEl.addEventListener('click', (event) => {
    if (!(event.target as HTMLElement).closest('[data-mark-settled]')) return
    saveBalanceSettledAt(new Date().toISOString().slice(0, 10))
    renderSettlementBalance(store.getState())
  })

  reviewEl.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-mark-reviewed-id]')
    if (!button) return
    const id = button.dataset.markReviewedId!
    const state = store.getState()
    const tx = state.transactions.find((t) => t.id === id)
    if (!tx) return
    button.disabled = true
    updateTransaction(id, { status: computeReviewedStatus(state.transactions, state.categories, tx.categoryId) })
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
    renderSettlementBalance(state)
    renderMonthlyExpenses(state)
    renderReviewCenter(state)
    renderBudgetSummary(state)
    renderInsightsRow(state)
    renderActivity(state)
  }

  function renderStatusBanner(_state: AppState): void {
    const total = PLACEHOLDER_SHARED_ACCOUNT + PLACEHOLDER_EMERGENCY_FUND

    statusBannerEl.innerHTML = `
      <div class="card-header">
        <div>
          <h2 class="card-header__title">Total Available</h2>
          <p class="card-header__meta"><span class="status-dot" aria-hidden="true"></span>On track · Updated just now</p>
        </div>
        <a class="card-link" href="#accounts">See Details →</a>
      </div>
      <p class="total-available__value">${formatCurrency(total)}</p>
    `
  }

  function renderSettlementBalance(state: AppState): void {
    const balance = computeSplitBalance(state.transactions, new Date(), loadBalanceSettledAt())

    settlementEl.innerHTML = `
      <div class="card-header">
        <h2 class="card-header__title">Settlement Balance</h2>
        <a class="card-link" href="#accounts">View Breakdown →</a>
      </div>
      ${
        balance
          ? `<p class="settlement-card__debt">
               <span class="settlement-card__debt-names">${balance.owingPerson} owes ${balance.owedPerson}</span>
               <span class="settlement-card__debt-amount">${formatCurrency(balance.amount)}</span>
             </p>
             <button type="button" class="btn btn--primary btn--sm" data-mark-settled>Settle Up</button>`
          : `<p class="settlement-card__settled"><span class="review-center__empty-check" aria-hidden="true">✓</span>Settled up this month</p>`
      }
    `
  }

  function renderMonthlyExpenses(state: AppState): void {
    const breakdown = computeCategoryBreakdown(state.transactions, { categoryId: 'all', person: 'all' })
    const categoryById = new Map(state.categories.map((category) => [category.id, category]))
    const total = breakdown.reduce((sum, entry) => sum + entry.amount, 0)

    const header = `
      <div class="card-header">
        <h2 class="card-header__title">Monthly Expenses</h2>
        <a class="card-link" href="#transactions">View All →</a>
      </div>
    `

    if (total === 0) {
      monthlyExpensesEl.innerHTML = `${header}<p class="chart-empty">No spending recorded yet this month.</p>`
      return
    }

    const top = breakdown.slice(0, EXPENSE_LIST_LIMIT)
    const otherAmount = breakdown.slice(EXPENSE_LIST_LIMIT).reduce((sum, entry) => sum + entry.amount, 0)
    const slices = top.map((entry) => ({
      label: categoryById.get(entry.categoryId)?.name ?? 'Other',
      color: categoryById.get(entry.categoryId)?.colorCode ?? 'var(--text)',
      amount: entry.amount,
    }))
    if (otherAmount > 0) slices.push({ label: 'Other', color: 'var(--text)', amount: otherAmount })

    monthlyExpensesEl.innerHTML = `
      ${header}
      <p class="expense-list__total">${formatCurrency(total)} <span class="expense-list__total-label">this month</span></p>
      <ul class="expense-list">
        ${slices
          .map((slice) => {
            const percent = Math.round((slice.amount / total) * 100)
            return `
            <li class="expense-list__item">
              <div class="expense-list__row">
                <span class="expense-list__label"><span class="expense-list__dot" style="background: ${slice.color}"></span>${slice.label}</span>
                <span class="expense-list__amount">${formatCurrency(slice.amount)} <span class="expense-list__pct">${percent}%</span></span>
              </div>
              <div class="expense-list__track"><div class="expense-list__fill" style="width: ${percent}%; background: ${slice.color}"></div></div>
            </li>
          `
          })
          .join('')}
      </ul>
    `
  }

  function renderReviewCenter(state: AppState): void {
    const categoryById = new Map(state.categories.map((category) => [category.id, category]))
    const pending = state.transactions.filter((tx) => tx.status === 'pending').sort((a, b) => (a.date < b.date ? 1 : -1))

    reviewEl.classList.toggle('review-center--compact', pending.length === 0)

    if (pending.length === 0) {
      reviewEl.innerHTML = `
        <div class="review-center__header">
          <h2 class="review-center__title">Review center</h2>
          <a class="card-link" href="#transactions">View All →</a>
        </div>
        <div class="review-center__empty-state">
          <span class="review-center__empty-check" aria-hidden="true">✓</span>
          <span>All caught up — nothing waiting on you.</span>
        </div>
      `
      return
    }

    const visible = pending.slice(0, REVIEW_CENTER_LIMIT)
    reviewEl.innerHTML = `
      <div class="review-center__header">
        <h2 class="review-center__title">Review center</h2>
        <div class="review-center__header-right">
          <span class="review-center__count">${pending.length} awaiting approval</span>
          <a class="card-link" href="#transactions">View All →</a>
        </div>
      </div>
      <div class="review-center__rows">
        ${visible
          .map(
            (tx) => `
          <div class="review-row">
            <span class="review-row__date">${formatDateShort(tx.date)}</span>
            ${renderMerchantCell(tx)}
            ${renderCategoryBadge(categoryById.get(tx.categoryId))}
            <span class="review-row__amount">${formatCurrency(tx.amount)}</span>
            <button type="button" class="btn btn--approve" data-mark-reviewed-id="${tx.id}">Mark reviewed</button>
          </div>
        `,
          )
          .join('')}
      </div>
    `
  }

  function renderBudgetSummary(state: AppState): void {
    const budgeted = topBudgetedCategories(state.transactions, state.categories)

    if (budgeted.length === 0) {
      budgetEl.innerHTML = `
        <div class="budget-summary__header">
          <h2 class="budget-summary__title">Budget progress</h2>
          <a class="card-link" href="#budgets">View All →</a>
        </div>
        <p class="budget-summary__empty">No category budgets set yet — set some in Budgets.</p>
      `
      return
    }

    const visible = budgeted.slice(0, BUDGET_PROGRESS_LIMIT)
    budgetEl.innerHTML = `
      <div class="budget-summary__header">
        <h2 class="budget-summary__title">Budget progress</h2>
        <a class="card-link" href="#budgets">View All ${budgeted.length} →</a>
      </div>
      <div class="budget-progress-grid">
        ${visible
          .map(
            (row) => `
          <div class="budget-progress-item">
            <div class="budget-progress-item__row">
              <span class="budget-progress-item__name">${row.category.icon} ${row.category.name}</span>
              <span class="budget-progress-item__amounts">${formatCurrency(row.spent)} / ${formatCurrency(row.category.monthlyBudgetLimit ?? 0)}</span>
            </div>
            ${renderProgressBar(row.spent, row.category.monthlyBudgetLimit)}
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
    const latestAutoTx = [...state.transactions].filter((tx) => tx.source === 'email_auto').sort((a, b) => (a.date < b.date ? 1 : -1))[0]
    const insight = computeBiggestImprovement(state)

    const rows: string[] = []
    if (latestAutoTx) {
      rows.push(`
        <div class="insights-row__item">
          <span class="insights-row__icon" aria-hidden="true">${categoryById.get(latestAutoTx.categoryId)?.icon ?? '🧾'}</span>
          <span class="insights-row__text"><strong>${latestAutoTx.merchant}</strong> auto-captured from your inbox · ${formatCurrency(latestAutoTx.amount)} · ${formatDateShort(latestAutoTx.date)}</span>
        </div>
      `)
    }
    if (insight) {
      rows.push(`
        <div class="insights-row__item">
          <span class="insights-row__icon" aria-hidden="true">💡</span>
          <span class="insights-row__text">Spending on ${insight.category.name.toLowerCase()} is <strong class="is-good">${Math.round(Math.abs(insight.deltaPercent))}% lower</strong> than last month — you're on track to save an extra ${formatCurrency(insight.savedAmount)}.</span>
        </div>
      `)
    }

    insightsBandEl.hidden = rows.length === 0
    insightsRowEl.innerHTML = rows.join('')
  }

  function renderActivity(state: AppState): void {
    const categoryById = new Map(state.categories.map((category) => [category.id, category]))
    const recent = [...state.transactions].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, RECENT_ACTIVITY_LIMIT)

    activityEl.innerHTML = recent
      .map(
        (tx) => `
      <div class="activity-row">
        <span class="activity-row__date">${formatDateShort(tx.date)}</span>
        ${renderMerchantCell(tx)}
        ${renderCategoryBadge(categoryById.get(tx.categoryId))}
        <span class="activity-row__person">${renderPersonBadge(tx.person)}</span>
        <span class="activity-row__amount">${formatCurrency(tx.amount)}</span>
      </div>
    `,
      )
      .join('')
  }

  store.subscribe(render)
  render(store.getState())
}
