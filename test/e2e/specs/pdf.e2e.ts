import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import { encodePng } from "../../support/png.ts";
import { loadModules, toBase64 } from "../support/browser.ts";
import { startOver } from "../support/editor.ts";
import { outputDirectory } from "../support/harness.ts";

interface PrintImage {
  tagged: boolean;
  width: number;
  height: number;
  drop: number | null;
  fontSize: number;
}

interface PrintProbe {
  images: PrintImage[];
  scale: string;
  stored: boolean;
  closed: boolean;
  cleanupChecked: boolean;
  cleaned: boolean;
  viewerRequests: { filePath: string; requested: boolean }[];
  error?: string;
  restore(): void;
}

declare global {
  interface Window {
    inklinePrintProbe?: PrintProbe;
  }
}

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
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
      viewerRequests: [],
      restore: () => {
        window.open = open;
        Object.defineProperty(dialog, "showSaveDialog", descriptor);
        for (const observer of observers) observer.disconnect();
        for (const restore of restoreSend) restore();
      },
    };
    window.inklinePrintProbe = probe;
    window.open = (...args) => {
      const child = open(...args);
      if (child === null) return child;
      const doc = child.document;
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
        probe.images = images.map((image) => {
          const rect = image.getBoundingClientRect();
          const style = child.getComputedStyle(image);
          const align = Number.parseFloat(style.verticalAlign);
          return {
            tagged: image.classList.contains("inkline-symbol"),
            width: rect.width,
            height: rect.height,
            drop: Number.isFinite(align) ? -align : null,
            fontSize: Number.parseFloat(style.fontSize),
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

describe("Native PDF export", function () {
  after(async function () {
    await startOver();
  });

  for (const mode of [
    { name: "text-colour", scale: 100, textColor: true, theme: "obsidian" },
    { name: "stored-grey", scale: 150, textColor: false, theme: "moonstone" },
  ]) {
    it(`prints inline symbols in ${mode.name}, preserving explicit sizes and cleaning up`, async function () {
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
      const prefix = path.join(folder, mode.name);
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
              return (
                (await readFile(pdf)).subarray(0, 5).toString() === "%PDF-"
              );
            } catch {
              return false;
            }
          },
          { timeoutMsg: "native PDF was not written" },
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
            viewerRequests: probe.viewerRequests,
          };
        });
        await writeFile(`${prefix}.json`, JSON.stringify(snapshot, null, 2));
        execFileSync("pdftoppm", [
          "-singlefile",
          "-r",
          "96",
          "-png",
          pdf,
          prefix,
        ]);
        const xml = execFileSync("pdftotext", ["-bbox", pdf, "-"], {
          encoding: "utf8",
        });
        await writeFile(`${prefix}.xml`, xml);
        const raster = toBase64(
          new Uint8Array(await readFile(`${prefix}.png`)),
        );
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
          expect(
            (mode.textColor ? ink.grey : ink.dark) / ink.count,
          ).toBeLessThan(0.05);
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
        expect(photo.tagged).toBe(false);
        expect(photo.height).toBe(192);
        expect(snapshot.scale).toBe(String(scale));
        expect(snapshot.stored).toBe(!mode.textColor);
        expect(snapshot.cleaned).toBe(true);
        expect(
          snapshot.viewerRequests.map((request) => request.filePath),
        ).toEqual([pdf]);
      } finally {
        await browser.execute(() => {
          window.inklinePrintProbe?.restore();
          delete window.inklinePrintProbe;
        });
      }
    });
  }
});
