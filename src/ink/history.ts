// Undo and redo over immutable states, such as documents: each step keeps
// the whole state, which costs little since unchanged strokes are shared.

/** A stored state, wrapped so that an empty stack differs from any state. */
interface Entry<State> {
  readonly state: State;
}

export class History<State> {
  #past: Entry<State>[] = [];
  #future: Entry<State>[] = [];
  #present: State;
  readonly #limit: number;

  /** Starts at `initial`, keeping at most `limit` states to undo to. */
  constructor(initial: State, limit = 500) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error("the limit is a whole number of at least 1");
    }
    this.#present = initial;
    this.#limit = limit;
  }

  get present(): State {
    return this.#present;
  }

  get canUndo(): boolean {
    return this.#past.length > 0;
  }

  get canRedo(): boolean {
    return this.#future.length > 0;
  }

  /** Makes `state` the present, forgetting anything that could be redone. */
  push(state: State): void {
    this.#past.push({ state: this.#present });
    if (this.#past.length > this.#limit) this.#past.shift();
    this.#present = state;
    this.#future = [];
  }

  /** Steps back, returning whether there was a step to undo. */
  undo(): boolean {
    const previous = this.#past.pop();
    if (previous === undefined) return false;
    this.#future.push({ state: this.#present });
    this.#present = previous.state;
    return true;
  }

  /** Steps forward again, returning whether there was a step to redo. */
  redo(): boolean {
    const next = this.#future.pop();
    if (next === undefined) return false;
    this.#past.push({ state: this.#present });
    this.#present = next.state;
    return true;
  }

  /**
   * Replaces every state, to undo and to redo as well as the present, with
   * `change` of it. A state that appears more than once stays one state, so
   * that comparing states by identity still works.
   */
  map(change: (state: State) => State): void {
    const changed = new Map<State, Entry<State>>();
    const apply = (state: State): State => {
      const known = changed.get(state);
      if (known !== undefined) return known.state;
      const next = change(state);
      changed.set(state, { state: next });
      return next;
    };
    this.#past = this.#past.map((entry) => ({ state: apply(entry.state) }));
    this.#future = this.#future.map((entry) => ({ state: apply(entry.state) }));
    this.#present = apply(this.#present);
  }
}
