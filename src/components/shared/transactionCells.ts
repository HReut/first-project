import type { Account, Category, Person, Transaction } from '../../types.ts'

/** Small read-only cell renderers shared by the Overview review/activity
 * lists and the Transactions table's non-editing display state. */

export function renderMerchantCell(tx: Transaction): string {
  return `
    <span class="merchant-cell">
      ${tx.merchant}
      ${
        tx.source === 'email_auto'
          ? `<span class="email-badge" title="Captured automatically from email">
              <svg viewBox="0 0 20 20" width="13" height="13" aria-hidden="true">
                <path d="M2.5 5.5A1.5 1.5 0 0 1 4 4h12a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 16 16H4a1.5 1.5 0 0 1-1.5-1.5v-9Z M3 5.5l7 5 7-5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"/>
              </svg>
              <span>Auto</span>
            </span>`
          : ''
      }
      ${
        tx.source === 'import'
          ? `<span class="email-badge" title="Added via CSV import">
              <svg viewBox="0 0 20 20" width="13" height="13" aria-hidden="true">
                <path d="M10 3v9M6.5 8.5 10 12l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M4 13.5v2a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-2" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
              </svg>
              <span>Imported</span>
            </span>`
          : ''
      }
    </span>
  `
}

export function renderCategoryBadge(category: Category | undefined): string {
  if (!category) return `<span class="category-badge category-badge--unknown">Uncategorized</span>`
  return `
    <span class="category-badge" style="background: color-mix(in srgb, ${category.colorCode} 14%, var(--surface))">
      <span class="category-dot" style="background: ${category.colorCode}"></span>
      ${category.icon} ${category.name}
    </span>
  `
}

export function renderPersonBadge(person: Person): string {
  return `
    <span class="person-badge" data-person="${person}">${person.charAt(0)}</span>
    <span class="person-name">${person}</span>
  `
}

export const ACCOUNT_LABEL: Record<Account, string> = {
  reut_personal: 'Reut (Personal)',
  keren_personal: 'Keren (Personal)',
  shared: 'Shared',
}

export function renderAccountBadge(account: Account): string {
  return `<span class="account-badge account-badge--${account.replace('_', '-')}">${ACCOUNT_LABEL[account]}</span>`
}

export const STATUS_LABEL: Record<Transaction['status'], string> = {
  pending: 'Pending',
  on_budget: 'On Budget',
  exceeded: 'Exceeded',
}

export function renderStatusBadge(status: Transaction['status']): string {
  return `<span class="status-badge status-badge--${status.replace('_', '-')}">${STATUS_LABEL[status]}</span>`
}
