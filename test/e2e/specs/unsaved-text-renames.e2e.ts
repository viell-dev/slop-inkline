import { browser, expect } from "@wdio/globals";
import { loadModules } from "../support/browser.ts";
import { insert, save, waitClosed, zigzag } from "../support/editing.ts";
import {
  addUnsaved,
  clickTop,
  delayVault,
  draw,
  failSaves,
  markEditor,
  noteText,
  startOver,
  symbolFiles,
  topButton,
  waitForEditor,
  waitForFailedSaves,
  waitForNext,
  waitForNotice,
  waitForPanes,
  waitForStatus,
  waitForTop,
} from "../support/editor.ts";
import {
  closeTabs,
  marked,
  openBeside,
  rewrite,
  setLinkUpdates,
  showAs,
  type,
  undoGroup,
  waitForFile,
  waitForNote,
} from "../support/insertion.ts";
import { intoCell, waitForLastRow } from "../support/table-cell.ts";
import { waitForLink } from "../support/vault-files.ts";

/**
 * Holds back how the note's editors take a change on disk by `delay`
 * milliseconds, as a slow disk would. Obsidian keeps that step in the view's
 * private `loadFileInternal`, and the view goes with the test. Each held
 * reload is counted as it starts and once it has finished, for
 * {@link waitForHeldReloads}.
 */
async function slowReload(path: string, delay: number): Promise<void> {
  await browser.executeObsidian(
    ({ app, obsidian }, file, wait) => {
      const count = { started: 0, finished: 0 };
      Reflect.set(window, "inklineHeldReloads", count);
      for (const { view } of app.workspace.getLeavesOfType("markdown")) {
        if (!(view instanceof obsidian.MarkdownView)) continue;
        if (view.file?.path !== file) continue;
        const load: unknown = Reflect.get(view, "loadFileInternal");
        if (typeof load !== "function") throw new Error("no reload to hold");
        const held = async (...args: unknown[]): Promise<unknown> => {
          count.started++;
          try {
            await new Promise((resolve) => {
              window.setTimeout(resolve, wait);
            });
            return (await Reflect.apply(load, view, args)) as unknown;
          } finally {
            count.finished++;
          }
        };
        Reflect.set(view, "loadFileInternal", held);
      }
    },
    path,
    delay,
  );
}

/**
 * Waits until a reload that {@link slowReload} held has started, and every
 * one that started has finished, with the editor showing what it loaded.
 */
async function waitForHeldReloads(): Promise<void> {
  let count = "none";
  try {
    await browser.waitUntil(
      async () => {
        const { started, finished } = await browser.execute(() => {
          const held: unknown = Reflect.get(window, "inklineHeldReloads");
          const read = (key: string): number => {
            const value: unknown = Reflect.get(Object(held), key);
            return typeof value === "number" ? value : -1;
          };
          return { started: read("started"), finished: read("finished") };
        });
        count = `${String(started)} started, ${String(finished)} finished`;
        return started > 0 && finished === started;
      },
      { timeout: 20_000 },
    );
  } catch (error) {
    throw new Error(`held reloads did not finish: ${count}`, {
      cause: error,
    });
  }
}

/**
 * Holds what reads a note through `vault.cachedRead` by `delay` milliseconds
 * after the read, with the text it read, as Obsidian's reload does while it
 * writes the file. Counts the reads of the note at `path` among them, for
 * {@link heldReads} and {@link waitForHeldReads}. Returns what takes that
 * back.
 */
