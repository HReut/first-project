import { supabase } from '../lib/supabaseClient.ts'
import type { Category } from '../types.ts'

export interface ParsedInvoice {
  date: string | null
  merchant: string | null
  amount: number | null
  categoryId: string | null
}

/**
 * Sends pasted invoice/receipt text to the `parse-invoice` Supabase Edge
 * Function, which asks Claude to extract date/merchant/amount/category.
 * Never writes anything itself — TransactionsView always shows the result
 * as an editable draft in the Add Transaction modal for the user to
 * confirm before it's saved. Requires Supabase to be configured (the
 * function needs a real project to run on) and the ANTHROPIC_API_KEY
 * secret to be set on it — see supabase/functions/parse-invoice.
 */
export async function parseInvoiceText(text: string, categories: Category[]): Promise<ParsedInvoice> {
  if (!supabase) throw new Error('AI invoice capture needs Supabase configured first — see .env.example.')

  const { data, error } = await supabase.functions.invoke('parse-invoice', {
    body: { text, categories: categories.map((c) => ({ id: c.id, name: c.name })) },
  })
  if (error) throw error
  if (data?.error) throw new Error(data.error)
  return data as ParsedInvoice
}
