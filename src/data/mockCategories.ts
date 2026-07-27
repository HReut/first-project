import type { NewCategory } from '../types.ts'

// Carried over from the prototype's fixed 8-category palette — kept in sync
// with the seed INSERT in supabase/migrations/0001_init.sql.
export const SEED_CATEGORIES: NewCategory[] = [
  { name: 'Groceries', colorCode: '#2a78d6', icon: '🛒', monthlyBudgetLimit: 2000 },
  { name: 'Dining', colorCode: '#eb6834', icon: '🍽️', monthlyBudgetLimit: 900 },
  { name: 'Transport', colorCode: '#1baf7a', icon: '🚗', monthlyBudgetLimit: 700 },
  { name: 'Utilities', colorCode: '#eda100', icon: '💡', monthlyBudgetLimit: 1200 },
  { name: 'Shopping', colorCode: '#e87ba4', icon: '🛍️', monthlyBudgetLimit: 1000 },
  { name: 'Entertainment', colorCode: '#008300', icon: '🎬', monthlyBudgetLimit: 500 },
  { name: 'Health', colorCode: '#4a3aa7', icon: '💊', monthlyBudgetLimit: 800 },
  { name: 'Housing', colorCode: '#e34948', icon: '🏠', monthlyBudgetLimit: 6000 },
]
