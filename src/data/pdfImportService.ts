import * as pdfjsLib from 'pdfjs-dist'
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { TextItem } from 'pdfjs-dist/types/src/display/api.js'
import type { Category } from '../types.ts'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl

/**
 * Heuristic parser for Israeli credit-card statement PDFs — covers two Max
 * layouts seen so far: the monthly statement's "עסקות בארץ" table (date,
 * merchant, type, transaction amount, charge amount) and the website's
 * "פירוט חיובים" export (date, merchant, category, type, amount — with a
 * real קטגוריה column). Turns either into a string[][] table shaped like a
 * CSV/XLSX import, so it flows through the exact same
 * buildImportPreviewFromTable() review/dedupe/category-mapping pipeline as
 * any other import. Nothing here is written to the database; it only
 * produces rows for the reviewable preview grid.
 *
 * The approach: reconstruct each page's text into visual lines (pdf.js
 * hands back text fragments in paint order, not reading order), then treat
 * any line containing both a date and a positive amount as a transaction
 * row — deliberately format-tolerant rather than matching a rigid column
 * layout, since this only needs to be a reasonable first pass the user
 * reviews before confirming. When a קטגוריה column is present, its Max
 * category label is matched against the household's actual category names
 * (via MAX_CATEGORY_ALIASES below) so the preview grid comes in
 * pre-categorized where the guess is confident, and left "not detected"
 * otherwise. Known limitations: skips negative amounts (refunds/cancelled
 * fees), since this app has no way to represent a negative transaction yet;
 * a merchant name that wraps onto a second visual line loses that second
 * line; and MAX_CATEGORY_ALIASES only covers category labels seen so far —
 * an unrecognized one just leaves the category blank rather than guessing.
 */

const DATE_RE = /\b(\d{1,2})[./](\d{1,2})[./](\d{2,4})\b/
const AMOUNT_RE = /-?\d[\d,]*\.\d{2}(?!\d)(?!%)/g
// Words/phrases that show up inside a real transaction row but aren't part
// of the merchant name — stripped out of whatever text is left over once
// the date and amounts are removed.
const NOISE_WORDS = ['רגילה', 'תשלומים']
// "חיוב יחסי עבור 9 ימים" (a prorated partial-month charge) — the day count
// varies, so this is a pattern, not a fixed word; anything from "חיוב יחסי"
// onward on the residual line is noise, since the amount was already
// stripped by the time this runs.
const PRORATED_CHARGE_RE = /חיוב יחסי.*/

// Max's own category label -> substrings to look for in the household's
// actual category names. First substring that matches an existing category
// wins; no match leaves the row's category "not detected", same as an
// unrecognized merchant. Extend this as new Max category labels show up.
const MAX_CATEGORY_ALIASES: [string, string[]][] = [
  ['מזון וצריכה', ['מכולת', 'סופר', 'מזון', 'קניות']],
  ['עירייה וממשלה', ['ארנונה', 'עיר']],
  ['תחבורה ורכב', ['תחבורה']],
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
]

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
        .trim(),
    )
    .filter(Boolean)
}

async function extractLines(file: File): Promise<string[]> {
  const buffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise
  const lines: string[] = []
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum)
    const content = await page.getTextContent()
    const items = content.items
      .filter((it): it is TextItem => 'str' in it && it.str.trim() !== '')
      .map((it) => ({ str: it.str, x: it.transform[4] as number, y: it.transform[5] as number }))
    lines.push(...linesFromItems(items))
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

function linesToTable(lines: string[], categories: Category[]): string[][] {
  // Presence of a קטגוריה header column changes how a row's residual text
  // (after date/amount/type removal) is split — with a category column, a
  // known Max category label is peeled off the end of it; without one,
  // that entire residue is just the merchant name.
  const hasCategoryColumn = lines.some((line) => line.includes('קטגוריה'))
  const rows: string[][] = [['תאריך', 'תיאור', 'קטגוריה', 'סכום']]

  for (const rawLine of lines) {
    if (SKIP_IF_CONTAINS.some((phrase) => rawLine.includes(phrase))) continue

    // A standalone 1-2 digit token at the start of the line is a footnote
    // reference marker (e.g. "7 09/07/26 ...") — not transaction data.
    const line = rawLine.replace(/^\d{1,2}\s+/, '')

    const dateMatch = line.match(DATE_RE)
    if (!dateMatch) continue
    const iso = isoDate(dateMatch[1], dateMatch[2], dateMatch[3])
    if (!iso) continue

    const amounts = [...line.matchAll(AMOUNT_RE)].map((m) => m[0])
    if (amounts.length === 0 || amounts.length > 3) continue

    // The rightmost/last amount on the line is the actual charge — takes
    // over an earlier "original transaction amount" column when both are
    // present (they're usually identical anyway).
    const lastAmount = amounts[amounts.length - 1]
    const amountValue = Number(lastAmount.replace(/,/g, ''))
    if (!Number.isFinite(amountValue) || amountValue <= 0) continue

    let residue = line.replace(dateMatch[0], ' ')
    for (const amount of amounts) residue = residue.replace(amount, ' ')
    residue = residue.replace(/[₪$]/g, ' ') // currency symbol left behind once its digits are stripped
    residue = residue.replace(PRORATED_CHARGE_RE, ' ')
    for (const word of NOISE_WORDS) residue = residue.split(word).join(' ')
    residue = residue.replace(/\s+/g, ' ').trim()

    let merchant = residue
    let categoryName = ''
    if (hasCategoryColumn) {
      for (const [maxLabel] of MAX_CATEGORY_ALIASES.filter(([label]) => residue.endsWith(label)).sort((a, b) => b[0].length - a[0].length)) {
        merchant = residue.slice(0, residue.length - maxLabel.length).trim()
        categoryName = resolveCategoryName(maxLabel, categories)
        break
      }
    }

    rows.push([iso, merchant, categoryName, lastAmount.replace(/,/g, '')])
  }

  return rows
}

export async function parseCreditCardStatementPdf(file: File, categories: Category[]): Promise<string[][]> {
  const lines = await extractLines(file)
  return linesToTable(lines, categories)
}
