import { supabase } from '../lib/supabaseClient.ts'
import type { AccountBalance } from '../types.ts'
import type { AccountBalanceRow } from '../types/database.ts'
import { loadLocalAccountBalance, saveLocalAccountBalance } from './localStore.ts'

function fromRow(row: AccountBalanceRow): AccountBalance {
  return { startingBalance: row.starting_balance, setAt: row.set_at }
}

/** Like mapping/recurring rules, a missing table (migration 0007 not run
 * yet) isn't fatal — the household's core data still loads, Overview just
 * shows "not set" for Total Available until this exists. */
export async function loadAccountBalance(): Promise<AccountBalance | null> {
  if (supabase) {
    const { data, error } = await supabase.from('account_balance').select('*').order('updated_at', { ascending: false }).limit(1)
    if (error) {
      console.warn('Could not load account balance — has migration 0007 been run?', error)
      return null
    }
    return data && data.length > 0 ? fromRow(data[0] as AccountBalanceRow) : null
  }
  return loadLocalAccountBalance()
}

/** Recalibrating (e.g. after checking the real bank balance) just inserts a
 * new row rather than updating in place — loadAccountBalance() always reads
 * the most recent one, so there's no upsert-conflict-target bookkeeping. */
export async function setAccountBalance(balance: AccountBalance): Promise<AccountBalance> {
  if (supabase) {
    const { data, error } = await supabase
      .from('account_balance')
      .insert({ starting_balance: balance.startingBalance, set_at: balance.setAt })
      .select()
      .single()
    if (error) throw error
    return fromRow(data as AccountBalanceRow)
  }
  saveLocalAccountBalance(balance)
  return balance
}
