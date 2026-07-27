import type { Category, Person, Transaction } from '../../types.ts'

/** Small read-only cell renderers shared by the Overview review/activity
 * lists and the Transactions table's non-editing display state. */

export function renderMerchantCell(tx: Transaction): string {
  const isEmail = tx.source === 'email_auto'
  return `
    <span class="merchant-cell">
      ${tx.merchant}
      ${
        isEmail
          ? `<span class="email-badge" title="Captured automatically from email">
              <svg viewBox="0 0 20 20" width="13" height="13" aria-hidden="true">
                <path d="M2.5 5.5A1.5 1.5 0 0 1 4 4h12a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 16 16H4a1.5 1.5 0 0 1-1.5-1.5v-9Z M3 5.5l7 5 7-5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"/>
              </svg>
              <span>Auto</span>
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

export function renderStatusBadge(status: Transaction['status']): string {
  if (status !== 'needs_review') return ''
  return `<span class="status-badge">Needs review</span>`
}
