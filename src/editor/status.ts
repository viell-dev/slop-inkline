// The editor's status line: what the editor did last, which screen readers
// hear as it changes, as it is a live region. A plain module, so that unit
// tests can check its rules; modal.ts shows it.
//
// Whatever the person does in the editor replaces what the line says: with
// what that did, when there is something to say, or with nothing. So a
// message never stays to read as the result of a later action it was not
// about, as "Zoomed out" stayed after Fit (#302). Emptying the line says
// nothing to a screen reader, which hears what a live region gains, not what
// it loses, so an action with nothing to say is silent rather than announced:
// a button that turns something on or off says so by its pressed state.
// A message about something still under way or still wrong, such as a save
// that is running or a draft that storage refused, stays through such
// actions for as long as it holds, as emptying the line would hide it.

export class StatusLine {
  readonly #show: (text: string) => void;
  #text = "";
  /** Whether what the line says still holds, for a message that stays. */
  #holds: (() => boolean) | undefined;
  /** How many messages have been said, so an action can tell if it said one. */
  #said = 0;
  /** How many actions are running, one inside another: the outermost clears. */
  #acting = 0;

  /** `show` puts the text in the line, or empties it for "". */
  constructor(show: (text: string) => void) {
    this.#show = show;
  }

  /** What the line says now, or "" when it is empty. */
  get text(): string {
    return this.#text;
  }

  /**
   * Says `text` until the next message, or the person's next action that
   * says nothing. With `holds`, it stays through such actions for as long as
   * `holds` returns true.
   */
  say(text: string, holds?: () => boolean): void {
    this.#text = text;
    this.#holds = holds;
    this.#said++;
    this.#show(text);
  }

  /**
   * Runs `action`, something the person did. Unless it said something, the
   * line is emptied once it returns, but for a message that still holds.
   */
  act(action: () => void): void {
    this.actIf(() => {
      action();
      return true;
    });
  }

  /**
   * Runs `action`, something the person did that may turn out to do nothing,
   * and returns whether it did anything: the line stays as it was when it did
   * nothing, and is otherwise left as {@link act} leaves it.
   */
  actIf(action: () => boolean): boolean {
    const said = this.#said;
    let did = false;
    this.#acting++;
    try {
      did = action();
      return did;
    } finally {
      this.#acting--;
      if (did && this.#acting === 0 && this.#said === said) this.#clear();
    }
  }

  #clear(): void {
    if (this.#text === "" || this.#holds?.() === true) return;
    this.#text = "";
    this.#holds = undefined;
    this.#show("");
  }
}
