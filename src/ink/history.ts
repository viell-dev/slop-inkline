// Undo and redo over immutable states, such as documents: each step keeps
// the whole state, which costs little since unchanged strokes are shared.

export class History<State> {
  #past: State[] = [];
  #future: State[] = [];
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
    this.#past.push(this.#present);
    if (this.#past.length > this.#limit) this.#past.shift();
    this.#present = state;
    this.#future = [];
  }

  /** Steps back, returning the new present, or undefined at the start. */
  undo(): State | undefined {
    const previous = this.#past.pop();
    if (previous === undefined) return undefined;
    this.#future.push(this.#present);
    this.#present = previous;
    return previous;
  }

  /** Steps forward again, or returns undefined with nothing to redo. */
  redo(): State | undefined {
    const next = this.#future.pop();
    if (next === undefined) return undefined;
    this.#past.push(this.#present);
    this.#present = next;
    return next;
  }
}
