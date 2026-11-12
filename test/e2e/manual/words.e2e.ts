// Investigation for #167, section 3, second round: words. Not part of the
// suite. After ruby.e2e.ts and ruby-followup.e2e.ts, finds out in real
// Obsidian how a word, a run of symbols in order, could be marked and
// annotated as a unit: what Obsidian itself does with adjacent embeds and
// with explicit marks written around them, in Reading view and Live Preview;
// which layouts put a reading over each symbol and a translation under the
// whole word, by hand, in both Chromiums and in PDF; and how the PROTOTYPE
// (src/render/words.ts, src/notes/words.ts) does with a lexicon kept as a
// note, through edits, renames, and with Inkline off. It writes what it
// measures to words-<version>.json, with screenshots and PDFs. All content is
// synthetic.

import { execFileSync } from "node:child_process";
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

/** Everything measured, written out at the end. */
const results: Record<string, unknown> = {};

type Mode = "source" | "preview";
type Stroke = { tool: "pen"; size: number; points: number[] };

const u = (values: number[]) => values.map((value) => value * 16);

/** A small syllabary: shapes, readings, and one logogram with a meaning. */
const symbols: {
  name: string;
  strokes: Stroke[];
  reading: string[];
  translation: string[];
}[] = [
  {
    name: "ring",
    strokes: [
      {
        tool: "pen",
        size: 160,
        points: Array.from({ length: 33 }, (_, index) => {
          const angle = (index / 32) * 2 * Math.PI;
          return [
            Math.round(16 * (34 + 24 * Math.cos(angle))),
            Math.round(16 * (116 + 24 * Math.sin(angle))),
          ];
        }).flat(),
      },
    ],
    reading: ["ka"],
    translation: [],
  },
  {
    name: "posts",
    strokes: [
      { tool: "pen", size: 160, points: u([12, 60, 12, 140]) },
      { tool: "pen", size: 160, points: u([36, 60, 36, 140]) },
      { tool: "pen", size: 160, points: u([4, 60, 44, 60]) },
    ],
    reading: ["ri"],
    translation: [],
  },
  {
    name: "zig",
    strokes: [
      { tool: "pen", size: 160, points: u([8, 130, 24, 80, 40, 130, 56, 80]) },
    ],
    reading: ["to"],
    translation: [],
  },
  {
    // Two readings: which one a word uses depends on the word.
    name: "hook",
    strokes: [
      {
        tool: "pen",
        size: 160,
        points: u([14, 60, 14, 124, 20, 138, 32, 142, 42, 132]),
      },
    ],
    reading: ["mu", "bu"],
    translation: [],
  },
  {
    // Nothing known about it yet.
    name: "dot",
    strokes: [{ tool: "pen", size: 400, points: u([20, 120]) }],
    reading: [],
    translation: [],
  },
  {
    // A logogram: a meaning of its own.
    name: "cross",
    strokes: [
      { tool: "pen", size: 160, points: u([8, 100, 56, 100]) },
      { tool: "pen", size: 160, points: u([32, 70, 32, 130]) },
    ],
    reading: ["sa"],
    translation: ["one"],
  },
];

const e = (name: string) => `![[${name}.ink.png]]`;
const run = (...names: string[]) => names.map(e).join("");
const img = (name: string) => `<img src="Glyphs/${name}.ink.png">`;

const lexiconNote = [
  "---",
  "inkline: lexicon",
  "---",
  "",
  "| Word | Reading | Meaning |",
  "| ---- | ------- | ------- |",
  `| ${run("ring", "posts")} |  | river |`,
  `| ${run("zig", "ring", "posts")} |  | ferry crossing |`,
  `| ${run("hook", "hook")} | mmu | night |`,
  `| ${run("posts", "dot")} |  | home |`,
  `| ${run("zig")} |  | boat |`,
  "",
].join("\n");

const longRun = Array.from({ length: 10 }, () =>
  run("ring", "posts", "zig", "hook", "dot", "cross"),
).join("");