async function slowCachedRead(
  path: string,
  delay: number,
): Promise<() => Promise<void>> {
  await browser.executeObsidian(
    ({ app }, counted, wait) => {
      const { vault } = app;
      const read = vault.cachedRead.bind(vault);
      const held = { started: 0, pending: 0 };
      Reflect.set(window, "inklineHeldReads", held);
      vault.cachedRead = async (file) => {
        const counts = file.path === counted;
        if (counts) {
          held.started++;
          held.pending++;
        }
        try {
          const text = await read(file);
          await new Promise((resolve) => {
            window.setTimeout(resolve, wait);
          });
          return text;
        } finally {
          // Counted down once what waits for the read has had it.
          if (counts) {
            window.setTimeout(() => {
              held.pending--;
            });
          }
        }
      };
    },
    path,
    delay,
  );
  return async () => {
    await browser.executeObsidian(({ app }) => {
      Reflect.deleteProperty(app.vault, "cachedRead");
      Reflect.deleteProperty(window, "inklineHeldReads");
    });
  };
}

/**
 * How many reads of its note {@link slowCachedRead} has held so far, and how
 * many of those are under way.
 */
async function heldReads(): Promise<{ started: number; pending: number }> {
  return browser.execute(() => {
    const held: unknown = Reflect.get(window, "inklineHeldReads");
    const read = (key: string): number => {
      const value: unknown = Reflect.get(Object(held), key);
      return typeof value === "number" ? value : -1;
    };
    return { started: read("started"), pending: read("pending") };
  });
}

/**
 * Waits until {@link slowCachedRead} has held a read of its note since
 * `before` were counted, and none is under way, on two looks a frame apart, so
 * that what a read gave has been taken in. The reads of the note as it opened
 * are counted too, so only one since the step under test shows that the step's
 * reload was held. Then waits until the note's text has stayed the same over
 * five looks 100 ms apart, so that what a reload does with a read it had,
 * however long after the read that comes, is in the text the test then asserts
 * on; a read that started during those looks has it all wait again.
 */
async function waitForHeldReads(before: number): Promise<void> {
  const until = Date.now() + 40_000;
  for (;;) {
    let count = "none";
    try {
      await browser.waitUntil(
        async () => {
          const { started, idle } = await browser.execute(async () => {
            const read = (key: string): number => {
              const held: unknown = Reflect.get(window, "inklineHeldReads");
              const value: unknown = Reflect.get(Object(held), key);
              return typeof value === "number" ? value : -1;
            };
            if (read("pending") !== 0) {
              return { started: read("started"), idle: false };
            }
            await new Promise((resolve) => requestAnimationFrame(resolve));
            return { started: read("started"), idle: read("pending") === 0 };
          });
          count = `${String(started)} started, ${String(before)} of them before`;
          return started > before && idle;
        },
        { timeout: 20_000 },
      );
    } catch (error) {
      throw new Error(`held reads of the note did not finish: ${count}`, {
        cause: error,
      });
    }
    // Five looks in a row that agree; a change starts the count again.
    let last = await noteText();
    for (let same = 1; same < 5;) {
      if (Date.now() > until) throw new Error("the note's text did not settle");
      await browser.pause(100);
      const text = await noteText();
      same = text === last ? same + 1 : 1;
      last = text;
    }
    if ((await heldReads()).pending === 0) return;
  }
}

