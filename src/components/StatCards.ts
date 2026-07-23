import type { Store } from '../state/store.ts'
import type { AppState } from '../types.ts'
import { computeMonthlyInsights, type MonthlyInsights } from '../utils/insights.ts'
import { formatCurrency, formatMonthLabel, formatPercent, formatSignedCurrency } from '../utils/format.ts'
import { PERSON_LABEL } from '../utils/categoryMeta.ts'

export class StatCards {
  #container: HTMLElement

  constructor(container: HTMLElement, store: Store<AppState>) {
    this.#container = container
    store.subscribe((state) => this.render(state))
    this.render(store.getState())
  }

  private render(state: AppState): void {
    const { filters, transactions } = state
    const insights = computeMonthlyInsights(transactions, filters)
    const scopeLabel = filters.person === 'all' ? 'household' : PERSON_LABEL[filters.person]
    const monthLabel = formatMonthLabel(new Date().toISOString().slice(0, 7))

    const isMoreSpend = insights.deltaAmount > 0
    const isLessSpend = insights.deltaAmount < 0
    const deltaClass = isMoreSpend ? 'is-bad' : isLessSpend ? 'is-good' : 'is-flat'
    const deltaIcon = isMoreSpend ? '↑' : isLessSpend ? '↓' : '→'

    this.#container.innerHTML = `
      <article class="stat-card">
        <p class="stat-card__label">Total spent this month · ${scopeLabel}</p>
        <p class="stat-card__value">${formatCurrency(insights.currentMonthTotal)}</p>
        <p class="stat-card__sub">${monthLabel} · ${insights.transactionCount} transaction${insights.transactionCount === 1 ? '' : 's'}</p>
      </article>

      <article class="stat-card">
        <p class="stat-card__label">Vs. last month</p>
        <p class="stat-card__value stat-card__delta ${deltaClass}">
          <span class="stat-card__delta-icon" aria-hidden="true">${deltaIcon}</span>
          ${formatSignedCurrency(insights.deltaAmount)}
        </p>
        <p class="stat-card__sub">${insights.deltaPercent === null ? 'No spending last month to compare' : `${formatPercent(insights.deltaPercent)} vs last month`}</p>
      </article>

      <article class="stat-card stat-card--insight">
        <p class="stat-card__label">Quick insight</p>
        <p class="stat-card__insight-text">${this.buildInsightText(insights)}</p>
      </article>
    `
  }

  private buildInsightText(insights: MonthlyInsights): string {
    const parts: string[] = []

    if (insights.deltaPercent === null) {
      parts.push(insights.currentMonthTotal > 0 ? 'No spending recorded last month to compare against.' : 'No spending recorded yet this month.')
    } else if (insights.deltaAmount < 0) {
      parts.push(`You're spending ${Math.abs(insights.deltaPercent).toFixed(0)}% less than last month. Nice.`)
    } else if (insights.deltaAmount > 0) {
      parts.push(`You're spending ${insights.deltaPercent.toFixed(0)}% more than last month.`)
    } else {
      parts.push('Spending is flat compared to last month.')
    }

    if (insights.topCategory) {
      parts.push(`Top category: ${insights.topCategory.category} (${formatCurrency(insights.topCategory.amount)}).`)
    }

    return parts.join(' ')
  }
}
