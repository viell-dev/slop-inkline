// Investigation for #255, not part of the suite: exports the same synthetic
// notes to PDF with 0.9.2's styles and with 0.9.3's, in text colour and in
// stored colour, and keeps each PDF, what the print document showed, and
// Poppler's rasters at 96 and 300 DPI beside it in /out/seam/<version>/.
// The measurements are made afterwards, outside Obsidian.
//
// STYLES picks the stylesheets, by the names of files in pdf-seam/ without
// ".css", comma-separated; the default is "styles-0.9.2,styles-0.9.3".

import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { browser } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import { encodePng } from "../../support/png.ts";
import { loadModules, toBase64 } from "../support/browser.ts";
import { startOver } from "../support/editor.ts";
import { outputDirectory } from "../support/harness.ts";
import { widePng } from "../support/wide-symbol.ts";

interface SeenImage {
  src: string;
  tagged: boolean;
  left: number;
  top: number;
  width: number;
  height: number;
  maskSize: string;
  maskPosition: string;
  objectFit: string;
  objectPosition: string;
  maskImage: string;
}

interface SeamProbe {
  images: SeenImage[];
  closed: boolean;
  error?: string;
  restore(): void;
}

declare global {
  interface Window {
    inklineSeamProbe?: SeamProbe;
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

/** A 192 × 192 symbol with a thin bar along its baseline only. */
function bar(): Uint8Array {
  const data = new Uint8Array(192 * 192 * 4);
  for (let y = 136; y < 144; y++) {
    for (let x = 16; x < 176; x++) {
      data.set([20, 20, 20, 255], (y * 192 + x) * 4);
    }
  }
  return encodePng({ width: 192, height: 192, data });
}

/** Redirects the save dialog and the viewer flag, as pdf.e2e.ts does. */
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
    const probe: SeamProbe = {
      images: [],
      closed: false,
      restore: () => {
        window.open = open;
        Object.defineProperty(dialog, "showSaveDialog", descriptor);
        for (const observer of observers) observer.disconnect();
        for (const restore of restoreSend) restore();
      },
    };
    window.inklineSeamProbe = probe;
    window.open = (...args) => {
      const child = open(...args);
      if (child === null) return child;
      const doc = child.document;
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
                if (typeof options !== "object" || options === null) {
                  probe.error = "unexpected native PDF request";
                  throw new Error(probe.error);
                }
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
          child.close();
        }
      });
      const capture = () => {
        const images = Array.from(doc.querySelectorAll(".print img"));
        if (images.length === 0) return;
        probe.images = images.map((image) => {
          const rect = image.getBoundingClientRect();
          const style = child.getComputedStyle(image);
          return {
            src: (image as HTMLImageElement).src.replace(/^.*\//, ""),
            tagged: image.classList.contains("inkline-symbol"),
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
            maskSize: style.maskSize,
            maskPosition: style.maskPosition,
            objectFit: style.objectFit,
            objectPosition: style.objectPosition,
            maskImage: style.maskImage === "none" ? "none" : "url",
          };
        });
      };
      const observer = new MutationObserver(capture);
      observers.push(observer);
      observer.observe(doc, { subtree: true, childList: true, attributes: true });
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

async function exportPdf(name: string) {
  const output = outputDirectory(
    process.env.E2E_OUTPUT_DIR,
    path.resolve(import.meta.dirname, "../../.."),
  );
  const folder = path.join(
    output,
    "seam",
    `${browser.getObsidianVersion()}-${browser.getObsidianInstallerVersion()}`,
  );
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
          () => window.inklineSeamProbe?.error,
        );
        if (typeof error === "string") throw new Error(error);
        try {
          return (await readFile(pdf)).subarray(0, 5).toString() === "%PDF-";
        } catch {
          return false;
        }
      },
      { timeoutMsg: "native PDF was not written" },
    );
    await browser.waitUntil(
      async () =>
        browser.execute(() => window.inklineSeamProbe?.closed === true),
      { timeoutMsg: "native export window did not close" },
    );
    // The writer may still be flushing when the header is there.
    await browser.pause(1000);
    const images = await browser.execute(
      () => window.inklineSeamProbe?.images ?? [],
    );
    await writeFile(`${prefix}.json`, JSON.stringify(images, null, 2));
    for (const dpi of [96, 300]) {
      execFileSync("pdftoppm", [
        "-singlefile",
        "-r",
        String(dpi),
        "-png",
        pdf,
        `${prefix}-poppler22-${dpi}`,
      ]);
    }
    return images;
  } finally {
    await browser.execute(() => {
      window.inklineSeamProbe?.restore();
      delete window.inklineSeamProbe;
    });
  }
}

