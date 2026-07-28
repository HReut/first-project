import { Store } from '../state/store.ts'
import type { AppState, View } from '../types.ts'
import { listCategories } from '../data/categoriesRepo.ts'
import { listTransactions } from '../data/transactionsRepo.ts'
import { listEmailRules } from '../data/emailRulesRepo.ts'
import { signOut } from '../lib/auth.ts'
import { effectiveTheme, toggleTheme } from '../lib/theme.ts'
import { mountAuthGate } from './AuthGate.ts'
import { catLogoMarkup } from './icons/CatLogo.ts'
import { chartIconMarkup, gearIconMarkup, homeIconMarkup, listIconMarkup } from './icons/NavIcons.ts'
import { moonIconMarkup, sunIconMarkup } from './icons/ThemeIcons.ts'
import { mountOverviewView } from './views/OverviewView.ts'
import { mountTransactionsView } from './views/TransactionsView.ts'
import { mountInsightsView } from './views/InsightsView.ts'
import { mountSettingsView } from './views/SettingsView.ts'

const VIEWS: { id: View; label: string; shortLabel: string; icon: () => string }[] = [
  { id: 'overview', label: 'Overview', shortLabel: 'Overview', icon: homeIconMarkup },
  { id: 'transactions', label: 'Transactions', shortLabel: 'Transactions', icon: listIconMarkup },
  { id: 'insights', label: 'Insights & Budgets', shortLabel: 'Insights', icon: chartIconMarkup },
  { id: 'settings', label: 'Settings & Automations', shortLabel: 'Settings', icon: gearIconMarkup },
]

function currentMonthKey(): string {
  return new Date().toISOString().slice(0, 7)
}

function viewFromHash(): View {
  const hash = location.hash.replace('#', '')
  return VIEWS.some((v) => v.id === hash) ? (hash as View) : 'overview'
}

/** Icon shows the mode a click switches *to* (moon while light, sun while dark). */
function themeToggleIcon(): string {
  return effectiveTheme() === 'dark' ? sunIconMarkup() : moonIconMarkup()
}

const SIDEBAR_COLLAPSED_KEY = 'opa-sidebar-collapsed'

function isSidebarCollapsed(): boolean {
  return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1'
}

export function mountApp(root: HTMLElement, userEmail: string | null = null): void {
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
    <div class="app-shell">
      <aside class="sidebar${isSidebarCollapsed() ? ' sidebar--collapsed' : ''}">
        <button type="button" class="sidebar-edge-toggle" id="sidebar-edge-toggle" aria-label="${isSidebarCollapsed() ? 'Expand sidebar' : 'Collapse sidebar'}">
          <span aria-hidden="true">${isSidebarCollapsed() ? '›' : '‹'}</span>
        </button>
        <div class="sidebar__brand">
          <span class="sidebar__mark" aria-hidden="true">${catLogoMarkup()}</span>
          <div class="sidebar__wordmark">
            <span class="sidebar__name">Opa!</span>
            <span class="sidebar__subtitle">Tulik Finance</span>
          </div>
        </div>
        <nav class="sidebar__nav" aria-label="Primary">
          ${VIEWS.map((v) => `<button type="button" class="sidebar__link" data-view="${v.id}">${v.icon()}<span>${v.label}</span></button>`).join('')}
        </nav>
        <div class="sidebar__footer">
          <button type="button" class="theme-toggle js-theme-toggle" aria-label="Switch color theme">
            <span class="theme-toggle__icon" aria-hidden="true">${themeToggleIcon()}</span>
            <span>Theme</span>
          </button>
          ${
            userEmail
              ? `<span class="sidebar__email">${userEmail}</span>
                 <button type="button" class="btn btn--sm js-sign-out">Sign out</button>`
              : ''
          }
        </div>
      </aside>
      <div class="main-col">
        <header class="topbar">
          <div class="topbar__inner">
            <div class="topbar__brand">
              <span class="topbar__mark" aria-hidden="true">${catLogoMarkup()}</span>
              <div class="topbar__wordmark">
                <span class="topbar__name">Opa! Tulik</span>
                <span class="topbar__subtitle">Smart Household Finance</span>
              </div>
            </div>
            <div class="topbar__account">
              <button type="button" class="theme-toggle js-theme-toggle" aria-label="Switch color theme">
                <span class="theme-toggle__icon" aria-hidden="true">${themeToggleIcon()}</span>
              </button>
              ${
                userEmail
                  ? `<span class="topbar__email">${userEmail}</span>
                     <button type="button" class="btn btn--sm js-sign-out">Sign out</button>`
                  : ''
              }
            </div>
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
      </div>
    </div>
    <nav class="bottom-nav" aria-label="Primary (mobile)">
      ${VIEWS.map((v) => `<button type="button" class="bottom-nav__link" data-view="${v.id}">${v.icon()}<span>${v.shortLabel}</span></button>`).join('')}
    </nav>
  `

  const loadingEl = root.querySelector<HTMLElement>('#view-loading')!
  const errorEl = root.querySelector<HTMLElement>('#view-error')!
  const viewEls: Record<View, HTMLElement> = {
    overview: root.querySelector<HTMLElement>('#view-overview')!,
    transactions: root.querySelector<HTMLElement>('#view-transactions')!,
    insights: root.querySelector<HTMLElement>('#view-insights')!,
    settings: root.querySelector<HTMLElement>('#view-settings')!,
  }
  const navButtons = Array.from(root.querySelectorAll<HTMLButtonElement>('.sidebar__link, .bottom-nav__link'))
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

  const sidebarEl = root.querySelector<HTMLElement>('.sidebar')!
  const edgeToggleBtn = root.querySelector<HTMLButtonElement>('#sidebar-edge-toggle')!
  edgeToggleBtn.addEventListener('click', () => {
    const collapsed = !sidebarEl.classList.contains('sidebar--collapsed')
    sidebarEl.classList.toggle('sidebar--collapsed', collapsed)
    edgeToggleBtn.querySelector('span')!.textContent = collapsed ? '›' : '‹'
    edgeToggleBtn.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar')
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0')
  })

  const themeToggleButtons = Array.from(root.querySelectorAll<HTMLButtonElement>('.js-theme-toggle'))
  themeToggleButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      toggleTheme()
      const icon = themeToggleIcon()
      themeToggleButtons.forEach((b) => {
        b.querySelector<HTMLElement>('.theme-toggle__icon')!.innerHTML = icon
      })
    })
  })

  root.querySelectorAll<HTMLButtonElement>('.js-sign-out').forEach((btn) => {
    btn.addEventListener('click', () => {
      signOut()
        .catch(() => {})
        .finally(() => mountAuthGate(root))
    })
  })

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
