// Explicit release verification, outside the ordinary suite's specs/ glob.
// Start the host with the actual previous release through E2E_PLUGIN_DIR.
// E2E_UPDATE_ZIP is the verified new ZIP; E2E_PREVIOUS_VERSION names the old
// release. Missing inputs fail rather than silently skipping this check.
//
// The file format became final in 0.9.2, and the owner decided in #144 that
// nothing saved before it need keep its strokes. So what an update must keep
// goes by the previous release's version alone, and never by what the file
// turns out to hold: from 0.9.2 on, a release that stopped reading the strokes
// of the one before fails here, with no change to this file.
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";
import { browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import packageJson from "../../../package.json" with { type: "json" };
import { compareSemver } from "../../../scripts/lib/version.ts";
import { loadModules } from "../support/browser.ts";
import {
  draw,
  editFile,
  noteText,
  openAtMarker,
  recordOf,
  symbolFiles,
  waitForEditor,
  waitForStatus,
} from "../support/editor.ts";
import { saveScreenshot } from "../support/screenshots.ts";

const zip = process.env.E2E_UPDATE_ZIP;
const previous = process.env.E2E_PREVIOUS_VERSION;
if (zip === undefined || previous === undefined) {
  throw new Error("E2E_UPDATE_ZIP and E2E_PREVIOUS_VERSION are required");
}
// package.json, as a pre-release's version never reaches manifest.json.
const version = packageJson.version;
if (version === previous) {
  throw new Error("The checkout must name a different, new release version");
}

/** The first release of the format that every later release must read. */
const finalFormat = "0.9.2";
const keepsStrokes = compareSemver(previous, finalFormat) >= 0;

/** Part of what the status line says of a file that holds no strokes. */
const noStrokes = "as this file holds no strokes";

/** What a symbol's record says, as far as this check needs. */
interface HeldRecord {
  readonly strokes: readonly unknown[];
  readonly base?: unknown;
}

async function loadedVersion(): Promise<string> {
  return browser.executeObsidian(
    ({ plugins }) => plugins.inkline.manifest.version,
  );
}

/** The symbol's file and the preferences, as the disk has them. */
async function saved(): Promise<{ drawing: number[]; preferences: string }> {
  return browser.executeObsidian(async ({ app }) => ({
    drawing: Array.from(
      new Uint8Array(await app.vault.adapter.readBinary("001.ink.png")),
    ),
    preferences: await app.vault.adapter.read(
      `${app.vault.configDir}/plugins/inkline/data.json`,
    ),
  }));
}

/** Waits for the note to show `file` as a character, from its loaded image. */
async function waitForSymbolInNote(file: string): Promise<void> {
  await browser.waitUntil(
    async () =>
      browser.execute((name) => {
        const images = Array.from(
          activeDocument.querySelectorAll<HTMLImageElement>(
            ".markdown-source-view img.inkline-symbol",
          ),
        );
        return images.some(
          (image) =>
            image.src.includes(name) &&
            image.complete &&
            image.naturalWidth > 0,
        );
      }, file),
    { timeoutMsg: `the note does not show ${file}` },
  );
}

/** How many pixels of the editor's preview of the symbol hold ink. */
async function inkShown(): Promise<number> {
  return browser.execute(() => {
    const preview = activeDocument.querySelector(
      ".inkline-editor .inkline-preview-ink",
    );
    if (preview?.instanceOf(HTMLCanvasElement) !== true) {
      throw new Error("no preview");
    }
    const pixels = preview
      .getContext("2d")
      ?.getImageData(0, 0, preview.width, preview.height).data;
    let shown = 0;
    for (let at = 3; at < (pixels?.length ?? 0); at += 4) {
      if ((pixels?.[at] ?? 0) > 0) shown++;
    }
    return shown;
  });
}

/** The status line's text. */
async function status(): Promise<string> {
  return browser.$(".inkline-status").getText();
}

describe("Updating the actual previous release", function () {
  it(`keeps the symbol, note and preferences of ${previous}${keepsStrokes ? ", strokes included" : ", as a picture"}`, async function () {
    const location = await browser.executeObsidian(({ app, obsidian }) => {
      if (!(app.vault.adapter instanceof obsidian.FileSystemAdapter))
        throw new Error("The update check requires a desktop test vault");
      return {
        vault: app.vault.adapter.getBasePath(),
        config: app.vault.configDir,
      };
    });
    const vault = realpathSync(location.vault);
    if (!vault.startsWith("/tmp/"))
      throw new Error("This check only updates disposable Linux test vaults");
    expect(await loadedVersion()).toBe(previous);
    await openAtMarker("Editor.md", "HERE");
    await browser.executeObsidianCommand("inkline:insert-symbol");
    await waitForEditor();
    await draw([
      [0.3, 0.3],
      [0.5, 0.7],
      [0.7, 0.3],
    ]);
    await browser.keys(["Control", "Enter"]);
    await browser.$(".inkline-editor").waitForExist({ reverse: true });
    expect(await symbolFiles()).toEqual(["001.ink.png"]);
    await browser.waitUntil(async () =>
      (await noteText()).includes("![[001.ink.png]]"),
    );
    const text = await noteText();
    // The editor updates immediately; Obsidian autosaves the note later.
    // Persist the fixture before refreshing the renderer during the update.
    await browser.waitUntil(async () =>
      browser.executeObsidian(
        async ({ app }, expected) =>
          (await app.vault.adapter.read("Editor.md")) === expected,
        text,
      ),
    );
    await browser.executeObsidian(async ({ plugins }) => {
      const stored: unknown = await plugins.inkline.loadData();
      await plugins.inkline.saveData({
        ...(typeof stored === "object" && stored !== null ? stored : {}),
        brushSize: 3,
      });
    });
    const state = await saved();
    await obsidianPage.disablePlugin("inkline");
    // Exercise the documented extraction, preserving data.json beside the
    // three plugin files. Only verified project release ZIPs belong here.
    execFileSync("unzip", [
      "-o",
      zip,
      "-d",
      path.join(vault, location.config, "plugins"),
    ]);
    await obsidianPage.enablePlugin("inkline");
    // Refresh the renderer, not WDIO's vault setup (which reinstalls the old
    // source). This also reloads Obsidian's cached plugin manifest.
    await browser.refresh();
    await browser.waitUntil(async () => (await loadedVersion()) === version);
    await loadModules();
    // What the new release takes the file for, by the code that shipped.
    const held = JSON.parse(await recordOf("001.ink.png")) as HeldRecord;
    if (keepsStrokes) expect(held.strokes).toHaveLength(1);
    else expect(held).toEqual({ kind: "pixels", reason: "none" });
    for (const stage of ["updated", "reloaded"]) {
      expect(await saved()).toEqual(state);
      expect(await noteText()).toBe(text);
      await waitForSymbolInNote("001.ink.png");
      await editFile("001.ink.png");
      if (keepsStrokes) expect(await status()).not.toContain(noStrokes);
      else await waitForStatus(noStrokes);
      expect(await inkShown()).toBeGreaterThan(0);
      expect(
        await browser
          .$('[data-inkline-button="size-3"]')
          .getAttribute("aria-pressed"),
      ).toBe("true");
      await browser.keys("e");
      expect(
        await browser
          .$('[data-inkline-button="eraser"]')
          .getAttribute("aria-pressed"),
      ).toBe("true");
      expect(
        await browser
          .$('[data-inkline-button="size-3"]')
          .getAttribute("aria-pressed"),
      ).toBe("true");
      await saveScreenshot(`release-${stage}`);
      // Closing with nothing done asks nothing and writes nothing.
      await browser.keys("Escape");
      await browser.$(".inkline-editor").waitForExist({ reverse: true });
      await obsidianPage.disablePlugin("inkline");
      await obsidianPage.enablePlugin("inkline");
      expect(await loadedVersion()).toBe(version);
    }
    expect(await saved()).toEqual(state);
    expect(await noteText()).toBe(text);

    // Drawn over and saved, it holds strokes from then on, and the note keeps
    // the same embed.
    await editFile("001.ink.png");
    await draw([
      [0.2, 0.8],
      [0.8, 0.8],
    ]);
    await browser.keys(["Control", "Enter"]);
    await browser.$(".inkline-editor").waitForExist({ reverse: true });
    const drawnOver = JSON.parse(await recordOf("001.ink.png")) as HeldRecord;
    expect(drawnOver.strokes).toHaveLength(keepsStrokes ? 2 : 1);
    expect(drawnOver.base !== undefined).toBe(!keepsStrokes);
    expect(await noteText()).toBe(text);
    await waitForSymbolInNote("001.ink.png");
    await editFile("001.ink.png");
    expect(await status()).not.toContain(noStrokes);
    await saveScreenshot("release-drawn-over");
    await browser.keys("Escape");
    await browser.$(".inkline-editor").waitForExist({ reverse: true });

    // A new symbol saves, goes in the note, and opens again with its strokes.
    await browser.executeObsidian(({ app, obsidian }) => {
      const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
      if (view === null) throw new Error("no Markdown view");
      const { editor } = view;
      editor.setCursor(editor.offsetToPos(editor.getValue().length));
      editor.focus();
    });
    await browser.executeObsidianCommand("inkline:insert-symbol");
    await waitForEditor();
    await draw([
      [0.4, 0.3],
      [0.4, 0.7],
    ]);
    await browser.keys(["Control", "Enter"]);
    await browser.$(".inkline-editor").waitForExist({ reverse: true });
    expect(await symbolFiles()).toEqual(["001.ink.png", "002.ink.png"]);
    await browser.waitUntil(async () =>
      (await noteText()).includes("![[002.ink.png]]"),
    );
    const created = JSON.parse(await recordOf("002.ink.png")) as HeldRecord;
    expect(created.strokes).toHaveLength(1);
    await waitForSymbolInNote("002.ink.png");
    await editFile("002.ink.png");
    expect(await status()).not.toContain(noStrokes);
    expect(await inkShown()).toBeGreaterThan(0);
    await saveScreenshot("release-new-symbol");
    await browser.keys("Escape");
    await browser.$(".inkline-editor").waitForExist({ reverse: true });
  });
});
