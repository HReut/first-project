import { supabase } from '../lib/supabaseClient.ts'
import type { MappingRule } from '../types.ts'
import type { MappingRuleRow } from '../types/database.ts'
import { loadLocalMappingRules, saveLocalMappingRules } from './localStore.ts'

/** Normalizes a merchant string into the key used to match against saved
 * rules — trimmed and lowercased so "Shufersal", "SHUFERSAL " etc. all hit
 * the same rule. */
export function normalizeMerchantKey(merchant: string): string {
  return merchant.trim().toLowerCase()
}

function fromRow(row: MappingRuleRow): MappingRule {
  return {
    id: row.id,
    merchantKey: row.merchant_key,
    categoryId: row.category_id,
    person: row.person,
    updatedAt: row.updated_at,
  }
}

/** Unlike the other repos, failures here don't throw — the household's core
 * data (categories/transactions) must still load even if the
 * user_mapping_rules table doesn't exist yet (migration 0003 not run yet).
 * Mapping rules are a nice-to-have on top of that, not core data. */
export async function listMappingRules(): Promise<MappingRule[]> {
  if (supabase) {
    const { data, error } = await supabase.from('user_mapping_rules').select('*').order('updated_at', { ascending: false })
    if (error) {
      console.warn('Could not load mapping rules — has migration 0003 been run?', error)
      return []
    }
    return (data as MappingRuleRow[]).map(fromRow)
  }
  return loadLocalMappingRules()
}

/** Saves (or updates) the remembered category/person for a merchant —
 * upserted by merchantKey since each merchant has at most one rule. */
export async function upsertMappingRule(
  merchantKey: string,
  patch: { categoryId?: string | null; person?: MappingRule['person'] },
): Promise<MappingRule> {
  const updatedAt = new Date().toISOString()

  if (supabase) {
    const { data, error } = await supabase
      .from('user_mapping_rules')
      .upsert(
        {
          merchant_key: merchantKey,
          ...(patch.categoryId !== undefined ? { category_id: patch.categoryId } : {}),
          ...(patch.person !== undefined ? { person: patch.person } : {}),
          updated_at: updatedAt,
        },
        { onConflict: 'merchant_key' },
      )
      .select()
      .single()
    if (error) throw error
    return fromRow(data as MappingRuleRow)
  }

  const rules = loadLocalMappingRules()
  const existing = rules.find((rule) => rule.merchantKey === merchantKey)
  const merged: MappingRule = existing
    ? { ...existing, ...patch, updatedAt }
    : { id: crypto.randomUUID(), merchantKey, categoryId: patch.categoryId ?? null, person: patch.person ?? null, updatedAt }
  saveLocalMappingRules([...rules.filter((rule) => rule.merchantKey !== merchantKey), merged])
  return merged
}
