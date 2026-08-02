import { Store } from '../state/store.ts'
import type { AppState, View } from '../types.ts'
import { listCategories } from '../data/categoriesRepo.ts'
import { listTransactions } from '../data/transactionsRepo.ts'
import { listEmailRules } from '../data/emailRulesRepo.ts'
import { listMappingRules } from '../data/mappingRulesRepo.ts'
import { personFromEmail, signOut } from '../lib/auth.ts'
import { effectiveTheme, toggleTheme } from '../lib/theme.ts'
import { mountAuthGate } from './AuthGate.ts'
import { catLogoMarkup } from './icons/CatLogo.ts'
import {
  bellIconMarkup,
  chartIconMarkup,
  coinsIconMarkup,
  gearIconMarkup,
  helpIconMarkup,
  homeIconMarkup,
  listIconMarkup,
  plusIconMarkup,
  refreshIconMarkup,
  searchIconMarkup,
  shieldCheckIconMarkup,
  targetIconMarkup,
  uploadIconMarkup,
  walletIconMarkup,
} from './icons/NavIcons.ts'
import { moonIconMarkup, sunIconMarkup } from './icons/ThemeIcons.ts'
import { mountOverviewView } from './views/OverviewView.ts'
import { mountTransactionsView } from './views/TransactionsView.ts'
import { mountBudgetsView } from './views/BudgetsView.ts'
import { mountAnalyticsView } from './views/AnalyticsView.ts'
import { mountSettingsView } from './views/SettingsView.ts'
import { mountPlaceholderView } from './views/PlaceholderView.ts'

interface NavEntry {
  id: View
  label: string
  shortLabel: string
  icon: () => string
}

const PRIMARY_VIEWS: NavEntry[] = [
  { id: 'overview', label: 'Overview', shortLabel: 'Overview', icon: homeIconMarkup },
  { id: 'transactions', label: 'Transactions', shortLabel: 'Transactions', icon: listIconMarkup },
  { id: 'budgets', label: 'Budgets', shortLabel: 'Budgets', icon: targetIconMarkup },
  { id: 'savings', label: 'Savings', shortLabel: 'Savings', icon: coinsIconMarkup },
  { id: 'analytics', label: 'Analytics', shortLabel: 'Analytics', icon: chartIconMarkup },
]

const MANAGEMENT_VIEWS: NavEntry[] = [
  { id: 'accounts', label: 'Accounts', shortLabel: 'Accounts', icon: walletIconMarkup },
  { id: 'security', label: 'Security', shortLabel: 'Security', icon: shieldCheckIconMarkup },
  { id: 'settings', label: 'Settings & Automations', shortLabel: 'Settings', icon: gearIconMarkup },
  { id: 'help', label: 'Help Center', shortLabel: 'Help', icon: helpIconMarkup },
]

const ALL_VIEWS = [...PRIMARY_VIEWS, ...MANAGEMENT_VIEWS]

function currentMonthKey(): string {
  return new Date().toISOString().slice(0, 7)
}

function viewFromHash(): View {
  const hash = location.hash.replace('#', '')
  return ALL_VIEWS.some((v) => v.id === hash) ? (hash as View) : 'overview'
}

/** Icon shows the mode a click switches *to* (moon while light, sun while dark). */
function themeToggleIcon(): string {
  return effectiveTheme() === 'dark' ? sunIconMarkup() : moonIconMarkup()
}

const SIDEBAR_COLLAPSED_KEY = 'opa-sidebar-collapsed'

function isSidebarCollapsed(): boolean {
  return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1'
}

function avatarInitial(userEmail: string | null): string {
  return (userEmail ?? '?').trim().charAt(0).toUpperCase() || '?'
}

