import type { Store } from '../../state/store.ts'
import type { AppState, CategoryDeletedBefore, Person } from '../../types.ts'
import { createCategory, deleteCategory, updateCategory } from '../../data/categoriesRepo.ts'
import { createEmailRule, deleteEmailRule, updateEmailRule } from '../../data/emailRulesRepo.ts'
import { loadEmailAccountSettings, saveEmailAccountSettings, type EmailAccountSetting } from '../../data/emailAccountSettings.ts'
import { setAccountBalance } from '../../data/accountBalanceRepo.ts'
import { setExchangeRate } from '../../data/exchangeRateRepo.ts'
import { logActivity } from '../../data/activityLogRepo.ts'
import { showToast } from '../shared/Toast.ts'
import { personLabel } from '../../utils/format.ts'
import { confirmDialog } from '../shared/confirmDialog.ts'
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

export function mountSettingsView(root: HTMLElement, store: Store<AppState>, currentPerson: Person): () => boolean {
  let accountSettings = loadEmailAccountSettings()
  // True while an existing category's color/icon/name has been typed/picked
  // but not yet blurred, OR while its save request is still in flight.
  // Clicking a nav button blurs the focused input (firing `change`) *before*
  // the button's own click event runs — so if we cleared this flag as soon
  // as `change` fires, it'd already be false by the time navigate() checks
  // it. Keeping it true until the request resolves is what actually makes
  // the warning appear on a real click-away.
  let categoryFieldsDirty = false
  let categorySavesInFlight = 0

  root.innerHTML = `
    <section class="band band--hero">
      <div class="band__inner">
        <p class="eyebrow">כספי משק הבית</p>
        <h1>הגדרות ואוטומציות.</h1>
        <p class="hero__subtitle">ניהול קטגוריות ואופן לכידת החשבוניות האוטומטית.</p>
      </div>
    </section>

    <section class="band">
      <div class="band__inner">
        <section class="settings-card" aria-label="מראה">
          <h2 class="settings-card__title">מראה</h2>
          <p class="settings-card__desc">מעבר בין מצב בהיר וכהה. זה חל על כל האפליקציה, במכשיר הזה.</p>
          <button type="button" class="theme-toggle js-theme-toggle" aria-label="החלפת ערכת נושא">
            <span class="theme-toggle__icon" aria-hidden="true">${themeToggleIcon()}</span>
            <span>ערכת נושא</span>
          </button>
        </section>
      </div>
    </section>

    <section class="band">
      <div class="band__inner">
        <section class="settings-card" aria-label="יתרת חשבון משותף">
          <h2 class="settings-card__title">יתרת חשבון משותף</h2>
          <p class="settings-card__desc">
            "סה"כ זמין" (בסקירה כללית ובתנועות) הוא היתרה הזו פחות הוצאות מהחשבון ה'משותף'
            שנרשמו מהתאריך שלמטה. עדכן/י בכל פעם שאת/ה בודק/ת את היתרה בבנק בפועל — כל שמירה
            מאפסת את נקודת ההתחלה להיום.
          </p>
          <div class="settings-list__row" id="account-balance-row">
            <input type="number" class="budget-input" id="account-balance-input" placeholder="יתרה נוכחית" min="0" step="1">
            <button type="button" class="btn btn--primary btn--sm" id="account-balance-save">שמירת יתרה</button>
            <span class="settings-list__usage" id="account-balance-status"></span>
          </div>
        </section>
      </div>
    </section>

    <section class="band">
      <div class="band__inner">
        <section class="settings-card" aria-label="שערי גיבוי">
          <h2 class="settings-card__title">שערי גיבוי (דולר / יורו)</h2>
          <p class="settings-card__desc">
            תנועה שנרשמת בדולרים או ביורו מומרת לשקלים לפי השער ההיסטורי האמיתי של אותו תאריך,
            שנשלף אוטומטית — השערים כאן משמשים רק כגיבוי, במקרים שבהם השליפה האוטומטית נכשלת
            (למשל אין חיבור לאינטרנט). עדכון שער כאן משפיע רק על תנועות חדשות שנשמרות בזמן תקלה.
          </p>
          <div class="settings-list__row" id="exchange-rate-row-usd">
            <input type="number" class="budget-input" id="exchange-rate-input-usd" placeholder="שער $ ל-₪" min="0" step="0.01">
            <button type="button" class="btn btn--primary btn--sm" id="exchange-rate-save-usd">שמירת שער $</button>
            <span class="settings-list__usage" id="exchange-rate-status-usd"></span>
          </div>
          <div class="settings-list__row" id="exchange-rate-row-eur">
            <input type="number" class="budget-input" id="exchange-rate-input-eur" placeholder="שער € ל-₪" min="0" step="0.01">
            <button type="button" class="btn btn--primary btn--sm" id="exchange-rate-save-eur">שמירת שער €</button>
            <span class="settings-list__usage" id="exchange-rate-status-eur"></span>
          </div>
        </section>
      </div>
    </section>

    <section class="band">
      <div class="band__inner">
        <section class="settings-card" aria-label="ניהול קטגוריות">
          <h2 class="settings-card__title">קטגוריות</h2>
          <p class="settings-card__desc">צבעים ואייקונים מתאימים אישית תגים, אריחים וגרפים בכל האפליקציה.</p>
          <div class="settings-list" id="category-manager"></div>
        </section>
      </div>
    </section>

    <section class="band">
      <div class="band__inner">
        <section class="settings-card settings-card--muted" aria-label="חשבונות אימייל מחוברים">
          <h2 class="settings-card__title">חשבונות אימייל <span class="soon-badge">בקרוב</span></h2>
          <p class="settings-card__desc">
            כתובת האימייל שיש לעקוב אחריה עבור כל אחד/ת, והאם הלכידה האוטומטית
            פעילה עבורה. זה רק מכין תשתית לאינטגרציית פענוח אימייל עתידית —
            עדיין אין חיבור לתיבת דואר, אז שום דבר כאן לא עושה כלום עד שיהיה.
          </p>
          <div class="settings-list" id="email-accounts"></div>
        </section>
      </div>
    </section>

    <section class="band">
      <div class="band__inner">
        <section class="settings-card settings-card--muted" aria-label="כללי סנכרון אימייל אוטומטי">
          <h2 class="settings-card__title">כללי לכידה אוטומטית <span class="soon-badge">בקרוב</span></h2>
          <p class="settings-card__desc">
            כשמגיעה חשבונית משולח/מילת מפתח תואמים, היא תתמלא מראש בברירות המחדל האלה ותיכנס
            למרכז הבדיקה — ברגע שלכידת אימייל אוטומטית (למעלה) תהיה מחוברת בפועל. כרגע
            הכללים נשמרים אך שום דבר לא מפעיל אותם.
          </p>
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
    accountBalanceStatusEl.textContent = balance ? `נכון ל-${formatDateShort(balance.setAt)} — כרגע ${formatCurrency(balance.startingBalance)}` : 'עדיין לא הוגדר'
  }

  root.querySelector<HTMLButtonElement>('#account-balance-save')!.addEventListener('click', () => {
    const raw = accountBalanceInput.value.trim()
    const startingBalance = Number(raw)
    if (!raw || !Number.isFinite(startingBalance) || startingBalance < 0) {
      showToast('הזן/י יתרה תקינה תחילה.')
      return
    }
    const today = new Date().toISOString().slice(0, 10)
    setAccountBalance({ startingBalance, setAt: today })
      .then((accountBalance) => {
        store.setState({ accountBalance })
        showToast('היתרה נשמרה.', [], 2500)
        logActivity({
          entityType: 'account_balance',
          action: 'changed',
          summary: `יתרת החשבון המשותף הוגדרה ל${formatCurrency(startingBalance)}`,
          beforeData: null,
          performedBy: currentPerson,
        })
          .then((entry) => {
            const { activityLog } = store.getState()
            store.setState({ activityLog: [entry, ...activityLog] })
          })
          .catch((err: unknown) => console.warn('Could not write to History — has migration 0009 been run?', err))
      })
      .catch(() => {
        showToast('לא ניתן היה לשמור — האם הרצת את מיגרציה 0007?')
      })
  })

  // ---------- Exchange rates (USD + EUR) ----------

  const exchangeRateInputUsd = root.querySelector<HTMLInputElement>('#exchange-rate-input-usd')!
  const exchangeRateStatusUsdEl = root.querySelector<HTMLElement>('#exchange-rate-status-usd')!
  const exchangeRateInputEur = root.querySelector<HTMLInputElement>('#exchange-rate-input-eur')!
  const exchangeRateStatusEurEl = root.querySelector<HTMLElement>('#exchange-rate-status-eur')!

  function renderExchangeRate(state: AppState): void {
    const rate = state.exchangeRate
    if (document.activeElement !== exchangeRateInputUsd) {
      exchangeRateInputUsd.value = rate?.usdToIls ? String(rate.usdToIls) : ''
    }
    exchangeRateStatusUsdEl.textContent =
      rate?.usdToIls ? `נכון ל-${formatDateShort(rate.setAt)} — כרגע $1 = ${formatCurrency(rate.usdToIls)}` : 'עדיין לא הוגדר — תנועות בדולר יומרו 1:1 עד שיוגדר'

    if (document.activeElement !== exchangeRateInputEur) {
      exchangeRateInputEur.value = rate?.eurToIls ? String(rate.eurToIls) : ''
    }
    exchangeRateStatusEurEl.textContent =
      rate?.eurToIls ? `נכון ל-${formatDateShort(rate.setAt)} — כרגע €1 = ${formatCurrency(rate.eurToIls)}` : 'עדיין לא הוגדר — תנועות ביורו יומרו 1:1 עד שיוגדר'
  }

  /** Saving one currency's rate carries the other currency's current value
   * forward unchanged — see setExchangeRate()'s doc comment for why. */
  function saveExchangeRate(currency: 'usd' | 'eur', input: HTMLInputElement): void {
    const raw = input.value.trim()
    const value = Number(raw)
    if (!raw || !Number.isFinite(value) || value <= 0) {
      showToast('הזן/י שער תקין תחילה.')
      return
    }
    const today = new Date().toISOString().slice(0, 10)
    const current = store.getState().exchangeRate
    const next = currency === 'usd' ? { usdToIls: value, eurToIls: current?.eurToIls ?? null } : { usdToIls: current?.usdToIls ?? null, eurToIls: value }
    setExchangeRate({ ...next, setAt: today })
      .then((exchangeRate) => {
        store.setState({ exchangeRate })
        showToast('השער נשמר.', [], 2500)
      })
      .catch(() => {
        showToast('לא ניתן היה לשמור — האם הרצת את מיגרציה 0012?')
      })
  }

  root.querySelector<HTMLButtonElement>('#exchange-rate-save-usd')!.addEventListener('click', () => saveExchangeRate('usd', exchangeRateInputUsd))
  root.querySelector<HTMLButtonElement>('#exchange-rate-save-eur')!.addEventListener('click', () => saveExchangeRate('eur', exchangeRateInputEur))

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
            <input type="color" class="color-input" value="${category.colorCode}" data-field="colorCode" title="צבע">
            <input type="text" class="icon-input" value="${category.icon}" data-field="icon" maxlength="4" title="אייקון">
            <input type="text" class="name-input" value="${category.name}" data-field="name" title="שם">
            <span class="settings-list__usage">${usage} תנועות</span>
            <button type="button" class="btn btn--sm btn--danger" data-delete-category="${category.id}" ${usage > 0 ? 'disabled title="יש לשייך את התנועות שלה קודם"' : ''}>מחיקה</button>
          </div>
        `
        })
        .join('')}
      <div class="settings-list__row settings-list__row--add">
        <input type="color" class="color-input" id="new-category-color" value="#2a78d6">
        <input type="text" class="icon-input" id="new-category-icon" placeholder="🏷️" maxlength="4">
        <input type="text" class="name-input" id="new-category-name" placeholder="שם קטגוריה חדשה">
        <button type="button" class="btn btn--primary btn--sm" id="add-category-btn">+ הוספה</button>
      </div>
    `
  }

  /** Fire-and-forget, same reasoning as TransactionsView's logTx: a logging
   * failure shouldn't block the real action, but shouldn't be silent either. */
  function logCategory(action: 'created' | 'updated' | 'deleted', summary: string, beforeData: unknown = null): void {
    logActivity({ entityType: 'category', action, summary, beforeData, performedBy: currentPerson })
      .then((entry) => {
        const { activityLog } = store.getState()
        store.setState({ activityLog: [entry, ...activityLog] })
      })
      .catch((err: unknown) => console.warn('Could not write to History — has migration 0009 been run?', err))
  }

  categoryManagerEl.addEventListener('input', (event) => {
    if ((event.target as HTMLElement).closest<HTMLInputElement>('[data-field]')) categoryFieldsDirty = true
  })

  categoryManagerEl.addEventListener('change', (event) => {
    const input = (event.target as HTMLElement).closest<HTMLInputElement>('[data-field]')
    if (!input) return
    const row = input.closest<HTMLElement>('.settings-list__row')!
    const id = row.dataset.id!
    const field = input.dataset.field!
    categoryFieldsDirty = false
    categorySavesInFlight++
    updateCategory(id, { [field]: input.value })
      .then((updated) => {
        const { categories } = store.getState()
        store.setState({ categories: categories.map((c) => (c.id === updated.id ? updated : c)) })
        logCategory('updated', `קטגוריה עודכנה: ${updated.name} (${field})`)
      })
      .catch(() => showToast('לא ניתן היה לשמור את שינוי הקטגוריה — נסה/י שוב.'))
      .finally(() => categorySavesInFlight--)
  })

  categoryManagerEl.addEventListener('click', (event) => {
    const deleteBtn = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-delete-category]')
    if (deleteBtn && !deleteBtn.disabled) {
      const id = deleteBtn.dataset.deleteCategory!
      const state = store.getState()
      const category = state.categories.find((c) => c.id === id)
      if (!category) return
      const overrides = state.budgetLimitOverrides.filter((o) => o.categoryId === id)

      confirmDialog(`למחוק את הקטגוריה "${category.name}"? ניתן לבטל זאת מההיסטוריה.`, 'מחיקה').then((confirmed) => {
        if (!confirmed) return
        deleteCategory(id).then(() => {
          const { categories, budgetLimitOverrides } = store.getState()
          store.setState({
            categories: categories.filter((c) => c.id !== id),
            budgetLimitOverrides: budgetLimitOverrides.filter((o) => o.categoryId !== id),
          })
          const before: CategoryDeletedBefore = { category, overrides }
          logCategory('deleted', `קטגוריה נמחקה: ${category.name}`, before)
        })
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
        logCategory('created', `קטגוריה נוספה: ${created.name}`)
      })
    }
  })

  // ---------- Email accounts (local-only gate) ----------

  function renderEmailAccounts(): void {
    emailAccountsEl.innerHTML = PEOPLE.map((person) => {
      const setting = accountSettings[person]
      return `
        <div class="settings-list__row" data-person="${person}">
          <span class="settings-list__person">${personLabel(person)}</span>
          <input type="email" class="name-input" placeholder="${person.toLowerCase()}@example.com" value="${setting.email}" data-account-field="email">
          <label class="toggle">
            <input type="checkbox" data-account-field="autoCaptureEnabled" ${setting.autoCaptureEnabled ? 'checked' : ''}>
            <span class="toggle__track"><span class="toggle__thumb"></span></span>
            <span class="toggle__label">לכידה אוטומטית</span>
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
        .join('') || `<option value="">עדיין לא הוגדרו חשבונות</option>`

    ruleBuilderEl.innerHTML = `
      ${state.emailRules
        .map(
          (rule) => `
        <div class="settings-list__row" data-id="${rule.id}">
          <select class="filter-select" data-rule-field="targetEmail">${emailOptions(rule.targetEmail)}</select>
          <input type="text" class="name-input" value="${rule.merchantKeyword}" placeholder="מילת מפתח לבית עסק" data-rule-field="merchantKeyword">
          <select class="filter-select" data-rule-field="defaultCategoryId">${categoryOptions(rule.defaultCategoryId)}</select>
          <select class="filter-select" data-rule-field="defaultPerson">
            ${PEOPLE.map((p) => `<option value="${p}" ${p === rule.defaultPerson ? 'selected' : ''}>${personLabel(p)}</option>`).join('')}
          </select>
          <label class="toggle">
            <input type="checkbox" data-rule-field="isActive" ${rule.isActive ? 'checked' : ''}>
            <span class="toggle__track"><span class="toggle__thumb"></span></span>
            <span class="toggle__label">פעיל</span>
          </label>
          <button type="button" class="btn btn--sm btn--danger" data-delete-rule="${rule.id}">מחיקה</button>
        </div>
      `,
        )
        .join('')}
      <div class="settings-list__row settings-list__row--add">
        <select class="filter-select" id="new-rule-email">${emailOptions('')}</select>
        <input type="text" class="name-input" id="new-rule-keyword" placeholder="מילת מפתח לבית עסק">
        <select class="filter-select" id="new-rule-category">${categoryOptions('')}</select>
        <select class="filter-select" id="new-rule-person">${PEOPLE.map((p) => `<option value="${p}">${personLabel(p)}</option>`).join('')}</select>
        <button type="button" class="btn btn--primary btn--sm" id="add-rule-btn">+ הוספת כלל</button>
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
      confirmDialog('למחוק את כלל הלכידה האוטומטית הזה?', 'מחיקה').then((confirmed) => {
        if (!confirmed) return
        deleteEmailRule(id).then(() => {
          const { emailRules } = store.getState()
          store.setState({ emailRules: emailRules.filter((r) => r.id !== id) })
        })
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
    renderExchangeRate(state)
    renderCategoryManager(state)
    renderRuleBuilder(state)
  })

  renderAccountBalance(store.getState())
  renderExchangeRate(store.getState())
  renderCategoryManager(store.getState())
  renderEmailAccounts()
  renderRuleBuilder(store.getState())

  /** Typed-but-not-yet-committed edits: the "add new" rows only save on an
   * explicit button click, and existing category fields only save on blur —
   * both leave a window where a nav click would otherwise discard input
   * silently. Checked by App.ts before letting a sidebar/logo click navigate
   * away. */
  return function hasUnsavedChanges(): boolean {
    const newCategoryName = root.querySelector<HTMLInputElement>('#new-category-name')?.value.trim()
    const newRuleKeyword = root.querySelector<HTMLInputElement>('#new-rule-keyword')?.value.trim()
    const balanceInput = root.querySelector<HTMLInputElement>('#account-balance-input')
    const savedBalance = store.getState().accountBalance
    const balanceChanged = !!balanceInput && balanceInput.value.trim() !== (savedBalance ? String(savedBalance.startingBalance) : '')
    const savedRate = store.getState().exchangeRate
    const rateInputUsd = root.querySelector<HTMLInputElement>('#exchange-rate-input-usd')
    const rateUsdChanged = !!rateInputUsd && rateInputUsd.value.trim() !== (savedRate?.usdToIls ? String(savedRate.usdToIls) : '')
    const rateInputEur = root.querySelector<HTMLInputElement>('#exchange-rate-input-eur')
    const rateEurChanged = !!rateInputEur && rateInputEur.value.trim() !== (savedRate?.eurToIls ? String(savedRate.eurToIls) : '')
    return !!newCategoryName || !!newRuleKeyword || balanceChanged || rateUsdChanged || rateEurChanged || categoryFieldsDirty || categorySavesInFlight > 0
  }
}
