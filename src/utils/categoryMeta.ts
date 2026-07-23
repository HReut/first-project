import type { Category, Person } from '../types.ts'

export const CATEGORIES: Category[] = [
  'Groceries',
  'Dining',
  'Transport',
  'Utilities',
  'Shopping',
  'Entertainment',
  'Health',
  'Housing',
]

// Maps each category to a categorical color slot defined in style.css (--cat-1..--cat-8).
export const CATEGORY_COLOR_VAR: Record<Category, string> = {
  Groceries: '--cat-1',
  Dining: '--cat-2',
  Transport: '--cat-3',
  Utilities: '--cat-4',
  Shopping: '--cat-5',
  Entertainment: '--cat-6',
  Health: '--cat-7',
  Housing: '--cat-8',
}

export const PERSON_LABEL: Record<Person, string> = {
  me: 'Me',
  partner: 'Partner',
}

export const PERSON_INITIAL: Record<Person, string> = {
  me: 'M',
  partner: 'P',
}
