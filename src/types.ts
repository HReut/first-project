export type Person = 'Reut' | 'Keren'
export type Currency = 'ILS' | 'USD' | 'EUR'
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
  /** Always the ILS-equivalent — every total/budget/chart in the app sums
   * this, converted (and frozen) at whatever exchange rate was in effect
   * when the transaction was created/edited. Equals `originalAmount` when
   * `currency` is 'ILS'. */
  amount: number
  /** What currency the purchase actually happened in. */
  currency: Currency
  /** The amount in `currency` — what the Transactions table and cards show
   * for this row, since that's what a person actually paid/saw on their
   * card. Equals `amount` when `currency` is 'ILS'. */
  originalAmount: number
  categoryId: string
  person: Person
  account: Account
  status: TransactionStatus
  source: TransactionSource
  /** When this row was actually saved to the household's data — not the
   * transaction's own `date`. Lets "recently added" sort by when it was
   * entered/imported rather than when the purchase happened, useful right
   * after a big import to see what just came in. Server-generated. */
  createdAt: string
}

export type NewTransaction = Omit<Transaction, 'id' | 'createdAt'>

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
 * on its own (see dueMonthsForRule()). `lastGeneratedMonth` tracks
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

/** The household-set fallback rates (₪ per $ and ₪ per €) used to convert a
 * USD/EUR transaction's originalAmount into its ILS-equivalent amount when
 * the live historical lookup fails — see resolveIlsAmount() in
 * src/utils/currency.ts. Recalibrating this only affects transactions saved
 * afterward; past ones keep whatever rate was in effect when they were
 * entered, same "historical FX, not mark-to-market" logic real accounting
 * uses. Either rate can be null if that currency's fallback was never set —
 * setting one doesn't require setting the other. */
export interface ExchangeRate {
  usdToIls: number | null
  eurToIls: number | null
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
export type ActivityEntityType = 'transaction' | 'budget_limit' | 'settlement' | 'category' | 'recurring_rule' | 'account_balance' | 'savings_goal'
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

/** A named savings target — saved/target amounts are edited directly, same
 * "just re-enter the true number" model as AccountBalance, since savings
 * aren't necessarily sitting in the account this app already tracks. */
export interface SavingsGoal {
  id: string
  name: string
  targetAmount: number
  savedAmount: number
}

export type NewSavingsGoal = Omit<SavingsGoal, 'id'>

/** beforeData shape for a savings_goal 'deleted' entry. */
export interface SavingsGoalDeletedBefore {
  goal: SavingsGoal
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

export type View = 'overview' | 'transactions' | 'budgets' | 'savings' | 'analytics' | 'history' | 'settings'

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
  exchangeRate: ExchangeRate | null
  activityLog: ActivityLogEntry[]
  savingsGoals: SavingsGoal[]
  filters: Filters
}
