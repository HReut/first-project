const FRANKFURTER_BASE = 'https://api.frankfurter.dev/v1'

// Historical rates never change — cache them in memory for the session so
// re-editing USD transactions on the same date doesn't re-fetch every time.
const rateCache = new Map<string, number>()

/** The actual USD->ILS rate on `date` — Frankfurter's ECB-sourced daily
 * reference rate, automatically falling back to the most recent prior
 * business day for weekends/holidays. Returns null on any network or data
 * failure; callers fall back to the household's manually-set rate, then to
 * 1:1, rather than blocking the save on a flaky connection. */
export async function fetchHistoricalUsdToIls(date: string): Promise<number | null> {
  const cached = rateCache.get(date)
  if (cached !== undefined) return cached

  try {
    const response = await fetch(`${FRANKFURTER_BASE}/${date}?base=USD&symbols=ILS`)
    if (!response.ok) return null
    const data = (await response.json()) as { rates?: { ILS?: number } }
    const rate = data.rates?.ILS
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) return null
    rateCache.set(date, rate)
    return rate
  } catch {
    return null
  }
}
