import { Store } from '../state/store.ts'
import type { AppState, View } from '../types.ts'
import { listCategories } from '../data/categoriesRepo.ts'
import { createTransactions, listTransactions } from '../data/transactionsRepo.ts'
import { listEmailRules } from '../data/emailRulesRepo.ts'
import { listMappingRules } from '../data/mappingRulesRepo.ts'
import { listRecurringRules, updateRecurringRule } from '../data/recurringRulesRepo.ts'
import { loadAccountBalance } from '../data/accountBalanceRepo.ts'
import { listBudgetLimitOverrides } from '../data/budgetLimitOverridesRepo.ts'
import { listActivityLog } from '../data/activityLogRepo.ts'
import { listSavingsGoals } from '../data/savingsGoalsRepo.ts'
import { findRulesDueForGeneration, transactionForDueRule } from '../utils/recurring.ts'
import { topBudgetedCategories } from '../utils/insights.ts'
import { budgetStatus } from '../utils/budget.ts'
import { formatCurrency } from '../utils/format.ts'
import { personFromEmail, signOut } from '../lib/auth.ts'
import { effectiveTheme, toggleTheme } from '../lib/theme.ts'
import { mountAuthGate } from './AuthGate.ts'
import { confirmDialog } from './shared/confirmDialog.ts'
import { catLogoMarkup } from './icons/CatLogo.ts'
import {
  bellIconMarkup,
  chartIconMarkup,
  coinsIconMarkup,
  gearIconMarkup,
  helpIconMarkup,
  historyIconMarkup,
  homeIconMarkup,
  listIconMarkup,
  plusIconMarkup,
  refreshIconMarkup,
  searchIconMarkup,
  targetIconMarkup,
  uploadIconMarkup,
} from './icons/NavIcons.ts'
import { moonIconMarkup, sunIconMarkup } from './icons/ThemeIcons.ts'
import { mountOverviewView } from './views/OverviewView.ts'
import { mountTransactionsView } from './views/TransactionsView.ts'
import { mountBudgetsView } from './views/BudgetsView.ts'
import { mountAnalyticsView } from './views/AnalyticsView.ts'
import { mountSettingsView } from './views/SettingsView.ts'
import { mountHistoryView } from './views/HistoryView.ts'
import { mountSavingsView } from './views/SavingsView.ts'
import { mountPlaceholderView } from './views/PlaceholderView.ts'

interface NavEntry {
  id: View
  label: string
  shortLabel: string
  icon: () => string
}

const PRIMARY_VIEWS: NavEntry[] = [
  { id: 'overview', label: 'סקירה כללית', shortLabel: 'סקירה', icon: homeIconMarkup },
  { id: 'transactions', label: 'תנועות', shortLabel: 'תנועות', icon: listIconMarkup },
  { id: 'budgets', label: 'תקציבים', shortLabel: 'תקציבים', icon: targetIconMarkup },
  { id: 'savings', label: 'חסכונות', shortLabel: 'חסכונות', icon: coinsIconMarkup },
  { id: 'analytics', label: 'אנליזות', shortLabel: 'אנליזות', icon: chartIconMarkup },
]

