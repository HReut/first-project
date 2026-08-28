import type { Currency, ExchangeRate } from '../types.ts'

/** Converts an amount in `currency` into its ILS-equivalent, using the
 * household's currently-set rate. Falls back to 1:1 when no rate has been
 * set yet — better than blocking the save entirely, but the caller should
 * still prompt the household to set a real rate in Settings. */
export function toIls(amount: number, currency: Currency, exchangeRate: ExchangeRate | null): number {
  if (currency === 'ILS') return amount
  return amount * (exchangeRate?.usdToIls ?? 1)
}
