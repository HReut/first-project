export type Person = 'Reut' | 'Keren'
/** Which "pocket" a transaction was paid from. Personal accounts are still
 * household expenses paid individually — see computeSplitBalance() in
 * insights.ts for how each value affects the Reut/Keren settlement math. */
export type Account = 'reut_personal' | 'keren_personal' | 'shared'
/** 'pending' = imported/unreviewed. Reviewing a pending transaction snapshots
 * its category's current budget standing into 'on_budget' or 'exceeded' —
 * see markReviewed() in TransactionsView.ts. */
export type TransactionStatus = 'pending' | 'on_budget' | 'exceeded'
export type TransactionSource = 'manual' | 'email_auto' | 'import' | 'recurring'

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
  account: Account
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

/** A bill that repeats every N months (rent, internet, building committee…).
 * `anchorMonth` (YYYY-MM) is the first month it's due; due months are
 * anchorMonth, anchorMonth+intervalMonths, +2*intervalMonths, etc. —
 * see isRuleDueForMonth() in src/utils/recurring.ts. `lastGeneratedMonth`
 * tracks the last month a transaction was auto-created for this rule, so
 * the same month is never generated twice. */
export interface RecurringRule {
  id: string
  merchant: string
  amount: number
  categoryId: string
  account: Account
  person: Person
  intervalMonths: number // 1 = every month, 2 = every other month, etc.
  anchorMonth: string // YYYY-MM
  dayOfMonth: number // 1-28, day of month the generated transaction is dated
  isActive: boolean
  lastGeneratedMonth: string | null // YYYY-MM
}

export type NewRecurringRule = Omit<RecurringRule, 'id' | 'lastGeneratedMonth'>

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
  recurringRules: RecurringRule[]
  filters: Filters
}
