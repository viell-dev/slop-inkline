import { browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import { defaultSettings } from "../../../src/settings.ts";
import { loadModules } from "../support/browser.ts";
import {
  draw,
  editorOpen,
  noteText,
  openAtMarker,
  startOver,
  symbolFiles,
  waitForEditor,
  waitForStatus,
} from "../support/editor.ts";

const zigzag: [number, number][] = [
  [0.3, 0.3],
  [0.4, 0.6],
  [0.5, 0.3],
];

/** Obsidian's setting for where new attachments go, as its config holds it. */
async function setAttachmentFolder(value: string): Promise<void> {
  await browser.executeObsidian(({ app }, chosen) => {
    const set: unknown = Reflect.get(app.vault, "setConfig");
    if (typeof set !== "function") throw new Error("no vault config");
    Reflect.apply(set, app.vault, ["attachmentFolderPath", chosen]);
  }, value);
}

async function attachmentFolder(): Promise<string> {
  return browser.executeObsidian(({ app }) => {
    const get: unknown = Reflect.get(app.vault, "getConfig");
    if (typeof get !== "function") throw new Error("no vault config");
    const value: unknown = Reflect.apply(get, app.vault, [
      "attachmentFolderPath",
    ]);
    return typeof value === "string" ? value : "/";
  });
}

/** Starts Inkline again with its settings stored as `symbolFolder` says. */
async function setSymbolFolder(symbolFolder: string): Promise<void> {
  await obsidianPage.disablePlugin("inkline");
  await browser.executeObsidian(
    async ({ app }, settings) => {
      await app.vault.adapter.write(
        `${app.vault.configDir}/plugins/inkline/data.json`,
        JSON.stringify(settings),
      );
    },
    { ...defaultSettings, symbolFolder },
  );
  await obsidianPage.enablePlugin("inkline");
  await loadModules();
}

/** Opens an editor for a new symbol in a note inside the folder Notes. */
async function insertInNote(): Promise<void> {
  await browser.executeObsidian(async ({ app }) => {
    if (app.vault.getFolderByPath("Notes") === null) {
      await app.vault.createFolder("Notes");
    }
    if (app.vault.getFileByPath("Notes/Here.md") === null) {
      await app.vault.create("Notes/Here.md", "Mark HERE.\n");
    }
  });
  await openAtMarker("Notes/Here.md", "HERE");
  await browser.executeObsidianCommand("inkline:insert-symbol");
  await waitForEditor();
}

async function waitClosed(): Promise<void> {
  await browser.$(".inkline-editor").waitForExist({ reverse: true });
}

describe("Where new symbols go", function () {
  let original = "/";

  before(async function () {
    await loadModules();
    original = await attachmentFolder();
  });
  beforeEach(async function () {
    await startOver();
    await setSymbolFolder("");
  });
  after(async function () {
    await startOver();
    await setAttachmentFolder(original);
    await setSymbolFolder("");
  });

  for (const [mode, setting, folder] of [
    ["the vault's top folder", "/", ""],
    ["the note's own folder", "./", "Notes/"],
    ["a folder of its own", "Attachments", "Attachments/"],
  ] as const) {
    it(`follows Obsidian's place for attachments, ${mode}, with no folder set`, async function () {
      await setAttachmentFolder(setting);
      await insertInNote();
      await draw(zigzag);
      await browser.keys(["Control", "Enter"]);
      await waitClosed();
      expect(await symbolFiles()).toEqual([`${folder}001.ink.png`]);
      expect(await noteText()).toContain("![[001.ink.png]]");
    });
  }

  it("saves new symbols in the symbol folder, making it, through Next", async function () {
    await setAttachmentFolder("./");
    await setSymbolFolder("Signs/Script");
    await insertInNote();
    await draw(zigzag);
    await browser.keys(["Control", "Shift", "Enter"]);
    await browser.waitUntil(async () => (await symbolFiles()).length === 1);
    await waitForEditor();
    await draw(zigzag);
    await browser.keys(["Control", "Enter"]);
    await waitClosed();
    expect(await symbolFiles()).toEqual([
      "Signs/Script/001.ink.png",
      "Signs/Script/002.ink.png",
    ]);
    expect(await noteText()).toContain("![[001.ink.png]]");
    expect(await noteText()).toContain("![[002.ink.png]]");
  });

  it("refuses to save where a file stands in the folder's place, keeping the drawing", async function () {
    await browser.executeObsidian(async ({ app }) => {
      await app.vault.create("Signs", "not a folder");
    });
    await setSymbolFolder("Signs/Script");
    await insertInNote();
    await draw(zigzag);
    await browser.keys(["Control", "Enter"]);
    await waitForStatus("Signs is a file");
    expect(await editorOpen()).toBe(true);
    expect(await symbolFiles()).toEqual([]);
    expect(await noteText()).not.toContain("![[");
    // With the file gone, the same drawing saves there.
    await browser.executeObsidian(async ({ app }) => {
      const file = app.vault.getFileByPath("Signs");
      if (file === null) throw new Error("no file");
      await app.fileManager.trashFile(file);
    });
    await browser.keys(["Control", "Enter"]);
    await waitClosed();
    expect(await symbolFiles()).toEqual(["Signs/Script/001.ink.png"]);
  });

  it("uses a folder there already whose name differs in letter case", async function () {
    await browser.executeObsidian(async ({ app }) => {
      await app.vault.createFolder("Signs");
    });
    await setSymbolFolder("signs/Script");
    await insertInNote();
    await draw(zigzag);
    await browser.keys(["Control", "Enter"]);
    await waitClosed();
    expect(await symbolFiles()).toEqual(["Signs/Script/001.ink.png"]);
  });
});
