// Investigation for #167, section 3, "Ruby support": not part of the suite.
// Finds out, in real Obsidian, whether HTML ruby (<ruby>, <rt>) works around a
// symbol's image in Reading view, Live Preview, Source mode, and PDF export,
// with Inkline on and off; whether Inkline could make it itself from the
// readings and translations a symbol's file holds (the PROTOTYPE in
// src/render/symbols.ts and src/main.ts); and whether published ruby plugins
// work with symbol embeds. It writes what it measures to ruby-<version>.json
// in the output directory, with screenshots and PDFs. All content is
// synthetic. Third-party plugins are read from test/e2e/manual/ruby-plugins/
// <id>/, their published release files, which are not part of the repository.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { browser } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import { loadModules } from "../support/browser.ts";
import { startOver } from "../support/editor.ts";
import { outputDirectory } from "../support/harness.ts";
import { saveScreenshot } from "../support/screenshots.ts";

const root = path.resolve(import.meta.dirname, "../../..");
const output = outputDirectory(process.env.E2E_OUTPUT_DIR, root);
const pluginsDir = path.join(import.meta.dirname, "ruby-plugins");

/** Everything measured, written out at the end. */
const results: Record<string, unknown> = {};

type Mode = "source" | "preview";

/** Synthetic symbols, their strokes in units, and what they say. */
const symbols: {
  name: string;
  strokes: { tool: "pen"; size: number; points: number[] }[];
  reading: string[];
  translation: string[];
}[] = [
  {
    // A ring standing on the baseline.
    name: "sun",
    strokes: [
      {
        tool: "pen",
        size: 160,
        points: Array.from({ length: 33 }, (_, index) => {
          const angle = (index / 32) * 2 * Math.PI;
          return [
            Math.round(16 * (40 + 30 * Math.cos(angle))),
            Math.round(16 * (110 + 30 * Math.sin(angle))),
          ];
        }).flat(),
      },
    ],
    reading: ["ra"],
    translation: ["sun"],
  },
  {
    // Two posts and a lintel, a narrow sign with a long translation.
    name: "tower",
    strokes: [
      { tool: "pen", size: 160, points: [16 * 12, 16 * 40, 16 * 12, 16 * 144] },
      { tool: "pen", size: 160, points: [16 * 36, 16 * 40, 16 * 36, 16 * 144] },
      { tool: "pen", size: 160, points: [16 * 4, 16 * 40, 16 * 44, 16 * 40] },
    ],
    reading: ["kel"],
    translation: ["stronghold"],
  },
  {
    // A zigzag with a reading only.
    name: "wave",
    strokes: [
      {
        tool: "pen",
        size: 160,
        points: [10, 120, 30, 90, 50, 120, 70, 90, 90, 120].map(
          (value) => value * 16,
        ),
      },
    ],
    reading: ["mu"],
    translation: [],
  },
  {
    // A dot with nothing recorded.
    name: "blank",
    strokes: [{ tool: "pen", size: 400, points: [16 * 24, 16 * 120] }],
    reading: [],
    translation: [],
  },
];

const handNote = [
  "Top line for the cursor.",
  "",
  "Wiki <ruby>![[sun.ink.png]]<rt>ra</rt></ruby> after.",
  "",
  "Mdimg <ruby>![](Glyphs/sun.ink.png)<rt>ra</rt></ruby> after.",
  "",
  'Html <ruby><img src="Glyphs/sun.ink.png"><rt>ra</rt></ruby> after.',
  "",
  "Paren <ruby>![[sun.ink.png]]<rp>(</rp><rt>ra</rt><rp>)</rp></ruby> after.",
  "",
  "Pair <ruby>![[tower.ink.png]]<rt>kel</rt>![[sun.ink.png]]<rt>ra</rt></ruby> after.",
  "",
  "Word <ruby>![[tower.ink.png]]![[sun.ink.png]]<rt>kelra</rt></ruby> after.",
  "",
  'Both <ruby style="ruby-position: under"><ruby>![[sun.ink.png]]<rt>ra</rt></ruby><rt>sun</rt></ruby> after.',
  "",
  "Sized <ruby>![[sun.ink.png|24]]<rt>ra</rt></ruby> after.",
  "",
  "Kanji <ruby>漢<rt>kan</rt></ruby> after.",
  "",
  "Plain ![[sun.ink.png]] after.",
  "",
  "First ![[sun.ink.png]] line,",
  "Second <ruby>![[sun.ink.png]]<rt>ra</rt></ruby> line,",
  "Third ![[sun.ink.png]] line.",
  "",
].join("\n");

