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

/** A bill that repeats every N months (rent, internet, building committee…),
 * or a fixed-length installment plan (a purchase split into N card
 * payments) — the same mechanism, just bounded. `anchorMonth` (YYYY-MM) is
 * the first due month; due months are anchorMonth, anchorMonth+intervalMonths,
 * +2*intervalMonths, etc. — see isRuleDueForMonth() in src/utils/recurring.ts.
 * `totalOccurrences` is null for an ongoing bill, or a count for an
 * installment plan — once occurrencesGenerated reaches it, generation stops
 * on its own (see findRulesDueForGeneration()). `lastGeneratedMonth` tracks
 * the last month a transaction was auto-created, so the same month is never
 * generated twice. */
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
  totalOccurrences: number | null // null = ongoing bill; N = installment plan
  occurrencesGenerated: number
  isActive: boolean
  lastGeneratedMonth: string | null // YYYY-MM
}

export type NewRecurringRule = Omit<RecurringRule, 'id' | 'lastGeneratedMonth' | 'occurrencesGenerated'>

/** A scoped exception to a category's default monthlyBudgetLimit — "this
 * month only" (startMonth === endMonth) or "from now on" (endMonth null,
 * open-ended). The category's flat monthlyBudgetLimit is still the
 * fallback for any month with no override — see resolveBudgetLimitForMonth()
 * in src/utils/insights.ts. */
export interface BudgetLimitOverride {
  id: string
  categoryId: string
  startMonth: string // YYYY-MM
  endMonth: string | null // YYYY-MM, null = open-ended
  limit: number | null // null = "no limit" for the covered month(s)
}

export type NewBudgetLimitOverride = Omit<BudgetLimitOverride, 'id'>

/** The shared account's real balance, entered once by a household member
 * and recalibrated whenever they want (e.g. after checking the real bank
 * balance). "Total Available" on Overview is startingBalance minus
 * 'shared'-account spending logged since setAt — see
 * computeTotalAvailable() in src/utils/insights.ts. */
export interface AccountBalance {
  startingBalance: number
  setAt: string // ISO yyyy-mm-dd
}

/** A household-wide record of "what changed, when, by whom" — every
 * meaningful change gets an entry; the ones that are actually risky to get
 * wrong (deleting transactions, changing a budget limit, settling up)
 * carry enough state in `beforeData` to undo with one click (see
 * HistoryView.ts). Settlement history lives here too, not in a separate
 * table — "currently settled as of" is the performedAt of the latest
 * non-undone entityType==='settlement' entry, see resolveSettledAfter() in
 * src/utils/activity.ts. */
export type ActivityEntityType = 'transaction' | 'budget_limit' | 'settlement' | 'category' | 'recurring_rule' | 'account_balance'
export type ActivityAction =
  | 'created'
  | 'updated'
  | 'deleted'
  | 'bulk_deleted'
  | 'bulk_recategorized'
  | 'bulk_marked_reviewed'
  | 'changed'
  | 'settled'

export interface ActivityLogEntry {
  id: string
  entityType: ActivityEntityType
  action: ActivityAction
  summary: string
  /** Undo-only, entityType/action-specific JSON — e.g. the deleted
   * Transaction row(s) for a transaction 'deleted'/'bulk_deleted' entry, or
   * the previous limit/overrides for a 'budget_limit' 'changed' entry. Null
   * for entries with no undo action (most of them). */
  beforeData: unknown
  performedBy: Person
  performedAt: string // ISO datetime
  undone: boolean
}

export type NewActivityLogEntry = Omit<ActivityLogEntry, 'id' | 'performedAt' | 'undone'>

/** beforeData shape for a transaction 'deleted' or 'bulk_deleted' entry. */
export interface TransactionDeletedBefore {
  transactions: Transaction[]
}

/** beforeData shape for a category 'deleted' entry — the category itself,
 * plus any budget_limit_overrides that cascade-deleted along with it (the
 * DB foreign key is ON DELETE CASCADE for that table), so undo can put both
 * back. */
export interface CategoryDeletedBefore {
  category: Category
  overrides: BudgetLimitOverride[]
}

/** beforeData shape for a recurring_rule 'deleted' entry — the rule as it
 * was, including its generation state, so undo doesn't regenerate an
 * already-paid month. */
export interface RecurringRuleDeletedBefore {
  rule: RecurringRule
}

/** beforeData shape for a budget_limit 'changed' entry — enough to put the
 * category back exactly how it was, whichever scope the edit used. Undo
 * always: restores previousCategoryLimit (a no-op unless the edit was
 * "All months"), deletes createdOverrideId if set (a no-op unless the edit
 * was "This month"/"From now on"), and restores previousOverrides if any
 * (a no-op unless the edit was "All months" and had overrides to wipe). */
export interface BudgetLimitChangedBefore {
  categoryId: string
  previousCategoryLimit: number | null
  previousOverrides: BudgetLimitOverride[]
  createdOverrideId: string | null
}

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

export type View = 'overview' | 'transactions' | 'budgets' | 'savings' | 'analytics' | 'accounts' | 'history' | 'security' | 'settings' | 'help'

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
  budgetLimitOverrides: BudgetLimitOverride[]
  accountBalance: AccountBalance | null
  activityLog: ActivityLogEntry[]
  filters: Filters
}
