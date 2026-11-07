// What a person would feel of work going on in the page: how long the main
// thread goes without answering, and how long real input waits for it. Used by
// test/e2e/manual/save-time.e2e.ts.

/** What {@link watchMainThread} saw. */
export interface MainThread {
  readonly ranMs: number;
  /** The longest the page went without running a timer. */
  readonly longestGapMs: number;
  /** The longest frame, from one animation frame to the next. */
  readonly longestFrameMs: number;
  /** Tasks of 50 ms or more, as Chromium reports them. */
  readonly longTasks: number;
  readonly longestTaskMs: number;
  readonly longTasksMs: number;
  /** Pointer and key events, and the longest any waited to be handled. */
  readonly inputs: number;
  readonly longestInputDelayMs: number;
}

/** Starts watching the main thread, and returns what stops and reports it. */
export function watchMainThread(): () => MainThread {
  const started = performance.now();
  let running = true;
  let longestGapMs = 0;
  let longestFrameMs = 0;
  let inputs = 0;
  let longestInputDelayMs = 0;
  const tasks: number[] = [];
  let lastTick = started;
  const tick = (): void => {
    const now = performance.now();
    longestGapMs = Math.max(longestGapMs, now - lastTick);
    lastTick = now;
    if (running) window.setTimeout(tick, 0);
  };
  tick();
  let lastFrame = started;
  const frame = (): void => {
    const now = performance.now();
    longestFrameMs = Math.max(longestFrameMs, now - lastFrame);
    lastFrame = now;
    if (running) window.requestAnimationFrame(frame);
  };
  window.requestAnimationFrame(frame);
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) tasks.push(entry.duration);
  });
  observer.observe({ type: "longtask", buffered: false });
  const input = (event: Event): void => {
    inputs++;
    longestInputDelayMs = Math.max(
      longestInputDelayMs,
      performance.now() - event.timeStamp,
    );
  };
  const kinds = ["pointermove", "pointerdown", "pointerup", "keydown"];
  for (const kind of kinds) window.addEventListener(kind, input, true);
  return () => {
    running = false;
    for (const entry of observer.takeRecords()) tasks.push(entry.duration);
    observer.disconnect();
    for (const kind of kinds) window.removeEventListener(kind, input, true);
    return {
      ranMs: performance.now() - started,
      longestGapMs,
      longestFrameMs,
      longTasks: tasks.length,
      longestTaskMs: Math.max(0, ...tasks),
      longTasksMs: tasks.reduce((sum, task) => sum + task, 0),
      inputs,
      longestInputDelayMs,
    };
  };
}

/** One call to the vault, from `startMs` to `endMs` after watching began. */
export interface VaultCall {
  readonly method: string;
  readonly startMs: number;
  readonly endMs: number;
}

/**
 * Times every read and write of a binary file on `vault`, and returns what
 * stops that and reports them.
 */
export function watchVault(vault: object): () => VaultCall[] {
  const started = performance.now();
  const calls: VaultCall[] = [];
  const methods = ["readBinary", "modifyBinary"];
  const originals = methods.map((method) => {
    const original: unknown = Reflect.get(vault, method);
    if (typeof original !== "function") throw new Error(`no ${method}`);
    Reflect.set(vault, method, async (...args: unknown[]): Promise<unknown> => {
      const startMs = performance.now() - started;
      try {
        return (await Reflect.apply(original, vault, args)) as unknown;
      } finally {
        calls.push({ method, startMs, endMs: performance.now() - started });
      }
    });
    return original;
  });
  return () => {
    methods.forEach((method, index) => {
      Reflect.set(vault, method, originals[index]);
    });
    return calls;
  };
}

/** What {@link keepFiltering} saw. */
export interface Filtering {
  readonly changes: number;
  /** From a change to the filter to the next frame after it. */
  readonly longestMs: number;
  readonly medianMs: number;
}

/**
 * Keeps changing what `field` filters by, as typing does, and returns what stops
 * that and reports how long each change took to reach the screen.
 */
export function keepFiltering(field: HTMLInputElement): () => Filtering {
  const times: number[] = [];
  let running = true;
  let typed = 0;
  const change = (): void => {
    if (!running) return;
    const start = performance.now();
    field.value = ["s", "sy", "sym", ""][typed++ % 4] ?? "";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    window.requestAnimationFrame(() => {
      times.push(performance.now() - start);
      window.setTimeout(change, 40);
    });
  };
  change();
  return () => {
    running = false;
    field.value = "";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    const sorted = [...times].sort((a, b) => a - b);
    return {
      changes: times.length,
      longestMs: sorted.at(-1) ?? 0,
      medianMs: sorted[Math.floor(sorted.length / 2)] ?? 0,
    };
  };
}
