// Runs the check that test/fixtures/pinned.sha256 only grows on synthetic
// lists, as scripts/pinned.ts runs it on the release tags.

import { describe, expect, it } from "vitest";
import {
  fetchTagsCommand,
  fetchTagsShallowCommand,
  pinnedProblems,
  pinnedReleases,
} from "../../scripts/lib/pinned.ts";

const a = `${"a".repeat(64)}  test/fixtures/format/v1-base.json`;
const b = `${"b".repeat(64)}  test/fixtures/format/v1-base.ink.png`;
const c = `${"c".repeat(64)}  test/fixtures/outline/v1-pieces.json`;
const d = `${"d".repeat(64)}  test/fixtures/format/v2-base.json`;

/** A list as `sha256sum --text` writes it, each line ended. */
function list(...lines: string[]): string {
  return lines.map((line) => `${line}\n`).join("");
}

const released = list(a, b, c);

/** A reader of the tags in `lists`, recording the tags it is asked for. */
function reader(lists: Record<string, string>): {
  read: (tag: string) => string;
  asked: string[];
} {
  const asked: string[] = [];
  return {
    asked,
    read: (tag) => {
      asked.push(tag);
      const text = lists[tag];
      if (text === undefined) throw new Error(`no such tag: ${tag}`);
      return text;
    },
  };
}

/** The problems with `current` against 1.0.0's list, `released`. */
function problems(current: string): string[] {
  return pinnedProblems(current, ["1.0.0"], reader({ "1.0.0": released }).read);
}

describe("pinnedReleases", () => {
  it("keeps plain versions from 1.0.0, in version order", () => {
    expect(
      pinnedReleases(["1.10.0", "2.0.0", "1.0.0", "1.1.0", "1.0.10", "1.0.2"]),
    ).toEqual(["1.0.0", "1.0.2", "1.0.10", "1.1.0", "1.10.0", "2.0.0"]);
  });

  it("leaves out the tags before 1.0.0, those with a suffix, and other names", () => {
    expect(
      pinnedReleases([
        "0.1.0",
        "0.9.5",
        "0.3.0-alpha.8",
        "0.1.1-rc.10",
        "1.1.0-rc.1",
        "v1.0.0",
        "01.0.0",
        "1.0",
        "release",
      ]),
    ).toEqual([]);
  });
});

describe("pinnedProblems", () => {
  it("passes a list unchanged since the release", () => {
    expect(problems(released)).toEqual([]);
  });

  it("passes a list with lines added", () => {
    expect(problems(list(a, b, c, d))).toEqual([]);
    expect(problems(list(d, a, b, c))).toEqual([]);
  });

  it("passes a list whose lines changed order", () => {
    expect(problems(list(c, a, b))).toEqual([]);
  });

  it("ignores empty lines and a missing last line ending", () => {
    expect(problems(`${a}\n\n${b}\n${c}`)).toEqual([]);
    expect(
      pinnedProblems(
        released,
        ["1.0.0"],
        reader({ "1.0.0": `\n${a}\n\n${b}\n${c}` }).read,
      ),
    ).toEqual([]);
  });

  it("fails a changed hash, naming the tag and the file", () => {
    const changed = a.replace("a".repeat(64), "e".repeat(64));
    const found = problems(list(changed, b, c));
    expect(found).toHaveLength(2);
    expect(found[0]).toBe(
      `1.0.0: test/fixtures/format/v1-base.json: its line ${JSON.stringify(a)} now reads ${JSON.stringify(changed)}`,
    );
    expect(found[1]).toMatch(/only grows.*AGENTS\.md.*never change the list/);
  });

  it("fails a removed line, naming the tag and the file", () => {
    const found = problems(list(a, c));
    expect(found).toHaveLength(2);
    expect(found[0]).toBe(
      `1.0.0: test/fixtures/format/v1-base.ink.png: its line ${JSON.stringify(b)} is gone, and no line names the file now`,
    );
  });

  it("fails a renamed file, naming the file it had", () => {
    const renamed = c.replace("v1-pieces", "v1-parts");
    const found = problems(list(a, b, renamed));
    expect(found).toHaveLength(2);
    expect(found[0]).toMatch(
      /^1\.0\.0: test\/fixtures\/outline\/v1-pieces\.json: .* is gone/,
    );
  });

  it("fails a line whose whitespace changed", () => {
    for (const changed of [
      a.replace("  ", " "),
      `${a} `,
      ` ${a}`,
      a.replace("  ", "\t"),
      `${a}\r`,
    ]) {
      const found = problems(list(changed, b, c));
      expect(found, JSON.stringify(changed)).toHaveLength(2);
      expect(found[0]).toBe(
        `1.0.0: test/fixtures/format/v1-base.json: its line ${JSON.stringify(a)} now reads ${JSON.stringify(changed)}`,
      );
    }
  });

  it("fails an emptied list", () => {
    const found = problems("");
    expect(found).toHaveLength(4);
    for (const problem of found.slice(0, 3)) expect(problem).toMatch(/is gone/);
  });

  it("holds the list to every release, and names the release each line is from", () => {
    const { read, asked } = reader({
      "1.0.0": released,
      "1.1.0": list(a, b, c, d),
      "1.2.0": list(a, b, c, d),
    });
    const found = pinnedProblems(
      list(a, b, c),
      ["1.2.0", "1.0.0", "1.1.0"],
      read,
    );
    expect(asked).toEqual(["1.0.0", "1.1.0", "1.2.0"]);
    expect(found.slice(0, -1)).toEqual([
      `1.1.0: test/fixtures/format/v2-base.json: its line ${JSON.stringify(d)} is gone, and no line names the file now`,
      `1.2.0: test/fixtures/format/v2-base.json: its line ${JSON.stringify(d)} is gone, and no line names the file now`,
    ]);
  });

  it("fails when no tag from 1.0.0 is given, and says how to fetch the tags", () => {
    for (const tags of [[], ["0.9.5", "0.3.0-alpha.8"], ["1.1.0"]]) {
      const { read, asked } = reader({ "1.1.0": released });
      const found = pinnedProblems(released, tags, read);
      expect(found).toHaveLength(1);
      expect(found[0]).toContain("The tag 1.0.0 is not in this clone");
      expect(found[0]).toContain(fetchTagsCommand);
      expect(found[0]).toContain(fetchTagsShallowCommand);
      expect(asked).toEqual([]);
    }
  });

  it("fails when a release's list cannot be read, or is empty", () => {
    const unreadable = pinnedProblems(
      released,
      ["1.0.0", "1.1.0"],
      reader({ "1.0.0": released }).read,
    );
    expect(unreadable[0]).toBe(
      "1.1.0: cannot read test/fixtures/pinned.sha256 there: no such tag: 1.1.0",
    );
    expect(unreadable).toHaveLength(2);
    const empty = pinnedProblems(
      released,
      ["1.0.0", "1.1.0"],
      reader({ "1.0.0": released, "1.1.0": "\n" }).read,
    );
    expect(empty[0]).toBe(
      "1.1.0: test/fixtures/pinned.sha256 there lists no files",
    );
  });

  it("ignores the tags before 1.0.0 and those with a suffix", () => {
    const broken = list(d);
    const { read, asked } = reader({
      "1.0.0": released,
      "0.9.5": broken,
      "0.3.0-alpha.8": broken,
      "1.1.0-rc.1": broken,
    });
    expect(
      pinnedProblems(
        released,
        ["0.9.5", "0.3.0-alpha.8", "1.1.0-rc.1", "1.0.0"],
        read,
      ),
    ).toEqual([]);
    expect(asked).toEqual(["1.0.0"]);
  });
});
