import type { Store } from '../../state/store.ts'
import type { AppState, Category, NewTransaction, Person } from '../../types.ts'
import { buildImportPreview, buildImportPreviewFromTable, commitImportedRows, parseXlsx, type ParsedImportRow } from '../../data/importService.ts'
import { listMappingRules, normalizeMerchantKey, upsertMappingRule } from '../../data/mappingRulesRepo.ts'
import { createCategory } from '../../data/categoriesRepo.ts'
import { Modal } from '../shared/Modal.ts'
import { showToast } from '../shared/Toast.ts'
import { personLabel } from '../../utils/format.ts'

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
  if (isCsv) {
    rows = buildImportPreview(await file.text(), state.categories, mappingRules, state.transactions)
  } else if (isXlsx) {
    rows = buildImportPreviewFromTable(await parseXlsx(file), state.categories, mappingRules, state.transactions)
  } else {
    // pdfjs-dist is ~850KB — split into its own chunk so it only loads for
    // people who actually import a PDF, not on every page visit.
    const { parseCreditCardStatementPdf } = await import('../../data/pdfImportService.ts')
    rows = buildImportPreviewFromTable(await parseCreditCardStatementPdf(file, state.categories), state.categories, mappingRules, state.transactions)
  }

  if (rows.length === 0) {
    showToast(isPdf ? 'לא זוהו תנועות בקובץ ה-PDF — ודא/י שזה דוח עסקות רגיל.' : 'לא נמצאו שורות נתונים בקובץ הזה.')
    return
  }

  openPreviewModal(rows, store, currentPerson)
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

function openPreviewModal(rows: ParsedImportRow[], store: Store<AppState>, currentPerson: Person): void {
  const { categories } = store.getState()
  const duplicateCount = rows.filter((row) => row.isPossibleDuplicate).length

  const modal = new Modal(
    `
      <h2 class="modal__title">ייבוא ${rows.length} תנועות</h2>
      <p class="import-preview__hint">
        סקור/י ותקן/י כל דבר לפני הייבוא — אלה נשמרות רק לאחר אישור.
        ${duplicateCount > 0 ? `${duplicateCount} שורות נראות כאילו כבר קיימות בנתונים שלך, ומתחילות לא מסומנות.` : ''}
      </p>
      <div class="import-preview__table-wrap">
        <table class="import-preview__table">
          <thead>
            <tr>
              <th></th>
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
                <td><input type="number" class="filter-input" data-field="amount" min="0" step="0.01" value="${row.amount !== null ? row.amount.toFixed(2) : ''}"></td>
                <td>
                  <select class="filter-select" data-field="category">
                    <option value="" ${row.categoryId === null ? 'selected' : ''}>לא זוהה — ללא קטגוריה</option>
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
}

async function submitImport(modal: Modal, store: Store<AppState>, currentPerson: Person): Promise<void> {
  const uncategorized = await ensureUncategorizedCategory(store)

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

    if (!date || !Number.isFinite(amount) || amount <= 0) {
      skipped++
      continue
    }
    // Imported rows have no way to know which pocket paid — default to shared,
    // same as a manual entry the user hasn't touched the Account field on.
    inputs.push({
      date,
      merchant,
      amount,
      currency: 'ILS',
      originalAmount: amount,
      categoryId,
      person: person || currentPerson,
      account: 'shared',
      status: 'pending',
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
