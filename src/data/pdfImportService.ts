import * as pdfjsLib from 'pdfjs-dist'
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { TextItem } from 'pdfjs-dist/types/src/display/api.js'
import type { Category, Person } from '../types.ts'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl

/**
 * Heuristic parser for Israeli credit-card statement PDFs — covers two Max
 * layouts seen so far: the monthly statement's "עסקות בארץ" table (date,
 * merchant, type, transaction amount, charge amount) and the website's
 * "פירוט חיובים" export (date, merchant, category, type, amount — with a
 * real קטגוריה column). Turns either into a string[][] table shaped like a
 * CSV/XLSX import, so it flows through the exact same
 * buildImportPreviewFromTable() review/dedupe/category-mapping pipeline as
 * any other import — that's also where merchant->category/person "memory"
 * (mapping rules from past edits) gets applied, so nothing extra is needed
 * here for that. Nothing here is written to the database; it only produces
 * rows for the reviewable preview grid.
 *
 * The approach: reconstruct the document's text into visual lines (pdf.js
 * hands back text fragments in paint order, not reading order), group those
 * lines into one block per transaction (see groupIntoTransactionBlocks()),
 * then treat each block as a transaction row if it has both a date and an
 * amount once concatenated — deliberately format-tolerant rather than
 * matching a rigid column layout, since this only needs to be a reasonable
 * first pass the user reviews before confirming. When a קטגוריה column is
 * present, its Max category label is matched against the household's actual
 * category names (via MAX_CATEGORY_ALIASES below) so the preview grid comes
 * in pre-categorized where the guess is confident, and left "not detected"
 * otherwise. Also extracts the statement's own stated total ("סה"כ ...") so
 * the preview screen can flag a mismatch against what was actually parsed —
 * see PdfImportResult.declaredTotal and the reconciliation banner in
 * TransactionsImport.ts. A negative amount (refund/reversal) is kept as a
 * real negative-amount row rather than skipped — see CARD_SUFFIX_TO_PERSON
 * for how the cardholder (and so "מי שילם/ה") is detected.
 *
 * A business name (or a category/card/type/amount tail) that wraps onto its
 * own visual line is reattached to the row it belongs to by
 * groupIntoTransactionBlocks() — including when the wrap happens to land at
 * a page break and the pieces end up separated by several lines of page
 * footer/header chrome in between (see isLikelyRowContinuation and
 * isBoilerplateLine). Known limitations: MAX_CATEGORY_ALIASES only covers
 * category labels seen so far — an unrecognized one just leaves the
 * category blank rather than guessing; and a statement covering more than
 * one card wouldn't have every row correctly attributed, since cardholder
 * detection is document-wide, not per-row (see detectCardholder).
 */

const DATE_RE = /\b(\d{1,2})[./](\d{1,2})[./](\d{2,4})\b/
// Global variant of DATE_RE, used to strip every date-shaped substring out
// of a line before hunting for amounts — a statement period line like
// "01.11.2025 - 01.05.2024" otherwise gets misread as a transaction, since
// AMOUNT_RE's "\d+.\d{2}" shape also matches the day.month part of a date
// (e.g. "01.05" out of "01.05.24").
const DATE_RE_G = new RegExp(DATE_RE.source, 'g')
const AMOUNT_RE = /-?\d[\d,]*\.\d{2}(?!\d)(?!%)/g
// Words/phrases that show up inside a real transaction row but aren't part
// of the merchant name — stripped out of whatever text is left over once
// the date and amounts are removed. These are all "סוג עסקה" (transaction
// type) column values.
const NOISE_WORDS = ['רגילה', 'תשלומים', 'הוראת קבע', 'ביטול עסקה']
// "חיוב יחסי עבור 9 ימים" (a prorated partial-month charge) — the day count
// varies, so this is a pattern, not a fixed word; anything from "חיוב יחסי"
// onward on the residual line is noise, since the amount was already
// stripped by the time this runs.
const PRORATED_CHARGE_RE = /חיוב יחסי.*/