const wordsNote = [
  "Top line for the cursor.",
  "",
  `Spaced ${run("ring", "posts")} ${run("hook", "hook")} ${run("posts", "dot")} end.`,
  "",
  `Unspaced ${run("zig", "ring", "posts", "hook", "hook")} end.`,
  "",
  `Unknown ${run("ring", "zig", "posts")} ${e("cross")} ${e("hook")} end.`,
  "",
  "Markdown ![](Glyphs/ring.ink.png)![](Glyphs/posts.ink.png) end.",
  "",
  `Neighbours ${run("zig", "ring", "posts")} ${run("ring", "posts")} end.`,
  "",
  `Lines first ${run("ring", "posts")} here,`,
  `second ${run("hook", "hook")} there,`,
  "third line.",
  "",
  `Long ${longRun} end.`,
  "",
  // A zero-width space, U+200B, as a word break that shows nowhere.
  `Zwsp ${e("zig")}​${run("ring", "posts")} end.`,
  "",
].join("\n");
const wordLabels = [
  "Spaced",
  "Unspaced",
  "Unknown",
  "Markdown",
  "Neighbours",
  "Lines",
  "Long",
  "Zwsp",
];

/** Explicit marks around a word, with symbols the lexicon does not know. */
const formsNote = [
  "Top line for the cursor.",
  "",
  `Braces {${run("ring", "zig")}|ford} end.`,
  "",
  `Linkwiki [${run("ring", "zig")}](Lexicon.md) end.`,
  "",
  "Linkmd [![](Glyphs/ring.ink.png)![](Glyphs/zig.ink.png)](Lexicon.md) end.",
  "",
  `Htmlover <ruby>${run("ring", "zig")}<rt>ford</rt></ruby> end.`,
  "",
  `Htmlunder <ruby style="ruby-position: under">${run("ring", "zig")}<rt>ford</rt></ruby> end.`,
  "",
  `Footnote ${run("ring", "zig")}[^1] end.`,
  "",
  `Comment ${run("ring", "zig")}%%ford%% end.`,
  "",
  "> [!gloss]",
  `> Gloss ${run("ring", "zig")} ${run("hook", "hook")}`,
  "> kato mmu",
  "> ford night",
  "",
  "[^1]: ford",
  "",
].join("\n");
const formLabels = [
  "Braces",
  "Linkwiki",
  "Linkmd",
  "Htmlover",
  "Htmlunder",
  "Footnote",
  "Comment",
  "Gloss",
];

// The inner ruby says "over": ruby-position is inherited from the outer one.
const tier = (reading: string, name: string) =>
  `<ruby style="ruby-position: over">${img(name)}<rt>${reading}</rt></ruby>`;
const nest = (inner: string, under: string) =>
  `<ruby style="ruby-position: under">${inner}<rt>${under}</rt></ruby>`;
const box = (inner: string) =>
  `<span style="display: inline-block">${inner}</span>`;
const caption = (text: string, side: "top" | "bottom") =>
  `<span style="display: table-caption; caption-side: ${side}; font-size: 0.5em; line-height: 1.2; white-space: nowrap">${text}</span>`;
const table = (inner: string) =>
  `<span style="display: inline-table; text-align: center">${inner}</span>`;
const river = tier("ka", "ring") + tier("ri", "posts");
const ferry = tier("to", "zig") + tier("ka", "ring") + tier("ri", "posts");

