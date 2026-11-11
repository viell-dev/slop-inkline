// Investigation for #167 §4, not part of the suite: building a symbol from
// other symbols as parts, scaled and placed, in real Obsidian with the
// published plugin's code. It builds a triangle of three copies of a part in
// one symbol's size, as copied strokes (a version-1 file), with stroke widths
// kept, flattened into a base layer (version 1), and linked by a prototype
// version-2 record; then shows them in notes, with and without Inkline,
// edits them, changes, renames, and deletes the part, and tries loops and
// deep nesting. It writes what it measures to compose-<version>.json.

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import { loadModules } from "../support/browser.ts";
import { waitForEditor } from "../support/editor.ts";
import { outputDirectory } from "../support/harness.ts";
import { saveScreenshot } from "../support/screenshots.ts";

const root = path.resolve(import.meta.dirname, "../../..");
const outputDir = outputDirectory(process.env.E2E_OUTPUT_DIR, root);
const measured: Record<string, unknown> = {};

const symbols = [
  "Parts/mark.ink.png",
  "Composed/tri-copy.ink.png",
  "Composed/tri-keep.ink.png",
  "Composed/tri-linked.ink.png",
  "Composed/tri-flat.ink.png",
  "Composed/mixed-flat.ink.png",
];

const note = [
  "# Parts ![[Parts/mark.ink.png]] and ![[Composed/tri-keep.ink.png]] at heading size",
  "",
  "A part ![[Parts/mark.ink.png]] alone; copied ![[Composed/tri-copy.ink.png]], weight kept ![[Composed/tri-keep.ink.png]], linked ![[Composed/tri-linked.ink.png]], flattened ![[Composed/tri-flat.ink.png]], with a traced part ![[Composed/mixed-flat.ink.png]] in text.",
  "",
].join("\n");

type Mode = "source" | "preview" | "raw";

async function open(file: string, mode: Mode): Promise<void> {
  await browser.executeObsidian(
    async ({ app, obsidian }, wanted, chosen) => {
      const found = app.vault.getFileByPath(wanted);
      if (found === null) throw new Error(`no ${wanted}`);
      const leaf = app.workspace.getLeaf(false);
      await leaf.openFile(found, {
        state: {
          mode: chosen === "preview" ? "preview" : "source",
          source: chosen === "raw",
        },
      });
      if (!(leaf.view instanceof obsidian.MarkdownView)) {
        throw new Error("not a Markdown view");
      }
      app.workspace.setActiveLeaf(leaf, { focus: true });
    },
    file,
    mode,
  );
}

function images(mode: Mode): string {
  return mode === "preview"
    ? ".workspace-leaf.mod-active .markdown-reading-view img"
    : ".workspace-leaf.mod-active .markdown-source-view img:not(.cm-widgetBuffer)";
}

interface Shown {
  src: string;
  tagged: boolean;
  complete: boolean;
  height: number;
  width: number;
  naturalHeight: number;
  drop: number;
  fontSize: number;
}

async function shown(selector: string): Promise<Shown[]> {
  return browser.execute((wanted) => {
    return Array.from(activeDocument.querySelectorAll(wanted)).map((node) => {
      if (!node.instanceOf(HTMLImageElement)) throw new Error("not an image");
      const probe = createSpan({
        attr: {
          style:
            "display: inline-block; width: 0; height: 0; vertical-align: baseline",
        },
      });
      (node.closest(".image-embed") ?? node).after(probe);
      const baseline = probe.getBoundingClientRect().bottom;
      probe.remove();
      const rect = node.getBoundingClientRect();
      return {
        src: node.getAttribute("src") ?? "",
        tagged: node.classList.contains("inkline-symbol"),
        complete: node.complete,
        height: rect.height,
        width: rect.width,
        naturalHeight: node.naturalHeight,
        drop: rect.bottom - baseline,
        fontSize: Number.parseFloat(getComputedStyle(node).fontSize),
      };
    });
  }, selector);
}