const styles = (process.env.STYLES ?? "styles-0.9.2,styles-0.9.3").split(",");

describe("PDF seams along symbols' boxes (#255)", function () {
  after(async function () {
    await startOver();
  });

  for (const sheet of styles) {
    for (const mode of [
      { name: "text", textColor: true, theme: "obsidian" },
      { name: "stored", textColor: false, theme: "moonstone" },
    ]) {
      for (const note of [
        { name: "ordinary", scale: 100 },
        { name: "wide", scale: 200 },
      ]) {
        it(`exports ${note.name} with ${sheet} in ${mode.name}`, async function () {
          const css = await readFile(
            path.join(import.meta.dirname, "pdf-seam", `${sheet}.css`),
            "utf8",
          );
          await startOver();
          await browser.executeObsidian(
            async ({ plugins, app }, chosen, sheetText) => {
              await app.vault.adapter.write(
                `${app.vault.configDir}/plugins/inkline/styles.css`,
                sheetText,
              );
              await plugins.inkline.saveData({
                symbolScale: chosen.scale,
                textColor: chosen.textColor,
              });
              const change: unknown = Reflect.get(app, "changeTheme");
              if (typeof change !== "function") throw new Error("no themes");
              Reflect.apply(change, app, [chosen.theme]);
            },
            { scale: note.scale, textColor: mode.textColor, theme: mode.theme },
            css,
          );
          await obsidianPage.disablePlugin("inkline");
          await obsidianPage.enablePlugin("inkline");
          await loadModules();
          await browser.executeObsidian(
            async ({ app }, blockPng, barPng, widePngData) => {
              const bytes = (encoded: string) =>
                Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0)).buffer;
              await app.vault.createBinary("block.ink.png", bytes(blockPng));
              await app.vault.createBinary("bar.ink.png", bytes(barPng));
              await app.vault.createBinary("wide.ink.png", bytes(widePngData));
              await app.vault.create(
                "Ordinary.md",
                [
                  "# Heading ![[block.ink.png]] here",
                  "",
                  "PlainBefore ![[block.ink.png]] PlainAfter.",
                  "",
                  "SizedBefore ![[block.ink.png|24]] SizedAfter.",
                  "",
                  "RowBefore ![[block.ink.png]]![[block.ink.png]]![[block.ink.png]] RowAfter.",
                  "",
                  "BarBefore ![[bar.ink.png]] BarAfter.",
                  "",
                  "BarSizedBefore ![[bar.ink.png|40]] BarSizedAfter.",
                  "",
                  "WideFits ![[wide.ink.png]]",
                  "",
                ].join("\n"),
              );
              await app.vault.create(
                "Wide.md",
                [
                  "WideBefore words.",
                  "",
                  "# ![[wide.ink.png]] WideHeading",
                  "",
                  "PlainBefore ![[block.ink.png]] PlainAfter.",
                  "",
                  "WideAfter words.",
                  "",
                ].join("\n"),
              );
            },
            toBase64(block()),
            toBase64(bar()),
            toBase64(widePng()),
          );
          const file = note.name === "wide" ? "Wide.md" : "Ordinary.md";
          await obsidianPage.openFile(file);
          await browser.pause(500);
          const images = await exportPdf(`${sheet}-${mode.name}-${note.name}`);
          console.log(
            `${sheet} ${mode.name} ${note.name}: ${JSON.stringify(
              images.map((image) => [
                image.src,
                image.tagged,
                image.maskSize,
                image.maskPosition,
                image.objectFit,
                image.objectPosition,
              ]),
            )}`,
          );
          if (images.length === 0) throw new Error("no print images");
          if (!images.every((image) => image.tagged))
            throw new Error("an untagged print image");
        });
      }
    }
  }
});
