import { supabase } from '../lib/supabaseClient.ts'
import type { Store } from '../state/store.ts'
import type { AppState, Category, NewCategory } from '../types.ts'
import type { CategoryRow } from '../types/database.ts'
import { loadLocalCategories, saveLocalCategories } from './localStore.ts'

export const UNCATEGORIZED_NAME = 'ללא קטגוריה'

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

/** Re-inserts a previously-deleted category with its original id — used by
 * History's Undo on a category 'deleted' entry. createCategory() can't be
 * reused here since it always lets the database generate a fresh id. */
export async function restoreCategory(category: Category): Promise<Category> {
  if (supabase) {
    const { data, error } = await supabase.from('categories').insert({ id: category.id, ...toRow(category) }).select().single()
    if (error) throw error
    return fromRow(data as CategoryRow)
  }
  const categories = loadLocalCategories()
  saveLocalCategories([...categories, category])
  return category
}

export async function deleteCategory(id: string): Promise<void> {
  if (supabase) {
    const { error } = await supabase.from('categories').delete().eq('id', id)
    if (error) throw error
    return
  }
  saveLocalCategories(loadLocalCategories().filter((category) => category.id !== id))
}

/** Finds (or lazily creates) the category a row falls back to when nothing
 * detects/picks one — category_id is not null in the schema, so there must
 * be somewhere real to point at. Self-healing: works whether or not the
 * 0003 migration's seed insert has been run yet. Shared by CSV/PDF import
 * (TransactionsImport.ts) and leaving a recurring rule's category
 * unset (BudgetsView.ts). */
export async function ensureUncategorizedCategory(store: Store<AppState>): Promise<Category> {
  const existing = store.getState().categories.find((c) => c.name.toLowerCase() === UNCATEGORIZED_NAME.toLowerCase())
  if (existing) return existing

  const created = await createCategory({ name: UNCATEGORIZED_NAME, colorCode: '#9ca3af', icon: '❔', monthlyBudgetLimit: null })
  store.setState({ categories: [...store.getState().categories, created] })
  return created
}
