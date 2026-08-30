import { supabase } from '../lib/supabaseClient.ts'
import type { ExchangeRate } from '../types.ts'
import type { ExchangeRateRow } from '../types/database.ts'
import { loadLocalExchangeRate, saveLocalExchangeRate } from './localStore.ts'

function fromRow(row: ExchangeRateRow): ExchangeRate {
  return { usdToIls: row.usd_to_ils, eurToIls: row.eur_to_ils, setAt: row.set_at }
}

/** Like account balance, a missing table (migration 0011 not run yet)
 * isn't fatal — foreign-currency transactions just fall back to converting
 * 1:1 until this exists. */
export async function loadExchangeRate(): Promise<ExchangeRate | null> {
  if (supabase) {
    const { data, error } = await supabase.from('exchange_rates').select('*').order('updated_at', { ascending: false }).limit(1)
    if (error) {
      console.warn('Could not load exchange rate — has migration 0011 been run?', error)
      return null
    }
    return data && data.length > 0 ? fromRow(data[0] as ExchangeRateRow) : null
  }
  return loadLocalExchangeRate()
}

/** Recalibrating inserts a new row rather than updating in place —
 * loadExchangeRate() always reads the most recent one — same reasoning as
 * setAccountBalance(): past transactions already froze their own
 * ILS-equivalent amount at whatever rate was in effect when they were
 * saved, so there's nothing to retroactively update. `rate` is the
 * household's full current fallback state (both currencies) — the caller
 * (SettingsView) merges in whichever one the person just edited and carries
 * the other forward unchanged, so setting the USD rate doesn't clear a
 * previously-set EUR rate and vice versa. */
export async function setExchangeRate(rate: ExchangeRate): Promise<ExchangeRate> {
  if (supabase) {
    const { data, error } = await supabase
      .from('exchange_rates')
      .insert({ usd_to_ils: rate.usdToIls, eur_to_ils: rate.eurToIls, set_at: rate.setAt })
      .select()
      .single()
    if (error) throw error
    return fromRow(data as ExchangeRateRow)
  }
  saveLocalExchangeRate(rate)
  return rate
}
