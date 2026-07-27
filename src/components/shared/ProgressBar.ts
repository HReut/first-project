import { budgetPercent, budgetStatus } from '../../utils/budget.ts'

/** Green/yellow/red progress bar for spend vs. a (possibly absent) limit.
 * Pure render function — callers compose their own surrounding labels/amounts. */
export function renderProgressBar(spent: number, limit: number | null): string {
  const percent = budgetPercent(spent, limit)
  const status = budgetStatus(spent, limit)
  return `
    <div class="progress-bar" data-status="${status}">
      <div class="progress-bar__track">
        <div class="progress-bar__fill" style="width: ${percent}%"></div>
      </div>
    </div>
  `
}
