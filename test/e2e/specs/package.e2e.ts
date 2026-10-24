// The plugin as Obsidian installs it: exactly the files a release carries,
// in the vault's plugin folder, loaded with its version, commands, and
// styles, and able to save a symbol. Every run checks the build in dist/;
// the Release workflow runs it on the release's own files, which
// E2E_PLUGIN_DIR names, before it publishes them.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { browser, expect } from "@wdio/globals";
import {
  draw,
  noteText,
  openAtMarker,
  symbolFiles,
  waitForEditor,
} from "../support/editor.ts";
import { pluginDirectory } from "../support/harness.ts";

const directory = pluginDirectory(
  process.env.E2E_PLUGIN_DIR,
  path.resolve(import.meta.dirname, "../../.."),
);
/** What a release carries, and Obsidian installs. */
const shipped = ["main.js", "manifest.json", "styles.css"];

function sha256(file: string): string {
  return createHash("sha256")
    .update(readFileSync(path.join(directory, file)))
    .digest("hex");
}

describe("The installed plugin", function () {
  it("is the package's files, byte for byte, and no other", async function () {
    const installed = await browser.executeObsidian(async ({ app }, names) => {
      const folder = `${app.vault.configDir}/plugins/inkline`;
      const listed = await app.vault.adapter.list(folder);
      const digests: Record<string, string> = {};
      for (const name of names) {
        const bytes = await app.vault.adapter.readBinary(`${folder}/${name}`);
        const digest = await crypto.subtle.digest("SHA-256", bytes);
        digests[name] = [...new Uint8Array(digest)]
          .map((byte) => byte.toString(16).padStart(2, "0"))
          .join("");
      }
      return {
        files: listed.files
          .map((file) => file.slice(folder.length + 1))
          // The test launcher's marker for a plugin it installed from a
          // folder, which no release carries.
          .filter((file) => file !== ".hotreload"),
        digests,
      };
    }, shipped);
    expect([...installed.files].sort()).toEqual([...shipped].sort());
    expect(installed.digests).toEqual(
      Object.fromEntries(shipped.map((name) => [name, sha256(name)])),
    );
  });

  it("loads with the package's version, its commands, and its styles", async function () {
    const manifest: unknown = JSON.parse(
      readFileSync(path.join(directory, "manifest.json"), "utf8"),
    );
    const loaded = await browser.executeObsidian(({ app, plugins }) => {
      const commands: unknown = Reflect.get(app, "commands");
      const registered: unknown =
        typeof commands === "object" && commands !== null
          ? Reflect.get(commands, "commands")
          : undefined;
      const ids =
        typeof registered === "object" && registered !== null
          ? Object.keys(registered).filter((id) => id.startsWith("inkline:"))
          : [];
      // A rule only styles.css has.
      const styled = [...document.styleSheets].some((sheet) => {
        try {
          return [...sheet.cssRules].some((rule) =>
            rule.cssText.includes("img.inkline-symbol"),
          );
        } catch {
          return false;
        }
      });
      return { version: plugins.inkline.manifest.version, ids, styled };
    });
    expect(loaded.version).toBe(
      typeof manifest === "object" && manifest !== null
        ? Reflect.get(manifest, "version")
        : undefined,
    );
    expect([...loaded.ids].sort()).toEqual([
      "inkline:edit-symbol-at-cursor",
      "inkline:insert-existing-symbol",
      "inkline:insert-symbol",
      "inkline:show-library",
    ]);
    expect(loaded.styled).toBe(true);
  });

  it("draws, saves, and inserts a symbol", async function () {
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
  });
});