const MANAGEMENT_VIEWS: NavEntry[] = [
  { id: 'history', label: 'היסטוריה', shortLabel: 'היסטוריה', icon: historyIconMarkup },
  { id: 'settings', label: 'הגדרות ואוטומציות', shortLabel: 'הגדרות', icon: gearIconMarkup },
  { id: 'help', label: 'מרכז עזרה', shortLabel: 'עזרה', icon: helpIconMarkup },
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

interface NotificationItem {
  text: string
  view: View
}

/** What the bell actually has to say — pending reviews and categories over
 * budget this month. Deliberately just these two: both are things the app
 * already knows and tracks, so surfacing them here saves a trip to
 * Transactions/Budgets to notice, rather than inventing new signals. */
function computeNotifications(state: AppState): NotificationItem[] {
  const items: NotificationItem[] = []

  const pendingCount = state.transactions.filter((tx) => tx.status === 'pending').length
  if (pendingCount > 0) {
    items.push({ text: `${pendingCount} תנועות ממתינות לבדיקה`, view: 'transactions' })
  }

  for (const { category, spent, limit } of topBudgetedCategories(state.transactions, state.categories, state.budgetLimitOverrides)) {
    if (budgetStatus(spent, limit) === 'critical') {
      items.push({ text: `${category.icon} ${category.name} חרגה מהתקציב (${formatCurrency(spent)} מתוך ${formatCurrency(limit ?? 0)})`, view: 'budgets' })
    }
  }

  return items
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
    recurringRules: [],
    budgetLimitOverrides: [],
    accountBalance: null,
    activityLog: [],
    savingsGoals: [],
    filters: {
      categoryId: 'all',
      person: 'all',
      period: { kind: 'month', month: currentMonthKey() },
      search: '',
    },
  })

  function loadHouseholdData(): Promise<void> {
    return Promise.all([
      listCategories(),
      listTransactions(),
      listEmailRules(),
      listMappingRules(),
      listRecurringRules(),
      loadAccountBalance(),
      listBudgetLimitOverrides(),
      listActivityLog(),
      listSavingsGoals(),
    ])
      .then(([categories, transactions, emailRules, mappingRules, recurringRules, accountBalance, budgetLimitOverrides, activityLog, savingsGoals]) => {
        store.setState({
          categories,
          transactions,
          emailRules,
          mappingRules,
          recurringRules,
          accountBalance,
          budgetLimitOverrides,
          activityLog,
          savingsGoals,
          status: 'ready',
        })
        return generateDueRecurringTransactions()
      })
      .catch((err: unknown) => {
        store.setState({ status: 'error', error: err instanceof Error ? err.message : 'טעינת נתוני משק הבית נכשלה.' })
      })
  }

  /** Auto-creates this month's transaction for every active recurring rule
   * that's due and hasn't already generated one this month — runs once per
   * app load, right after household data is ready. New rows land 'pending'
   * so they go through the normal review flow, same as an import. */
  function generateDueRecurringTransactions(): Promise<void> {
    const monthKey = new Date().toISOString().slice(0, 7)
    const due = findRulesDueForGeneration(store.getState().recurringRules, monthKey)
    if (due.length === 0) return Promise.resolve()

    return Promise.all([
      createTransactions(due.map((rule) => transactionForDueRule(rule, monthKey))),
      Promise.all(due.map((rule) => updateRecurringRule(rule.id, { lastGeneratedMonth: monthKey, occurrencesGenerated: rule.occurrencesGenerated + 1 }))),
    ]).then(([created, updatedRules]) => {
      const updatedById = new Map(updatedRules.map((rule) => [rule.id, rule]))
      const state = store.getState()
      store.setState({
        transactions: [...created, ...state.transactions],
        recurringRules: state.recurringRules.map((rule) => updatedById.get(rule.id) ?? rule),
      })
    })
  }

  root.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar${isSidebarCollapsed() ? ' sidebar--collapsed' : ''}">
        <button type="button" class="sidebar-edge-toggle" id="sidebar-edge-toggle" aria-label="${isSidebarCollapsed() ? 'הרחבת סרגל הצד' : 'כיווץ סרגל הצד'}">
          <span aria-hidden="true">${isSidebarCollapsed() ? '‹' : '›'}</span>
        </button>
        <div class="sidebar__brand js-logo-home" role="button" tabindex="0" aria-label="מעבר לסקירה הכללית">
          <span class="sidebar__mark" aria-hidden="true">${catLogoMarkup()}</span>
          <div class="sidebar__wordmark">
            <span class="sidebar__name">Opa!</span>
            <span class="sidebar__subtitle">Tulik Finance</span>
          </div>
        </div>
        <div class="sidebar__actions">
          <button type="button" class="btn btn--primary btn--block" id="new-transaction-btn">${plusIconMarkup()}<span>תנועה חדשה</span></button>
          <button type="button" class="btn btn--block" id="import-btn" title="נתמכים קובצי CSV, אקסל (.xlsx) ודוחות עסקות PDF">${uploadIconMarkup()}<span>ייבוא CSV/XLSX/PDF</span></button>
        </div>
        <nav class="sidebar__nav" aria-label="ניווט ראשי">
          ${PRIMARY_VIEWS.map((v) => `<button type="button" class="sidebar__link" data-view="${v.id}">${v.icon()}<span>${v.label}</span></button>`).join('')}
        </nav>
        <p class="sidebar__section-label">ניהול</p>
        <nav class="sidebar__nav" aria-label="ניהול">
          ${MANAGEMENT_VIEWS.map((v) => `<button type="button" class="sidebar__link" data-view="${v.id}">${v.icon()}<span>${v.label}</span></button>`).join('')}
        </nav>
        <div class="sidebar__footer">
          ${
            userEmail
              ? `<span class="sidebar__email">${userEmail}</span>
                 <button type="button" class="btn btn--sm js-sign-out">התנתקות</button>`
              : ''
          }
        </div>
      </aside>
      <div class="main-col">
        <header class="topbar">
          <div class="topbar__inner">
            <div class="topbar__brand js-logo-home" role="button" tabindex="0" aria-label="מעבר לסקירה הכללית">
              <span class="topbar__mark" aria-hidden="true">${catLogoMarkup()}</span>
              <div class="topbar__wordmark">
                <span class="topbar__name">Opa! Tulik</span>
                <span class="topbar__subtitle">ניהול פיננסי חכם למשק הבית</span>
              </div>
            </div>
            <div class="topbar__account">
              <button type="button" class="theme-toggle js-theme-toggle" aria-label="החלפת ערכת נושא">
                <span class="theme-toggle__icon" aria-hidden="true">${themeToggleIcon()}</span>
              </button>
              ${
                userEmail
                  ? `<span class="topbar__email">${userEmail}</span>
                     <button type="button" class="btn btn--sm js-sign-out">התנתקות</button>`
                  : ''
              }
            </div>
          </div>
        </header>
        <header class="app-topbar">
          <label class="app-topbar__search">
            <span aria-hidden="true">${searchIconMarkup()}</span>
            <input type="search" id="global-search" placeholder="חיפוש תנועות, תגיות או חשבונות…" aria-label="חיפוש תנועות, תגיות או חשבונות">
          </label>
          <div class="app-topbar__meta">
            <span class="app-topbar__synced">עודכן לאחרונה: <span id="last-synced-label">הרגע</span></span>
            <button type="button" class="icon-btn" id="refresh-btn" aria-label="רענון נתונים">${refreshIconMarkup()}</button>
            <div class="notif-wrap">
              <button type="button" class="icon-btn" id="notif-btn" aria-label="התראות">
                ${bellIconMarkup()}
                <span class="notif-badge" id="notif-badge" hidden></span>
              </button>
              <div class="notif-panel" id="notif-panel" hidden>
                <p class="notif-panel__header">התראות</p>
                <div class="notif-panel__list" id="notif-list"></div>
              </div>
            </div>
            <span class="app-topbar__avatar" aria-hidden="true">${avatarInitial(userEmail)}</span>
          </div>
        </header>
        <main id="main">
          <p class="view-loading" id="view-loading">טוען את נתוני משק הבית…</p>
          <p class="view-error" id="view-error" hidden></p>
          <section id="view-overview" hidden></section>
          <section id="view-transactions" hidden></section>
          <section id="view-budgets" hidden></section>
          <section id="view-savings" hidden></section>
          <section id="view-analytics" hidden></section>
          <section id="view-history" hidden></section>
          <section id="view-settings" hidden></section>
          <section id="view-help" hidden></section>
        </main>
      </div>
    </div>
    <nav class="bottom-nav" aria-label="ניווט ראשי (נייד)">
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
    history: root.querySelector<HTMLElement>('#view-history')!,
    settings: root.querySelector<HTMLElement>('#view-settings')!,
    help: root.querySelector<HTMLElement>('#view-help')!,
  }
  const navButtons = Array.from(root.querySelectorAll<HTMLButtonElement>('.sidebar__link, .bottom-nav__link'))
  let mounted = false
  let settingsHasUnsavedChanges: (() => boolean) | null = null

  function applyViewVisibility(state: AppState): void {
    navButtons.forEach((btn) => btn.classList.toggle('is-active', btn.dataset.view === state.view))
    for (const id of Object.keys(viewEls) as View[]) {
      viewEls[id].hidden = state.status !== 'ready' || id !== state.view
    }
  }

  function goToView(view: View): void {
    if (location.hash.replace('#', '') !== view) location.hash = view
    store.setState({ view })
  }

  /** Warns before leaving Settings if there's typed-but-unsaved text (an
   * "add new" row that was never submitted) — everything else on Settings
   * auto-saves on blur, so it's already safe by the time a click navigates
   * away. Scoped to Settings only; other pages navigate immediately. */
  function navigate(view: View): void {
    if (store.getState().view === 'settings' && view !== 'settings' && settingsHasUnsavedChanges?.()) {
      confirmDialog('יש לך שינויים בהגדרות שעדיין לא נשמרו. לצאת בכל זאת?', 'צא').then((confirmed) => {
        if (confirmed) goToView(view)
      })
      return
    }
    goToView(view)
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
    edgeToggleBtn.querySelector('span')!.textContent = collapsed ? '‹' : '›'
    edgeToggleBtn.setAttribute('aria-label', collapsed ? 'הרחבת סרגל הצד' : 'כיווץ סרגל הצד')
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

  root.addEventListener('click', (event) => {
    if (!(event.target as HTMLElement).closest('.js-logo-home')) return
    navigate('overview')
  })
  root.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    if (!(event.target as HTMLElement).closest('.js-logo-home')) return
    event.preventDefault()
    navigate('overview')
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
      lastSyncedLabel.textContent = 'הרגע'
    })
  })

  // ---------- Notifications ----------

  const notifWrapEl = root.querySelector<HTMLElement>('.notif-wrap')!
  const notifBtn = root.querySelector<HTMLButtonElement>('#notif-btn')!
  const notifPanel = root.querySelector<HTMLElement>('#notif-panel')!
  const notifBadge = root.querySelector<HTMLElement>('#notif-badge')!
  const notifList = root.querySelector<HTMLElement>('#notif-list')!

  function renderNotifications(state: AppState): void {
    const items = computeNotifications(state)
    notifBadge.hidden = items.length === 0
    notifBadge.textContent = String(items.length)
    notifList.innerHTML =
      items.length === 0
        ? `<p class="notif-panel__empty">הכל מעודכן.</p>`
        : items.map((item, index) => `<button type="button" class="notif-item" data-notif-index="${index}">${item.text}</button>`).join('')
    notifList.dataset.views = JSON.stringify(items.map((item) => item.view))
  }

  notifBtn.addEventListener('click', () => {
    notifPanel.hidden = !notifPanel.hidden
  })
  notifList.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-notif-index]')
    if (!button) return
    const views = JSON.parse(notifList.dataset.views ?? '[]') as View[]
    const view = views[Number(button.dataset.notifIndex)]
    if (view) navigate(view)
    notifPanel.hidden = true
  })
  document.addEventListener('click', (event) => {
    if (!notifPanel.hidden && !notifWrapEl.contains(event.target as Node)) notifPanel.hidden = true
  })

  store.subscribe((state) => {
    loadingEl.hidden = state.status !== 'loading'
    errorEl.hidden = state.status !== 'error'
    if (state.status === 'error') errorEl.textContent = state.error ?? 'משהו השתבש בטעינת הנתונים.'

    if (state.status === 'ready' && !mounted) {
      mounted = true
      mountOverviewView(viewEls.overview, store, currentPerson)
      mountTransactionsView(viewEls.transactions, store, currentPerson)
      mountBudgetsView(viewEls.budgets, store, currentPerson)
      mountAnalyticsView(viewEls.analytics, store)
      settingsHasUnsavedChanges = mountSettingsView(viewEls.settings, store, currentPerson)
      mountHistoryView(viewEls.history, store)
      mountSavingsView(viewEls.savings, store, currentPerson)
      mountPlaceholderView(viewEls.help, {
        eyebrow: 'ניהול',
        title: 'מרכז עזרה',
        subtitle: 'מדריכים ותשובות שיעזרו לך להפיק את המרב מ-Opa! Tulik.',
        icon: '💬',
      })
    }

    applyViewVisibility(state)
    renderNotifications(state)
  })

  applyViewVisibility(store.getState())
  renderNotifications(store.getState())

  loadHouseholdData()
}
