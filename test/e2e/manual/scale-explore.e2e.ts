// Investigation for #167 §2, "Option to scale inks relative to font size".
// Not part of the suite, and not a regression test: it records what real
// Obsidian does with symbols shown larger than the text, for a report.
//
// It needs the prototype change on the explore-scale branch that lets the
// Symbol size setting go up to 800% (0.9.2 stops at 200%). What it does:
//
// - Draws an invented sign as dense as a complex CJK character, of fine
//   strokes (dense-glyph.ts), and saves it through Inkline's own save.
// - At 100, 200, 300, 500, and 800%, in Reading view and Live Preview,
//   measures each symbol's size and baseline, the line spacing of the
//   paragraph around it, what a symbol wider than the line does, and how far
//   the sign's lattice of six fine strokes can be told apart on the screen.
// - Repeats the lattice measure at a zoom factor of 2, as on a display of 2
//   device pixels per CSS pixel, where the 192-pixel image is enlarged.
// - Tries a size per note with no change to Inkline: Obsidian's `cssclasses`
//   property and a CSS snippet that sets `--inkline-scale`.
// - Tries Obsidian's size syntax per embed: `|120`, `|120x120`, `|x120`.
// - Looks at the type-to-insert list at 500%.
// - Turns Inkline off and measures what is left.
// - Exports PDFs at 500%, and of the note with the per-note class.
//
// bash docker-run.sh <dir> --spec test/e2e/manual/scale-explore.e2e.ts

import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { browser } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import { loadModules } from "../support/browser.ts";
import { openAtMarker } from "../support/editor.ts";
import { outputDirectory } from "../support/harness.ts";
import { saveScreenshot } from "../support/screenshots.ts";
import {
  denseStrokes,
  fineLattice,
  fineStrokes,
  lattice,
  wideStrokes,
  widerStrokes,
} from "./dense-glyph.ts";

const output = outputDirectory(
  process.env.E2E_OUTPUT_DIR,
  path.resolve(import.meta.dirname, "../../.."),
);

function run(): string {
  return `${browser.getObsidianVersion()}-${browser.getObsidianInstallerVersion()}`;
}

const results: Record<string, unknown> = {};

async function record(key: string, value: unknown): Promise<void> {
  results[key] = value;
  const folder = path.join(output, "screenshots", run());
  await mkdir(folder, { recursive: true });
  await writeFile(
    path.join(folder, "scale-results.json"),
    JSON.stringify(results, null, 2),
  );
  console.log(`[scale] ${key}: ${JSON.stringify(value)}`);
}

const words =
  "Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega.";

const scaleNote = [
  "Title line without symbols.",
  "",
  `${words} ${words} Here is the sign ![[Glyphs/dense.ink.png]] in running text. ${words} ${words}`,
  "",
  "# Heading ![[Glyphs/dense.ink.png]] sign",
  "",
  "Wide before ![[Glyphs/wide.ink.png]] wide after.",
  "",
  "Width 120 ![[Glyphs/dense.ink.png|120]] then 120x120 ![[Glyphs/dense.ink.png|120x120]] then x120 ![[Glyphs/dense.ink.png|x120]] end.",
  "",
].join("\n");

const bigNote = [
  "---",
  "cssclasses: inkline-big",
  "---",
  "Title line without symbols.",
  "",
  `${words} Here is the sign ![[Glyphs/dense.ink.png]] in running text. ${words}`,
  "",
  "Width 120 ![[Glyphs/dense.ink.png|120]] stays as written.",
  "",
].join("\n");

const fineNote = [
  "Title line without symbols.",
  "",
  `${words} The finest grille ![[Glyphs/fine.ink.png]] in running text. ${words}`,
  "",
  "Wider before ![[Glyphs/wider.ink.png]] wider after.",
  "",
].join("\n");

const snippet = `/* Per-note symbol size for notes with cssclasses: inkline-big. */
.inkline-big {
  --inkline-scale: 4;
}
`;

type Mode = "source" | "preview";

/** Opens `file` in the active leaf, in Live Preview or Reading view. */
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
      // Scrolled to the top, so that the first lines are in view.
      leaf.view.currentMode.applyScroll(0);
    },
    file,
    mode,
  );
  await browser.pause(400);
}

function container(mode: Mode): string {
  return mode === "source"
    ? ".workspace-leaf.mod-active .markdown-source-view"
    : ".workspace-leaf.mod-active .markdown-reading-view";
}

/** The images of `Glyphs/` symbols in `root`, in document order. */
function glyphImages(root: string): string {
  return `${root} img[src*="Glyphs/"]:not(.cm-widgetBuffer)`;
}

