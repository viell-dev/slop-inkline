// Investigation for #167, section 5: a word list and radical list, or both as
// one dictionary. Not part of the suite. Finds out in real Obsidian:
//
// - whether version 1 of the file format already carries a new text keyword,
//   "Inkline role", through 0.9.3's editor, its library, and a rename, and
//   what its editor does with a record field it does not know, as a place
//   to keep a symbol's parts;
// - how the PROTOTYPE's dictionary (src/notes/words.ts, src/notes/
//   dictionary.ts) reads a lexicon note with compounds and parts, splits
//   runs where a symbol is both a word and a syllable and where compounds
//   overlap, and shows them in Reading view and Live Preview;
// - what parts change in the `;;` list and the library, and the radical
//   index the library shows;
// - adding and changing entries from a note with "Add to dictionary";
// - renames, and the notes and lexicon without Inkline.
//
// It writes what it measures to dictionary-<version>.json, with
// screenshots. All content is synthetic.

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { browser } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import { loadModules } from "../support/browser.ts";
import { draw, startOver, waitForEditor } from "../support/editor.ts";
import { outputDirectory } from "../support/harness.ts";
import { saveScreenshot } from "../support/screenshots.ts";

const root = path.resolve(import.meta.dirname, "../../..");
const output = outputDirectory(process.env.E2E_OUTPUT_DIR, root);
const results: Record<string, unknown> = {};

type Mode = "source" | "preview";
type Stroke = { tool: "pen"; size: number; points: number[] };

const u = (values: number[]) => values.map((value) => Math.round(value * 16));
const pen = (points: number[], size = 160): Stroke => ({
  tool: "pen",
  size: Math.round(size),
  points: u(points),
});

/** A small tree: a trunk and two branches, scaled and moved. */
const treeAt = (x: number, y: number, s: number): Stroke[] => [
  pen([x, y + 40 * s, x, y], 160 * s),
  pen([x, y + 14 * s, x - 14 * s, y], 160 * s),
  pen([x, y + 14 * s, x + 14 * s, y], 160 * s),
];

/** A standing figure, scaled and moved. */
const figureAt = (x: number, y: number, s: number): Stroke[] => [
  pen([x, y], 320 * s),
  pen([x, y + 12 * s, x, y + 50 * s], 160 * s),
  pen([x - 20 * s, y + 26 * s, x + 20 * s, y + 26 * s], 160 * s),
  pen([x, y + 50 * s, x - 16 * s, y + 80 * s], 160 * s),
  pen([x, y + 50 * s, x + 16 * s, y + 80 * s], 160 * s),
];

const roofAt = (x: number, y: number, s: number): Stroke[] => [
  pen([x - 24 * s, y + 30 * s, x, y, x + 24 * s, y + 30 * s], 160 * s),
];

interface SymbolSpec {
  name: string;
  strokes: Stroke[];
  reading: string[];
  translation: string[];
  role: string[];
}

/**
 * An invented script: syllables (ka, ri), logograms that are syllables too
 * (left, right, adult, big, tree), symbols built from parts (grove, house),
 * and parts with no reading or meaning (roof, hook).
 */
