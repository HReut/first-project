export type Person = 'Reut' | 'Keren'
/** 'pending' = imported/unreviewed. Reviewing a pending transaction snapshots
 * its category's current budget standing into 'on_budget' or 'exceeded' —
 * see markReviewed() in TransactionsView.ts. */
export type TransactionStatus = 'pending' | 'on_budget' | 'exceeded'
export type TransactionSource = 'manual' | 'email_auto' | 'import'

export interface Category {
  id: string
  name: string
  colorCode: string
  icon: string
  monthlyBudgetLimit: number | null
}

export type NewCategory = Omit<Category, 'id'>

export interface Transaction {
  id: string
  date: string // ISO yyyy-mm-dd
  merchant: string
  amount: number
  categoryId: string
  person: Person
  status: TransactionStatus
  source: TransactionSource
}

export type NewTransaction = Omit<Transaction, 'id'>

export interface EmailSyncRule {
  id: string
  targetEmail: string
  merchantKeyword: string
  defaultCategoryId: string
  defaultPerson: Person
  isActive: boolean
}

export type NewEmailSyncRule = Omit<EmailSyncRule, 'id'>

/** The "learning memory" — a remembered category/person choice for a given
 * merchant, consulted during CSV import and offered for saving whenever an
 * inline table edit changes a transaction's category or person. */
export interface MappingRule {
  id: string
  merchantKey: string // normalized (trimmed, lowercased) merchant text used to match
  categoryId: string | null
  person: Person | null
  updatedAt: string
}

export type NewMappingRule = Omit<MappingRule, 'id' | 'updatedAt'>

export type PeriodFilter =
  | { kind: 'month'; month: string } // YYYY-MM
  | { kind: 'range'; start: string; end: string } // ISO dates, inclusive
  | { kind: 'all' }

export interface Filters {
  categoryId: string | 'all'
  person: Person | 'all'
  period: PeriodFilter
  search: string
}

export type View = 'overview' | 'transactions' | 'budgets' | 'savings' | 'analytics' | 'accounts' | 'security' | 'settings' | 'help'

export type LoadStatus = 'loading' | 'ready' | 'error'

export interface AppState {
  view: View
  status: LoadStatus
  error: string | null
  categories: Category[]
  transactions: Transaction[]
  emailRules: EmailSyncRule[]
  mappingRules: MappingRule[]
  filters: Filters
}