const handLabels = [
  "Wiki",
  "Mdimg",
  "Html",
  "Paren",
  "Pair",
  "Word",
  "Both",
  "Sized",
  "Kanji",
  "Plain",
  "First",
  "Second",
  "Third",
];

const autoBody = [
  "Top line for the cursor.",
  "",
  "Auto ![[sun.ink.png]] after.",
  "",
  "Pair ![[tower.ink.png]]![[sun.ink.png]] after.",
  "",
  "Reading ![[wave.ink.png]] after.",
  "",
  "None ![[blank.ink.png]] after.",
  "",
  "Sized ![[sun.ink.png|24]] after.",
  "",
  "Words without a symbol.",
  "",
  "First ![[sun.ink.png]] line,",
  "Second ![[blank.ink.png]] line,",
  "Third ![[tower.ink.png]] line.",
  "",
  "> [!note] Remark",
  "> Callout ![[sun.ink.png]] here.",
  "",
  "| Cell |",
  "| --- |",
  "| Table ![[sun.ink.png]] here. |",
  "",
];

const autoLabels = [
  "Auto",
  "Pair",
  "Reading",
  "None",
  "Sized",
  "Words",
  "First",
  "Second",
  "Third",
  "Callout",
  "Table",
];

/** Notes for each third-party plugin, with symbols and a text control. */
const pluginNotes: Record<string, { lines: string[]; labels: string[] }> = {
  "obsidian-markdown-furigana": {
    lines: ["Furi {![[sun.ink.png]]|ra} after.", "Ctrl {漢|kan} after."],
    labels: ["Furi", "Ctrl"],
  },
  "advanced-ruby": {
    lines: [
      "Adv {![[sun.ink.png]]|ra} after.",
      "Ctrl {漢|kan} after.",
      "Html <ruby>![[sun.ink.png]]<rt>ra</rt></ruby> after.",
    ],
    labels: ["Adv", "Ctrl", "Html"],
  },
  "japanese-novel-ruby": {
    lines: [
      "Novel ｜![[sun.ink.png]]《ra》 after.",
      "Bare ![[sun.ink.png]]《ra》 after.",
      "Ctrl ｜漢《kan》 after.",
    ],
    labels: ["Novel", "Bare", "Ctrl"],
  },
  "inline-annotation": {
    lines: [
      "Anno [![[sun.ink.png]]]^^(ra) after.",
      "Ctrl [漢]^^(kan) after.",
      "Two [漢]^^(kan)^_(Chinese) after.",
    ],
    labels: ["Anno", "Ctrl", "Two"],
  },
};

