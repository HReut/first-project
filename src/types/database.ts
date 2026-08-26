// Row shapes exactly as they come back from Supabase (snake_case, matching
// supabase/migrations/0001_init.sql). Repos in src/data/ map these to the
// camelCase domain types in src/types.ts.

export type PersonRow = 'Reut' | 'Keren'
export type AccountRow = 'reut_personal' | 'keren_personal' | 'shared'
export type TransactionStatusRow = 'pending' | 'on_budget' | 'exceeded'
export type TransactionSourceRow = 'manual' | 'email_auto' | 'import' | 'recurring'

export interface CategoryRow {
  id: string
  name: string
  color_code: string
  icon: string
  monthly_budget_limit: number | null
  created_at: string
}

export interface TransactionRow {
  id: string
  date: string // ISO yyyy-mm-dd
  merchant: string
  amount: number
  category_id: string
  person: PersonRow
  account: AccountRow
  status: TransactionStatusRow
  source: TransactionSourceRow
  created_at: string
}

export interface EmailSyncRuleRow {
  id: string
  target_email: string
  merchant_keyword: string
  default_category_id: string
  default_person: PersonRow
  is_active: boolean
  created_at: string
}

export interface MappingRuleRow {
  id: string
  merchant_key: string
  category_id: string | null
  person: PersonRow | null
  updated_at: string
}

export interface BudgetLimitOverrideRow {
  id: string
  category_id: string
  start_month: string
  end_month: string | null
  limit_amount: number | null
  created_at: string
}

export interface AccountBalanceRow {
  id: string
  starting_balance: number
  set_at: string
  updated_at: string
}

export interface SavingsGoalRow {
  id: string
  name: string
  target_amount: number
  saved_amount: number
  created_at: string
}

export interface ActivityLogRow {
  id: string
  entity_type: string
  action: string
  summary: string
  before_data: unknown
  performed_by: PersonRow
  performed_at: string
  undone: boolean
}

export interface RecurringRuleRow {
  id: string
  merchant: string
  amount: number
  category_id: string
  account: AccountRow
  person: PersonRow
  interval_months: number
  anchor_month: string
  day_of_month: number
  total_occurrences: number | null
  occurrences_generated: number
  is_active: boolean
  last_generated_month: string | null
  created_at: string
}
