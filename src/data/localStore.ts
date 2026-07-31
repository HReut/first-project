import type { Category, EmailSyncRule, MappingRule, Transaction } from '../types.ts'
import { SEED_CATEGORIES } from './mockCategories.ts'
import { createMockTransactions } from './mockTransactions.ts'

/** localStorage-backed fallback data source, used whenever Supabase isn't
 * configured (see src/lib/supabaseClient.ts). Seeded once on first read,
 * then read/written like a tiny local database. */

const KEYS = {
  categories: 'opa-tulik:categories',
  transactions: 'opa-tulik:transactions',
  emailRules: 'opa-tulik:email-rules',
  mappingRules: 'opa-tulik:mapping-rules',
} as const

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function write<T>(key: string, value: T): void {
  localStorage.setItem(key, JSON.stringify(value))
}

export function loadLocalCategories(): Category[] {
  const existing = read<Category[]>(KEYS.categories)
  if (existing) return existing
  const seeded = SEED_CATEGORIES.map((category) => ({ ...category, id: crypto.randomUUID() }))
  write(KEYS.categories, seeded)
  return seeded
}

export function saveLocalCategories(categories: Category[]): void {
  write(KEYS.categories, categories)
}

export function loadLocalTransactions(categories: Category[]): Transaction[] {
  const existing = read<Transaction[]>(KEYS.transactions)
  if (existing) return existing
  const seeded = createMockTransactions(categories)
  write(KEYS.transactions, seeded)
  return seeded
}

export function saveLocalTransactions(transactions: Transaction[]): void {
  write(KEYS.transactions, transactions)
}

export function loadLocalEmailRules(): EmailSyncRule[] {
  const existing = read<EmailSyncRule[]>(KEYS.emailRules)
  if (existing) return existing
  write(KEYS.emailRules, [])
  return []
}

export function saveLocalEmailRules(rules: EmailSyncRule[]): void {
  write(KEYS.emailRules, rules)
}

export function loadLocalMappingRules(): MappingRule[] {
  const existing = read<MappingRule[]>(KEYS.mappingRules)
  if (existing) return existing
  write(KEYS.mappingRules, [])
  return []
}

export function saveLocalMappingRules(rules: MappingRule[]): void {
  write(KEYS.mappingRules, rules)
}