export function mountApp(root: HTMLElement, userEmail: string | null = null): void {
  const currentPerson = personFromEmail(userEmail)

  const store = new Store<AppState>({
    view: viewFromHash(),
    status: 'loading',
    error: null,
    categories: [],
    transactions: [],
    emailRules: [],
    mappingRules: [],
    filters: {
      categoryId: 'all',
      person: 'all',
      period: { kind: 'month', month: currentMonthKey() },
      search: '',
    },
  })

  function loadHouseholdData(): Promise<void> {
    return Promise.all([listCategories(), listTransactions(), listEmailRules(), listMappingRules()])
      .then(([categories, transactions, emailRules, mappingRules]) => {
        store.setState({ categories, transactions, emailRules, mappingRules, status: 'ready' })
      })
      .catch((err: unknown) => {
        store.setState({ status: 'error', error: err instanceof Error ? err.message : 'Failed to load your household data.' })
      })
  }

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
        <div class="sidebar__actions">
          <button type="button" class="btn btn--primary btn--block" id="new-transaction-btn">${plusIconMarkup()}<span>New Transaction</span></button>
          <button type="button" class="btn btn--block" id="import-btn" title="CSV supported now — XLSX/PDF coming soon">${uploadIconMarkup()}<span>Import CSV/PDF</span></button>
        </div>
        <nav class="sidebar__nav" aria-label="Primary">
          ${PRIMARY_VIEWS.map((v) => `<button type="button" class="sidebar__link" data-view="${v.id}">${v.icon()}<span>${v.label}</span></button>`).join('')}
        </nav>
        <p class="sidebar__section-label">Management</p>
        <nav class="sidebar__nav" aria-label="Management">
          ${MANAGEMENT_VIEWS.map((v) => `<button type="button" class="sidebar__link" data-view="${v.id}">${v.icon()}<span>${v.label}</span></button>`).join('')}
        </nav>
        <div class="sidebar__footer">
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
        <header class="app-topbar">
          <label class="app-topbar__search">
            <span aria-hidden="true">${searchIconMarkup()}</span>
            <input type="search" id="global-search" placeholder="Search transactions, tags, or accounts…" aria-label="Search transactions, tags, or accounts">
          </label>
          <div class="app-topbar__meta">
            <span class="app-topbar__synced">Last synced: <span id="last-synced-label">just now</span></span>
            <button type="button" class="icon-btn" id="refresh-btn" aria-label="Refresh data">${refreshIconMarkup()}</button>
            <button type="button" class="icon-btn" id="notif-btn" aria-label="Notifications">${bellIconMarkup()}</button>
            <span class="app-topbar__avatar" aria-hidden="true">${avatarInitial(userEmail)}</span>
          </div>
        </header>
        <main id="main">
          <p class="view-loading" id="view-loading">Loading your household data…</p>
          <p class="view-error" id="view-error" hidden></p>
          <section id="view-overview" hidden></section>
          <section id="view-transactions" hidden></section>
          <section id="view-budgets" hidden></section>
          <section id="view-savings" hidden></section>
          <section id="view-analytics" hidden></section>
          <section id="view-accounts" hidden></section>
          <section id="view-security" hidden></section>
          <section id="view-settings" hidden></section>
          <section id="view-help" hidden></section>
        </main>
      </div>
    </div>
    <nav class="bottom-nav" aria-label="Primary (mobile)">
      ${PRIMARY_VIEWS.map((v) => `<button type="button" class="bottom-nav__link" data-view="${v.id}">${v.icon()}<span>${v.shortLabel}</span></button>`).join('')}
    </nav>
  `

  const loadingEl = root.querySelector<HTMLElement>('#view-loading')!
  const errorEl = root.querySelector<HTMLElement>('#view-error')!
  const viewEls: Record<View, HTMLElement> = {
    overview: root.querySelector<HTMLElement>('#view-overview')!,
    transactions: root.querySelector<HTMLElement>('#view-transactions')!,
    budgets: root.querySelector<HTMLElement>('#view-budgets')!,
    savings: root.querySelector<HTMLElement>('#view-savings')!,
    analytics: root.querySelector<HTMLElement>('#view-analytics')!,
    accounts: root.querySelector<HTMLElement>('#view-accounts')!,
    security: root.querySelector<HTMLElement>('#view-security')!,
    settings: root.querySelector<HTMLElement>('#view-settings')!,
    help: root.querySelector<HTMLElement>('#view-help')!,
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

  // Delegated (not per-button) so it also covers the Settings page's theme
  // toggle, which mounts into the DOM well after this listener is attached.
  root.addEventListener('click', (event) => {
    if (!(event.target as HTMLElement).closest('.js-theme-toggle')) return
    toggleTheme()
    const icon = themeToggleIcon()
    root.querySelectorAll<HTMLElement>('.theme-toggle__icon').forEach((el) => {
      el.innerHTML = icon
    })
  })

  root.querySelectorAll<HTMLButtonElement>('.js-sign-out').forEach((btn) => {
    btn.addEventListener('click', () => {
      signOut()
        .catch(() => {})
        .finally(() => mountAuthGate(root))
    })
  })

  root.querySelector<HTMLButtonElement>('#new-transaction-btn')!.addEventListener('click', () => {
    navigate('transactions')
    window.dispatchEvent(new CustomEvent('opa:new-transaction'))
  })

  root.querySelector<HTMLButtonElement>('#import-btn')!.addEventListener('click', () => {
    navigate('transactions')
    window.dispatchEvent(new CustomEvent('opa:import-transactions'))
  })

  const globalSearch = root.querySelector<HTMLInputElement>('#global-search')!
  globalSearch.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return
    const { filters } = store.getState()
    store.setState({ filters: { ...filters, search: globalSearch.value } })
    navigate('transactions')
  })

  const lastSyncedLabel = root.querySelector<HTMLElement>('#last-synced-label')!
  const refreshBtn = root.querySelector<HTMLButtonElement>('#refresh-btn')!
  refreshBtn.addEventListener('click', () => {
    refreshBtn.disabled = true
    loadHouseholdData().finally(() => {
      refreshBtn.disabled = false
      lastSyncedLabel.textContent = 'just now'
    })
  })

  store.subscribe((state) => {
    loadingEl.hidden = state.status !== 'loading'
    errorEl.hidden = state.status !== 'error'
    if (state.status === 'error') errorEl.textContent = state.error ?? 'Something went wrong loading your data.'

    if (state.status === 'ready' && !mounted) {
      mounted = true
      mountOverviewView(viewEls.overview, store)
      mountTransactionsView(viewEls.transactions, store, currentPerson)
      mountBudgetsView(viewEls.budgets, store)
      mountAnalyticsView(viewEls.analytics, store)
      mountSettingsView(viewEls.settings, store)
      mountPlaceholderView(viewEls.savings, {
        eyebrow: 'Household finance',
        title: 'Savings',
        subtitle: 'Track shared savings goals alongside your everyday budget.',
        icon: '🐷',
      })
      mountPlaceholderView(viewEls.accounts, {
        eyebrow: 'Management',
        title: 'Accounts',
        subtitle: 'Manage linked bank accounts, cards, and shared funds.',
        icon: '👛',
      })
      mountPlaceholderView(viewEls.security, {
        eyebrow: 'Management',
        title: 'Security',
        subtitle: 'Review sign-in activity and manage household access.',
        icon: '🛡️',
      })
      mountPlaceholderView(viewEls.help, {
        eyebrow: 'Management',
        title: 'Help Center',
        subtitle: 'Guides and answers for getting the most out of Opa! Tulik.',
        icon: '💬',
      })
    }

    applyViewVisibility(state)
  })

  applyViewVisibility(store.getState())

  loadHouseholdData()
}