/** Two tiers written by hand: a reading over each symbol, a meaning under. */
const structuresNote = [
  "Top line for the cursor.",
  "",
  `Nest ${nest(river, "river")} ${nest(ferry, "ferry crossing")} end.`,
  "",
  `Box ${nest(box(river), "river")} ${nest(box(ferry), "ferry crossing")} end.`,
  "",
  `Table ${table(river + caption("river", "bottom"))} ${table(ferry + caption("ferry crossing", "bottom"))} end.`,
  "",
  `Whole ${nest(box(`<ruby style="ruby-position: over">${img("hook")}${img("hook")}<rt>mmu</rt></ruby>`), "night")} end.`,
  "",
  `Wholenest ${nest(`<ruby style="ruby-position: over">${img("hook")}${img("hook")}<rt>mmu</rt></ruby>`, "night")} end.`,
  "",
  `Tablewhole ${table(caption("mmu", "top") + img("hook") + img("hook") + caption("night", "bottom"))} end.`,
  "",
  `Lines ${nest(box(river), "river")} first,<br>second ${table(river + caption("river", "bottom"))} line,<br>third line.`,
  "",
].join("\n");
const structureLabels = [
  "Nest",
  "Box",
  "Table",
  "Whole",
  "Wholenest",
  "Tablewhole",
  "Lines",
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

/**
 * What each labelled block of the active view shows: its symbols, words,
 * ruby text and captions, where they are, and its text and markup.
 */
async function measure(labels: readonly string[]): Promise<unknown[]> {
  return browser.execute((wanted) => {
    const leaf = activeDocument.querySelector(".workspace-leaf.mod-active");
    const reading = leaf?.querySelector(".markdown-reading-view");
    const scope =
      reading?.checkVisibility() === true
        ? reading
        : leaf?.querySelector(".markdown-source-view");
    if (scope === null || scope === undefined) throw new Error("no view");
    const blocks = Array.from(
      scope.querySelectorAll(
        "p, .cm-line, li, .callout-content p, .callout-content",
      ),
    );
    const round = (value: number) => Math.round(value * 10) / 10;
    const box = (rect: DOMRect) => ({
      left: round(rect.left),
      right: round(rect.right),
      top: round(rect.top),
      bottom: round(rect.bottom),
      centre: round((rect.left + rect.right) / 2),
    });
    return wanted.map((label) => {
      const block = blocks.find((each) =>
        (each.textContent ?? "")
          .replace(/^\s+/, "")
          .startsWith(label),
      );
      if (block === undefined) return { label, found: false };
      const probe = createSpan({
        attr: {
          style:
            "display: inline-block; width: 0; height: 0; vertical-align: baseline",
        },
      });
      const words = Array.from(block.querySelectorAll(".inkline-word"));
      const images = Array.from(block.querySelectorAll("img"))
        .filter((image) => !image.classList.contains("cm-widgetBuffer"))
        .map((image) => {
          // The baseline of the text the symbol is in.
          const holder =
            image.closest(".inkline-word") ??
            image.closest(".image-embed") ??
            image;
          holder.after(probe);
          const baseline = probe.getBoundingClientRect().bottom;
          probe.remove();
          const rect = image.getBoundingClientRect();
          return {
            ...box(rect),
            name: (image.getAttribute("src") ?? "")
              .replace(/^.*\//, "")
              .replace(/\.ink\.png.*$/, ""),
            drop: round(rect.bottom - baseline),
            tagged: image.classList.contains("inkline-symbol"),
            word: words.findIndex((word) => word.contains(image)),
          };
        });
      const labelRange = activeDocument.createRange();
      const walker = activeDocument.createTreeWalker(
        block,
        NodeFilter.SHOW_TEXT,
      );
      const labelBoxes: Record<string, unknown> = {};
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        const text = node.nodeValue ?? "";
        for (const word of ["first", "second", "third", "end", label]) {
          if (labelBoxes[word] !== undefined) continue;
          const at = text.indexOf(word);
          if (at === -1 || node.parentElement?.closest("rt") !== null) continue;
          labelRange.setStart(node, at);
          labelRange.setEnd(node, at + word.length);
          labelBoxes[word] = box(labelRange.getBoundingClientRect());
        }
      }
      const style = (element: Element, pseudo: string) => {
        const computed = getComputedStyle(element, pseudo);
        return {
          content: computed.content,
          display: computed.display,
          fontSize: computed.fontSize,
        };
      };
      const blockRect = block.getBoundingClientRect();
      const tops = new Set(
        images.map((image) => Math.round(image.top / 4) * 4),
      );
      return {
        label,
        found: true,
        tag: block.tagName.toLowerCase(),
        blockHeight: round(blockRect.height),
        overflows: block.scrollWidth > block.clientWidth + 1,
        imageLines: tops.size,
        labels: labelBoxes,
        text: (block.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 240),
        images,
        words: words.map((word) => {
          const rows = Array.from(word.querySelectorAll("img")).map((image) =>
            image.getBoundingClientRect(),
          );
          const rubies = Array.from(word.querySelectorAll("ruby")).map((ruby) =>
            ruby.getBoundingClientRect(),
          );
          const content = [...rows, ...rubies];
          return {
            ...box(word.getBoundingClientRect()),
            over: word.getAttribute("data-inkline-over"),
            under: word.getAttribute("data-inkline-under"),
            display: getComputedStyle(word).display,
            symbols: rows.length,
            contentTop: round(Math.min(...content.map((rect) => rect.top))),
            contentBottom: round(
              Math.max(...content.map((rect) => rect.bottom)),
            ),
            before: style(word, "::before"),
            after: style(word, "::after"),
          };
        }),
        rts: Array.from(block.querySelectorAll("rt")).map((rt) => {
          const rect = rt.getBoundingClientRect();
          return {
            text: rt.textContent,
            ...box(rect),
            visible: rect.width > 0 && rect.height > 0,
          };
        }),
        captions: Array.from(block.querySelectorAll("span"))
          .filter((span) => getComputedStyle(span).display === "table-caption")
          .map((span) => ({
            text: span.textContent,
            ...box(span.getBoundingClientRect()),
          })),
        literal: /\{|\}|%%|\[\^|<\/?r[tb]|<\/?ruby|!\[\[|\]\(/.test(
          block.textContent ?? "",
        ),
        html: block.outerHTML
          .replace(/app:\/\/[^"]*\/(Glyphs\/)?/g, "app://…/")
          .replace(/--inkline-mask: url\([^)]*\);?/g, "")
          .replace(/ style="[^"]*"/g, "")
          .slice(0, 2400),
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

async function createVault(): Promise<void> {
  await loadModules();
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
        await app.vault.createBinary(
          `Glyphs/${symbol.name}.ink.png`,
          bytes.slice().buffer,
        );
      }
      for (const [name, body] of Object.entries(notes)) {
        await app.vault.create(name, body);
      }
    },
    symbols,
    {
      "Lexicon.md": lexiconNote,
      "Words.md": wordsNote,
      "Forms.md": formsNote,
      "Structures.md": structuresNote,
    },
  );
}

/** Sets the prototype's mode and restarts Inkline, which reads it. */
async function prototype(
  mode: "all" | undefined,
  glyphs: "ruby" | "caption" = "ruby",
): Promise<void> {
  await browser.executeObsidian(
    async ({ plugins }, chosen, style) => {
      const data: unknown = await plugins.inkline.loadData();
      const next: Record<string, unknown> =
        typeof data === "object" && data !== null ? { ...data } : {};
      if (chosen === undefined) {
        delete next.rubyPrototype;
        delete next.rubyGlyphs;
      } else {
        next.rubyPrototype = chosen;
        next.rubyGlyphs = style;
      }
      await plugins.inkline.saveData(next);
    },
    mode,
    glyphs,
  );
  await obsidianPage.disablePlugin("inkline");
  await obsidianPage.enablePlugin("inkline");
}

/** What the prototype's lexicon holds, and how it splits `paths`. */
async function lexicon(paths: string[] = []): Promise<{
  entries: [string, unknown][];
  longest: number;
  builds: number[];
  pieces: unknown[];
}> {
  return browser.executeObsidian(({ plugins }, wanted) => {
    const words: unknown = Reflect.get(plugins.inkline, "prototypeWords");
    if (typeof words !== "function") throw new Error("no prototype");
    return Reflect.apply(words, plugins.inkline, [wanted]) as {
      entries: [string, unknown][];
      longest: number;
      builds: number[];
      pieces: unknown[];
    };
  }, paths);
}

/** What Obsidian's index says a note embeds and links, with positions. */
async function links(note: string): Promise<unknown> {
  return browser.executeObsidian(({ app }, file) => {
    const found = app.vault.getFileByPath(file);
    if (found === null) throw new Error(`no ${file}`);
    const cache = app.metadataCache.getFileCache(found);
    const place = (item: { link: string; position: { start: { line: number; col: number }; end: { col: number } } }) =>
      `${item.link} @${String(item.position.start.line)}:${String(item.position.start.col)}-${String(item.position.end.col)}`;
    return {
      embeds: (cache?.embeds ?? []).map(place),
      links: (cache?.links ?? []).map(place),
      footnotes: (cache?.footnotes ?? []).length,
      resolved: app.metadataCache.resolvedLinks[file] ?? {},
    };
  }, note);
}

interface PrintCapture {
  words: unknown[];
  images: unknown[];
  closed: boolean;
  error?: string | undefined;
  restore(): void;
}

declare global {
  interface Window {
    inklineWordsPrint?: PrintCapture;
  }
}

/** Exports the active note to `pdf`, as ruby.e2e.ts does. */
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
      words: [],
      images: [],
      closed: false,
      restore: () => {
        window.open = open;
        Object.defineProperty(dialog, "showSaveDialog", descriptor);
        for (const observer of observers) observer.disconnect();
      },
    };
    window.inklineWordsPrint = capture;
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
        }));
        capture.words = Array.from(doc.querySelectorAll(".print .inkline-word")).map(
          (word) => ({
            ...box(word),
            under: word.getAttribute("data-inkline-under"),
            over: word.getAttribute("data-inkline-over"),
          }),
        );
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
        browser.execute(() => window.inklineWordsPrint?.closed === true),
      { timeoutMsg: "the export window stayed open" },
    );
    return await browser.execute(() => {
      const capture = window.inklineWordsPrint;
      if (capture === undefined) throw new Error("no capture");
      return {
        words: capture.words,
        images: capture.images,
        closed: capture.closed,
        error: capture.error,
      };
    });
  } finally {
    await browser.execute(() => {
      window.inklineWordsPrint?.restore();
      delete window.inklineWordsPrint;
    });
  }
}

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
  execFileSync("pdftoppm", [
    "-singlefile",
    "-r",
    "200",
    "-png",
    pdf,
    `${prefix}-200`,
  ]);
  return { capture, words: pdfWords(pdf) };
}