/** Opens `file` in the active leaf, in Live Preview, Reading or Source. */
async function open(file: string, mode: Mode, source = false): Promise<void> {
  await browser.executeObsidian(
    async ({ app, obsidian }, wanted, viewMode, raw) => {
      const found = app.vault.getFileByPath(wanted);
      if (found === null) throw new Error(`no ${wanted}`);
      const leaf = app.workspace.getLeaf(false);
      await leaf.openFile(found, { state: { mode: viewMode, source: raw } });
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
    source,
  );
  await browser.pause(1200);
}

/** Changes the theme: "moonstone" is light, "obsidian" dark. */
async function theme(name: "moonstone" | "obsidian"): Promise<void> {
  await browser.executeObsidian(({ app }, chosen) => {
    const change: unknown = Reflect.get(app, "changeTheme");
    if (typeof change !== "function") throw new Error("no themes");
    Reflect.apply(change, app, [chosen]);
  }, name);
  await browser.pause(300);
}

/**
 * What each labelled block of the active view shows: the label's box, the
 * images and ruby text on its line, and the block's text and markup.
 */
async function measure(labels: readonly string[]): Promise<unknown[]> {
  return browser.execute((wanted) => {
    const leaf = activeDocument.querySelector(".workspace-leaf.mod-active");
    if (leaf === null) throw new Error("no active leaf");
    const view =
      leaf.querySelector(".markdown-reading-view:not([style*='none'])") ??
      leaf.querySelector(".markdown-source-view");
    const reading =
      leaf.querySelector(".markdown-reading-view")?.checkVisibility() === true;
    const scope = reading
      ? leaf.querySelector(".markdown-reading-view")
      : leaf.querySelector(".markdown-source-view");
    if (scope === null || view === null) throw new Error("no view");
    const box = (rect: DOMRect) => ({
      top: Math.round(rect.top * 10) / 10,
      bottom: Math.round(rect.bottom * 10) / 10,
      left: Math.round(rect.left * 10) / 10,
      right: Math.round(rect.right * 10) / 10,
    });
    return wanted.map((label) => {
      const walker = activeDocument.createTreeWalker(
        scope,
        NodeFilter.SHOW_TEXT,
      );
      let node: Node | null = walker.nextNode();
      let at = -1;
      while (node !== null) {
        const text = node.nodeValue ?? "";
        const parent = node.parentElement;
        const inRt = parent?.closest("rt") !== null;
        const index = text.search(new RegExp(`(^|\\s)${label}\\b`));
        if (!inRt && index !== -1) {
          at = index + (text[index] === label[0] ? 0 : 1);
          break;
        }
        node = walker.nextNode();
      }
      if (node === null || at === -1) return { label, found: false };
      const range = activeDocument.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + label.length);
      const labelBox = range.getBoundingClientRect();
      const block =
        node.parentElement?.closest(
          "p, .cm-line, td, th, li, .callout-content, .callout-title",
        ) ?? node.parentElement;
      if (block === null) return { label, found: false };
      // What lies on the label's line: from the line above's text to below.
      const near = (rect: DOMRect) =>
        rect.bottom > labelBox.top - 40 && rect.top < labelBox.bottom + 40;
      const images = Array.from(block.querySelectorAll("img"))
        .filter((image) => !image.classList.contains("cm-widgetBuffer"))
        .filter((image) => near(image.getBoundingClientRect()))
        .map((image) => {
          const probe = createSpan({
            attr: {
              style:
                "display: inline-block; width: 0; height: 0; vertical-align: baseline",
            },
          });
          (image.closest(".image-embed") ?? image).after(probe);
          const baseline = probe.getBoundingClientRect().bottom;
          probe.remove();
          const rect = image.getBoundingClientRect();
          return {
            ...box(rect),
            width: Math.round(rect.width * 10) / 10,
            height: Math.round(rect.height * 10) / 10,
            dropBelowBaseline: Math.round((rect.bottom - baseline) * 10) / 10,
            tagged: image.classList.contains("inkline-symbol"),
            inRuby: image.closest("ruby") !== null,
            rubyDepth: (() => {
              let depth = 0;
              let at: Element | null = image;
              while ((at = at.parentElement?.closest("ruby") ?? null) !== null)
                depth++;
              return depth;
            })(),
            src: (image.getAttribute("src") ?? "").replace(/^.*\//, ""),
          };
        });
      const rts = Array.from(block.querySelectorAll("rt"))
        .filter((rt) => near(rt.getBoundingClientRect()))
        .map((rt) => {
          const rect = rt.getBoundingClientRect();
          const style = getComputedStyle(rt);
          return {
            ...box(rect),
            text: rt.textContent,
            display: style.display,
            fontSize: Number.parseFloat(style.fontSize),
            visible: rect.width > 0 && rect.height > 0,
          };
        });
      const blockRect = block.getBoundingClientRect();
      const text = (block.textContent ?? "").replace(/\s+/g, " ").trim();
      return {
        label,
        found: true,
        labelBox: box(labelBox),
        fontSize: Number.parseFloat(getComputedStyle(block).fontSize),
        blockHeight: Math.round(blockRect.height * 10) / 10,
        blockTag: block.tagName.toLowerCase() + "." + block.className,
        text: text.slice(0, 200),
        literalMarkup: /<\/?r[tbp]|<\/?ruby|\{|\}|《|》|\^\^|｜/.test(text),
        rubies: block.querySelectorAll("ruby").length,
        images,
        rts,
        html: block.outerHTML
          .replace(/app:\/\/[^"]*\/(Glyphs\/)?/g, "app://…/")
          .replace(/--inkline-mask: url\([^)]*\);?/g, "")
          .slice(0, 1400),
      };
    });
  }, labels);
}

/** Screenshots of the active view, from the top down, at most three. */
async function shoot(name: string): Promise<void> {
  const scroller = async (to: number | null) =>
    browser.execute((top) => {
      const leaf = activeDocument.querySelector(".workspace-leaf.mod-active");
      const reading = leaf?.querySelector(".markdown-preview-view");
      const editing = leaf?.querySelector(".cm-scroller");
      const element = reading?.checkVisibility() === true ? reading : editing;
      if (!(element instanceof HTMLElement)) return { done: true };
      if (top !== null) element.scrollTop = top;
      return {
        done:
          element.scrollTop + element.clientHeight >= element.scrollHeight - 2,
        next: element.scrollTop + element.clientHeight - 60,
      };
    }, to);
  let state = await scroller(0);
  await browser.pause(300);
  for (let part = 1; part <= 3; part++) {
    await saveScreenshot(`${name}-${String(part)}`);
    if (state.done || state.next === undefined) break;
    state = await scroller(state.next);
    await browser.pause(400);
  }
  await scroller(0);
}

/** Writes the symbols, with their readings and translations, and notes. */
async function createVault(): Promise<void> {
  await loadModules();
  await browser.executeObsidian(
    async ({ app }, all, hand, auto) => {
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
        await app.vault.createBinary(
          `Glyphs/${symbol.name}.ink.png`,
          bytes.slice().buffer,
        );
      }
      await app.vault.create("Hand.md", hand);
      await app.vault.create("Auto.md", auto.join("\n"));
      await app.vault.create(
        "Opted.md",
        [
          "---",
          "cssclasses: inkline-readings",
          "---",
          "",
          ...auto.slice(0, 5),
        ].join("\n"),
      );
      await app.vault.create("Unopted.md", auto.slice(0, 5).join("\n"));
    },
    symbols,
    handNote,
    autoBody,
  );
}

/** Sets the prototype's mode and restarts Inkline, which reads it. */
async function prototype(mode: "all" | "note" | undefined): Promise<void> {
  await browser.executeObsidian(async ({ plugins }, chosen) => {
    const data: unknown = await plugins.inkline.loadData();
    const next: Record<string, unknown> =
      typeof data === "object" && data !== null ? { ...data } : {};
    if (chosen === undefined) delete next.rubyPrototype;
    else next.rubyPrototype = chosen;
    await plugins.inkline.saveData(next);
  }, mode);
  await obsidianPage.disablePlugin("inkline");
  await obsidianPage.enablePlugin("inkline");
}

/** How many symbols carry ruby from the prototype, in every window. */
async function annotated(): Promise<number> {
  return browser.execute(
    () => activeDocument.querySelectorAll("img[data-inkline-ruby]").length,
  );
}

interface PrintCapture {
  images: unknown[];
  rts: unknown[];
  rubies: number;
  rootClasses: string;
  viewClasses: string;
  closed: boolean;
  error?: string | undefined;
  restore(): void;
}

declare global {
  interface Window {
    inklineRubyPrint?: PrintCapture;
  }
}

/**
 * Exports the active note to `pdf` with Obsidian's own command, as
 * test/e2e/specs/pdf.e2e.ts does: the save dialog is answered, and the request
 * to open a viewer afterwards is turned off. The print document's ruby and
 * images are captured before the exporter removes it.
 */
async function exportPdf(pdf: string): Promise<Omit<PrintCapture, "restore">> {
  await browser.execute((filePath) => {
    const electron: unknown = Reflect.get(window, "electron");
    if (typeof electron !== "object" || electron === null)
      throw new Error("no Electron bridge");
    const remote: unknown = Reflect.get(electron, "remote");
    if (typeof remote !== "object" || remote === null)
      throw new Error("no remote bridge");
    const dialog: unknown = Reflect.get(remote, "dialog");
    if (typeof dialog !== "object" || dialog === null)
      throw new Error("no dialog");
    const descriptor = Object.getOwnPropertyDescriptor(
      dialog,
      "showSaveDialog",
    );
    if (descriptor === undefined) throw new Error("no save dialog");
    Object.defineProperty(dialog, "showSaveDialog", {
      configurable: true,
      writable: true,
      value: () => Promise.resolve({ canceled: false, filePath }),
    });
    const open = window.open.bind(window);
    const observers: MutationObserver[] = [];
    const capture: PrintCapture = {
      images: [],
      rts: [],
      rubies: 0,
      rootClasses: "",
      viewClasses: "",
      closed: false,
      restore: () => {
        window.open = open;
        Object.defineProperty(dialog, "showSaveDialog", descriptor);
        for (const observer of observers) observer.disconnect();
      },
    };
    window.inklineRubyPrint = capture;
    window.open = (...args) => {
      const child = open(...args);
      if (child === null) return child;
      const doc = child.document;
      queueMicrotask(() => {
        try {
          const bridge: unknown = Reflect.get(child, "electron");
          if (typeof bridge !== "object" || bridge === null)
            throw new Error("no export bridge");
          const ipc: unknown = Reflect.get(bridge, "ipcRenderer");
          if (typeof ipc !== "object" || ipc === null)
            throw new Error("no export IPC");
          const send: unknown = Reflect.get(ipc, "send");
          if (typeof send !== "function") throw new Error("no IPC send");
          Object.defineProperty(ipc, "send", {
            configurable: true,
            value: (channel: unknown, ...rest: unknown[]): void => {
              if (channel === "print-to-pdf") {
                const options = rest[0];
                if (typeof options === "object" && options !== null) {
                  rest[0] = { ...options, open: false };
                }
              }
              Reflect.apply(send, ipc, [channel, ...rest]);
            },
          });
        } catch (error) {
          capture.error =
            error instanceof Error ? error.message : String(error);
          child.close();
        }
      });
      const take = () => {
        const images = Array.from(doc.querySelectorAll(".print img"));
        if (images.length === 0) return;
        const box = (element: Element) => {
          const rect = element.getBoundingClientRect();
          return {
            top: Math.round(rect.top),
            bottom: Math.round(rect.bottom),
            left: Math.round(rect.left),
            right: Math.round(rect.right),
          };
        };
        capture.images = images.map((image) => ({
          ...box(image),
          tagged: image.classList.contains("inkline-symbol"),
          inRuby: image.closest("ruby") !== null,
        }));
        capture.rts = Array.from(doc.querySelectorAll(".print rt")).map(
          (rt) => ({
            ...box(rt),
            text: rt.textContent,
            display: child.getComputedStyle(rt).display,
          }),
        );
        capture.rubies = doc.querySelectorAll(".print ruby").length;
        capture.rootClasses = doc.documentElement.className;
        capture.viewClasses = Array.from(
          doc.querySelectorAll(".print .markdown-preview-view, .print"),
        )
          .map((element) => element.className)
          .join(" | ");
      };
      const observer = new MutationObserver(take);
      observers.push(observer);
      observer.observe(doc, {
        subtree: true,
        childList: true,
        attributes: true,
      });
      child.addEventListener(
        "unload",
        () => {
          capture.closed = true;
        },
        { once: true },
      );
      return child;
    };
  }, pdf);
  try {
    await browser.executeObsidianCommand("workspace:export-pdf");
    await browser.$(".modal button.mod-cta").waitForDisplayed();
    await browser.$(".modal button.mod-cta").click();
    await browser.waitUntil(
      async () => {
        try {
          return (await readFile(pdf)).subarray(0, 5).toString() === "%PDF-";
        } catch {
          return false;
        }
      },
      { timeout: 60_000, timeoutMsg: "no PDF" },
    );
    await browser.waitUntil(
      async () =>
        browser.execute(() => window.inklineRubyPrint?.closed === true),
      { timeoutMsg: "the export window stayed open" },
    );
    return await browser.execute(() => {
      const capture = window.inklineRubyPrint;
      if (capture === undefined) throw new Error("no capture");
      return {
        images: capture.images,
        rts: capture.rts,
        rubies: capture.rubies,
        rootClasses: capture.rootClasses,
        viewClasses: capture.viewClasses,
        closed: capture.closed,
        error: capture.error,
      };
    });
  } finally {
    await browser.execute(() => {
      window.inklineRubyPrint?.restore();
      delete window.inklineRubyPrint;
    });
  }
}

/** The words of a PDF and their boxes, from pdftotext, in CSS pixels. */
function pdfWords(pdf: string): { word: string; box: number[] }[] {
  const xml = execFileSync("pdftotext", ["-bbox", pdf, "-"], {
    encoding: "utf8",
  });
  const words =
    /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]+)<\/word>/g;
  return Array.from(xml.matchAll(words)).map((match) => ({
    word: match[5] ?? "",
    box: match
      .slice(1, 5)
      .map((value) => Math.round(((Number(value) * 96) / 72) * 10) / 10),
  }));
}

