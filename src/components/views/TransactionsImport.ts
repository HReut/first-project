import type { Store } from '../../state/store.ts'
import type { AppState, Category, NewTransaction, Person } from '../../types.ts'
import { buildImportPreview, buildImportPreviewFromTable, commitImportedRows, parseXlsx, type ParsedImportRow } from '../../data/importService.ts'
import { listMappingRules } from '../../data/mappingRulesRepo.ts'
import { createCategory } from '../../data/categoriesRepo.ts'
import { Modal } from '../shared/Modal.ts'
import { showToast } from '../shared/Toast.ts'

const PEOPLE: Person[] = ['Reut', 'Keren']
const UNCATEGORIZED_NAME = 'Uncategorized'

let fileInput: HTMLInputElement | null = null

function getFileInput(onFile: (file: File) => void): HTMLInputElement {
  if (!fileInput) {
    fileInput = document.createElement('input')
    fileInput.type = 'file'
    fileInput.accept = '.csv,.xlsx,.xls'
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

/** Entry point wired to the sidebar's "Import CSV/XLSX" button (via the
 * opa:import-transactions event). PDF isn't supported — table extraction
 * from arbitrary PDF statements is too unreliable to trust silently. */
export function openImportFlow(store: Store<AppState>, currentPerson: Person): void {
  const input = getFileInput((file) => {
    handleFile(file, store, currentPerson).catch(() => showToast('Could not read that file.'))
  })
  input.click()
}

async function handleFile(file: File, store: Store<AppState>, currentPerson: Person): Promise<void> {
  const name = file.name.toLowerCase()
  const isCsv = name.endsWith('.csv')
  const isXlsx = name.endsWith('.xlsx') || name.endsWith('.xls')
  if (!isCsv && !isXlsx) {
    showToast('PDF import is not supported — export as CSV or Excel instead.')
    return
  }

  const state = store.getState()
  const mappingRules = await listMappingRules()
  const rows = isCsv
    ? buildImportPreview(await file.text(), state.categories, mappingRules, state.transactions)
    : buildImportPreviewFromTable(await parseXlsx(file), state.categories, mappingRules, state.transactions)

  if (rows.length === 0) {
    showToast('No data rows found in that file.')
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
      <h2 class="modal__title">Import ${rows.length} transaction${rows.length === 1 ? '' : 's'}</h2>
      <p class="import-preview__hint">
        Review and fix anything before importing — these are only saved once you confirm.
        ${duplicateCount > 0 ? `${duplicateCount} row${duplicateCount === 1 ? ' looks' : 's look'} like ${duplicateCount === 1 ? 'it\'s' : 'they\'re'} already in your data, and start${duplicateCount === 1 ? 's' : ''} unchecked.` : ''}
      </p>
      <div class="import-preview__table-wrap">
        <table class="import-preview__table">
          <thead>
            <tr>
              <th></th>
              <th>Date</th>
              <th>Merchant</th>
              <th>Amount</th>
              <th>Category</th>
              <th>Person</th>
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
                  ${row.matchedRule ? '<span class="import-preview__rule-badge" title="Auto-filled from a saved rule">Rule</span>' : ''}
                  ${row.isPossibleDuplicate ? '<span class="import-preview__rule-badge import-preview__rule-badge--warn" title="Same date, merchant, and amount as an existing transaction">Possible duplicate</span>' : ''}
                </td>
                <td><input type="number" class="filter-input" data-field="amount" min="0" step="0.01" value="${row.amount ?? ''}"></td>
                <td>
                  <select class="filter-select" data-field="category">
                    <option value="" ${row.categoryId === null ? 'selected' : ''}>Not detected — Uncategorized</option>
                    ${categories.map((c) => `<option value="${c.id}" ${c.id === row.categoryId ? 'selected' : ''}>${c.icon} ${c.name}</option>`).join('')}
                  </select>
                </td>
                <td>
                  <select class="filter-select" data-field="person">
                    ${PEOPLE.map((p) => `<option value="${p}" ${p === (row.person ?? currentPerson) ? 'selected' : ''}>${p}</option>`).join('')}
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
        <button type="button" class="btn" id="import-cancel">Cancel</button>
        <button type="button" class="btn btn--primary" id="import-confirm">Import selected</button>
      </div>
    `,
    { ariaLabel: 'Import transactions' },
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

    if (!date || !merchant || !Number.isFinite(amount) || amount <= 0) {
      skipped++
      continue
    }
    // Imported rows have no way to know which pocket paid — default to shared,
    // same as a manual entry the user hasn't touched the Account field on.
    inputs.push({ date, merchant, amount, categoryId, person: person || currentPerson, account: 'shared', status: 'pending', source: 'import' })
  }

  if (inputs.length === 0) {
    showToast('No valid rows to import — check the date, merchant, and amount columns.')
    return
  }

  try {
    const created = await commitImportedRows(inputs)
    const { transactions } = store.getState()
    store.setState({ transactions: [...created, ...transactions] })
    modal.close()
    showToast(skipped > 0 ? `Imported ${created.length} transactions (${skipped} unchecked or incomplete row${skipped === 1 ? '' : 's'} skipped).` : `Imported ${created.length} transactions.`)
  } catch {
    showToast('Import failed — the database may need migration 0003 run first.')
  }
}
