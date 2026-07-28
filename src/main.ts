import './style.css'
import { isSupabaseConfigured } from './lib/supabaseClient.ts'
import { mountApp } from './components/App.ts'
import { mountAuthGate } from './components/AuthGate.ts'

const root = document.querySelector<HTMLDivElement>('#app')!

if (isSupabaseConfigured) {
  mountAuthGate(root)
} else {
  mountApp(root)
}
