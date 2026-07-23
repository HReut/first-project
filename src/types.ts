export type Person = 'me' | 'partner'

export type Category =
  | 'Groceries'
  | 'Dining'
  | 'Transport'
  | 'Utilities'
  | 'Shopping'
  | 'Entertainment'
  | 'Health'
  | 'Housing'

export type TransactionSource = 'manual' | 'email'

export interface Transaction {
  id: string
  date: string // ISO yyyy-mm-dd
  merchant: string
  category: Category
  person: Person
  amount: number
  source: TransactionSource
}

export type PeriodFilter =
  | { kind: 'month'; month: string } // YYYY-MM
  | { kind: 'range'; start: string; end: string } // ISO dates, inclusive
  | { kind: 'all' }

export interface Filters {
  category: Category | 'all'
  person: Person | 'all'
  period: PeriodFilter
}

export interface AppState {
  transactions: Transaction[]
  filters: Filters
}
