import type { Store } from '../../state/store.ts'
import type { AppState, NewSavingsGoal, Person, SavingsGoalDeletedBefore } from '../../types.ts'
import { formatCurrency } from '../../utils/format.ts'
import { createSavingsGoal, deleteSavingsGoal, updateSavingsGoal } from '../../data/savingsGoalsRepo.ts'
import { logActivity } from '../../data/activityLogRepo.ts'
import { confirmDialog } from '../shared/confirmDialog.ts'
import { showToast } from '../shared/Toast.ts'

/** Always the "good" green fill, capped at 100% — unlike budget progress,
 * more saved is never a bad sign, so there's no warning/critical state. */
function renderGoalProgress(saved: number, target: number): string {
  const percent = target > 0 ? Math.min(100, (saved / target) * 100) : 0
  return `
    <div class="progress-bar" style="flex-basis: 100%;">
      <div class="progress-bar__track">
        <div class="progress-bar__fill" style="width: ${percent}%"></div>
      </div>
    </div>
  `
}

export function mountSavingsView(root: HTMLElement, store: Store<AppState>, currentPerson: Person): void {
  root.innerHTML = `
    <section class="band band--hero">
      <div class="band__inner">
        <p class="eyebrow">Household finance</p>
        <h1>Savings.</h1>
        <p class="hero__subtitle">Track shared savings goals alongside your everyday budget.</p>
      </div>
    </section>

    <section class="band">
      <div class="band__inner">
        <section class="settings-card" aria-label="Savings goals">
          <h2 class="settings-card__title">Goals</h2>
          <p class="settings-card__desc">
            "Saved so far" is a number you update directly, the same way the shared account balance works — it's
            not calculated from your transactions, since savings might not sit in the same account.
          </p>
          <div class="settings-list" id="savings-list"></div>
        </section>
      </div>
    </section>
  `

  const listEl = root.querySelector<HTMLElement>('#savings-list')!

  /** Fire-and-forget, same reasoning as the other logXxx helpers in this
   * codebase: a logging failure shouldn't block the real action, but
   * shouldn't be silent either. */
  function logSavings(action: 'created' | 'updated' | 'deleted', summary: string, beforeData: unknown = null): void {
    logActivity({ entityType: 'savings_goal', action, summary, beforeData, performedBy: currentPerson })
      .then((entry) => {
        const { activityLog } = store.getState()
        store.setState({ activityLog: [entry, ...activityLog] })
      })
      .catch((err: unknown) => console.warn('Could not write to History — has migration 0010 been run?', err))
  }

  function render(state: AppState): void {
    listEl.innerHTML = `
      ${state.savingsGoals
        .map(
          (goal) => `
        <div class="settings-list__row" data-id="${goal.id}">
          <input type="text" class="name-input" value="${goal.name}" placeholder="Goal name" data-field="name">
          <span class="settings-list__inline-field">
            <span>Saved</span>
            <input type="number" class="budget-input" value="${goal.savedAmount}" min="0" step="10" data-field="savedAmount">
          </span>
          <span class="settings-list__inline-field">
            <span>of</span>
            <input type="number" class="budget-input" value="${goal.targetAmount}" min="1" step="10" data-field="targetAmount">
          </span>
          <span class="settings-list__usage">${Math.round(Math.min(100, (goal.savedAmount / goal.targetAmount) * 100))}%</span>
          <button type="button" class="btn btn--sm btn--danger" data-delete-goal="${goal.id}">Delete</button>
          ${renderGoalProgress(goal.savedAmount, goal.targetAmount)}
        </div>
      `,
        )
        .join('')}
      <div class="settings-list__row settings-list__row--add">
        <input type="text" class="name-input" id="new-goal-name" placeholder="Goal name (e.g. Vacation fund)">
        <span class="settings-list__inline-field">
          <span>Saved</span>
          <input type="number" class="budget-input" id="new-goal-saved" value="0" min="0" step="10">
        </span>
        <span class="settings-list__inline-field">
          <span>of</span>
          <input type="number" class="budget-input" id="new-goal-target" placeholder="Target" min="1" step="10">
        </span>
        <button type="button" class="btn btn--primary btn--sm" id="add-goal-btn">+ Add</button>
      </div>
    `

    if (state.savingsGoals.length === 0) {
      listEl.insertAdjacentHTML('afterbegin', `<p class="budget-summary__empty">No savings goals yet — add one below.</p>`)
    }
  }

  listEl.addEventListener('change', (event) => {
    const input = (event.target as HTMLElement).closest<HTMLInputElement>('[data-field]')
    if (!input) return
    const row = input.closest<HTMLElement>('.settings-list__row')!
    const id = row.dataset.id
    if (!id) return
    const field = input.dataset.field as keyof NewSavingsGoal
    const goal = store.getState().savingsGoals.find((g) => g.id === id)
    if (!goal) return

    const patch: Partial<NewSavingsGoal> = field === 'name' ? { name: input.value } : { [field]: Number(input.value) }
    updateSavingsGoal(id, patch).then((updated) => {
      const { savingsGoals } = store.getState()
      store.setState({ savingsGoals: savingsGoals.map((g) => (g.id === updated.id ? updated : g)) })
      logSavings('updated', `Updated savings goal ${updated.name} (${field === 'name' ? 'name' : field === 'savedAmount' ? 'saved amount' : 'target'})`)
    })
  })

  listEl.addEventListener('click', (event) => {
    const deleteBtn = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-delete-goal]')
    if (deleteBtn) {
      const id = deleteBtn.dataset.deleteGoal!
      const goal = store.getState().savingsGoals.find((g) => g.id === id)
      if (!goal) return
      confirmDialog(`Delete the "${goal.name}" savings goal? You can undo this from History.`, 'Delete').then((confirmed) => {
        if (!confirmed) return
        deleteSavingsGoal(id).then(() => {
          const { savingsGoals } = store.getState()
          store.setState({ savingsGoals: savingsGoals.filter((g) => g.id !== id) })
          const before: SavingsGoalDeletedBefore = { goal }
          logSavings('deleted', `Deleted savings goal ${goal.name}`, before)
        })
      })
      return
    }

    if ((event.target as HTMLElement).id === 'add-goal-btn') {
      const nameInput = listEl.querySelector<HTMLInputElement>('#new-goal-name')!
      const savedInput = listEl.querySelector<HTMLInputElement>('#new-goal-saved')!
      const targetInput = listEl.querySelector<HTMLInputElement>('#new-goal-target')!
      const name = nameInput.value.trim()
      const targetAmount = Number(targetInput.value)
      if (!name || !Number.isFinite(targetAmount) || targetAmount <= 0) {
        showToast('Enter a goal name and a target amount first.')
        return
      }
      const savedAmount = Number.isFinite(Number(savedInput.value)) ? Number(savedInput.value) : 0

      createSavingsGoal({ name, targetAmount, savedAmount }).then((created) => {
        const { savingsGoals } = store.getState()
        store.setState({ savingsGoals: [...savingsGoals, created] })
        logSavings('created', `Added savings goal ${created.name} (target ${formatCurrency(created.targetAmount)})`)
      })
    }
  })

  store.subscribe(render)
  render(store.getState())
}
