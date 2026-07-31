import type { Store } from '../../state/store.ts'
import type { AppState, Category } from '../../types.ts'
import { computeCategoryBreakdown, computeReviewedStatus, computeSplitBalance, topBudgetedCategories } from '../../utils/insights.ts'
import { formatCurrency, formatDateShort } from '../../utils/format.ts'
import { updateTransaction } from '../../data/transactionsRepo.ts'
import { renderProgressBar } from '../shared/ProgressBar.ts'
import { renderCategoryBadge, renderMerchantCell, renderPersonBadge } from '../shared/transactionCells.ts'
import {
  PLACEHOLDER_EMERGENCY_FUND,
  PLACEHOLDER_HEALTH_SCORE,
  PLACEHOLDER_MONTHLY_FLOW,
  PLACEHOLDER_NET_WORTH,
  PLACEHOLDER_NET_WORTH_DELTA_PERCENT,
  PLACEHOLDER_SHARED_ACCOUNT,
} from '../../data/placeholderFigures.ts'

const RECENT_ACTIVITY_LIMIT = 5
const REVIEW_CENTER_LIMIT = 6
const BUDGET_PROGRESS_LIMIT = 3
const DONUT_SLICE_LIMIT = 3

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
          <h1 class="page-header__title">Executive Overview</h1>
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
        <div class="status-banner panel-card">
          <div class="status-banner__lead">
            <span class="status-banner__icon" aria-hidden="true">🛡️</span>
            <div>
              <h2 class="status-banner__title">Overall Current Status</h2>
              <p class="status-banner__meta"><span class="status-dot" aria-hidden="true"></span>On track · Updated just now</p>
            </div>
          </div>
          <div class="status-banner__stats">
            <div class="status-banner__stat">
              <span class="status-banner__stat-label">Total Net Worth</span>
              <span class="status-banner__stat-value">${formatCurrency(PLACEHOLDER_NET_WORTH)}</span>
              <span class="status-banner__stat-sub is-good">↗ ${PLACEHOLDER_NET_WORTH_DELTA_PERCENT}%</span>
            </div>
            <div class="status-banner__stat">
              <span class="status-banner__stat-label">Monthly Flow</span>
              <span class="status-banner__stat-value">+${formatCurrency(PLACEHOLDER_MONTHLY_FLOW)}</span>
              <span class="chip chip--good">Surplus</span>
            </div>
            <div class="status-banner__stat status-banner__stat--score">
              <span class="status-banner__stat-label">Health Score</span>
              <span class="status-banner__stat-value">${PLACEHOLDER_HEALTH_SCORE}<span class="status-banner__stat-value-sub">/100</span></span>
              <div class="mini-meter"><div class="mini-meter__fill" style="width: ${PLACEHOLDER_HEALTH_SCORE}%"></div></div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="band">
      <div class="band__inner">
        <div class="overview-top-grid">
          <div class="total-available-card panel-card" id="total-available"></div>
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

    <section class="band">
      <div class="band__inner">
        <div class="overview-bottom-grid">
          <div class="invoice-sync-card panel-card" id="invoice-sync"></div>
          <div class="smart-insight-card panel-card" id="smart-insight"></div>
        </div>
      </div>
    </section>

    <section class="band">
      <div class="band__inner">
        <p class="eyebrow">Recent activity</p>
        <div class="activity-list" id="activity-list" aria-label="Recent transactions"></div>
      </div>
    </section>
  `

  const reviewEl = root.querySelector<HTMLElement>('#review-center')!
  const budgetEl = root.querySelector<HTMLElement>('#budget-summary')!
  const totalAvailableEl = root.querySelector<HTMLElement>('#total-available')!
  const monthlyExpensesEl = root.querySelector<HTMLElement>('#monthly-expenses')!
  const invoiceSyncEl = root.querySelector<HTMLElement>('#invoice-sync')!
  const smartInsightEl = root.querySelector<HTMLElement>('#smart-insight')!
  const activityEl = root.querySelector<HTMLElement>('#activity-list')!

  // Shared/Private is a purely visual toggle for now — it doesn't filter
  // anything yet, matching the redesign's look ahead of that feature existing.
  const contextButtons = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-context]'))
  contextButtons.forEach((btn) => {
    btn.addEventListener('click', () => contextButtons.forEach((b) => b.classList.toggle('is-active', b === btn)))
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
    renderTotalAvailable(state)
    renderMonthlyExpenses(state)
    renderReviewCenter(state)
    renderBudgetSummary(state)
    renderInvoiceSync(state)
    renderSmartInsight(state)
    renderActivity(state)
  }

  function renderTotalAvailable(state: AppState): void {
    const balance = computeSplitBalance(state.transactions)
    const total = PLACEHOLDER_SHARED_ACCOUNT + PLACEHOLDER_EMERGENCY_FUND

    totalAvailableEl.innerHTML = `
      <div class="card-header">
        <div>
          <h2 class="card-header__title">Total Available</h2>
          <p class="card-header__meta">Shared context active</p>
        </div>
      </div>
      <p class="total-available__value">${formatCurrency(total)}</p>
      <div class="total-available__split">
        <div class="total-available__split-item">
          <span class="total-available__split-label">Shared Account</span>
          <span class="total-available__split-value">${formatCurrency(PLACEHOLDER_SHARED_ACCOUNT)}</span>
        </div>
        <div class="total-available__split-item">
          <span class="total-available__split-label">Emergency Fund</span>
          <span class="total-available__split-value">${formatCurrency(PLACEHOLDER_EMERGENCY_FUND)}</span>
        </div>
      </div>
      <div class="total-available__balance">
        <span class="total-available__balance-label">Current status</span>
        <p class="total-available__balance-value">${balance ? `${balance.owingPerson} owes ${balance.owedPerson} · ${formatCurrency(balance.amount)}` : 'Settled up this month'}</p>
      </div>
    `
  }

  function renderMonthlyExpenses(state: AppState): void {
    const breakdown = computeCategoryBreakdown(state.transactions, { categoryId: 'all', person: 'all' })
    const categoryById = new Map(state.categories.map((category) => [category.id, category]))
    const total = breakdown.reduce((sum, entry) => sum + entry.amount, 0)

    if (total === 0) {
      monthlyExpensesEl.innerHTML = `
        <h2 class="card-header__title">Monthly Expenses</h2>
        <p class="chart-empty">No spending recorded yet this month.</p>
      `
      return
    }

    const top = breakdown.slice(0, DONUT_SLICE_LIMIT)
    const otherAmount = breakdown.slice(DONUT_SLICE_LIMIT).reduce((sum, entry) => sum + entry.amount, 0)
    const slices = top.map((entry) => ({
      label: categoryById.get(entry.categoryId)?.name ?? 'Other',
      color: categoryById.get(entry.categoryId)?.colorCode ?? 'var(--text)',
      amount: entry.amount,
    }))
    if (otherAmount > 0) slices.push({ label: 'Other', color: 'var(--text)', amount: otherAmount })

    let cursor = 0
    const stops = slices
      .map((slice) => {
        const start = cursor
        cursor += (slice.amount / total) * 100
        return `${slice.color} ${start}% ${cursor}%`
      })
      .join(', ')

    monthlyExpensesEl.innerHTML = `
      <h2 class="card-header__title">Monthly Expenses</h2>
      <div class="donut-chart">
        <div class="donut-chart__ring" style="background: conic-gradient(${stops})">
          <div class="donut-chart__hole">
            <span class="donut-chart__total">${formatCurrency(total)}</span>
            <span class="donut-chart__total-label">Total</span>
          </div>
        </div>
        <ul class="donut-legend">
          ${slices
            .map(
              (slice) => `
            <li class="donut-legend__item">
              <span class="donut-legend__dot" style="background: ${slice.color}"></span>
              ${slice.label} (${Math.round((slice.amount / total) * 100)}%)
            </li>
          `,
            )
            .join('')}
        </ul>
      </div>
    `
  }

  function renderReviewCenter(state: AppState): void {
    const categoryById = new Map(state.categories.map((category) => [category.id, category]))
    const pending = state.transactions.filter((tx) => tx.status === 'pending').sort((a, b) => (a.date < b.date ? 1 : -1))

    if (pending.length === 0) {
      reviewEl.innerHTML = `
        <h2 class="review-center__title">Review center</h2>
        <p class="review-center__empty">Nothing waiting on you — all imported transactions have been reviewed.</p>
      `
      return
    }

    const visible = pending.slice(0, REVIEW_CENTER_LIMIT)
    reviewEl.innerHTML = `
      <div class="review-center__header">
        <h2 class="review-center__title">Review center</h2>
        <span class="review-center__count">${pending.length} awaiting approval</span>
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
        <h2 class="budget-summary__title">Budget progress</h2>
        <p class="budget-summary__empty">No category budgets set yet — set some in Budgets.</p>
      `
      return
    }

    const visible = budgeted.slice(0, BUDGET_PROGRESS_LIMIT)
    budgetEl.innerHTML = `
      <div class="budget-summary__header">
        <h2 class="budget-summary__title">Budget progress</h2>
        <a class="budget-summary__link" href="#budgets">View all ${budgeted.length}</a>
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

  function renderInvoiceSync(state: AppState): void {
    const categoryById = new Map(state.categories.map((category) => [category.id, category]))
    const autoTx = [...state.transactions]
      .filter((tx) => tx.source === 'email_auto')
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .slice(0, 3)

    invoiceSyncEl.innerHTML = `
      <div class="card-header">
        <div>
          <h2 class="card-header__title">Invoice sync</h2>
          <p class="card-header__meta">Auto-captured from connected inboxes</p>
        </div>
        <span class="chip chip--accent">Active</span>
      </div>
      ${
        autoTx.length === 0
          ? `<p class="chart-empty">No auto-captured invoices yet.</p>`
          : `<div class="invoice-sync__list">
              ${autoTx
                .map(
                  (tx) => `
                <div class="invoice-sync__row">
                  <span class="invoice-sync__icon" aria-hidden="true">${categoryById.get(tx.categoryId)?.icon ?? '🧾'}</span>
                  <div class="invoice-sync__info">
                    <span class="invoice-sync__merchant">${tx.merchant}</span>
                    <span class="invoice-sync__date">${formatDateShort(tx.date)}</span>
                  </div>
                  <span class="invoice-sync__amount">${formatCurrency(tx.amount)}</span>
                </div>
              `,
                )
                .join('')}
            </div>`
      }
    `
  }

  function renderSmartInsight(state: AppState): void {
    const insight = computeBiggestImprovement(state)
    smartInsightEl.innerHTML = `
      <div class="card-header">
        <span class="smart-insight__icon" aria-hidden="true">💡</span>
        <h2 class="card-header__title">Smart insight</h2>
      </div>
      ${
        insight
          ? `<p class="smart-insight__text">Your spending on ${insight.category.name.toLowerCase()} is <strong class="is-good">${Math.round(Math.abs(insight.deltaPercent))}% lower</strong> than last month. You're on track to save an extra ${formatCurrency(insight.savedAmount)}.</p>`
          : `<p class="smart-insight__text">Keep logging expenses — once there's enough history, personalized spending trends will show up here.</p>`
      }
    `
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
