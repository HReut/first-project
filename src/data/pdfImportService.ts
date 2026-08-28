import * as pdfjsLib from 'pdfjs-dist'
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { TextItem } from 'pdfjs-dist/types/src/display/api.js'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl

/**
 * Heuristic parser for Israeli credit-card statement PDFs (built against a
 * Max/Isracard-style "עסקות בארץ" table) — turns the statement into a
 * string[][] table shaped like a CSV/XLSX import, so it flows through the
 * exact same buildImportPreviewFromTable() review/dedupe/category-mapping
 * pipeline as any other import. Nothing here is written to the database;
 * it only produces rows for the reviewable preview grid.
 *
 * The approach: reconstruct each page's text into visual lines (pdf.js
 * hands back text fragments in paint order, not reading order), then treat
 * any line containing both a date and at least one amount as a transaction
 * row — this is deliberately format-tolerant rather than matching a rigid
 * column layout, since column order can vary and this only needs to be a
 * reasonable first pass the user reviews before confirming. Known
 * limitations: skips negative amounts (refunds/cancelled fees), since this
 * app has no way to represent a negative transaction yet; and lines with
 * more than 3 number-like tokens are assumed to be a summary/rate table,
 * not a transaction, to avoid picking up statement boilerplate.
 */

const DATE_RE = /\b(\d{1,2}\/\d{1,2}\/\d{2,4})\b/
const AMOUNT_RE = /-?\d[\d,]*\.\d{2}(?!\d)(?!%)/g
// Words that show up inside a real transaction row but aren't part of the
// merchant name — stripped out of whatever text is left over once the date
// and amounts are removed.
const NOISE_WORDS = ['רגילה', 'תשלומים']
// Phrases that only ever appear in statement summary/legal/rate-table text
// — a line containing one of these is never a transaction, even if it
// happens to contain a date-like or amount-like token.
const SKIP_IF_CONTAINS = [
  'מסגרת',
  'יתרה לניצול',
  'התחייבויות',
  'תוקף מסגרת',
  'סה"כ חיוב',
  'ריבית',
  'תעריפית',
  'מתואמת',
  'החל מתאריך',
  'שעורי ריבית',
  'שם בית העסק',
]

function isoDateFromDDMMYY(raw: string): string | null {
  const parts = raw.split('/')
  if (parts.length !== 3) return null
  const [d, m, yRaw] = parts
  const y = yRaw.length === 2 ? `20${yRaw}` : yRaw
  if (!/^\d{1,2}$/.test(d) || !/^\d{1,2}$/.test(m) || !/^\d{4}$/.test(y)) return null
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
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

function linesToTable(lines: string[]): string[][] {
  const rows: string[][] = [['תאריך', 'תיאור', 'סכום']]

  for (const rawLine of lines) {
    if (SKIP_IF_CONTAINS.some((phrase) => rawLine.includes(phrase))) continue

    // A standalone 1-2 digit token at the start of the line is a footnote
    // reference marker (e.g. "7 09/07/26 ...") — not transaction data.
    const line = rawLine.replace(/^\d{1,2}\s+/, '')

    const dateMatch = line.match(DATE_RE)
    if (!dateMatch) continue
    const iso = isoDateFromDDMMYY(dateMatch[1])
    if (!iso) continue

    const amounts = [...line.matchAll(AMOUNT_RE)].map((m) => m[0])
    if (amounts.length === 0 || amounts.length > 3) continue

    // The rightmost/last amount on the line is the actual charge for this
    // statement — take it over an earlier "original transaction amount"
    // column when both are present (they're usually identical anyway).
    const lastAmount = amounts[amounts.length - 1]
    const amountValue = Number(lastAmount.replace(/,/g, ''))
    if (!Number.isFinite(amountValue) || amountValue <= 0) continue

    let merchant = line.replace(dateMatch[0], ' ')
    for (const amount of amounts) merchant = merchant.replace(amount, ' ')
    for (const word of NOISE_WORDS) merchant = merchant.split(word).join(' ')
    merchant = merchant.replace(/\s+/g, ' ').trim()

    rows.push([iso, merchant, lastAmount.replace(/,/g, '')])
  }

  return rows
}

export async function parseCreditCardStatementPdf(file: File): Promise<string[][]> {
  const lines = await extractLines(file)
  return linesToTable(lines)
}
