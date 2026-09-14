import { readSheet } from 'read-excel-file/browser'
import type { CardPersonMapping, Category, MappingRule, NewTransaction, Person, Transaction } from '../types.ts'
import { normalizeMerchantKey } from './mappingRulesRepo.ts'
import { createTransactions } from './transactionsRepo.ts'
import { personLabel } from '../utils/format.ts'

const PEOPLE: Person[] = ['Reut', 'Keren']
// Accepts either the raw 'Reut'/'Keren' value or its Hebrew display label
// (רעות/קרן) — the latter is what this app's own CSV export writes (see
// TransactionsView.ts), so re-importing an exported file needs it too, not
// just files that happen to spell it out in English.
const PERSON_BY_LABEL: Record<string, Person> = Object.fromEntries(PEOPLE.map((p) => [personLabel(p), p]))

export type CanonicalField = 'date' | 'merchant' | 'amount' | 'category' | 'person' | 'cardSuffix' | 'transactionType'

/** Max's "סוג עסקה" (transaction type) column value for a disputed/
 * under-review row — nothing's actually been charged yet, and it may never
 * be. Shared with pdfImportService.ts (same underlying Max data, just a
 * different layout) so both recognize the same exact status text. */
export const DISPUTED_TRANSACTION_TYPE = 'עסקה בבירור'

/** Prefixed onto a row's merchant cell (only ever produced by
 * pdfImportService.ts, for a Max "עסקה בבירור" — under-review/disputed —
 * row) to carry the isDisputed flag through the generic string[][] table
 * shape without adding a column every other import source would also need
 * to fill in. Wrapped in U+E000 (Private Use Area — not a real character,
 * so it can't appear in real statement text) rather than a NUL byte: NUL
 * bytes make git/GitHub treat this whole file as binary, losing readable
 * diffs for every future change to it. Stripped back off (and turned into
 * ParsedImportRow.isDisputed) in buildImportPreviewFromTable. */
export const DISPUTED_ROW_TAG = 'disputed'

/** Hebrew/English column header text -> canonical field, matched after
 * trimming + lowercasing so case and whitespace don't matter. */
