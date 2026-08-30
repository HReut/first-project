import type { Store } from '../../state/store.ts'
import type { AppState, Category, NewTransaction, Person } from '../../types.ts'
import { buildImportPreview, buildImportPreviewFromTable, commitImportedRows, parseXlsx, type ParsedImportRow } from '../../data/importService.ts'
import { listMappingRules, normalizeMerchantKey, upsertMappingRule } from '../../data/mappingRulesRepo.ts'
import { createCategory } from '../../data/categoriesRepo.ts'
import { computeReviewedStatus } from '../../utils/insights.ts'
import { Modal } from '../shared/Modal.ts'
import { showToast } from '../shared/Toast.ts'
import { formatCurrency, personLabel } from '../../utils/format.ts'

const PEOPLE: Person[] = ['Reut', 'Keren']
/** Must match the category's `name` in the database exactly (see the
 * category-rename SQL run alongside the Hebrew localization) — this is how
 * an existing "Uncategorized" row is found instead of creating a duplicate. */
const UNCATEGORIZED_NAME = 'ללא קטגוריה'

let fileInput: HTMLInputElement | null = null

function getFileInput(onFile: (file: File) => void): HTMLInputElement {
  if (!fileInput) {
    fileInput = document.createElement('input')
    fileInput.type = 'file'
    fileInput.accept = '.csv,.xlsx,.xls,.pdf'
    fileInput.hidden = true
    document.body.appendChild(fileInput)
  }
  fileInput.onchange = () => {
    const file = fileInput!.files?.[0]
    fileInput!.value = '' // allow re-selecting the same file next time
    if (file) onFile(file)
  }
  return fileInput
}

/** Entry point wired to the sidebar's "Import CSV/XLSX/PDF" button (via the
 * opa:import-transactions event). PDF support is a heuristic parser tuned
 * to Israeli credit-card statement layouts (see pdfImportService.ts) — it's
 * a best-effort first pass, not a guaranteed-correct extraction, which is
 * why it (like every import source) always lands on the reviewable preview
 * grid rather than writing straight to the database. */
export function openImportFlow(store: Store<AppState>, currentPerson: Person): void {
  const input = getFileInput((file) => {
    handleFile(file, store, currentPerson).catch(() => showToast('לא ניתן היה לקרוא את הקובץ.'))
  })
  input.click()
}

async function handleFile(file: File, store: Store<AppState>, currentPerson: Person): Promise<void> {
  const name = file.name.toLowerCase()
  const isCsv = name.endsWith('.csv')
  const isXlsx = name.endsWith('.xlsx') || name.endsWith('.xls')
  const isPdf = name.endsWith('.pdf')
  if (!isCsv && !isXlsx && !isPdf) {
    showToast('סוג קובץ לא נתמך — ניתן לייבא CSV, אקסל או PDF.')
    return
  }

  const state = store.getState()
  const mappingRules = await listMappingRules()
  let rows: ParsedImportRow[]
  let declaredTotal: number | null = null
  if (isCsv) {
    rows = buildImportPreview(await file.text(), state.categories, mappingRules, state.transactions)
  } else if (isXlsx) {
    rows = buildImportPreviewFromTable(await parseXlsx(file), state.categories, mappingRules, state.transactions)
  } else {
    // pdfjs-dist is ~850KB — split into its own chunk so it only loads for
    // people who actually import a PDF, not on every page visit.
    const { parseCreditCardStatementPdf } = await import('../../data/pdfImportService.ts')
    const parsed = await parseCreditCardStatementPdf(file, state.categories)
    declaredTotal = parsed.declaredTotal
    rows = buildImportPreviewFromTable(parsed.table, state.categories, mappingRules, state.transactions)
  }

  if (rows.length === 0) {
    showToast(isPdf ? 'לא זוהו תנועות בקובץ ה-PDF — ודא/י שזה דוח עסקות רגיל.' : 'לא נמצאו שורות נתונים בקובץ הזה.')
    return
  }

  openPreviewModal(rows, store, currentPerson, declaredTotal)
}

