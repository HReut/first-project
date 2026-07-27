import { supabase } from '../lib/supabaseClient.ts'
import type { EmailSyncRule, NewEmailSyncRule } from '../types.ts'
import type { EmailSyncRuleRow } from '../types/database.ts'
import { loadLocalEmailRules, saveLocalEmailRules } from './localStore.ts'

function fromRow(row: EmailSyncRuleRow): EmailSyncRule {
  return {
    id: row.id,
    targetEmail: row.target_email,
    merchantKeyword: row.merchant_keyword,
    defaultCategoryId: row.default_category_id,
    defaultPerson: row.default_person,
    isActive: row.is_active,
  }
}

function toRow(input: Partial<NewEmailSyncRule>): Partial<Omit<EmailSyncRuleRow, 'id' | 'created_at'>> {
  const row: Partial<Omit<EmailSyncRuleRow, 'id' | 'created_at'>> = {}
  if (input.targetEmail !== undefined) row.target_email = input.targetEmail
  if (input.merchantKeyword !== undefined) row.merchant_keyword = input.merchantKeyword
  if (input.defaultCategoryId !== undefined) row.default_category_id = input.defaultCategoryId
  if (input.defaultPerson !== undefined) row.default_person = input.defaultPerson
  if (input.isActive !== undefined) row.is_active = input.isActive
  return row
}

export async function listEmailRules(): Promise<EmailSyncRule[]> {
  if (supabase) {
    const { data, error } = await supabase.from('email_sync_rules').select('*').order('created_at')
    if (error) throw error
    return (data as EmailSyncRuleRow[]).map(fromRow)
  }
  return loadLocalEmailRules()
}

export async function createEmailRule(input: NewEmailSyncRule): Promise<EmailSyncRule> {
  if (supabase) {
    const { data, error } = await supabase.from('email_sync_rules').insert(toRow(input)).select().single()
    if (error) throw error
    return fromRow(data as EmailSyncRuleRow)
  }
  const rules = loadLocalEmailRules()
  const created: EmailSyncRule = { ...input, id: crypto.randomUUID() }
  saveLocalEmailRules([...rules, created])
  return created
}

export async function updateEmailRule(id: string, patch: Partial<NewEmailSyncRule>): Promise<EmailSyncRule> {
  if (supabase) {
    const { data, error } = await supabase.from('email_sync_rules').update(toRow(patch)).eq('id', id).select().single()
    if (error) throw error
    return fromRow(data as EmailSyncRuleRow)
  }
  const rules = loadLocalEmailRules()
  const updated = rules.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule))
  saveLocalEmailRules(updated)
  return updated.find((rule) => rule.id === id)!
}

export async function deleteEmailRule(id: string): Promise<void> {
  if (supabase) {
    const { error } = await supabase.from('email_sync_rules').delete().eq('id', id)
    if (error) throw error
    return
  }
  saveLocalEmailRules(loadLocalEmailRules().filter((rule) => rule.id !== id))
}
