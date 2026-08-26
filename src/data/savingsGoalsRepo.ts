import { supabase } from '../lib/supabaseClient.ts'
import type { NewSavingsGoal, SavingsGoal } from '../types.ts'
import type { SavingsGoalRow } from '../types/database.ts'
import { loadLocalSavingsGoals, saveLocalSavingsGoals } from './localStore.ts'

function fromRow(row: SavingsGoalRow): SavingsGoal {
  return { id: row.id, name: row.name, targetAmount: row.target_amount, savedAmount: row.saved_amount }
}

function toRow(input: Partial<NewSavingsGoal>): Partial<Omit<SavingsGoalRow, 'id' | 'created_at'>> {
  const row: Partial<Omit<SavingsGoalRow, 'id' | 'created_at'>> = {}
  if (input.name !== undefined) row.name = input.name
  if (input.targetAmount !== undefined) row.target_amount = input.targetAmount
  if (input.savedAmount !== undefined) row.saved_amount = input.savedAmount
  return row
}

/** Like categories/recurring rules, a missing table (migration 0010 not
 * run yet) isn't fatal — the household's core data still loads, Savings
 * just shows empty until it exists. */
export async function listSavingsGoals(): Promise<SavingsGoal[]> {
  if (supabase) {
    const { data, error } = await supabase.from('savings_goals').select('*').order('created_at')
    if (error) {
      console.warn('Could not load savings goals — has migration 0010 been run?', error)
      return []
    }
    return (data as SavingsGoalRow[]).map(fromRow)
  }
  return loadLocalSavingsGoals()
}

export async function createSavingsGoal(input: NewSavingsGoal): Promise<SavingsGoal> {
  if (supabase) {
    const { data, error } = await supabase.from('savings_goals').insert(toRow(input)).select().single()
    if (error) throw error
    return fromRow(data as SavingsGoalRow)
  }
  const goals = loadLocalSavingsGoals()
  const created: SavingsGoal = { ...input, id: crypto.randomUUID() }
  saveLocalSavingsGoals([...goals, created])
  return created
}

export async function updateSavingsGoal(id: string, patch: Partial<NewSavingsGoal>): Promise<SavingsGoal> {
  if (supabase) {
    const { data, error } = await supabase.from('savings_goals').update(toRow(patch)).eq('id', id).select().single()
    if (error) throw error
    return fromRow(data as SavingsGoalRow)
  }
  const goals = loadLocalSavingsGoals()
  const updated = goals.map((goal) => (goal.id === id ? { ...goal, ...patch } : goal))
  saveLocalSavingsGoals(updated)
  return updated.find((goal) => goal.id === id)!
}

/** Re-inserts a previously-deleted goal with its original id — used by
 * History's Undo on a savings_goal 'deleted' entry. */
export async function restoreSavingsGoal(goal: SavingsGoal): Promise<SavingsGoal> {
  if (supabase) {
    const { data, error } = await supabase.from('savings_goals').insert({ id: goal.id, ...toRow(goal) }).select().single()
    if (error) throw error
    return fromRow(data as SavingsGoalRow)
  }
  const goals = loadLocalSavingsGoals()
  saveLocalSavingsGoals([...goals, goal])
  return goal
}

export async function deleteSavingsGoal(id: string): Promise<void> {
  if (supabase) {
    const { error } = await supabase.from('savings_goals').delete().eq('id', id)
    if (error) throw error
    return
  }
  saveLocalSavingsGoals(loadLocalSavingsGoals().filter((goal) => goal.id !== id))
}
