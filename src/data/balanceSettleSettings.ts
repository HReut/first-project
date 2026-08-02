/** Local-only "I settled up" marker for the Overview split balance — an ISO
 * yyyy-mm-dd date. computeSplitBalance excludes transactions dated on/before
 * it, so marking Done clears the balance until a newer transaction comes in.
 * Not scoped to a month on purpose: computeSplitBalance already only looks
 * at the current calendar month, so an old date here simply has no effect
 * once the month rolls over. */

const STORAGE_KEY = 'opa-tulik:balance-settled-at'

export function loadBalanceSettledAt(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

export function saveBalanceSettledAt(date: string): void {
  localStorage.setItem(STORAGE_KEY, date)
}