interface Measured {
  file: string;
  alt: string | null;
  width: string | null;
  height: string | null;
  tagged: boolean;
  complete: boolean;
  naturalWidth: number;
  naturalHeight: number;
  shownWidth: number;
  shownHeight: number;
  /** How far the image's bottom lies below its line's baseline. */
  drop: number;
  fontSize: number;
  scaleProperty: string;
  /** How far the image reaches past the right edge of its block. */
  overflow: number;
  /** Its shown width over height, against its own. */
  aspect: number;
  naturalAspect: number;
  /** Bottoms of the lines of text in its block, from the block's top. */
  lineBottoms: number[];
  blockHeight: number;
}

async function measure(root: string): Promise<Measured[]> {
  return browser.execute((selector) => {
    return Array.from(activeDocument.querySelectorAll(selector)).map((node) => {
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
      const block =
        node.closest("p, h1, h2, .cm-line, li, td") ?? node.parentElement;
      const blockRect = block?.getBoundingClientRect();
      const bottoms: number[] = [];
      if (block !== null) {
        const walker = activeDocument.createTreeWalker(
          block,
          NodeFilter.SHOW_TEXT,
        );
        for (let text = walker.nextNode(); text; text = walker.nextNode()) {
          if ((text.textContent ?? "").trim() === "") continue;
          const range = activeDocument.createRange();
          range.selectNodeContents(text);
          for (const each of Array.from(range.getClientRects())) {
            const bottom = Math.round(each.bottom - (blockRect?.top ?? 0));
            if (!bottoms.some((seen) => Math.abs(seen - bottom) <= 2)) {
              bottoms.push(bottom);
            }
          }
        }
      }
      bottoms.sort((a, b) => a - b);
      const src = node.src.split(/[?#]/, 1)[0] ?? "";
      return {
        file: decodeURIComponent(src.slice(src.lastIndexOf("/") + 1)),
        alt: node.getAttribute("alt"),
        width: node.getAttribute("width"),
        height: node.getAttribute("height"),
        tagged: node.classList.contains("inkline-symbol"),
        complete: node.complete,
        naturalWidth: node.naturalWidth,
        naturalHeight: node.naturalHeight,
        shownWidth: Math.round(rect.width * 100) / 100,
        shownHeight: Math.round(rect.height * 100) / 100,
        drop: Math.round((rect.bottom - baseline) * 100) / 100,
        fontSize: Number.parseFloat(getComputedStyle(node).fontSize),
        scaleProperty: getComputedStyle(node)
          .getPropertyValue("--inkline-scale")
          .trim(),
        overflow: Math.round(rect.right - (blockRect?.right ?? rect.right)),
        aspect: Math.round((rect.width / rect.height) * 1000) / 1000,
        naturalAspect:
          Math.round((node.naturalWidth / node.naturalHeight) * 1000) / 1000,
        lineBottoms: bottoms,
        blockHeight: Math.round(blockRect?.height ?? 0),
      };
    });
  }, glyphImages(root));
}

async function waitForImages(root: string, count: number): Promise<void> {
  await browser.waitUntil(
    async () => {
      const all = await measure(root);
      return all.length >= count && all.every((image) => image.complete);
    },
    { timeoutMsg: `fewer than ${String(count)} loaded images in ${root}` },
  );
}

interface Lattice {
  devicePixelRatio: number;
  shot: { width: number; height: number };
  /** Ink coverage on the lattice's strokes, less that in its gaps: 1 is sharp. */
  contrast: number;
  /** Strokes told apart along the column, of the six there. */
  resolved: number;
  profile: number[];
}

/** Where a lattice's strokes and gaps lie, in line-box pixels. */
interface LatticeSpec {
  readonly column: number;
  readonly lines: readonly number[];
  readonly gaps: readonly number[];
}

const denseLattice: LatticeSpec = {
  column: lattice.column,
  lines: [...lattice.lines],
  gaps: [...lattice.gaps],
};

/**
 * How well a lattice of fine strokes shows in the `index`th glyph image of
 * `root`: from a screenshot of the window, in device pixels, cut to the
 * image's box, which also holds at a zoom factor other than 1, where an
 * element's own screenshot is cut from the wrong place.
 */
async function latticeOf(
  root: string,
  index: number,
  crop: number,
  name: string,
  spec: LatticeSpec = denseLattice,
): Promise<Lattice> {
  const all = await browser.$$(glyphImages(root)).getElements();
  const element = all[index];
  if (element === undefined) throw new Error(`no image ${String(index)}`);
  await element.scrollIntoView({ block: "center" });
  await browser.pause(300);
  const shot = await browser.takeScreenshot();
  const measured = await browser.execute(
    async (png, selector, at, left, wanted) => {
      const image = activeDocument.querySelectorAll(selector)[at];
      if (!image?.instanceOf(HTMLImageElement)) throw new Error("no image");
      const probe = new OffscreenCanvas(1, 1).getContext("2d");
      if (probe === null) throw new Error("no 2D context");
      probe.fillStyle = getComputedStyle(image).color;
      probe.fillRect(0, 0, 1, 1);
      const [r = 0, g = 0, b = 0] = probe.getImageData(0, 0, 1, 1).data;
      const ink = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes]));
      const ratio = bitmap.width / window.innerWidth;
      const rect = image.getBoundingClientRect();
      const cut = {
        x: Math.round(rect.left * ratio),
        y: Math.round(rect.top * ratio),
        width: Math.max(1, Math.round(rect.width * ratio)),
        height: Math.max(1, Math.round(rect.height * ratio)),
      };
      const canvas = new OffscreenCanvas(cut.width, cut.height);
      const context = canvas.getContext("2d");
      if (context === null) throw new Error("no 2D context");
      context.drawImage(
        bitmap,
        cut.x,
        cut.y,
        cut.width,
        cut.height,
        0,
        0,
        cut.width,
        cut.height,
      );
      bitmap.close();
      const { data, width, height } =
        window.inklineTest.canvas.readPixels(canvas);
      const blob = await canvas.convertToBlob({ type: "image/png" });
      const cropped = new Uint8Array(await blob.arrayBuffer());
      let text = "";
      for (const byte of cropped) text += String.fromCharCode(byte);
      const lum = (x: number, y: number): number => {
        const i = (y * width + x) * 4;
        return (
          0.2126 * (data[i] ?? 0) +
          0.7152 * (data[i + 1] ?? 0) +
          0.0722 * (data[i + 2] ?? 0)
        );
      };
      // The top left corner holds no ink: the page shows through.
      const ground = (lum(0, 0) + lum(1, 0) + lum(0, 1) + lum(1, 1)) / 4;
      const cover = (x: number, y: number): number =>
        Math.max(0, Math.min(1, (ground - lum(x, y)) / (ground - ink)));
      const sx = width / image.naturalWidth;
      const sy = height / 192;
      const x0 = Math.floor((wanted.column - 3 - left) * sx);
      const x1 = Math.max(x0 + 1, Math.ceil((wanted.column + 3 - left) * sx));
      const row = (y: number): number => {
        let sum = 0;
        for (let x = x0; x < x1; x++) sum += cover(x, y);
        return sum / (x1 - x0);
      };
      const band = (y: number): number => {
        const from = Math.floor((y - 1) * sy);
        const to = Math.max(from + 1, Math.ceil((y + 1) * sy));
        let sum = 0;
        for (let d = from; d < to; d++) sum += row(Math.min(height - 1, d));
        return sum / (to - from);
      };
      const mean = (values: readonly number[]): number =>
        values.reduce((total, value) => total + value, 0) / values.length;
      const first = (wanted.lines[0] ?? 0) - 6;
      const last = (wanted.lines.at(-1) ?? 0) + 6;
      const profile: number[] = [];
      for (
        let d = Math.floor(first * sy);
        d <= Math.min(height - 1, Math.ceil(last * sy));
        d++
      ) {
        profile.push(Math.round(row(d) * 100) / 100);
      }
      let resolved = 0;
      let up = false;
      for (const value of profile) {
        if (!up && value > 0.65) {
          up = true;
          resolved++;
        } else if (up && value < 0.35) up = false;
      }
      return {
        devicePixelRatio: window.devicePixelRatio,
        shot: { width, height },
        contrast:
          Math.round(
            (mean(wanted.lines.map(band)) - mean(wanted.gaps.map(band))) * 100,
          ) / 100,
        resolved,
        profile,
        png: btoa(text),
      };
    },
    shot,
    glyphImages(root),
    index,
    crop,
    { column: spec.column, lines: [...spec.lines], gaps: [...spec.gaps] },
  );
  const folder = path.join(output, "screenshots", run());
  await mkdir(folder, { recursive: true });
  await writeFile(
    path.join(folder, `${name}.png`),
    Buffer.from(measured.png, "base64"),
  );
  const { png: _png, ...rest } = measured;
  void _png;
  return rest;
}