async function exportAndRead(name: string): Promise<unknown> {
  const folder = path.join(
    output,
    "pdfs",
    `${browser.getObsidianVersion()}-${browser.getObsidianInstallerVersion()}`,
  );
  await mkdir(folder, { recursive: true });
  const prefix = path.join(folder, name);
  const pdf = `${prefix}.pdf`;
  const capture = await exportPdf(pdf);
  execFileSync("pdftoppm", ["-singlefile", "-r", "96", "-png", pdf, prefix]);
  const words = pdfWords(pdf);
  return { capture, words };
}

describe("Ruby around symbols (#167, section 3)", function () {
  this.timeout(600_000);
  const run = () =>
    `${browser.getObsidianVersion()}-${browser.getObsidianInstallerVersion()}`;

  before(async function () {
    await startOver();
    await createVault();
  });

  after(async function () {
    await writeFile(
      path.join(output, `ruby-${run()}.json`),
      JSON.stringify(results, null, 2),
    );
    await prototype(undefined);
    await startOver();
  });

  it("records the host", async function () {
    results.host = await browser.execute(() => ({
      userAgent: navigator.userAgent,
      displayRuby: CSS.supports("display", "ruby"),
      displayRubyText: CSS.supports("display", "ruby-text"),
      rubyPositionUnder: CSS.supports("ruby-position", "under"),
      rubyPositionAlternate: CSS.supports("ruby-position", "alternate"),
      rubyAlign: CSS.supports("ruby-align", "center"),
      rtDisplay: (() => {
        const ruby = document.body.createEl("ruby");
        ruby.appendText("x");
        const rt = ruby.createEl("rt", { text: "y" });
        const display = getComputedStyle(rt).display;
        const rubyDisplay = getComputedStyle(ruby).display;
        ruby.remove();
        return { rt: display, ruby: rubyDisplay };
      })(),
    }));
  });

  it("hand-written HTML ruby, with Inkline on", async function () {
    const views: Record<string, unknown> = {};
    for (const [name, mode, source] of [
      ["reading", "preview", false],
      ["live-preview", "source", false],
      ["source-mode", "source", true],
    ] as const) {
      await open("Hand.md", mode, source);
      views[name] = await measure(handLabels);
      await shoot(`ruby-hand-${name}-light`);
    }
    await theme("obsidian");
    await open("Hand.md", "preview");
    await shoot("ruby-hand-reading-dark");
    await open("Hand.md", "source");
    await shoot("ruby-hand-live-preview-dark");
    await theme("moonstone");
    results.handInklineOn = views;
  });

  it("hand-written HTML ruby in PDF export", async function () {
    await open("Hand.md", "preview");
    results.handPdf = await exportAndRead("ruby-hand");
  });

  it("the prototype: ruby from what each file holds", async function () {
    await prototype("all");
    await open("Auto.md", "preview");
    await browser.waitUntil(async () => (await annotated()) >= 6, {
      timeout: 30_000,
      timeoutMsg: "the prototype gave no ruby",
    });
    const views: Record<string, unknown> = {};
    views.reading = await measure(autoLabels);
    await shoot("ruby-auto-reading-light");
    await open("Auto.md", "source");
    await browser.waitUntil(async () => (await annotated()) >= 6, {
      timeout: 30_000,
    });
    views.livePreview = await measure(autoLabels);
    await shoot("ruby-auto-live-preview-light");
    await theme("obsidian");
    await open("Auto.md", "preview");
    await shoot("ruby-auto-reading-dark");
    await open("Auto.md", "source");
    await shoot("ruby-auto-live-preview-dark");
    await theme("moonstone");
    // The hand-written note with the prototype on as well.
    await open("Hand.md", "preview");
    views.handReading = await measure(handLabels);
    await shoot("ruby-hand-with-prototype-reading");

    // A reading changed in the file, as from the library or sync, follows.
    await open("Auto.md", "preview");
    await browser.executeObsidian(async ({ app }) => {
      const found = app.vault.getFileByPath("Glyphs/sun.ink.png");
      if (found === null) throw new Error("no sun");
      const { text } = window.inklineTest;
      const bytes = await text.writeText(
        new Uint8Array(await app.vault.readBinary(found)),
        "reading",
        ["ro"],
      );
      await app.vault.modifyBinary(found, bytes.slice().buffer);
    });
    const started = Date.now();
    let followed = true;
    try {
      await browser.waitUntil(
        async () =>
          browser.execute(() =>
            Array.from(activeDocument.querySelectorAll("rt")).some(
              (rt) => rt.textContent === "ro",
            ),
          ),
        { timeout: 15_000 },
      );
    } catch {
      followed = false;
    }
    views.changedReading = {
      followed,
      milliseconds: Date.now() - started,
      after: await measure(["Auto"]),
    };
    await shoot("ruby-auto-reading-changed");

    // Turning Inkline off leaves no ruby behind.
    await obsidianPage.disablePlugin("inkline");
    await browser.pause(500);
    views.afterDisable = await browser.execute(() => ({
      rubies: activeDocument.querySelectorAll("ruby").length,
      images: activeDocument.querySelectorAll(
        ".workspace-leaf.mod-active .markdown-reading-view img",
      ).length,
      marked: activeDocument.querySelectorAll("img[data-inkline-ruby]").length,
    }));
    await obsidianPage.enablePlugin("inkline");
    results.prototypeAll = views;
  });

  it("the prototype in PDF export", async function () {
    await open("Auto.md", "preview");
    await browser.waitUntil(async () => (await annotated()) >= 6, {
      timeout: 30_000,
    });
    results.prototypePdf = await exportAndRead("ruby-auto");
  });

  it("the prototype, only in a note that asks for it", async function () {
    await prototype("note");
    const views: Record<string, unknown> = {};
    for (const file of ["Opted.md", "Unopted.md"]) {
      for (const [name, mode] of [
        ["reading", "preview"],
        ["live-preview", "source"],
      ] as const) {
        await open(file, mode);
        await browser.waitUntil(async () => (await annotated()) >= 1, {
          timeout: 30_000,
        });
        views[`${file}-${name}`] = await measure(["Auto", "Pair"]);
        await shoot(`ruby-note-${file.replace(".md", "")}-${name}`);
      }
    }
    await open("Opted.md", "preview");
    views.pdf = await exportAndRead("ruby-opted");
    results.prototypeNote = views;
    await prototype(undefined);
  });

  it("without Inkline", async function () {
    await obsidianPage.disablePlugin("inkline");
    const views: Record<string, unknown> = {};
    try {
      for (const [name, mode] of [
        ["reading", "preview"],
        ["live-preview", "source"],
      ] as const) {
        await open("Hand.md", mode);
        views[name] = await measure(handLabels);
        await shoot(`ruby-hand-without-inkline-${name}`);
      }
      await open("Auto.md", "preview");
      views.auto = await measure(["Auto", "Pair"]);
      await shoot("ruby-auto-without-inkline-reading");
    } finally {
      await obsidianPage.enablePlugin("inkline");
    }
    results.withoutInkline = views;
  });

  it("published ruby plugins with symbol embeds", async function () {
    const found = existsSync(pluginsDir) ? readdirSync(pluginsDir) : [];
    const report: Record<string, unknown> = {};
    for (const id of found) {
      const note = pluginNotes[id];
      if (note === undefined) continue;
      const read = (file: string) => {
        const at = path.join(pluginsDir, id, file);
        return existsSync(at) ? readFileSync(at, "utf8") : undefined;
      };
      const files = {
        "main.js": read("main.js"),
        "manifest.json": read("manifest.json"),
        "styles.css": read("styles.css"),
      };
      const installed = await browser.executeObsidian(
        async ({ app, obsidian }, pluginId, contents, lines) => {
          const manifest: unknown = JSON.parse(contents["manifest.json"] ?? "");
          const min =
            typeof manifest === "object" && manifest !== null
              ? Reflect.get(manifest, "minAppVersion")
              : undefined;
          if (typeof min === "string" && !obsidian.requireApiVersion(min)) {
            return { installed: false, reason: `needs Obsidian ${min}` };
          }
          const dir = `${app.vault.configDir}/plugins/${pluginId}`;
          if (!(await app.vault.adapter.exists(dir))) {
            await app.vault.adapter.mkdir(dir);
          }
          for (const [name, text] of Object.entries(contents)) {
            if (text !== undefined) {
              await app.vault.adapter.write(`${dir}/${name}`, text);
            }
          }
          const manager: unknown = Reflect.get(app, "plugins");
          if (typeof manager !== "object" || manager === null)
            throw new Error("no plugin manager");
          const call = async (method: string, ...args: unknown[]) => {
            const fn: unknown = Reflect.get(manager, method);
            if (typeof fn !== "function") throw new Error(`no ${method}`);
            return (await Reflect.apply(fn, manager, args)) as unknown;
          };
          await call("loadManifests");
          const enabled = await call("enablePlugin", pluginId);
          const name = `Plugin ${pluginId}.md`;
          if (app.vault.getFileByPath(name) === null) {
            await app.vault.create(
              name,
              [
                "Top line for the cursor.",
                "",
                ...lines.flatMap((line) => [line, ""]),
              ].join("\n"),
            );
          }
          return {
            installed: true,
            enabled,
            version: Reflect.get(manifest as object, "version"),
          };
        },
        id,
        files,
        note.lines,
      );
      const entry: Record<string, unknown> = { ...installed };
      if (installed.installed) {
        const file = `Plugin ${id}.md`;
        for (const [name, mode] of [
          ["reading", "preview"],
          ["live-preview", "source"],
        ] as const) {
          await open(file, mode);
          entry[name] = await measure(note.labels);
          await shoot(`ruby-plugin-${id}-${name}`);
        }
        await browser.executeObsidian(async ({ app }, pluginId) => {
          const manager: unknown = Reflect.get(app, "plugins");
          if (typeof manager !== "object" || manager === null) return;
          const disable: unknown = Reflect.get(manager, "disablePlugin");
          if (typeof disable === "function") {
            await Reflect.apply(disable, manager, [pluginId]);
          }
        }, id);
      }
      report[id] = entry;
    }
    results.plugins = report;
  });
});
