// Follow-up investigation for #167, section 3, after ruby.e2e.ts: what a
// rename does to a symbol used in hand-written ruby, whether Obsidian counts
// such uses as links, how two-sided ruby lines up in each Chromium, whether
// the prototype's Live Preview baseline fix holds, and what copying text from
// a note with the prototype's ruby gives. Not part of the suite; it writes
// ruby-followup-<version>.json. All content is synthetic.

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { browser } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import { loadModules } from "../support/browser.ts";
import { startOver } from "../support/editor.ts";
import { outputDirectory } from "../support/harness.ts";
import { saveScreenshot } from "../support/screenshots.ts";

const output = outputDirectory(
  process.env.E2E_OUTPUT_DIR,
  path.resolve(import.meta.dirname, "../../.."),
);
const results: Record<string, unknown> = {};

/** A narrow sign of two posts and a lintel, and a ring. */
const strokes = {
  tower: [
    { tool: "pen" as const, size: 160, points: [192, 640, 192, 2304] },
    { tool: "pen" as const, size: 160, points: [576, 640, 576, 2304] },
    { tool: "pen" as const, size: 160, points: [64, 640, 704, 640] },
  ],
  sun: [
    {
      tool: "pen" as const,
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
};

const linksNote = [
  "Wiki <ruby>![[sun.ink.png]]<rt>ra</rt></ruby> after.",
  "",
  'Html <ruby><img src="Glyphs/sun.ink.png"><rt>ra</rt></ruby> after.',
  "",
  'Sized <ruby><img src="Glyphs/sun.ink.png" height="24"><rt>ra</rt></ruby> after.',
  "",
  "Plain ![[sun.ink.png]] after.",
  "",
].join("\n");

/** Ways to put a reading over a symbol and a translation under it. */
const sides = [
  "Top line for the cursor.",
  "",
  'Nested <ruby style="ruby-position: under"><ruby style="ruby-position: over">![[tower.ink.png]]<rt>kel</rt></ruby><rt>stronghold</rt></ruby> after.',
  "",
  'Centred <ruby style="ruby-position: under; ruby-align: center"><ruby style="ruby-position: over; ruby-align: center">![[tower.ink.png]]<rt>kel</rt></ruby><rt>stronghold</rt></ruby> after.',
  "",
  'Twort <ruby>![[tower.ink.png]]<rt>kel</rt><rt style="ruby-position: under">stronghold</rt></ruby> after.',
  "",
  'Block <ruby style="ruby-position: under"><span style="display: inline-block"><ruby style="ruby-position: over">![[tower.ink.png]]<rt>kel</rt></ruby></span><rt>stronghold</rt></ruby> after.',
  "",
].join("\n");
const sideLabels = ["Nested", "Centred", "Twort", "Block"];

async function open(file: string, mode: "source" | "preview"): Promise<void> {
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
  await browser.pause(1200);
}

/** Where each labelled line's symbols and ruby texts lie, across. */
async function across(labels: readonly string[]): Promise<unknown[]> {
  return browser.execute((wanted) => {
    const leaf = activeDocument.querySelector(".workspace-leaf.mod-active");
    const reading = leaf?.querySelector(".markdown-reading-view");
    const scope =
      reading?.checkVisibility() === true
        ? reading
        : leaf?.querySelector(".markdown-source-view");
    if (scope === null || scope === undefined) throw new Error("no view");
    const blocks = Array.from(scope.querySelectorAll("p, .cm-line"));
    return wanted.map((label) => {
      const block = blocks.find((each) =>
        (each.textContent ?? "").trim().startsWith(label),
      );
      if (block === undefined) return { label, found: false };
      const centre = (element: Element) => {
        const rect = element.getBoundingClientRect();
        return {
          left: Math.round(rect.left * 10) / 10,
          right: Math.round(rect.right * 10) / 10,
          top: Math.round(rect.top * 10) / 10,
          bottom: Math.round(rect.bottom * 10) / 10,
          centre: Math.round(((rect.left + rect.right) / 2) * 10) / 10,
        };
      };
      const probe = createSpan({
        attr: {
          style:
            "display: inline-block; width: 0; height: 0; vertical-align: baseline",
        },
      });
      const images = Array.from(block.querySelectorAll("img"))
        .filter((image) => !image.classList.contains("cm-widgetBuffer"))
        .map((image) => {
          (image.closest(".image-embed") ?? image).after(probe);
          const baseline = probe.getBoundingClientRect().bottom;
          probe.remove();
          return {
            ...centre(image),
            drop:
              Math.round(
                (image.getBoundingClientRect().bottom - baseline) * 10,
              ) / 10,
            tagged: image.classList.contains("inkline-symbol"),
          };
        });
      return {
        label,
        found: true,
        images,
        rts: Array.from(block.querySelectorAll("rt")).map((rt) => ({
          text: rt.textContent,
          ...centre(rt),
        })),
      };
    });
  }, labels);
}

describe("Ruby around symbols, follow-up (#167, section 3)", function () {
  this.timeout(300_000);
  const run = () =>
    `${browser.getObsidianVersion()}-${browser.getObsidianInstallerVersion()}`;

  before(async function () {
    await startOver();
    await loadModules();
    await browser.executeObsidian(
      async ({ app }, drawn, links, both) => {
        const { canvas, text } = window.inklineTest;
        await app.vault.createFolder("Glyphs");
        for (const [name, list] of Object.entries(drawn)) {
          const saved = await canvas.saveInk({ strokes: list }, undefined, []);
          let bytes: Uint8Array = saved.bytes;
          bytes = await text.writeText(
            bytes,
            "reading",
            name === "sun" ? ["ra"] : ["kel"],
          );
          bytes = await text.writeText(
            bytes,
            "translation",
            name === "sun" ? ["sun"] : ["stronghold"],
          );
          await app.vault.createBinary(
            `Glyphs/${name}.ink.png`,
            bytes.slice().buffer,
          );
        }
        await app.vault.create("Links.md", links);
        await app.vault.create("Sides.md", both);
        await app.vault.create(
          "Copy.md",
          [
            "Top line.",
            "",
            "Copy ![[sun.ink.png]] after.",
            "",
            "Pair ![[tower.ink.png]]![[sun.ink.png]] after.",
            "",
            "First ![[sun.ink.png]] line,",
            "Second ![[tower.ink.png]] line,",
            "Third line.",
            "",
          ].join("\n"),
        );
        await app.vault.create(
          "ImgOnly.md",
          'Only <img src="Glyphs/sun.ink.png"> here.\n',
        );
      },
      strokes,
      linksNote,
      sides,
    );
  });

  after(async function () {
    await writeFile(
      path.join(output, `ruby-followup-${run()}.json`),
      JSON.stringify(results, null, 2),
    );
    await browser.executeObsidian(async ({ plugins }) => {
      const data: unknown = await plugins.inkline.loadData();
      const next: Record<string, unknown> =
        typeof data === "object" && data !== null ? { ...data } : {};
      delete next.rubyPrototype;
      await plugins.inkline.saveData(next);
    });
    await obsidianPage.disablePlugin("inkline");
    await obsidianPage.enablePlugin("inkline");
    await startOver();
  });

  it("counts and renames symbols used in hand-written ruby", async function () {
    await open("Links.md", "preview");
    await browser.pause(1500);
    results.linksBefore = await browser.executeObsidian(({ app }) => {
      const note = app.vault.getFileByPath("Links.md");
      if (note === null) throw new Error("no note");
      const cache = app.metadataCache.getFileCache(note);
      const symbol = app.vault.getFileByPath("Glyphs/sun.ink.png");
      return {
        embeds: (cache?.embeds ?? []).map((embed) => embed.link),
        links: (cache?.links ?? []).map((link) => link.link),
        resolved: app.metadataCache.resolvedLinks["Links.md"] ?? {},
        backlinksOfSymbol:
          symbol === null
            ? null
            : Object.entries(app.metadataCache.resolvedLinks)
                .filter(([, targets]) => symbol.path in targets)
                .map(([from, targets]) => [from, targets[symbol.path]]),
      };
    });
    await saveScreenshot("ruby-followup-links-before");
    // The library's count of notes that use the symbol.
    await browser.executeObsidianCommand("inkline:show-library");
    await browser.pause(1500);
    results.libraryRows = await browser.execute(() =>
      Array.from(
        activeDocument.querySelectorAll(".inkline-library-symbol"),
      ).map((row) => (row.textContent ?? "").replace(/\s+/g, " ").trim()),
    );
    await browser.executeObsidian(async ({ app }) => {
      // Obsidian's question about links would wait for an answer.
      const setConfig: unknown = Reflect.get(app.vault, "setConfig");
      if (typeof setConfig !== "function") throw new Error("no setConfig");
      Reflect.apply(setConfig, app.vault, ["alwaysUpdateLinks", true]);
      const symbol = app.vault.getFileByPath("Glyphs/sun.ink.png");
      if (symbol === null) throw new Error("no symbol");
      await app.fileManager.renameFile(symbol, "Glyphs/sol.ink.png");
    });
    await browser.pause(2500);
    results.afterRename = await browser.executeObsidian(async ({ app }) => {
      const note = app.vault.getFileByPath("Links.md");
      if (note === null) throw new Error("no note");
      return {
        text: await app.vault.read(note),
        unresolved: app.metadataCache.unresolvedLinks["Links.md"] ?? {},
      };
    });
    await open("Links.md", "preview");
    results.afterRenameShown = await across(["Wiki", "Html", "Sized", "Plain"]);
    await saveScreenshot("ruby-followup-links-after-rename");
    // Back, so that later steps find the symbol.
    await browser.executeObsidian(async ({ app }) => {
      const symbol = app.vault.getFileByPath("Glyphs/sol.ink.png");
      if (symbol !== null) {
        await app.fileManager.renameFile(symbol, "Glyphs/sun.ink.png");
      }
    });
    await browser.pause(1500);
  });

  it("lines up a reading over and a translation under, by structure", async function () {
    await open("Sides.md", "preview");
    results.sides = await across(sideLabels);
    await saveScreenshot("ruby-followup-sides");
  });

  it("the prototype's baseline in Live Preview, and copied text", async function () {
    await browser.executeObsidian(async ({ plugins }) => {
      const data: unknown = await plugins.inkline.loadData();
      const next: Record<string, unknown> =
        typeof data === "object" && data !== null ? { ...data } : {};
      next.rubyPrototype = "all";
      await plugins.inkline.saveData(next);
    });
    await obsidianPage.disablePlugin("inkline");
    await obsidianPage.enablePlugin("inkline");
    await open("Copy.md", "preview");
    await browser.waitUntil(
      async () =>
        browser.execute(
          () =>
            activeDocument.querySelectorAll("img[data-inkline-ruby]").length >
            0,
        ),
      { timeout: 30_000 },
    );
    results.copyReading = await browser.execute(() => {
      const paragraph = Array.from(
        activeDocument.querySelectorAll(
          ".workspace-leaf.mod-active .markdown-reading-view p",
        ),
      ).find((each) => (each.textContent ?? "").startsWith("Copy"));
      if (paragraph === undefined) return null;
      const selection = activeWindow.getSelection();
      selection?.selectAllChildren(paragraph);
      const copied = selection?.toString() ?? "";
      selection?.removeAllRanges();
      return { copied, textContent: paragraph.textContent };
    });
    results.readingBaseline = await across(["Copy", "Pair", "First"]);
    await saveScreenshot("ruby-followup-reading-box");
    await open("Copy.md", "source");
    results.livePreviewBaseline = await across(["Copy", "Pair", "First"]);
    await saveScreenshot("ruby-followup-live-preview-baseline");
  });
});
