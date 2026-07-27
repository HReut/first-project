import type { Store } from '../state/store.ts'
import type { AppState, Category } from '../types.ts'
import { computeCategoryBreakdown, type CategoryBreakdownEntry } from '../utils/insights.ts'
import { formatCurrency } from '../utils/format.ts'

export class CategoryBreakdown {
  #container: HTMLElement

  constructor(container: HTMLElement, store: Store<AppState>) {
    this.#container = container
    store.subscribe((state) => this.render(state))
    this.render(store.getState())
  }

  private render(state: AppState): void {
    const entries = computeCategoryBreakdown(state.transactions, state.filters)
    const categoryById = new Map(state.categories.map((category) => [category.id, category]))

    this.#container.innerHTML =
      entries.length === 0
        ? `<p class="category-grid__empty">No spending recorded yet this month.</p>`
        : entries.map((entry) => this.renderTile(entry, categoryById)).join('')
  }

  private renderTile(entry: CategoryBreakdownEntry, categoryById: Map<string, Category>): string {
    const category = categoryById.get(entry.categoryId)
    if (!category) return ''
    return `
      <article class="category-tile" style="--tile-color: ${category.colorCode}">
        <p class="category-tile__name">${category.icon} ${category.name}</p>
        <p class="category-tile__amount">${formatCurrency(entry.amount)}</p>
        <p class="category-tile__share">${entry.share.toFixed(0)}% of this month</p>
      </article>
    `
  }
}
