import { browser, expect } from "@wdio/globals";
import { Key } from "webdriverio";

import { loadModules } from "../support/browser.ts";
import {
  clickTop,
  createSymbol,
  draw,
  editorOpen,
  recordOf,
  startOver,
  storedDrafts,
  symbolFiles,
  waitForEditor,
  waitForStatus,
} from "../support/editor.ts";
import { saveScreenshot } from "../support/screenshots.ts";

const tower = "Signs/tower.ink.png";
/** Notes that use the tower three times, twice in the first. */
const uses: Record<string, string> = {
  "Walls.md":
    "North ![[Signs/tower.ink.png]] and south ![[Signs/tower.ink.png]].\n",
  "Gates.md": "The gate shows ![[Signs/tower.ink.png]].\n",
};

/** Writes notes, and waits until Obsidian has indexed their links. */
async function writeNotes(notes: Record<string, string>): Promise<void> {
  await browser.executeObsidian(async ({ app }, written) => {
    for (const [path, text] of Object.entries(written)) {
      await app.vault.create(path, text);
    }
  }, notes);
  await browser.waitUntil(() =>
    browser.executeObsidian(
      ({ app }, paths) =>
        paths.every(
          (path) => app.metadataCache.resolvedLinks[path] !== undefined,
        ),
      Object.keys(notes),
    ),
  );
}

/** The text of the vault's notes at `paths`, as on disk. */
async function notesText(paths: readonly string[]): Promise<string[]> {
  return browser.executeObsidian(
    async ({ app }, wanted) =>
      Promise.all(wanted.map((path) => app.vault.adapter.read(path))),
    paths,
  );
}