const symbols: SymbolSpec[] = [
  {
    name: "left",
    strokes: [pen([56, 100, 10, 100]), pen([28, 78, 10, 100, 28, 122])],
    reading: ["hi"],
    translation: ["left"],
    role: [],
  },
  {
    name: "right",
    strokes: [pen([8, 100, 54, 100]), pen([36, 78, 54, 100, 36, 122])],
    reading: ["mi"],
    translation: ["right"],
    role: [],
  },
  {
    name: "adult",
    strokes: figureAt(32, 62, 1),
    reading: ["na"],
    translation: ["adult"],
    role: [],
  },
  {
    name: "big",
    strokes: [pen([8, 56, 56, 56, 56, 140, 8, 140, 8, 56])],
    reading: ["o"],
    translation: ["big"],
    role: [],
  },
  {
    name: "ka",
    strokes: [
      pen(
        Array.from({ length: 33 }, (_, index) => {
          const angle = (index / 32) * 2 * Math.PI;
          return [34 + 24 * Math.cos(angle), 116 + 24 * Math.sin(angle)];
        })
          .flat()
          .map(Math.round),
      ),
    ],
    reading: ["ka"],
    translation: [],
    role: [],
  },
  {
    name: "ri",
    strokes: [pen([12, 60, 12, 140]), pen([36, 60, 36, 140]), pen([4, 60, 44, 60])],
    reading: ["ri"],
    translation: [],
    role: [],
  },
  {
    name: "tree",
    strokes: treeAt(32, 96, 1.1),
    reading: ["ki"],
    translation: ["tree"],
    role: [],
  },
  {
    // Built from three trees, one centred over two: section 4.1's
    // "triangle (up)", in IDS ⿱A⿰BC.
    name: "grove",
    strokes: [
      ...treeAt(48, 56, 0.5),
      ...treeAt(28, 104, 0.5),
      ...treeAt(68, 104, 0.5),
    ],
    reading: ["mo"],
    translation: ["grove"],
    role: [],
  },
  {
    name: "roof",
    strokes: roofAt(32, 84, 1),
    reading: [],
    translation: [],
    role: ["part"],
  },
  {
    // A roof over a figure: ⿱ roof adult.
    name: "house",
    strokes: [...roofAt(32, 56, 0.8), ...figureAt(32, 88, 0.6)],
    reading: ["ie"],
    translation: ["house"],
    role: [],
  },
  {
    name: "hook",
    strokes: [pen([20, 60, 20, 124, 26, 138, 38, 142, 48, 132])],
    reading: [],
    translation: [],
    role: ["part"],
  },
];

const e = (name: string) => `![[${name}.ink.png]]`;
const run = (...names: string[]) => names.map(e).join("");

const lexiconNote = [
  "---",
  "inkline: lexicon",
  "---",
  "",
  "# Dictionary",
  "",
  "| Word | Reading | Meaning | Parts | Notes |",
  "| ---- | ------- | ------- | ----- | ----- |",
  `| ${run("left", "adult")} |  | father |  | not "left adult" |`,
  `| ${run("right", "adult")} |  | mother |  |  |`,
  `| ${run("big", "left", "adult")} |  | grandfather |  |  |`,
  `| ${run("ka", "ri")} |  | river |  |  |`,
  `| ${run("ka", "ri", "left")} |  | riverbank |  | overlaps river and father |`,
  `| ${e("grove")} |  |  | ⿱${e("tree")}⿰${e("tree")}${e("tree")} | three trees |`,
  `| ${e("house")} |  |  | ⿱${e("roof")}${e("adult")} |  |`,
  "",
].join("\n");

const wordsNote = [
  "Top line for the cursor.",
  "",
  `Compound ${run("left", "adult")} end.`,
  "",
  `Mother ${run("right", "adult")} end.`,
  "",
  `Alone ${e("adult")} end.`,
  "",
  `Both ${run("left", "adult", "right", "adult")} end.`,
  "",
  `Elder ${run("big", "left", "adult")} end.`,
  "",
  `Overlap ${run("ka", "ri", "left", "adult")} end.`,
  "",
  `Unknown ${run("ka", "adult")} end.`,
  "",
  `Built ${e("grove")} ${e("house")} end.`,
  "",
  `Part ${e("roof")} end.`,
  "",
].join("\n");
const labels = [
  "Compound",
  "Mother",
  "Alone",
  "Both",
  "Elder",
  "Overlap",
  "Unknown",
  "Built",
  "Part",
];

async function open(file: string, mode: Mode): Promise<void> {
  await browser.executeObsidian(
    async ({ app, obsidian }, wanted, viewMode) => {
      const found = app.vault.getFileByPath(wanted);
      if (found === null) throw new Error(`no ${wanted}`);
      const leaf = app.workspace.getLeaf(false);
      await leaf.openFile(found, { state: { mode: viewMode, source: false } });
      if (!(leaf.view instanceof obsidian.MarkdownView)) {
        throw new Error("not a Markdown view");
      }
      app.workspace.setActiveLeaf(leaf, { focus: true });
      if (viewMode === "source") {
        leaf.view.editor.setCursor({ line: 0, ch: 0 });
      }
    },
    file,
    mode,
  );
  await browser.pause(1500);
}

async function theme(name: "moonstone" | "obsidian"): Promise<void> {
  await browser.executeObsidian(({ app }, chosen) => {
    const change: unknown = Reflect.get(app, "changeTheme");
    if (typeof change !== "function") throw new Error("no themes");
    Reflect.apply(change, app, [chosen]);
  }, name);
  await browser.pause(400);
}

