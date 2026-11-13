// Investigation for #167 §4.1, not part of the suite: composing a symbol by a
// fixed layout of boxes, each filled with an existing symbol at half size, in
// real Obsidian with the plugin's code. It builds every layout from synthetic
// parts, as the editor's prototype Compose dialog does, shows the results in
// notes with and without Inkline, revisits round 1's problems under fixed
// boxes (erasers, line widths, traced pictures, small parts, a recorded
// recipe), drives the dialog with the mouse and keyboard, and writes what it
// measures to layouts-<version>.json.

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import { loadModules } from "../support/browser.ts";
import {
  openAtMarker,
  storedDrafts,
  waitForEditor,
  waitForStatus,
} from "../support/editor.ts";
import { outputDirectory } from "../support/harness.ts";
import { saveScreenshot } from "../support/screenshots.ts";

const root = path.resolve(import.meta.dirname, "../../..");
const outputDir = outputDirectory(process.env.E2E_OUTPUT_DIR, root);
const measured: Record<string, unknown> = {};

/** The composites, by file, with what each is, in the order notes show them. */
const composites: readonly (readonly [string, string])[] = [
  ["L-single", "single: sun"],
  ["L-across", "side by side: sun, tower"],
  ["L-stacked", "stacked: sun, wave"],
  ["L-up", "point up: sun; tower, wave"],
  ["L-right", "point right: sun, wave; tower"],
  ["L-down", "point down: sun, tower; wave"],
  ["L-left", "point left: tower; sun, wave"],
  ["L-square", "square: sun, tower; wave, mark"],
  ["M-up", "point up, mark three times"],
  ["E-reorder", "side by side: sun, notch (eraser left)"],
  ["E-clash", "side by side: notchR, notch (erasers meet)"],
  ["B-line", "stacked sun, sun: whole image as the box"],
  ["B-em", "stacked sun, sun: one em as the box"],
  ["B-ink", "stacked sun, sun: the parts' ink as the box, centred"],
  ["B-body", "stacked sun, sun: the parts' top to the baseline"],
  ["B-hook", "stacked sun, hook (descender)"],
  ["W-between", "point up, widths 0.71"],
  ["W-kept", "point up, widths kept"],
  ["T-across", "side by side: two traced pictures"],
  ["T-mixed", "point up: ring; sun, cross"],
  ["N-nested", "point up of three point-ups"],
  ["S-skeleton", "side by side, squeezed tall: points stretched"],
  ["S-picture", "side by side, squeezed tall: as a picture"],
];

const parts = ["sun", "wave", "tower", "mark", "notch", "notchR", "hook", "ring", "cross"];

const inline = composites
  .map(([file, what]) => `${what} ![[Layouts/${file}.ink.png]]`)
  .join(", ");

const note = [
  "# Heading ![[Layouts/L-up.ink.png]] ![[Layouts/L-square.ink.png]] ![[Layouts/N-nested.ink.png]] ![[Parts/sun.ink.png]]",
  "",
  `Parts: ${parts.map((name) => `![[Parts/${name}.ink.png]]`).join(" ")}.`,
  "",
  `${inline}.`,
  "",
].join("\n");

/** Every composite beside its parts, to show at the files' own pixel size. */
const largeGroups: readonly (readonly string[])[] = [
  ["Parts/sun", "Parts/tower", "Parts/wave", "Parts/mark", "Layouts/L-single"],
  ["Layouts/L-across", "Layouts/L-stacked", "Layouts/L-up", "Layouts/L-right"],
  ["Layouts/L-down", "Layouts/L-left", "Layouts/L-square", "Layouts/M-up"],
  ["Layouts/E-reorder", "Layouts/E-clash", "Parts/notchR", "Parts/notch"],
  ["Layouts/B-line", "Layouts/B-em", "Layouts/B-ink", "Layouts/B-body", "Layouts/B-hook"],
  ["Layouts/L-up", "Layouts/W-between", "Layouts/W-kept", "Layouts/N-nested"],
  ["Layouts/T-across", "Layouts/T-mixed", "Layouts/S-skeleton", "Layouts/S-picture"],
];
const large = largeGroups
  .map((group) => `Hx${group.map((file) => `![[${file}.ink.png]]`).join("")}`)
  .join("\n\n");

