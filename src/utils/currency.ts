import type { Currency, ExchangeRate } from '../types.ts'
import { fetchHistoricalUsdToIls } from '../data/exchangeRateApi.ts'

/** Converts an amount in `currency` into its ILS-equivalent using the
 * household's manually-set rate — the fallback path when the live
 * historical lookup (resolveIlsAmount below) isn't available. Falls back
 * further to 1:1 when no manual rate has been set either — better than
 * blocking the save entirely. */
export function toIls(amount: number, currency: Currency, exchangeRate: ExchangeRate | null): number {
  if (currency === 'ILS') return amount
  return amount * (exchangeRate?.usdToIls ?? 1)
}

export interface IlsConversionResult {
  amount: number
  /** True when the live historical rate couldn't be fetched and this used
   * the manually-set (or 1:1) fallback instead — callers can surface this
   * so the household knows the amount isn't from the actual date's rate. */
  usedFallback: boolean
}

/** The primary conversion path: looks up the real historical USD->ILS rate
 * for the transaction's own date, so the ILS-equivalent reflects what the
 * rate actually was that day rather than whatever the household's manual
 * Settings rate happens to be set to right now. Only falls back to that
 * manual rate (then 1:1) when the live lookup fails — offline, API down,
 * or a date the source has no data for. */
export async function resolveIlsAmount(originalAmount: number, currency: Currency, date: string, fallbackRate: ExchangeRate | null): Promise<IlsConversionResult> {
  if (currency === 'ILS') return { amount: originalAmount, usedFallback: false }

  const historicalRate = await fetchHistoricalUsdToIls(date)
  if (historicalRate !== null) return { amount: originalAmount * historicalRate, usedFallback: false }

  return { amount: toIls(originalAmount, currency, fallbackRate), usedFallback: true }
}
