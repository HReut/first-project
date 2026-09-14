import type { Account, Category, Person, Transaction } from '../../types.ts'
import { personLabel } from '../../utils/format.ts'
import { normalizeMerchantKey } from '../../data/mappingRulesRepo.ts'

/** Small read-only cell renderers shared by the Overview review/activity
 * lists and the Transactions table's non-editing display state. */

/** Same date+amount+normalized-merchant key importService.ts already uses to
 * warn about a possible re-import during the CSV/PDF preview — reused here
 * so an already-saved duplicate (e.g. a statement that slipped through that
 * check, or one entered manually and then imported) still gets flagged in
 * the table itself, not just at import time. Returns the ids of every
 * transaction that shares its key with at least one other transaction. */
export function computeDuplicateTransactionIds(transactions: Transaction[]): Set<string> {
  const idsByKey = new Map<string, string[]>()
  for (const tx of transactions) {
    const key = `${tx.date}|${tx.amount}|${normalizeMerchantKey(tx.merchant)}`
    const ids = idsByKey.get(key) ?? []
    ids.push(tx.id)
    idsByKey.set(key, ids)
  }
  const duplicateIds = new Set<string>()
  for (const ids of idsByKey.values()) {
    if (ids.length > 1) for (const id of ids) duplicateIds.add(id)
  }
  return duplicateIds
}

/** Merchant is optional — categorizing where the money went matters more
 * than naming the specific store. When it's blank, fall back to the
 * category's icon+name so the row still reads as something. */
export function renderMerchantCell(tx: Transaction, category?: Category, isPossibleDuplicate = false): string {
  const label = tx.merchant || (category ? `${category.icon} ${category.name}` : '')
  return `
    <span class="merchant-cell">
      ${label}
      ${
        tx.source === 'email_auto'
          ? `<span class="email-badge" title="נלכד אוטומטית מאימייל">
              <svg viewBox="0 0 20 20" width="13" height="13" aria-hidden="true">
                <path d="M2.5 5.5A1.5 1.5 0 0 1 4 4h12a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 16 16H4a1.5 1.5 0 0 1-1.5-1.5v-9Z M3 5.5l7 5 7-5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"/>
              </svg>
            </span>`
          : ''
      }
      ${
        tx.source === 'recurring'
          ? `<span class="email-badge" title="נוצר אוטומטית מכלל תשלום קבוע">
              <svg viewBox="0 0 20 20" width="13" height="13" aria-hidden="true">
                <path d="M4 10a6 6 0 0 1 10.2-4.2M16 10a6 6 0 0 1-10.2 4.2" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
                <path d="M14.2 3.5v2.5h-2.5M5.8 16.5v-2.5h2.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </span>`
          : ''
      }
      ${
        isPossibleDuplicate
          ? `<span class="email-badge email-badge--warning" title="יש עוד תנועה עם אותו תאריך, סכום ובית עסק — יתכן שזו כפילות">
              <svg viewBox="0 0 20 20" width="13" height="13" aria-hidden="true">
                <rect x="6" y="6" width="9.5" height="9.5" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4"/>
                <path d="M4.5 13.5v-8a1 1 0 0 1 1-1h8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
              </svg>
            </span>`
          : ''
      }
    </span>
  `
}

export function renderCategoryBadge(category: Category | undefined): string {
  if (!category) {
    return `<span class="category-badge category-badge--unknown"><span class="category-dot category-dot--warning"></span>ללא קטגוריה</span>`
  }
  return `
    <span class="category-badge">
      <span class="category-dot" style="background: ${category.colorCode}"></span>
      ${category.icon} ${category.name}
    </span>
  `
}

export function renderPersonBadge(person: Person): string {
  const label = personLabel(person)
  return `
    <span class="person-badge" data-person="${person}">${label.charAt(0)}</span>
    <span class="person-name">${label}</span>
  `
}

export const ACCOUNT_LABEL: Record<Account, string> = {
  reut_personal: `${personLabel('Reut')} (אישי)`,
  keren_personal: `${personLabel('Keren')} (אישי)`,
  shared: 'משותף',
}

export function renderAccountBadge(account: Account): string {
  return `<span class="account-badge account-badge--${account.replace('_', '-')}">${ACCOUNT_LABEL[account]}</span>`
}

export const STATUS_LABEL: Record<Transaction['status'], string> = {
  pending: 'ממתין',
  on_budget: 'בתקציב',
  exceeded: 'חריגה',
}

/** No badge for 'on_budget' — that's the ordinary/expected case for most
 * rows, and showing it on every single row was pure visual noise; only
 * 'exceeded' (needs attention) and 'pending' (needs review) are worth
 * flagging. */
export function renderStatusBadge(status: Transaction['status']): string {
  if (status === 'on_budget') return ''
  return `<span class="status-badge status-badge--${status.replace('_', '-')}">${STATUS_LABEL[status]}</span>`
}

/** Whoever didn't log the transaction is the one expected to give it a look
 * — a pending row always needs the *other* person's eyes on it. Empty string
 * for anything already reviewed. */
export function renderWaitingBadge(tx: Transaction): string {
  if (tx.status !== 'pending') return ''
  const reviewer: Person = tx.person === 'Reut' ? 'Keren' : 'Reut'
  return `<span class="waiting-badge">ממתין ל${personLabel(reviewer)}</span>`
}
