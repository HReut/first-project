const FRANKFURTER_BASE = 'https://api.frankfurter.dev/v1'

// Historical rates never change — cache them in memory for the session so
// re-editing a foreign-currency transaction on the same date/currency
// doesn't re-fetch every time. Keyed by "currency:date" since USD and EUR
// rates for the same date are different numbers.
const rateCache = new Map<string, number>()

/** The actual <currency>->ILS rate on `date` — Frankfurter's ECB-sourced
 * daily reference rate, automatically falling back to the most recent prior
 * business day for weekends/holidays. Returns null on any network or data
 * failure; callers fall back to the household's manually-set rate, then to
 * 1:1, rather than blocking the save on a flaky connection. */
export async function fetchHistoricalRateToIls(currency: 'USD' | 'EUR', date: string): Promise<number | null> {
  const cacheKey = `${currency}:${date}`
  const cached = rateCache.get(cacheKey)
  if (cached !== undefined) return cached

  try {
    const response = await fetch(`${FRANKFURTER_BASE}/${date}?base=${currency}&symbols=ILS`)
    if (!response.ok) return null
    const data = (await response.json()) as { rates?: { ILS?: number } }
    const rate = data.rates?.ILS
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) return null
    rateCache.set(cacheKey, rate)
    return rate
  } catch {
    return null
  }
}
