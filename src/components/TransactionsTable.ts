import type { Store } from '../state/store.ts'
import type { AppState, Transaction } from '../types.ts'
import { filterTransactions } from '../utils/filters.ts'
import { formatCurrency, formatDateShort } from '../utils/format.ts'
import { CATEGORY_COLOR_VAR, PERSON_INITIAL, PERSON_LABEL } from '../utils/categoryMeta.ts'

export class TransactionsTable {
  #container: HTMLElement

  constructor(container: HTMLElement, store: Store<AppState>) {
    this.#container = container
    store.subscribe((state) => this.render(state))
    this.render(store.getState())
  }

  private render(state: AppState): void {
    const rows = filterTransactions(state.transactions, state.filters).sort((a, b) => (a.date < b.date ? 1 : -1))

    this.#container.innerHTML = `
      <div class="transactions__header">
        <h2>Transactions</h2>
        <span class="transactions__count">${rows.length} ${rows.length === 1 ? 'result' : 'results'}</span>
      </div>
      ${rows.length === 0 ? this.renderEmptyState() : this.renderTable(rows)}
    `
  }

  private renderEmptyState(): string {
    return `<p class="transactions__empty">No transactions match these filters.</p>`
  }

  private renderTable(rows: Transaction[]): string {
    return `
      <div class="transactions__table-wrap">
        <table class="transactions__table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Merchant</th>
              <th>Category</th>
              <th>Person</th>
              <th class="is-numeric">Amount</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((tx) => this.renderRow(tx)).join('')}
          </tbody>
        </table>
      </div>
    `
  }

  private renderRow(tx: Transaction): string {
    const isEmail = tx.source === 'email'
    return `
      <tr>
        <td>${formatDateShort(tx.date)}</td>
        <td>
          <span class="merchant-cell">
            ${tx.merchant}
            ${
              isEmail
                ? `<span class="email-badge" title="Captured automatically from email">
                    <svg viewBox="0 0 20 20" width="13" height="13" aria-hidden="true">
                      <path d="M2.5 5.5A1.5 1.5 0 0 1 4 4h12a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 16 16H4a1.5 1.5 0 0 1-1.5-1.5v-9Z M3 5.5l7 5 7-5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"/>
                    </svg>
                    <span>Auto</span>
                  </span>`
                : ''
            }
          </span>
        </td>
        <td>
          <span class="category-badge">
            <span class="category-dot" style="background: var(${CATEGORY_COLOR_VAR[tx.category]})"></span>
            ${tx.category}
          </span>
        </td>
        <td>
          <span class="person-badge" data-person="${tx.person}">${PERSON_INITIAL[tx.person]}</span>
          <span class="person-name">${PERSON_LABEL[tx.person]}</span>
        </td>
        <td class="is-numeric">${formatCurrency(tx.amount)}</td>
      </tr>
    `
  }
}