/** A fingerprint of the bytes of the file at `path`, or undefined if none. */
async function bytesOf(path: string): Promise<string | undefined> {
  return browser.executeObsidian(async ({ app }, filePath) => {
    const file = app.vault.getFileByPath(filePath);
    if (file === null) return undefined;
    const digest = await crypto.subtle.digest(
      "SHA-256",
      await app.vault.readBinary(file),
    );
    return [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }, path);
}

/** How many strokes the symbol file at `path` holds. */
async function strokesIn(path: string): Promise<number> {
  const record = JSON.parse(await recordOf(path)) as { strokes?: unknown[] };
  return record.strokes?.length ?? -1;
}

async function editFile(path: string): Promise<void> {
  await browser.executeObsidian(({ app, plugins }, filePath) => {
    const file = app.vault.getFileByPath(filePath);
    if (file === null) throw new Error(`no ${filePath}`);
    void plugins.inkline.editSymbol(file);
  }, path);
  await waitForEditor();
}

/** The topmost question's title and text, once one shows `title`. */
async function question(title: string): Promise<{
  title: string;
  text: string;
  buttons: string[];
}> {
  let shown = { title: "", text: "", buttons: [] as string[] };
  await browser.waitUntil(
    async () => {
      shown = await browser.execute(() => {
        const containers = document.querySelectorAll(".modal-container");
        const top = containers[containers.length - 1];
        return {
          title: top?.querySelector(".modal-title")?.textContent ?? "",
          text: top?.querySelector(".modal-content")?.textContent ?? "",
          buttons: [...(top?.querySelectorAll("button") ?? [])].map(
            (button) => button.textContent,
          ),
        };
      });
      return shown.title === title;
    },
    { timeoutMsg: `no question "${title}"` },
  );
  return shown;
}

/** How many modals are open, the editor among them. */
async function modals(): Promise<number> {
  return browser.execute(
    () => document.querySelectorAll(".modal-container").length,
  );
}

describe("Saving a symbol used elsewhere", function () {
  before(async function () {
    await loadModules();
  });
  beforeEach(async function () {
    await startOver();
    await loadModules();
    await createSymbol(tower);
    await writeNotes(uses);
  });
  after(async function () {
    await startOver();
  });

  it("asks before replacing it everywhere, and Keep editing saves nothing", async function () {
    const before = await bytesOf(tower);
    await editFile(tower);
    await draw([
      [0.3, 0.3],
      [0.6, 0.6],
    ]);
    await browser.keys([Key.Ctrl, Key.Enter]);
    const asked = await question("Change tower everywhere?");
    await saveScreenshot("save-choices-question");
    expect(asked.text).toContain("tower is used 3 times, in 2 notes.");
    expect(asked.text).toContain("Copy from");
    expect(asked.buttons).toEqual(["Replace", "Keep editing"]);
    // Replace has the focus, as the default.
    expect(
      await browser.execute(() => document.activeElement?.textContent),
    ).toBe("Replace");
    await clickTop("Keep editing");
    await waitForStatus("Not saved: kept editing");
    expect(await editorOpen()).toBe(true);
    expect(await bytesOf(tower)).toBe(before);
    // The drawing stays unsaved, and kept as a draft.
    expect(await storedDrafts()).toHaveLength(1);
    // Esc answers it the same way.
    await browser.keys([Key.Ctrl, "s"]);
    await question("Change tower everywhere?");
    await browser.keys([Key.Escape]);
    await waitForStatus("Not saved: kept editing");
    expect(await editorOpen()).toBe(true);
    expect(await bytesOf(tower)).toBe(before);
  });

  it("replaces it with Replace, and asks no more in that editor", async function () {
    const before = await bytesOf(tower);
    const notes = await notesText(Object.keys(uses));
    await editFile(tower);
    await draw([
      [0.3, 0.3],
      [0.6, 0.6],
    ]);
    await browser.keys([Key.Ctrl, "s"]);
    await question("Change tower everywhere?");
    await clickTop("Replace");
    await waitForStatus("Saved");
    expect(await bytesOf(tower)).not.toBe(before);
    expect(await strokesIn(tower)).toBe(2);
    await draw([[0.7, 0.4]]);
    await browser.keys([Key.Ctrl, "s"]);
    await browser.waitUntil(async () => (await strokesIn(tower)) === 3);
    expect(await modals()).toBe(1);
    expect(await symbolFiles()).toEqual([tower]);
    expect(await notesText(Object.keys(uses))).toEqual(notes);
  });

  it("asks once when closing with changes: Replace, Discard or Keep drawing", async function () {
    const before = await bytesOf(tower);
    await editFile(tower);
    await draw([
      [0.3, 0.3],
      [0.6, 0.6],
    ]);
    await browser.keys([Key.Escape]);
    const asked = await question("Save the changes to tower?");
    expect(asked.text).toContain("tower is used 3 times, in 2 notes.");
    expect(asked.buttons).toEqual(["Replace", "Discard", "Keep drawing"]);
    await clickTop("Keep drawing");
    expect(await editorOpen()).toBe(true);
    await browser.keys([Key.Escape]);
    await question("Save the changes to tower?");
    await clickTop("Replace");
    await browser.waitUntil(async () => !(await editorOpen()));
    // One question, not a second one after it.
    expect(await modals()).toBe(0);
    expect(await strokesIn(tower)).toBe(2);
    // Discard leaves the symbol as it was saved, with no draft.
    const saved = await bytesOf(tower);
    await editFile(tower);
    await draw([[0.7, 0.4]]);
    await browser.keys([Key.Escape]);
    await question("Save the changes to tower?");
    await clickTop("Discard");
    await browser.waitUntil(async () => !(await editorOpen()));
    expect(await bytesOf(tower)).toBe(saved);
    expect(await storedDrafts()).toEqual([]);
    expect(before).not.toBe(saved);
  });

  it("counts ink that Make ink is previewing as a change, asking once", async function () {
    await editFile(tower);
    await browser.execute(async () => {
      await window.inklineTest.pictures.copyPicture(40, 40, "white", [
        { x: 10, y: 10, width: 20, height: 20, colour: "black" },
      ]);
    });
    await browser.keys([Key.Ctrl, "v"]);
    await waitForStatus("Tracing over the picture");
    // Only the preview: no stroke is drawn.
    await browser.keys("i");
    await waitForStatus("Making ink of the picture");
    await browser.pause(300);
    await browser.keys([Key.Ctrl, "s"]);
    await question("Change tower everywhere?");
    await clickTop("Replace");
    await waitForStatus("Saved");
    expect(await modals()).toBe(1);
    // The ink was made and saved as the symbol's base layer.
    const record = JSON.parse(await recordOf(tower)) as { base?: unknown };
    expect(record.base).toBeDefined();
  });
  it("saves without asking a symbol used once, and a rename alone", async function () {
    await createSymbol("Signs/lone.ink.png");
    await writeNotes({ "Lone.md": "Once ![[Signs/lone.ink.png]].\n" });
    await editFile("Signs/lone.ink.png");
    await draw([
      [0.3, 0.3],
      [0.6, 0.6],
    ]);
    await browser.keys([Key.Ctrl, Key.Enter]);
    await browser.waitUntil(async () => !(await editorOpen()));
    expect(await strokesIn("Signs/lone.ink.png")).toBe(2);
    // A new name alone renames the symbol everywhere, as links follow it.
    await editFile(tower);
    await browser.$(".inkline-editor .inkline-name").setValue("spire");
    await browser.keys([Key.Enter]);
    await browser.keys([Key.Ctrl, Key.Enter]);
    // Obsidian's own question about the links, which a question of Inkline's
    // before it would cover, so that this waits in vain.
    await clickTop("Just once");
    await browser.waitUntil(async () => !(await editorOpen()));
    expect(await modals()).toBe(0);
    expect(await symbolFiles()).toContain("Signs/spire.ink.png");
    expect(await symbolFiles()).not.toContain(tower);
  });
});