/** Sets the Symbol size setting, through Inkline's stored data and a reload. */
async function useScale(percent: number): Promise<string> {
  await browser.executeObsidian(async ({ plugins }, value) => {
    await plugins.inkline.saveData({ symbolScale: value, textColor: true });
  }, percent);
  await obsidianPage.disablePlugin("inkline");
  await obsidianPage.enablePlugin("inkline");
  return browser.execute(() =>
    document.documentElement.style.getPropertyValue("--inkline-scale"),
  );
}

async function theme(name: "moonstone" | "obsidian"): Promise<void> {
  await browser.executeObsidian(({ app }, chosen) => {
    const change: unknown = Reflect.get(app, "changeTheme");
    if (typeof change !== "function") throw new Error("no themes");
    Reflect.apply(change, app, [chosen]);
  }, name);
  await browser.pause(300);
}

/** Sets Electron's zoom factor, which also sets devicePixelRatio. */
async function zoom(factor: number): Promise<number> {
  await browser.execute((wanted) => {
    const electron: unknown = Reflect.get(window, "electron");
    if (typeof electron !== "object" || electron === null) {
      throw new Error("no Electron bridge");
    }
    const frame: unknown = Reflect.get(electron, "webFrame");
    const set: unknown =
      typeof frame === "object" && frame !== null
        ? Reflect.get(frame, "setZoomFactor")
        : undefined;
    if (typeof set === "function") {
      Reflect.apply(set, frame, [wanted]);
      return;
    }
    const remote: unknown = Reflect.get(electron, "remote");
    const current: unknown =
      typeof remote === "object" && remote !== null
        ? Reflect.get(remote, "getCurrentWebContents")
        : undefined;
    if (typeof current !== "function") throw new Error("no zoom");
    const contents: unknown = Reflect.apply(current, remote, []);
    const setOn: unknown =
      typeof contents === "object" && contents !== null
        ? Reflect.get(contents, "setZoomFactor")
        : undefined;
    if (typeof setOn !== "function") throw new Error("no zoom on contents");
    Reflect.apply(setOn, contents, [wanted]);
  }, factor);
  await browser.pause(600);
  return browser.execute(() => window.devicePixelRatio);
}

