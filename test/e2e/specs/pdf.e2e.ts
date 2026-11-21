import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import { printWait } from "../../../src/render/print.ts";
import { encodePng } from "../../support/png.ts";
import { loadModules, toBase64 } from "../support/browser.ts";
import { startOver } from "../support/editor.ts";
import { outputDirectory } from "../support/harness.ts";
import { type Box } from "../support/pointer.ts";
import {
  drawnRatio,
  fullWidth,
  wide,
  widePng,
} from "../support/wide-symbol.ts";

interface PrintImage {
  tagged: boolean;
  width: number;
  height: number;
  drop: number | null;
  fontSize: number;
  /** What the renderer gave it: its width over its height, and a size's. */
  ratio: string;
  asked: string;
  /** Whether it is an image of the export window's own, or the main one's. */
  ownWindow: boolean;
}

/** A symbol's image in the print document as Obsidian asks for the PDF. */
interface ImageAtPrint {
  /** Its symbol's name, which the renderer gives it. */
  name: string;
  tagged: boolean;
  /** Whether it shows its print copy, an image of its own address. */
  copy: boolean;
  blob: boolean;
  complete: boolean;
  /** The size of the picture it shows. */
  width: number;
  height: number;
  /** Whether its mask paints it. */
  masked: boolean;
}

interface PrintProbe {
  images: PrintImage[];
  scale: string;
  stored: boolean;
  closed: boolean;
  cleanupChecked: boolean;
  cleaned: boolean;
  /** Whether every image shows its own file again once the window closed. */
  restored: boolean;
  viewerRequests: { filePath: string; requested: boolean }[];
  atPrint: ImageAtPrint[];
  /** Milliseconds from the export window's opening to the print request. */
  waited: number;
  error?: string;
  restore(): void;
}

declare global {
  interface Window {
    inklinePrintProbe?: PrintProbe;
    inklineReadsRestore?: () => void;
  }
}

/** An opaque grey block ending on the baseline of a 64 × 192 symbol. */
function block(): Uint8Array {
  const data = new Uint8Array(64 * 192 * 4);
  for (let y = 48; y < 144; y++) {
    for (let x = 8; x < 56; x++) {
      data.set([126, 126, 126, 255], (y * 64 + x) * 4);
    }
  }
  return encodePng({ width: 64, height: 192, data });
}

/**
 * A 192 × 192 symbol whose ink, an opaque grey square, is the middle third of
 * it both ways: well inside its box, so that what shows along the box's edges
 * is not its ink, and so that the box can be told from the ink alone.
 */
function dot(): Uint8Array {
  const data = new Uint8Array(192 * 192 * 4);
  for (let y = 64; y < 128; y++) {
    for (let x = 64; x < 128; x++) {
      data.set([126, 126, 126, 255], (y * 192 + x) * 4);
    }
  }
  return encodePng({ width: 192, height: 192, data });
}

/**
 * Holds back or fails Obsidian's reads of files, which are how Inkline reads
 * a symbol to make its print copy, as `plan` says for a file's name, or for
 * every symbol's with `*`: "fail" fails the read, and a number of
 * milliseconds holds it back that long. {@link releaseReads} undoes it.
 */
async function holdReads(plan: Record<string, number | "fail">): Promise<void> {
  await browser.executeObsidian(({ app }, chosen) => {
    const { vault } = app;
    const read = vault.readBinary.bind(vault);
    window.inklineReadsRestore = () => {
      vault.readBinary = read;
    };
    vault.readBinary = async (file) => {
      const how =
        chosen[file.name] ??
        (file.name.endsWith(".ink.png") ? chosen["*"] : undefined);
      if (how === "fail") throw new Error("a synthetic failure to read");
      if (how !== undefined) {
        await new Promise((resolve) => window.setTimeout(resolve, how));
      }
      return read(file);
    };
  }, plan);
}

/** Lets Obsidian read files as it did before {@link holdReads}. */
async function releaseReads(): Promise<void> {
  await browser.execute(() => {
    window.inklineReadsRestore?.();
    delete window.inklineReadsRestore;
  });
}

/**
 * Redirects the native save dialog and suppresses the request's post-export
 * viewer flag. The hidden window, Markdown, print styles, IPC, and native PDF
 * writer still run; no PDF is opened in the contributor's external viewer.
 * Observes the print document without changing it, retaining its final layout
 * before the exporter removes it, and checks cleanup after the window closes.
 */