async function theme(name: "moonstone" | "obsidian"): Promise<void> {
  await browser.executeObsidian(({ app }, chosen) => {
    const change: unknown = Reflect.get(app, "changeTheme");
    if (typeof change !== "function") throw new Error("no themes");
    Reflect.apply(change, app, [chosen]);
  }, name);
  await browser.pause(400);
}

/** The vault's symbols as the link checker sees them. */
async function vaultCheck(name: string) {
  return browser.executeObsidian(async ({ app }, wanted) => {
    const { compose, composeGraph, inkFile } = window.inklineTest;
    const nodes = new Map<string, { points: number; parts: { symbol: string; x: number; y: number; scale: number }[] }>();
    for (const file of app.vault.getFiles()) {
      if (!file.path.endsWith(".ink.png")) continue;
      const bytes = new Uint8Array(await app.vault.readBinary(file));
      const chunk = await compose.recordChunkOf(bytes);
      if (chunk?.version === 2) {
        const record = chunk.record as {
          parts: { symbol: string; x: number; y: number; scale: number }[];
        };
        nodes.set(file.path, { points: 0, parts: record.parts });
        continue;
      }
      const source = await inkFile.readInkFile(bytes);
      const points =
        source.kind === "record"
          ? source.record.strokes.reduce((sum, s) => sum + s.points.length / 2, 0)
          : 0;
      nodes.set(file.path, { points, parts: [] });
    }
    return composeGraph.checkComposite(wanted, (symbol) => nodes.get(symbol));
  }, name);
}

