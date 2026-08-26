import type { Store } from '../../state/store.ts'
import type { AppState, Person } from '../../types.ts'
import { createCategory, deleteCategory, updateCategory } from '../../data/categoriesRepo.ts'
import { createEmailRule, deleteEmailRule, updateEmailRule } from '../../data/emailRulesRepo.ts'
import { loadEmailAccountSettings, saveEmailAccountSettings, type EmailAccountSetting } from '../../data/emailAccountSettings.ts'
import { setAccountBalance } from '../../data/accountBalanceRepo.ts'
import { showToast } from '../shared/Toast.ts'
import { formatCurrency, formatDateShort } from '../../utils/format.ts'
import { effectiveTheme } from '../../lib/theme.ts'
import { moonIconMarkup, sunIconMarkup } from '../icons/ThemeIcons.ts'

const PEOPLE: Person[] = ['Reut', 'Keren']

/** Icon shows the mode a click switches *to* (moon while light, sun while
 * dark) — the actual toggle+icon-sync is wired centrally in App.ts via a
 * delegated `.js-theme-toggle` click listener, so this button just needs to
 * render with the right class and starting icon. */
function themeToggleIcon(): string {
  return effectiveTheme() === 'dark' ? sunIconMarkup() : moonIconMarkup()
}

export function mountSettingsView(root: HTMLElement, store: Store<AppState>): void {
  let accountSettings = loadEmailAccountSettings()

  root.innerHTML = `
    <section class="band band--hero">
      <div class="band__inner">
        <p class="eyebrow">Household finance</p>
        <h1>Settings &amp; Automations.</h1>
        <p class="hero__subtitle">Manage categories and how invoices get auto-captured.</p>
      </div>
    </section>

    <section class="band">
      <div class="band__inner">
        <section class="settings-card" aria-label="Appearance">
          <h2 class="settings-card__title">Appearance</h2>
          <p class="settings-card__desc">Switch between light and dark mode. This applies everywhere in the app, on this device.</p>
          <button type="button" class="theme-toggle js-theme-toggle" aria-label="Switch color theme">
            <span class="theme-toggle__icon" aria-hidden="true">${themeToggleIcon()}</span>
            <span>Theme</span>
          </button>
        </section>
      </div>
    </section>

    <section class="band">
      <div class="band__inner">
        <section class="settings-card" aria-label="Shared account balance">
          <h2 class="settings-card__title">Shared account balance</h2>
          <p class="settings-card__desc">
            "Total Available" (Overview and Transactions) is this balance minus 'Shared' account spending
            logged since the date below. Update it any time you check the real bank balance — each save
            resets the starting point to today.
          </p>
          <div class="settings-list__row" id="account-balance-row">
            <input type="number" class="budget-input" id="account-balance-input" placeholder="Current balance" min="0" step="1">
            <button type="button" class="btn btn--primary btn--sm" id="account-balance-save">Save balance</button>
            <span class="settings-list__usage" id="account-balance-status"></span>
          </div>
        </section>
      </div>
    </section>

    <section class="band">
      <div class="band__inner">
        <section class="settings-card" aria-label="Category manager">
          <h2 class="settings-card__title">Categories</h2>
          <p class="settings-card__desc">Colors and icons personalize badges, tiles, and charts across the app.</p>
          <div class="settings-list" id="category-manager"></div>
        </section>
      </div>
    </section>

    <section class="band">
      <div class="band__inner">
        <section class="settings-card" aria-label="Connected email accounts">
          <h2 class="settings-card__title">Email accounts</h2>
          <p class="settings-card__desc">
            The email address to watch for each person, and whether auto-capture is
            switched on for it. This only gates a future email-parsing integration —
            it doesn't connect to an inbox yet.
          </p>
          <div class="settings-list" id="email-accounts"></div>
        </section>
      </div>
    </section>

    <section class="band">
      <div class="band__inner">
        <section class="settings-card" aria-label="Email auto-sync rules">
          <h2 class="settings-card__title">Auto-capture rules</h2>
          <p class="settings-card__desc">When an invoice from a matching sender/keyword arrives, it's pre-filled with these defaults and dropped into the Review Center.</p>
          <div class="settings-list" id="rule-builder"></div>
        </section>
      </div>
    </section>
  `

  const categoryManagerEl = root.querySelector<HTMLElement>('#category-manager')!
  const emailAccountsEl = root.querySelector<HTMLElement>('#email-accounts')!
  const ruleBuilderEl = root.querySelector<HTMLElement>('#rule-builder')!

  // ---------- Shared account balance ----------

  const accountBalanceInput = root.querySelector<HTMLInputElement>('#account-balance-input')!
  const accountBalanceStatusEl = root.querySelector<HTMLElement>('#account-balance-status')!

  function renderAccountBalance(state: AppState): void {
    const balance = state.accountBalance
    if (document.activeElement !== accountBalanceInput) {
      accountBalanceInput.value = balance ? String(balance.startingBalance) : ''
    }
    accountBalanceStatusEl.textContent = balance ? `As of ${formatDateShort(balance.setAt)} — currently ${formatCurrency(balance.startingBalance)}` : 'Not set yet'
  }

  root.querySelector<HTMLButtonElement>('#account-balance-save')!.addEventListener('click', () => {
    const raw = accountBalanceInput.value.trim()
    const startingBalance = Number(raw)
    if (!raw || !Number.isFinite(startingBalance) || startingBalance < 0) {
      showToast('Enter a valid balance first.')
      return
    }
    const today = new Date().toISOString().slice(0, 10)
    setAccountBalance({ startingBalance, setAt: today })
      .then((accountBalance) => {
        store.setState({ accountBalance })
        showToast('Balance saved.', [], 2500)
      })
      .catch(() => {
        showToast('Could not save — has migration 0007 been run?')
      })
  })

  // ---------- Category manager ----------

  function renderCategoryManager(state: AppState): void {
    const usageCount = new Map<string, number>()
    for (const tx of state.transactions) usageCount.set(tx.categoryId, (usageCount.get(tx.categoryId) ?? 0) + 1)

    categoryManagerEl.innerHTML = `
      ${state.categories
        .map((category) => {
          const usage = usageCount.get(category.id) ?? 0
          return `
          <div class="settings-list__row" data-id="${category.id}">
            <input type="color" class="color-input" value="${category.colorCode}" data-field="colorCode" title="Color">
            <input type="text" class="icon-input" value="${category.icon}" data-field="icon" maxlength="4" title="Icon">
            <input type="text" class="name-input" value="${category.name}" data-field="name" title="Name">
            <span class="settings-list__usage">${usage} transaction${usage === 1 ? '' : 's'}</span>
            <button type="button" class="btn btn--sm btn--danger" data-delete-category="${category.id}" ${usage > 0 ? 'disabled title="Reassign its transactions first"' : ''}>Delete</button>
          </div>
        `
        })
        .join('')}
      <div class="settings-list__row settings-list__row--add">
        <input type="color" class="color-input" id="new-category-color" value="#2a78d6">
        <input type="text" class="icon-input" id="new-category-icon" placeholder="🏷️" maxlength="4">
        <input type="text" class="name-input" id="new-category-name" placeholder="New category name">
        <button type="button" class="btn btn--primary btn--sm" id="add-category-btn">+ Add</button>
      </div>
    `
  }

  categoryManagerEl.addEventListener('change', (event) => {
    const input = (event.target as HTMLElement).closest<HTMLInputElement>('[data-field]')
    if (!input) return
    const row = input.closest<HTMLElement>('.settings-list__row')!
    const id = row.dataset.id!
    const field = input.dataset.field!
    updateCategory(id, { [field]: input.value }).then((updated) => {
      const { categories } = store.getState()
      store.setState({ categories: categories.map((c) => (c.id === updated.id ? updated : c)) })
    })
  })

  categoryManagerEl.addEventListener('click', (event) => {
    const deleteBtn = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-delete-category]')
    if (deleteBtn && !deleteBtn.disabled) {
      const id = deleteBtn.dataset.deleteCategory!
      deleteCategory(id).then(() => {
        const { categories } = store.getState()
        store.setState({ categories: categories.filter((c) => c.id !== id) })
      })
      return
    }

    if ((event.target as HTMLElement).id === 'add-category-btn') {
      const nameInput = categoryManagerEl.querySelector<HTMLInputElement>('#new-category-name')!
      const colorInput = categoryManagerEl.querySelector<HTMLInputElement>('#new-category-color')!
      const iconInput = categoryManagerEl.querySelector<HTMLInputElement>('#new-category-icon')!
      const name = nameInput.value.trim()
      if (!name) return
      createCategory({
        name,
        colorCode: colorInput.value,
        icon: iconInput.value.trim() || '🏷️',
        monthlyBudgetLimit: null,
      }).then((created) => {
        const { categories } = store.getState()
        store.setState({ categories: [...categories, created] })
      })
    }
  })

  // ---------- Email accounts (local-only gate) ----------

  function renderEmailAccounts(): void {
    emailAccountsEl.innerHTML = PEOPLE.map((person) => {
      const setting = accountSettings[person]
      return `
        <div class="settings-list__row" data-person="${person}">
          <span class="settings-list__person">${person}</span>
          <input type="email" class="name-input" placeholder="${person.toLowerCase()}@example.com" value="${setting.email}" data-account-field="email">
          <label class="toggle">
            <input type="checkbox" data-account-field="autoCaptureEnabled" ${setting.autoCaptureEnabled ? 'checked' : ''}>
            <span class="toggle__track"><span class="toggle__thumb"></span></span>
            <span class="toggle__label">Auto-capture</span>
          </label>
        </div>
      `
    }).join('')
  }

  emailAccountsEl.addEventListener('change', (event) => {
    const input = (event.target as HTMLElement).closest<HTMLInputElement>('[data-account-field]')
    if (!input) return
    const row = input.closest<HTMLElement>('.settings-list__row')!
    const person = row.dataset.person as Person
    const field = input.dataset.accountField as keyof EmailAccountSetting
    const value = field === 'autoCaptureEnabled' ? input.checked : input.value.trim()
    accountSettings = { ...accountSettings, [person]: { ...accountSettings[person], [field]: value } }
    saveEmailAccountSettings(accountSettings)
    renderRuleBuilder(store.getState())
  })

  // ---------- Rule builder ----------

  function renderRuleBuilder(state: AppState): void {
    const categoryOptions = (selectedId: string) =>
      state.categories.map((c) => `<option value="${c.id}" ${c.id === selectedId ? 'selected' : ''}>${c.icon} ${c.name}</option>`).join('')
    const emailOptions = (selected: string) =>
      PEOPLE.map((p) => accountSettings[p].email)
        .filter((email) => email)
        .map((email) => `<option value="${email}" ${email === selected ? 'selected' : ''}>${email}</option>`)
        .join('') || `<option value="">No accounts configured yet</option>`

    ruleBuilderEl.innerHTML = `
      ${state.emailRules
        .map(
          (rule) => `
        <div class="settings-list__row" data-id="${rule.id}">
          <select class="filter-select" data-rule-field="targetEmail">${emailOptions(rule.targetEmail)}</select>
          <input type="text" class="name-input" value="${rule.merchantKeyword}" placeholder="Merchant keyword" data-rule-field="merchantKeyword">
          <select class="filter-select" data-rule-field="defaultCategoryId">${categoryOptions(rule.defaultCategoryId)}</select>
          <select class="filter-select" data-rule-field="defaultPerson">
            ${PEOPLE.map((p) => `<option value="${p}" ${p === rule.defaultPerson ? 'selected' : ''}>${p}</option>`).join('')}
          </select>
          <label class="toggle">
            <input type="checkbox" data-rule-field="isActive" ${rule.isActive ? 'checked' : ''}>
            <span class="toggle__track"><span class="toggle__thumb"></span></span>
            <span class="toggle__label">Active</span>
          </label>
          <button type="button" class="btn btn--sm btn--danger" data-delete-rule="${rule.id}">Delete</button>
        </div>
      `,
        )
        .join('')}
      <div class="settings-list__row settings-list__row--add">
        <select class="filter-select" id="new-rule-email">${emailOptions('')}</select>
        <input type="text" class="name-input" id="new-rule-keyword" placeholder="Merchant keyword">
        <select class="filter-select" id="new-rule-category">${categoryOptions('')}</select>
        <select class="filter-select" id="new-rule-person">${PEOPLE.map((p) => `<option value="${p}">${p}</option>`).join('')}</select>
        <button type="button" class="btn btn--primary btn--sm" id="add-rule-btn">+ Add rule</button>
      </div>
    `
  }

  ruleBuilderEl.addEventListener('change', (event) => {
    const input = (event.target as HTMLElement).closest<HTMLElement>('[data-rule-field]') as HTMLInputElement | HTMLSelectElement | null
    if (!input) return
    const row = input.closest<HTMLElement>('.settings-list__row')!
    const id = row.dataset.id
    if (!id) return
    const field = input.dataset.ruleField!
    const value = input instanceof HTMLInputElement && input.type === 'checkbox' ? input.checked : input.value
    updateEmailRule(id, { [field]: value }).then((updated) => {
      const { emailRules } = store.getState()
      store.setState({ emailRules: emailRules.map((r) => (r.id === updated.id ? updated : r)) })
    })
  })

  ruleBuilderEl.addEventListener('click', (event) => {
    const deleteBtn = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-delete-rule]')
    if (deleteBtn) {
      const id = deleteBtn.dataset.deleteRule!
      deleteEmailRule(id).then(() => {
        const { emailRules } = store.getState()
        store.setState({ emailRules: emailRules.filter((r) => r.id !== id) })
      })
      return
    }

    if ((event.target as HTMLElement).id === 'add-rule-btn') {
      const emailSelect = ruleBuilderEl.querySelector<HTMLSelectElement>('#new-rule-email')!
      const keywordInput = ruleBuilderEl.querySelector<HTMLInputElement>('#new-rule-keyword')!
      const categorySelect = ruleBuilderEl.querySelector<HTMLSelectElement>('#new-rule-category')!
      const personSelect = ruleBuilderEl.querySelector<HTMLSelectElement>('#new-rule-person')!
      const keyword = keywordInput.value.trim()
      if (!keyword || !emailSelect.value || !categorySelect.value) return
      createEmailRule({
        targetEmail: emailSelect.value,
        merchantKeyword: keyword,
        defaultCategoryId: categorySelect.value,
        defaultPerson: personSelect.value as Person,
        isActive: true,
      }).then((created) => {
        const { emailRules } = store.getState()
        store.setState({ emailRules: [...emailRules, created] })
      })
    }
  })

  store.subscribe((state) => {
    renderAccountBalance(state)
    renderCategoryManager(state)
    renderRuleBuilder(state)
  })

  renderAccountBalance(store.getState())
  renderCategoryManager(store.getState())
  renderEmailAccounts()
  renderRuleBuilder(store.getState())
}
