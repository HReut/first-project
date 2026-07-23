import type { Category, Person, Transaction } from '../types.ts'

interface MerchantSpec {
  name: string
  /** Merchants people mostly receive as an email receipt (subscriptions, bills, delivery apps). */
  emailLikely?: boolean
}

const MERCHANTS: Record<Category, MerchantSpec[]> = {
  Groceries: [{ name: 'Shufersal' }, { name: 'Rami Levy' }, { name: 'Victory' }],
  Dining: [{ name: 'Aroma Espresso Bar' }, { name: 'Cafe Cafe' }, { name: 'Wolt', emailLikely: true }],
  Transport: [{ name: 'Pango' }, { name: 'Paz Gas Station' }, { name: 'Rav-Kav Recharge' }],
  Utilities: [
    { name: 'Israel Electric Corp', emailLikely: true },
    { name: 'Bezeq', emailLikely: true },
    { name: 'Municipal Tax (Arnona)', emailLikely: true },
  ],
  Shopping: [{ name: 'Zara' }, { name: 'KSP' }, { name: 'AliExpress', emailLikely: true }],
  Entertainment: [
    { name: 'Netflix', emailLikely: true },
    { name: 'Cinema City' },
    { name: 'Spotify', emailLikely: true },
  ],
  Health: [{ name: 'Super-Pharm' }, { name: 'Clalit Health Services' }, { name: 'Dr. Levi Dental' }],
  Housing: [{ name: 'Monthly Rent', emailLikely: true }, { name: 'Home Center' }, { name: 'ACE Hardware' }],
}

const AMOUNT_RANGE: Record<Category, [number, number]> = {
  Groceries: [60, 450],
  Dining: [25, 220],
  Transport: [20, 350],
  Utilities: [80, 600],
  Shopping: [40, 900],
  Entertainment: [20, 150],
  Health: [30, 500],
  Housing: [300, 4500],
}

const CATEGORIES = Object.keys(MERCHANTS) as Category[]

// Deterministic PRNG (mulberry32) so the mock dataset looks the same across reloads.
function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function pick<T>(items: T[], rand: () => number): T {
  return items[Math.floor(rand() * items.length)]
}

function randomAmount(range: [number, number], rand: () => number): number {
  const [min, max] = range
  return Math.round(min + rand() * (max - min))
}

const MONTHS_OF_HISTORY = 4
const TRANSACTIONS_PER_PERSON_PER_MONTH = 14

export function createMockTransactions(referenceDate = new Date()): Transaction[] {
  const rand = mulberry32(42)
  const transactions: Transaction[] = []
  const people: Person[] = ['me', 'partner']
  let counter = 0

  for (let monthOffset = 0; monthOffset < MONTHS_OF_HISTORY; monthOffset++) {
    const monthAnchor = new Date(referenceDate.getFullYear(), referenceDate.getMonth() - monthOffset, 1)
    const daysInMonth = new Date(monthAnchor.getFullYear(), monthAnchor.getMonth() + 1, 0).getDate()
    const isCurrentMonth = monthOffset === 0
    const maxDay = isCurrentMonth ? referenceDate.getDate() : daysInMonth

    for (const person of people) {
      for (let i = 0; i < TRANSACTIONS_PER_PERSON_PER_MONTH; i++) {
        const category = pick(CATEGORIES, rand)
        const merchant = pick(MERCHANTS[category], rand)
        const day = Math.max(1, Math.floor(rand() * maxDay) + 1)
        const date = new Date(monthAnchor.getFullYear(), monthAnchor.getMonth(), day)
        const emailChance = merchant.emailLikely ? 0.85 : 0.15

        counter++
        transactions.push({
          id: `tx-${counter}`,
          date: isoDate(date),
          merchant: merchant.name,
          category,
          person,
          amount: randomAmount(AMOUNT_RANGE[category], rand),
          source: rand() < emailChance ? 'email' : 'manual',
        })
      }
    }
  }

  return transactions
}
