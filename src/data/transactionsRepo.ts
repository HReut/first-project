import { supabase } from '../lib/supabaseClient.ts'
import type { NewTransaction, Transaction } from '../types.ts'
import type { TransactionRow } from '../types/database.ts'
import { loadLocalCategories, loadLocalTransactions, saveLocalTransactions } from './localStore.ts'

function fromRow(row: TransactionRow): Transaction {
  return {
    id: row.id,
    date: row.date,
    merchant: row.merchant,
    amount: row.amount,
    currency: row.currency,
    originalAmount: row.original_amount,
    categoryId: row.category_id,
    person: row.person,
    account: row.account,
    status: row.status,
    source: row.source,
    createdAt: row.created_at,
  }
}

function toRow(input: Partial<NewTransaction>): Partial<Omit<TransactionRow, 'id' | 'created_at'>> {
  const row: Partial<Omit<TransactionRow, 'id' | 'created_at'>> = {}
  if (input.date !== undefined) row.date = input.date
  if (input.merchant !== undefined) row.merchant = input.merchant
  if (input.amount !== undefined) row.amount = input.amount
  if (input.currency !== undefined) row.currency = input.currency
  if (input.originalAmount !== undefined) row.original_amount = input.originalAmount
  if (input.categoryId !== undefined) row.category_id = input.categoryId
  if (input.person !== undefined) row.person = input.person
  if (input.account !== undefined) row.account = input.account
  if (input.status !== undefined) row.status = input.status
  if (input.source !== undefined) row.source = input.source
  return row
}

export async function listTransactions(): Promise<Transaction[]> {
  if (supabase) {
    const { data, error } = await supabase.from('transactions').select('*').order('date', { ascending: false })
    if (error) throw error
    return (data as TransactionRow[]).map(fromRow)
  }
  return loadLocalTransactions(loadLocalCategories())
}

export async function createTransaction(input: NewTransaction): Promise<Transaction> {
  if (supabase) {
    const { data, error } = await supabase.from('transactions').insert(toRow(input)).select().single()
    if (error) throw error
    return fromRow(data as TransactionRow)
  }
  const transactions = loadLocalTransactions(loadLocalCategories())
  const created: Transaction = { ...input, id: crypto.randomUUID(), createdAt: new Date().toISOString() }
  saveLocalTransactions([created, ...transactions])
  return created
}

/** Bulk insert used by the CSV import pipeline (and, later, any email-import
 * job) — same NewTransaction shape as createTransaction, just many at once. */
export async function createTransactions(inputs: NewTransaction[]): Promise<Transaction[]> {
  if (inputs.length === 0) return []

  if (supabase) {
    const { data, error } = await supabase.from('transactions').insert(inputs.map(toRow)).select()
    if (error) throw error
    return (data as TransactionRow[]).map(fromRow)
  }
  const transactions = loadLocalTransactions(loadLocalCategories())
  const created: Transaction[] = inputs.map((input) => ({ ...input, id: crypto.randomUUID(), createdAt: new Date().toISOString() }))
  saveLocalTransactions([...created, ...transactions])
  return created
}

export async function updateTransaction(id: string, patch: Partial<NewTransaction>): Promise<Transaction> {
  if (supabase) {
    const { data, error } = await supabase.from('transactions').update(toRow(patch)).eq('id', id).select().single()
    if (error) throw error
    return fromRow(data as TransactionRow)
  }
  const transactions = loadLocalTransactions(loadLocalCategories())
  const updated = transactions.map((tx) => (tx.id === id ? { ...tx, ...patch } : tx))
  saveLocalTransactions(updated)
  return updated.find((tx) => tx.id === id)!
}

/** Re-inserts previously-deleted transactions with their original ids —
 * used by History's Undo on a transaction delete/bulk-delete entry.
 * createTransactions() can't be reused here since it always lets the
 * database generate a fresh id, which would make the restored row look
 * like a brand new transaction rather than the same one coming back. */
export async function restoreTransactions(transactions: Transaction[]): Promise<Transaction[]> {
  if (transactions.length === 0) return []

  if (supabase) {
    const rows = transactions.map((tx) => ({ id: tx.id, ...toRow(tx) }))
    const { data, error } = await supabase.from('transactions').insert(rows).select()
    if (error) throw error
    return (data as TransactionRow[]).map(fromRow)
  }
  const existing = loadLocalTransactions(loadLocalCategories())
  saveLocalTransactions([...transactions, ...existing])
  return transactions
}

export async function deleteTransactions(ids: string[]): Promise<void> {
  if (supabase) {
    const { error } = await supabase.from('transactions').delete().in('id', ids)
    if (error) throw error
    return
  }
  const idSet = new Set(ids)
  const transactions = loadLocalTransactions(loadLocalCategories())
  saveLocalTransactions(transactions.filter((tx) => !idSet.has(tx.id)))
}