interface PrintProbe {
  images: {
    tagged: boolean;
    width: number;
    height: number;
    scaleProperty: string;
    classes: string[];
  }[];
  scale: string;
  closed: boolean;
  error?: string;
  restore(): void;
}

declare global {
  interface Window {
    inklineScalePrintProbe?: PrintProbe;
  }
}

/**
 * Redirects the native save dialog and turns off the viewer that export
 * would open, as pdf.e2e.ts does, and records the print document's images.
 */
async function prepareExport(destination: string): Promise<void> {
  await browser.execute((filePath) => {
    const electron: unknown = Reflect.get(window, "electron");
    if (typeof electron !== "object" || electron === null)
      throw new Error("no Electron bridge");
    const remote: unknown = Reflect.get(electron, "remote");
    if (typeof remote !== "object" || remote === null)
      throw new Error("no remote bridge");
    const dialog: unknown = Reflect.get(remote, "dialog");
    if (typeof dialog !== "object" || dialog === null)
      throw new Error("no save dialog");
    const descriptor = Object.getOwnPropertyDescriptor(
      dialog,
      "showSaveDialog",
    );
    if (descriptor === undefined) throw new Error("no save-dialog descriptor");
    Object.defineProperty(dialog, "showSaveDialog", {
      configurable: true,
      writable: true,
      value: () => Promise.resolve({ canceled: false, filePath }),
    });
    const open = window.open.bind(window);
    const observers: MutationObserver[] = [];
    const probe: PrintProbe = {
      images: [],
      scale: "",
      closed: false,
      restore: () => {
        window.open = open;
        Object.defineProperty(dialog, "showSaveDialog", descriptor);
        for (const observer of observers) observer.disconnect();
      },
    };
    window.inklineScalePrintProbe = probe;
    window.open = (...args) => {
      const child = open(...args);
      if (child === null) return child;
      const doc = child.document;
      queueMicrotask(() => {
        try {
          const bridge: unknown = Reflect.get(child, "electron");
          if (typeof bridge !== "object" || bridge === null)
            throw new Error("no export-window bridge");
          const ipc: unknown = Reflect.get(bridge, "ipcRenderer");
          if (typeof ipc !== "object" || ipc === null)
            throw new Error("no export-window IPC");
          const send: unknown = Reflect.get(ipc, "send");
          if (typeof send !== "function") throw new Error("no IPC send");
          Object.defineProperty(ipc, "send", {
            configurable: true,
            value: (channel: unknown, ...rest: unknown[]): void => {
              const options = rest[0];
              if (
                channel === "print-to-pdf" &&
                typeof options === "object" &&
                options !== null
              ) {
                rest[0] = { ...options, open: false };
              }
              Reflect.apply(send, ipc, [channel, ...rest]);
            },
          });
        } catch (error) {
          probe.error = error instanceof Error ? error.message : String(error);
          child.close();
        }
      });
      const capture = () => {
        const images = Array.from(doc.querySelectorAll(".print img"));
        if (images.length === 0) return;
        probe.scale =
          doc.documentElement.style.getPropertyValue("--inkline-scale");
        probe.images = images.map((image) => {
          const rect = image.getBoundingClientRect();
          const classes: string[] = [];
          for (
            let at: Element | null = image.parentElement;
            at !== null;
            at = at.parentElement
          ) {
            if (at.classList.contains("inkline-big")) classes.push(at.tagName);
          }
          return {
            tagged: image.classList.contains("inkline-symbol"),
            width: rect.width,
            height: rect.height,
            scaleProperty: child
              .getComputedStyle(image)
              .getPropertyValue("--inkline-scale")
              .trim(),
            classes,
          };
        });
      };
      const observer = new MutationObserver(capture);
      observers.push(observer);
      observer.observe(doc, {
        subtree: true,
        childList: true,
        attributes: true,
      });
      doc.addEventListener("load", capture, true);
      child.addEventListener(
        "unload",
        () => {
          probe.closed = true;
        },
        { once: true },
      );
      return child;
    };
  }, destination);
}

