import { supabase } from '../lib/supabaseClient.ts'
import type { CardPersonMapping, NewCardPersonMapping } from '../types.ts'
import type { CardPersonMappingRow } from '../types/database.ts'
import { loadLocalCardMappings, saveLocalCardMappings } from './localStore.ts'

function fromRow(row: CardPersonMappingRow): CardPersonMapping {
  return { id: row.id, cardSuffix: row.card_suffix, person: row.person }
}

/** Like mapping rules, failures here don't throw — a missing table
 * (migration 0014 not run yet) just means PDF import falls back to the
 * old behavior of never auto-detecting a cardholder, not to the household's
 * core data failing to load. */
export async function listCardMappings(): Promise<CardPersonMapping[]> {
  if (supabase) {
    const { data, error } = await supabase.from('card_person_mapping').select('*').order('card_suffix')
    if (error) {
      console.warn('Could not load card mappings — has migration 0014 been run?', error)
      return []
    }
    return (data as CardPersonMappingRow[]).map(fromRow)
  }
  return loadLocalCardMappings()
}

export async function createCardMapping(input: NewCardPersonMapping): Promise<CardPersonMapping> {
  if (supabase) {
    const { data, error } = await supabase
      .from('card_person_mapping')
      .insert({ card_suffix: input.cardSuffix, person: input.person })
      .select()
      .single()
    if (error) throw error
    return fromRow(data as CardPersonMappingRow)
  }
  const mappings = loadLocalCardMappings()
  const created: CardPersonMapping = { ...input, id: crypto.randomUUID() }
  saveLocalCardMappings([...mappings, created])
  return created
}

export async function deleteCardMapping(id: string): Promise<void> {
  if (supabase) {
    const { error } = await supabase.from('card_person_mapping').delete().eq('id', id)
    if (error) throw error
    return
  }
  saveLocalCardMappings(loadLocalCardMappings().filter((mapping) => mapping.id !== id))
}