/** Finds (or lazily creates) the category imported rows fall back to when
 * nothing detects one — category_id is not null in the schema, so there
 * must be somewhere real to point at. Self-healing: works whether or not
 * the 0003 migration's seed insert has been run yet. */
async function ensureUncategorizedCategory(store: Store<AppState>): Promise<Category> {
  const existing = store.getState().categories.find((c) => c.name.toLowerCase() === UNCATEGORIZED_NAME.toLowerCase())
  if (existing) return existing

  const created = await createCategory({ name: UNCATEGORIZED_NAME, colorCode: '#9ca3af', icon: '❔', monthlyBudgetLimit: null })
  store.setState({ categories: [...store.getState().categories, created] })
  return created
}

function openPreviewModal(rows: ParsedImportRow[], store: Store<AppState>, currentPerson: Person, declaredTotal: number | null): void {
  const { categories } = store.getState()
  const duplicateCount = rows.filter((row) => row.isPossibleDuplicate).length

  // Cross-checks the parser's own work against the statement's stated
  // total, when one was found — a wrong/missing row is far easier to catch
  // as "these two numbers don't match" than by eyeballing dozens of rows.
  let reconciliationBanner = ''
  if (declaredTotal !== null) {
    const parsedTotal = rows.reduce((sum, row) => sum + (row.amount ?? 0), 0)
    const matches = Math.abs(parsedTotal - declaredTotal) < 0.05
    reconciliationBanner = matches
      ? `<p class="import-preview__reconciliation import-preview__reconciliation--ok">✓ הסכום שזוהה (${formatCurrency(parsedTotal)}) תואם לסיכום המצוין בדוח.</p>`
      : `<p class="import-preview__reconciliation import-preview__reconciliation--warn">⚠ הסכום שזוהה (${formatCurrency(parsedTotal)}) שונה מהסיכום המצוין בדוח (${formatCurrency(declaredTotal)}) — ייתכן ששורות חסרות, כפולות או שגויות. בדוק/י כל שורה בעיון לפני האישור.</p>`
  }

  const modal = new Modal(
    `
      <h2 class="modal__title">ייבוא ${rows.length} תנועות</h2>
      <p class="import-preview__hint">
        סקור/י ותקן/י כל דבר לפני הייבוא — אלה נשמרות רק לאחר אישור.
        ${duplicateCount > 0 ? `${duplicateCount} שורות נראות כאילו כבר קיימות בנתונים שלך, ומתחילות לא מסומנות.` : ''}
      </p>
      ${reconciliationBanner}
      <div class="bulk-bar" id="import-bulk-bar" hidden>
        <span class="bulk-bar__count" id="import-bulk-count"></span>
        <select class="filter-select filter-select--sm" id="import-bulk-category">
          <option value="">הגדרת קטגוריה לנבחרים…</option>
          ${categories.map((c) => `<option value="${c.id}">${c.icon} ${c.name}</option>`).join('')}
        </select>
        <select class="filter-select filter-select--sm" id="import-bulk-person">
          <option value="">הגדרת מי שילם/ה לנבחרים…</option>
          ${PEOPLE.map((p) => `<option value="${p}">${personLabel(p)}</option>`).join('')}
        </select>
      </div>
      <div class="import-preview__table-wrap">
        <table class="import-preview__table">
          <thead>
            <tr>
              <th><input type="checkbox" id="import-select-all" aria-label="בחירת הכול"></th>
              <th>תאריך</th>
              <th>בית עסק</th>
              <th>סכום</th>
              <th>קטגוריה</th>
              <th>מי שילם/ה</th>
            </tr>
          </thead>
          <tbody>
            ${rows
              .map(
                (row, index) => `
              <tr data-row="${index}" class="${row.isPossibleDuplicate ? 'import-preview__row--duplicate' : ''}">
                <td><input type="checkbox" class="row-select" data-field="include" ${row.isPossibleDuplicate ? '' : 'checked'}></td>
                <td><input type="date" class="filter-input" data-field="date" value="${row.date ?? ''}"></td>
                <td>
                  <input type="text" class="filter-input" data-field="merchant" value="${row.merchant}">
                  ${row.matchedRule ? '<span class="import-preview__rule-badge" title="מולא אוטומטית מכלל שמור">כלל</span>' : ''}
                  ${row.isPossibleDuplicate ? '<span class="import-preview__rule-badge import-preview__rule-badge--warn" title="אותו תאריך, בית עסק וסכום כמו תנועה קיימת">כפילות אפשרית</span>' : ''}
                </td>
                <td><input type="number" class="filter-input${row.amount !== null && row.amount < 0 ? ' import-preview__amount--credit' : ''}" data-field="amount" step="0.01" value="${row.amount !== null ? row.amount.toFixed(2) : ''}"></td>
                <td>
                  <select class="filter-select" data-field="category">
                    <option value="" ${row.categoryId === null ? 'selected' : ''}>🟠 לא זוהה — ללא קטגוריה</option>
                    ${categories.map((c) => `<option value="${c.id}" ${c.id === row.categoryId ? 'selected' : ''}>${c.icon} ${c.name}</option>`).join('')}
                  </select>
                </td>
                <td>
                  <select class="filter-select" data-field="person">
                    ${PEOPLE.map((p) => `<option value="${p}" ${p === (row.person ?? currentPerson) ? 'selected' : ''}>${personLabel(p)}</option>`).join('')}
                  </select>
                </td>
              </tr>
            `,
              )
              .join('')}
          </tbody>
        </table>
      </div>
      <div class="modal__actions">
        <button type="button" class="btn" id="import-cancel">ביטול</button>
        <button type="button" class="btn btn--primary" id="import-confirm">ייבוא נבחרים</button>
      </div>
    `,
    { ariaLabel: 'ייבוא תנועות' },
  )
  modal.element.classList.add('modal--import-preview')

  modal.element.querySelector<HTMLButtonElement>('#import-cancel')!.addEventListener('click', () => modal.close())
  modal.element.querySelector<HTMLButtonElement>('#import-confirm')!.addEventListener('click', () => {
    void submitImport(modal, store, currentPerson)
  })

  wireBulkSelection(modal)
}

