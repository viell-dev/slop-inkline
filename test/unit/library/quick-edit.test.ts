import { describe, expect, it } from "vitest";
import {
  followName,
  leftNotice,
  QuickSave,
  reasonOf,
  reportSave,
  rowLines,
  waitLine,
  type Names,
  type Outcome,
  type Step,
  type Work,
} from "../../../src/library/quick-edit.ts";
import { PngError } from "../../../src/format/png.ts";
import {
  RenameDisturbed,
  TextMoved,
  unreadableText,
  type SaveWait,
} from "../../../src/notes/file-writes.ts";

/**
 * A step that a test settles by hand: it records when it starts, can say that
 * it waits, and can be stopped until it has `reached` the vault.
 */
class Hand {
  started = false;
  stopped = false;
  /** Whether it has gone to the vault, so that stopping it is too late. */
  reached = false;
  told: SaveWait | undefined;
  #resolve: () => void = () => undefined;
  #reject: (error: unknown) => void = () => undefined;
  readonly done = new Promise<void>((resolve, reject) => {
    this.#resolve = resolve;
    this.#reject = reject;
  });

  readonly start = (told: SaveWait): Work => {
    this.started = true;
    this.told = told;
    return {
      done: this.done,
      stop: () => {
        this.stopped = true;
        if (!this.reached) this.fail(new Error("The save was stopped."));
        return !this.reached;
      },
    };
  };

  finish(): void {
    this.#resolve();
  }

  fail(error: unknown): void {
    this.#reject(error);
  }
}

/** Lets the save under way go on to its next step. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 5; turn++) await Promise.resolve();
}

const names: Names = { was: "gate", typed: "arch", now: "arch" };

/** An outcome, as a save of both parts that did what was asked. */
function outcome(parts: Partial<Outcome> = {}): Outcome {
  return {
    renaming: true,
    written: true,
    waited: false,
    left: undefined,
    failure: undefined,
    ...parts,
  };
}

