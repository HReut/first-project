import type { Store } from '../state/store.ts'
import type { AppState, Category, Person } from '../types.ts'
import { CATEGORIES } from '../utils/categoryMeta.ts'

type PeriodPreset = 'this-month' | 'last-month' | 'last-3' | 'last-6' | 'all' | 'custom'

function monthKey(monthsAgo: number, from = new Date()): string {
  const d = new Date(from.getFullYear(), from.getMonth() - monthsAgo, 1)
  return d.toISOString().slice(0, 7)
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function monthsAgoRange(months: number): { start: string; end: string } {
  const end = new Date()
  const start = new Date()
  start.setMonth(start.getMonth() - months)
  return { start: isoDate(start), end: isoDate(end) }
}

/** Owns its own DOM after the initial render and patches it directly on
 * interaction, rather than re-rendering from the store — it is the only
 * writer of `filters`, so there is nothing external to react to, and this
 * avoids blowing away focus/cursor position in the date inputs. */
export class FilterBar {
  #container: HTMLElement
  #store: Store<AppState>
  #preset: PeriodPreset = 'this-month'

  constructor(container: HTMLElement, store: Store<AppState>) {
    this.#container = container
    this.#store = store
    this.render()
  }

  private updateFilters(patch: Partial<AppState['filters']>): void {
    const current = this.#store.getState().filters
    this.#store.setState({ filters: { ...current, ...patch } })
  }

  private render(): void {
    const { filters } = this.#store.getState()

    this.#container.innerHTML = `
      <div class="filter-group filter-group--person" role="group" aria-label="Filter by person">
        <button type="button" class="segmented-btn" data-person="all">All</button>
        <button type="button" class="segmented-btn" data-person="me">Me</button>
        <button type="button" class="segmented-btn" data-person="partner">Partner</button>
      </div>

      <label class="filter-group">
        <span class="filter-group__label">Category</span>
        <select class="filter-select" id="category-select">
          <option value="all">All categories</option>
          ${CATEGORIES.map((c) => `<option value="${c}">${c}</option>`).join('')}
        </select>
      </label>

      <label class="filter-group">
        <span class="filter-group__label">Period</span>
        <select class="filter-select" id="period-select">
          <option value="this-month">This month</option>
          <option value="last-month">Last month</option>
          <option value="last-3">Last 3 months</option>
          <option value="last-6">Last 6 months</option>
          <option value="all">All time</option>
          <option value="custom">Custom range&hellip;</option>
        </select>
      </label>

      <div class="filter-group filter-group--custom-range" id="custom-range" hidden>
        <label class="filter-group">
          <span class="filter-group__label">From</span>
          <input type="date" class="filter-input" id="range-start">
        </label>
        <label class="filter-group">
          <span class="filter-group__label">To</span>
          <input type="date" class="filter-input" id="range-end">
        </label>
      </div>
    `

    const personButtons = Array.from(this.#container.querySelectorAll<HTMLButtonElement>('[data-person]'))
    const setActivePerson = (person: Person | 'all') => {
      personButtons.forEach((btn) => btn.classList.toggle('is-active', btn.dataset.person === person))
    }
    setActivePerson(filters.person)
    personButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const person = btn.dataset.person as Person | 'all'
        setActivePerson(person)
        this.updateFilters({ person })
      })
    })

    const categorySelect = this.#container.querySelector<HTMLSelectElement>('#category-select')!
    categorySelect.value = filters.category
    categorySelect.addEventListener('change', () => {
      this.updateFilters({ category: categorySelect.value as Category | 'all' })
    })

    const periodSelect = this.#container.querySelector<HTMLSelectElement>('#period-select')!
    periodSelect.value = this.#preset
    const customRangeEl = this.#container.querySelector<HTMLElement>('#custom-range')!
    customRangeEl.hidden = this.#preset !== 'custom'

    periodSelect.addEventListener('change', () => {
      this.#preset = periodSelect.value as PeriodPreset
      customRangeEl.hidden = this.#preset !== 'custom'
      if (this.#preset !== 'custom') {
        this.applyPreset(this.#preset)
      }
    })

    const startInput = this.#container.querySelector<HTMLInputElement>('#range-start')!
    const endInput = this.#container.querySelector<HTMLInputElement>('#range-end')!
    const applyCustomRange = () => {
      if (startInput.value && endInput.value) {
        this.updateFilters({ period: { kind: 'range', start: startInput.value, end: endInput.value } })
      }
    }
    startInput.addEventListener('change', applyCustomRange)
    endInput.addEventListener('change', applyCustomRange)
  }

  private applyPreset(preset: Exclude<PeriodPreset, 'custom'>): void {
    if (preset === 'this-month') {
      this.updateFilters({ period: { kind: 'month', month: monthKey(0) } })
    } else if (preset === 'last-month') {
      this.updateFilters({ period: { kind: 'month', month: monthKey(1) } })
    } else if (preset === 'last-3') {
      this.updateFilters({ period: { kind: 'range', ...monthsAgoRange(3) } })
    } else if (preset === 'last-6') {
      this.updateFilters({ period: { kind: 'range', ...monthsAgoRange(6) } })
    } else {
      this.updateFilters({ period: { kind: 'all' } })
    }
  }
}
