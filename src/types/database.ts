// Row shapes exactly as they come back from Supabase (snake_case, matching
// supabase/migrations/0001_init.sql). Repos in src/data/ map these to the
// camelCase domain types in src/types.ts.

export type PersonRow = 'Reut' | 'Keren'
export type TransactionStatusRow = 'approved' | 'needs_review'
export type TransactionSourceRow = 'manual' | 'email_auto'

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
