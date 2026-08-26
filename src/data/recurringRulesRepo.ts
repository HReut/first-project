import { supabase } from '../lib/supabaseClient.ts'
import type { NewRecurringRule, RecurringRule } from '../types.ts'
import type { RecurringRuleRow } from '../types/database.ts'
import { loadLocalRecurringRules, saveLocalRecurringRules } from './localStore.ts'

function fromRow(row: RecurringRuleRow): RecurringRule {
  return {
    id: row.id,
    merchant: row.merchant,
    amount: row.amount,
    categoryId: row.category_id,
    account: row.account,
    person: row.person,
    intervalMonths: row.interval_months,
    anchorMonth: row.anchor_month,
    dayOfMonth: row.day_of_month,
    totalOccurrences: row.total_occurrences,
    occurrencesGenerated: row.occurrences_generated,
    isActive: row.is_active,
    lastGeneratedMonth: row.last_generated_month,
  }
}

type RecurringRulePatch = Partial<NewRecurringRule & Pick<RecurringRule, 'lastGeneratedMonth' | 'occurrencesGenerated'>>

function toRow(input: RecurringRulePatch): Partial<Omit<RecurringRuleRow, 'id' | 'created_at'>> {
  const row: Partial<Omit<RecurringRuleRow, 'id' | 'created_at'>> = {}
  if (input.merchant !== undefined) row.merchant = input.merchant
  if (input.amount !== undefined) row.amount = input.amount
  if (input.categoryId !== undefined) row.category_id = input.categoryId
  if (input.account !== undefined) row.account = input.account
  if (input.person !== undefined) row.person = input.person
  if (input.intervalMonths !== undefined) row.interval_months = input.intervalMonths
  if (input.anchorMonth !== undefined) row.anchor_month = input.anchorMonth
  if (input.dayOfMonth !== undefined) row.day_of_month = input.dayOfMonth
  if (input.totalOccurrences !== undefined) row.total_occurrences = input.totalOccurrences
  if (input.occurrencesGenerated !== undefined) row.occurrences_generated = input.occurrencesGenerated
  if (input.isActive !== undefined) row.is_active = input.isActive
  if (input.lastGeneratedMonth !== undefined) row.last_generated_month = input.lastGeneratedMonth
  return row
}

/** Like mapping rules, failures here don't throw — recurring rules are a
 * nice-to-have on top of the household's core data, not required for the
 * app to load (e.g. migration 0005 not run yet). */
export async function listRecurringRules(): Promise<RecurringRule[]> {
  if (supabase) {
    const { data, error } = await supabase.from('recurring_rules').select('*').order('created_at')
    if (error) {
      console.warn('Could not load recurring rules — has migration 0005 been run?', error)
      return []
    }
    return (data as RecurringRuleRow[]).map(fromRow)
  }
  return loadLocalRecurringRules()
}

export async function createRecurringRule(input: NewRecurringRule): Promise<RecurringRule> {
  if (supabase) {
    const { data, error } = await supabase
      .from('recurring_rules')
      .insert(toRow(input))
      .select()
      .single()
    if (error) throw error
    return fromRow(data as RecurringRuleRow)
  }
  const rules = loadLocalRecurringRules()
  const created: RecurringRule = { ...input, id: crypto.randomUUID(), lastGeneratedMonth: null, occurrencesGenerated: 0 }
  saveLocalRecurringRules([...rules, created])
  return created
}

export async function updateRecurringRule(id: string, patch: RecurringRulePatch): Promise<RecurringRule> {
  if (supabase) {
    const { data, error } = await supabase.from('recurring_rules').update(toRow(patch)).eq('id', id).select().single()
    if (error) throw error
    return fromRow(data as RecurringRuleRow)
  }
  const rules = loadLocalRecurringRules()
  const updated = rules.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule))
  saveLocalRecurringRules(updated)
  return updated.find((rule) => rule.id === id)!
}

/** Re-inserts a previously-deleted rule with its original id (and its
 * generation state — lastGeneratedMonth/occurrencesGenerated — so it
 * doesn't regenerate an already-paid month) — used by History's Undo on a
 * recurring_rule 'deleted' entry. createRecurringRule() can't be reused
 * here since it always lets the database generate a fresh id and resets
 * generation state to "never generated". */
export async function restoreRecurringRule(rule: RecurringRule): Promise<RecurringRule> {
  if (supabase) {
    const { data, error } = await supabase
      .from('recurring_rules')
      .insert({ id: rule.id, ...toRow(rule) })
      .select()
      .single()
    if (error) throw error
    return fromRow(data as RecurringRuleRow)
  }
  const rules = loadLocalRecurringRules()
  saveLocalRecurringRules([...rules, rule])
  return rule
}

export async function deleteRecurringRule(id: string): Promise<void> {
  if (supabase) {
    const { error } = await supabase.from('recurring_rules').delete().eq('id', id)
    if (error) throw error
    return
  }
  saveLocalRecurringRules(loadLocalRecurringRules().filter((rule) => rule.id !== id))
}
