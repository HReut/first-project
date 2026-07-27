import { supabase } from '../lib/supabaseClient.ts'
import type { Category, NewCategory } from '../types.ts'
import type { CategoryRow } from '../types/database.ts'
import { loadLocalCategories, saveLocalCategories } from './localStore.ts'

function fromRow(row: CategoryRow): Category {
  return { id: row.id, name: row.name, colorCode: row.color_code, icon: row.icon, monthlyBudgetLimit: row.monthly_budget_limit }
}

function toRow(input: Partial<NewCategory>): Partial<Omit<CategoryRow, 'id' | 'created_at'>> {
  const row: Partial<Omit<CategoryRow, 'id' | 'created_at'>> = {}
  if (input.name !== undefined) row.name = input.name
  if (input.colorCode !== undefined) row.color_code = input.colorCode
  if (input.icon !== undefined) row.icon = input.icon
  if (input.monthlyBudgetLimit !== undefined) row.monthly_budget_limit = input.monthlyBudgetLimit
  return row
}

export async function listCategories(): Promise<Category[]> {
  if (supabase) {
    const { data, error } = await supabase.from('categories').select('*').order('name')
    if (error) throw error
    return (data as CategoryRow[]).map(fromRow)
  }
  return loadLocalCategories()
}

export async function createCategory(input: NewCategory): Promise<Category> {
  if (supabase) {
    const { data, error } = await supabase.from('categories').insert(toRow(input)).select().single()
    if (error) throw error
    return fromRow(data as CategoryRow)
  }
  const categories = loadLocalCategories()
  const created: Category = { ...input, id: crypto.randomUUID() }
  saveLocalCategories([...categories, created])
  return created
}

export async function updateCategory(id: string, patch: Partial<NewCategory>): Promise<Category> {
  if (supabase) {
    const { data, error } = await supabase.from('categories').update(toRow(patch)).eq('id', id).select().single()
    if (error) throw error
    return fromRow(data as CategoryRow)
  }
  const categories = loadLocalCategories()
  const updated = categories.map((category) => (category.id === id ? { ...category, ...patch } : category))
  saveLocalCategories(updated)
  return updated.find((category) => category.id === id)!
}

export async function deleteCategory(id: string): Promise<void> {
  if (supabase) {
    const { error } = await supabase.from('categories').delete().eq('id', id)
    if (error) throw error
    return
  }
  saveLocalCategories(loadLocalCategories().filter((category) => category.id !== id))
}
