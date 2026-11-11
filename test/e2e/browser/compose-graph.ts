// Prototype for #167 §4, not product code: the bookkeeping that linked parts
// would need. A composite symbol names other symbols as parts; before one can
// be drawn, every part it reaches must exist, none may contain itself, and the
// whole expansion must stay within a budget, as a part used three times in a
// part used three times, twelve deep, is drawn 3^12 times.

/** A part placed in a composite, as a version-2 record might name it. */
export interface PartRef {
  /** The part's path in the vault. */
  readonly symbol: string;
  /** Where the part's top left corner goes, in units (1/16 px). */
  readonly x: number;
  readonly y: number;
  /** The part's scale, in 1/4096ths, since record numbers are integers. */
  readonly scale: number;
}

/** What the checker needs to know of a symbol: its own cost and its parts. */
export interface Node {
  /** Points in its own strokes. */
  readonly points: number;
  readonly parts: readonly PartRef[];
}

/** Finds a symbol by path, or undefined when no such file exists. */
export type Library = (symbol: string) => Node | undefined;

export interface Budget {
  /** Deepest nesting of parts, the composite itself at depth 0. */
  readonly depth: number;
  /** Most parts drawn, counting each use of a part. */
  readonly draws: number;
  /** Most points drawn, across every use of every part. */
  readonly points: number;
}

/** The limits a reader might set, after the format's own limit on points. */
export const defaultBudget: Budget = {
  depth: 8,
  draws: 10_000,
  points: 250_000,
};

export type Check =
  | {
      readonly ok: true;
      readonly draws: number;
      readonly points: number;
      readonly depth: number;
    }
  | {
      readonly ok: false;
      readonly reason: "loop" | "missing" | "too-deep" | "too-costly";
      /** The chain of symbols from the composite to where it failed. */
      readonly path: readonly string[];
      readonly draws?: number;
      readonly points?: number;
    };

interface Cost {
  draws: number;
  points: number;
  depth: number;
}

class Failure extends Error {
  readonly reason: "loop" | "missing";
  readonly path: readonly string[];
  constructor(reason: "loop" | "missing", path: readonly string[]) {
    super(reason);
    this.reason = reason;
    this.path = path;
  }
}

/**
 * Checks a composite before drawing it. Each symbol's cost is worked out once
 * and remembered, so a part shared by many composites, or used many times,
 * costs the checker one visit however often the drawing would draw it. A
 * symbol met again on the way down from itself is a loop.
 */
export function checkComposite(
  name: string,
  library: Library,
  budget: Budget = defaultBudget,
): Check {
  const known = new Map<string, Cost>();
  const visiting: string[] = [];
  const cost = (symbol: string): Cost => {
    if (visiting.includes(symbol)) {
      throw new Failure("loop", [...visiting, symbol]);
    }
    const remembered = known.get(symbol);
    if (remembered !== undefined) return remembered;
    const node = library(symbol);
    if (node === undefined) throw new Failure("missing", [...visiting, symbol]);
    visiting.push(symbol);
    let draws = 0;
    let points = node.points;
    let depth = 0;
    for (const part of node.parts) {
      const inner = cost(part.symbol);
      // Saturating, so that a crafted chain cannot overflow to a small number.
      draws = Math.min(Number.MAX_SAFE_INTEGER, draws + 1 + inner.draws);
      points = Math.min(Number.MAX_SAFE_INTEGER, points + inner.points);
      depth = Math.max(depth, inner.depth + 1);
    }
    visiting.pop();
    const found = { draws, points, depth };
    known.set(symbol, found);
    return found;
  };
  let total: Cost;
  try {
    total = cost(name);
  } catch (error) {
    if (error instanceof Failure) {
      return { ok: false, reason: error.reason, path: error.path };
    }
    throw error;
  }
  if (total.depth > budget.depth) {
    return { ok: false, reason: "too-deep", path: [name], ...total };
  }
  if (total.draws > budget.draws || total.points > budget.points) {
    return { ok: false, reason: "too-costly", path: [name], ...total };
  }
  return { ok: true, ...total };
}

/**
 * Whether placing `part` into `target` would make a symbol contain itself:
 * `part` is `target`, or reaches it through its own parts. A missing symbol
 * on the way reaches nothing.
 */
export function wouldLoop(
  target: string,
  part: string,
  library: Library,
): boolean {
  const seen = new Set<string>();
  const stack = [part];
  for (let symbol = stack.pop(); symbol !== undefined; symbol = stack.pop()) {
    if (symbol === target) return true;
    if (seen.has(symbol)) continue;
    seen.add(symbol);
    for (const each of library(symbol)?.parts ?? []) stack.push(each.symbol);
  }
  return false;
}

/**
 * Every composite that uses `part`, directly or through other composites,
 * in an order where each comes after the parts it uses, so that redrawing
 * them in that order redraws each once, from parts already redrawn.
 */
export function dependents(
  part: string,
  symbols: readonly string[],
  library: Library,
): string[] {
  const users = new Map<string, string[]>();
  for (const symbol of symbols) {
    for (const each of library(symbol)?.parts ?? []) {
      const list = users.get(each.symbol) ?? [];
      if (!list.includes(symbol)) list.push(symbol);
      users.set(each.symbol, list);
    }
  }
  // Depth first, each symbol entered once, each listed after all its users:
  // reversed, every composite comes after the parts it uses. A loop is cut
  // where it closes, as its symbols cannot be drawn anyway.
  const order: string[] = [];
  const entered = new Set<string>([part]);
  const visit = (symbol: string): void => {
    for (const user of users.get(symbol) ?? []) {
      if (entered.has(user)) continue;
      entered.add(user);
      visit(user);
      order.push(user);
    }
  };
  visit(part);
  return order.reverse();
}

/** The parts of a composite with `from` renamed to `to`, or undefined if none. */
export function renamedParts(
  parts: readonly PartRef[],
  from: string,
  to: string,
): PartRef[] | undefined {
  if (!parts.some((part) => part.symbol === from)) return undefined;
  return parts.map((part) =>
    part.symbol === from ? { ...part, symbol: to } : part,
  );
}
