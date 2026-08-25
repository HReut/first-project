import { readSheet } from 'read-excel-file/browser'
import type { Category, MappingRule, NewTransaction, Person, Transaction } from '../types.ts'
import { normalizeMerchantKey } from './mappingRulesRepo.ts'
import { createTransactions } from './transactionsRepo.ts'

export type CanonicalField = 'date' | 'merchant' | 'amount' | 'category' | 'person'

/** Hebrew/English column header text -> canonical field, matched after
 * trimming + lowercasing so case and whitespace don't matter. */
const HEADER_ALIASES: Record<string, CanonicalField> = {
  date: 'date',
  'transaction date': 'date',
  תאריך: 'date',
  merchant: 'merchant',
  payee: 'merchant',
  description: 'merchant',
  'תיאור עסקה': 'merchant',
  תיאור: 'merchant',
  amount: 'amount',
  sum: 'amount',
  total: 'amount',
  סכום: 'amount',
  category: 'category',
  קטגוריה: 'category',
  person: 'person',
  'paid by': 'person',
  paidby: 'person',
  'מי שילם': 'person',
}

export interface ParsedImportRow {
  date: string | null
  merchant: string
  amount: number | null
  /** null when neither the file nor a saved mapping rule supplied one —
   * the preview UI falls back to Uncategorized/current-user for display,
   * but leaves this null so it can show "not detected" rather than
   * pretending the file said something it didn't. */
  categoryId: string | null
  person: Person | null
  matchedRule: boolean
}

/** Hand-rolled RFC4180-ish CSV parser (quoted fields, escaped quotes, commas
 * and newlines inside quotes, \r\n or \n line endings) — CSV is simple
 * enough not to need a dependency, unlike XLSX/PDF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const char = text[i]

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += char
      }
      continue
    }

    if (char === '"') {
      inQuotes = true
    } else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      field = ''
      rows.push(row)
      row = []
    } else {
      field += char
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  return rows.filter((cells) => !(cells.length === 1 && cells[0] === ''))
}

/** Reads the first sheet of an XLSX/XLS file into the same string[][] shape
 * parseCsv() produces, so buildImportPreviewFromTable() can't tell the two
 * apart. Cell values come back typed (numbers, dates, booleans) — stringify
 * them here rather than downstream, since a Date is turned into an ISO
 * yyyy-mm-dd string that parseDate() below already knows how to read. */
export async function parseXlsx(file: File): Promise<string[][]> {
  const rows = await readSheet(file)
  return rows.map((row) =>
    row.map((cell) => {
      if (cell === null || cell === undefined) return ''
      if (cell instanceof Date) return cell.toISOString().slice(0, 10)
      return String(cell)
    }),
  )
}

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase()
}

export function detectColumnMapping(headers: string[]): Partial<Record<CanonicalField, number>> {
  const mapping: Partial<Record<CanonicalField, number>> = {}
  headers.forEach((header, index) => {
    const field = HEADER_ALIASES[normalizeHeader(header)]
    if (field && mapping[field] === undefined) mapping[field] = index
  })
  return mapping
}

function parseAmount(raw: string | undefined): number | null {
  if (!raw?.trim()) return null
  const cleaned = raw.replace(/[^\d.,-]/g, '').replace(/,/g, '')
  const value = Number(cleaned)
  return Number.isFinite(value) ? Math.abs(value) : null
}

/** Accepts ISO (yyyy-mm-dd), dd/mm/yyyy (common in Israeli bank/card
 * exports), or anything else Date can parse. Returns null rather than
 * guessing when the text doesn't look like a date at all. */
function parseDate(raw: string | undefined): string | null {
  if (!raw?.trim()) return null
  const trimmed = raw.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed

  const parts = trimmed.split(/[/.]/)
  if (parts.length === 3) {
    const [d, m, y] = parts
    const year = y.length === 2 ? `20${y}` : y
    if (/^\d{1,2}$/.test(d) && /^\d{1,2}$/.test(m) && /^\d{4}$/.test(year)) {
      return `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
    }
  }

  const parsed = new Date(trimmed)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10)
}

/**
 * Parses a CSV file into reviewable rows — see buildImportPreviewFromTable()
 * for the shared logic; this just adds the CSV-specific text -> table step.
 */
export function buildImportPreview(csvText: string, categories: Category[], mappingRules: MappingRule[]): ParsedImportRow[] {
  return buildImportPreviewFromTable(parseCsv(csvText), categories, mappingRules)
}

/**
 * Turns an already-tabular file (CSV rows, or an XLSX sheet read into
 * string[][]) into reviewable rows: detects Hebrew/English headers, then —
 * for anything the file didn't specify — checks stored mapping rules (keyed
 * by normalized merchant text) before leaving a field genuinely unmapped for
 * the preview UI to flag. Doesn't touch Supabase/localStore; nothing is
 * written until commitImportedRows() is called on the rows the user
 * confirms in the preview grid.
 */
export function buildImportPreviewFromTable(table: string[][], categories: Category[], mappingRules: MappingRule[]): ParsedImportRow[] {
  if (table.length < 2) return []

  const [headerRow, ...dataRows] = table
  const columnMapping = detectColumnMapping(headerRow)
  const categoryByName = new Map(categories.map((c) => [c.name.trim().toLowerCase(), c]))
  const ruleByMerchant = new Map(mappingRules.map((rule) => [rule.merchantKey, rule]))

  return dataRows.map((cells) => {
    const merchant = (columnMapping.merchant !== undefined ? cells[columnMapping.merchant] : '')?.trim() ?? ''
    const rule = ruleByMerchant.get(normalizeMerchantKey(merchant))

    const categoryRaw = columnMapping.category !== undefined ? cells[columnMapping.category]?.trim() : undefined
    const categoryFromFile = categoryRaw ? (categoryByName.get(categoryRaw.toLowerCase())?.id ?? null) : null

    const personRaw = columnMapping.person !== undefined ? cells[columnMapping.person]?.trim() : undefined
    const personFromFile = personRaw === 'Reut' || personRaw === 'Keren' ? personRaw : null

    const categoryId = categoryFromFile ?? rule?.categoryId ?? null
    const person = personFromFile ?? rule?.person ?? null

    return {
      date: columnMapping.date !== undefined ? parseDate(cells[columnMapping.date]) : null,
      merchant,
      amount: columnMapping.amount !== undefined ? parseAmount(cells[columnMapping.amount]) : null,
      categoryId,
      person,
      matchedRule: !categoryFromFile && !personFromFile && !!rule,
    }
  })
}

/**
 * The source-agnostic commit step: takes fully-formed NewTransaction rows
 * (status 'pending', source 'import') and bulk-inserts them. A future
 * email-import job would call this same function with rows shaped the same
 * way — it doesn't know or care that today its only caller is the CSV
 * preview modal.
 */
export function commitImportedRows(rows: NewTransaction[]): Promise<Transaction[]> {
  return createTransactions(rows)
}
