import { supabase } from '../lib/supabaseClient.ts'
import type { BudgetLimitOverride, NewBudgetLimitOverride } from '../types.ts'
import type { BudgetLimitOverrideRow } from '../types/database.ts'
import { loadLocalBudgetLimitOverrides, saveLocalBudgetLimitOverrides } from './localStore.ts'

function fromRow(row: BudgetLimitOverrideRow): BudgetLimitOverride {
  return { id: row.id, categoryId: row.category_id, startMonth: row.start_month, endMonth: row.end_month, limit: row.limit_amount }
}

/** Like mapping/recurring rules, a missing table (migration 0008 not run
 * yet) isn't fatal — the household's core data still loads, budgets just
 * fall back to each category's flat monthlyBudgetLimit everywhere. */
export async function listBudgetLimitOverrides(): Promise<BudgetLimitOverride[]> {
  if (supabase) {
    const { data, error } = await supabase.from('budget_limit_overrides').select('*').order('start_month', { ascending: false })
    if (error) {
      console.warn('Could not load budget limit overrides — has migration 0008 been run?', error)
      return []
    }
    return (data as BudgetLimitOverrideRow[]).map(fromRow)
  }
  return loadLocalBudgetLimitOverrides()
}

export async function createBudgetLimitOverride(input: NewBudgetLimitOverride): Promise<BudgetLimitOverride> {
  if (supabase) {
    const { data, error } = await supabase
      .from('budget_limit_overrides')
      .insert({ category_id: input.categoryId, start_month: input.startMonth, end_month: input.endMonth, limit_amount: input.limit })
      .select()
      .single()
    if (error) throw error
    return fromRow(data as BudgetLimitOverrideRow)
  }
  const overrides = loadLocalBudgetLimitOverrides()
  const created: BudgetLimitOverride = { ...input, id: crypto.randomUUID() }
  saveLocalBudgetLimitOverrides([...overrides, created])
  return created
}

/** Used by the "All months" scope — wipes every override for a category so
 * it goes back to being governed purely by its flat monthlyBudgetLimit. */
export async function deleteBudgetLimitOverridesForCategory(categoryId: string): Promise<void> {
  if (supabase) {
    const { error } = await supabase.from('budget_limit_overrides').delete().eq('category_id', categoryId)
    if (error) throw error
    return
  }
  saveLocalBudgetLimitOverrides(loadLocalBudgetLimitOverrides().filter((o) => o.categoryId !== categoryId))
}

/** Undoes just the one override an edit created (This month / From now on
 * scopes) — narrower than deleteBudgetLimitOverridesForCategory(), which
 * would also remove any unrelated overrides already set for that category. */
export async function deleteBudgetLimitOverride(id: string): Promise<void> {
  if (supabase) {
    const { error } = await supabase.from('budget_limit_overrides').delete().eq('id', id)
    if (error) throw error
    return
  }
  saveLocalBudgetLimitOverrides(loadLocalBudgetLimitOverrides().filter((o) => o.id !== id))
}

/** Re-inserts overrides with their original ids — undoes the "All months"
 * scope's wipe of a category's existing overrides. */
export async function restoreBudgetLimitOverrides(overrides: BudgetLimitOverride[]): Promise<void> {
  if (overrides.length === 0) return

  if (supabase) {
    const rows = overrides.map((o) => ({ id: o.id, category_id: o.categoryId, start_month: o.startMonth, end_month: o.endMonth, limit_amount: o.limit }))
    const { error } = await supabase.from('budget_limit_overrides').insert(rows)
    if (error) throw error
    return
  }
  saveLocalBudgetLimitOverrides([...overrides, ...loadLocalBudgetLimitOverrides()])
}