async function prepareExport(destination: string): Promise<void> {
  await browser.execute((filePath) => {
    const electron: unknown = Reflect.get(window, "electron");
    if (typeof electron !== "object" || electron === null)
      throw new Error("no test host Electron bridge");
    const remote: unknown = Reflect.get(electron, "remote");
    if (typeof remote !== "object" || remote === null)
      throw new Error("no test host remote bridge");
    const dialog: unknown = Reflect.get(remote, "dialog");
    if (typeof dialog !== "object" || dialog === null)
      throw new Error("no native save dialog");
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
    const restoreSend: (() => void)[] = [];
    const probe: PrintProbe = {
      images: [],
      scale: "",
      stored: false,
      closed: false,
      cleanupChecked: false,
      cleaned: false,
      restored: false,
      viewerRequests: [],
      atPrint: [],
      waited: -1,
      restore: () => {
        window.open = open;
        Object.defineProperty(dialog, "showSaveDialog", descriptor);
        for (const observer of observers) observer.disconnect();
        for (const restore of restoreSend) restore();
      },
    };
    window.inklinePrintProbe = probe;
    window.open = (...args) => {
      const opened = performance.now();
      const child = open(...args);
      if (child === null) return child;
      const doc = child.document;
      let printed: HTMLImageElement[] = [];
      // What each image shows as Obsidian asks for the PDF, which it prints
      // from the page as it is then.
      const atPrint = () => {
        probe.waited = performance.now() - opened;
        printed = Array.from(doc.querySelectorAll(".print img")).filter(
          (image): image is HTMLImageElement =>
            image.instanceOf(HTMLImageElement),
        );
        probe.atPrint = printed.map((image) => ({
          name: image.getAttribute("aria-label") ?? "",
          tagged: image.classList.contains("inkline-symbol"),
          copy: image.classList.contains("inkline-print-copy"),
          blob: image.src.startsWith("blob:"),
          complete: image.complete,
          width: image.naturalWidth,
          height: image.naturalHeight,
          masked: child.getComputedStyle(image).maskImage !== "none",
        }));
      };
      // The core exporter installs this window's Electron bridge before its
      // first asynchronous rendering step. Intercept only the subsequent
      // print request's viewer flag; the main process writes the actual PDF.
      queueMicrotask(() => {
        try {
          const bridge: unknown = Reflect.get(child, "electron");
          if (typeof bridge !== "object" || bridge === null)
            throw new Error("no export-window Electron bridge");
          const ipc: unknown = Reflect.get(bridge, "ipcRenderer");
          if (typeof ipc !== "object" || ipc === null)
            throw new Error("no export-window IPC");
          const send: unknown = Reflect.get(ipc, "send");
          if (typeof send !== "function") throw new Error("no native IPC send");
          const original = Object.getOwnPropertyDescriptor(ipc, "send");
          Object.defineProperty(ipc, "send", {
            configurable: true,
            value: (channel: unknown, ...args: unknown[]): void => {
              if (channel === "print-to-pdf") {
                const options = args[0];
                if (
                  typeof options !== "object" ||
                  options === null ||
                  Array.isArray(options) ||
                  !("filepath" in options) ||
                  options.filepath !== filePath ||
                  !("open" in options) ||
                  typeof options.open !== "boolean"
                ) {
                  probe.error = "unexpected native PDF request";
                  throw new Error(probe.error);
                }
                probe.viewerRequests.push({
                  filePath,
                  requested: options.open,
                });
                atPrint();
                args[0] = { ...options, open: false };
              }
              Reflect.apply(send, ipc, [channel, ...args]);
            },
          });
          restoreSend.push(() => {
            if (original === undefined) Reflect.deleteProperty(ipc, "send");
            else Object.defineProperty(ipc, "send", original);
          });
        } catch (error) {
          probe.error = error instanceof Error ? error.message : String(error);
          // An unknown host bridge must fail before it can launch a viewer.
          child.close();
        }
      });
      const capture = () => {
        const images = Array.from(doc.querySelectorAll(".print img"));
        if (images.length === 0) return;
        probe.scale =
          doc.documentElement.style.getPropertyValue("--inkline-scale");
        probe.stored = doc.documentElement.classList.contains(
          "inkline-stored-color",
        );
        // The export window's own image class, to tell its images from the
        // main window's.
        const own: unknown = Reflect.get(child, "HTMLImageElement");
        const ownPrototype: unknown =
          typeof own === "function" ? Reflect.get(own, "prototype") : null;
        probe.images = images.map((image) => {
          const rect = image.getBoundingClientRect();
          const inline = image.instanceOf(HTMLElement) ? image.style : null;
          const style = child.getComputedStyle(image);
          const align = Number.parseFloat(style.verticalAlign);
          return {
            tagged: image.classList.contains("inkline-symbol"),
            width: rect.width,
            height: rect.height,
            drop: Number.isFinite(align) ? -align : null,
            fontSize: Number.parseFloat(style.fontSize),
            ratio: inline?.getPropertyValue("--inkline-ratio") ?? "",
            asked: inline?.getPropertyValue("--inkline-width") ?? "",
            ownWindow: Object.getPrototypeOf(image) === ownPrototype,
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
          // Run after all unload listeners, including the renderer's cleanup.
          window.setTimeout(() => {
            probe.cleaned =
              doc.documentElement.style.getPropertyValue("--inkline-scale") ===
                "" &&
              !doc.documentElement.classList.contains("inkline-stored-color");
            probe.restored = printed.every(
              (image) =>
                !image.classList.contains("inkline-print-copy") &&
                !image.src.startsWith("blob:"),
            );
            probe.cleanupChecked = true;
          }, 0);
        },
        { once: true },
      );
      return child;
    };
  }, destination);
}

/** A known fixture word's box in the PDF, in CSS pixels at 96 DPI. */
function wordBox(xml: string, word: string): Box {
  const words =
    /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]+)<\/word>/g;
  for (const match of xml.matchAll(words)) {
    if (match[5] !== word) continue;
    const values = match.slice(1, 5).map((value) => (Number(value) * 96) / 72);
    const [left, top, right, bottom] = values;
    if (
      left === undefined ||
      top === undefined ||
      right === undefined ||
      bottom === undefined ||
      !values.every(Number.isFinite)
    )
      throw new Error(`invalid PDF box for ${word}`);
    return { left, top, right, bottom };
  }
  throw new Error(`no ${word} in the native PDF text`);
}

/**
 * Reads the rasterized PDF between two fixture words. The block's size and
 * bottom are independent evidence of its scale and baseline in the PDF, not
 * merely of the tags or screen layout. Neither word has a descending letter.
 */