async function wordCount(): Promise<number> {
  return browser.execute(
    () =>
      activeDocument.querySelectorAll(
        ".workspace-leaf.mod-active .inkline-word",
      ).length,
  );
}

describe("Words of several symbols (#167, section 3)", function () {
  this.timeout(900_000);
  const version = () =>
    `${browser.getObsidianVersion()}-${browser.getObsidianInstallerVersion()}`;

  before(async function () {
    await startOver();
    await prototype(undefined);
    await createVault();
  });

  after(async function () {
    await writeFile(
      path.join(output, `words-${version()}.json`),
      JSON.stringify(results, null, 2),
    );
    await prototype(undefined);
    await theme("moonstone");
    await startOver();
  });

  it("records the host", async function () {
    results.host = await browser.execute(() => ({
      userAgent: navigator.userAgent,
      displayRuby: CSS.supports("display", "ruby"),
      captionSide: CSS.supports("caption-side", "bottom"),
    }));
  });

  // Measured in run 1: Obsidian's own behaviour does not change with the
  // prototype's styles.
  it.skip("what Obsidian does with adjacent embeds and explicit marks", async function () {
    const views: Record<string, unknown> = {};
    await open("Words.md", "preview");
    views.wordsReading = await measure(["Spaced", "Markdown"]);
    await open("Words.md", "source");
    views.wordsLive = await measure(["Spaced", "Markdown"]);
    views.wordsLinks = await links("Words.md");
    for (const [name, mode] of [
      ["reading", "preview"],
      ["live", "source"],
    ] as const) {
      await open("Forms.md", mode);
      views[`forms-${name}`] = await measure(formLabels);
      await shoot(`words-forms-native-${name}`);
    }
    views.formsLinks = await links("Forms.md");
    results.native = views;
  });

  // Measured in run 2.
  it.skip("two tiers written by hand, in both views and PDF", async function () {
    const views: Record<string, unknown> = {};
    for (const [name, mode] of [
      ["reading", "preview"],
      ["live", "source"],
    ] as const) {
      await open("Structures.md", mode);
      views[name] = await measure(structureLabels);
      await shoot(`words-structures-${name}-light`);
      await theme("obsidian");
      await shoot(`words-structures-${name}-dark`);
      await theme("moonstone");
    }
    await open("Structures.md", "preview");
    views.pdf = await exportAndRead("words-structures");
    results.structures = views;
  });

  // Run 3 checks the caption style only; run 2 measured both.
  for (const style of ["caption"] as const) {
  it(`the prototype: words from a lexicon note, symbols' values as ${style}`, async function () {
    await prototype("all", style);
    await browser.waitUntil(
      async () => (await lexicon()).entries.length >= 5,
      { timeout: 30_000, timeoutMsg: "the lexicon was not read" },
    );
    const paths = (names: string[]) =>
      names.map((name) => `Glyphs/${name}.ink.png`);
    const known = await lexicon(
      paths(["zig", "ring", "posts", "hook", "hook"]),
    );
    results.lexicon = {
      entries: known.entries,
      longest: known.longest,
      unspaced: known.pieces,
      unknown: (await lexicon(paths(["ring", "zig", "posts"]))).pieces,
      // Readings made from the symbols' own, for comparison.
      composed: [
        ["ring", "posts"],
        ["hook", "hook"],
        ["posts", "dot"],
        ["zig", "ring", "posts"],
      ].map((names) => ({
        word: names.join(" "),
        joined: names
          .map(
            (name) =>
              symbols.find((symbol) => symbol.name === name)?.reading[0] ??
              "?",
          )
          .join(""),
        lexicon: known.entries.find(([key]) =>
          key === paths(names).join(" + "),
        )?.[1],
      })),
    };
    const views: Record<string, unknown> = {};
    await open("Words.md", "preview");
    await browser.waitUntil(async () => (await wordCount()) > 0, {
      timeout: 30_000,
      timeoutMsg: "no words in Reading view",
    });
    await browser.waitUntil(
      async () =>
        browser.execute(
          () =>
            activeDocument.querySelectorAll("img[data-inkline-ruby]").length >
            0,
        ),
      { timeout: 30_000, timeoutMsg: "no readings" },
    );
    await browser.pause(800);
    views.reading = await measure(wordLabels);
    views.copy = await browser.execute(() => {
      const paragraph = Array.from(
        activeDocument.querySelectorAll(
          ".workspace-leaf.mod-active .markdown-reading-view p",
        ),
      ).find((each) => (each.textContent ?? "").startsWith("Spaced"));
      if (paragraph === undefined) return null;
      const selection = activeWindow.getSelection();
      selection?.selectAllChildren(paragraph);
      const copied = selection?.toString() ?? "";
      selection?.removeAllRanges();
      return copied;
    });
    await shoot(`words-${style}-reading-light`);
    await theme("obsidian");
    await shoot(`words-${style}-reading-dark`);
    await theme("moonstone");
    await open("Words.md", "source");
    await browser.waitUntil(async () => (await wordCount()) > 0, {
      timeout: 15_000,
      timeoutMsg: "no words in Live Preview",
    });
    views.live = await measure(wordLabels);
    await shoot(`words-${style}-live-light`);
    await theme("obsidian");
    await shoot(`words-${style}-live-dark`);
    await theme("moonstone");
    // The cursor in a word: that word shows plain, as a link being edited.
    await browser.executeObsidian(({ app, obsidian }) => {
      const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
      if (view === null) throw new Error("no view");
      const line = view.editor.getLine(2);
      view.editor.setCursor({ line: 2, ch: line.indexOf("![[hook") + 3 });
    });
    await browser.pause(800);
    views.liveCursorInWord = await measure(["Spaced"]);
    await saveScreenshot(`words-${style}-live-cursor`);
    // The lexicon itself.
    await open("Lexicon.md", "preview");
    await shoot("words-lexicon-reading");
    await open("Lexicon.md", "source");
    await shoot("words-lexicon-live");
    // Explicit marks, now with the prototype.
    for (const [name, mode] of [
      ["reading", "preview"],
      ["live", "source"],
    ] as const) {
      await open("Forms.md", mode);
      views[`forms-${name}`] = await measure(formLabels);
      await shoot(`words-forms-${style}-${name}`);
    }
    views.styles = await browser.execute(() => {
      // The rules that set how Obsidian shows an embed in Live Preview.
      const rules: string[] = [];
      const visit = (list: CSSRuleList) => {
        for (const rule of Array.from(list)) {
          if (rule instanceof CSSStyleRule) {
            if (
              /internal-embed|image-embed/.test(rule.selectorText) &&
              rule.style.display !== ""
            ) {
              rules.push(
                `${rule.selectorText} { display: ${rule.style.display} }`,
              );
            }
          } else if (rule instanceof CSSGroupingRule) {
            visit(rule.cssRules);
          }
        }
      };
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          visit(sheet.cssRules);
        } catch {
          // Another origin's sheet.
        }
      }
      const shown = (selector: string) => {
        const found = activeDocument.querySelector(selector);
        return found === null ? null : getComputedStyle(found).display;
      };
      return {
        rules: rules.slice(0, 40),
        loneEmbed: shown(".cm-line > .internal-embed.image-embed"),
        wordEmbed: shown(
          ".cm-line .inkline-word > .internal-embed.image-embed",
        ),
      };
    });
    results[`prototype-${style}`] = views;
  });
  }

  it("the prototype in PDF export", async function () {
    await open("Words.md", "preview");
    await browser.waitUntil(async () => (await wordCount()) > 0, {
      timeout: 15_000,
    });
    results.prototypePdf = await exportAndRead("words-proto");
  });

  // Measured in runs 1 and 2.
  it.skip("the lexicon follows edits and renames", async function () {
    const steps: Record<string, unknown> = {};
    await open("Words.md", "preview");
    await browser.waitUntil(async () => (await wordCount()) > 0, {
      timeout: 15_000,
    });
    // Edit the lexicon as a person would, in its note.
    steps.edit = await browser.executeObsidian(async ({ app }) => {
      const note = app.vault.getFileByPath("Lexicon.md");
      if (note === null) throw new Error("no lexicon");
      const started = Date.now();
      await app.vault.process(note, (text) =>
        text.replace("| river |", "| stream |"),
      );
      for (;;) {
        const found = activeDocument.querySelector(
          '.workspace-leaf.mod-active .inkline-word[data-inkline-under="stream"]',
        );
        if (found !== null) return { ms: Date.now() - started };
        if (Date.now() - started > 15_000) return { ms: null };
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    });
    // Rename a symbol, with Obsidian updating links.
    await browser.executeObsidian(async ({ app }) => {
      const setConfig: unknown = Reflect.get(app.vault, "setConfig");
      if (typeof setConfig !== "function") throw new Error("no setConfig");
      Reflect.apply(setConfig, app.vault, ["alwaysUpdateLinks", true]);
      const symbol = app.vault.getFileByPath("Glyphs/ring.ink.png");
      if (symbol === null) throw new Error("no symbol");
      await app.fileManager.renameFile(symbol, "Glyphs/circle.ink.png");
    });
    await browser.pause(3000);
    steps.afterRename = await browser.executeObsidian(async ({ app }) => {
      const read = async (file: string) => {
        const found = app.vault.getFileByPath(file);
        return found === null ? null : await app.vault.read(found);
      };
      return {
        lexicon: await read("Lexicon.md"),
        words: (await read("Words.md"))?.split("\n").slice(0, 6),
        forms: (await read("Forms.md"))?.split("\n").slice(0, 16),
      };
    });
    steps.lexiconAfterRename = (await lexicon()).entries;
    await open("Words.md", "preview");
    await browser.pause(1000);
    steps.readingAfterRename = await measure(["Spaced", "Neighbours"]);
    await open("Words.md", "source");
    steps.liveAfterRename = await measure(["Spaced"]);
    await saveScreenshot("words-proto-after-rename");
    results.follow = steps;
  });

  it.skip("without Inkline", async function () {
    const views: Record<string, unknown> = {};
    await obsidianPage.disablePlugin("inkline");
    await open("Words.md", "preview");
    views.words = await measure(["Spaced", "Unspaced"]);
    await shoot("words-without-reading");
    await open("Words.md", "source");
    views.wordsLive = await measure(["Spaced"]);
    await shoot("words-without-live");
    await open("Lexicon.md", "preview");
    await shoot("words-without-lexicon");
    await open("Forms.md", "preview");
    views.forms = await measure(formLabels);
    await shoot("words-without-forms-reading");
    await open("Forms.md", "source");
    views.formsLive = await measure(formLabels);
    await shoot("words-without-forms-live");
    views.leftover = await browser.execute(() => ({
      words: document.querySelectorAll(".inkline-word").length,
      tagged: document.querySelectorAll("img.inkline-symbol").length,
      htmlImages: document.querySelectorAll("img.inkline-html-image").length,
    }));
    await obsidianPage.enablePlugin("inkline");
    results.without = views;
  });
});