describe("QuickSave", () => {
  it("writes, then renames once the write has ended", async () => {
    const write = new Hand();
    const rename = new Hand();
    const save = new QuickSave(
      { write: write.start, rename: rename.start },
      () => undefined,
    );
    const running = save.run();
    await settle();
    expect(write.started).toBe(true);
    expect(rename.started).toBe(false);
    write.finish();
    await settle();
    expect(save.written).toBe(true);
    expect(rename.started).toBe(true);
    rename.finish();
    expect(await running).toEqual(outcome());
  });

  it("runs only the steps asked for", async () => {
    const rename = new Hand();
    const save = new QuickSave({ rename: rename.start }, () => undefined);
    const running = save.run();
    await settle();
    rename.finish();
    expect(await running).toEqual(outcome({ written: false }));
  });

  it("renames nothing after a write that failed", async () => {
    const write = new Hand();
    const rename = new Hand();
    const failure = new Error("the disk is full");
    const running = new QuickSave(
      { write: write.start, rename: rename.start },
      () => undefined,
    ).run();
    await settle();
    write.fail(failure);
    expect(await running).toEqual(
      outcome({
        written: false,
        failure: { step: "write", error: failure },
      }),
    );
    expect(rename.started).toBe(false);
  });

  it("keeps the write when the rename fails", async () => {
    const write = new Hand();
    const rename = new Hand();
    const failure = new Error("the disk is read-only");
    const running = new QuickSave(
      { write: write.start, rename: rename.start },
      () => undefined,
    ).run();
    await settle();
    write.finish();
    await settle();
    rename.fail(failure);
    expect(await running).toEqual(
      outcome({ failure: { step: "rename", error: failure } }),
    );
  });

  it("says which step waits, and can be left only then", async () => {
    const write = new Hand();
    const rename = new Hand();
    const told: (Step | undefined)[] = [];
    const save = new QuickSave(
      { write: write.start, rename: rename.start },
      (step) => told.push(step),
    );
    const running = save.run();
    await settle();
    expect(save.waiting).toBe(undefined);
    expect(save.leave()).toBe(undefined);
    write.told?.(true);
    expect(save.waiting).toBe("write");
    write.told?.(false);
    write.finish();
    await settle();
    rename.told?.(true);
    expect(save.waiting).toBe("rename");
    rename.told?.(false);
    rename.finish();
    expect((await running).waited).toBe(true);
    expect(told).toEqual(["write", undefined, "rename", undefined]);
  });

  it("stops a write left while it waits, and renames nothing", async () => {
    const write = new Hand();
    const rename = new Hand();
    const save = new QuickSave(
      { write: write.start, rename: rename.start },
      () => undefined,
    );
    const running = save.run();
    await settle();
    write.told?.(true);
    expect(save.leave()).toEqual({
      step: "write",
      stopped: true,
      written: false,
      renaming: true,
    });
    const ended = await running;
    expect(ended.left?.stopped).toBe(true);
    expect(ended.written).toBe(false);
    expect(ended.failure?.step).toBe("write");
    expect(rename.started).toBe(false);
  });

  it("starts no rename after a write left that still finishes", async () => {
    const write = new Hand();
    const rename = new Hand();
    const save = new QuickSave(
      { write: write.start, rename: rename.start },
      () => undefined,
    );
    const running = save.run();
    await settle();
    write.reached = true;
    write.told?.(true);
    expect(save.leave()?.stopped).toBe(false);
    write.finish();
    const ended = await running;
    expect(ended.written).toBe(true);
    expect(ended.failure).toBe(undefined);
    expect(rename.started).toBe(false);
  });

  it("says the write was done when the rename after it is left", async () => {
    const write = new Hand();
    const rename = new Hand();
    const save = new QuickSave(
      { write: write.start, rename: rename.start },
      () => undefined,
    );
    const running = save.run();
    await settle();
    write.finish();
    await settle();
    rename.told?.(true);
    expect(save.leave()).toEqual({
      step: "rename",
      stopped: true,
      written: true,
      renaming: true,
    });
    // Once left, it cannot be left again.
    expect(save.leave()).toBe(undefined);
    expect(await running).toMatchObject({
      written: true,
      failure: { step: "rename" },
    });
  });
});

describe("waitLine", () => {
  it("says what the person can do, and what is saved already", () => {
    expect(waitLine("write", false)).toContain(
      "Waiting for Obsidian to finish writing a file.",
    );
    expect(waitLine("write", false)).toContain("copy what you typed");
    expect(waitLine("rename", false)).toContain(
      "Waiting for Obsidian to finish renaming a file.",
    );
    expect(waitLine("rename", false)).not.toContain("are saved");
    expect(waitLine("rename", true)).toContain(
      "The readings and translations are saved.",
    );
    expect(waitLine("rename", true)).toContain("copy the name you typed");
  });
});

describe("leftNotice", () => {
  const left = (
    step: Step,
    stopped: boolean,
    written: boolean,
    renaming = true,
  ) => ({ step, stopped, written, renaming });

  it("says nothing of a write stopped, which wrote nothing", () => {
    expect(leftNotice(left("write", true, false), names)).toBe(undefined);
  });

  it("says a write may still finish, and that no rename follows it", () => {
    expect(leftNotice(left("write", false, false), names)).toBe(
      "Saving gate had reached Obsidian, so it may still finish. It will not be renamed.",
    );
    expect(leftNotice(left("write", false, false, false), names)).toBe(
      "Saving gate had reached Obsidian, so it may still finish.",
    );
  });

  it("says what was saved when the rename is stopped", () => {
    expect(leftNotice(left("rename", true, true), names)).toBe(
      "Saved gate. It was not renamed.",
    );
    expect(leftNotice(left("rename", true, false), names)).toBe(undefined);
  });

  it("says a rename may still finish, after what was saved", () => {
    expect(leftNotice(left("rename", false, true), names)).toBe(
      "Saved gate. Renaming it had reached Obsidian, so it may still finish.",
    );
    expect(leftNotice(left("rename", false, false), names)).toBe(
      "Renaming gate had reached Obsidian, so it may still finish.",
    );
  });
});

