import { supabase } from '../lib/supabaseClient.ts'
import type { ActivityLogEntry, NewActivityLogEntry } from '../types.ts'
import type { ActivityLogRow } from '../types/database.ts'
import { appendLocalActivityLog, loadLocalActivityLog, updateLocalActivityLog } from './localStore.ts'

const LIST_LIMIT = 200

function fromRow(row: ActivityLogRow): ActivityLogEntry {
  return {
    id: row.id,
    entityType: row.entity_type as ActivityLogEntry['entityType'],
    action: row.action as ActivityLogEntry['action'],
    summary: row.summary,
    beforeData: row.before_data,
    performedBy: row.performed_by,
    performedAt: row.performed_at,
    undone: row.undone,
  }
}

/** Like recurring/budget overrides, a missing table (migration 0009 not run
 * yet) isn't fatal — the household's core data still loads, History just
 * shows nothing until it exists. */
export async function listActivityLog(): Promise<ActivityLogEntry[]> {
  if (supabase) {
    const { data, error } = await supabase.from('activity_log').select('*').order('performed_at', { ascending: false }).limit(LIST_LIMIT)
    if (error) {
      console.warn('Could not load activity log — has migration 0009 been run?', error)
      return []
    }
    return (data as ActivityLogRow[]).map(fromRow)
  }
  return loadLocalActivityLog().slice(0, LIST_LIMIT)
}

/** Fire-and-forget from the caller's perspective isn't safe here — logging
 * failure (e.g. migration not run) shouldn't block the real action that
 * already succeeded, so callers should catch and ignore, not await-and-throw. */
export async function logActivity(input: NewActivityLogEntry): Promise<ActivityLogEntry> {
  if (supabase) {
    const { data, error } = await supabase
      .from('activity_log')
      .insert({ entity_type: input.entityType, action: input.action, summary: input.summary, before_data: input.beforeData, performed_by: input.performedBy })
      .select()
      .single()
    if (error) throw error
    return fromRow(data as ActivityLogRow)
  }
  return appendLocalActivityLog(input)
}

export async function markActivityUndone(id: string): Promise<void> {
  if (supabase) {
    const { error } = await supabase.from('activity_log').update({ undone: true }).eq('id', id)
    if (error) throw error
    return
  }
  updateLocalActivityLog(id, { undone: true })
}
