import type { Store } from '../../state/store.ts'
import type { AppState, Category } from '../../types.ts'
import { computeCategoryBreakdown, computeMonthlyInsights, computeSplitBalance } from '../../utils/insights.ts'
import type { CategoryBreakdownEntry } from '../../utils/insights.ts'
import { formatCurrency, formatDateShort, formatPercent, formatSignedCurrency } from '../../utils/format.ts'
import { updateTransaction } from '../../data/transactionsRepo.ts'
import { renderProgressBar } from '../shared/ProgressBar.ts'
import { renderCategoryBadge, renderMerchantCell, renderPersonBadge } from '../shared/transactionCells.ts'
import { CategoryBreakdown } from '../CategoryBreakdown.ts'

const RECENT_ACTIVITY_LIMIT = 5
const REVIEW_CENTER_LIMIT = 6

function computeOverallBudget(categories: Category[], breakdown: CategoryBreakdownEntry[]): { spent: number; limit: number } | null {
  const spentByCategory = new Map(breakdown.map((entry) => [entry.categoryId, entry.amount]))
  const budgeted = categories.filter((category) => category.monthlyBudgetLimit !== null && category.monthlyBudgetLimit > 0)
  if (budgeted.length === 0) return null
  const spent = budgeted.reduce((sum, category) => sum + (spentByCategory.get(category.id) ?? 0), 0)
  const limit = budgeted.reduce((sum, category) => sum + (category.monthlyBudgetLimit ?? 0), 0)
  return { spent, limit }
}

export function mountOverviewView(root: HTMLElement, store: Store<AppState>): void {
  root.innerHTML = `
    <section class="band band--hero">
      <div class="band__inner">
        <p class="eyebrow">Household finance</p>
        <h1>Overview.</h1>
        <p class="hero__subtitle">Your household's spending at a glance.</p>
      </div>
    </section>

    <section class="band">
      <div class="band__inner">
        <div class="stat-cards" id="kpi-cards" aria-label="Monthly summary"></div>
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
        <p class="eyebrow">Get to know your spending.</p>
        <div class="category-grid" id="category-grid" aria-label="Spending by category"></div>
      </div>
    </section>

    <section class="band">
      <div class="band__inner">
        <p class="eyebrow">Recent activity</p>
        <div class="activity-list" id="activity-list" aria-label="Recent transactions"></div>
      </div>
    </section>
  `

  const kpiEl = root.querySelector<HTMLElement>('#kpi-cards')!
  const reviewEl = root.querySelector<HTMLElement>('#review-center')!
  const budgetEl = root.querySelector<HTMLElement>('#budget-summary')!
  const categoryGridEl = root.querySelector<HTMLElement>('#category-grid')!
  const activityEl = root.querySelector<HTMLElement>('#activity-list')!

  new CategoryBreakdown(categoryGridEl, store)

  reviewEl.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-approve-id]')
    if (!button) return
    const id = button.dataset.approveId!
    button.disabled = true
    updateTransaction(id, { status: 'approved' })
      .then((updated) => {
        const { transactions } = store.getState()
        store.setState({ transactions: transactions.map((tx) => (tx.id === id ? updated : tx)) })
      })
      .catch(() => {
        button.disabled = false
      })
  })

  function render(state: AppState): void {
    renderKpis(state)
    renderReviewCenter(state)
    renderBudgetSummary(state)
    renderActivity(state)
  }

  function renderKpis(state: AppState): void {
    // Overview always shows the unfiltered household pulse, independent of
    // whatever filters are set on the Transactions view.
    const insights = computeMonthlyInsights(state.transactions, { categoryId: 'all', person: 'all' })
    const balance = computeSplitBalance(state.transactions)

    const isMoreSpend = insights.deltaAmount > 0
    const isLessSpend = insights.deltaAmount < 0
    const deltaClass = isMoreSpend ? 'is-bad' : isLessSpend ? 'is-good' : 'is-flat'
    const deltaIcon = isMoreSpend ? '↑' : isLessSpend ? '↓' : '→'

    kpiEl.innerHTML = `
      <article class="stat-card stat-card--total">
        <p class="stat-card__label">Total spent this month · household</p>
        <p class="stat-card__value">${formatCurrency(insights.currentMonthTotal)}</p>
        <p class="stat-card__sub">${insights.transactionCount} transaction${insights.transactionCount === 1 ? '' : 's'}</p>
      </article>

      <article class="stat-card">
        <p class="stat-card__label">Vs. last month</p>
        <p class="stat-card__value stat-card__delta ${deltaClass}">
          <span class="stat-card__delta-icon" aria-hidden="true">${deltaIcon}</span>
          ${formatSignedCurrency(insights.deltaAmount)}
        </p>
        <p class="stat-card__sub">${insights.deltaPercent === null ? 'No spending last month to compare' : `${formatPercent(insights.deltaPercent)} vs last month`}</p>
      </article>

      <article class="stat-card stat-card--balance${balance ? ' has-balance' : ''}">
        <p class="stat-card__label">Split balance</p>
        <p class="stat-card__value">${balance ? formatCurrency(balance.amount) : 'Settled up'}</p>
        <p class="stat-card__sub">${balance ? `${balance.owingPerson} owes ${balance.owedPerson}` : 'Reut and Keren are even this month'}</p>
      </article>
    `
  }

  function renderReviewCenter(state: AppState): void {
    const categoryById = new Map(state.categories.map((category) => [category.id, category]))
    const pending = state.transactions
      .filter((tx) => tx.status === 'needs_review')
      .sort((a, b) => (a.date < b.date ? 1 : -1))

    if (pending.length === 0) {
      reviewEl.innerHTML = `
        <h2 class="review-center__title">Review center</h2>
        <p class="review-center__empty">Nothing waiting on you — all auto-imported invoices are approved.</p>
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
            <button type="button" class="btn btn--approve" data-approve-id="${tx.id}">Approve</button>
          </div>
        `,
          )
          .join('')}
      </div>
    `
  }

  function renderBudgetSummary(state: AppState): void {
    const breakdown = computeCategoryBreakdown(state.transactions, { categoryId: 'all', person: 'all' })
    const overall = computeOverallBudget(state.categories, breakdown)

    if (!overall) {
      budgetEl.innerHTML = `
        <h2 class="budget-summary__title">Monthly budget</h2>
        <p class="budget-summary__empty">No category budgets set yet — set some in Insights &amp; Budgets.</p>
      `
      return
    }

    budgetEl.innerHTML = `
      <div class="budget-summary__header">
        <h2 class="budget-summary__title">Monthly budget</h2>
        <span class="budget-summary__amounts">${formatCurrency(overall.spent)} of ${formatCurrency(overall.limit)}</span>
      </div>
      ${renderProgressBar(overall.spent, overall.limit)}
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
