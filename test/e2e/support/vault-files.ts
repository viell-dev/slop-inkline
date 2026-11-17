// The test vault's notes and symbol files, read back or written as another
// app or a sync tool would write them, in end-to-end tests.

import { browser } from "@wdio/globals";

/**
 * Saves the note at `note`, if open, and waits for Obsidian's metadata cache
 * to know that it links to `file`, as it does some time after an edit.
 */
export async function waitForLink(note: string, file: string): Promise<void> {
  await browser.executeObsidian(async ({ app, obsidian }, path) => {
    for (const leaf of app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (view instanceof obsidian.MarkdownView && view.file?.path === path) {
        await view.save();
      }
    }
  }, note);
  await browser.waitUntil(async () =>
    browser.executeObsidian(
      ({ app }, from, to) =>
        (app.metadataCache.resolvedLinks[from]?.[to] ?? 0) > 0,
      note,
      file,
    ),
  );
}

/** The text of the note at `path`, as it is on disk. */
export async function noteOnDisk(path: string): Promise<string> {
  return browser.executeObsidian(async ({ app }, file) => {
    const note = app.vault.getFileByPath(file);
    if (note === null) throw new Error(`no ${file}`);
    return app.vault.read(note);
  }, path);
}

/** A picture, `square.ink.png`: a black square, which opens as a base layer. */
export async function createSquare(): Promise<void> {
  await browser.executeObsidian(async ({ app }) => {
    const { canvas } = window.inklineTest;
    const data = new Uint8ClampedArray(24 * 24 * 4);
    for (let index = 0; index < 24 * 24; index++) data[index * 4 + 3] = 255;
    const bytes = await canvas.encodePixels({ width: 24, height: 24, data });
    await app.vault.createBinary("square.ink.png", bytes.slice().buffer);
  });
}

/**
 * Writes a symbol of three dots into `path`, as sync or another app would:
 * through the vault, which reports it, or straight to the disk.
 */
export async function changeElsewhere(
  path: string,
  how: "vault" | "disk" = "vault",
  text?: string,
): Promise<void> {
  await browser.executeObsidian(
    async ({ app }, filePath, way, added) => {
      const { canvas } = window.inklineTest;
      const dot = (x: number) => ({
        tool: "pen" as const,
        size: 256,
        points: [x, 1600],
      });
      const { bytes } = await canvas.saveInk(
        { strokes: [dot(800), dot(1600), dot(2400)] },
        undefined,
        added === null
          ? []
          : [
              {
                chunk: {
                  type: "iTXt",
                  data: new TextEncoder().encode(added),
                },
                afterData: false,
              },
            ],
      );
      if (way === "disk") {
        await app.vault.adapter.writeBinary(filePath, bytes.slice().buffer);
        return;
      }
      const file = app.vault.getFileByPath(filePath);
      if (file === null) throw new Error(`no ${filePath}`);
      await app.vault.modifyBinary(file, bytes.slice().buffer);
    },
    path,
    how,
    text ?? null,
  );
}

/**
 * Writes a symbol file of one stroke per x, in units, as another editor
 * would, with a text chunk that Inkline carries through its saves.
 */
export async function writeSymbol(
  path: string,
  xs: readonly number[],
): Promise<void> {
  await browser.executeObsidian(
    async ({ app }, filePath, starts) => {
      const { canvas } = window.inklineTest;
      const { bytes } = await canvas.saveInk(
        {
          strokes: starts.map((x) => ({
            tool: "pen" as const,
            size: 256,
            points: [x, 800, x + 400, 2000],
          })),
        },
        undefined,
        [
          {
            chunk: {
              type: "tEXt",
              data: new TextEncoder().encode("Comment\0from the tower"),
            },
            afterData: false,
          },
        ],
      );
      const folder = filePath.slice(0, Math.max(0, filePath.lastIndexOf("/")));
      if (folder !== "" && app.vault.getFolderByPath(folder) === null) {
        await app.vault.createFolder(folder);
      }
      await app.vault.createBinary(filePath, bytes.slice().buffer);
    },
    path,
    xs,
  );
}

/** The bytes of a file, as text to compare. */
export async function bytesOf(file: string): Promise<string> {
  return browser.executeObsidian(async ({ app }, wanted) => {
    const found = app.vault.getFileByPath(wanted);
    if (found === null) throw new Error(`no ${wanted}`);
    return Array.from(new Uint8Array(await app.vault.readBinary(found))).join(
      ",",
    );
  }, file);
}

/** A file's bytes, as numbers, to compare from outside the renderer. */
export async function bytesOfFile(path: string): Promise<number[]> {
  return browser.executeObsidian(async ({ app }, filePath) => {
    const file = app.vault.getFileByPath(filePath);
    if (file === null) throw new Error(`no ${filePath}`);
    return [...new Uint8Array(await app.vault.readBinary(file))];
  }, path);
}
