import { browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
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
});