async function exportPdf(note: string, name: string): Promise<unknown> {
  await obsidianPage.openFile(note);
  await browser.pause(500);
  const folder = path.join(output, "pdfs", run());
  await mkdir(folder, { recursive: true });
  const prefix = path.join(folder, name);
  const pdf = `${prefix}.pdf`;
  await prepareExport(pdf);
  try {
    await browser.executeObsidianCommand("workspace:export-pdf");
    await browser.$(".modal button.mod-cta").waitForDisplayed();
    await browser.$(".modal button.mod-cta").click();
    await browser.waitUntil(
      async () => {
        const error = await browser.execute(
          () => window.inklineScalePrintProbe?.error,
        );
        if (typeof error === "string") throw new Error(error);
        try {
          return (await readFile(pdf)).subarray(0, 5).toString() === "%PDF-";
        } catch {
          return false;
        }
      },
      { timeout: 60_000, timeoutMsg: "no PDF was written" },
    );
    await browser.waitUntil(
      async () =>
        browser.execute(() => window.inklineScalePrintProbe?.closed === true),
      { timeoutMsg: "the export window did not close" },
    );
    const snapshot = await browser.execute(() => {
      const probe = window.inklineScalePrintProbe;
      if (probe === undefined) throw new Error("no print probe");
      return { images: probe.images, scale: probe.scale };
    });
    await writeFile(`${prefix}.json`, JSON.stringify(snapshot, null, 2));
    execFileSync("pdftoppm", ["-r", "96", "-png", pdf, `${prefix}-96dpi`]);
    execFileSync("pdftoppm", ["-r", "300", "-png", pdf, `${prefix}-300dpi`]);
    const images = execFileSync("pdfimages", ["-list", pdf], {
      encoding: "utf8",
    });
    await writeFile(`${prefix}-images.txt`, images);
    const info = execFileSync("pdfinfo", [pdf], { encoding: "utf8" });
    return { snapshot, images, pages: /Pages:\s+(\d+)/.exec(info)?.[1] };
  } finally {
    await browser.execute(() => {
      window.inklineScalePrintProbe?.restore();
      delete window.inklineScalePrintProbe;
    });
  }
}