// Max's own category label -> substrings to look for in the household's
// actual category names. First substring that matches an existing category
// wins; no match leaves the row's category "not detected", same as an
// unrecognized merchant. Matched by substring (not exact-equals) against the
// row's residual text, so list longer/more specific labels before any
// shorter label that's also a substring of them (e.g. 'דלק, חשמל וגז' before
// the bare 'דלק') — the sort below also enforces this at match time. Extend
// this as new Max category labels show up.
const MAX_CATEGORY_ALIASES: [string, string[]][] = [
  ['מזון וצריכה', ['מכולת', 'סופר', 'מזון', 'קניות']],
  ['עירייה וממשלה', ['ארנונה', 'עיר']],
  ['תחבורה ורכבים', ['תחבורה']],
  ['דלק, חשמל וגז', ['חשמל', 'דלק', 'גז']],
  ['מסעדות, קפה וברים', ['מסעדות', 'קפה']],
  ['דלק', ['תחבורה']],
  ['בילוי ופנאי', ['בידור', 'פנאי']],
  ['פנאי ובידור', ['בידור', 'פנאי']],
  ['ביגוד והנעלה', ['קניות', 'ביגוד']],
  ['בריאות ורפואה', ['בריאות']],
  ['דיור ותחזוקה', ['דיור', 'בית']],
  ['חינוך', ['חינוך']],
  // Recognized so they're still cleanly peeled off the merchant text, but
  // deliberately mapped to no candidates — too generic to guess safely.
  ['שונות', []],
  ['אחר', []],
  ['כללי', []],
]

// Phrases that only ever appear in statement summary/legal/rate-table text
// — a line containing one of these is never a transaction, even if it
// happens to contain a date-like or amount-like token.
const SKIP_IF_CONTAINS = [
  'מסגרת',
  'יתרה לניצול',
  'התחייבויות',
  'תוקף מסגרת',
  'סה"כ',
  'חיוב ב',
  'ריבית',
  'תעריפית',
  'מתואמת',
  'החל מתאריך',
  'שעורי ריבית',
  'שם בית העסק',
  'העסקאות שמוצגות',
  'הצטרפו לשירות', // the "high bill? join revolving credit" upsell line MAX prints under the total
]

/** MAX prints the page-bottom total as a bare amount on its own line,
 * immediately followed by a separate "סה"כ ..." caption line — without this,
 * the bare amount looks exactly like an ordinary amount that wrapped onto
 * its own line and gets glued onto whichever transaction happens to be
 * last, replacing its real amount with the statement's grand total. Strips
 * both lines of the pair as one unit, before either line is ever seen by
 * the boilerplate/continuation checks. */
function stripTotalSummaryLines(lines: string[]): string[] {
  const BARE_AMOUNT_RE = /^-?₪?[\d,]+\.\d{2}$/
  return lines.filter((line, i) => !(BARE_AMOUNT_RE.test(line.trim()) && lines[i + 1]?.includes('סה"כ')))
}

/** Lines that are never part of a transaction and never a continuation of
 * one either — statement chrome (page titles, footers, URLs, page numbers)
 * and the statement's own date-range descriptor, which would otherwise
 * wrongly look like the start of a new transaction block since it contains
 * two valid-looking dates. Checked before a line is considered for either
 * role in groupIntoTransactionBlocks(). */
function isBoilerplateLine(line: string): boolean {
  const trimmed = line.trim()
  if (SKIP_IF_CONTAINS.some((phrase) => line.includes(phrase))) return true
  if (line.includes('https://')) return true
  if (trimmed.startsWith('•')) return true
  if (/^\d+\/\d+$/.test(trimmed)) return true // page indicator, e.g. "1/3"
  if (trimmed === 'MAX') return true // the logo, printed alone
  if (line.includes('לתאריכים')) return true // "פירוט חיובים לתאריכים ..." period descriptor
  if (/^\d{1,2}[./]\d{1,2}[./]\d{2,4}\s*-\s*\d{1,2}[./]\d{1,2}[./]\d{2,4}$/.test(trimmed)) return true // bare "date - date" range
  if (trimmed === 'ת.עסקה') return true // stray header fragment
  if (/^max\s.*\d{1,2}:\d{2}/.test(line)) return true // "max <title> PM 8:02 9/6/26," footer timestamp
  return false
}