describe("Symbols built from other symbols (#167 §4)", function () {
  before(async function () {
    await loadModules();
    const scene = await browser.executeObsidian(async ({ app }, text) => {
      const { compose, canvas, inkFile } = window.inklineTest;
      const timings: Record<string, number> = {};
      const time = async <T>(name: string, step: () => Promise<T>) => {
        const started = performance.now();
        const result = await step();
        timings[name] = Math.round((performance.now() - started) * 10) / 10;
        return result;
      };
      const write = async (file: string, bytes: Uint8Array) => {
        const folder = file.slice(0, file.lastIndexOf("/"));
        if (app.vault.getFolderByPath(folder) === null) {
          await app.vault.createFolder(folder);
        }
        await app.vault.createBinary(file, bytes.slice().buffer);
      };

      // The parts, saved as Inkline saves.
      const mark = await canvas.saveInk(compose.markDocument(), undefined);
      await write("Parts/mark.ink.png", mark.bytes);
      const traced = await canvas.baseFromPicture(await compose.ringPicture());
      const ring = await canvas.saveInk(
        { strokes: [], base: traced.layer },
        traced.drawable,
      );
      await write("Parts/ring.ink.png", ring.bytes);

      const width = mark.width;
      const parts = (weight: "scale" | "keep") =>
        compose
          .triangle(width, weight)
          .map((placement) => ({ record: mark.record, placement }));

      // Each way, drawn at the same origin, to compare.
      const copied = compose.copyIn(parts("scale"));
      const kept = compose.copyIn(parts("keep"));
      if (!copied.ok || !kept.ok) throw new Error("copy refused");
      const copyCanvas = await compose.drawRecord(copied.record, width);
      const keepCanvas = await compose.drawRecord(kept.record, width);
      const layered = await time("drawLayered", () =>
        compose.drawLayered(parts("scale"), width),
      );
      const transformed = await compose.drawTransformed(parts("scale"), width);
      // One part alone, without erasers in play beyond its own: how far
      // scaled points and widths are from the exact shape scaled.
      const alone = [{ record: mark.record, placement: { x: 0, y: 0, scale: 0.5, weight: "scale" as const } }];
      const aloneScaled = await compose.drawLayered(alone, width);
      const aloneExact = await compose.drawTransformed(alone, width);
      const full = await compose.drawRecord(mark.record, width);

      const measures = {
        partWidth: width,
        partStrokes: mark.record.strokes.length,
        partInk: compose.difference(full, full).inkA,
        // What copying strokes in loses: the third part's eraser cuts into
        // the second part, where drawing parts on layers of their own keeps
        // it.
        copyAgainstLayered: compose.difference(layered, copyCanvas),
        // Points and widths scaled, against the shape scaled exactly.
        scaledAgainstExact: compose.difference(aloneExact, aloneScaled),
        triangleScaledAgainstExact: compose.difference(transformed, layered),
        keptWeightAgainstScaled: compose.difference(layered, keepCanvas),
      };

      // The files.
      const copyFile = await time("saveCopy", () =>
        canvas.saveInk(copied.record, undefined),
      );
      await write("Composed/tri-copy.ink.png", copyFile.bytes);
      const keepFile = await canvas.saveInk(kept.record, undefined);
      await write("Composed/tri-keep.ink.png", keepFile.bytes);
      const flat = await compose.flattened(layered);
      const flatFile = await time("saveFlat", () =>
        canvas.saveInk(flat.document, flat.base),
      );
      await write("Composed/tri-flat.ink.png", flatFile.bytes);
      const { canvas: linkedImage, left } = compose.cropped(layered);
      const linkedFile = await time("writeLinked", () =>
        compose.versionTwoFile(linkedImage, {
          strokes: [],
          parts: compose.partRefs(
            "Parts/mark.ink.png",
            compose.triangle(width, "scale"),
            left,
          ),
        }),
      );
      await write("Composed/tri-linked.ink.png", linkedFile);

      // A traced part has a base layer, and a record holds one.
      const mixedParts = compose.triangle(width, "scale").map((placement, index) => ({
        record: index === 0 ? mark.record : ring.record,
        placement,
      }));
      const mixedCopy = compose.copyIn(mixedParts);
      const mixedLayered = await compose.drawLayered(mixedParts, width);
      const mixedFlat = await compose.flattened(mixedLayered);
      const mixedFile = await canvas.saveInk(mixedFlat.document, mixedFlat.base);
      await write("Composed/mixed-flat.ink.png", mixedFile.bytes);

      // What Inkline 0.9.2, a version-1 reader, makes of each.
      const opened: Record<string, unknown> = {};
      for (const [name, bytes] of [
        ["copy", copyFile.bytes],
        ["flat", flatFile.bytes],
        ["linked", linkedFile],
      ] as const) {
        const result = await canvas.openInk(bytes);
        opened[name] =
          result.kind === "editable"
            ? {
                kind: result.kind,
                strokes: result.document.strokes.length,
                base: result.document.base !== undefined,
                width: result.width,
              }
            : result;
      }
      const linkedSource = await inkFile.readInkFile(linkedFile);

      await app.vault.create("Compose.md", text);
      return {
        measures,
        timings,
        widths: {
          part: mark.width,
          copy: copyFile.width,
          keep: keepFile.width,
          flat: flatFile.width,
          linked: linkedImage.width,
          mixed: mixedFile.width,
        },
        bytes: {
          part: mark.bytes.length,
          copy: copyFile.bytes.length,
          keep: keepFile.bytes.length,
          flat: flatFile.bytes.length,
          linked: linkedFile.length,
          mixed: mixedFile.bytes.length,
        },
        copyStrokes: copyFile.record.strokes.length,
        mixedCopy: mixedCopy.ok ? "copied" : mixedCopy.reason,
        opened,
        linkedSource: linkedSource.kind === "pixels" ? linkedSource : "record",
        linkedRecord: await compose.recordChunkOf(linkedFile),
      };
    }, note);
    measured.scene = scene;
  });

  after(async function () {
    const version = `${browser.getObsidianVersion()}-${browser.getObsidianInstallerVersion()}`;
    await writeFile(
      path.join(outputDir, `compose-${version}.json`),
      `${JSON.stringify(measured, null, 2)}\n`,
    );
  });

  it("builds the triangle each way, and copying strokes in lets an eraser reach another part", function () {
    const scene = measured.scene as {
      measures: {
        copyAgainstLayered: { lost: number; differing: number };
        partStrokes: number;
      };
      copyStrokes: number;
      mixedCopy: string;
      opened: Record<string, { kind: string; strokes?: number }>;
    };
    expect(scene.measures.copyAgainstLayered.lost).toBeGreaterThan(0);
    expect(scene.copyStrokes).toBe(3 * scene.measures.partStrokes);
    expect(scene.mixedCopy).toContain("base layer");
    expect(scene.opened.copy?.kind).toBe("editable");
    expect(scene.opened.flat?.kind).toBe("editable");
    expect(scene.opened.linked?.kind).toBe("newer-version");
  });

  for (const mode of ["preview", "source"] as const) {
    const name = mode === "preview" ? "Reading view" : "Live Preview";
    it(`shows every composite as a symbol in ${name}, in both themes`, async function () {
      await open("Compose.md", mode);
      await browser.waitUntil(
        async () => {
          const all = await shown(images(mode));
          return all.filter((each) => each.tagged && each.complete).length === 8;
        },
        { timeoutMsg: "symbols were not all tagged" },
      );
      const all = (await shown(images(mode))).filter((each) => each.tagged);
      measured[`shown-${mode}`] = all;
      for (const image of all) {
        expect(Math.abs(image.height - 1.5 * image.fontSize)).toBeLessThanOrEqual(1);
        expect(Math.abs(image.drop - 0.375 * image.fontSize)).toBeLessThanOrEqual(1);
      }
      for (const chosen of ["moonstone", "obsidian"] as const) {
        await theme(chosen);
        await saveScreenshot(`compose-${mode}-${chosen}`);
        const block =
          mode === "preview"
            ? browser.$(".workspace-leaf.mod-active .markdown-reading-view p")
            : browser.$(".workspace-leaf.mod-active .cm-content");
        await saveScreenshot(`compose-${mode}-${chosen}-text`, block);
      }
      await theme("moonstone");
    });
  }

  it("leaves Source mode as text", async function () {
    await open("Compose.md", "raw");
    await browser.pause(500);
    await saveScreenshot("compose-raw");
    const count = (await shown(images("raw"))).length;
    expect(count).toBe(0);
  });

  it("opens the copied triangle in the editor with every stroke, and refuses the linked one", async function () {
    await browser.executeObsidian(({ app, plugins }) => {
      const found = app.vault.getFileByPath("Composed/tri-copy.ink.png");
      if (found === null) throw new Error("no copy");
      void plugins.inkline.editSymbol(found);
    });
    await waitForEditor();
    await browser.pause(300);
    await saveScreenshot("compose-editor-copy");
    await browser.keys(["Escape"]);
    await browser.$(".inkline-editor").waitForExist({ reverse: true });
    await browser.executeObsidian(({ app, plugins }) => {
      const found = app.vault.getFileByPath("Composed/tri-linked.ink.png");
      if (found === null) throw new Error("no linked");
      void plugins.inkline.editSymbol(found);
    });
    const notice = browser.$(".notice*=saved by a newer version");
    await notice.waitForExist();
    measured.linkedNotice = await notice.getText();
    await saveScreenshot("compose-editor-linked-refused");
    expect(await browser.$(".inkline-editor").isExisting()).toBe(false);
  });

  it("shows every composite as the picture it is without Inkline", async function () {
    await obsidianPage.disablePlugin("inkline");
    try {
      await open("Compose.md", "preview");
      await browser.waitUntil(async () => {
        const all = await shown(images("preview"));
        return all.length === 8 && all.every((each) => each.complete);
      });
      const all = await shown(images("preview"));
      measured.withoutInkline = all;
      for (const image of all) {
        expect(image.tagged).toBe(false);
        expect(image.naturalHeight).toBe(192);
      }
      await saveScreenshot("compose-without-inkline");
      await theme("obsidian");
      await saveScreenshot("compose-without-inkline-dark");
      await theme("moonstone");
    } finally {
      await obsidianPage.enablePlugin("inkline");
      await loadModules();
    }
  });

  it("checks the links: a part used three times, nothing missing, no loop", async function () {
    const check = await vaultCheck("Composed/tri-linked.ink.png");
    measured.checkBefore = check;
    expect(check).toMatchObject({ ok: true, draws: 3 });
  });

  it("changes a part: copies keep the old one, and links need every user redrawn", async function () {
    const result = await browser.executeObsidian(async ({ app }) => {
      const { compose, canvas, composeGraph } = window.inklineTest;
      const read = async (file: string) => {
        const found = app.vault.getFileByPath(file);
        if (found === null) throw new Error(`no ${file}`);
        return new Uint8Array(await app.vault.readBinary(found));
      };
      // Forty more users of the part, as a script's syllables would be.
      const linked = await read("Composed/tri-linked.ink.png");
      await app.vault.createFolder("Many");
      for (let index = 0; index < 40; index++) {
        await app.vault.createBinary(
          `Many/linked-${String(index).padStart(2, "0")}.ink.png`,
          linked.slice().buffer,
        );
      }
      const copyBefore = await read("Composed/tri-copy.ink.png");
      const shownBefore = document
        .querySelector('.markdown-reading-view img[src*="tri-linked"]')
        ?.getAttribute("src");

      // The part changes: a dot under the bar.
      const opened = await canvas.openInk(await read("Parts/mark.ink.png"));
      if (opened.kind !== "editable") throw new Error("part not editable");
      const changed = {
        strokes: [
          ...opened.document.strokes,
          { tool: "pen" as const, size: 24 * 16, points: [69 * 16, 124 * 16] },
        ],
      };
      const saved = await canvas.saveInk(changed, undefined);
      const part = app.vault.getFileByPath("Parts/mark.ink.png");
      if (part === null) throw new Error("no part");
      await app.vault.modifyBinary(part, saved.bytes.slice().buffer);

      // What Inkline would then have to do: find every user and redraw it.
      const started = performance.now();
      const files = app.vault.getFiles().filter((f) => f.path.endsWith(".ink.png"));
      const records = new Map<string, { parts: { symbol: string; x: number; y: number; scale: number }[] }>();
      const nodes = new Map<string, { points: number; parts: { symbol: string; x: number; y: number; scale: number }[] }>();
      for (const file of files) {
        const chunk = await compose.recordChunkOf(await read(file.path));
        const parts =
          chunk?.version === 2
            ? (chunk.record as { parts: { symbol: string; x: number; y: number; scale: number }[] }).parts
            : [];
        if (chunk?.version === 2) records.set(file.path, { parts });
        nodes.set(file.path, { points: 0, parts });
      }
      const scanned = performance.now() - started;
      const order = composeGraph.dependents(
        "Parts/mark.ink.png",
        files.map((f) => f.path),
        (symbol) => nodes.get(symbol),
      );
      const partRecords = new Map([["Parts/mark.ink.png", saved.record]]);
      for (const user of order) {
        const record = records.get(user);
        if (record === undefined) continue;
        const placed = compose.placedRefs(record.parts, partRecords);
        if (!Array.isArray(placed)) throw new Error(`missing ${placed.missing}`);
        const old = await read(user);
        const width = new DataView(old.buffer, old.byteOffset).getUint32(16);
        const image = await compose.drawLayered(placed, width);
        const bytes = await compose.versionTwoFile(image, { strokes: [], parts: record.parts });
        const found = app.vault.getFileByPath(user);
        if (found === null) throw new Error(`no ${user}`);
        await app.vault.modifyBinary(found, bytes.slice().buffer);
      }
      const total = performance.now() - started;
      const copyAfter = await read("Composed/tri-copy.ink.png");
      return {
        users: order.length,
        scanMs: Math.round(scanned),
        totalMs: Math.round(total),
        perUserMs: Math.round(((total - scanned) / order.length) * 10) / 10,
        copyUnchanged:
          copyBefore.length === copyAfter.length &&
          copyBefore.every((byte, index) => byte === copyAfter[index]),
        shownBefore,
      };
    });
    measured.propagation = result;
    expect(result.users).toBe(41);
    expect(result.copyUnchanged).toBe(true);
    await open("Compose.md", "preview");
    await browser.waitUntil(async () =>
      (await shown(images("preview"))).filter((each) => each.tagged && each.complete).length === 8,
    );
    await browser.pause(500);
    await saveScreenshot("compose-after-part-changed");
    await saveScreenshot(
      "compose-after-part-changed-text",
      browser.$(".workspace-leaf.mod-active .markdown-reading-view p"),
    );
  });

  it("renames a part: Obsidian updates the notes, not the links inside symbols", async function () {
    const result = await browser.executeObsidian(async ({ app }) => {
      const { compose } = window.inklineTest;
      const part = app.vault.getFileByPath("Parts/mark.ink.png");
      if (part === null) throw new Error("no part");
      // Links follow without Obsidian's question, as with that setting on.
      const vault: unknown = app.vault;
      const set: unknown = Reflect.get(vault as object, "setConfig");
      if (typeof set !== "function") throw new Error("no setConfig");
      Reflect.apply(set, vault, ["alwaysUpdateLinks", true]);
      await app.fileManager.renameFile(part, "Parts/sign.ink.png");
      await new Promise((resolve) => window.setTimeout(resolve, 1500));
      const noteFile = app.vault.getFileByPath("Compose.md");
      if (noteFile === null) throw new Error("no note");
      const text = await app.vault.read(noteFile);
      const linkedFile = app.vault.getFileByPath("Composed/tri-linked.ink.png");
      if (linkedFile === null) throw new Error("no linked");
      const chunk = await compose.recordChunkOf(
        new Uint8Array(await app.vault.readBinary(linkedFile)),
      );
      const backlinks = Object.entries(app.metadataCache.resolvedLinks)
        .filter(([, targets]) => "Parts/sign.ink.png" in targets)
        .map(([from]) => from);
      return {
        noteNamesNewPath: text.includes("Parts/sign.ink.png"),
        noteNamesOldPath: text.includes("Parts/mark.ink.png"),
        linkedRecordNames: (chunk?.record as { parts: { symbol: string }[] }).parts.map((p) => p.symbol),
        backlinks,
      };
    });
    measured.rename = result;
    expect(result.noteNamesNewPath).toBe(true);
    expect(result.linkedRecordNames).toContain("Parts/mark.ink.png");
    const check = await vaultCheck("Composed/tri-linked.ink.png");
    measured.checkAfterRename = check;
    expect(check).toMatchObject({ ok: false, reason: "missing" });

    // What Inkline would then have to do: rewrite every user's record.
    const rewrite = await browser.executeObsidian(async ({ app }) => {
      const { compose, composeGraph, png } = window.inklineTest;
      const started = performance.now();
      let rewritten = 0;
      for (const file of app.vault.getFiles()) {
        if (!file.path.endsWith(".ink.png")) continue;
        const bytes = new Uint8Array(await app.vault.readBinary(file));
        const chunk = await compose.recordChunkOf(bytes);
        if (chunk?.version !== 2) continue;
        const record = chunk.record as { strokes: unknown[]; parts: { symbol: string; x: number; y: number; scale: number }[] };
        const parts = composeGraph.renamedParts(record.parts, "Parts/mark.ink.png", "Parts/sign.ink.png");
        if (parts === undefined) continue;
        // Only the record chunk changes: the pixels stay.
        const chunks = png.readChunks(bytes);
        const text = new TextEncoder().encode(JSON.stringify({ ...record, parts }));
        const compressed = await png.deflate(text);
        const data = new Uint8Array(4 + compressed.length);
        new DataView(data.buffer).setUint32(0, 2);
        data.set(compressed, 4);
        const out = png.writeChunks(
          chunks.map((each) => (each.type === "inKL" ? { type: "inKL", data } : each)),
        );
        await app.vault.modifyBinary(file, out.slice().buffer);
        rewritten++;
      }
      return { rewritten, ms: Math.round(performance.now() - started) };
    });
    measured.renameRewrite = rewrite;
    expect(rewrite.rewritten).toBe(41);
    expect(await vaultCheck("Composed/tri-linked.ink.png")).toMatchObject({ ok: true });
  });

  it("deletes a part: notes still show every composite, and the linked ones can no longer be drawn", async function () {
    await browser.executeObsidian(async ({ app }) => {
      const part = app.vault.getFileByPath("Parts/sign.ink.png");
      if (part === null) throw new Error("no part");
      await app.fileManager.trashFile(part);
    });
    await open("Compose.md", "preview");
    await browser.pause(800);
    const all = await shown(images("preview"));
    measured.afterDelete = all.map((each) => ({
      src: each.src.slice(0, 60),
      tagged: each.tagged,
      complete: each.complete,
      naturalHeight: each.naturalHeight,
    }));
    // The part's own two embeds no longer find a file; the composites show.
    const composites = all.filter((each) => /tri-|mixed/.test(each.src));
    expect(composites.length).toBe(6);
    for (const image of composites) {
      expect(image.tagged).toBe(true);
      expect(image.naturalHeight).toBe(192);
    }
    await saveScreenshot("compose-after-part-deleted");
    const check = await vaultCheck("Composed/tri-linked.ink.png");
    measured.checkAfterDelete = check;
    expect(check).toMatchObject({ ok: false, reason: "missing" });
  });

  it("finds a loop, and measures what nesting costs to draw", async function () {
    const result = await browser.executeObsidian(async ({ app }) => {
      const { compose, canvas } = window.inklineTest;
      // Two composites that name each other, as two synced edits can leave.
      const blank = new OffscreenCanvas(48, 192);
      const ref = (symbol: string) => ({ symbol, x: 0, y: 0, scale: 2048 });
      await app.vault.createBinary(
        "Composed/loop-a.ink.png",
        (await compose.versionTwoFile(blank, { strokes: [], parts: [ref("Composed/loop-b.ink.png")] })).slice().buffer,
      );
      await app.vault.createBinary(
        "Composed/loop-b.ink.png",
        (await compose.versionTwoFile(blank, { strokes: [], parts: [ref("Composed/loop-a.ink.png")] })).slice().buffer,
      );
      // Drawing nested triangles: 3^depth uses of a five-stroke part, each
      // on a layer of its own.
      const mark = await canvas.saveInk(compose.markDocument(), undefined);
      const nesting: { depth: number; draws: number; ms: number }[] = [];
      for (let depth = 1; depth <= 6; depth++) {
        const placed = compose
          .nested(depth, mark.width)
          .map((placement) => ({ record: mark.record, placement }));
        const started = performance.now();
        await compose.drawLayered(placed, mark.width);
        nesting.push({
          depth,
          draws: placed.length,
          ms: Math.round(performance.now() - started),
        });
      }
      return nesting;
    });
    measured.nesting = result;
    const loop = await vaultCheck("Composed/loop-a.ink.png");
    measured.loop = loop;
    expect(loop).toMatchObject({ ok: false, reason: "loop" });
    await open("Compose.md", "preview");
    await saveScreenshot("compose-final");
  });
});
