import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

/** False until `.env` is filled in with real project credentials — every
 * repo in `src/data/` falls back to the localStorage mock store while this
 * is false, so the app is fully usable before Supabase is connected. */
export const isSupabaseConfigured = Boolean(url && anonKey)

export const supabase: SupabaseClient | null = isSupabaseConfigured ? createClient(url, anonKey) : null