/** Batch imports (a full statement) can be dozens of rows — selecting a
 * bunch of them and setting one category/person in one go is much faster
 * than fixing each row individually. Reuses the "include" checkbox as the
 * selection mechanism: a row you wouldn't include isn't one you'd want to
 * bulk-edit either. Purely a DOM-level convenience — nothing commits until
 * "ייבוא נבחרים", same as any other edit in this grid. */
function wireBulkSelection(modal: Modal): void {
  const selectAll = modal.element.querySelector<HTMLInputElement>('#import-select-all')!
  const bulkBar = modal.element.querySelector<HTMLElement>('#import-bulk-bar')!
  const bulkCountEl = modal.element.querySelector<HTMLElement>('#import-bulk-count')!
  const bulkCategorySelect = modal.element.querySelector<HTMLSelectElement>('#import-bulk-category')!
  const bulkPersonSelect = modal.element.querySelector<HTMLSelectElement>('#import-bulk-person')!
  const rowCheckboxes = () => Array.from(modal.element.querySelectorAll<HTMLInputElement>('tbody [data-field="include"]'))

  function syncBulkBar(): void {
    const checked = rowCheckboxes().filter((cb) => cb.checked)
    bulkBar.hidden = checked.length < 2
    bulkCountEl.textContent = `${checked.length} נבחרו`
    const all = rowCheckboxes()
    selectAll.checked = all.length > 0 && all.every((cb) => cb.checked)
    selectAll.indeterminate = checked.length > 0 && checked.length < all.length
  }

  selectAll.addEventListener('change', () => {
    rowCheckboxes().forEach((cb) => (cb.checked = selectAll.checked))
    syncBulkBar()
  })

  modal.element.querySelector<HTMLElement>('tbody')!.addEventListener('change', (event) => {
    if ((event.target as HTMLElement).closest('[data-field="include"]')) syncBulkBar()
  })

  bulkCategorySelect.addEventListener('change', () => {
    if (!bulkCategorySelect.value) return
    for (const cb of rowCheckboxes()) {
      if (!cb.checked) continue
      const select = cb.closest('tr')!.querySelector<HTMLSelectElement>('[data-field="category"]')!
      select.value = bulkCategorySelect.value
    }
    bulkCategorySelect.value = ''
  })

  bulkPersonSelect.addEventListener('change', () => {
    if (!bulkPersonSelect.value) return
    for (const cb of rowCheckboxes()) {
      if (!cb.checked) continue
      const select = cb.closest('tr')!.querySelector<HTMLSelectElement>('[data-field="person"]')!
      select.value = bulkPersonSelect.value
    }
    bulkPersonSelect.value = ''
  })

  syncBulkBar()
}

