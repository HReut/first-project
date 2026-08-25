import type { Store } from '../../state/store.ts'
import type { Account, AppState, NewRecurringRule, Person } from '../../types.ts'
import { createCategory, deleteCategory, updateCategory } from '../../data/categoriesRepo.ts'
import { createEmailRule, deleteEmailRule, updateEmailRule } from '../../data/emailRulesRepo.ts'
import { loadEmailAccountSettings, saveEmailAccountSettings, type EmailAccountSetting } from '../../data/emailAccountSettings.ts'
import { createRecurringRule, deleteRecurringRule, updateRecurringRule } from '../../data/recurringRulesRepo.ts'
import { ACCOUNT_LABEL } from '../shared/transactionCells.ts'
import { effectiveTheme } from '../../lib/theme.ts'
import { moonIconMarkup, sunIconMarkup } from '../icons/ThemeIcons.ts'

const PEOPLE: Person[] = ['Reut', 'Keren']
const ACCOUNT_VALUES: Account[] = ['shared', 'reut_personal', 'keren_personal']
/** A personal account locks the person, same rule as the transaction form. */
const PERSON_FOR_ACCOUNT: Partial<Record<Account, Person>> = { reut_personal: 'Reut', keren_personal: 'Keren' }
const CURRENT_MONTH = new Date().toISOString().slice(0, 7)

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

    <section class="band">
      <div class="band__inner">
        <section class="settings-card" aria-label="Recurring & installment expenses">
          <h2 class="settings-card__title">Recurring &amp; installment expenses</h2>
          <p class="settings-card__desc">
            Bills that repeat every N months (rent, internet, building committee…) — leave "Installments"
            blank for these, they run forever until you switch them off. For a card purchase split into
            fixed payments (e.g. a 12-payment furniture buy), set "Installments" to that count — it stops
            generating on its own once all payments are made. Either way, each due rule adds a Pending
            transaction automatically when the app loads.
          </p>
          <div class="settings-list settings-list--recurring" id="recurring-manager"></div>
        </section>
      </div>
    </section>
  `

  const categoryManagerEl = root.querySelector<HTMLElement>('#category-manager')!
  const emailAccountsEl = root.querySelector<HTMLElement>('#email-accounts')!
  const ruleBuilderEl = root.querySelector<HTMLElement>('#rule-builder')!
  const recurringManagerEl = root.querySelector<HTMLElement>('#recurring-manager')!

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
            <input type="number" class="budget-input" value="${category.monthlyBudgetLimit ?? ''}" placeholder="No limit" min="0" step="10" data-field="monthlyBudgetLimit" title="Monthly budget">
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
        <input type="number" class="budget-input" id="new-category-budget" placeholder="Budget (optional)" min="0" step="10">
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
    const patch =
      field === 'monthlyBudgetLimit'
        ? { monthlyBudgetLimit: input.value.trim() === '' ? null : Number(input.value) }
        : { [field]: input.value }
    updateCategory(id, patch).then((updated) => {
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
      const budgetInput = categoryManagerEl.querySelector<HTMLInputElement>('#new-category-budget')!
      const name = nameInput.value.trim()
      if (!name) return
      createCategory({
        name,
        colorCode: colorInput.value,
        icon: iconInput.value.trim() || '🏷️',
        monthlyBudgetLimit: budgetInput.value.trim() === '' ? null : Number(budgetInput.value),
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

  // ---------- Recurring expenses ----------

  function renderRecurringManager(state: AppState): void {
    const categoryOptions = (selectedId: string) =>
      state.categories.map((c) => `<option value="${c.id}" ${c.id === selectedId ? 'selected' : ''}>${c.icon} ${c.name}</option>`).join('')
    const accountOptions = (selected: Account) => ACCOUNT_VALUES.map((a) => `<option value="${a}" ${a === selected ? 'selected' : ''}>${ACCOUNT_LABEL[a]}</option>`).join('')

    const statusText = (rule: (typeof state.recurringRules)[number]): string => {
      if (rule.totalOccurrences !== null) return `${rule.occurrencesGenerated} of ${rule.totalOccurrences} paid`
      return rule.lastGeneratedMonth === CURRENT_MONTH ? 'Generated this month' : 'Not yet generated this month'
    }

    recurringManagerEl.innerHTML = `
      ${state.recurringRules
        .map(
          (rule) => `
        <div class="settings-list__row" data-id="${rule.id}">
          <input type="text" class="name-input" value="${rule.merchant}" placeholder="Bill name" data-rule-field="merchant">
          <input type="number" class="budget-input" value="${rule.amount}" min="0" step="1" title="Amount" data-rule-field="amount">
          <select class="filter-select" data-rule-field="categoryId">${categoryOptions(rule.categoryId)}</select>
          <select class="filter-select" data-rule-field="account">${accountOptions(rule.account)}</select>
          <span class="settings-list__inline-field">
            <span>Every</span>
            <input type="number" class="icon-input" value="${rule.intervalMonths}" min="1" max="24" title="Every N months" data-rule-field="intervalMonths">
            <span>mo · day</span>
            <input type="number" class="icon-input" value="${rule.dayOfMonth}" min="1" max="28" title="Day of month" data-rule-field="dayOfMonth">
          </span>
          <span class="settings-list__inline-field">
            <span>Installments</span>
            <input type="number" class="icon-input" value="${rule.totalOccurrences ?? ''}" min="1" max="60" placeholder="∞" title="Blank = ongoing bill; a number = installment plan that stops after that many payments" data-rule-field="totalOccurrences">
          </span>
          <span class="settings-list__usage">${statusText(rule)}</span>
          <label class="toggle">
            <input type="checkbox" data-rule-field="isActive" ${rule.isActive ? 'checked' : ''}>
            <span class="toggle__track"><span class="toggle__thumb"></span></span>
            <span class="toggle__label">Active</span>
          </label>
          <button type="button" class="btn btn--sm btn--danger" data-delete-recurring="${rule.id}">Delete</button>
        </div>
      `,
        )
        .join('')}
      <div class="settings-list__row settings-list__row--add">
        <input type="text" class="name-input" id="new-recurring-merchant" placeholder="Bill name (e.g. Rent, or Sofa)">
        <input type="number" class="budget-input" id="new-recurring-amount" placeholder="Amount per payment" min="0" step="1">
        <select class="filter-select" id="new-recurring-category">${categoryOptions('')}</select>
        <select class="filter-select" id="new-recurring-account">${accountOptions('shared')}</select>
        <span class="settings-list__inline-field">
          <span>Every</span>
          <input type="number" class="icon-input" id="new-recurring-interval" value="1" min="1" max="24" title="Every N months">
          <span>mo · day</span>
          <input type="number" class="icon-input" id="new-recurring-day" value="1" min="1" max="28" title="Day of month">
        </span>
        <span class="settings-list__inline-field">
          <span>Installments</span>
          <input type="number" class="icon-input" id="new-recurring-installments" min="1" max="60" placeholder="∞" title="Blank = ongoing bill; a number = installment plan that stops after that many payments">
        </span>
        <button type="button" class="btn btn--primary btn--sm" id="add-recurring-btn">+ Add</button>
      </div>
    `
  }

  recurringManagerEl.addEventListener('change', (event) => {
    const input = (event.target as HTMLElement).closest<HTMLElement>('[data-rule-field]') as HTMLInputElement | HTMLSelectElement | null
    if (!input) return
    const row = input.closest<HTMLElement>('.settings-list__row')!
    const id = row.dataset.id
    if (!id) return
    const field = input.dataset.ruleField as keyof NewRecurringRule
    const rule = store.getState().recurringRules.find((r) => r.id === id)
    if (!rule) return

    let patch: Partial<NewRecurringRule>
    if (field === 'isActive') patch = { isActive: (input as HTMLInputElement).checked }
    else if (field === 'totalOccurrences') patch = { totalOccurrences: input.value.trim() === '' ? null : Math.max(1, Number(input.value)) }
    else if (field === 'amount' || field === 'intervalMonths' || field === 'dayOfMonth') patch = { [field]: Number(input.value) }
    else if (field === 'account') {
      const account = input.value as Account
      patch = { account, person: PERSON_FOR_ACCOUNT[account] ?? rule.person }
    } else patch = { [field]: input.value }

    updateRecurringRule(id, patch).then((updated) => {
      const { recurringRules } = store.getState()
      store.setState({ recurringRules: recurringRules.map((r) => (r.id === updated.id ? updated : r)) })
    })
  })

  recurringManagerEl.addEventListener('click', (event) => {
    const deleteBtn = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-delete-recurring]')
    if (deleteBtn) {
      const id = deleteBtn.dataset.deleteRecurring!
      deleteRecurringRule(id).then(() => {
        const { recurringRules } = store.getState()
        store.setState({ recurringRules: recurringRules.filter((r) => r.id !== id) })
      })
      return
    }

    if ((event.target as HTMLElement).id === 'add-recurring-btn') {
      const merchantInput = recurringManagerEl.querySelector<HTMLInputElement>('#new-recurring-merchant')!
      const amountInput = recurringManagerEl.querySelector<HTMLInputElement>('#new-recurring-amount')!
      const categorySelect = recurringManagerEl.querySelector<HTMLSelectElement>('#new-recurring-category')!
      const accountSelect = recurringManagerEl.querySelector<HTMLSelectElement>('#new-recurring-account')!
      const intervalInput = recurringManagerEl.querySelector<HTMLInputElement>('#new-recurring-interval')!
      const dayInput = recurringManagerEl.querySelector<HTMLInputElement>('#new-recurring-day')!
      const installmentsInput = recurringManagerEl.querySelector<HTMLInputElement>('#new-recurring-installments')!

      const merchant = merchantInput.value.trim()
      const amount = Number(amountInput.value)
      if (!merchant || !Number.isFinite(amount) || amount <= 0 || !categorySelect.value) return
      const account = accountSelect.value as Account

      createRecurringRule({
        merchant,
        amount,
        categoryId: categorySelect.value,
        account,
        person: PERSON_FOR_ACCOUNT[account] ?? 'Reut',
        intervalMonths: Math.max(1, Number(intervalInput.value) || 1),
        anchorMonth: CURRENT_MONTH,
        dayOfMonth: Math.min(28, Math.max(1, Number(dayInput.value) || 1)),
        totalOccurrences: installmentsInput.value.trim() === '' ? null : Math.max(1, Number(installmentsInput.value)),
        isActive: true,
      }).then((created) => {
        const { recurringRules } = store.getState()
        store.setState({ recurringRules: [...recurringRules, created] })
      })
    }
  })

  store.subscribe((state) => {
    renderCategoryManager(state)
    renderRuleBuilder(state)
    renderRecurringManager(state)
  })

  renderCategoryManager(store.getState())
  renderEmailAccounts()
  renderRuleBuilder(store.getState())
  renderRecurringManager(store.getState())
}
