import type { AccountBalance, ActivityLogEntry, BudgetLimitOverride, Category, EmailSyncRule, MappingRule, NewActivityLogEntry, RecurringRule, SavingsGoal, Transaction } from '../types.ts'
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
  recurringRules: 'opa-tulik:recurring-rules',
  accountBalance: 'opa-tulik:account-balance',
  budgetLimitOverrides: 'opa-tulik:budget-limit-overrides',
  activityLog: 'opa-tulik:activity-log',
  savingsGoals: 'opa-tulik:savings-goals',
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
  if (existing) {
    // Backfill for local data saved before the `account` field existed.
    if (existing.some((tx) => !tx.account)) {
      const migrated = existing.map((tx) => ({ ...tx, account: tx.account ?? 'shared' }))
      write(KEYS.transactions, migrated)
      return migrated
    }
    return existing
  }
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

export function loadLocalRecurringRules(): RecurringRule[] {
  const existing = read<RecurringRule[]>(KEYS.recurringRules)
  if (existing) return existing
  write(KEYS.recurringRules, [])
  return []
}

export function saveLocalRecurringRules(rules: RecurringRule[]): void {
  write(KEYS.recurringRules, rules)
}

export function loadLocalAccountBalance(): AccountBalance | null {
  return read<AccountBalance>(KEYS.accountBalance)
}

export function saveLocalAccountBalance(balance: AccountBalance): void {
  write(KEYS.accountBalance, balance)
}

export function loadLocalBudgetLimitOverrides(): BudgetLimitOverride[] {
  const existing = read<BudgetLimitOverride[]>(KEYS.budgetLimitOverrides)
  if (existing) return existing
  write(KEYS.budgetLimitOverrides, [])
  return []
}

export function saveLocalBudgetLimitOverrides(overrides: BudgetLimitOverride[]): void {
  write(KEYS.budgetLimitOverrides, overrides)
}

export function loadLocalActivityLog(): ActivityLogEntry[] {
  const existing = read<ActivityLogEntry[]>(KEYS.activityLog)
  if (existing) return existing
  write(KEYS.activityLog, [])
  return []
}

export function appendLocalActivityLog(input: NewActivityLogEntry): ActivityLogEntry {
  const entries = loadLocalActivityLog()
  const created: ActivityLogEntry = { ...input, id: crypto.randomUUID(), performedAt: new Date().toISOString(), undone: false }
  write(KEYS.activityLog, [created, ...entries])
  return created
}

export function updateLocalActivityLog(id: string, patch: Partial<ActivityLogEntry>): void {
  const entries = loadLocalActivityLog()
  write(
    KEYS.activityLog,
    entries.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)),
  )
}

export function loadLocalSavingsGoals(): SavingsGoal[] {
  const existing = read<SavingsGoal[]>(KEYS.savingsGoals)
  if (existing) return existing
  write(KEYS.savingsGoals, [])
  return []
}

export function saveLocalSavingsGoals(goals: SavingsGoal[]): void {
  write(KEYS.savingsGoals, goals)
}