describe("reportSave", () => {
  const disturbed = new RenameDisturbed(
    "Obsidian did not finish the rename, though the file is arch.ink.png now, so links to it may still have the old name",
    true,
  );

  it("closes, and says nothing, for a save that did what was asked", () => {
    for (const parts of [{}, { written: false }, { renaming: false }]) {
      expect(reportSave(outcome(parts), names, true)).toMatchObject({
        closes: true,
        notice: undefined,
      });
    }
  });

  it("says what was done to a person told that the save waited", () => {
    const said = (parts: Partial<Outcome>) =>
      reportSave(outcome({ waited: true, ...parts }), names, true).notice;
    expect(said({})).toBe("Saved gate and renamed it to arch.");
    expect(said({ written: false })).toBe("Renamed gate to arch.");
    expect(said({ renaming: false })).toBe("Saved gate.");
  });

  it("keeps the row for a failed write, and says that nothing was renamed", () => {
    const failure = {
      step: "write" as const,
      error: new Error("the disk is full"),
    };
    expect(
      reportSave(outcome({ written: false, failure }), names, true),
    ).toEqual({
      closes: false,
      lines: ["the disk is full", "Nothing was renamed."],
      notice: undefined,
      moved: undefined,
      focus: "fields",
    });
    expect(
      reportSave(
        outcome({ renaming: false, written: false, failure }),
        names,
        true,
      ).lines,
    ).toEqual(["the disk is full"]);
  });

  it("takes in a file that changed under the write", () => {
    const text = { reading: ["theirs"], translation: [] };
    const failure = { step: "write" as const, error: new TextMoved(text) };
    expect(
      reportSave(outcome({ written: false, failure }), names, true),
    ).toMatchObject({
      closes: false,
      lines: ["The file changed meanwhile, so nothing was saved or renamed."],
      moved: text,
      focus: "fields",
    });
    expect(
      reportSave(
        outcome({ renaming: false, written: false, failure }),
        names,
        true,
      ),
    ).toMatchObject({ lines: [], moved: text });
  });

  it("keeps the row for a failed rename, saying what was saved", () => {
    const failure = {
      step: "rename" as const,
      error: new Error("the file was renamed to synced.ink.png meanwhile"),
    };
    expect(reportSave(outcome({ failure }), names, true)).toEqual({
      closes: false,
      lines: [
        "The readings and translations are saved, but the symbol was not renamed:",
        "the file was renamed to synced.ink.png meanwhile",
      ],
      notice: undefined,
      moved: undefined,
      focus: "name",
    });
    expect(
      reportSave(outcome({ written: false, failure }), names, true).lines,
    ).toEqual(["the file was renamed to synced.ink.png meanwhile"]);
  });

  it("says only that the text is saved when something came between the rename", () => {
    expect(
      reportSave(
        outcome({
          failure: { step: "rename", error: disturbed },
        }),
        names,
        true,
      ).lines,
    ).toEqual(["The readings and translations are saved.", disturbed.message]);
  });

  it("says in a notice what was not done, once the row has gone", () => {
    const why = new Error("Inkline was disabled");
    const notice = (parts: Partial<Outcome>) =>
      reportSave(outcome(parts), names, false).notice;
    expect(
      notice({
        written: false,
        failure: { step: "write", error: why },
      }),
    ).toBe(
      "The readings and translations of gate were not saved, and it was not renamed to arch: Inkline was disabled",
    );
    expect(
      notice({
        renaming: false,
        written: false,
        failure: { step: "write", error: why },
      }),
    ).toBe(
      "The readings and translations of gate were not saved: Inkline was disabled",
    );
    expect(notice({ failure: { step: "rename", error: why } })).toBe(
      "Saved gate. gate could not be renamed to arch: Inkline was disabled",
    );
    expect(
      notice({
        written: false,
        failure: { step: "rename", error: why },
      }),
    ).toBe("gate could not be renamed to arch: Inkline was disabled");
    expect(
      notice({
        failure: { step: "rename", error: disturbed },
      }),
    ).toBe(`Saved gate. Renaming gate to arch: ${disturbed.message}`);
  });

  it("says nothing more of a step the person stopped", () => {
    expect(
      reportSave(
        outcome({
          written: false,
          left: {
            step: "write",
            stopped: true,
            written: false,
            renaming: true,
          },
          failure: { step: "write", error: new Error("The save was stopped.") },
        }),
        names,
        false,
      ),
    ).toMatchObject({ closes: true, notice: undefined });
    expect(
      reportSave(
        outcome({
          left: {
            step: "rename",
            stopped: true,
            written: true,
            renaming: true,
          },
          failure: {
            step: "rename",
            error: new Error("The rename was stopped."),
          },
        }),
        names,
        false,
      ).notice,
    ).toBe(undefined);
  });

  it("says how a step left that went on ended", () => {
    expect(
      reportSave(
        outcome({
          waited: true,
          left: {
            step: "write",
            stopped: false,
            written: false,
            renaming: true,
          },
        }),
        names,
        false,
      ).notice,
    ).toBe("Saved gate.");
    expect(
      reportSave(
        outcome({
          waited: true,
          left: {
            step: "rename",
            stopped: false,
            written: true,
            renaming: true,
          },
        }),
        names,
        false,
      ).notice,
    ).toBe("Saved gate and renamed it to arch.");
    expect(
      reportSave(
        outcome({
          waited: true,
          left: {
            step: "rename",
            stopped: false,
            written: true,
            renaming: true,
          },
          failure: { step: "rename", error: new Error("the drive went away") },
        }),
        names,
        false,
      ).notice,
    ).toBe(
      "Saved gate. gate could not be renamed to arch: the drive went away",
    );
  });
});

