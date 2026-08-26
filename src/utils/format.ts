import type { Person } from '../types.ts'

const CURRENCY = 'ILS'
const LOCALE = 'he-IL'

const PERSON_LABEL: Record<Person, string> = { Reut: 'רעות', Keren: 'קרן' }

/** Hebrew display name for a Person — the underlying 'Reut'/'Keren' values
 * stay in English everywhere else (DB rows, CSS var names, dataset
 * attributes) since changing them would mean a data migration. This is the
 * one place that translates them for what a user actually reads. */
export function personLabel(person: Person): string {
  return PERSON_LABEL[person]
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat(LOCALE, {
    style: 'currency',
    currency: CURRENCY,
    maximumFractionDigits: 0,
  }).format(amount)
}

export function formatSignedCurrency(amount: number): string {
  const sign = amount > 0 ? '+' : amount < 0 ? '−' : ''
  return `${sign}${formatCurrency(Math.abs(amount))}`
}

export function formatPercent(value: number): string {
  const sign = value > 0 ? '+' : value < 0 ? '−' : ''
  return `${sign}${Math.abs(value).toFixed(0)}%`
}

export function formatDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short' })
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(LOCALE, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export function formatMonthLabel(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number)
  return new Date(year, month - 1, 1).toLocaleDateString(LOCALE, { month: 'long', year: 'numeric' })
}