const HEADER_ALIASES: Record<string, CanonicalField> = {
  date: 'date',
  'transaction date': 'date',
  תאריך: 'date',
  // Max's own "פירוט חיובים" XLSX export (Settings ▸ export, or the
  // transaction-details_export_*.xlsx download) — not a generic alias, this
  // is that layout's exact column header text.
  'תאריך עסקה': 'date',
  merchant: 'merchant',
  payee: 'merchant',
  description: 'merchant',
  'תיאור עסקה': 'merchant',
  תיאור: 'merchant',
  'שם בית העסק': 'merchant',
  // This app's own CSV export (TransactionsView.ts's "ייצוא" button) —
  // needed so re-importing an exported file (e.g. after editing it in
  // Excel) actually works, rather than silently mapping no columns at all.
  'בית עסק': 'merchant',
  amount: 'amount',
  sum: 'amount',
  total: 'amount',
  סכום: 'amount',
  'סכום חיוב': 'amount',
  category: 'category',
  קטגוריה: 'category',
  person: 'person',
  'paid by': 'person',
  paidby: 'person',
  'מי שילם': 'person',
  'משלם/ת': 'person',
  // Only present in Max's own XLSX export — used to resolve "who paid"
  // per row (see buildCardMappingLookup) and to detect a disputed row
  // (see DISPUTED_TRANSACTION_TYPE) more precisely than the PDF path,
  // which only has an aggregated document-wide cardholder guess.
  '4 ספרות אחרונות של כרטיס האשראי': 'cardSuffix',
  'סוג עסקה': 'transactionType',
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
  /** True when the category/person shown wasn't in the file itself but was
   * filled in automatically — either from a saved mapping rule, or (see
   * buildMostCommonCategoryByMerchant) from how this merchant is usually
   * categorized elsewhere in the household's data. Shown as a badge so the
   * guess is visibly a guess, not something the file actually said. */
  matchedRule: boolean
  /** True when an existing transaction already has this exact date +
   * merchant + amount — most likely the same statement imported twice.
   * The preview starts these unchecked rather than silently skipping
   * them, since a same-day coincidence (two identical coffees) is
   * possible and the user should get to decide. */
  isPossibleDuplicate: boolean
  /** True for a Max "עסקה בבירור" (under review/disputed) row — detected
   * either via DISPUTED_ROW_TAG (PDF import, which has no separate "סוג
   * עסקה" column of its own) or a "transactionType" column matching
   * DISPUTED_TRANSACTION_TYPE (XLSX import). Nothing's actually been
   * charged yet and it may never be, so the preview starts these unchecked
   * too, same as a possible duplicate — the household decides whether to
   * bring it in early. */
  isDisputed: boolean
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

/** Max's own XLSX export (and possibly other bank exports) put a few
 * title/metadata rows above the real header row — cardholder name, card
 * digits, statement month — each a single cell with the rest of the row
 * empty. Scans the first several rows and picks whichever matches the most
 * known column names, rather than assuming the header is always row 0. */
function findHeaderRowIndex(table: string[][]): number {
  let bestIndex = 0
  let bestScore = -1
  const searchLimit = Math.min(table.length, 20)
  for (let i = 0; i < searchLimit; i++) {
    const score = Object.keys(detectColumnMapping(table[i])).length
    if (score > bestScore) {
      bestScore = score
      bestIndex = i
    }
  }
  return bestIndex
}

// Sign is preserved (not Math.abs'd) — a negative amount is a real
// refund/credit row, imported as a real negative-amount transaction rather
// than dropped. See ParsedImportRow.amount.
function parseAmount(raw: string | undefined): number | null {
  if (!raw?.trim()) return null
  const cleaned = raw.replace(/[^\d.,-]/g, '').replace(/,/g, '')
  const value = Number(cleaned)
  return Number.isFinite(value) ? value : null
}

/** Accepts ISO (yyyy-mm-dd), dd/mm/yyyy or dd-mm-yyyy (both common in
 * Israeli bank/card exports — Max's own XLSX statement export uses dashes,
 * e.g. "10-07-2026"), or anything else Date can parse. Returns null rather
 * than guessing when the text doesn't look like a date at all. */
function parseDate(raw: string | undefined): string | null {
  if (!raw?.trim()) return null
  const trimmed = raw.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed

  // Dash is deliberately split on here too (not just / and .) — but only
  // after the yyyy-mm-dd check above already returned, so a real ISO date
  // never reaches this branch. Without this, "10-07-2026" (10 July) fell
  // through to `new Date(...)` below, which silently reads a dashed date as
  // US-style mm-dd-yyyy and returns the wrong date (7 October) instead of
  // failing loudly — worse than the "no date recognized" case, since a
  // wrong date is easy to miss in review and a missing one isn't.
  const parts = trimmed.split(/[/.-]/)
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
export function buildImportPreview(
  csvText: string,
  categories: Category[],
  mappingRules: MappingRule[],
  existingTransactions: Transaction[],
  cardMappings: CardPersonMapping[],
): ParsedImportRow[] {
  return buildImportPreviewFromTable(parseCsv(csvText), categories, mappingRules, existingTransactions, cardMappings)
}

/** Merchant -> whichever category most of its existing transactions already
 * carry, used as a fallback when there's no saved mapping rule for it. A
 * category picked by hand in the transactions grid doesn't automatically
 * become a mapping rule (only accepting the "remember this?" prompt does),
 * so without this, a merchant the household has consistently categorized
 * for months would still come back "not detected" on every fresh import
 * until someone explicitly saves a rule for it. */
function buildMostCommonCategoryByMerchant(transactions: Transaction[]): Map<string, string> {
  const countsByMerchant = new Map<string, Map<string, number>>()
  for (const tx of transactions) {
    if (!tx.merchant) continue
    const key = normalizeMerchantKey(tx.merchant)
    const counts = countsByMerchant.get(key) ?? new Map<string, number>()
    counts.set(tx.categoryId, (counts.get(tx.categoryId) ?? 0) + 1)
    countsByMerchant.set(key, counts)
  }

  const result = new Map<string, string>()
  for (const [key, counts] of countsByMerchant) {
    let bestCategoryId = ''
    let bestCount = 0
    for (const [categoryId, count] of counts) {
      if (count > bestCount) {
        bestCount = count
        bestCategoryId = categoryId
      }
    }
    if (bestCategoryId) result.set(key, bestCategoryId)
  }
  return result
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
export function buildImportPreviewFromTable(
  table: string[][],
  categories: Category[],
  mappingRules: MappingRule[],
  existingTransactions: Transaction[],
  cardMappings: CardPersonMapping[],
): ParsedImportRow[] {
  if (table.length < 2) return []

  const headerRowIndex = findHeaderRowIndex(table)
  const headerRow = table[headerRowIndex]
  const dataRows = table.slice(headerRowIndex + 1)
  const columnMapping = detectColumnMapping(headerRow)
  const categoryByName = new Map(categories.map((c) => [c.name.trim().toLowerCase(), c]))
  const ruleByMerchant = new Map(mappingRules.map((rule) => [rule.merchantKey, rule]))
  // Only ever populated for a file with its own "4 ספרות אחרונות..." column
  // (Max's XLSX export) — every other source leaves this empty and
  // personFromCardSuffix below is always null, a no-op.
  const personByCardSuffix = new Map(cardMappings.map((m) => [m.cardSuffix, m.person]))
  // Falls back to whatever category a merchant is *usually* filed under in
  // the household's existing data when there's no saved mapping rule for
  // it — a manual categorization never automatically becomes a rule, so
  // without this a merchant only ever gets recognized here if someone
  // happened to accept the "remember this?" prompt for it. existingTransactions
  // is the whole household's data (not scoped to whoever's importing), so
  // this already draws on every household member's past corrections.
  const mostCommonCategoryByMerchant = buildMostCommonCategoryByMerchant(existingTransactions)
  // date+amount+normalized-merchant -> already in the household's data — and
  // added to as rows are processed below, so two identical-looking rows
  // *within this same file* also flag each other, not just rows that match
  // something already saved. Covers re-importing the same statement (or an
  // overlapping range from a second export) in one go, not just across
  // separate import sessions.
  const seenKeys = new Set(existingTransactions.map((tx) => `${tx.date}|${tx.amount}|${normalizeMerchantKey(tx.merchant)}`))

  return dataRows.map((cells) => {
    const merchantRaw = (columnMapping.merchant !== undefined ? cells[columnMapping.merchant] : '')?.trim() ?? ''
    const isDisputedTag = merchantRaw.includes(DISPUTED_ROW_TAG)
    const merchant = (isDisputedTag ? merchantRaw.split(DISPUTED_ROW_TAG).join('') : merchantRaw).trim()
    const rule = ruleByMerchant.get(normalizeMerchantKey(merchant))

    const categoryRaw = columnMapping.category !== undefined ? cells[columnMapping.category]?.trim() : undefined
    const categoryFromFile = categoryRaw ? (categoryByName.get(categoryRaw.toLowerCase())?.id ?? null) : null

    const personRaw = columnMapping.person !== undefined ? cells[columnMapping.person]?.trim() : undefined
    const personFromFile = personRaw === 'Reut' || personRaw === 'Keren' ? personRaw : (personRaw ? (PERSON_BY_LABEL[personRaw] ?? null) : null)
    // Which card a row's own line was charged to is a fact the statement
    // states (same reasoning as pdfImportService.ts's detectCardholder),
    // not a merchant-history guess — so, unlike rule?.person below, this is
    // a legitimate source for "who paid", just resolved per row instead of
    // once for the whole file.
    const cardSuffixRaw = columnMapping.cardSuffix !== undefined ? cells[columnMapping.cardSuffix]?.trim() : undefined
    const personFromCardSuffix = cardSuffixRaw ? (personByCardSuffix.get(cardSuffixRaw) ?? null) : null

    const transactionTypeRaw = columnMapping.transactionType !== undefined ? cells[columnMapping.transactionType]?.trim() : undefined
    const isDisputed = isDisputedTag || transactionTypeRaw === DISPUTED_TRANSACTION_TYPE

    const categoryId = categoryFromFile ?? rule?.categoryId ?? mostCommonCategoryByMerchant.get(normalizeMerchantKey(merchant)) ?? null
    // Deliberately not rule?.person: who paid isn't a property of the
    // merchant (the same supermarket run could land on either person's
    // card), it's whoever's statement this is — the preview defaults it to
    // the current importer instead (see openPreviewModal in
    // TransactionsImport.ts), unless the file itself states otherwise
    // (personFromFile) or the row's own card tells us (personFromCardSuffix).
    const person = personFromFile ?? personFromCardSuffix ?? null
    const date = columnMapping.date !== undefined ? parseDate(cells[columnMapping.date]) : null
    const amount = columnMapping.amount !== undefined ? parseAmount(cells[columnMapping.amount]) : null

    const key = date !== null && amount !== null && merchant !== '' ? `${date}|${amount}|${normalizeMerchantKey(merchant)}` : null
    const isPossibleDuplicate = key !== null && seenKeys.has(key)
    if (key !== null) seenKeys.add(key)

    return {
      date,
      merchant,
      amount,
      categoryId,
      person,
      matchedRule: !categoryFromFile && (!!rule?.categoryId || mostCommonCategoryByMerchant.has(normalizeMerchantKey(merchant))),
      isPossibleDuplicate,
      isDisputed,
    }
  })
    .filter((row) => row.date !== null || row.merchant !== '' || row.amount !== null)
  // Drops rows carrying no recognizable data at all — a blank spacer row, or
  // (in Max's own XLSX export) the trailing "סך הכל" total line — which would
  // otherwise show up in the preview grid as a bogus all-blank row.
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
