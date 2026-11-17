import { browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import { draftLifetime } from "../../../src/editor/drafts.ts";
import { loadModules } from "../support/browser.ts";
import {
  editFile,
  inklineOn,
  insert,
  nameSymbol,
  saveOne,
  strokeCount,
  waitClosed,
  zigzag,
} from "../support/editing.ts";
import {
  draw,
  followSave,
  hold,
  letGo,
  recordOf,
  undoStubs,
  waitForHeld,
  waitForSaveEnd,
  startOver,
  symbolFiles,
  clickTop,
  topButton,
  waitForStatus,
} from "../support/editor.ts";
import {
  changeElsewhere,
  createSquare,
  noteOnDisk,
  waitForLink,
} from "../support/vault-files.ts";

describe("The editor", function () {
  before(async function () {
    await loadModules();
  });

  beforeEach(async function () {
    await startOver();
  });

  // A test that fails midway can leave a file operation held or replaced, or
  // Inkline off, which every test after it would then fail on.
  afterEach(async function () {
    await undoStubs();
    if (!(await inklineOn())) {
      await obsidianPage.enablePlugin("inkline");
      await loadModules();
    }
  });

  describe("when Inkline is disabled while Obsidian renames a symbol it saved", function () {
    const down = [
      [0.6, 0.3],
      [0.6, 0.7],
    ] as const;
    const across = [
      [0.3, 0.5],
      [0.7, 0.5],
    ] as const;

    // Obsidian's own move or link update, held, goes on as it would, so that
    // a failed test leaves no rejection inside Obsidian's rename.
    afterEach(async function () {
      await letGo();
    });

    /**
     * The drafts in the vault's local storage, as stored, which needs no
     * Inkline: each one's id, the path of the file it names, and how many
     * strokes it holds.
     */
    async function keptDrafts(): Promise<
      { id: string; path?: string; strokes: number }[]
    > {
      return browser.executeObsidian(({ app }) => {
        const ids: unknown = app.loadLocalStorage("inkline-drafts");
        if (!Array.isArray(ids)) return [];
        return ids
          .filter((id): id is string => typeof id === "string")
          .map((id) => {
            const stored: unknown = app.loadLocalStorage(`inkline-draft:${id}`);
            const draft = (
              typeof stored === "string" ? JSON.parse(stored) : {}
            ) as {
              target?: { path?: unknown };
              ink?: { strokes?: unknown[] };
            };
            const path = draft.target?.path;
            return {
              id,
              ...(typeof path === "string" ? { path } : {}),
              strokes: draft.ink?.strokes?.length ?? 0,
            };
          });
      });
    }

    async function enable(): Promise<void> {
      await obsidianPage.enablePlugin("inkline");
      await loadModules();
    }

    /**
     * The draft `id` as stored, which needs no Inkline: the path of the file it
     * names, how it keeps its base layer, and when it was kept; null once gone.
     */
    async function storedDraft(
      id: string,
    ): Promise<{ path?: string; base?: string; savedAt?: number } | null> {
      return browser.executeObsidian(({ app }, key) => {
        const stored: unknown = app.loadLocalStorage(`inkline-draft:${key}`);
        if (typeof stored !== "string") return null;
        const draft = JSON.parse(stored) as {
          target?: { path?: unknown };
          base?: unknown;
          savedAt?: unknown;
        };
        const path = draft.target?.path;
        return {
          ...(typeof path === "string" ? { path } : {}),
          ...(typeof draft.base === "string" ? { base: draft.base } : {}),
          ...(typeof draft.savedAt === "number"
            ? { savedAt: draft.savedAt }
            : {}),
        };
      }, id);
    }

    /**
     * Makes the stored draft `id` a minute past its lifetime, as if it had
     * waited that long, and returns when it now says it was kept.
     */
    async function expire(id: string): Promise<number> {
      return browser.executeObsidian(
        ({ app }, key, lifetime) => {
          const stored: unknown = app.loadLocalStorage(`inkline-draft:${key}`);
          if (typeof stored !== "string") throw new Error("no draft");
          const draft = JSON.parse(stored) as Record<string, unknown>;
          const savedAt = Date.now() - lifetime - 60_000;
          app.saveLocalStorage(
            `inkline-draft:${key}`,
            JSON.stringify({ ...draft, savedAt }),
          );
          return savedAt;
        },
        id,
        draftLifetime,
      );
    }

    /**
     * Waits for Obsidian to have updated the link in `Editor.md`, which comes
     * at the end of its rename.
     */
    async function waitForLinkInNote(): Promise<void> {
      await browser.waitUntil(async () =>
        (await noteOnDisk("Editor.md")).includes("![[gate.ink.png]]"),
      );
    }

    /**
     * Waits for the old save's rename to end, once Obsidian updated the link,
     * and the save with it, which settles its draft as it ends.
     */
    async function waitForLinkUpdate(): Promise<void> {
      await waitForLinkInNote();
      await waitForSaveEnd();
    }

    /**
     * Holds back the result of every read of the file at `path` made while
     * Inkline is disabled, as the file was when it was read, until
     * {@link letReadsGo}: such as a look at the file by the save that was
     * running as Inkline was turned off, if it makes one. Each read held is
     * counted, for {@link waitForSaveEndOrRead}.
     */
    async function holdReadsWhileOff(path: string): Promise<void> {
      await browser.executeObsidian(({ app }, file) => {
        const { vault } = app;
        const read = vault.readBinary.bind(vault);
        let go = (): void => undefined;
        const gate = new Promise<void>((resolve) => {
          go = resolve;
        });
        const held = { reads: 0 };
        Reflect.set(window, "inklineReadsHeld", held);
        const letReadsGo = () => {
          // Held, it is the vault's own, over what its prototype has.
          Reflect.deleteProperty(vault, "readBinary");
          go();
        };
        Reflect.set(window, "inklineLetReadsGo", letReadsGo);
        Reflect.set(window, "inklineAtEnd-readsWhileOff", letReadsGo);
        const enabled = (): boolean => {
          const plugins: unknown = Reflect.get(app, "plugins");
          const on: unknown =
            typeof plugins === "object" && plugins !== null
              ? Reflect.get(plugins, "enabledPlugins")
              : undefined;
          return on instanceof Set && on.has("inkline");
        };
        vault.readBinary = async (target) => {
          const off = !enabled();
          const bytes = await read(target);
          if (off && target.path === file) {
            held.reads++;
            await gate;
          }
          return bytes;
        };
      }, path);
    }

    /**
     * Waits for the old save to end, or to be held reading its file by
     * {@link holdReadsWhileOff}, which it cannot end before: either way, what
     * it reads of the file is the file as it is now.
     */
    async function waitForSaveEndOrRead(): Promise<void> {
      await waitForSaveEnd({
        what: "to be held reading the file",
        until: async () =>
          browser.execute(() => {
            const held: unknown = Reflect.get(window, "inklineReadsHeld");
            return (
              typeof held === "object" &&
              held !== null &&
              Number(Reflect.get(held, "reads")) > 0
            );
          }),
      });
    }

    /** Lets go what {@link holdReadsWhileOff} held. */
    async function letReadsGo(): Promise<void> {
      await browser.execute(() => {
        const go: unknown = Reflect.get(window, "inklineLetReadsGo");
        Reflect.deleteProperty(window, "inklineLetReadsGo");
        Reflect.deleteProperty(window, "inklineAtEnd-readsWhileOff");
        if (typeof go === "function") Reflect.apply(go, undefined, []);
      });
    }

    /** What the topmost modal says. */
    async function topText(): Promise<string> {
      return browser.execute(
        () =>
          [...document.querySelectorAll(".modal-container")].at(-1)
            ?.textContent ?? "",
      );
    }

    /**
     * Opens the editor of `001.ink.png`, which `Editor.md` embeds, adds a
     * stroke, names it `gate`, and saves, holding Obsidian's move of the file,
     * with the drawing written. The save is followed, for
     * {@link waitForSaveEnd}.
     */
    async function saveHeldInMove(): Promise<void> {
      await saveOne();
      await waitForLink("Editor.md", "001.ink.png");
      await editFile("001.ink.png");
      await draw(down);
      await nameSymbol("gate");
      await hold("move");
      await browser.keys(["Control", "s"]);
      await waitForHeld();
      await followSave();
      expect(await strokeCount("001.ink.png")).toBe(2);
    }

    /**
     * After {@link saveHeldInMove}, draws a stroke while the save waits for
     * Obsidian, which is not part of it, and returns the id of the draft that
     * then holds all three strokes.
     */
    async function drawWhileHeld(): Promise<string> {
      await draw(across);
      await browser.waitUntil(
        async () => (await keptDrafts())[0]?.strokes === 3,
        { timeoutMsg: "no draft held the stroke drawn during the save" },
      );
      const [kept] = await keptDrafts();
      if (kept === undefined) throw new Error("no draft");
      return kept.id;
    }

    /**
     * Opens the picture `square.ink.png`, whose pixels open as the base layer,
     * draws a stroke over it, names it `gate`, and saves, holding Obsidian's
     * move of the file, with the drawing written; then draws a stroke that is
     * not part of the save. Returns the id of the draft that holds both
     * strokes, and the base layer the save wrote.
     */
    async function saveSquareHeldInMove(): Promise<{
      id: string;
      base: unknown;
    }> {
      await createSquare();
      await editFile("square.ink.png");
      await draw(zigzag);
      await nameSymbol("gate");
      await hold("move");
      await browser.keys(["Control", "s"]);
      await waitForHeld();
      await followSave();
      const written = JSON.parse(await recordOf("square.ink.png")) as {
        strokes: unknown[];
        base?: unknown;
      };
      expect(written.strokes).toHaveLength(1);
      expect(written.base).toBeDefined();
      await draw(across);
      await browser.waitUntil(
        async () => (await keptDrafts())[0]?.strokes === 2,
        { timeoutMsg: "no draft held the stroke drawn during the save" },
      );
      const [kept] = await keptDrafts();
      if (kept === undefined) throw new Error("no draft");
      return { id: kept.id, base: written.base };
    }

    /** A base layer's picture and size, without its place in the file. */
    function picture(base: unknown): Record<string, unknown> {
      if (typeof base !== "object" || base === null) {
        throw new Error("no base layer");
      }
      const { png, width, height } = base as Record<string, unknown>;
      return { png, width, height };
    }

    /**
     * Restores the draft offered for `path`, saves it, and expects the file to
     * hold both its strokes and the base layer `base`.
     */
    async function expectRestored(path: string, base: unknown): Promise<void> {
      await editFile(path);
      await clickTop("Restore");
      await browser.keys(["Control", "Enter"]);
      await waitClosed();
      const restored = JSON.parse(await recordOf(path)) as {
        strokes: unknown[];
        base?: unknown;
      };
      expect(restored.strokes).toHaveLength(2);
      // The same picture, where the strokes put it: its place in the file goes
      // by how far left the drawing reaches, which the extra stroke changes.
      expect(restored.base).toMatchObject(picture(base));
      expect(await keptDrafts()).toEqual([]);
    }

    it("drops a new symbol's draft that the file holds, once the save that wrote it ends with Obsidian's question", async function () {
      await insert();
      await draw(zigzag);
      await browser.keys(["Control", "s"]);
      await waitForStatus("Saved");
      await nameSymbol("gate");
      await browser.keys(["Control", "Enter"]);
      await browser.waitUntil(
        async () => (await topButton("Do not update")) !== undefined,
      );
      await followSave();
      await obsidianPage.disablePlugin("inkline");
      try {
        // Kept while the save waits, for the file Obsidian has moved by now.
        expect(await keptDrafts()).toMatchObject([
          { path: "gate.ink.png", strokes: 1 },
        ]);
        await clickTop("Do not update");
        await waitForLinkUpdate();
        // Kept for the file where it is: nothing decides, with Inkline off,
        // whether the file holds it.
        expect(await keptDrafts()).toMatchObject([
          { path: "gate.ink.png", strokes: 1 },
        ]);
        expect(await symbolFiles()).toEqual(["gate.ink.png"]);
      } finally {
        await enable();
      }
      // The next editor of the file finds that it holds every stroke the draft
      // does, and drops the draft without asking.
      await editFile("gate.ink.png");
      expect(await topButton("Restore")).toBeUndefined();
      expect(await keptDrafts()).toEqual([]);
      await browser.keys(["Escape"]);
      await waitClosed();
      expect(await strokeCount("gate.ink.png")).toBe(1);
    });

    it("drops a symbol's draft that the file holds, once the save that wrote it ends with Obsidian's move", async function () {
      await saveHeldInMove();
      await obsidianPage.disablePlugin("inkline");
      try {
        // Kept for the file where it was, as Obsidian has not moved it yet.
        expect(await keptDrafts()).toMatchObject([
          { path: "001.ink.png", strokes: 2 },
        ]);
        await letGo();
        await clickTop("Just once");
        await browser.waitUntil(
          async () => (await keptDrafts())[0]?.path === "gate.ink.png",
          { timeoutMsg: "the draft still named the file's old path" },
        );
        expect(await keptDrafts()).toMatchObject([
          { path: "gate.ink.png", strokes: 2 },
        ]);
        expect(await symbolFiles()).toEqual(["gate.ink.png"]);
      } finally {
        await enable();
      }
      await editFile("gate.ink.png");
      expect(await topButton("Restore")).toBeUndefined();
      expect(await keptDrafts()).toEqual([]);
      await browser.keys(["Escape"]);
      await waitClosed();
      expect(await strokeCount("gate.ink.png")).toBe(2);
    });

    it("offers a stroke drawn while Obsidian moved the file back under its new name", async function () {
      await saveHeldInMove();
      const id = await drawWhileHeld();
      await obsidianPage.disablePlugin("inkline");
      try {
        expect(await keptDrafts()).toMatchObject([
          { id, path: "001.ink.png", strokes: 3 },
        ]);
        const kept = await storedDraft(id);
        await letGo();
        await clickTop("Just once");
        await browser.waitUntil(
          async () => (await keptDrafts())[0]?.path === "gate.ink.png",
          { timeoutMsg: "the draft still named the file's old path" },
        );
        // The same draft, now for the file where it is, which holds the two
        // strokes the save wrote, kept when the person last changed it.
        expect(await keptDrafts()).toEqual([
          { id, path: "gate.ink.png", strokes: 3 },
        ]);
        expect((await storedDraft(id))?.savedAt).toBe(kept?.savedAt);
        expect(await symbolFiles()).toEqual(["gate.ink.png"]);
        expect(await strokeCount("gate.ink.png")).toBe(2);
      } finally {
        await enable();
      }
      await editFile("gate.ink.png");
      await browser.waitUntil(
        async () => (await topButton("Restore")) !== undefined,
        { timeoutMsg: "the third stroke was not offered back" },
      );
      // Its strokes line up with the file as that save wrote it.
      expect(await topText()).not.toContain("may not line up");
      await clickTop("Restore");
      await browser.keys(["Control", "Enter"]);
      await waitClosed();
      expect(await symbolFiles()).toEqual(["gate.ink.png"]);
      expect(await strokeCount("gate.ink.png")).toBe(3);
      expect(await keptDrafts()).toEqual([]);
    });

    it("brings back no draft that Inkline, enabled again meanwhile, restored", async function () {
      await saveHeldInMove();
      const id = await drawWhileHeld();
      await obsidianPage.disablePlugin("inkline");
      await enable();
      // Obsidian still holds the move, so the file is where the draft says,
      // and a new editor of it takes the draft over.
      await editFile("001.ink.png");
      await clickTop("Restore");
      await browser.waitUntil(
        async () => {
          const drafts = await keptDrafts();
          return drafts.length === 1 && drafts[0]?.id !== id;
        },
        { timeoutMsg: "the new editor's draft did not replace the old one" },
      );
      await letGo();
      await clickTop("Just once");
      // The old save ends once Obsidian has updated the link.
      await waitForLinkUpdate();
      const drafts = await keptDrafts();
      expect(drafts).toHaveLength(1);
      expect(drafts[0]).toMatchObject({ path: "gate.ink.png", strokes: 3 });
      expect(drafts[0]?.id).not.toBe(id);
      await browser.keys(["Control", "Enter"]);
      await waitClosed();
      expect(await strokeCount("gate.ink.png")).toBe(3);
      expect(await keptDrafts()).toEqual([]);
    });

    it("keeps the draft's own base layer when the file changes elsewhere as Obsidian moves it", async function () {
      const { id, base } = await saveSquareHeldInMove();
      await obsidianPage.disablePlugin("inkline");
      try {
        expect(await storedDraft(id)).toMatchObject({
          path: "square.ink.png",
          base: "kept",
        });
        // As sync or another app would write it: three dots, no base layer.
        await changeElsewhere("square.ink.png");
        await letGo();
        await browser.waitUntil(
          async () => (await storedDraft(id))?.path === "gate.ink.png",
          { timeoutMsg: "the draft still named the file's old path" },
        );
        // The file holds what was written elsewhere, which the draft must not
        // depend on.
        expect(await storedDraft(id)).toMatchObject({ base: "kept" });
        expect(await strokeCount("gate.ink.png")).toBe(3);
      } finally {
        await enable();
      }
      await expectRestored("gate.ink.png", base);
    });

    it("keeps the draft's own base layer when Inkline, enabled again, saves the symbol as Obsidian moves it", async function () {
      const { id, base } = await saveSquareHeldInMove();
      await obsidianPage.disablePlugin("inkline");
      await enable();
      // Obsidian still holds the move. A new editor of the file leaves the
      // draft for later, and saves another drawing over it, without the
      // picture.
      await editFile("square.ink.png");
      await clickTop("Not now");
      await browser.$('[data-inkline-button="clear"]').click();
      await draw(down);
      await browser.keys(["Control", "Enter"]);
      await waitClosed();
      const replaced = JSON.parse(await recordOf("square.ink.png")) as {
        strokes: unknown[];
        base?: unknown;
      };
      expect(replaced.strokes).toHaveLength(1);
      expect(replaced.base).toBeUndefined();
      await letGo();
      // The old save ends just after Obsidian has moved the file, as no note
      // links to it to ask about.
      await browser.waitUntil(
        async () => (await symbolFiles()).includes("gate.ink.png"),
        { timeoutMsg: "Obsidian did not move the file" },
      );
      await waitForSaveEnd();
      expect(await storedDraft(id)).toMatchObject({
        path: "gate.ink.png",
        base: "kept",
      });
      await expectRestored("gate.ink.png", base);
    });

    it("leaves an expired draft to expire, though no list has dropped it", async function () {
      await saveHeldInMove();
      const id = await drawWhileHeld();
      await obsidianPage.disablePlugin("inkline");
      try {
        const savedAt = await expire(id);
        await letGo();
        await clickTop("Just once");
        await waitForLinkUpdate();
        // Neither kept for the new name nor made new again.
        expect(await storedDraft(id)).toEqual({
          path: "001.ink.png",
          base: "none",
          savedAt,
        });
      } finally {
        await enable();
      }
      // Opening lists the drafts, which drops it, and offers nothing.
      await editFile("gate.ink.png");
      expect(await topButton("Restore")).toBeUndefined();
      await browser.keys(["Escape"]);
      await waitClosed();
      expect(await keptDrafts()).toEqual([]);
    });

    it("brings back no expired draft that Inkline, enabled again meanwhile, dropped", async function () {
      await saveHeldInMove();
      const id = await drawWhileHeld();
      await obsidianPage.disablePlugin("inkline");
      await expire(id);
      await enable();
      // Obsidian still holds the move. Opening the file lists the drafts,
      // which drops the expired one, and offers nothing.
      await editFile("001.ink.png");
      expect(await topButton("Restore")).toBeUndefined();
      await browser.keys(["Escape"]);
      await waitClosed();
      expect(await keptDrafts()).toEqual([]);
      await letGo();
      await clickTop("Just once");
      await waitForLinkUpdate();
      expect(await keptDrafts()).toEqual([]);
    });

    it("keeps a draft that the file held when its save ended, though the file is replaced elsewhere after", async function () {
      await saveHeldInMove();
      const [kept] = await keptDrafts();
      if (kept === undefined) throw new Error("no draft");
      await obsidianPage.disablePlugin("inkline");
      try {
        // Whatever the old save reads of the file is the file as it was then.
        await holdReadsWhileOff("gate.ink.png");
        await letGo();
        await clickTop("Just once");
        await waitForLinkInNote();
        await waitForSaveEndOrRead();
        // As sync or another app would write it: three dots.
        await changeElsewhere("gate.ink.png");
        await letReadsGo();
        await waitForSaveEnd();
        expect(await strokeCount("gate.ink.png")).toBe(3);
        expect(await storedDraft(kept.id)).toMatchObject({
          path: "gate.ink.png",
        });
      } finally {
        await letReadsGo();
        await enable();
      }
      // The file holds another drawing now, so the draft is offered.
      await editFile("gate.ink.png");
      await clickTop("Restore");
      await browser.keys(["Control", "Enter"]);
      await waitClosed();
      expect(await strokeCount("gate.ink.png")).toBe(2);
      expect(await keptDrafts()).toEqual([]);
    });

    it("leaves a draft that the file held when its save ended for the next editor of the file, which Inkline enabled again opens", async function () {
      await saveHeldInMove();
      const [kept] = await keptDrafts();
      if (kept === undefined) throw new Error("no draft");
      await obsidianPage.disablePlugin("inkline");
      try {
        await holdReadsWhileOff("gate.ink.png");
        await letGo();
        await clickTop("Just once");
        await waitForLinkInNote();
        await waitForSaveEndOrRead();
        // Nothing has decided whether the file holds it.
        expect(await storedDraft(kept.id)).toMatchObject({
          path: "gate.ink.png",
        });
      } finally {
        await enable();
      }
      // A new editor of the file shows what it holds, which is all the draft
      // holds, so it drops the draft without asking. Then it saves another
      // drawing over it, which is the person's own.
      await editFile("gate.ink.png");
      expect(await topButton("Restore")).toBeUndefined();
      expect(await keptDrafts()).toEqual([]);
      await browser.$('[data-inkline-button="clear"]').click();
      await draw(across);
      await browser.keys(["Control", "Enter"]);
      await waitClosed();
      await letReadsGo();
      await waitForSaveEnd();
      expect(await keptDrafts()).toEqual([]);
      expect(await strokeCount("gate.ink.png")).toBe(1);
    });

    it("offers the draft under the new name when Inkline, enabled again, saves the symbol before the old save ends", async function () {
      await saveHeldInMove();
      const [kept] = await keptDrafts();
      if (kept === undefined) throw new Error("no draft");
      await obsidianPage.disablePlugin("inkline");
      await letGo();
      // Obsidian has moved the file, and asks about the links. The old save
      // waits on that, with its draft for the file where it was.
      await browser.waitUntil(
        async () => (await topButton("Just once")) !== undefined,
      );
      await hold("link");
      await clickTop("Just once");
      await waitForHeld();
      await enable();
      // A new editor of the file finds no draft for it, and saves another
      // drawing over it.
      await editFile("gate.ink.png");
      expect(await topButton("Restore")).toBeUndefined();
      await browser.$('[data-inkline-button="clear"]').click();
      await draw(across);
      await browser.keys(["Control", "Enter"]);
      await waitClosed();
      expect(await storedDraft(kept.id)).toMatchObject({
        path: "001.ink.png",
      });
      await letGo();
      await waitForLinkUpdate();
      // The old save has ended: the draft is for the file where it is, which
      // holds another drawing, so it is offered.
      expect(await storedDraft(kept.id)).toMatchObject({
        path: "gate.ink.png",
      });
      await editFile("gate.ink.png");
      await clickTop("Restore");
      await browser.keys(["Control", "Enter"]);
      await waitClosed();
      expect(await strokeCount("gate.ink.png")).toBe(2);
      expect(await keptDrafts()).toEqual([]);
    });
  });
});