/** The words and symbols' values each labelled block of the view shows. */
async function measure(wanted: readonly string[]): Promise<unknown[]> {
  return browser.execute((names) => {
    const leaf = activeDocument.querySelector(".workspace-leaf.mod-active");
    const reading = leaf?.querySelector(".markdown-reading-view");
    const scope =
      reading?.checkVisibility() === true
        ? reading
        : leaf?.querySelector(".markdown-source-view");
    if (scope === null || scope === undefined) throw new Error("no view");
    const blocks = Array.from(scope.querySelectorAll("p, .cm-line"));
    const name = (image: Element) =>
      (image.getAttribute("src") ?? "")
        .replace(/^.*\//, "")
        .replace(/\.ink\.png.*$/, "");
    const round = (value: number) => Math.round(value * 10) / 10;
    return names.map((label) => {
      const block = blocks.find((each) =>
        (each.textContent ?? "").trimStart().startsWith(label),
      );
      if (block === undefined) return { label, found: false };
      const images = Array.from(block.querySelectorAll("img.inkline-symbol"));
      return {
        label,
        height: round(block.getBoundingClientRect().height),
        words: Array.from(block.querySelectorAll(".inkline-word")).map(
          (word) => ({
            symbols: Array.from(word.querySelectorAll("img.inkline-symbol"))
              .map(name)
              .join(" "),
            under: word.getAttribute("data-inkline-under"),
            over: word.getAttribute("data-inkline-over"),
            literal: word.getAttribute("data-inkline-literal"),
            tooltip: word.getAttribute("aria-label"),
          }),
        ),
        symbols: images.map((image) => {
          const glyph = image.closest(".inkline-glyph");
          const word = image.closest(".inkline-word");
          const hidden = (pseudo: string) =>
            glyph === null
              ? true
              : getComputedStyle(glyph, pseudo).display === "none";
          return {
            name: name(image),
            inWord: word !== null,
            over: glyph?.getAttribute("data-inkline-over") ?? null,
            under: glyph?.getAttribute("data-inkline-under") ?? null,
            overShown: !hidden("::before"),
            underShown: !hidden("::after"),
          };
        }),
      };
    });
  }, wanted);
}

/** Screenshots of the active view from the top, at most two. */
async function shoot(name: string): Promise<void> {
  await saveScreenshot(`${name}-1`);
  const more = await browser.execute(() => {
    const leaf = activeDocument.querySelector(".workspace-leaf.mod-active");
    const reading = leaf?.querySelector(".markdown-preview-view");
    const editing = leaf?.querySelector(".cm-scroller");
    const element = reading?.checkVisibility() === true ? reading : editing;
    if (!(element instanceof HTMLElement)) return false;
    if (element.scrollHeight <= element.clientHeight + 2) return false;
    element.scrollTop = element.clientHeight - 60;
    return true;
  });
  if (!more) return;
  await browser.pause(400);
  await saveScreenshot(`${name}-2`);
  await browser.execute(() => {
    const leaf = activeDocument.querySelector(".workspace-leaf.mod-active");
    for (const element of Array.from(
      leaf?.querySelectorAll(".markdown-preview-view, .cm-scroller") ?? [],
    )) {
      if (element instanceof HTMLElement) element.scrollTop = 0;
    }
  });
}

async function createVault(): Promise<void> {
  await loadModules();
  results.existing = await browser.executeObsidian(({ app }) =>
    app.vault.getFiles().map((file) => file.path),
  );
  await browser.executeObsidian(
    async ({ app }, all, notes) => {
      const { canvas, text } = window.inklineTest;
      if (app.vault.getFolderByPath("Glyphs") === null) {
        await app.vault.createFolder("Glyphs");
      }
      for (const symbol of all) {
        const saved = await canvas.saveInk(
          { strokes: symbol.strokes },
          undefined,
          [],
        );
        let bytes: Uint8Array = saved.bytes;
        if (symbol.reading.length > 0) {
          bytes = await text.writeText(bytes, "reading", symbol.reading);
        }
        if (symbol.translation.length > 0) {
          bytes = await text.writeText(
            bytes,
            "translation",
            symbol.translation,
          );
        }
        if (symbol.role.length > 0) {
          bytes = await text.writeKeyword(bytes, text.roleKeyword, symbol.role);
        }
        const where = `Glyphs/${symbol.name}.ink.png`;
        const there = app.vault.getFileByPath(where);
        if (there === null) {
          await app.vault.createBinary(where, bytes.slice().buffer);
        } else await app.vault.modifyBinary(there, bytes.slice().buffer);
      }
      for (const [name, body] of Object.entries(notes)) {
        const there = app.vault.getFileByPath(name);
        if (there === null) await app.vault.create(name, body);
        else await app.vault.modify(there, body);
      }
    },
    symbols,
    {
      "Lexicon.md": lexiconNote,
      "Words.md": wordsNote,
      "Lists.md": "List here: \n",
    },
  );
}

/** Sets the prototype's mode and restarts Inkline, which reads it. */
async function prototype(on: boolean): Promise<void> {
  await browser.executeObsidian(
    async ({ plugins }, chosen) => {
      const data: unknown = await plugins.inkline.loadData();
      const next: Record<string, unknown> =
        typeof data === "object" && data !== null ? { ...data } : {};
      if (chosen) {
        next.rubyPrototype = "all";
        next.rubyGlyphs = "caption";
      } else {
        delete next.rubyPrototype;
        delete next.rubyGlyphs;
      }
      await plugins.inkline.saveData(next);
    },
    on,
  );
  await obsidianPage.disablePlugin("inkline");
  await obsidianPage.enablePlugin("inkline");
}

/** The prototype's dictionary, and how it splits the symbols `names`. */
async function state(names: string[] = []): Promise<Record<string, unknown>> {
  return browser.executeObsidian(({ plugins }, wanted) => {
    const get: unknown = Reflect.get(plugins.inkline, "prototypeDictionaryState");
    if (typeof get !== "function") throw new Error("no prototype");
    return Reflect.apply(get, plugins.inkline, [
      wanted.map((name) => `Glyphs/${name}.ink.png`),
    ]) as Record<string, unknown>;
  }, names);
}

/** What a symbol file holds: its text chunks' keywords and values, and record. */
async function fileFacts(file: string): Promise<Record<string, unknown>> {
  return browser.executeObsidian(async ({ app }, wanted) => {
    const { png, text } = window.inklineTest;
    const found = app.vault.getFileByPath(wanted);
    if (found === null) return { missing: true };
    const bytes = new Uint8Array(await app.vault.readBinary(found));
    const chunks = png.readChunks(bytes);
    const keywords = chunks
      .filter((chunk) => text.isTextChunk(chunk))
      .map((chunk) => {
        const end = chunk.data.indexOf(0);
        return `${chunk.type}:${new TextDecoder().decode(chunk.data.subarray(0, end))}`;
      });
    const record = chunks.find((chunk) => chunk.type === "inKL");
    let json: unknown;
    if (record !== undefined) {
      const inflated = await png.inflate(record.data.subarray(4));
      json = JSON.parse(new TextDecoder().decode(inflated));
    }
    const strokes =
      typeof json === "object" && json !== null
        ? (Reflect.get(json, "strokes") as unknown[] | undefined)?.length
        : undefined;
    return {
      keywords,
      reading: (await text.readText(chunks)).reading,
      role: await text.readKeyword(chunks, text.roleKeyword),
      future: await text.readKeyword(chunks, "Inkline future"),
      recordFields:
        typeof json === "object" && json !== null ? Object.keys(json) : [],
      strokes,
      parts:
        typeof json === "object" && json !== null
          ? Reflect.get(json, "parts")
          : undefined,
    };
  }, file);
}

/** Draws a stroke in the open editor and saves with its button. */
async function drawAndSave(): Promise<void> {
  await draw([
    [0.3, 0.8],
    [0.7, 0.8],
  ]);
  await browser.pause(300);
  await browser.$('[data-inkline-button="save"]').click();
  await browser.$(".inkline-editor").waitForExist({ reverse: true, timeout: 20_000 });
  await browser.pause(500);
}

async function menuItems(): Promise<string[]> {
  return browser.execute(() =>
    Array.from(document.querySelectorAll(".menu .menu-item-title")).map(
      (item) => item.textContent,
    ),
  );
}

async function libraryRows(): Promise<unknown[]> {
  return browser.execute(() =>
    Array.from(document.querySelectorAll(".inkline-library-symbol")).map(
      (row) => ({
        name: row.querySelector(".inkline-library-name")?.textContent,
        part: row.querySelector(".inkline-library-part-badge") !== null,
        dictionary: Array.from(
          row.querySelectorAll(".inkline-library-dictionary-line"),
        ).map((line) => line.textContent),
      }),
    ),
  );
}

const rowSelector = (name: string) =>
  `.inkline-library-symbol[data-inkline-path="Glyphs/${name}.ink.png"]`;

/** Selects `text` in the active note, or puts the cursor just inside it. */
async function select(text: string, collapse: boolean): Promise<void> {
  await browser.executeObsidian(
    ({ app, obsidian }, wanted, cursorOnly) => {
      const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
      if (view === null) throw new Error("no Markdown view");
      const editor = view.editor;
      const at = editor.getValue().indexOf(wanted);
      if (at === -1) throw new Error(`no ${wanted}`);
      if (cursorOnly) editor.setCursor(editor.offsetToPos(at + 3));
      else {
        editor.setSelection(
          editor.offsetToPos(at),
          editor.offsetToPos(at + wanted.length),
        );
      }
      editor.focus();
    },
    text,
    collapse,
  );
  await browser.pause(300);
}

/** Runs Add to dictionary and fills in its form. */
async function addEntry(
  reading: string | undefined,
  meaning: string | undefined,
  shot?: string,
): Promise<unknown> {
  await browser.executeObsidianCommand(
    "inkline:prototype-add-to-dictionary",
  );
  const modal = browser.$(".inkline-dictionary-modal");
  await modal.waitForExist({ timeout: 10_000 });
  await browser.pause(400);
  const shown = await browser.execute(() => {
    const element = document.querySelector(".inkline-dictionary-modal");
    const field = (name: string) =>
      element?.querySelector<HTMLInputElement>(
        `input[data-inkline-dictionary="${name}"]`,
      );
    return {
      title: element?.querySelector(".modal-title")?.textContent,
      pictures: Array.from(
        element?.querySelectorAll("img.inkline-dictionary-picture") ?? [],
      ).map((image) => image.getAttribute("alt")),
      tagged: element?.querySelectorAll("img.inkline-symbol").length,
      reading: field("reading")?.value,
      readingPlaceholder: field("reading")?.placeholder,
      meaning: field("meaning")?.value,
    };
  });
  if (shot !== undefined) await saveScreenshot(shot);
  if (reading !== undefined) {
    await browser.$('input[data-inkline-dictionary="reading"]').setValue(reading);
  }
  if (meaning !== undefined) {
    await browser.$('input[data-inkline-dictionary="meaning"]').setValue(meaning);
  }
  await browser.$(".inkline-dictionary-modal button.mod-cta").click();
  await modal.waitForExist({ reverse: true });
  await browser.pause(1200);
  return shown;
}

async function noteBody(file: string): Promise<string> {
  return browser.executeObsidian(async ({ app }, wanted) => {
    const found = app.vault.getFileByPath(wanted);
    return found === null ? "" : app.vault.read(found);
  }, file);
}

describe("A dictionary of words and parts (#167, section 5)", function () {
  this.timeout(900_000);
  const version = () =>
    `${browser.getObsidianVersion()}-${browser.getObsidianInstallerVersion()}`;

  before(async function () {
    await startOver();
    await prototype(false);
    await createVault();
  });

  after(async function () {
    await obsidianPage.enablePlugin("inkline");
    await writeFile(
      path.join(output, `dictionary-${version()}.json`),
      JSON.stringify(results, null, 2),
    );
    await prototype(false);
    await theme("moonstone");
    await startOver();
  });

  it("version 1 carries a new text keyword, and drops an unknown record field", async function () {
    // Without the prototype: 0.9.3's own editor and library paths.
    const steps: Record<string, unknown> = {};
    await browser.executeObsidian(async ({ app }) => {
      const { canvas, png, text } = window.inklineTest;
      const strokes = [
        {
          tool: "pen" as const,
          size: 160,
          points: [128, 1600, 768, 1600],
        },
      ];
      let bytes: Uint8Array = (await canvas.saveInk({ strokes }, undefined, []))
        .bytes;
      bytes = await text.writeText(bytes, "reading", ["ke"]);
      bytes = await text.writeKeyword(bytes, text.roleKeyword, ["part"]);
      bytes = await text.writeKeyword(bytes, "Inkline future", ["anything"]);
      await app.vault.createBinary("Glyphs/kept.ink.png", bytes.slice().buffer);
      // A record with a field version 1 does not define: the parts a symbol
      // was built from, by path.
      let fielded: Uint8Array = (await canvas.saveInk({ strokes }, undefined, []))
        .bytes;
      const chunks = png.readChunks(fielded);
      const record = chunks.find((chunk) => chunk.type === "inKL");
      if (record === undefined) throw new Error("no record");
      const json: unknown = JSON.parse(
        new TextDecoder().decode(await png.inflate(record.data.subarray(4))),
      );
      if (typeof json !== "object" || json === null) throw new Error("no json");
      const text2 = JSON.stringify({
        ...json,
        parts: ["Glyphs/tree.ink.png", "Glyphs/tree.ink.png"],
      });
      const packed = await png.deflate(new TextEncoder().encode(text2));
      const data = new Uint8Array(4 + packed.length);
      data.set(record.data.subarray(0, 4));
      data.set(packed, 4);
      const after = chunks[chunks.indexOf(record) + 1];
      if (after === undefined) throw new Error("nothing after the record");
      fielded = png.spliceChunks(fielded, chunks, new Set([record]), {
        chunk: { type: "inKL", data },
        before: after,
      });
      await app.vault.createBinary(
        "Glyphs/fielded.ink.png",
        fielded.slice().buffer,
      );
    });
    await browser.pause(800);
    steps.keptMade = await fileFacts("Glyphs/kept.ink.png");
    steps.fieldedMade = await fileFacts("Glyphs/fielded.ink.png");

    // 1. The editor: open, draw, save.
    await browser.executeObsidian(({ app, plugins }) => {
      const found = app.vault.getFileByPath("Glyphs/kept.ink.png");
      if (found === null) throw new Error("no kept");
      void plugins.inkline.editSymbol(found);
    });
    await waitForEditor();
    await drawAndSave();
    steps.keptAfterEditor = await fileFacts("Glyphs/kept.ink.png");

    // 2. The library's readings and translations.
    await browser.executeObsidianCommand("inkline:show-library");
    await browser.$(".inkline-library-list").waitForExist();
    await browser.$(rowSelector("kept")).waitForExist({ timeout: 10_000 });
    await browser.$(`${rowSelector("kept")} [data-inkline-role="text"]`).click();
    const save = browser.$(".inkline-library-text-buttons button");
    await browser.waitUntil(
      async () => (await save.isExisting()) && (await save.isEnabled()),
    );
    await browser
      .$('textarea[data-inkline-field="reading"]')
      .setValue("kee");
    await save.click();
    await browser
      .$(".inkline-library-text-form")
      .waitForExist({ reverse: true });
    await browser.pause(800);
    steps.keptAfterLibrary = await fileFacts("Glyphs/kept.ink.png");

    // 3. A rename, by Obsidian's file manager.
    await browser.executeObsidian(async ({ app }) => {
      const found = app.vault.getFileByPath("Glyphs/kept.ink.png");
      if (found === null) throw new Error("no kept");
      await app.fileManager.renameFile(found, "Glyphs/kept2.ink.png");
    });
    await browser.pause(800);
    steps.keptAfterRename = await fileFacts("Glyphs/kept2.ink.png");

    // 4. The record field: does the editor open the file, and keep it?
    await browser.executeObsidian(({ app, plugins }) => {
      const found = app.vault.getFileByPath("Glyphs/fielded.ink.png");
      if (found === null) throw new Error("no fielded");
      void plugins.inkline.editSymbol(found);
    });
    await waitForEditor();
    steps.fieldedOpened = await browser.execute(() => ({
      editor: document.querySelector(".inkline-editor") !== null,
      notices: Array.from(document.querySelectorAll(".notice")).map(
        (notice) => notice.textContent,
      ),
    }));
    await drawAndSave();
    steps.fieldedAfterEditor = await fileFacts("Glyphs/fielded.ink.png");
    results.v1 = steps;
  });

  it("the dictionary's indexes and splits", async function () {
    await prototype(true);
    await browser.waitUntil(
      async () =>
        ((await state()).entries as unknown[] | undefined)?.length === 5,
      { timeout: 30_000, timeoutMsg: "the lexicon was not read" },
    );
    // Literal glosses need the symbols' values, which the index reads.
    await browser.pause(1500);
    results.indexes = await state();
    results.splits = {
      overlap: await state(["ka", "ri", "left", "adult"]),
      elder: await state(["big", "left", "adult"]),
      both: await state(["left", "adult", "right", "adult"]),
      unknown: await state(["ka", "adult"]),
    };
  });

  it("shows words, compounds and parts in Reading view and Live Preview", async function () {
    const views: Record<string, unknown> = {};
    for (const [name, mode] of [
      ["reading", "preview"],
      ["live", "source"],
    ] as const) {
      await open("Words.md", mode);
      views[name] = await measure(labels);
      await shoot(`dictionary-${name}-light`);
      await theme("obsidian");
      await shoot(`dictionary-${name}-dark`);
      await theme("moonstone");
    }
    // The literal gloss on hover over a compound's meaning, in Reading view
    // and in Live Preview.
    for (const [name, mode] of [
      ["reading", "preview"],
      ["live", "source"],
    ] as const) {
      await open("Words.md", mode);
      const word = await browser
        .$(`.workspace-leaf.mod-active .${mode === "preview" ? "markdown-reading-view" : "cm-content"} .inkline-word[data-inkline-literal]`)
        .getElement();
      const size = await word.getSize();
      await browser
        .action("pointer")
        .move({ origin: word, x: 0, y: Math.floor(size.height / 2) - 3 })
        .perform();
      await browser.pause(1500);
      views[`${name}Tooltip`] = await browser.execute(() =>
        Array.from(document.querySelectorAll(".tooltip")).map(
          (tip) => tip.textContent,
        ),
      );
      await saveScreenshot(`dictionary-hover-${name}`);
      await browser.action("pointer").move({ x: 5, y: 5 }).perform();
      await browser.pause(300);
    }
    // The lexicon note itself.
    await open("Lexicon.md", "preview");
    await shoot("dictionary-lexicon-reading");
    results.display = views;
  });

  it("parts in the ;; list, and in the library with its radical index", async function () {
    const steps: Record<string, unknown> = {};
    await open("Lists.md", "source");
    await browser.executeObsidian(({ app, obsidian }) => {
      const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
      if (view === null) throw new Error("no view");
      view.editor.setCursor({ line: 0, ch: "List here: ".length });
      view.editor.focus();
    });
    for (const key of ";;") await browser.keys([key]);
    await browser.$(".suggestion-container").waitForExist({ timeout: 10_000 });
    await browser.pause(800);
    steps.suggested = await browser.execute(() =>
      Array.from(document.querySelectorAll(".suggestion-item")).map((item) => ({
        name: item.querySelector(".inkline-suggestion-name")?.textContent,
        part: item.querySelector(".inkline-suggestion-part") !== null,
      })),
    );
    await saveScreenshot("dictionary-suggest");
    // Typing a part's name still finds it.
    for (const key of "roo") await browser.keys([key]);
    await browser.pause(800);
    steps.suggestedRoof = await browser.execute(() =>
      Array.from(document.querySelectorAll(".suggestion-item")).map(
        (item) => item.querySelector(".inkline-suggestion-name")?.textContent,
      ),
    );
    await browser.keys(["Escape"]);

    await browser.executeObsidianCommand("inkline:show-library");
    await browser.$(".inkline-library-list").waitForExist();
    await browser.pause(1000);
    steps.library = await libraryRows();
    await saveScreenshot("dictionary-library");
    // Marking a symbol as a part from its menu, and taking it back.
    await browser
      .$(`${rowSelector("ka")} .inkline-library-insert`)
      .click({ button: "right" });
    await browser.waitUntil(async () =>
      (await menuItems()).includes("Only a part of other symbols"),
    );
    steps.menu = await menuItems();
    await saveScreenshot("dictionary-menu");
    const mark = browser.$(".menu-item-title=Only a part of other symbols");
    await mark.waitForDisplayed();
    await mark.click();
    await browser.waitUntil(async () =>
      browser.$(`${rowSelector("ka")} .inkline-library-part-badge`).isExisting(),
    );
    steps.kaMarked = await fileFacts("Glyphs/ka.ink.png");
    await browser
      .$(`${rowSelector("ka")} .inkline-library-insert`)
      .click({ button: "right" });
    await browser.waitUntil(async () =>
      (await menuItems()).includes("Not only a part"),
    );
    const unmark = browser.$(".menu-item-title=Not only a part");
    await unmark.waitForDisplayed();
    await unmark.click();
    await browser.waitUntil(
      async () =>
        !(await browser
          .$(`${rowSelector("ka")} .inkline-library-part-badge`)
          .isExisting()),
    );
    steps.kaUnmarked = await fileFacts("Glyphs/ka.ink.png");
    results.lists = steps;
  });

  it("adds and changes entries from a note", async function () {
    const steps: Record<string, unknown> = {};
    await open("Words.md", "source");
    // Several symbols, not yet a word: a new row.
    await select(run("ka", "adult"), false);
    steps.newWordForm = await addEntry(
      "kana",
      "messenger",
      "dictionary-add-modal",
    );
    steps.lexiconAfterNew = (await noteBody("Lexicon.md")).split("\n").slice(-4);
    await open("Words.md", "preview");
    steps.readingAfterNew = await measure(["Unknown"]);
    // The cursor in a known word: its row changes.
    await open("Words.md", "source");
    await select(`Compound ${run("left", "adult")}`, false);
    await select(run("left", "adult"), true);
    steps.changeForm = await addEntry(undefined, "dad");
    steps.lexiconAfterChange = (await noteBody("Lexicon.md"))
      .split("\n")
      .find((line) => line.includes("dad"));
    await open("Words.md", "preview");
    steps.readingAfterChange = await measure(["Compound", "Both"]);
    // One symbol: its own file's values.
    await open("Words.md", "source");
    await select(`Alone ${e("adult")}`, false);
    await select(e("adult"), false);
    steps.oneForm = await addEntry(undefined, "grown-up");
    steps.adultAfter = await fileFacts("Glyphs/adult.ink.png");
    // Text between symbols is refused.
    await select(`${e("grove")} ${e("house")}`, false);
    await browser.executeObsidianCommand("inkline:prototype-add-to-dictionary");
    await browser.pause(500);
    steps.apartNotice = await browser.execute(() =>
      Array.from(document.querySelectorAll(".notice")).map(
        (notice) => notice.textContent,
      ),
    );
    await open("Words.md", "preview");
    await shoot("dictionary-after-edits");
    results.edits = steps;
  });

  it("follows a rename of a part and of a word's symbol", async function () {
    await browser.executeObsidian(async ({ app }) => {
      // Obsidian's "Always update internal links", so that no question waits.
      const setConfig: unknown = Reflect.get(app.vault, "setConfig");
      if (typeof setConfig !== "function") throw new Error("no setConfig");
      Reflect.apply(setConfig, app.vault, ["alwaysUpdateLinks", true]);
      for (const [from, to] of [
        ["Glyphs/adult.ink.png", "Glyphs/grown.ink.png"],
        ["Glyphs/roof.ink.png", "Glyphs/cover.ink.png"],
      ] as const) {
        const found = app.vault.getFileByPath(from);
        if (found === null) throw new Error(`no ${from}`);
        await app.fileManager.renameFile(found, to);
      }
    });
    await browser.pause(2000);
    results.rename = {
      lexicon: (await noteBody("Lexicon.md")).split("\n").slice(8, 20),
      state: await state(),
      cover: await fileFacts("Glyphs/cover.ink.png"),
    };
    await open("Words.md", "preview");
    results.renameReading = await measure(["Compound", "Both", "Built"]);
    results.renameImages = await browser.execute(() =>
      Array.from(
        document.querySelectorAll(".workspace-leaf.mod-active .markdown-reading-view p"),
      ).map((p) => ({
        text: (p.textContent ?? "").slice(0, 12),
        all: Array.from(p.querySelectorAll("img")).map((image) =>
          `${(image.getAttribute("src") ?? "").replace(/^.*\//, "").replace(/\?.*$/, "")}${image.classList.contains("inkline-symbol") ? "" : " (untagged)"}`,
        ),
      })),
    );
    await saveScreenshot("dictionary-after-rename");
    await browser.pause(4000);
    results.renameReadingLater = await measure(["Compound", "Both", "Built"]);
    await open("Words.md", "source");
    results.renameLive = await measure(["Compound", "Both", "Built"]);
    await saveScreenshot("dictionary-after-rename-live");
  });

  it("without Inkline", async function () {
    await obsidianPage.disablePlugin("inkline");
    await open("Lexicon.md", "preview");
    await shoot("dictionary-without-lexicon");
    await open("Words.md", "preview");
    await shoot("dictionary-without-words");
    results.without = await browser.execute(() => ({
      words: document.querySelectorAll(".inkline-word").length,
      glyphs: document.querySelectorAll(".inkline-glyph").length,
      tagged: document.querySelectorAll("img.inkline-symbol").length,
      images: document.querySelectorAll(".markdown-reading-view img").length,
    }));
    await obsidianPage.enablePlugin("inkline");
  });
});