const CONTINUATION_MAX_LENGTH = 50
// A handful of short lines that would otherwise pass the length check below
// but are chrome, not row text — e.g. a disclaimer's short closing line
// that happens to mention "MAX".
const CONTINUATION_EXCLUDE = ['MAX', 'עסקאות', 'קטגוריה', 'תאריך', 'https://']

/** True when a line is short plain text that plausibly belongs to the same
 * table row as the block it would be appended to — either the rest of a
 * business name that wrapped onto its own line, or a category/card/type/
 * amount tail that got separated from its date by a page break. Real
 * running prose (page titles, disclaimer sentences) reliably runs 85+
 * characters in practice, well clear of anything a single table cell holds,
 * so length alone does most of the work here; CONTINUATION_EXCLUDE and
 * SKIP_IF_CONTAINS catch the rare short exception. */
function isLikelyRowContinuation(line: string): boolean {
  if (line.length === 0 || line.length > CONTINUATION_MAX_LENGTH) return false
  if (CONTINUATION_EXCLUDE.some((word) => line.includes(word))) return false
  if (SKIP_IF_CONTAINS.some((phrase) => line.includes(phrase))) return false
  return true
}

/** Groups the document's lines into one block per transaction — normally
 * just the single line a row's date appears on, extended with whatever
 * short row-shaped lines immediately follow it and don't start a
 * transaction of their own. This is what lets a business name (or a
 * category/card/type/amount tail) that wraps onto its own visual line come
 * back together, whether the wrap falls in the middle of a page or right at
 * a page break with footer/header chrome sitting in between the pieces —
 * that chrome is filtered out by isBoilerplateLine() rather than treated as
 * a block boundary, so it doesn't cut a wrapped row's pieces apart. */
function groupIntoTransactionBlocks(lines: string[]): string[][] {
  const blocks: string[][] = []
  for (const rawLine of lines) {
    if (isBoilerplateLine(rawLine)) continue
    const startsNewTransaction = DATE_RE.test(rawLine.replace(/^\d{1,2}\s+/, ''))
    if (startsNewTransaction) {
      blocks.push([rawLine])
    } else if (blocks.length > 0 && isLikelyRowContinuation(rawLine)) {
      blocks[blocks.length - 1].push(rawLine)
    }
    // Anything else — not a transaction start, not row-shaped — is chrome
    // that slipped past isBoilerplateLine; safest to drop it rather than
    // risk gluing it onto whichever block happens to be open.
  }
  return blocks
}

// Card last-4 -> household member — lets the parser fill in "מי שילם/ה"
// automatically from whichever card the statement is for, instead of
// leaving every imported row on the current user by default. Extend as
// more cards are added to the household.
const CARD_SUFFIX_TO_PERSON: Record<string, Person> = {
  '4022': 'Reut',
  '3925': 'Keren',
}
const CARD_SUFFIX_RE = new RegExp(`\\b(${Object.keys(CARD_SUFFIX_TO_PERSON).join('|')})\\b`)

/** Scans the whole document (not just transaction rows) for a known card's
 * last 4 digits — usually printed once in the statement header ("כרטיס
 * ...4022") but sometimes repeated per row too, so a document-wide search
 * catches either layout. Assumes one card per statement; the preview grid
 * lets any row be corrected by hand if that's ever wrong. */
function detectCardholder(lines: string[]): Person | null {
  for (const line of lines) {
    const match = line.match(CARD_SUFFIX_RE)
    if (match) return CARD_SUFFIX_TO_PERSON[match[1]]
  }
  return null
}

function isoDate(day: string, month: string, yearRaw: string): string | null {
  const year = yearRaw.length === 2 ? `20${yearRaw}` : yearRaw
  if (!/^\d{1,2}$/.test(day) || !/^\d{1,2}$/.test(month) || !/^\d{4}$/.test(year)) return null
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
}

