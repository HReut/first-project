import { Store } from '../state/store.ts'
import { createMockTransactions } from '../data/mockTransactions.ts'
import type { AppState } from '../types.ts'
import { StatCards } from './StatCards.ts'
import { FilterBar } from './FilterBar.ts'
import { TransactionsTable } from './TransactionsTable.ts'

function currentMonthKey(): string {
  return new Date().toISOString().slice(0, 7)
}

export function mountDashboard(root: HTMLElement): void {
  const store = new Store<AppState>({
    transactions: createMockTransactions(),
    filters: {
      category: 'all',
      person: 'all',
      period: { kind: 'month', month: currentMonthKey() },
    },
  })

  root.innerHTML = `
    <header class="topbar">
      <div class="topbar__inner">
        <span class="topbar__mark" aria-hidden="true">H</span>
        <span class="topbar__name">Household</span>
      </div>
    </header>
    <div class="dashboard">
      <header class="dashboard__header">
        <div class="dashboard__title">
          <h1>Dashboard.</h1>
          <p>Track spending across your household, together.</p>
        </div>
      </header>
      <section class="stat-cards" id="stat-cards" aria-label="Monthly summary"></section>
      <section class="filter-bar" id="filter-bar" aria-label="Filter transactions"></section>
      <section class="transactions" id="transactions"></section>
    </div>
  `

  const statCardsEl = root.querySelector<HTMLElement>('#stat-cards')!
  const filterBarEl = root.querySelector<HTMLElement>('#filter-bar')!
  const transactionsEl = root.querySelector<HTMLElement>('#transactions')!

  new StatCards(statCardsEl, store)
  new FilterBar(filterBarEl, store)
  new TransactionsTable(transactionsEl, store)
}
