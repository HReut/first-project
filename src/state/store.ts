type Listener<T> = (state: T) => void

/** Minimal pub-sub store: enough state management for a single-page dashboard
 * without pulling in a framework. */
export class Store<T extends object> {
  #state: T
  #listeners = new Set<Listener<T>>()

  constructor(initialState: T) {
    this.#state = initialState
  }

  getState(): T {
    return this.#state
  }

  setState(patch: Partial<T>): void {
    this.#state = { ...this.#state, ...patch }
    this.#listeners.forEach((listener) => listener(this.#state))
  }

  subscribe(listener: Listener<T>): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }
}
