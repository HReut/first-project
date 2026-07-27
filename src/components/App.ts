import { Store } from '../state/store.ts'
import type { AppState, View } from '../types.ts'
import { listCategories } from '../data/categoriesRepo.ts'
import { listTransactions } from '../data/transactionsRepo.ts'
import { listEmailRules } from '../data/emailRulesRepo.ts'
import { catLogoMarkup } from './icons/CatLogo.ts'
import { mountOverviewView } from './views/OverviewView.ts'
import { mountTransactionsView } from './views/TransactionsView.ts'
import { mountInsightsView } from './views/InsightsView.ts'
import { mountSettingsView } from './views/SettingsView.ts'

const VIEWS: { id: View; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'transactions', label: 'Transactions' },
  { id: 'insights', label: 'Insights & Budgets' },
  { id: 'settings', label: 'Settings & Automations' },
]

function currentMonthKey(): string {
  return new Date().toISOString().slice(0, 7)
}

function viewFromHash(): View {
  const hash = location.hash.replace('#', '')
  return VIEWS.some((v) => v.id === hash) ? (hash as View) : 'overview'
}

export function mountApp(root: HTMLElement): void {
  const store = new Store<AppState>({
    view: viewFromHash(),
    status: 'loading',
    error: null,
    categories: [],
    transactions: [],
    emailRules: [],
    filters: {
      categoryId: 'all',
      person: 'all',
      period: { kind: 'month', month: currentMonthKey() },
      search: '',
    },
  })

  root.innerHTML = `
    <header class="topbar">
      <div class="topbar__inner">
        <div class="topbar__brand">
          <span class="topbar__mark" aria-hidden="true">${catLogoMarkup()}</span>
          <div class="topbar__wordmark">
            <span class="topbar__name">Opa! Tulik</span>
            <span class="topbar__subtitle">Smart Household Finance</span>
          </div>
        </div>
        <nav class="topbar__nav" aria-label="Primary">
          ${VIEWS.map((v) => `<button type="button" class="topbar__link" data-view="${v.id}">${v.label}</button>`).join('')}
        </nav>
      </div>
    </header>
    <main id="main">
      <p class="view-loading" id="view-loading">Loading your household data…</p>
      <p class="view-error" id="view-error" hidden></p>
      <section id="view-overview" hidden></section>
      <section id="view-transactions" hidden></section>
      <section id="view-insights" hidden></section>
      <section id="view-settings" hidden></section>
    </main>
  `

  const loadingEl = root.querySelector<HTMLElement>('#view-loading')!
  const errorEl = root.querySelector<HTMLElement>('#view-error')!
  const viewEls: Record<View, HTMLElement> = {
    overview: root.querySelector<HTMLElement>('#view-overview')!,
    transactions: root.querySelector<HTMLElement>('#view-transactions')!,
    insights: root.querySelector<HTMLElement>('#view-insights')!,
    settings: root.querySelector<HTMLElement>('#view-settings')!,
  }
  const navButtons = Array.from(root.querySelectorAll<HTMLButtonElement>('.topbar__link'))
  let mounted = false

  function applyViewVisibility(state: AppState): void {
    navButtons.forEach((btn) => btn.classList.toggle('is-active', btn.dataset.view === state.view))
    for (const id of Object.keys(viewEls) as View[]) {
      viewEls[id].hidden = state.status !== 'ready' || id !== state.view
    }
  }

  function navigate(view: View): void {
    if (location.hash.replace('#', '') !== view) location.hash = view
    store.setState({ view })
  }

  navButtons.forEach((btn) => {
    btn.addEventListener('click', () => navigate((btn.dataset.view as View) ?? 'overview'))
  })
  window.addEventListener('hashchange', () => store.setState({ view: viewFromHash() }))

  store.subscribe((state) => {
    loadingEl.hidden = state.status !== 'loading'
    errorEl.hidden = state.status !== 'error'
    if (state.status === 'error') errorEl.textContent = state.error ?? 'Something went wrong loading your data.'

    if (state.status === 'ready' && !mounted) {
      mounted = true
      mountOverviewView(viewEls.overview, store)
      mountTransactionsView(viewEls.transactions, store)
      mountInsightsView(viewEls.insights, store)
      mountSettingsView(viewEls.settings, store)
    }

    applyViewVisibility(state)
  })

  applyViewVisibility(store.getState())

  Promise.all([listCategories(), listTransactions(), listEmailRules()])
    .then(([categories, transactions, emailRules]) => {
      store.setState({ categories, transactions, emailRules, status: 'ready' })
    })
    .catch((err: unknown) => {
      store.setState({ status: 'error', error: err instanceof Error ? err.message : 'Failed to load your household data.' })
    })
}
