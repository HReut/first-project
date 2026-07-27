import type { Person } from '../types.ts'

/** Local-only UI preference (never sent to Supabase): which inbox each person
 * has entered and whether auto-capture is switched on for it. This is a gate
 * for a future email-parsing integration — it does not connect to anything
 * itself yet. */
export interface EmailAccountSetting {
  email: string
  autoCaptureEnabled: boolean
}

const STORAGE_KEY = 'opa-tulik:email-accounts'

const DEFAULTS: Record<Person, EmailAccountSetting> = {
  Reut: { email: '', autoCaptureEnabled: false },
  Keren: { email: '', autoCaptureEnabled: false },
}

export function loadEmailAccountSettings(): Record<Person, EmailAccountSetting> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULTS }
    const parsed = JSON.parse(raw)
    return {
      Reut: { ...DEFAULTS.Reut, ...parsed.Reut },
      Keren: { ...DEFAULTS.Keren, ...parsed.Keren },
    }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveEmailAccountSettings(settings: Record<Person, EmailAccountSetting>): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
}
