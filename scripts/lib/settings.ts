// Compares the repository's live settings with the files that record them:
// the labels with .github/labels.json, the rulesets with .github/rulesets/,
// and how issues and pull requests use the labels. Free of network access,
// so that unit tests can run it on synthetic input; scripts/settings.ts
// reads the live state. It imports nothing, so that the Settings workflow
// runs it without installing the dependencies.

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** An issue or pull request, with the names of its labels. */
export interface Labelled {
  readonly number: number;
  readonly labels: readonly string[];
}

/** A value with its object keys in order, so that key order never differs. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonical(value[key])]),
  );
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

function stringOf(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined;
  const field = value[key];
  return typeof field === "string" ? field : undefined;
}

/**
 * Every way the live labels differ from the recorded ones: a label missing,
 * one with another colour or description, one the file does not list, or
 * one whose name differs only in letter case. GitHub refuses a second label
 * that differs only so, and such a label is renamed, which keeps it on the
 * issues that have it. Otherwise names compare exactly, as a label's name is
 * how it is used.
 */
export function labelProblems(recorded: unknown, live: unknown): string[] {
  if (!Array.isArray(recorded)) return ["labels.json is not a list"];
  if (!Array.isArray(live)) return ["the live labels are not a list"];
  const problems: string[] = [];
  const liveByName = new Map<string, unknown>();
  for (const label of live) {
    const name = stringOf(label, "name");
    if (name !== undefined) liveByName.set(name, label);
  }
  const recordedByName = new Map<string, unknown>();
  for (const label of recorded) {
    const name = stringOf(label, "name");
    if (name === undefined) {
      problems.push("labels.json has a label without a name");
    } else {
      recordedByName.set(name, label);
    }
  }
  for (const [name, label] of recordedByName) {
    const found = liveByName.get(name);
    if (found === undefined) {
      const renamed = [...liveByName.keys()].find(
        (liveName) =>
          !recordedByName.has(liveName) &&
          liveName.toLowerCase() === name.toLowerCase(),
      );
      problems.push(
        renamed === undefined
          ? `label "${name}" is missing`
          : `label "${renamed}" should be renamed "${name}"`,
      );
      continue;
    }
    for (const key of ["color", "description"]) {
      const want = stringOf(label, key) ?? "";
      const have = stringOf(found, key) ?? "";
      // GitHub keeps colours in lower case, without a #.
      if (key === "color" ? want.toLowerCase() !== have : want !== have) {
        problems.push(`label "${name}" has ${key} "${have}", not "${want}"`);
      }
    }
  }
  const recordedNames = [...recordedByName.keys()].map((name) =>
    name.toLowerCase(),
  );
  for (const name of liveByName.keys()) {
    if (recordedByName.has(name)) continue;
    // A label renamed in letter case is reported above.
    if (recordedNames.includes(name.toLowerCase())) continue;
    problems.push(`label "${name}" is not in labels.json`);
  }
  return problems;
}

/** The parts of a ruleset that its file records. */
const rulesetFields = [
  "name",
  "target",
  "enforcement",
  "conditions",
  "rules",
] as const;

/** The types of the rules that differ between two lists of rules. */
function differingRules(recorded: unknown, live: unknown): string[] {
  const byType = (rules: unknown): Map<string, string[]> => {
    const types = new Map<string, string[]>();
    for (const rule of Array.isArray(rules) ? rules : []) {
      const type = stringOf(rule, "type") ?? "(no type)";
      types.set(type, [
        ...(types.get(type) ?? []),
        JSON.stringify(canonical(rule)),
      ]);
    }
    return types;
  };
  const want = byType(recorded);
  const have = byType(live);
  return [...new Set([...want.keys(), ...have.keys()])]
    .filter(
      (type) =>
        JSON.stringify(want.get(type)?.sort() ?? []) !==
        JSON.stringify(have.get(type)?.sort() ?? []),
    )
    .sort();
}

/**
 * Every way the live rulesets differ from the recorded ones, matched by
 * name: one missing, one the files do not record, or a field that differs.
 * Rules compare in any order. Bypass actors compare only where `live`
 * shows them, as GitHub shows them to the repository's administrators
 * alone; `unseen` lists the rulesets whose bypass actors it did not show.
 */
export function rulesetProblems(
  recorded: readonly unknown[],
  live: readonly unknown[],
): { problems: string[]; unseen: string[] } {
  const problems: string[] = [];
  const unseen: string[] = [];
  const sortedRules = (rules: unknown): unknown =>
    Array.isArray(rules)
      ? rules
          .map((rule) => JSON.stringify(canonical(rule)))
          .sort()
          .map((rule): unknown => JSON.parse(rule))
      : rules;
  const liveByName = new Map<string, Record<string, unknown>>();
  for (const ruleset of live) {
    const name = stringOf(ruleset, "name");
    if (name !== undefined && isRecord(ruleset)) liveByName.set(name, ruleset);
  }
  const names = new Set<string>();
  for (const ruleset of recorded) {
    const name = stringOf(ruleset, "name");
    if (name === undefined || !isRecord(ruleset)) {
      problems.push("a ruleset file has no name");
      continue;
    }
    names.add(name);
    const found = liveByName.get(name);
    if (found === undefined) {
      problems.push(`ruleset "${name}" is missing`);
      continue;
    }
    for (const field of rulesetFields) {
      const want =
        field === "rules" ? sortedRules(ruleset[field]) : ruleset[field];
      const have = field === "rules" ? sortedRules(found[field]) : found[field];
      if (same(want, have)) continue;
      problems.push(
        field === "rules"
          ? `ruleset "${name}" has other rules than its file: ${differingRules(ruleset.rules, found.rules).join(", ")}`
          : `ruleset "${name}" has other ${field} than its file`,
      );
    }
    if (!("bypass_actors" in found)) unseen.push(name);
    else if (!same(ruleset.bypass_actors ?? [], found.bypass_actors)) {
      problems.push(`ruleset "${name}" has other bypass_actors than its file`);
    }
  }
  for (const name of liveByName.keys()) {
    if (!names.has(name)) problems.push(`ruleset "${name}" has no file`);
  }
  return { problems, unseen };
}

/**
 * Every issue or pull request whose labels break the rules: one `Type:`
 * label each, at most one `Status:` label, at most one of `Needs: Owner`
 * and `Needs: Human`, and only labels that `recorded` lists.
 */
export function labelUsageProblems(
  recorded: unknown,
  items: readonly Labelled[],
): string[] {
  const known = new Set(
    Array.isArray(recorded)
      ? recorded.flatMap((label) => stringOf(label, "name") ?? [])
      : [],
  );
  const problems: string[] = [];
  for (const { number, labels } of items) {
    const where = `#${String(number)}`;
    const types = labels.filter((label) => label.startsWith("Type: "));
    if (types.length !== 1) {
      problems.push(
        `${where} has ${String(types.length)} Type labels, not one`,
      );
    }
    const statuses = labels.filter((label) => label.startsWith("Status: "));
    if (statuses.length > 1) {
      problems.push(`${where} has ${String(statuses.length)} Status labels`);
    }
    if (labels.includes("Needs: Owner") && labels.includes("Needs: Human")) {
      problems.push(`${where} has both Needs labels; keep the more specific`);
    }
    for (const label of labels) {
      if (!known.has(label)) {
        problems.push(`${where} has "${label}", which labels.json lacks`);
      }
    }
  }
  return problems;
}