async function printedBlock(
  png: string,
  before: Box,
  after: Box,
  height: number,
) {
  return browser.execute(
    async (encoded, first, last, expectedHeight) => {
      const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
      const image = await createImageBitmap(new Blob([bytes]));
      const {
        data,
        width,
        height: pageHeight,
      } = window.inklineTest.canvas.readPixels(image);
      image.close();
      const pixels = (box: Box) => {
        let left = width;
        let right = -1;
        let top = pageHeight;
        let bottom = -1;
        let count = 0;
        let dark = 0;
        let grey = 0;
        for (
          let y = Math.max(0, Math.floor(box.top));
          y < Math.min(pageHeight, Math.ceil(box.bottom));
          y++
        ) {
          for (
            let x = Math.max(0, Math.ceil(box.left));
            x < Math.min(width, Math.floor(box.right));
            x++
          ) {
            const at = (y * width + x) * 4;
            const rgb = [
              data[at] ?? 255,
              data[at + 1] ?? 255,
              data[at + 2] ?? 255,
            ];
            if (!rgb.every((value) => value < 210)) continue;
            left = Math.min(left, x);
            right = Math.max(right, x);
            top = Math.min(top, y);
            bottom = Math.max(bottom, y);
            count++;
            if (rgb.every((value) => value < 60)) dark++;
            if (rgb.every((value) => Math.abs(value - 126) <= 8)) grey++;
          }
        }
        return {
          width: right - left + 1,
          height: bottom - top + 1,
          bottom,
          count,
          dark,
          grey,
        };
      };
      const text = pixels(first);
      return {
        ink: pixels({
          left: first.right + 1,
          right: last.left - 1,
          // Use the actual text pixels' baseline and leave room for a
          // misplaced block, without including the paragraph above it.
          top: text.bottom - expectedHeight / 2 - 6,
          bottom: text.bottom + expectedHeight / 4 + 6,
        }),
        text,
      };
    },
    png,
    before,
    after,
    height,
  );
}

/** Inkline's display settings and Obsidian's theme for one export. */
interface Mode {
  name: string;
  scale: number;
  textColor: boolean;
  theme: string;
}

/** Starts a test from an empty vault, with `mode`'s settings and theme. */
async function startWith(mode: Mode): Promise<void> {
  await startOver();
  await browser.executeObsidian(async ({ plugins, app }, chosen) => {
    await plugins.inkline.saveData({
      symbolScale: chosen.scale,
      textColor: chosen.textColor,
    });
    const change: unknown = Reflect.get(app, "changeTheme");
    if (typeof change !== "function") throw new Error("no themes");
    Reflect.apply(change, app, [chosen.theme]);
  }, mode);
  await obsidianPage.disablePlugin("inkline");
  await obsidianPage.enablePlugin("inkline");
  await loadModules();
}

/**
 * Exports the open note with Obsidian's own command to `<name>.pdf` in the
 * output directory, and returns what the print document showed, the PDF's
 * words with their boxes, and its page rasterized at `dpi`, 96 unless given,
 * all of which stay there beside it.
 */
