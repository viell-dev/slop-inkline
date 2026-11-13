// Investigation for #255, not part of the suite: shows the PDFs that
// pdf-seam.e2e.ts exported, kept in pdf-seam/pdfs/, in two viewers people
// use, at several zoom levels, and keeps what each drew in /out/viewers/:
//
// - Obsidian's own PDF view, which is pdf.js: the page's canvas, read back;
// - Chromium's built-in PDF viewer (PDFium), in an Electron window of its
//   own: a capture of the window, cropped to the page afterwards.

import { execFileSync } from "node:child_process";
import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { browser } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import { toBase64 } from "../support/browser.ts";
import { startOver } from "../support/editor.ts";
import { outputDirectory } from "../support/harness.ts";

const pdfs = path.join(import.meta.dirname, "pdf-seam", "pdfs");

async function folder(): Promise<string> {
  const output = outputDirectory(
    process.env.E2E_OUTPUT_DIR,
    path.resolve(import.meta.dirname, "../../.."),
  );
  const dir = path.join(
    output,
    "viewers",
    `${browser.getObsidianVersion()}-${browser.getObsidianInstallerVersion()}`,
  );
  await mkdir(dir, { recursive: true });
  return dir;
}

describe("PDF viewers on exported symbols (#255)", function () {
  this.timeout(600_000);

  before(async function () {
    await startOver();
  });

  it("draws each PDF in Obsidian's own PDF view at several zooms", async function () {
    const dir = await folder();
    for (const file of (await readdir(pdfs)).filter((f) => f.endsWith(".pdf"))) {
      const name = file.replace(/\.pdf$/, "");
      const bytes = toBase64(new Uint8Array(await readFile(path.join(pdfs, file))));
      await browser.executeObsidian(async ({ app }, encoded, vaultName) => {
        const data = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
        await app.vault.createBinary(`${vaultName}.pdf`, data.buffer);
      }, bytes, name);
      await obsidianPage.openFile(`${name}.pdf`);
      for (const scale of [1, 1.25, 1.5, 2]) {
        const result = await browser.executeObsidian(
          async ({ app }, wanted) => {
            // Obsidian's PDF view keeps pdf.js's PDFViewer some levels down.
            const view: unknown = app.workspace.activeLeaf?.view;
            const find = (value: unknown, depth: number): unknown => {
              if (typeof value !== "object" || value === null || depth > 5)
                return undefined;
              if ("currentScaleValue" in value && "pagesCount" in value)
                return value;
              for (const key of Object.keys(value)) {
                if (key === "app" || key === "containerEl") continue;
                const found = find(Reflect.get(value, key), depth + 1);
                if (found !== undefined) return found;
              }
              return undefined;
            };
            const until = Date.now() + 20_000;
            let viewer: unknown;
            while ((viewer = find(view, 0)) === undefined) {
              if (Date.now() > until) return { error: "no pdf.js viewer" };
              await new Promise((r) => window.setTimeout(r, 200));
            }
            Reflect.set(viewer as object, "currentScale", wanted);
            // Wait for the first page's canvas at that scale to settle.
            const end = Date.now() + 30_000;
            let last = "";
            let stable = 0;
            for (;;) {
              await new Promise((r) => window.setTimeout(r, 500));
              const canvas = document.querySelector(
                '.workspace-leaf.mod-active .page[data-page-number="1"] canvas',
              );
              const size =
                canvas instanceof HTMLCanvasElement
                  ? `${canvas.width}x${canvas.height}`
                  : "";
              const busy =
                document.querySelector(
                  '.workspace-leaf.mod-active .page[data-page-number="1"] .loadingIcon:not(.notVisible)',
                ) !== null;
              stable = size !== "" && size === last && !busy ? stable + 1 : 0;
              last = size;
              if (stable >= 3 && canvas instanceof HTMLCanvasElement) {
                return {
                  scale: Reflect.get(viewer as object, "currentScale") as number,
                  width: canvas.width,
                  height: canvas.height,
                  dpr: window.devicePixelRatio,
                  png: canvas.toDataURL("image/png"),
                };
              }
              if (Date.now() > end) {
                const page = document.querySelector(
                  '.workspace-leaf.mod-active .page[data-page-number="1"]',
                );
                return {
                  error: `page did not render: ${size} busy ${busy} ${
                    page?.outerHTML.slice(0, 300) ?? "no page"
                  }`,
                };
              }
            }
          },
          scale,
        );
        if ("error" in result) {
          console.log(`${name} obsidian ${scale}: ${result.error}`);
          continue;
        }
        // The canvas's own resolution: its pixels across 612 points.
        const dpi = Math.round((result.width / 612) * 72);
        console.log(`${name} obsidian ${scale}: ${result.width}x${result.height} = ${dpi} dpi`);
        await writeFile(
          path.join(dir, `${name}-obsidianpdfjs-${dpi}.png`),
          Buffer.from(result.png.replace(/^data:image\/png;base64,/, ""), "base64"),
        );
      }
    }
  });

  it("draws each PDF in Chromium's PDF viewer at several zooms", async function () {
    const dir = await folder();
    // The suite's window manager tiles windows: let this one float at the
    // size asked for.
    execFileSync("herbstclient", ["rule", "floating=on"]);
    for (const file of (await readdir(pdfs)).filter((f) => f.endsWith(".pdf"))) {
      const name = file.replace(/\.pdf$/, "");
      for (const zoom of [100, 125, 150, 200]) {
        const url = `file://${path.join(pdfs, file)}#zoom=${zoom}&toolbar=0`;
        const png = await browser.execute(async (address) => {
          const electron: unknown = Reflect.get(window, "electron");
          const remote = Reflect.get(electron as object, "remote") as {
            BrowserWindow: new (options: object) => {
              loadURL(url: string): Promise<void>;
              webContents: { capturePage(): Promise<{ toPNG(): Uint8Array }> };
              destroy(): void;
            };
          };
          const win = new remote.BrowserWindow({
            x: 0,
            y: 0,
            width: 1590,
            height: 990,
            show: true,
            webPreferences: { plugins: true },
          });
          try {
            await win.loadURL(address);
            // The viewer draws its pages after load; give it time.
            await new Promise((r) => window.setTimeout(r, 4000));
            const image = await win.webContents.capturePage();
            const bytes = image.toPNG();
            let text = "";
            for (const byte of bytes) text += String.fromCharCode(byte);
            return btoa(text);
          } finally {
            win.destroy();
          }
        }, url);
        console.log(`${name} chrome ${zoom}: ${png.length} base64 bytes`);
        await writeFile(
          path.join(dir, `${name}-chromewindow-${zoom}.png`),
          Buffer.from(png, "base64"),
        );
      }
    }
  });
});