type Mode = "source" | "preview";

async function open(file: string, mode: Mode): Promise<void> {
  await browser.executeObsidian(
    async ({ app, obsidian }, wanted, chosen) => {
      const found = app.vault.getFileByPath(wanted);
      if (found === null) throw new Error(`no ${wanted}`);
      const leaf = app.workspace.getLeaf(false);
      await leaf.openFile(found, {
        state: { mode: chosen === "preview" ? "preview" : "source", source: false },
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

/** Sets what Symbol size sets, `--inkline-scale`, returning what it was. */
async function symbolScale(value: string | undefined): Promise<string> {
  return browser.execute((wanted) => {
    const style = document.documentElement.style;
    const was = style.getPropertyValue("--inkline-scale");
    if (wanted === undefined) style.removeProperty("--inkline-scale");
    else style.setProperty("--inkline-scale", wanted);
    return was;
  }, value);
}

async function rootSymbols(): Promise<string[]> {
  return browser.executeObsidian(({ app }) =>
    app.vault
      .getFiles()
      .map((file) => file.path)
      .filter((file) => file.endsWith(".ink.png") && !file.includes("/"))
      .sort(),
  );
}

/** Chooses a symbol for a box of the open Compose dialog. */
async function fill(letter: string, part: string): Promise<void> {
  await browser.$(`button[data-inkline-slot="${letter}"]`).click();
  await browser.$(".prompt-input").waitForDisplayed();
  await browser.keys(`Parts/${part}.ink`);
  await browser.pause(150);
  await browser.keys(["Enter"]);
  await browser.waitUntil(
    async () =>
      (await browser.$(`button[data-inkline-slot="${letter}"]`).getText()) ===
      `${letter}: ${part}`,
    { timeoutMsg: `box ${letter} did not take ${part}` },
  );
}

async function composeStatus(text: string): Promise<string> {
  const status = browser.$(".inkline-compose-status");
  let said = "";
  await browser.waitUntil(
    async () => {
      said = await status.getText();
      return said.includes(text);
    },
    { timeoutMsg: `the dialog did not say "${text}"` },
  );
  return said;
}

async function chooseLayout(name: string): Promise<void> {
  await browser.$(`.inkline-compose-layout[data-layout="${name}"]`).click();
  await browser.waitUntil(async () =>
    (await browser.$(`.inkline-compose-layout[data-layout="${name}"]`).getAttribute("aria-checked")) === "true",
  );
}

/** Pixels of a saved symbol against a scripted one, and their records. */
async function againstScripted(file: string, scripted: string) {
  return browser.executeObsidian(
    async ({ app }, mine, theirs) => {
      const { canvas, layoutScene, compose } = window.inklineTest;
      const read = async (name: string) => {
        const found = app.vault.getFileByPath(name);
        if (found === null) throw new Error(`no ${name}`);
        return canvas.openInk(new Uint8Array(await app.vault.readBinary(found)));
      };
      const a = await read(mine);
      const b = await read(theirs);
      if (a.kind !== "editable" || b.kind !== "editable") {
        return { kinds: [a.kind, b.kind] };
      }
      const width = Math.max(a.width, b.width);
      const one = layoutScene.composeDraw.drawRecord(a.document, a.base, width);
      const two = layoutScene.composeDraw.drawRecord(b.document, b.base, width);
      return {
        kinds: [a.kind, b.kind],
        strokes: [a.document.strokes.length, b.document.strokes.length],
        bases: [a.document.base !== undefined, b.document.base !== undefined],
        widths: [a.width, b.width],
        sameRecord:
          JSON.stringify(a.document.strokes) === JSON.stringify(b.document.strokes),
        pixels: compose.difference(one, two),
      };
    },
    file,
    scripted,
  );
}

describe("Composing symbols by layout (#167 §4.1)", function () {
  before(async function () {
    await loadModules();
    const scene = await browser.executeObsidian(
      async ({ app }, text, big, names) => {
        const { canvas, inkFile, png, compose, layoutScene } = window.inklineTest;
        const write = async (file: string, bytes: Uint8Array) => {
          const folder = file.slice(0, file.lastIndexOf("/"));
          if (app.vault.getFolderByPath(folder) === null) {
            await app.vault.createFolder(folder);
          }
          await app.vault.createBinary(file, bytes.slice().buffer);
        };
        type Drawn = Parameters<typeof layoutScene.build>[1][number];
        const opened = new Map<string, Drawn>();
        const files = new Map<string, Uint8Array>();
        const open = async (name: string, bytes: Uint8Array) => {
          files.set(name, bytes);
          const ink = await canvas.openInk(bytes);
          if (ink.kind !== "editable") throw new Error(`${name}: ${ink.kind}`);
          opened.set(
            name,
            layoutScene.composeDraw.measured({
              record: ink.document,
              width: ink.width,
              ...(ink.base === undefined ? {} : { base: ink.base }),
            }),
          );
        };

        // The parts, saved as Inkline saves, then opened as Copy from opens.
        const documents = { ...layoutScene.partDocuments(), mark: compose.markDocument() };
        for (const [name, document] of Object.entries(documents)) {
          const saved = await canvas.saveInk(document, undefined);
          await write(`Parts/${name}.ink.png`, saved.bytes);
          await open(name, saved.bytes);
        }
        for (const kind of ["ring", "cross"] as const) {
          const traced = await canvas.baseFromPicture(await layoutScene.picture(kind));
          const saved = await canvas.saveInk({ strokes: [], base: traced.layer }, traced.drawable);
          await write(`Parts/${kind}.ink.png`, saved.bytes);
          await open(kind, saved.bytes);
        }
        const part = (name: string): Drawn => {
          const found = opened.get(name);
          if (found === undefined) throw new Error(`no part ${name}`);
          return found;
        };
        const partWidths = Object.fromEntries(
          [...opened].map(([name, each]) => [name, { width: each.width, rows: each.rows }]),
        );

        // The composites.
        const built: Record<string, unknown> = {};
        const save = async (
          file: string,
          made: Awaited<ReturnType<typeof layoutScene.build>>,
        ) => {
          const saved = await canvas.saveInk(made.record, made.base);
          await write(`Layouts/${file}.ink.png`, saved.bytes);
          await open(file, saved.bytes);
          const extent = layoutScene.inkExtent(
            made.record,
            made.base,
            made.width,
          );
          built[file] = {
            width: saved.width,
            strokes: saved.record.strokes.length,
            base: saved.record.base !== undefined,
            bytes: saved.bytes.length,
            order: made.order,
            natural: made.natural,
            chosen: made.chosen,
            tried: made.tried,
            mergedBases: made.mergedBases,
            band: made.band,
            ink: extent,
            sizes: saved.record.strokes.map((stroke) => stroke.size ?? null),
            withBases: made.withBases,
          };
        };
        const b = layoutScene.build;
        const [sun, tower, wave, mark] = ["sun", "tower", "wave", "mark"].map(part);
        if (sun === undefined || tower === undefined || wave === undefined || mark === undefined) {
          throw new Error("missing parts");
        }
        await save("L-single", await b("single", [sun]));
        await save("L-across", await b("across", [sun, tower]));
        await save("L-stacked", await b("stacked", [sun, wave]));
        await save("L-up", await b("point-up", [sun, tower, wave]));
        // Slots are A, B, C, in the layout's order: B is the lone part.
        await save("L-right", await b("point-right", [sun, tower, wave]));
        await save("L-down", await b("point-down", [sun, tower, wave]));
        await save("L-left", await b("point-left", [sun, tower, wave]));
        await save("L-square", await b("square", [sun, tower, wave, mark]));
        await save("M-up", await b("point-up", [mark, mark, mark]));
        await save("E-reorder", await b("across", [sun, part("notch")]));
        await save("E-clash", await b("across", [part("notchR"), part("notch")]));
        await save("B-line", await b("stacked", [sun, sun], "scaled", "line"));
        await save("B-em", await b("stacked", [sun, sun], "scaled", "em"));
        await save("B-ink", await b("stacked", [sun, sun], "scaled", "ink"));
        await save("B-body", await b("stacked", [sun, sun], "scaled", "body"));
        await save("B-hook", await b("stacked", [sun, part("hook")]));
        await save("W-between", await b("point-up", [sun, tower, wave], "between"));
        await save("W-kept", await b("point-up", [sun, tower, wave], "kept"));
        await save("T-across", await b("across", [part("ring"), part("cross")]));
        await save("T-mixed", await b("point-up", [part("ring"), sun, part("cross")]));
        const nestedPart = part("L-up");
        await save("N-nested", await b("point-up", [nestedPart, nestedPart, nestedPart]));

        // What trying every order costs: four parts whose erasers reach
        // each other try all 24; an ordinary square tries one.
        const timed = async (list: Drawn[]) => {
          const started = performance.now();
          const made = await b("square", list);
          return {
            ms: Math.round((performance.now() - started) * 10) / 10,
            tried: made.tried,
            lost: made.chosen.lost,
          };
        };
        const clash = [part("notchR"), part("notch"), part("notchR"), part("notch")];
        const timings = {
          ordinary: await timed([sun, tower, wave, mark]),
          clash: await timed(clash),
          clashAgain: await timed(clash),
        };

        // Squeezed tall: side by side, each half as wide and as tall as it is.
        const { layouts: lay, composeDraw } = layoutScene;
        const across = lay.arrange(lay.layoutNamed("across"), [sun, tower]);
        const skeleton = {
          strokes: across.placements.flatMap((placement, index) =>
            ([sun, tower][index]?.record.strokes ?? []).map((stroke) =>
              lay.placeStroke(stroke, { x: placement.x, y: 0, scale: 0.5 }, "scaled", { x: 1, y: 2 }),
            ),
          ),
        };
        const skeletonFile = await canvas.saveInk(skeleton, undefined);
        await write("Layouts/S-skeleton.ink.png", skeletonFile.bytes);
        const pictureCanvas = new OffscreenCanvas(Math.ceil(across.width) + 64, 192);
        const context = pictureCanvas.getContext("2d");
        if (context === null) throw new Error("no context");
        for (const [index, placement] of across.placements.entries()) {
          const layer = new OffscreenCanvas(pictureCanvas.width, 192);
          const layerContext = layer.getContext("2d");
          if (layerContext === null) throw new Error("no context");
          layerContext.setTransform(0.5, 0, 0, 1, placement.x + 32, 0);
          window.inklineTest.render.drawInk(layerContext, [sun, tower][index]?.record.strokes ?? [], undefined);
          context.drawImage(layer, 0, 0);
        }
        const flat = await compose.flattened(pictureCanvas);
        const pictureFile = await canvas.saveInk(
          { strokes: [], base: { ...flat.document.base!, x: -32 * 16 } },
          { ...flat.base, x: -32 * 16 },
        );
        await write("Layouts/S-picture.ink.png", pictureFile.bytes);
        const stretch = {
          tower: layoutScene.stretched(tower),
          sun: layoutScene.stretched(sun),
        };
        void composeDraw;

        // A recipe in a version-1 record, as a field a later revision could
        // add without a new version: 0.9.3 must read the record, ignore it,
        // and drop it on saving again.
        const withRecord = async (
          bytes: Uint8Array,
          version: number,
          record: unknown,
        ) => {
          const textBytes = new TextEncoder().encode(JSON.stringify(record));
          const compressed = await png.deflate(textBytes);
          const data = new Uint8Array(4 + compressed.length);
          new DataView(data.buffer).setUint32(0, version);
          data.set(compressed, 4);
          const chunks = png
            .readChunks(bytes)
            .filter((chunk) => chunk.type !== inkFile.recordChunkType);
          const [header, ...rest] = chunks;
          if (header === undefined) throw new Error("no header");
          return png.writeChunks([header, { type: inkFile.recordChunkType, data }, ...rest]);
        };
        const upBytes = files.get("L-up");
        if (upBytes === undefined) throw new Error("no L-up");
        const upRecord = (await compose.recordChunkOf(upBytes))?.record as Record<string, unknown>;
        const recipe = {
          layout: "point-up",
          parts: ["Parts/sun.ink.png", "Parts/tower.ink.png", "Parts/wave.ink.png"],
          weight: "scaled",
        };
        const recipeBytes = await withRecord(upBytes, 1, { ...upRecord, composed: recipe });
        await write("Layouts/L-up-recipe.ink.png", recipeBytes);
        const recipeOpened = await canvas.openInk(recipeBytes);
        let recipeAfterSave: unknown = "not opened";
        let recipeSameStrokes = false;
        if (recipeOpened.kind === "editable") {
          recipeSameStrokes =
            JSON.stringify(recipeOpened.document.strokes) === JSON.stringify(upRecord.strokes);
          const again = await canvas.saveInk(recipeOpened.document, recipeOpened.base, recipeOpened.carried);
          recipeAfterSave = (await compose.recordChunkOf(again.bytes))?.record;
        }
        const versionTwo = await withRecord(upBytes, 2, {
          strokes: [],
          layout: "point-up",
          parts: recipe.parts.map((symbol) => ({ symbol })),
          weight: "scaled",
        });
        await write("Layouts/L-up-v2.ink.png", versionTwo);
        const v2Opened = await canvas.openInk(versionTwo);

        await app.vault.create("Layouts.md", text);
        await app.vault.create("Large.md", big);
        return {
          partWidths,
          timings,
          built,
          stretch: {
            tower: {
              differing: stretch.tower.differing,
              lost: stretch.tower.lost,
              skeletonInk: stretch.tower.skeletonInk,
              pictureInk: stretch.tower.pictureInk,
            },
            sun: {
              differing: stretch.sun.differing,
              lost: stretch.sun.lost,
              skeletonInk: stretch.sun.skeletonInk,
              pictureInk: stretch.sun.pictureInk,
            },
            skeletonWidth: skeletonFile.width,
            pictureWidth: pictureFile.width,
          },
          recipe: {
            opened: recipeOpened.kind,
            sameStrokes: recipeSameStrokes,
            keysAfterSave:
              typeof recipeAfterSave === "object" && recipeAfterSave !== null
                ? Object.keys(recipeAfterSave)
                : recipeAfterSave,
          },
          versionTwo: v2Opened,
          names,
        };
      },
      note,
      large,
      parts,
    );
    measured.scene = scene;
  });

  after(async function () {
    const version = `${browser.getObsidianVersion()}-${browser.getObsidianInstallerVersion()}`;
    await writeFile(
      path.join(outputDir, `layouts-${version}.json`),
      `${JSON.stringify(measured, null, 2)}\n`,
    );
  });

  it("composes every layout as an ordinary version-1 symbol", function () {
    const scene = measured.scene as {
      built: Record<string, { strokes: number; base: boolean; natural: { lost: number }; chosen: { differing: number; lost: number }; mergedBases: number }>;
      recipe: { opened: string; keysAfterSave: unknown; sameStrokes: boolean };
      versionTwo: { kind: string };
    };
    expect(Object.keys(scene.built)).toHaveLength(21);
    expect(scene.built["L-up"]?.strokes).toBe(6);
    expect(scene.built["L-square"]?.strokes).toBe(11);
    // The notch's eraser reaches the sun in the usual order, not in another.
    expect(scene.built["E-reorder"]?.natural.lost).toBeGreaterThan(0);
    expect(scene.built["E-reorder"]?.chosen.differing).toBe(0);
    // Two erasers reaching each other: no order helps.
    expect(scene.built["E-clash"]?.chosen.lost).toBeGreaterThan(0);
    expect(scene.built["T-across"]).toMatchObject({ base: true, strokes: 0, mergedBases: 2 });
    expect(scene.built["T-mixed"]).toMatchObject({ base: true, strokes: 2, mergedBases: 2 });
    expect(scene.recipe.opened).toBe("editable");
    expect(scene.recipe.sameStrokes).toBe(true);
    expect(scene.recipe.keysAfterSave).toEqual(["strokes"]);
    expect(scene.versionTwo.kind).toBe("newer-version");
  });

  for (const mode of ["preview", "source"] as const) {
    const name = mode === "preview" ? "Reading view" : "Live Preview";
    it(`shows every composite as a symbol in ${name}, in both themes`, async function () {
      await open("Layouts.md", mode);
      const count = 4 + parts.length + composites.length;
      await browser.waitUntil(
        async () => {
          const all = await shown(images(mode));
          return all.filter((each) => each.tagged && each.complete).length === count;
        },
        { timeoutMsg: "symbols were not all tagged" },
      );
      const all = (await shown(images(mode))).filter((each) => each.tagged);
      measured[`shown-${mode}`] = all.map(({ src, height, width, drop, fontSize }) => ({
        src: src.slice(src.lastIndexOf("/") + 1, src.indexOf("?") === -1 ? undefined : src.indexOf("?")),
        height,
        width,
        drop,
        fontSize,
      }));
      for (const image of all) {
        expect(Math.abs(image.height - 1.5 * image.fontSize)).toBeLessThanOrEqual(1);
        expect(Math.abs(image.drop - 0.375 * image.fontSize)).toBeLessThanOrEqual(1);
      }
      for (const chosen of ["moonstone", "obsidian"] as const) {
        await theme(chosen);
        await saveScreenshot(`layouts-${mode}-${chosen}`);
      }
      await theme("moonstone");
    });
  }

  it("shows them at Symbol size 200%, and at the files' own pixels", async function () {
    const was = await symbolScale("2");
    try {
      await open("Layouts.md", "preview");
      await browser.pause(600);
      await saveScreenshot("layouts-preview-200");
      const all = (await shown(images("preview"))).filter((each) => each.tagged);
      measured.at200 = all.slice(3, 6).map(({ height, fontSize }) => ({ height, fontSize }));
      // 1.5 em at 16 px is 24 px; 8 times that is the file's 192 rows.
      await symbolScale("8");
      await open("Large.md", "preview");
      await browser.pause(800);
      for (const chosen of ["moonstone", "obsidian"] as const) {
        await theme(chosen);
        await saveScreenshot(`layouts-large-${chosen}`);
        const paragraphs = await browser.$$(
          ".workspace-leaf.mod-active .markdown-reading-view p",
        );
        let index = 0;
        for (const paragraph of paragraphs) {
          await paragraph.scrollIntoView();
          await browser.pause(200);
          await saveScreenshot(
            `layouts-large-${chosen}-${String(index)}`,
            paragraph as unknown as ReturnType<typeof browser.$>,
          );
          index++;
        }
      }
      await theme("moonstone");
      const big = (await shown(images("preview"))).filter((each) => each.tagged);
      measured.large = big.map(({ height, naturalHeight }) => ({ height, naturalHeight }));
    } finally {
      await symbolScale(was === "" ? undefined : was);
    }
  });

  it("composes in the editor's dialog, and saves what the script made", async function () {
    await openAtMarker("Editor.md", "HERE");
    const before = await rootSymbols();
    await browser.executeObsidianCommand("inkline:insert-symbol");
    await waitForEditor();
    await saveScreenshot("layouts-ui-toolbar");
    await browser.$('button[data-inkline-button="compose"]').click();
    await browser.$(".inkline-compose").waitForDisplayed();
    await saveScreenshot("layouts-ui-empty", browser.$(".inkline-compose"));
    await chooseLayout("point-up");
    await fill("A", "sun");
    await fill("B", "tower");
    await fill("C", "wave");
    measured.uiUp = await composeStatus("eraser");
    await saveScreenshot("layouts-ui-point-up", browser.$(".inkline-compose"));
    await browser.$(".inkline-compose-weight").selectByAttribute("value", "kept");
    await browser.pause(300);
    await saveScreenshot("layouts-ui-kept", browser.$(".inkline-compose"));
    await browser.$(".inkline-compose-weight").selectByAttribute("value", "scaled");
    await chooseLayout("square");
    measured.uiSquareEmpty = await composeStatus("Box D is empty");
    await fill("D", "mark");
    await composeStatus("eraser");
    await saveScreenshot("layouts-ui-square", browser.$(".inkline-compose"));
    await chooseLayout("across");
    await fill("B", "notch");
    measured.uiEraser = await composeStatus("so the parts go in as");
    await saveScreenshot("layouts-ui-eraser", browser.$(".inkline-compose"));
    await fill("B", "tower");
    await chooseLayout("point-up");
    await composeStatus("No part's eraser");
    await browser.$('button[data-inkline-compose="put"]').click();
    await browser.$(".inkline-compose").waitForExist({ reverse: true });
    await waitForStatus("Composed:");
    measured.uiEditorStatus = await browser.$(".inkline-status").getText();
    await saveScreenshot("layouts-ui-editor");
    const draftStrokes = async () => (await storedDrafts())[0]?.strokes.length ?? 0;
    await browser.waitUntil(async () => (await draftStrokes()) === 6, { timeoutMsg: "no draft of 6 strokes" });
    await browser.keys(["Control", "z"]);
    await browser.waitUntil(async () => (await draftStrokes()) === 0, { timeoutMsg: "undo left strokes" });
    await browser.keys(["Control", "y"]);
    await browser.waitUntil(async () => (await draftStrokes()) === 6, { timeoutMsg: "redo did not bring them" });
    // Opening the dialog again, by its key, keeps the choices.
    await browser.keys(["l"]);
    await browser.$(".inkline-compose").waitForDisplayed();
    measured.uiReopened = await browser.$('button[data-inkline-slot="B"]').getText();
    await browser.keys(["Escape"]);
    await browser.$(".inkline-compose").waitForExist({ reverse: true });
    await browser.keys(["Control", "Enter"]);
    await browser.$(".inkline-editor").waitForExist({ reverse: true });
    const after = await rootSymbols();
    const made = after.filter((file) => !before.includes(file));
    expect(made).toHaveLength(1);
    const compared = await againstScripted(made[0] ?? "", "Layouts/L-up.ink.png");
    measured.uiSaved = { file: made[0], ...compared };
    expect(compared).toMatchObject({ kinds: ["editable", "editable"], sameRecord: true });
  });

  it("composes two traced parts in the dialog into one picture layer", async function () {
    await open("Editor.md", "source");
    const before = await rootSymbols();
    await browser.executeObsidianCommand("inkline:insert-symbol");
    await waitForEditor();
    await browser.$('button[data-inkline-button="compose"]').click();
    await browser.$(".inkline-compose").waitForDisplayed();
    measured.uiFresh = await browser.$('button[data-inkline-slot="A"]').getText();
    await chooseLayout("across");
    await fill("A", "ring");
    await fill("B", "cross");
    measured.uiTraced = await composeStatus("share one picture layer");
    await saveScreenshot("layouts-ui-traced", browser.$(".inkline-compose"));
    await browser.$('button[data-inkline-compose="put"]').click();
    await browser.$(".inkline-compose").waitForExist({ reverse: true });
    await waitForStatus("Composed:");
    await saveScreenshot("layouts-ui-traced-editor");
    await browser.keys(["Control", "Enter"]);
    await browser.$(".inkline-editor").waitForExist({ reverse: true });
    const made = (await rootSymbols()).filter((file) => !before.includes(file));
    expect(made).toHaveLength(1);
    const compared = await againstScripted(made[0] ?? "", "Layouts/T-across.ink.png");
    measured.uiTracedSaved = { file: made[0], ...compared };
    expect(compared).toMatchObject({ bases: [true, true] });
    await open("Editor.md", "preview");
    await browser.pause(500);
    await saveScreenshot("layouts-ui-note");
  });

  it("shows every composite as the picture it is without Inkline", async function () {
    await obsidianPage.disablePlugin("inkline");
    try {
      await open("Layouts.md", "preview");
      await browser.waitUntil(async () => {
        const all = await shown(images("preview"));
        return all.length > 0 && all.every((each) => each.complete);
      });
      const all = await shown(images("preview"));
      measured.withoutInkline = {
        count: all.length,
        tagged: all.filter((each) => each.tagged).length,
        heights: [...new Set(all.map((each) => each.naturalHeight))],
      };
      for (const image of all) expect(image.tagged).toBe(false);
      await saveScreenshot("layouts-without-inkline");
      await theme("obsidian");
      await saveScreenshot("layouts-without-inkline-dark");
      await theme("moonstone");
    } finally {
      await obsidianPage.enablePlugin("inkline");
      await loadModules();
    }
  });
});