async function exportPdf(name: string, dpi = 96) {
  const output = outputDirectory(
    process.env.E2E_OUTPUT_DIR,
    path.resolve(import.meta.dirname, "../../.."),
  );
  const folder = path.join(
    output,
    "pdfs",
    `${browser.getObsidianVersion()}-${browser.getObsidianInstallerVersion()}`,
  );
  await mkdir(folder, { recursive: true });
  const prefix = path.join(folder, name);
  const pdf = `${prefix}.pdf`;
  const viewport = await browser.execute(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  await prepareExport(pdf);
  try {
    await browser.executeObsidianCommand("workspace:export-pdf");
    await browser.$(".modal button.mod-cta").waitForDisplayed();
    await browser.$(".modal button.mod-cta").click();
    await browser.waitUntil(
      async () => {
        const error = await browser.execute(
          () => window.inklinePrintProbe?.error,
        );
        if (typeof error === "string") throw new Error(error);
        try {
          return (await readFile(pdf)).subarray(0, 5).toString() === "%PDF-";
        } catch {
          return false;
        }
      },
      // Inkline's print copies can hold the print back by up to printWait.
      { timeout: printWait + 20_000, timeoutMsg: "native PDF was not written" },
    );
    await browser.waitUntil(
      async () =>
        browser.execute(
          () =>
            window.inklinePrintProbe?.closed === true &&
            window.inklinePrintProbe.cleanupChecked,
        ),
      { timeoutMsg: "native export window did not close" },
    );
    await browser.waitUntil(
      async () =>
        browser.execute(
          (before) =>
            window.innerWidth === before.width &&
            window.innerHeight === before.height,
          viewport,
        ),
      { timeoutMsg: "native PDF export left the main window resized" },
    );
    const snapshot = await browser.execute(() => {
      const probe = window.inklinePrintProbe;
      if (probe === undefined) throw new Error("no print probe");
      return {
        images: probe.images,
        scale: probe.scale,
        stored: probe.stored,
        cleaned: probe.cleaned,
        restored: probe.restored,
        viewerRequests: probe.viewerRequests,
        atPrint: probe.atPrint,
        waited: probe.waited,
      };
    });
    await writeFile(`${prefix}.json`, JSON.stringify(snapshot, null, 2));
    execFileSync("pdftoppm", [
      "-singlefile",
      "-r",
      String(dpi),
      "-png",
      pdf,
      prefix,
    ]);
    const xml = execFileSync("pdftotext", ["-bbox", pdf, "-"], {
      encoding: "utf8",
    });
    await writeFile(`${prefix}.xml`, xml);
    const raster = toBase64(new Uint8Array(await readFile(`${prefix}.png`)));
    return { pdf, snapshot, xml, raster };
  } finally {
    await browser.execute(() => {
      window.inklinePrintProbe?.restore();
      delete window.inklinePrintProbe;
    });
  }
}

/**
 * The block of ink in the rasterized PDF between two fixture words' lines,
 * across the page, measured as on the screen: on the page, whose colour is
 * the top row's, under the first word, and in the colour furthest from it.
 */
async function printedWide(png: string, above: Box, below: Box) {
  return browser.execute(
    async (encoded, top, bottom) => {
      const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
      const image = await createImageBitmap(new Blob([bytes]));
      const pixels = window.inklineTest.canvas.readPixels(image);
      image.close();
      const { inkBlock } = window.inklineTest;
      const region = { left: 0, top, right: pixels.width, bottom };
      const ground = inkBlock.commonColour(pixels, {
        ...region,
        bottom: top + 1,
      });
      const ink = inkBlock.furthestColour(pixels, region, ground);
      return {
        page: pixels.width,
        ink: inkBlock.measureBlock(pixels, region, ground, ink) ?? null,
      };
    },
    png,
    // Clear of the words' own pixels.
    above.bottom + 2,
    below.top - 2,
  );
}

/**
 * The line of a numbered list's first item in the rasterized PDF, between two
 * fixture words' lines: where its number's pixels end, which is the line's
 * baseline, and the block of ink after the number, measured as on the screen,
 * on the page's colour and in the colour furthest from it.
 */
async function printedListLine(
  png: string,
  number: Box,
  above: Box,
  below: Box,
) {
  return browser.execute(
    async (encoded, digits, top, bottom) => {
      const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
      const image = await createImageBitmap(new Blob([bytes]));
      const pixels = window.inklineTest.canvas.readPixels(image);
      image.close();
      const { inkBlock } = window.inklineTest;
      const ground = inkBlock.commonColour(pixels, {
        left: 0,
        top,
        right: pixels.width,
        bottom: top + 1,
      });
      // The bottom edge of the number's lowest row that is not the page.
      let numberBottom = -1;
      for (let y = Math.floor(digits.top); y < Math.ceil(digits.bottom); y++) {
        for (
          let x = Math.floor(digits.left);
          x < Math.ceil(digits.right);
          x++
        ) {
          const at = (y * pixels.width + x) * 4;
          const away = [0, 1, 2].some(
            (channel) =>
              Math.abs(
                (pixels.data[at + channel] ?? 0) - (ground[channel] ?? 0),
              ) > 40,
          );
          if (away) numberBottom = Math.max(numberBottom, y + 1);
        }
      }
      // Clear of the number.
      const region = {
        left: Math.ceil(digits.right) + 2,
        top,
        right: pixels.width,
        bottom,
      };
      const ink = inkBlock.furthestColour(pixels, region, ground);
      return {
        number: numberBottom,
        ink: inkBlock.measureBlock(pixels, region, ground, ink) ?? null,
      };
    },
    png,
    number,
    // Clear of the words' own pixels.
    above.bottom + 2,
    below.top - 2,
  );
}

/** One `dot()` symbol as a rasterized PDF shows it. */
interface PrintedDot {
  /**
   * Its ink's square, in the page's pixels, from the right of the line's
   * first word and from the line's baseline, as two exports of a note can
   * place a line differently: Obsidian 1.13.4 put a callout's title two
   * pixels further right in one of them.
   */
  left: number;
  top: number;
  width: number;
  height: number;
  /** The colour at the ink's middle. */
  colour: number[];
  /**
   * For each edge of its box, top, right, bottom, and left, the darkest line
   * of pixels along it, within a pixel of it, away from the box's rounded
   * corners: how far its pixels lie from the page's colour, on average along
   * the line, in the channel furthest from it, 0 to 255. 0 is no line.
   */
  edges: number[];
}

/**
 * The `dot()` symbols in a rasterized page, from left to right, on each line
 * between two fixture words with no descending letters. Each one's box is its
 * ink's square, which is the middle third of it, grown by its own size on
 * every side. Rasterizers have drawn the faint lines of #255 along such boxes'
 * edges, a pixel wide, as an artefact of how Chromium writes a CSS mask into
 * a PDF.
 */
async function printedDots(
  png: string,
  lines: readonly { before: Box; after: Box }[],
  dpi: number,
): Promise<PrintedDot[][]> {
  return browser.execute(
    async (encoded, wanted, resolution) => {
      const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes]));
      const pixels = window.inklineTest.canvas.readPixels(bitmap);
      bitmap.close();
      const { inkBlock } = window.inklineTest;
      const { width, height, data } = pixels;
      const scale = resolution / 96;
      /** How far a pixel lies from `ground`, in its furthest channel. */
      const away = (
        x: number,
        y: number,
        ground: readonly number[],
      ): number => {
        const at = (y * width + x) * 4;
        return Math.max(
          ...[0, 1, 2].map((channel) =>
            Math.abs((data[at + channel] ?? 0) - (ground[channel] ?? 0)),
          ),
        );
      };
      /** The darkest line along an edge at `at`, from `from` to `to`. */
      const darkest = (
        across: boolean,
        at: number,
        from: number,
        to: number,
        ground: readonly number[],
      ): number => {
        let worst = 0;
        for (
          let line = Math.floor(at) - 1;
          line <= Math.floor(at) + 1;
          line++
        ) {
          let sum = 0;
          let count = 0;
          for (let along = Math.ceil(from); along < Math.floor(to); along++) {
            const [x, y] = across ? [along, line] : [line, along];
            if (x < 0 || y < 0 || x >= width || y >= height) continue;
            sum += away(x, y, ground);
            count++;
          }
          if (count > 0) worst = Math.max(worst, sum / count);
        }
        return worst;
      };
      return wanted.map(({ before, after }) => {
        const between = {
          left: Math.ceil(before.right) + 2,
          right: Math.floor(after.left) - 2,
        };
        const ground = inkBlock.commonColour(pixels, {
          ...between,
          top: before.top,
          bottom: before.bottom,
        });
        // The line's baseline, where the first word's letters end.
        let baseline = -1;
        for (
          let y = Math.floor(before.top);
          y < Math.ceil(before.bottom);
          y++
        ) {
          for (
            let x = Math.floor(before.left);
            x < Math.ceil(before.right);
            x++
          ) {
            if (away(x, y, ground) > 96) baseline = y + 1;
          }
        }
        // A symbol's ink lies from 5/12 to 1/12 of its height above the
        // baseline, and none here is over 53 CSS pixels tall.
        const region = {
          ...between,
          top: Math.max(0, baseline - Math.ceil(28 * scale)),
          bottom: Math.min(height, baseline + Math.ceil(2 * scale)),
        };
        const regionWidth = region.right - region.left;
        const seen = new Uint8Array(
          Math.max(0, regionWidth) * Math.max(0, region.bottom - region.top),
        );
        const dots: PrintedDot[] = [];
        for (let y = region.top; y < region.bottom; y++) {
          for (let x = region.left; x < region.right; x++) {
            const index = (y - region.top) * regionWidth + (x - region.left);
            if (seen[index] === 1 || away(x, y, ground) <= 64) continue;
            // The pixels of ink connected to this one.
            let [left, top, right, bottom, count] = [x, y, x, y, 0];
            const stack = [[x, y]];
            seen[index] = 1;
            while (stack.length > 0) {
              const [px = 0, py = 0] = stack.pop() ?? [];
              count++;
              left = Math.min(left, px);
              right = Math.max(right, px);
              top = Math.min(top, py);
              bottom = Math.max(bottom, py);
              for (const [nx, ny] of [
                [px + 1, py],
                [px - 1, py],
                [px, py + 1],
                [px, py - 1],
              ] as const) {
                if (
                  nx < region.left ||
                  nx >= region.right ||
                  ny < region.top ||
                  ny >= region.bottom
                )
                  continue;
                const next =
                  (ny - region.top) * regionWidth + (nx - region.left);
                if (seen[next] === 1 || away(nx, ny, ground) <= 64) continue;
                seen[next] = 1;
                stack.push([nx, ny]);
              }
            }
            const [w, h] = [right - left + 1, bottom - top + 1];
            // A solid square, not a letter or a stop.
            if (w < 5 * scale || h < 5 * scale || w / h > 1.25 || h / w > 1.25)
              continue;
            if (count / (w * h) < 0.7) continue;
            const around = {
              left: left - 2,
              top: top - 2,
              right: right + 3,
              bottom: bottom + 3,
            };
            const ink = inkBlock.measureBlock(
              pixels,
              around,
              ground,
              inkBlock.furthestColour(pixels, around, ground),
            );
            if (ink === undefined) continue;
            const box = {
              left: ink.left - ink.width,
              right: ink.right + ink.width,
              top: ink.top - ink.height,
              bottom: ink.bottom + ink.height,
            };
            // Clear of the rounded corners, 4 CSS pixels across.
            const corner = 4 * scale + 1;
            dots.push({
              left: ink.left - before.right,
              top: ink.top - baseline,
              width: ink.width,
              height: ink.height,
              colour: [...ink.colour],
              edges: [
                darkest(
                  true,
                  box.top,
                  box.left + corner,
                  box.right - corner,
                  ground,
                ),
                darkest(
                  false,
                  box.right,
                  box.top + corner,
                  box.bottom - corner,
                  ground,
                ),
                darkest(
                  true,
                  box.bottom,
                  box.left + corner,
                  box.right - corner,
                  ground,
                ),
                darkest(
                  false,
                  box.left,
                  box.top + corner,
                  box.bottom - corner,
                  ground,
                ),
              ],
            });
          }
        }
        return dots.sort((a, b) => a.left - b.left);
      });
    },
    png,
    lines,
    dpi,
  );
}