describe("Symbols shown larger than the text (#167 §2)", function () {
  this.timeout(900_000);
  let crop = 0;
  let fineCrop = 0;

  before(async function () {
    await loadModules();
    const made = await browser.executeObsidian(
      async ({ app }, dense, wide, css, scale, big, extra) => {
        const { canvas } = window.inklineTest;
        const sign = await canvas.saveInk({ strokes: dense }, undefined);
        const bar = await canvas.saveInk({ strokes: wide }, undefined);
        const grille = await canvas.saveInk({ strokes: extra.fine }, undefined);
        const longer = await canvas.saveInk(
          { strokes: extra.wider },
          undefined,
        );
        if (app.vault.getFolderByPath("Glyphs") === null) {
          await app.vault.createFolder("Glyphs");
        }
        await app.vault.createBinary(
          "Glyphs/dense.ink.png",
          sign.bytes.slice().buffer,
        );
        await app.vault.createBinary(
          "Glyphs/wide.ink.png",
          bar.bytes.slice().buffer,
        );
        await app.vault.createBinary(
          "Glyphs/fine.ink.png",
          grille.bytes.slice().buffer,
        );
        await app.vault.createBinary(
          "Glyphs/wider.ink.png",
          longer.bytes.slice().buffer,
        );
        await app.vault.create("Fine.md", extra.note);
        await app.vault.create("FineLink.md", "A link to [[Fine]] here.\n");
        await app.vault.create("Scale.md", scale);
        await app.vault.create("Big.md", big);
        await app.vault.create("Host.md", "Embedded:\n\n![[Big]]\n");
        await app.vault.create("Linked.md", "A link to [[Big]] here.\n");
        await app.vault.create("Typing.md", "Type here: HERE\n");
        // A CSS snippet, turned on as Appearance → CSS snippets does.
        const adapter = app.vault.adapter;
        const folder = `${app.vault.configDir}/snippets`;
        if (!(await adapter.exists(folder))) await adapter.mkdir(folder);
        await adapter.write(`${folder}/inkline-big.css`, css);
        const custom: unknown = Reflect.get(app, "customCss");
        const methods: string[] = [];
        const call = async (name: string, ...args: unknown[]) => {
          if (typeof custom !== "object" || custom === null) return;
          const method: unknown = Reflect.get(custom, name);
          if (typeof method !== "function") return;
          methods.push(name);
          await Reflect.apply(method, custom, args);
        };
        await call("readSnippets");
        await call("setCssEnabledStatus", "inkline-big", true);
        await call("loadSnippets");
        const test = createDiv({ cls: "inkline-big" });
        document.body.append(test);
        const until = Date.now() + 10_000;
        let applied = "";
        while (Date.now() < until) {
          applied = getComputedStyle(test)
            .getPropertyValue("--inkline-scale")
            .trim();
          if (applied === "4") break;
          await new Promise((resolve) => window.setTimeout(resolve, 100));
        }
        test.remove();
        // The stored sign's own lattice, at one pixel per pixel.
        const bitmap = await createImageBitmap(new Blob([sign.bytes.slice()]));
        const { data, width } = window.inklineTest.canvas.readPixels(bitmap);
        bitmap.close();
        return {
          dense: { left: sign.left, width: sign.width },
          wide: { left: bar.left, width: bar.width },
          fine: { left: grille.left, width: grille.width },
          wider: { left: longer.left, width: longer.width },
          denseBytes: sign.bytes.length,
          snippet: { methods, applied },
          alphaAtColumn: [
            28, 34, 40, 46, 52, 58, 64, 70, 76, 82, 88, 94, 100,
          ].map((y) => data[(y * width + (60 - sign.left)) * 4 + 3]),
        };
      },
      denseStrokes(),
      wideStrokes(),
      snippet,
      scaleNote,
      bigNote,
      { fine: fineStrokes(), wider: widerStrokes(), note: fineNote },
    );
    crop = made.dense.left;
    fineCrop = made.fine.left;
    await record("setup", made);
    const bytes = await browser.executeObsidian(async ({ app }) => {
      const file = app.vault.getFileByPath("Glyphs/dense.ink.png");
      if (file === null) throw new Error("no sign");
      const read = new Uint8Array(await app.vault.readBinary(file));
      let text = "";
      for (const byte of read) text += String.fromCharCode(byte);
      return btoa(text);
    });
    const folder = path.join(output, "screenshots", run());
    await mkdir(folder, { recursive: true });
    await writeFile(
      path.join(folder, "dense.ink.png"),
      Buffer.from(bytes, "base64"),
    );
  });

  for (const percent of [100, 200, 300, 500, 800]) {
    it(`shows the sign at ${String(percent)}% in Reading view and Live Preview`, async function () {
      const applied = await useScale(percent);
      const views: Record<string, unknown> = { applied };
      for (const mode of ["preview", "source"] as const) {
        await open("Scale.md", mode);
        const root = container(mode);
        await waitForImages(root, 3);
        const images = await measure(root);
        await saveScreenshot(`scale-${String(percent)}-${mode}`);
        const paragraph = await latticeOf(
          root,
          0,
          crop,
          `dense-${String(percent)}-${mode}-paragraph`,
        );
        const heading = await latticeOf(
          root,
          1,
          crop,
          `dense-${String(percent)}-${mode}-heading`,
        );
        views[mode] = { images, paragraph, heading };
      }
      await record(`scale-${String(percent)}`, views);
    });
  }

  it("shows the sign at 500% in the dark theme", async function () {
    await useScale(500);
    await theme("obsidian");
    try {
      const views: Record<string, unknown> = {};
      for (const mode of ["preview", "source"] as const) {
        await open("Scale.md", mode);
        await waitForImages(container(mode), 3);
        await saveScreenshot(`scale-500-${mode}-dark`);
        views[mode] = await latticeOf(
          container(mode),
          0,
          crop,
          `dense-500-${mode}-dark`,
        );
      }
      await record("dark-500", views);
    } finally {
      await theme("moonstone");
    }
  });

  it("shows the sign on a display of 2 device pixels per CSS pixel", async function () {
    const views: Record<string, unknown> = {};
    try {
      const ratio = await zoom(2);
      views.devicePixelRatio = ratio;
      for (const percent of [100, 300, 500]) {
        await useScale(percent);
        await open("Scale.md", "preview");
        const root = container("preview");
        await waitForImages(root, 3);
        await saveScreenshot(`zoom2-scale-${String(percent)}`);
        views[String(percent)] = {
          paragraph: await latticeOf(
            root,
            0,
            crop,
            `dense-zoom2-${String(percent)}-paragraph`,
          ),
          heading: await latticeOf(
            root,
            1,
            crop,
            `dense-zoom2-${String(percent)}-heading`,
          ),
        };
      }
    } finally {
      views.reset = await zoom(1);
    }
    await record("zoom2", views);
  });

  it("sizes a note's symbols by its cssclasses and a CSS snippet", async function () {
    await useScale(100);
    const views: Record<string, unknown> = {};
    for (const mode of ["preview", "source"] as const) {
      await open("Big.md", mode);
      const root = container(mode);
      await waitForImages(root, 2);
      await saveScreenshot(`per-note-${mode}`);
      views[mode] = {
        images: await measure(root),
        lattice: await latticeOf(root, 0, crop, `dense-per-note-${mode}`),
        classes: await browser.execute(
          (selector) =>
            Array.from(activeDocument.querySelectorAll(selector)).map(
              (each) => each.className,
            ),
          `${root}, ${root} .inkline-big`,
        ),
      };
    }
    // Embedded in another note, and in a hover preview.
    await open("Host.md", "preview");
    await waitForImages(".workspace-leaf.mod-active .markdown-embed", 2);
    views.embedded = await measure(
      ".workspace-leaf.mod-active .markdown-embed",
    );
    await saveScreenshot("per-note-embedded");
    await open("Linked.md", "preview");
    await browser
      .$(".workspace-leaf.mod-active .markdown-reading-view a.internal-link")
      .moveTo();
    try {
      await waitForImages(".hover-popover", 2);
      views.hover = await measure(".hover-popover");
      await saveScreenshot("per-note-hover");
    } catch (error) {
      views.hover = String(error);
    } finally {
      await browser
        .action("pointer", { parameters: { pointerType: "mouse" } })
        .move({ x: 2, y: 2 })
        .perform();
      await browser.pause(800);
    }
    await record("per-note", views);
  });

  it("lists symbols to insert at 500%", async function () {
    await useScale(500);
    await openAtMarker("Typing.md", "HERE");
    for (const key of ";;dens") await browser.keys([key]);
    const picture = ".suggestion-container .inkline-suggestion-picture";
    try {
      await browser.$(picture).waitForDisplayed();
      await browser.pause(300);
      await saveScreenshot("suggest-500");
      await record(
        "suggest-500",
        await browser.execute((selector) => {
          const image = activeDocument.querySelector(selector);
          const list = activeDocument.querySelector(".suggestion-container");
          return {
            picture: image?.getBoundingClientRect().toJSON() as unknown,
            list: list?.getBoundingClientRect().toJSON() as unknown,
            window: { width: window.innerWidth, height: window.innerHeight },
          };
        }, picture),
      );
    } finally {
      await browser.keys(["Escape"]);
    }
  });

  it("leaves pictures at their own size without Inkline", async function () {
    await useScale(500);
    await obsidianPage.disablePlugin("inkline");
    try {
      const views: Record<string, unknown> = {
        scaleProperty: await browser.execute(() =>
          document.documentElement.style.getPropertyValue("--inkline-scale"),
        ),
      };
      for (const [file, mode] of [
        ["Scale.md", "preview"],
        ["Scale.md", "source"],
        ["Big.md", "preview"],
      ] as const) {
        await open(file, mode);
        await waitForImages(container(mode), 2);
        await saveScreenshot(`without-${file.replace(".md", "")}-${mode}`);
        views[`${file}-${mode}`] = await measure(container(mode));
      }
      await record("without-inkline", views);
    } finally {
      await obsidianPage.enablePlugin("inkline");
    }
  });

  it("exports PDFs at 500%, and of the note with its own size", async function () {
    await useScale(500);
    const at500 = await exportPdf("Scale.md", "scale-500");
    await useScale(100);
    const perNote = await exportPdf("Big.md", "per-note");
    await record("pdf", { at500, perNote });
  });

  it("second: the finest grille and a 4,000-pixel symbol at 100 to 500%", async function () {
    const views: Record<string, unknown> = {};
    for (const percent of [100, 200, 300, 500]) {
      await useScale(percent);
      await open("Fine.md", "preview");
      const root = container("preview");
      await waitForImages(root, 2);
      await saveScreenshot(`fine-${String(percent)}`);
      views[String(percent)] = {
        images: await measure(root),
        fine: await latticeOf(
          root,
          0,
          fineCrop,
          `fine-${String(percent)}-paragraph`,
          fineLattice,
        ),
      };
    }
    await record("second-fine", views);
  });

  it("second: on a display of 2 device pixels per CSS pixel", async function () {
    const views: Record<string, unknown> = {};
    try {
      views.devicePixelRatio = await zoom(2);
      for (const percent of [100, 200, 300, 500]) {
        await useScale(percent);
        await open("Scale.md", "preview");
        await waitForImages(container("preview"), 3);
        const dense = await latticeOf(
          container("preview"),
          0,
          crop,
          `zoom2-dense-${String(percent)}`,
        );
        const heading = await latticeOf(
          container("preview"),
          1,
          crop,
          `zoom2-dense-heading-${String(percent)}`,
        );
        await open("Fine.md", "preview");
        await waitForImages(container("preview"), 2);
        const fine = await latticeOf(
          container("preview"),
          0,
          fineCrop,
          `zoom2-fine-${String(percent)}`,
          fineLattice,
        );
        await saveScreenshot(`zoom2-fine-window-${String(percent)}`);
        views[String(percent)] = { dense, heading, fine };
      }
    } finally {
      views.reset = await zoom(1);
    }
    await record("second-zoom2", views);
  });

  it("second: a 4,000-pixel symbol in a hover preview at 100%", async function () {
    await useScale(100);
    await open("FineLink.md", "preview");
    await browser
      .$(".workspace-leaf.mod-active .markdown-reading-view a.internal-link")
      .moveTo();
    try {
      await waitForImages(".hover-popover", 2);
      await browser.pause(300);
      await saveScreenshot("hover-wider-100");
      await record("second-hover", {
        images: await measure(".hover-popover"),
        popover: await browser.execute(
          () =>
            activeDocument
              .querySelector(".hover-popover")
              ?.getBoundingClientRect()
              .toJSON() as unknown,
        ),
      });
    } finally {
      await browser
        .action("pointer", { parameters: { pointerType: "mouse" } })
        .move({ x: 2, y: 2 })
        .perform();
      await browser.pause(800);
    }
  });

  it("second: opens Obsidian's image viewer on a symbol, at 100%", async function () {
    await useScale(100);
    const views: Record<string, unknown> = {};
    for (const mode of ["preview", "source"] as const) {
      await open("Scale.md", mode);
      const root = container(mode);
      await waitForImages(root, 3);
      const all = await browser.$$(glyphImages(root)).getElements();
      const first = all[0];
      if (first === undefined) throw new Error("no sign");
      await first.scrollIntoView({ block: "center" });
      await browser.pause(200);
      // Live Preview selects an image on the first click and opens the
      // viewer on the second.
      const clicks = mode === "source" ? 2 : 1;
      let opened = false;
      for (let click = 0; click < clicks && !opened; click++) {
        await first.click();
        await browser.pause(700);
        opened = await browser.execute(
          () => document.querySelector(".lightbox") !== null,
        );
      }
      const shown = opened
        ? await browser.execute(() => {
            const image = document.querySelector(".lightbox img");
            if (!image?.instanceOf(HTMLImageElement)) return "no image";
            const rect = image.getBoundingClientRect();
            return {
              width: rect.width,
              height: rect.height,
              naturalHeight: image.naturalHeight,
              tagged: image.classList.contains("inkline-symbol"),
              window: { width: window.innerWidth, height: window.innerHeight },
            };
          })
        : "the viewer did not open";
      if (opened) {
        await saveScreenshot(`viewer-${mode}`);
        const lightbox = await browser.$(".lightbox img").getElement();
        const shot = await browser.takeElementScreenshot(lightbox.elementId);
        const folder = path.join(output, "screenshots", run());
        await writeFile(
          path.join(folder, `viewer-${mode}-image.png`),
          Buffer.from(shot, "base64"),
        );
        // Its zoom, if it has one: a click on the picture.
        await lightbox.click();
        await browser.pause(700);
        await saveScreenshot(`viewer-${mode}-zoomed`);
        views[`${mode}-zoomed`] = await browser.execute(() => {
          const image = document.querySelector(".lightbox img");
          return image?.getBoundingClientRect().toJSON() as unknown;
        });
      }
      views[mode] = shown;
      await browser.keys(["Escape"]);
      await browser.pause(400);
      if (
        await browser.execute(
          () => document.querySelector(".lightbox") !== null,
        )
      ) {
        await browser.keys(["Escape"]);
        await browser.pause(400);
      }
    }
    await record("viewer", views);
  });
});
