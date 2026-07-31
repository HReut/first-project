import { supabase } from './supabaseClient.ts'
import type { Person } from '../types.ts'

/** The only two Google accounts allowed into this household app — matches
 * the fixed Person = 'Reut' | 'Keren' union in src/types.ts. Also enforced
 * server-side by the RLS policies in supabase/migrations/0002_tighten_rls.sql,
 * so a non-whitelisted session can't read/write data even before this
 * client-side check signs it out. */
export const ALLOWED_EMAILS = ['reut.hefetz@gmail.com', 'kerenfr12@gmail.com'] as const

export function isEmailAllowed(email: string | null | undefined): boolean {
  return !!email && (ALLOWED_EMAILS as readonly string[]).includes(email)
}

/** Maps the signed-in Google account to its household Person — used as the
 * "paid by" fallback for imported rows that don't specify one. Defaults to
 * 'Reut' for any email outside the two-account whitelist (shouldn't happen,
 * since AuthGate already blocks those before the app mounts). */
export function personFromEmail(email: string | null | undefined): Person {
  return email === 'kerenfr12@gmail.com' ? 'Keren' : 'Reut'
}

export async function signInWithGoogle(): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured.')
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin },
  })
  if (error) throw error
}

export async function signOut(): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured.')
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

/** Normalizes the initial session fetch and subsequent auth state changes
 * into one callback shape: `email` is null when signed out. */
export function onAuthChange(cb: (email: string | null) => void): () => void {
  if (!supabase) throw new Error('Supabase is not configured.')

  supabase.auth.getSession().then(({ data }) => cb(data.session?.user.email ?? null))

  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((_event, session) => cb(session?.user.email ?? null))

  return () => subscription.unsubscribe()
}