/**
 * How many soft masks a PDF's graphics states hold, by their dictionaries,
 * which Chromium writes uncompressed: two for each symbol it draws through a
 * CSS mask, the empty one of #255 and the symbol's own, and none for an image
 * with its own alpha, which is drawn with its alpha in the image itself.
 */
async function softMasks(pdf: string): Promise<number> {
  const text = (await readFile(pdf)).toString("latin1");
  return text.match(/\/S \/(?:Luminosity|Alpha)\b/g)?.length ?? 0;
}

/** What an export's snapshot says of the images as the PDF was asked for. */
interface Snapshot {
  atPrint: ImageAtPrint[];
  restored: boolean;
}

/**
 * Checks that each of `count` symbols printed from its print copy, which
 * had loaded, in the text colour, or from its own pixels in its stored colour,
 * neither through its mask, each showing a picture `size` pixels in size, the
 * file's own; and that each showed its own file again once the window closed.
 */
function expectPrintedFrom(
  snapshot: Snapshot,
  textColor: boolean,
  count: number,
  size: readonly [number, number],
): void {
  const symbols = snapshot.atPrint.filter((image) => image.tagged);
  expect(symbols).toHaveLength(count);
  for (const image of symbols) {
    expect(image.copy).toBe(textColor);
    expect(image.blob).toBe(textColor);
    expect(image.complete).toBe(true);
    expect([image.width, image.height]).toEqual(size);
    expect(image.masked).toBe(false);
  }
  expect(snapshot.restored).toBe(true);
}

