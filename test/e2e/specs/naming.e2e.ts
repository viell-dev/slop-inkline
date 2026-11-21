import { browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import { linkFinds } from "../../../src/notes/names.ts";
import { loadModules } from "../support/browser.ts";
import {
  editFile,
  inklineOn,
  insert,
  nameField,
  nameSymbol,
  saveOne,
  strokeCount,
  waitClosed,
  zigzag,
} from "../support/editing.ts";
import {
  createSymbol,
  draw,
  editorOpen,
  openAtMarker,
  recordOf,
  storedDrafts,
  undoStubs,
  waitForEditor,
  waitForNotice,
  startOver,
  symbolFiles,
} from "../support/editor.ts";
import { noteOnDisk } from "../support/vault-files.ts";

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

  it("names a second symbol with the next number, and edits a symbol again losslessly", async function () {
    await insert();
    await draw(zigzag);
    await browser.keys(["Control", "Enter"]);
    await waitClosed();
    const first = await recordOf("001.ink.png");

    await browser.executeObsidian(({ app, plugins }) => {
      const file = app.vault.getFileByPath("001.ink.png");
      if (file === null) throw new Error("no file");
      void plugins.inkline.editSymbol(file);
    });
    await waitForEditor();
    // Nothing changed, so it closes without asking.
    await browser.keys(["Escape"]);
    await waitClosed();
    expect(await recordOf("001.ink.png")).toBe(first);

    await browser.executeObsidian(({ app, plugins }) => {
      const file = app.vault.getFileByPath("001.ink.png");
      if (file === null) throw new Error("no file");
      void plugins.inkline.editSymbol(file);
    });
    await draw([
      [0.5, 0.2],
      [0.5, 0.8],
    ]);
    await browser.keys(["Control", "Enter"]);
    await waitClosed();
    const edited = JSON.parse(await recordOf("001.ink.png")) as {
      strokes: unknown[];
    };
    const original = JSON.parse(first) as { strokes: unknown[] };
    expect(edited.strokes).toHaveLength(2);
    expect(edited.strokes[0]).toEqual(original.strokes[0]);

    await openAtMarker("Welcome.md", "vault");
    await browser.executeObsidianCommand("inkline:insert-symbol");
    await draw(zigzag);
    await browser.keys(["Control", "Enter"]);
    await waitClosed();
    expect(await symbolFiles()).toEqual(["001.ink.png", "002.ink.png"]);
  });

  it("names a new symbol as typed, without what a file name cannot hold", async function () {
    await insert();
    expect((await nameField()).value).toBe("");
    await draw(zigzag);
    await nameSymbol("  the gate?  ");
    // Typing a name keeps it in the draft.
    await browser.waitUntil(async () =>
      (await storedDrafts()).some((draft) => draft.name === "  the gate?  "),
    );
    await browser.keys(["Control", "Enter"]);
    await waitClosed();
    expect(await symbolFiles()).toEqual(["the gate.ink.png"]);
    await browser.waitUntil(async () =>
      (await noteOnDisk("Editor.md")).includes("![[the gate.ink.png]]"),
    );
    // Reopened, the field holds its name, and nothing changed closes it.
    await editFile("the gate.ink.png");
    expect(await nameField()).toEqual({
      value: "the gate",
      placeholder: "the gate",
    });
    await browser.keys(["Escape"]);
    await waitClosed();
  });

  it("refuses a name its folder has, in any case, or one Windows keeps", async function () {
    await saveOne();
    await openAtMarker("Welcome.md", "vault");
    await browser.executeObsidianCommand("inkline:insert-symbol");
    await waitForEditor();
    await draw(zigzag);
    for (const [name, reason] of [
      ["001", "the vault's top folder already has a symbol named 001"],
      ["CON", "CON is a name Windows keeps for itself"],
    ] as const) {
      await nameSymbol(name);
      await browser.keys(["Control", "Enter"]);
      await waitForNotice(reason);
      expect(await editorOpen()).toBe(true);
      expect(await symbolFiles()).toEqual(["001.ink.png"]);
    }
    await nameSymbol("arch");
    await browser.keys(["Control", "Enter"]);
    await waitClosed();
    expect(await symbolFiles()).toEqual(["001.ink.png", "arch.ink.png"]);
    // A name that differs only in letter case is the same file on Windows.
    await openAtMarker("Welcome.md", "synthetic");
    await browser.executeObsidianCommand("inkline:insert-symbol");
    await waitForEditor();
    await draw(zigzag);
    await nameSymbol("ARCH");
    await browser.keys(["Control", "Enter"]);
    await waitForNotice("already has a symbol named ARCH");
    expect(await symbolFiles()).toEqual(["001.ink.png", "arch.ink.png"]);
    // A decomposed letter makes the composed name's file, as Obsidian
    // composes names.
    await browser.executeObsidian(async ({ app }) => {
      const file = app.vault.getFileByPath("arch.ink.png");
      if (file === null) throw new Error("no arch");
      await app.vault.copy(file, `caf${String.fromCharCode(0xe9)}.ink.png`);
    });
    await nameSymbol(`cafe${String.fromCharCode(0x301)}`);
    await browser.keys(["Control", "Enter"]);
    await waitForNotice(
      `already has a symbol named caf${String.fromCharCode(0xe9)}`,
    );
  });

  it("keeps a name the symbol was given elsewhere while it was open", async function () {
    await saveOne();
    await editFile("001.ink.png");
    // Renamed as the file explorer or sync would, without Inkline.
    await browser.executeObsidian(async ({ app }) => {
      const file = app.vault.getFileByPath("001.ink.png");
      if (file === null) throw new Error("no 001");
      await app.vault.rename(file, "tower.ink.png");
    });
    await browser.waitUntil(async () => (await nameField()).value === "tower");
    await draw([
      [0.6, 0.3],
      [0.6, 0.7],
    ]);
    await browser.keys(["Control", "Enter"]);
    await waitClosed();
    expect(await symbolFiles()).toEqual(["tower.ink.png"]);
  });

  it("keeps a name the symbol has that Inkline would not give it", async function () {
    await saveOne();
    // A copy named as the file explorer or sync can name it, with a character
    // links cannot hold. Dots at the end, and a name only Windows refuses,
    // take the same way through the editor, which goes by chooseRename alone:
    // names.test.ts keeps a file's own name of each kind.
    const name = "a#1";
    await browser.executeObsidian(async ({ app }, path) => {
      const file = app.vault.getFileByPath("001.ink.png");
      if (file === null) throw new Error("no 001");
      await app.vault.copy(file, path);
    }, `${name}.ink.png`);
    await editFile(`${name}.ink.png`);
    expect((await nameField()).value).toBe(name);
    // Nothing changed, so closing asks nothing.
    await browser.keys(["Escape"]);
    await waitClosed();
    // And a save keeps the name.
    await editFile(`${name}.ink.png`);
    await draw([
      [0.6, 0.3],
      [0.6, 0.7],
    ]);
    await browser.keys(["Control", "Enter"]);
    await waitClosed();
    expect(await strokeCount(`${name}.ink.png`)).toBe(2);
    expect(await symbolFiles()).toEqual(["001.ink.png", `${name}.ink.png`]);
  });

  it("keeps the joiners a name is spelled with", async function () {
    // Three faces joined into one emoji, set as typing it would.
    const family = String.fromCodePoint(
      0x1f468,
      0x200d,
      0x1f469,
      0x200d,
      0x1f467,
    );
    await insert();
    await draw(zigzag);
    await browser.execute((name) => {
      const field = document.querySelector(".inkline-editor .inkline-name");
      if (!(field instanceof HTMLInputElement)) throw new Error("no field");
      field.value = name;
      field.dispatchEvent(new Event("input", { bubbles: true }));
    }, family);
    await browser.keys(["Control", "Enter"]);
    await waitClosed();
    expect(await symbolFiles()).toEqual([`${family}.ink.png`]);
  });

  it("skips a number that a folder already has", async function () {
    await browser.executeObsidian(async ({ app }) => {
      await app.vault.createFolder("001.ink.png");
    });
    await insert();
    await draw(zigzag);
    await browser.keys(["Control", "Enter"]);
    await waitClosed();
    expect(await symbolFiles()).toEqual(["002.ink.png"]);
  });

  it("skips the number of a deleted symbol while a note still embeds it", async function () {
    /** How many times Old.md links to 002.ink.png, which is not there. */
    const unresolved = () =>
      browser.executeObsidian(
        ({ app }) =>
          app.metadataCache.unresolvedLinks["Old.md"]?.["002.ink.png"] ?? 0,
      );
    await createSymbol("001.ink.png");
    await createSymbol("002.ink.png");
    await browser.executeObsidian(async ({ app }) => {
      await app.vault.create("Old.md", "The old door: ![[002.ink.png]]\n");
    });
    await browser.waitUntil(
      () =>
        browser.executeObsidian(
          ({ app }) =>
            (app.metadataCache.resolvedLinks["Old.md"]?.["002.ink.png"] ?? 0) >
            0,
        ),
      { timeoutMsg: "Old.md never linked to 002" },
    );
    await browser.executeObsidian(async ({ app }) => {
      const file = app.vault.getFileByPath("002.ink.png");
      if (file === null) throw new Error("no 002");
      await app.fileManager.trashFile(file);
    });
    await browser.waitUntil(async () => (await unresolved()) > 0, {
      timeoutMsg: "the embed of 002 never became unresolved",
    });
    await saveOne();
    expect(await symbolFiles()).toEqual(["001.ink.png", "003.ink.png"]);
    await browser.waitUntil(async () =>
      (await noteOnDisk("Editor.md")).includes("![[003.ink.png]]"),
    );

    // Once no note links to it, a new symbol shows nowhere it was not put.
    await browser.executeObsidian(async ({ app }) => {
      const note = app.vault.getFileByPath("Old.md");
      if (note === null) throw new Error("no Old.md");
      await app.vault.process(note, () => "The old door is gone.\n");
    });
    await browser.waitUntil(async () => (await unresolved()) === 0, {
      timeoutMsg: "the embed of 002 stayed in the link index",
    });
    await openAtMarker("Welcome.md", "vault");
    await browser.executeObsidianCommand("inkline:insert-symbol");
    await waitForEditor();
    await draw(zigzag);
    await browser.keys(["Control", "Enter"]);
    await waitClosed();
    expect(await symbolFiles()).toEqual([
      "001.ink.png",
      "002.ink.png",
      "003.ink.png",
    ]);
  });

  it("reads a link to a new symbol's file as Obsidian resolves it", async function () {
    // Each case's file has a name of its own, so that it is the one file the
    // link could name, as a new symbol's is for a link nothing resolves.
    const cases = [
      ["k01.ink.png", "Notes/a.md", "Runes/k01.ink.png", true],
      ["K02.INK.PNG", "a.md", "Runes/k02.ink.png", true],
      ["Runes/k03.ink.png", "Notes/a.md", "Runes/k03.ink.png", true],
      ["nes/k04.ink.png", "a.md", "Runes/k04.ink.png", true],
      ["Old/k05.ink.png", "a.md", "Runes/k05.ink.png", false],
      ["/Runes/k06.ink.png", "Notes/a.md", "Runes/k06.ink.png", true],
      ["/Runes/k07.ink.png", "a.md", "Old/Runes/k07.ink.png", false],
      ["/k08.ink.png", "a.md", "Runes/k08.ink.png", false],
      ["./k09.ink.png", "Runes/a.md", "Runes/k09.ink.png", true],
      ["./k10.ink.png", "Notes/a.md", "Runes/k10.ink.png", false],
      ["./k11.ink.png", "Notes/a.md", "X/Notes/k11.ink.png", true],
      ["../Runes/k12.ink.png", "Notes/a.md", "Runes/k12.ink.png", true],
      ["./../Runes/k13.ink.png", "Notes/a.md", "Runes/k13.ink.png", true],
      ["../Runes/k14.ink.png", "Notes/Deep/a.md", "Runes/k14.ink.png", false],
      ["../../k15.ink.png", "a.md", "Runes/k15.ink.png", true],
      ["k16.ink", "a.md", "Runes/k16.ink.png", false],
      ["Old/Runes/k17.ink.png", "a.md", "Runes/k17.ink.png", false],
      ["Runes/k18.ink.png", "a.md", "Old/Runes/k18.ink.png", true],
      ["./k19.ink.png", "a.md", "Runes/k19.ink.png", true],
    ] as const;
    for (const [, , path] of cases) await createSymbol(path);
    const paths = cases.map(([, , path]) => path);
    await browser.waitUntil(
      () =>
        browser.executeObsidian(
          ({ app }, files) =>
            files.every(
              (file) =>
                app.metadataCache.getFirstLinkpathDest(file, "")?.path === file,
            ),
          paths,
        ),
      { timeoutMsg: "the files never reached the link index" },
    );
    const resolved = await browser.executeObsidian(
      ({ app }, links) =>
        links.map(
          ([link, source]) =>
            app.metadataCache.getFirstLinkpathDest(link, source)?.path ?? null,
        ),
      cases.map(([link, source]) => [link, source] as const),
    );
    const expected = cases.map(([, , , finds]) => finds);
    expect(resolved.map((path, index) => path === paths[index])).toEqual(
      expected,
    );
    expect(
      cases.map(([link, source, path]) => linkFinds(link, source, path)),
    ).toEqual(expected);
  });
});