describe("A rename while the note holds unsaved text", function () {
  before(async function () {
    await loadModules();
  });

  beforeEach(async function () {
    await startOver();
    await setLinkUpdates(false);
  });

  const opening = "Opening unsaved line.\n";
  const closing = "Other unsaved text.";
  const renamed = "![[the long gate.ink.png]]";

  /** The note with the unsaved text, with `sign` as the door's sign. */
  function withText(sign: string): string {
    return `${opening}The door is marked with ${sign} which means return.\n${closing}`;
  }

  /** Inserts a symbol with Mod+S, and waits for Obsidian's cache to know it. */
  async function insertAndIndex(settle = 0): Promise<void> {
    await insert({ settle });
    await draw(zigzag);
    await browser.keys(["Control", "s"]);
    await waitForStatus("Saved");
    await waitForLink("Editor.md", "001.ink.png");
  }

  /**
   * {@link insertAndIndex}, and waits past the save that set off, which comes
   * two seconds after the first edit since the last one. Text that arrives
   * during Obsidian's question is out of Inkline's reach, so a test of it keeps
   * that save from landing in the question or in the reload after it.
   */
  async function insertAndWait(): Promise<void> {
    await insertAndIndex();
    await browser.pause(2100);
  }

  /** Adds unsaved text on both sides of the symbol. */
  async function addBoth(path: string, pane = 0): Promise<void> {
    await addUnsaved(path, opening, "start", pane);
    await addUnsaved(path, closing, "end", pane);
  }

  async function nameIt(): Promise<void> {
    await browser.$(".inkline-editor .inkline-name").setValue("the long gate");
  }

  /** Saves the editor under the new name, answering Obsidian if it asks. */
  async function saveRenamed(answer: string | undefined): Promise<void> {
    await nameIt();
    await browser.keys(["Control", "Enter"]);
    if (answer !== undefined) await clickTop(answer);
    await waitClosed();
  }

  // How the links are to update: by the setting, or by the answer to Obsidian's
  // question. With Do not update, Inkline's embed follows on its own.
  const ways: readonly (readonly [string, string | undefined])[] = [
    ["automatic link updates", undefined],
    ["Just once", "Just once"],
    ["Do not update", "Do not update"],
  ];

  for (const [how, answer] of ways) {
    describe(`with ${how}`, function () {
      beforeEach(async function () {
        await setLinkUpdates(answer === undefined);
      });

      it("writes the new name once and keeps the text, in a plain note", async function () {
        await insertAndIndex();
        await addBoth("Editor.md");
        await saveRenamed(answer);
        await waitForPanes("Editor.md", withText(renamed));
        await waitForFile("Editor.md", withText(renamed));
        expect(await marked("Editor.md")).toEqual([withText(`${renamed}|`)]);
        await type("xy");
        await waitForNote(withText(`${renamed}xy`));
        await waitForFile("Editor.md", withText(`${renamed}xy`));
      });

      for (const [pane, which] of [
        [0, "the pane that took the symbol"],
        [1, "another pane"],
      ] as const) {
        it(`does so in two panes, with the text from ${which}`, async function () {
          await insertAndIndex();
          await openBeside("Editor.md");
          await addBoth("Editor.md", pane);
          await saveRenamed(answer);
          await waitForPanes("Editor.md", withText(renamed));
          await waitForFile("Editor.md", withText(renamed));
          expect((await marked("Editor.md"))[0]).toBe(withText(`${renamed}|`));
          // Past the other pane's own save. Falling due during typing here, it
          // has Obsidian merge a character twice, with no symbol involved.
          await browser.pause(2100);
          await type("xy");
          await waitForPanes("Editor.md", withText(`${renamed}xy`));
          await waitForFile("Editor.md", withText(`${renamed}xy`));
        });
      }

      it("does so once the note is closed", async function () {
        await insertAndIndex();
        await addBoth("Editor.md");
        await closeTabs("Editor.md");
        await saveRenamed(answer);
        await waitForFile("Editor.md", withText(renamed));
      });

      it("does so in Reading view", async function () {
        await insertAndIndex();
        await addBoth("Editor.md");
        await showAs("Editor.md", "preview");
        await saveRenamed(answer);
        await waitForFile("Editor.md", withText(renamed));
        await showAs("Editor.md", "source");
        await waitForNote(withText(renamed));
      });

      it("does so in a table cell", async function () {
        await intoCell("Table.md");
        await browser.executeObsidianCommand("inkline:insert-symbol");
        await waitForEditor();
        await draw(zigzag);
        await browser.keys(["Control", "s"]);
        await waitForStatus("Saved");
        await waitForLink("Table.md", "001.ink.png");
        await addUnsaved("Table.md", opening, "start");
        await saveRenamed(answer);
        await waitForLastRow(`| same${renamed} | same |`);
        await type("xy");
        await waitForLastRow(`| same${renamed}xy | same |`);
        const note = await noteText();
        expect(note.startsWith(opening)).toBe(true);
        expect(note.split("![[")).toHaveLength(2);
        // Saved like any edit, and written once.
        let disk = "";
        await browser.waitUntil(async () => {
          disk = await browser.executeObsidian(async ({ app }) => {
            const file = app.vault.getFileByPath("Table.md");
            if (file === null) throw new Error("no note");
            return app.vault.read(file);
          });
          return disk.includes(`| same${renamed}xy`);
        });
        expect(disk.startsWith(opening)).toBe(true);
        expect(disk.split("![[")).toHaveLength(2);
      });

      it("keeps the next symbol's place, through a reload", async function () {
        await insertAndIndex();
        await addBoth("Editor.md");
        await nameIt();
        await markEditor();
        await browser.keys(["Control", "Shift", "Enter"]);
        if (answer !== undefined) await clickTop(answer);
        await waitForNext(1);
        await waitForPanes("Editor.md", withText(renamed));
        // Obsidian takes the cursor away from the embed here.
        await rewrite("Editor.md", (text) => `A new first line.\n${text}`);
        await draw([[0.5, 0.5]]);
        await save();
        const both = `${renamed}![[001.ink.png]]`;
        await waitForNote(`A new first line.\n${withText(both)}`);
        expect(await marked("Editor.md")).toEqual([
          `A new first line.\n${withText(`${both}|`)}`,
        ]);
        await type("xy");
        await waitForNote(`A new first line.\n${withText(`${both}xy`)}`);
      });
    });
  }

  // The modal over the note stops typing, but not another window or a plugin,
  // so text can arrive once the note was saved, with Obsidian's question open.
  for (const answer of ["Just once", "Do not update"]) {
    describe(`when text arrives during the question, with ${answer}`, function () {
      async function askAndAdd(keys: string[]): Promise<void> {
        await nameIt();
        await browser.keys(keys);
        await waitForTop(answer);
        await addBoth("Editor.md");
        await clickTop(answer);
      }

      it("writes the new name once and keeps the text", async function () {
        await insertAndWait();
        await askAndAdd(["Control", "Enter"]);
        await waitClosed();
        await waitForNote(withText(renamed));
        await waitForFile("Editor.md", withText(renamed));
        expect(await marked("Editor.md")).toEqual([withText(`${renamed}|`)]);
        await type("xy");
        await waitForNote(withText(`${renamed}xy`));
      });

      it("keeps the next symbol's place", async function () {
        await insertAndWait();
        await markEditor();
        await askAndAdd(["Control", "Shift", "Enter"]);
        await waitForNext(1);
        await waitForNote(withText(renamed));
        await draw([[0.5, 0.5]]);
        await save();
        const both = `${renamed}![[001.ink.png]]`;
        await waitForNote(withText(both));
        expect(await marked("Editor.md")).toEqual([withText(`${both}|`)]);
      });
    });
  }

  // Until the reload lands, an editor holding other text still shows the old
  // embed, and writing it there too would double it. The editor's blur as a
  // modal closes saves the note, which a reload under way would then undo.
  describe("when Obsidian is slow to reload the note", function () {
    // The held reload goes with the note's view; its count is taken away here.
    afterEach(async function () {
      await browser.execute(() => {
        Reflect.deleteProperty(window, "inklineHeldReloads");
      });
    });

    /**
     * Renames the symbol, and adds text during Obsidian's question, with the
     * reload held; runs `meanwhile` just before the answer.
     */
    async function askAndHold(
      keys: string[],
      meanwhile?: () => Promise<void>,
    ): Promise<void> {
      await insertAndWait();
      await markEditor();
      await slowReload("Editor.md", 300);
      await nameIt();
      await browser.keys(keys);
      await waitForTop("Just once");
      await addBoth("Editor.md");
      await meanwhile?.();
      await clickTop("Just once");
    }

    it("leaves the embed to it, and keeps the text", async function () {
      await askAndHold(["Control", "Enter"]);
      await waitClosed();
      await waitForNote(withText(renamed));
      await waitForFile("Editor.md", withText(renamed));
      expect(await marked("Editor.md")).toEqual([withText(`${renamed}|`)]);
      await type("xy");
      await waitForNote(withText(`${renamed}xy`));
    });

    it("writes the embed itself once a save undid Obsidian's", async function () {
      const old = "![[001.ink.png]]";
      // At Obsidian's own write after the answer, every editor saves what it
      // holds, which still has the old embed. Every write of the note from
      // here on is kept in order: what `vault.modify`, through which an
      // editor saves, wrote, and what a `vault.process`, through which
      // Inkline writes a note, read from the file and wrote. So is how many
      // writes there were at Obsidian's, and whether the saves have ended.
      // This shows that Inkline finds the old embed and writes the new one. On
      // Obsidian 1.13.4 it also shows that Inkline looks again after its first
      // look: with only the first look, the test fails there. On 1.15.1 the
      // first look already comes after the saves, so it passes there either
      // way, and the repeated look is shown on 1.13.4 alone.
      const saveAtNextWrite = async (): Promise<void> => {
        await browser.executeObsidian(({ app, obsidian }) => {
          const { vault } = app;
          const seen: {
            writes: { how: string; given?: string; text: string }[];
            fired?: number;
            saved: boolean;
          } = { writes: [], saved: false };
          Reflect.set(window, "inklineSaveOnModify", seen);
          const modify = vault.modify.bind(vault);
          vault.modify = async (file, text, options) => {
            if (file.path === "Editor.md") {
              seen.writes.push({ how: "modify", text });
            }
            return modify(file, text, options);
          };
          const process = vault.process.bind(vault);
          vault.process = async (file, change, options) =>
            process(
              file,
              (given) => {
                const text = change(given);
                if (file.path === "Editor.md") {
                  seen.writes.push({ how: "process", given, text });
                }
                return text;
              },
              options,
            );
          const saves = vault.on("modify", (file) => {
            if (file.path !== "Editor.md") return;
            vault.offref(saves);
            seen.fired = seen.writes.length;
            const saving: Promise<void>[] = [];
            for (const { view } of app.workspace.getLeavesOfType("markdown")) {
              if (view instanceof obsidian.MarkdownView) {
                saving.push(view.save());
              }
            }
            void Promise.all(saving).then(() => {
              seen.saved = true;
            });
          });
          Reflect.set(window, "inklineStopSaveOnModify", () => {
            vault.offref(saves);
            Reflect.deleteProperty(vault, "modify");
            Reflect.deleteProperty(vault, "process");
          });
        });
      };
      /** What {@link saveAtNextWrite} has kept. */
      const seen = () =>
        browser.execute(
          () =>
            Reflect.get(window, "inklineSaveOnModify") as {
              writes: { how: string; given?: string; text: string }[];
              fired?: number;
              saved: boolean;
            },
        );
      try {
        await askAndHold(["Control", "Enter"], saveAtNextWrite);
        await waitClosed();
        await waitForNote(withText(renamed));
        await waitForFile("Editor.md", withText(renamed));
        expect(await marked("Editor.md")).toEqual([withText(`${renamed}|`)]);
        await browser.waitUntil(async () => (await seen()).saved, {
          timeoutMsg: "the saves at Obsidian's write did not end",
        });
        const { writes, fired = 0 } = await seen();
        // The saves came at Obsidian's write of the new embed into the file,
        // which holds none of the unsaved text, not at the note's own save,
        // and wrote the old embed back, with that text.
        expect(fired).toBeGreaterThan(0);
        expect(writes[fired - 1]?.text).toBe(
          `The door is marked with ${renamed} which means return.\n`,
        );
        const after = writes.slice(fired);
        expect(after).toContainEqual({ how: "modify", text: withText(old) });
        const undone = after.findIndex(
          ({ how, text }) => how === "modify" && text === withText(old),
        );
        // Then Inkline found the old embed in the file, and wrote the new one.
        expect(
          after
            .slice(undone + 1)
            .filter(({ how }) => how === "process")
            .map(({ given, text }) => [given, text]),
        ).toContainEqual([withText(old), withText(renamed)]);
      } finally {
        await browser.execute(() => {
          const stop: unknown = Reflect.get(window, "inklineStopSaveOnModify");
          Reflect.deleteProperty(window, "inklineStopSaveOnModify");
          Reflect.deleteProperty(window, "inklineSaveOnModify");
          if (typeof stop === "function") Reflect.apply(stop, undefined, []);
        });
      }
    });

    // A save that starts once the reload has read the file has it take that
    // file as it is, and the editor's blur makes one as the next editor opens.
    // A reload held past two seconds meets the editor's own save the same way,
    // with nothing of Inkline's taking part: the text leaves the editor until
    // the reload that the fresh file sets off lands, so the last look waits.
    for (const hold of [300, 3000]) {
      for (const [how, keys, gone] of [
        [
          "the next editor takes the focus",
          ["Control", "Shift", "Enter"],
          () => waitForNext(1),
        ],
        ["the editor closes", ["Control", "Enter"], waitClosed],
      ] as const) {
        it(`keeps the text when ${how}, with the reload held ${String(hold)} ms`, async function () {
          const restore = await slowCachedRead("Editor.md", hold);
          try {
            await insertAndWait();
            await markEditor();
            await nameIt();
            await browser.keys([...keys]);
            await waitForTop("Just once");
            await addBoth("Editor.md");
            // The note's reads so far, as it opened, are not the rename's.
            const { started } = await heldReads();
            await clickTop("Just once");
            await gone();
            await waitForNote(withText(renamed));
            await waitForFile("Editor.md", withText(renamed));
            // Past every held read since the answer, whose text would revert
            // the note's, and what the reload did with it.
            await waitForHeldReads(started);
            console.log(
              `Held ${String((await heldReads()).started - started)} reads of the note after the answer, ${String(started)} before`,
            );
            expect(await noteText()).toBe(withText(renamed));
            await waitForFile("Editor.md", withText(renamed));
          } finally {
            await restore();
          }
        });
      }
    }

    // With the reload and the editor's own save both held past the time Inkline
    // gives them, nothing settles it. Writing or saving then would cost the text.
    it("writes nothing when nothing settles it in time, and says so", async function () {
      const old = "![[001.ink.png]]";
      await insertAndWait();
      await delayVault("modify", 6000, "before");
      await slowReload("Editor.md", 9000);
      await nameIt();
      await browser.keys(["Control", "Enter"]);
      await waitForTop("Just once");
      await addBoth("Editor.md");
      await clickTop("Just once");
      await waitForNotice("Check the symbol's embed in Editor");
      await waitClosed();
      expect(await noteText()).toBe(withText(old));
      await waitForFile(
        "Editor.md",
        `The door is marked with ${renamed} which means return.\n`,
      );
      // The editor's own save lands, and the reload after it finds nothing to
      // do. That loses the rename step, as the notice says, and never the text.
      await waitForFile("Editor.md", withText(old));
      // Once the held reload has landed, which can be after the save.
      await waitForHeldReloads();
      expect(await noteText()).toBe(withText(old));
      await waitForFile("Editor.md", withText(old));
    });

    it("keeps the text and the next symbol's place through Next", async function () {
      await askAndHold(["Control", "Shift", "Enter"]);
      await waitForNext(1);
      await waitForNote(withText(renamed));
      await waitForFile("Editor.md", withText(renamed));
      await draw([[0.5, 0.5]]);
      await save();
      const both = `${renamed}![[001.ink.png]]`;
      await waitForNote(withText(both));
      expect(await marked("Editor.md")).toEqual([withText(`${both}|`)]);
    });
  });

  it("writes the new name once with text only after it, in two panes", async function () {
    await setLinkUpdates(true);
    await insertAndIndex();
    await openBeside("Editor.md");
    await addUnsaved("Editor.md", `\n${closing}`, "end");
    await saveRenamed(undefined);
    const text = `The door is marked with ${renamed} which means return.\n\n${closing}`;
    await waitForPanes("Editor.md", text);
    await waitForFile("Editor.md", text);
  });

  // Obsidian holds the offsets of the note's links from before the question,
  // and writes at them after it, whatever an editor's own save did meanwhile.
  it("keeps the text when the note would have saved itself during the question", async function () {
    await insertAndIndex();
    await addUnsaved("Editor.md", opening, "start");
    await nameIt();
    await browser.keys(["Control", "Enter"]);
    await waitForTop("Just once");
    // An editor saves itself two seconds after an edit.
    await browser.pause(2500);
    await clickTop("Just once");
    await waitClosed();
    const text = `${opening}The door is marked with ${renamed} which means return.\n`;
    await waitForFile("Editor.md", text);
    await waitForNote(text);
    expect(await marked("Editor.md")).toEqual([
      `${opening}The door is marked with ${renamed}| which means return.\n`,
    ]);
  });

  it("refuses a rename if the note cannot be saved, and changes nothing", async function () {
    const old = "![[001.ink.png]]";
    await insertAndWait();
    // Saves fail before the text is added, and until the file is read and
    // the note's own save has failed as well as the rename's (#234).
    const restore = await failSaves();
    try {
      await addBoth("Editor.md");
      await nameIt();
      await browser.keys(["Control", "s"]);
      await waitForNotice(
        "001.ink.png is saved, but could not be renamed: the note Editor could not be saved first",
      );
      await waitForStatus("Saved, but not renamed");
      await waitForFailedSaves("Editor.md", 2);
      await waitForFile(
        "Editor.md",
        `The door is marked with ${old} which means return.\n`,
      );
    } finally {
      await restore();
    }
    expect(await symbolFiles()).toEqual(["001.ink.png"]);
    expect(await noteText()).toBe(withText(old));
    // The name stays in the field, for the next save to try.
    await browser.keys(["Control", "Enter"]);
    await clickTop("Just once");
    await waitClosed();
    await waitForNote(withText(renamed));
    await waitForFile("Editor.md", withText(renamed));
  });

  // On Obsidian 1.13 a save that comes during another returns before its text
  // is written, and the rename is refused. 1.15 waits for it, and goes on.
  it("never renames past a save still under way", async function () {
    const answerable = async (): Promise<boolean> =>
      (await topButton("Just once")) !== undefined;
    await insertAndWait();
    await addUnsaved("Editor.md", opening, "start");
    await delayVault("modify", 1500, "before");
    await browser.executeObsidian(({ app, obsidian }) => {
      void app.workspace.getActiveViewOfType(obsidian.MarkdownView)?.save();
    });
    await addUnsaved("Editor.md", closing, "end");
    await nameIt();
    await browser.keys(["Control", "Enter"]);
    await browser.waitUntil(
      async () =>
        (await answerable()) ||
        (await browser.$(".inkline-status").getText()).includes("not renamed"),
    );
    if (!(await answerable())) {
      await waitForFile("Editor.md", withText("![[001.ink.png]]"));
      await browser.keys(["Control", "Enter"]);
      await browser.waitUntil(answerable);
    }
    // Past every save that was under way, as offsets taken too soon show then.
    await browser.pause(3500);
    await clickTop("Just once");
    await waitClosed();
    await waitForFile("Editor.md", withText(renamed));
    await waitForNote(withText(renamed));
  });

  it("takes the rename and the text back one undo at a time", async function () {
    await setLinkUpdates(true);
    await insertAndIndex(undoGroup);
    await addBoth("Editor.md");
    await saveRenamed(undefined);
    await waitForNote(withText(renamed));
    const steps = [
      withText("![[001.ink.png]]"),
      `${opening}The door is marked with ![[001.ink.png]] which means return.\n`,
      "The door is marked with ![[001.ink.png]] which means return.\n",
      "The door is marked with  which means return.\n",
    ];
    for (const step of steps) {
      await browser.keys(["Control", "z"]);
      await waitForNote(step);
    }
  });
});
