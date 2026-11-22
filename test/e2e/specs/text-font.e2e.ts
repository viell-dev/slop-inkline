import { browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import { loadModules } from "../support/browser.ts";
import { inklineOn, insert, zigzag } from "../support/editing.ts";
import {
  draw,
  drawAndHold,
  guideRows,
  settledSurface,
  undoStubs,
  startOver,
} from "../support/editor.ts";

describe("The editor", function () {
  before(async function () {
    await loadModules();
  });

  beforeEach(async function () {
    await startOver();
  });

  // A test that fails midway can leave a file operation held or replaced, or
  // Inkline off, which every test after it would then fail on.
  afterEach(async function () {
    await undoStubs();
    if (!(await inklineOn())) {
      await obsidianPage.enablePlugin("inkline");
      await loadModules();
    }
  });

  it("measures the vault's text font, not the interface's", async function () {
    await browser.execute(() => {
      document.body.setCssProps({
        "--font-text": '"DejaVu Serif", serif',
        "--font-text-size": "28px",
      });
    });
    try {
      await insert();
      await settledSurface();
      const preview = await browser.execute(() => {
        const line = document.querySelector(".inkline-editor .inkline-preview");
        const ink = document.querySelector(
          ".inkline-editor .inkline-preview-ink",
        );
        if (!(line instanceof HTMLElement) || !(ink instanceof HTMLElement)) {
          throw new Error("no preview");
        }
        const font = getComputedStyle(line);
        return {
          family: font.fontFamily,
          size: font.fontSize,
          height: ink.getBoundingClientRect().height,
        };
      });
      expect(preview.family).toContain("DejaVu Serif");
      expect(preview.size).toBe("28px");
      expect(preview.height).toBeCloseTo(42, 1);
      const rows = await guideRows();
      expect(rows.shown).toBe(rows.lines);
    } finally {
      await browser.execute(() => {
        document.body.style.removeProperty("--font-text");
        document.body.style.removeProperty("--font-text-size");
      });
    }
  });

  it("measures the font again once it loads", async function () {
    await browser.execute(() => {
      document.body.setCssProps({ "--font-text": '"Inkline Late", monospace' });
    });
    try {
      await insert();
      await settledSurface();
      const before = await guideRows();
      expect(before.shown).toBe(before.lines);
      await browser.execute(async () => {
        const face = new FontFace("Inkline Late", "local('DejaVu Serif')");
        document.fonts.add(face);
        await face.load();
      });
      // The guides follow the loaded font, which the rows now predict.
      await browser.waitUntil(async () => {
        const after = await guideRows();
        return (
          after.shown === after.lines &&
          after.rows.join() !== before.rows.join()
        );
      });
    } finally {
      await browser.execute(() => {
        document.body.style.removeProperty("--font-text");
        for (const face of document.fonts) {
          if (face.family.includes("Inkline Late")) document.fonts.delete(face);
        }
      });
    }
  });

  it("measures the font in the window the editor opens in", async function () {
    await browser.executeObsidian(async ({ app }) => {
      const file = app.vault.getFileByPath("Editor.md");
      if (file === null) throw new Error("no Editor.md");
      await app.workspace.openPopoutLeaf().openFile(file);
    });
    try {
      // A font that only the popout has, as its text font.
      await browser.waitUntil(async () =>
        browser.executeObsidian(({ app, obsidian }) => {
          const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
          return (
            view !== null &&
            view.containerEl.doc !== document &&
            view.editor.getValue().includes("HERE")
          );
        }),
      );
      await browser.executeObsidian(async ({ app, obsidian }) => {
        const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
        const doc = view?.containerEl.doc;
        const win = doc?.defaultView;
        if (
          view === null ||
          doc === undefined ||
          win === null ||
          win === undefined
        ) {
          throw new Error("no popout");
        }
        const face = new win.FontFace(
          "Inkline Popout Only",
          "local('DejaVu Serif')",
        );
        doc.fonts.add(face);
        await face.load();
        doc.body.setCssProps({
          "--font-text": '"Inkline Popout Only", monospace',
        });
        const editor = view.editor;
        const at = editor.getValue().indexOf("HERE");
        editor.setSelection(editor.offsetToPos(at), editor.offsetToPos(at + 4));
        editor.replaceSelection("");
        editor.focus();
      });
      await browser.executeObsidianCommand("inkline:insert-symbol");
      await browser.waitUntil(async () =>
        browser.execute(
          () =>
            activeDocument !== document &&
            activeDocument.querySelector(".inkline-editor .inkline-surface") !==
              null,
        ),
      );
      // The main window does not have the font, so it measures otherwise.
      const elsewhere = await browser.execute(() => {
        const context = new OffscreenCanvas(1, 1).getContext("2d");
        if (context === null) throw new Error("no context");
        context.font = '128px "Inkline Popout Only", monospace';
        return context.measureText("x").actualBoundingBoxAscent;
      });
      const there = await browser.execute(() => {
        const view = activeDocument.defaultView;
        if (view === null) throw new Error("no window");
        const context = new view.OffscreenCanvas(1, 1).getContext("2d");
        if (context === null) throw new Error("no context");
        context.font = '128px "Inkline Popout Only", monospace';
        return context.measureText("x").actualBoundingBoxAscent;
      });
      expect(there).not.toBe(elsewhere);
      await browser.waitUntil(async () => {
        const rows = await guideRows();
        return rows.shown === rows.lines;
      });
    } finally {
      // Disabling Inkline closes the popout's editor; then the popout goes.
      await obsidianPage.disablePlugin("inkline");
      await obsidianPage.enablePlugin("inkline");
      await loadModules();
      await browser.executeObsidian(({ app }) => {
        for (const leaf of app.workspace.getLeavesOfType("markdown")) {
          if (leaf.view.containerEl.doc !== document) leaf.detach();
        }
      });
    }
  });

  it("shows the symbol at its size in a line of text, as it is drawn", async function () {
    await insert();
    const preview = () =>
      browser.execute(() => {
        const canvas = document.querySelector(
          ".inkline-editor .inkline-preview-ink",
        );
        const line = document.querySelector(".inkline-editor .inkline-preview");
        if (
          !(canvas instanceof HTMLCanvasElement) ||
          !(line instanceof HTMLElement)
        ) {
          throw new Error("no preview");
        }
        const pixels = canvas
          .getContext("2d")
          ?.getImageData(0, 0, canvas.width, canvas.height);
        let ink = 0;
        for (let index = 3; index < (pixels?.data.length ?? 0); index += 4) {
          if ((pixels?.data[index] ?? 0) > 0) ink++;
        }
        return {
          fontSize: Number.parseFloat(getComputedStyle(line).fontSize),
          width: canvas.getBoundingClientRect().width,
          height: canvas.getBoundingClientRect().height,
          ink,
        };
      });
    const empty = await preview();
    // The line box is 1.5 em tall, and an empty symbol 3/8 em wide.
    expect(empty.height).toBeCloseTo(1.5 * empty.fontSize, 1);
    expect(empty.width).toBeCloseTo(0.375 * empty.fontSize, 1);
    expect(empty.ink).toBe(0);
    // An eraser on no ink makes no image wider.
    await browser.keys(["e"]);
    await draw([
      [0.3, 0.5],
      [0.7, 0.5],
    ]);
    expect((await preview()).width).toBeCloseTo(empty.width, 1);
    await browser.keys(["p"]);
    // While the stroke is still being drawn, the preview shows it. That is
    // read in the page as the release arrives, before the editor takes it, as
    // a read in a command of its own would come after the press had already
    // ended as a lost capture (#391).
    await browser.execute(() => {
      window.addEventListener(
        "pointerup",
        () => {
          const canvas = document.querySelector(
            ".inkline-editor .inkline-preview-ink",
          );
          if (!(canvas instanceof HTMLCanvasElement)) return;
          const pixels = canvas
            .getContext("2d")
            ?.getImageData(0, 0, canvas.width, canvas.height).data;
          let ink = 0;
          for (let index = 3; index < (pixels?.length ?? 0); index += 4) {
            if ((pixels?.[index] ?? 0) > 0) ink++;
          }
          Reflect.set(window, "inklineHeldInk", ink);
        },
        { capture: true, once: true },
      );
    });
    await drawAndHold([
      [0.45, 0.5],
      [0.55, 0.55],
    ]);
    expect(
      await browser.execute(
        () => Reflect.get(window, "inklineHeldInk") as unknown,
      ),
    ).toBeGreaterThan(0);
    const short = await preview();
    await draw([
      [0.5, 0.3],
      [0.9, 0.3],
    ]);
    await browser.waitUntil(
      async () => (await preview()).width > short.width + 1,
    );
  });

  it("shows the preview in the text colour after a theme changes it", async function () {
    await insert();
    await draw(zigzag);
    // The red of the preview's most opaque ink, or -1 with none nearly so.
    const red = () =>
      browser.execute(() => {
        const canvas = document.querySelector(
          ".inkline-editor .inkline-preview-ink",
        );
        if (!(canvas instanceof HTMLCanvasElement))
          throw new Error("no preview");
        const data =
          canvas
            .getContext("2d")
            ?.getImageData(0, 0, canvas.width, canvas.height).data ??
          new Uint8ClampedArray();
        let alpha = 0;
        let value = -1;
        for (let index = 0; index < data.length; index += 4) {
          if ((data[index + 3] ?? 0) > alpha) {
            alpha = data[index + 3] ?? 0;
            value = data[index] ?? -1;
          }
        }
        return alpha >= 200 ? value : -1;
      });
    await browser.waitUntil(async () => (await red()) >= 0);
    // A theme or snippet changes the text colour, and Obsidian says so.
    await browser.executeObsidian(({ app }) => {
      document.body.setCssProps({ "--text-normal": "rgb(200, 0, 0)" });
      app.workspace.trigger("css-change");
    });
    try {
      // Scaling the ink down can round the channel a step or two.
      await browser.waitUntil(async () => Math.abs((await red()) - 200) <= 3);
    } finally {
      await browser.executeObsidian(({ app }) => {
        document.body.style.removeProperty("--text-normal");
        app.workspace.trigger("css-change");
      });
    }
  });
});