async function submitImport(modal: Modal, store: Store<AppState>, currentPerson: Person): Promise<void> {
  const uncategorized = await ensureUncategorizedCategory(store)
  const state = store.getState()

  const rowsEl = Array.from(modal.element.querySelectorAll<HTMLTableRowElement>('tbody tr'))
  const inputs: NewTransaction[] = []
  let skipped = 0

  for (const rowEl of rowsEl) {
    const included = rowEl.querySelector<HTMLInputElement>('[data-field="include"]')!.checked
    if (!included) {
      skipped++
      continue
    }

    const date = rowEl.querySelector<HTMLInputElement>('[data-field="date"]')!.value
    const merchant = rowEl.querySelector<HTMLInputElement>('[data-field="merchant"]')!.value.trim()
    const amount = Number(rowEl.querySelector<HTMLInputElement>('[data-field="amount"]')!.value)
    const categoryId = rowEl.querySelector<HTMLSelectElement>('[data-field="category"]')!.value || uncategorized.id
    const person = rowEl.querySelector<HTMLSelectElement>('[data-field="person"]')!.value as Person

    if (!date || !Number.isFinite(amount) || amount === 0) {
      skipped++
      continue
    }
    // Imported rows have no way to know which pocket paid — default to shared,
    // same as a manual entry the user hasn't touched the Account field on.
    // Reviewing already happened in this preview grid before confirming —
    // 'pending' would just mean re-reviewing the same row a second time.
    inputs.push({
      date,
      merchant,
      amount,
      currency: 'ILS',
      originalAmount: amount,
      categoryId,
      person: person || currentPerson,
      account: 'shared',
      status: computeReviewedStatus(state.transactions, state.categories, categoryId, state.budgetLimitOverrides),
      source: 'import',
    })
  }

  if (inputs.length === 0) {
    showToast('אין שורות תקינות לייבוא — בדוק/י את עמודות התאריך והסכום.')
    return
  }

  try {
    const created = await commitImportedRows(inputs)
    const { transactions } = store.getState()
    store.setState({ transactions: [...created, ...transactions] })
    modal.close()
    showToast(skipped > 0 ? `יובאו ${created.length} תנועות (${skipped} שורות לא מסומנות או חסרות דולגו).` : `יובאו ${created.length} תנועות.`)
    rememberCategoryChoices(inputs)
  } catch {
    showToast('הייבוא נכשל — ייתכן שיש להריץ קודם את מיגרציה 0003.')
  }
}

/** Remembers each merchant's category/person from this import — whether it
 * was auto-filled by an existing rule or corrected in the preview grid —
 * so the next statement for the same merchant comes in pre-categorized.
 * Fire-and-forget: this is a nice-to-have on top of an import that already
 * succeeded, not something worth blocking or erroring the import over. */
function rememberCategoryChoices(inputs: NewTransaction[]): void {
  const choiceByMerchant = new Map<string, { categoryId: string; person: Person }>()
  for (const input of inputs) {
    if (!input.merchant) continue
    choiceByMerchant.set(normalizeMerchantKey(input.merchant), { categoryId: input.categoryId, person: input.person })
  }
  for (const [merchantKey, patch] of choiceByMerchant) {
    upsertMappingRule(merchantKey, patch).catch(() => {})
  }
}