/** Groups a page's text fragments into visual lines by y-coordinate, then
 * orders each line right-to-left (descending x) to match Hebrew reading
 * order. */
function linesFromItems(items: { str: string; x: number; y: number }[]): string[] {
  const sorted = [...items].sort((a, b) => b.y - a.y)
  const Y_TOLERANCE = 2.5
  const lines: (typeof items)[] = []
  let currentY: number | null = null
  for (const item of sorted) {
    if (currentY === null || Math.abs(item.y - currentY) > Y_TOLERANCE) {
      lines.push([])
      currentY = item.y
    }
    lines[lines.length - 1].push(item)
  }
  return lines
    .map((line) =>
      line
        .sort((a, b) => b.x - a.x)
        .map((i) => i.str)
        .join(' ')
        .replace(/\s+/g, ' ')
        // Hebrew's proper punctuation mark for an abbreviation like סה"כ is
        // the gershayim (״, U+05F4), not a plain quote — MAX's PDFs use it
        // in some places and a plain " in others. Every 'סה"כ' check in this
        // file is written with a plain quote, so without this normalization
        // those checks silently miss any line using the correct character.
        .replace(/״/g, '"')
        .trim(),
    )
    .filter(Boolean)
}

/** Reads every page and concatenates their reconstructed lines. A single
 * page failing to extract (corrupt content stream, an image-only page,
 * etc.) is skipped rather than aborting the whole file — otherwise one bad
 * page in a multi-page statement would silently drop every transaction on
 * every other page too. */
async function extractLines(file: File): Promise<string[]> {
  const buffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise
  const lines: string[] = []
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    try {
      const page = await pdf.getPage(pageNum)
      const content = await page.getTextContent()
      const items = content.items
        .filter((it): it is TextItem => 'str' in it && it.str.trim() !== '')
        .map((it) => ({ str: it.str, x: it.transform[4] as number, y: it.transform[5] as number }))
      lines.push(...linesFromItems(items))
    } catch (err) {
      console.warn(`Could not read page ${pageNum} of ${pdf.numPages} — skipping it, continuing with the rest.`, err)
    }
  }
  return lines
}

/** Resolves a Max category label to one of the household's actual category
 * names, so the output row can go straight through buildImportPreviewFromTable()'s
 * existing exact-name category matching. Returns '' when nothing confident matches. */
function resolveCategoryName(maxLabel: string, categories: Category[]): string {
  for (const [label, hints] of MAX_CATEGORY_ALIASES) {
    if (label !== maxLabel) continue
    for (const hint of hints) {
      const match = categories.find((c) => c.name.includes(hint))
      if (match) return match.name
    }
  }
  return ''
}

export interface PdfImportResult {
  table: string[][]
  /** The statement's own stated total ("סה"כ ..."), when one could be found
   * — the last such line wins, since a multi-page statement's real total
   * sits at the bottom, after any subtotals. Lets the preview screen show
   * "does what we parsed actually add up to what the statement says it
   * should" instead of silently trusting the extraction — see
   * TransactionsImport.ts's reconciliation banner. Since refund/credit rows
   * are now imported as real negative amounts (not skipped), no separate
   * adjustment is needed here — the parsed rows already net the same way
   * the statement's own total does. */
  declaredTotal: number | null
}

/** Parses one transaction's already-grouped lines (see
 * groupIntoTransactionBlocks) into a table row, or returns null if the
 * merged text doesn't actually hold a valid date+amount transaction. */