describe("rowLines", () => {
  const notWhole = "This file is not a whole PNG, so it cannot hold text.";
  const refused = "the vault's top folder already has a symbol named TOWER";

  it("says what a save said when the file was read", () => {
    expect(rowLines(undefined, [])).toEqual([]);
    expect(rowLines(undefined, [refused])).toEqual([refused]);
  });

  it("says why the file could not be read first, above what a save said", () => {
    expect(rowLines(notWhole, [])).toEqual([notWhole]);
    expect(rowLines(notWhole, [refused])).toEqual([notWhole, refused]);
  });

  it("says once what a failed write and the read after it say of a file cut short", () => {
    // The write and the row's read both fail through unreadableText; the
    // row's lines are what reportSave makes of the write's failure.
    const cutShort = unreadableText(new PngError("cut short"));
    const readFailure = reasonOf(cutShort, "");
    expect(readFailure).toBe(notWhole);
    const { lines } = reportSave(
      outcome({ written: false, failure: { step: "write", error: cutShort } }),
      names,
      true,
    );
    expect(rowLines(readFailure, lines)).toEqual([
      notWhole,
      "Nothing was renamed.",
    ]);
  });
});

describe("followName", () => {
  it("follows a rename elsewhere while nobody has typed a name", () => {
    expect(followName({ typed: "gate", given: "gate" }, "arch")).toEqual({
      typed: "arch",
      given: "arch",
    });
  });

  it("keeps a name typed, and is given the new one", () => {
    expect(followName({ typed: "lintel", given: "gate" }, "arch")).toEqual({
      typed: "lintel",
      given: "arch",
    });
  });

  it("follows a second rename, so that an untouched name never renames back", () => {
    const once = followName({ typed: "gate", given: "gate" }, "arch");
    const twice = followName(once, "portal");
    // Save renames only a name that differs from the one given.
    expect(twice.typed).toBe(twice.given);
    expect(twice).toEqual({ typed: "portal", given: "portal" });
  });
});