describe("Native PDF export", function () {
  for (const mode of [
    { name: "text-colour", scale: 100, textColor: true, theme: "obsidian" },
    { name: "stored-grey", scale: 150, textColor: false, theme: "moonstone" },
  ]) {
    it(`prints inline symbols in ${mode.name}, preserving explicit sizes and cleaning up`, async function () {
      await startWith(mode);
      await browser.executeObsidian(async ({ app }, encoded) => {
        const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
        await app.vault.createBinary("block.ink.png", bytes.slice().buffer);
        await app.vault.createBinary("photo.png", bytes.slice().buffer);
        await app.vault.create(
          "Print.md",
          [
            "# Synthetic inscription",
            "",
            "PlainBefore ![[block.ink.png]] PlainAfter.",
            "",
            "SizedBefore ![[block.ink.png|24]] SizedAfter.",
            "",
            "A normal picture ![[photo.png]] remains a picture.",
            "",
          ].join("\n"),
        );
      }, toBase64(block()));
      await obsidianPage.openFile("Print.md");
      const { pdf, snapshot, xml, raster } = await exportPdf(mode.name);
      const [plain, sized, photo] = snapshot.images;
      if (plain === undefined || sized === undefined || photo === undefined)
        throw new Error("missing print images");
      const scale = mode.scale / 100;
      for (const [name, height, width] of [
        ["Plain", 1.5 * plain.fontSize * scale, 0.5 * plain.fontSize * scale],
        ["Sized", 72, 24],
      ] as const) {
        const { ink, text } = await printedBlock(
          raster,
          wordBox(xml, `${name}Before`),
          wordBox(xml, `${name}After.`),
          height,
        );
        expect(text.count).toBeGreaterThan(10);
        expect(ink.count).toBeGreaterThan(10);
        expect(Math.abs(ink.height - height / 2)).toBeLessThanOrEqual(2);
        expect(Math.abs(ink.width - (width * 3) / 4)).toBeLessThanOrEqual(2);
        expect(Math.abs(ink.bottom - text.bottom)).toBeLessThanOrEqual(2);
        expect(
          (mode.textColor ? ink.dark : ink.grey) / ink.count,
        ).toBeGreaterThan(0.6);
        expect((mode.textColor ? ink.grey : ink.dark) / ink.count).toBeLessThan(
          0.05,
        );
      }
      expect(plain.tagged).toBe(true);
      expect(
        Math.abs(plain.height - 1.5 * plain.fontSize * scale),
      ).toBeLessThanOrEqual(1);
      expect(plain.drop).not.toBeNull();
      expect(
        Math.abs((plain.drop ?? 0) - plain.height / 4),
      ).toBeLessThanOrEqual(1);
      expect(sized.width).toBe(24);
      expect(sized.height).toBe(72);
      expect(sized.drop).toBe(18);
      // The export window's renderer measured both, whichever window's
      // images they are.
      console.log(
        `${mode.name}: images of the export window's own: ${JSON.stringify(snapshot.images.map((image) => image.ownWindow))}`,
      );
      expect(Number.parseFloat(plain.ratio)).toBeCloseTo(1 / 3, 9);
      expect(Number.parseFloat(sized.ratio)).toBeCloseTo(1 / 3, 9);
      expect(sized.asked).toBe("24px");
      expect(photo.tagged).toBe(false);
      expect(photo.height).toBe(192);
      expect(snapshot.scale).toBe(String(scale));
      expect(snapshot.stored).toBe(!mode.textColor);
      expect(snapshot.cleaned).toBe(true);
      expect(
        snapshot.viewerRequests.map((request) => request.filePath),
      ).toEqual([pdf]);
      // In the text colour each symbol printed from its copy, loaded by the
      // time Obsidian asked for the PDF, and in its stored colour from its
      // own pixels, as before; neither through its mask.
      expectPrintedFrom(snapshot, mode.textColor, 2, [64, 192]);
    });
  }

  // In a heading at the largest symbol size the symbol would be over 1,600
  // CSS pixels wide, more than the export window's line and the page's.
  for (const mode of [
    {
      name: "wide-text-colour",
      scale: 200,
      textColor: true,
      theme: "obsidian",
    },
    {
      name: "wide-stored-grey",
      scale: 200,
      textColor: false,
      theme: "moonstone",
    },
  ]) {
    it(`prints a symbol wider than the page whole and in proportion, in ${mode.name}`, async function () {
      await startWith(mode);
      await browser.executeObsidian(async ({ app }, encoded) => {
        const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
        await app.vault.createBinary("wide.ink.png", bytes.buffer);
        await app.vault.create(
          "Wide.md",
          [
            "WideBefore words.",
            "",
            "# ![[wide.ink.png]] WideHeading",
            "",
            "WideAfter words.",
            "",
          ].join("\n"),
        );
      }, toBase64(widePng()));
      await obsidianPage.openFile("Wide.md");
      // The PDF puts the shrunk mask on whole CSS pixels, 33 tall where 32.5
      // is exact, which makes the ink 2% taller than its shape in these
      // hosts. At 96 DPI Poppler puts the ink's edges, 24 pixels apart, on
      // whole pixels too, as much again; at three times that, a third of it.
      const dpi = 288;
      const { snapshot, xml, raster } = await exportPdf(mode.name, dpi);
      /** A word's box in the page's pixels at that resolution. */
      const word = (text: string): Box => {
        const { left, top, right, bottom } = wordBox(xml, text);
        const scaled = (value: number) => (value * dpi) / 96;
        return {
          left: scaled(left),
          top: scaled(top),
          right: scaled(right),
          bottom: scaled(bottom),
        };
      };
      const [image] = snapshot.images;
      if (image === undefined) throw new Error("missing print image");
      expect(image.tagged).toBe(true);
      expectPrintedFrom(snapshot, mode.textColor, 1, [wide.width, wide.height]);
      // Narrowed by a tenth or more, and the heading's line height still.
      const scale = mode.scale / 100;
      expect(image.width).toBeLessThan(0.9 * fullWidth(image.fontSize, scale));
      expect(
        Math.abs(image.height - 1.5 * image.fontSize * scale),
      ).toBeLessThanOrEqual(1);
      // The symbol is on a line of its own, and the heading's word after it.
      const before = word("WideBefore");
      const { page, ink } = await printedWide(
        raster,
        before,
        word("WideHeading"),
      );
      console.log(`${mode.name}: ${JSON.stringify({ image, page, ink })}`);
      expect(ink).not.toBeNull();
      if (ink === null) return;
      expect(Math.abs(ink.width / ink.height / drawnRatio - 1)).toBeLessThan(
        0.05,
      );
      // Whole, across the page's line, which the page prints at its own width:
      // from the left margin, where the text starts, to the right one, as wide.
      const across = (wide.block.right - wide.block.left) / wide.width;
      const line = page - 2 * before.left;
      expect(Math.abs(ink.left - before.left)).toBeLessThan(6);
      expect(Math.abs(ink.width - line * across)).toBeLessThan(6);
      for (const channel of ink.colour) {
        if (mode.textColor) expect(channel).toBeLessThan(60);
        else expect(Math.abs(channel - 126)).toBeLessThanOrEqual(8);
      }
    });
  }
  // An explicit size wider than the page (#245). The print lays the note out
  // again at the page's width, narrower than the export window's line, so the
  // drop must follow the shown height in the print layout itself. A symbol
  // shrunk to its whole line has no text beside it, so a numbered list's
  // number, on the same line, gives the baseline.
  for (const mode of [
    {
      name: "asked-text-colour",
      scale: 100,
      textColor: true,
      theme: "obsidian",
    },
    {
      name: "asked-stored-grey",
      scale: 100,
      textColor: false,
      theme: "moonstone",
    },
  ]) {
    it(`prints an explicit size wider than the page on the baseline, in ${mode.name}`, async function () {
      await startWith(mode);
      await browser.executeObsidian(async ({ app }, encoded) => {
        const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
        await app.vault.createBinary("wide.ink.png", bytes.buffer);
        await app.vault.create(
          "Asked.md",
          [
            "AskedBefore words.",
            "",
            "1. ![[wide.ink.png|1000]]",
            "",
            "AskedAfter words.",
            "",
          ].join("\n"),
        );
      }, toBase64(widePng()));
      await obsidianPage.openFile("Asked.md");
      const dpi = 288;
      const { snapshot, xml, raster } = await exportPdf(mode.name, dpi);
      const word = (text: string): Box => {
        const { left, top, right, bottom } = wordBox(xml, text);
        const scaled = (value: number) => (value * dpi) / 96;
        return {
          left: scaled(left),
          top: scaled(top),
          right: scaled(right),
          bottom: scaled(bottom),
        };
      };
      const [image] = snapshot.images;
      if (image === undefined) throw new Error("missing print image");
      expect(image.tagged).toBe(true);
      expectPrintedFrom(snapshot, mode.textColor, 1, [wide.width, wide.height]);
      expect(Number.parseFloat(image.ratio)).toBeCloseTo(
        wide.width / wide.height,
        9,
      );
      expect(image.asked).toBe("1000px");
      const line = await printedListLine(
        raster,
        word("1."),
        word("AskedBefore"),
        word("AskedAfter"),
      );
      console.log(`${mode.name}: ${JSON.stringify({ image, line })}`);
      expect(line.number).toBeGreaterThan(0);
      expect(line.ink).not.toBeNull();
      if (line.ink === null) return;
      // Shrunk by the page: narrower than the 1,000 CSS pixels asked for,
      // and in its proportions.
      expect(line.ink.width).toBeLessThan((0.9 * 1000 * dpi) / 96);
      expect(
        Math.abs(line.ink.width / line.ink.height / drawnRatio - 1),
      ).toBeLessThan(0.05);
      // On the number's baseline, within a CSS pixel and a half.
      expect(Math.abs(line.ink.bottom - line.number)).toBeLessThan(
        (1.5 * dpi) / 96,
      );
    });
  }
  // #255. Chromium writes a CSS mask into a PDF as a fill drawn twice, the
  // first time through a soft mask that adds nothing, and Poppler, like other
  // renderers, can leave a faint line where the two meet a box's edge. So in
  // the text colour each symbol prints from a copy of its pixels, in the
  // colour its text prints in, as an image with its own alpha. The second
  // export fails Inkline's reads of the symbols, which keeps every mask: it
  // shows that the measure finds the lines the mask leaves, and gives the
  // print colours and places that the copies must match.
  it("prints text-colour symbols with no line along their boxes, in their text's print colours", async function () {
    await startWith({
      name: "lines",
      scale: 100,
      textColor: true,
      theme: "obsidian",
    });
    const lines = [
      ["# HeadBefore", ["![[dot.ink.png]]"], "HeadAfter"],
      [
        "PlainBefore",
        [
          "![[dot.ink.png]]",
          "![[dot.ink.png|20]]",
          "![[dot.ink.png|27]]",
          "![[dot.ink.png|33]]",
        ],
        "PlainAfter",
      ],
      [
        "SizedBefore",
        ["![[dot.ink.png|40]]", "![[dot.ink.png|47]]", "![[dot.ink.png|53]]"],
        "SizedAfter",
      ],
      [
        "LinkBefore",
        [
          "[![[dot.ink.png]]](https://example.com)",
          "[![[dot.ink.png|30]]](https://example.com)",
        ],
        "LinkAfter",
      ],
      [
        "> [!warning] CallBefore",
        ["![[dot.ink.png]]", "![[dot.ink.png|30]]"],
        "CallAfter",
      ],
      [
        "## SmallBefore",
        ["![[dot.ink.png]]", "![[dot.ink.png|23]]"],
        "SmallAfter",
      ],
    ] as const;
    await browser.executeObsidian(
      async ({ app }, encoded, text) => {
        const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
        await app.vault.createBinary("dot.ink.png", bytes.buffer);
        await app.vault.create("Lines.md", text);
      },
      toBase64(dot()),
      lines
        .map(([before, symbols, after]) =>
          [before, ...symbols, after].join(" "),
        )
        .join("\n\n"),
    );
    await obsidianPage.openFile("Lines.md");
    const dpi = 110;
    const measure = async ({ xml, raster }: { xml: string; raster: string }) =>
      printedDots(
        raster,
        lines.map(([before, , after]) => {
          const scaled = (word: string): Box => {
            const { left, top, right, bottom } = wordBox(
              xml,
              word.replace(/^.* /, ""),
            );
            const by = dpi / 96;
            return {
              left: left * by,
              top: top * by,
              right: right * by,
              bottom: bottom * by,
            };
          };
          return { before: scaled(before), after: scaled(after) };
        }),
        dpi,
      );
    const copied = await exportPdf("lines-copies", dpi);
    await holdReads({ "*": "fail" });
    let masked;
    try {
      masked = await exportPdf("lines-masks", dpi);
    } finally {
      await releaseReads();
    }
    const copies = await measure(copied);
    const masks = await measure(masked);
    console.log(`lines: ${JSON.stringify({ copies, masks })}`);
    const counts = lines.map(([, symbols]) => symbols.length);
    expect(copies.map((line) => line.length)).toEqual(counts);
    expect(masks.map((line) => line.length)).toEqual(counts);
    const total = counts.reduce((sum, count) => sum + count, 0);
    expectPrintedFrom(copied.snapshot, true, total, [192, 192]);
    for (const image of masked.snapshot.atPrint) {
      expect(image.copy).toBe(false);
      expect(image.blob).toBe(false);
      expect(image.masked).toBe(true);
    }
    // Chromium drew each mask twice, and each copy as an image of its own.
    expect(await softMasks(masked.pdf)).toBe(2 * total);
    expect(await softMasks(copied.pdf)).toBe(0);
    // A line is a pixel a side of 252 or darker on white, as #255 counted.
    const lined = (dots: PrintedDot[][]) =>
      dots.flat().flatMap((one) => one.edges.filter((edge) => edge >= 3));
    expect(lined(masks).length).toBeGreaterThan(0);
    expect(lined(copies)).toEqual([]);
    // Where the mask put each symbol's ink, as large, and in its colour.
    const [flatCopies, flatMasks] = [copies.flat(), masks.flat()];
    flatCopies.forEach((one, index) => {
      const mask = flatMasks[index];
      if (mask === undefined) throw new Error("a symbol the mask lacks");
      for (const key of ["left", "top", "width", "height"] as const) {
        expect(Math.abs(one[key] - mask[key])).toBeLessThanOrEqual(0.5);
      }
      one.colour.forEach((channel, at) => {
        expect(Math.abs(channel - (mask.colour[at] ?? -1))).toBeLessThanOrEqual(
          3,
        );
      });
    });
    // Obsidian prints a note's text in its initial colour, black, where the
    // screen shows the theme's, and links and callout titles in their own.
    const [head, plain, sized, link, callout, small] = copies;
    for (const one of [head, plain, sized, small].flat()) {
      for (const channel of one?.colour ?? []) {
        expect(channel).toBeLessThan(16);
      }
    }
    for (const one of [link, callout].flat()) {
      const colour = one?.colour ?? [];
      expect(Math.max(...colour) - Math.min(...colour)).toBeGreaterThan(64);
    }
    const [linked] = link ?? [];
    const [titled] = callout ?? [];
    expect(
      Math.max(
        ...(linked?.colour ?? []).map((channel, at) =>
          Math.abs(channel - (titled?.colour[at] ?? 0)),
        ),
      ),
    ).toBeGreaterThan(64);
  });

  // Obsidian prints once the promises its post-processors return have
  // resolved, and 200 ms more. Inkline's resolves once every symbol shows its
  // copy or keeps its mask, or once no copy has got further for printWait: a
  // symbol whose copy is that late, or cannot be made, prints from its mask,
  // as before, never blank.
  it("waits for many symbols' copies before Obsidian prints, and prints the rest from their masks", async function () {
    await startWith({
      name: "waits",
      scale: 100,
      textColor: true,
      theme: "obsidian",
    });
    const row = [
      "![[dot.ink.png]]",
      "![[block.ink.png]]",
      "[![[dot.ink.png|30]]](https://example.com)",
      "**![[block.ink.png|20]]**",
      "![[dot.ink.png|17]]",
      "==![[block.ink.png]]==",
    ].join(" ");
    await browser.executeObsidian(
      async ({ app }, dotPng, blockPng, widePicture, text) => {
        const bytes = (encoded: string) =>
          Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0)).buffer;
        await app.vault.createBinary("dot.ink.png", bytes(dotPng));
        await app.vault.createBinary("block.ink.png", bytes(blockPng));
        await app.vault.createBinary("wide.ink.png", bytes(widePicture));
        for (const name of ["slow", "late", "unread"]) {
          await app.vault.createBinary(`${name}.ink.png`, bytes(dotPng));
        }
        // Not a PNG, as a file damaged elsewhere would be.
        await app.vault.createBinary(
          "broken.ink.png",
          new TextEncoder().encode("not a picture").buffer,
        );
        await app.vault.create("Waits.md", text);
      },
      toBase64(dot()),
      toBase64(block()),
      toBase64(widePng()),
      [
        "SlowBefore ![[slow.ink.png]] SlowAfter.",
        "LateBefore ![[late.ink.png]] LateAfter.",
        "UnreadBefore ![[unread.ink.png]] UnreadAfter.",
        "BrokenBefore ![[broken.ink.png]] BrokenAfter.",
        "![[wide.ink.png]]",
        "## ![[dot.ink.png]] ![[block.ink.png]]",
        ...Array.from({ length: 20 }, () => row),
      ].join("\n\n"),
    );
    await obsidianPage.openFile("Waits.md");
    // Slow's read ends well after Obsidian's 200 ms, and late's long after
    // every other copy is done; unread's fails.
    const late = 6 * printWait;
    await holdReads({
      "slow.ink.png": 1500,
      "late.ink.png": late,
      "unread.ink.png": "fail",
    });
    let exported;
    try {
      exported = await exportPdf("waits");
    } finally {
      await releaseReads();
    }
    const { snapshot, xml, raster } = exported;
    console.log(
      `waits: ${String(snapshot.atPrint.length)} images, print asked for ${String(Math.round(snapshot.waited))} ms after the window opened`,
    );
    const symbols = snapshot.atPrint.filter((image) => image.tagged);
    expect(symbols.length).toBeGreaterThanOrEqual(120);
    const sizes: Partial<Record<string, readonly [number, number]>> = {
      dot: [192, 192],
      slow: [192, 192],
      block: [64, 192],
      wide: [wide.width, wide.height],
    };
    for (const image of symbols) {
      const size = sizes[image.name];
      if (size !== undefined) {
        expect(image.copy).toBe(true);
        expect(image.complete).toBe(true);
        expect([image.width, image.height]).toEqual(size);
        expect(image.masked).toBe(false);
      } else {
        expect(["late", "unread", "broken"]).toContain(image.name);
        expect(image.copy).toBe(false);
        expect(image.blob).toBe(false);
        expect(image.masked).toBe(true);
      }
    }
    // Obsidian waited for slow's copy, and not for late's.
    expect(snapshot.waited).toBeGreaterThan(1500);
    expect(snapshot.waited).toBeLessThan(late);
    expect(snapshot.restored).toBe(true);
    // Late and unread print from their masks, slow from its copy, all inked.
    for (const name of ["Slow", "Late", "Unread"]) {
      const { ink } = await printedBlock(
        raster,
        wordBox(xml, `${name}Before`),
        wordBox(xml, `${name}After.`),
        24,
      );
      expect(ink.count).toBeGreaterThan(10);
      expect(ink.dark / ink.count).toBeGreaterThan(0.6);
    }
  });
});