function parseTransactionBlock(blockLines: string[], hasCategoryColumn: boolean, categories: Category[], cardholder: Person | null): string[] | null {
  // A standalone 1-2 digit token at the start of the block is a footnote
  // reference marker (e.g. "7 09/07/26 ...") — not transaction data.
  const line = blockLines.join(' ').replace(/^\d{1,2}\s+/, '')

  const dateMatch = line.match(DATE_RE)
  if (!dateMatch) return null
  const iso = isoDate(dateMatch[1], dateMatch[2], dateMatch[3])
  if (!iso) return null

  // Amounts are hunted for with every date-shaped substring stripped out
  // first — otherwise a second date on the same block (rare, but possible
  // once continuation lines are merged in) gets misread as an amount, since
  // "\d+.\d{2}" also matches a date's day.month.
  const amounts = [...line.replace(DATE_RE_G, ' ').matchAll(AMOUNT_RE)].map((m) => m[0])
  if (amounts.length === 0 || amounts.length > 3) return null

  // The rightmost/last amount on the line is the actual charge — takes over
  // an earlier "original transaction amount" column when both are present
  // (they're usually identical anyway). Kept even when negative (a refund/
  // reversal) — see CARD_SUFFIX_TO_PERSON's doc comment above.
  const lastAmount = amounts[amounts.length - 1]
  const amountValue = Number(lastAmount.replace(/,/g, ''))
  if (!Number.isFinite(amountValue) || amountValue === 0) return null

  let residue = line.replace(dateMatch[0], ' ')
  for (const amount of amounts) residue = residue.replace(amount, ' ')
  residue = residue.replace(/[₪$€]/g, ' ') // currency symbol left behind once its digits are stripped
  residue = residue.replace(PRORATED_CHARGE_RE, ' ')
  for (const word of NOISE_WORDS) residue = residue.split(word).join(' ')
  residue = residue.replace(/\s+/g, ' ').trim()

  let merchant = residue
  let categoryName = ''
  if (hasCategoryColumn) {
    // The כרטיס (card) column sits between the merchant/category text and
    // the type/amount columns and is otherwise never stripped.
    const strippedOfCard = residue.replace(CARD_SUFFIX_RE, ' ').replace(/\s+/g, ' ').trim()
    merchant = strippedOfCard
    // The category label is pulled out wherever it appears in the residue —
    // not assumed to be a trailing suffix — since a page break can leave a
    // wrapped business name sitting after the category instead of before
    // it (see groupIntoTransactionBlocks).
    for (const [maxLabel] of MAX_CATEGORY_ALIASES.filter(([label]) => strippedOfCard.includes(label)).sort((a, b) => b[0].length - a[0].length)) {
      merchant = strippedOfCard.replace(maxLabel, ' ').replace(/\s+/g, ' ').trim()
      categoryName = resolveCategoryName(maxLabel, categories)
      break
    }
  }

  return [iso, merchant, categoryName, lastAmount.replace(/,/g, ''), cardholder ?? '']
}

function linesToTable(rawLines: string[], categories: Category[], cardholder: Person | null): PdfImportResult {
  const lines = stripTotalSummaryLines(rawLines)

  // Presence of a קטגוריה header column changes how a row's residual text
  // (after date/amount/type removal) is split — with a category column, a
  // known Max category label is peeled off of it; without one, that entire
  // residue is just the merchant name.
  const hasCategoryColumn = lines.some((line) => line.includes('קטגוריה'))
  const rows: string[][] = [['תאריך', 'תיאור', 'קטגוריה', 'סכום', 'מי שילם']]
  let declaredTotal: number | null = null

  for (const rawLine of lines) {
    if (!rawLine.includes('סה"כ')) continue
    const amounts = [...rawLine.matchAll(AMOUNT_RE)].map((m) => Number(m[0].replace(/,/g, '')))
    const positive = amounts.filter((a) => Number.isFinite(a) && a > 0)
    if (positive.length > 0) declaredTotal = positive[positive.length - 1]
  }

  for (const block of groupIntoTransactionBlocks(lines)) {
    const row = parseTransactionBlock(block, hasCategoryColumn, categories, cardholder)
    if (row) rows.push(row)
  }

  return { table: rows, declaredTotal }
}

export async function parseCreditCardStatementPdf(file: File, categories: Category[]): Promise<PdfImportResult> {
  const lines = await extractLines(file)
  const cardholder = detectCardholder(lines)
  return linesToTable(lines, categories, cardholder)
}
