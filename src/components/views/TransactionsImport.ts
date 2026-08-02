import type { Store } from '../../state/store.ts'
import type { AppState, Category, NewTransaction, Person } from '../../types.ts'
import { buildImportPreview, commitImportedRows, type ParsedImportRow } from '../../data/importService.ts'
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
    fileInput.accept = '.csv'
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

/** Entry point wired to the sidebar's "Import CSV/PDF" button (via the
 * opa:import-transactions event). Only .csv is supported this round — see
 * the plan doc for why XLSX/PDF are a separate follow-up. */
export function openImportFlow(store: Store<AppState>, currentPerson: Person): void {
  const input = getFileInput((file) => {
    handleFile(file, store, currentPerson).catch(() => showToast('Could not read that file.'))
  })
  input.click()
}

async function handleFile(file: File, store: Store<AppState>, currentPerson: Person): Promise<void> {
  if (!file.name.toLowerCase().endsWith('.csv')) {
    showToast('XLSX and PDF import are coming soon — export as CSV for now.')
    return
  }

  const text = await file.text()
  const state = store.getState()
  const mappingRules = await listMappingRules()
  const rows = buildImportPreview(text, state.categories, mappingRules)

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

  const modal = new Modal(
    `
      <h2 class="modal__title">Import ${rows.length} transaction${rows.length === 1 ? '' : 's'}</h2>
      <p class="import-preview__hint">Review and fix anything before importing — these are only saved once you confirm.</p>
      <div class="import-preview__table-wrap">
        <table class="import-preview__table">
          <thead>
            <tr>
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
              <tr data-row="${index}">
                <td><input type="date" class="filter-input" data-field="date" value="${row.date ?? ''}"></td>
                <td>
                  <input type="text" class="filter-input" data-field="merchant" value="${row.merchant}">
                  ${row.matchedRule ? '<span class="import-preview__rule-badge" title="Auto-filled from a saved rule">Rule</span>' : ''}
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
        <button type="button" class="btn btn--primary" id="import-confirm">Import ${rows.length} transaction${rows.length === 1 ? '' : 's'}</button>
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
    showToast(
      skipped > 0
        ? `Imported ${created.length} transactions (${skipped} skipped — missing date, merchant, or amount).`
        : `Imported ${created.length} transactions.`,
    )
  } catch {
    showToast('Import failed — the database may need migration 0003 run first.')
  }
}
