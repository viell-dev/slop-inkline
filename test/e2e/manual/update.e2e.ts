// Explicit release verification, outside the ordinary suite's specs/ glob.
// Start the host with the actual previous release through E2E_PLUGIN_DIR.
// E2E_UPDATE_ZIP is the verified new ZIP; E2E_PREVIOUS_VERSION names the old
// release. Missing inputs fail rather than silently skipping this check.
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import {
  draw,
  noteText,
  openAtMarker,
  symbolFiles,
  waitForEditor,
} from "../support/editor.ts";
import { saveScreenshot } from "../support/screenshots.ts";

const zip = process.env.E2E_UPDATE_ZIP;
const previous = process.env.E2E_PREVIOUS_VERSION;
if (zip === undefined || previous === undefined) {
  throw new Error("E2E_UPDATE_ZIP and E2E_PREVIOUS_VERSION are required");
}
const manifest: unknown = JSON.parse(
  readFileSync(new URL("../../../manifest.json", import.meta.url), "utf8"),
);
if (
  typeof manifest !== "object" ||
  manifest === null ||
  !("version" in manifest) ||
  typeof manifest.version !== "string" ||
  manifest.version === previous
) {
  throw new Error("The checkout must name a different, new release version");
}
const version = manifest.version;

async function loadedVersion(): Promise<string> {
  return browser.executeObsidian(
    ({ plugins }) => plugins.inkline.manifest.version,
  );
}

describe("Updating the actual previous release", function () {
  it("preserves a drawing and preference through ZIP replacement and reload", async function () {
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
    const state = await browser.executeObsidian(
      async ({ app, obsidian, plugins }) => {
        if (!(app.vault.adapter instanceof obsidian.FileSystemAdapter))
          throw new Error("The update check requires a desktop test vault");
        const stored: unknown = await plugins.inkline.loadData();
        await plugins.inkline.saveData({
          ...(typeof stored === "object" && stored !== null ? stored : {}),
          brushSize: 3,
        });
        return {
          vault: app.vault.adapter.getBasePath(),
          config: app.vault.configDir,
          drawing: Array.from(
            new Uint8Array(await app.vault.adapter.readBinary("001.ink.png")),
          ),
          preferences: await app.vault.adapter.read(
            `${app.vault.configDir}/plugins/inkline/data.json`,
          ),
        };
      },
    );
    await obsidianPage.disablePlugin("inkline");
    const vault = realpathSync(state.vault);
    if (!vault.startsWith("/tmp/"))
      throw new Error("This check only updates disposable Linux test vaults");
    // Exercise the documented extraction, preserving data.json beside the
    // three plugin files. Only verified project release ZIPs belong here.
    execFileSync("unzip", [
      "-o",
      zip,
      "-d",
      path.join(vault, state.config, "plugins"),
    ]);
    await obsidianPage.enablePlugin("inkline");
    // Refresh the renderer, not WDIO's vault setup (which reinstalls the old
    // source). This also reloads Obsidian's cached plugin manifest.
    await browser.refresh();
    await browser.waitUntil(async () => (await loadedVersion()) === version);
    for (const stage of ["updated", "reloaded"]) {
      const preserved = await browser.executeObsidian(async ({ app }) => ({
        drawing: Array.from(
          new Uint8Array(await app.vault.adapter.readBinary("001.ink.png")),
        ),
        preferences: await app.vault.adapter.read(
          `${app.vault.configDir}/plugins/inkline/data.json`,
        ),
      }));
      expect(preserved.drawing).toEqual(state.drawing);
      expect(preserved.preferences).toBe(state.preferences);
      expect(await noteText()).toBe(text);
      await browser.executeObsidian(async ({ app, plugins }) => {
        const file = app.vault.getFileByPath("001.ink.png");
        if (file === null) throw new Error("The drawing disappeared");
        await plugins.inkline.editSymbol(file);
      });
      await waitForEditor();
      expect(
        await browser
          .$('[data-inkline-button="size-3"]')
          .getAttribute("aria-pressed"),
      ).toBe("true");
      await saveScreenshot(`release-${stage}`);
      await browser.keys("Escape");
      await browser.$(".inkline-editor").waitForExist({ reverse: true });
      await obsidianPage.disablePlugin("inkline");
      await obsidianPage.enablePlugin("inkline");
      expect(await loadedVersion()).toBe(version);
    }
  });
});
