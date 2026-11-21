import { browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import { defaultSettings } from "../../../src/settings.ts";
import type { Mark } from "../browser/pictures.ts";
import { loadModules } from "../support/browser.ts";
import {
  openAtMarker,
  startOver,
  surface,
  symbolFiles,
  waitForEditor,
  waitForStatus,
} from "../support/editor.ts";
import { saveScreenshot } from "../support/screenshots.ts";
import { bytesOf } from "../support/vault-files.ts";

/** Three distinct synthetic glyphs, spaced so one fits the editor at a time. */
const marks: readonly Mark[] = [
  { x: 56, y: 0, width: 12, height: 100, colour: "blue" },
  { x: 56, y: 88, width: 48, height: 12, colour: "blue" },
  { x: 476, y: 0, width: 12, height: 100, colour: "red" },
  { x: 512, y: 0, width: 12, height: 100, colour: "red" },
  { x: 476, y: 0, width: 48, height: 12, colour: "red" },
  { x: 914, y: 0, width: 12, height: 100, colour: "blue" },
  { x: 896, y: 44, width: 48, height: 12, colour: "blue" },
];

function libraryRowNamed(name: string): ReturnType<typeof browser.$> {
  return browser.$(
    `//div[contains(@class, "inkline-library-symbol")][.//div[contains(@class, "inkline-library-name")][text()="${name}"]]`,
  );
}

/** Reads the live note even while the library has focus. */
async function textOf(path: string): Promise<string> {
  return browser.executeObsidian(({ app, obsidian }, wanted) => {
    for (const leaf of app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (view instanceof obsidian.MarkdownView && view.file?.path === wanted)
        return view.editor.getValue();
    }
    throw new Error(`no live editor for ${wanted}`);
  }, path);
}

/**
 * Waits until the active Markdown view's mode and the number of symbols its
 * Reading view shows pass `done`, and says both when they never do.
 */
async function waitForReading(
  done: (mode: string, images: number) => boolean,
  wanted: string,
): Promise<void> {
  let seen = { mode: "", images: 0 };
  try {
    await browser.waitUntil(async () => {
      seen = await browser.executeObsidian(({ app, obsidian }) => ({
        mode:
          app.workspace.getActiveViewOfType(obsidian.MarkdownView)?.getMode() ??
          "no Markdown view",
        images: document.querySelectorAll(
          ".workspace-leaf.mod-active .markdown-reading-view img.inkline-symbol",
        ).length,
      }));
      return done(seen.mode, seen.images);
    });
  } catch (error) {
    throw new Error(
      `waited for ${wanted}, but the active view was in ${seen.mode} mode, with ${String(seen.images)} symbols in its Reading view`,
      { cause: error },
    );
  }
}

/** Visible reference-ink bounds in CSS pixels, read from the actual surface. */
async function picture(colour: "red" | "blue") {
  return browser.execute((wanted) => {
    const canvas = document.querySelector<HTMLCanvasElement>(
      ".inkline-editor .inkline-surface",
    );
    if (canvas === null) throw new Error("no drawing surface");
    const found = window.inklineTest.pictures.shown(canvas, wanted);
    if (found === undefined) return null;
    const ratio = canvas.clientWidth / canvas.width;
    return { left: found.left * ratio, right: found.right * ratio };
  }, colour);
}

/** Moves the reference through pointer input, with both ends on the surface. */
async function pan(dx: number): Promise<void> {
  await browser.keys(["m"]);
  const start = -Math.round(dx / 2);
  await browser
    .action("pointer", { parameters: { pointerType: "mouse" } })
    .move({ origin: surface(), x: start, y: 0 })
    .down()
    .move({ origin: surface(), x: start + Math.round(dx), y: 0, duration: 150 })
    .up()
    .perform();
  await browser.keys(["m"]);
}

async function makeAndName(name: string): Promise<void> {
  await browser.keys(["i"]);
  const apply = browser.$('[data-inkline-button="apply"]');
  await apply.waitForDisplayed();
  await apply.click();
  await waitForStatus("Made ink of the picture");
  await browser.$(".inkline-editor .inkline-name").setValue(name);
  await browser.keys(["Enter"]);
}

async function saveAndWaitForNewEditor(count: number): Promise<void> {
  await browser.keys(["Control", "Shift", "Enter"]);
  await browser.waitUntil(
    async () =>
      (await symbolFiles()).length === count &&
      (await browser.execute(
        () =>
          document.querySelector<HTMLInputElement>(
            ".inkline-editor .inkline-name",
          )?.value === "",
      )),
  );
  await waitForEditor();
}

describe("A deciphering session", function () {
  before(async function () {
    await startOver();
    await browser.executeObsidian(async ({ plugins }, defaults) => {
      await plugins.inkline.saveData(defaults);
    }, defaultSettings);
    await obsidianPage.disablePlugin("inkline");
    await obsidianPage.enablePlugin("inkline");
    await loadModules();
  });

  it("copies an inscription, reuses and revises its signs, and rereads it in both themes", async function () {
    this.timeout(120_000);
    await browser.executeObsidian(async ({ app }, glyphs) => {
      const configurable = (
        candidate: object,
      ): candidate is { setConfig(key: string, value: unknown): void } =>
        "setConfig" in candidate && typeof candidate.setConfig === "function";
      if (!configurable(app.vault)) throw new Error("no vault settings");
      app.vault.setConfig("alwaysUpdateLinks", true);
      const source = await window.inklineTest.pictures.picture(
        1000,
        100,
        "white",
        glyphs,
      );
      await app.vault.createBinary("Source.png", await source.arrayBuffer());
      await app.vault.create(
        "Inscription.md",
        [
          "# The tablet",
          "",
          "Three marks from an invented script:",
          "",
          "![[Source.png|450]]",
          "",
          "Working transcription: HERE",
          "",
          "Current reading: water, return, sun.",
          "",
        ].join("\n"),
      );
      await app.vault.create(
        "Notebook.md",
        "# Another inscription\n\nThe recurring sign: REUSE\n",
      );
    }, marks);
    await openAtMarker("Inscription.md", "HERE");
    await browser.executeObsidianCommand("inkline:insert-symbol");
    await waitForEditor();
    await browser.execute(async (glyphs) => {
      await window.inklineTest.pictures.copyPicture(1000, 100, "white", glyphs);
    }, marks);
    await browser.keys(["Control", "v"]);
    await waitForStatus("Tracing over the picture");
    let red = await picture("red");
    if (red === null) throw new Error("the middle glyph is not visible");
    expect(await picture("blue")).toBeNull();
    const delta = ((red.right - red.left) / 48) * 420;
    await pan(delta);
    await browser.waitUntil(
      async () =>
        (await picture("blue")) !== null && (await picture("red")) === null,
    );
    await saveScreenshot("journey-tracing", browser.$(".inkline-editor"));
    await makeAndName("water");
    await saveAndWaitForNewEditor(1);
    await pan(-delta);
    await browser.waitUntil(async () => (await picture("red")) !== null);
    red = await picture("red");
    if (red === null) throw new Error("the carried reference was lost");
    await makeAndName("gate");
    await saveAndWaitForNewEditor(2);
    await pan(-((red.right - red.left) / 48) * 420);
    await browser.waitUntil(
      async () =>
        (await picture("blue")) !== null && (await picture("red")) === null,
    );
    await makeAndName("sun");
    await browser.keys(["Control", "Enter"]);
    await browser.$(".inkline-editor").waitForExist({ reverse: true });
    expect(await symbolFiles()).toEqual([
      "gate.ink.png",
      "sun.ink.png",
      "water.ink.png",
    ]);
    expect(await textOf("Inscription.md")).toContain(
      "![[water.ink.png]]![[gate.ink.png]]![[sun.ink.png]]",
    );
    const drawings = await browser.executeObsidian(async ({ app }) => {
      const dimensions = [];
      for (const name of ["gate", "water", "sun"]) {
        const file = app.vault.getFileByPath(`${name}.ink.png`);
        if (file === null) throw new Error(`no ${name}`);
        const opened = await window.inklineTest.canvas.openInk(
          new Uint8Array(await app.vault.readBinary(file)),
        );
        if (opened.kind !== "editable" || opened.base === undefined)
          throw new Error(`no editable base for ${name}`);
        // As drawn, in pixels.
        dimensions.push([opened.base.width / 16, opened.base.height / 16]);
      }
      return dimensions;
    });
    for (const [width, height] of drawings) {
      expect(width).toBeLessThan(100);
      expect(height).toBeLessThanOrEqual(110);
    }
    const original = await bytesOf("gate.ink.png");
    expect(
      new Set(
        await Promise.all(
          ["gate", "water", "sun"].map((name) => bytesOf(`${name}.ink.png`)),
        ),
      ).size,
    ).toBe(3);
    await openAtMarker("Notebook.md", "REUSE");
    await browser.executeObsidianCommand("inkline:show-library");
    await libraryRowNamed("gate")
      .$(".inkline-library-insert")
      .waitForDisplayed();
    await libraryRowNamed("gate").$(".inkline-library-insert").click();
    await browser.waitUntil(async () =>
      (await textOf("Notebook.md")).includes("![[gate.ink.png]]"),
    );
    await browser.waitUntil(
      async () =>
        (await libraryRowNamed("gate").$(".inkline-library-uses").getText()) ===
        "Uses (2)",
    );
    await libraryRowNamed("gate").$(".inkline-library-edit").click();
    await browser
      .$(".inkline-library-edit-form")
      .$("button=Save")
      .waitForEnabled();
    await browser.$(".inkline-library-edit-form input").setValue("return");
    await browser.keys(["Enter"]);
    await libraryRowNamed("return").waitForExist();
    expect(await bytesOf("return.ink.png")).toBe(original);
    await browser.waitUntil(
      async () =>
        (await textOf("Inscription.md")).includes("![[return.ink.png]]") &&
        (await textOf("Notebook.md")).includes("![[return.ink.png]]"),
    );
    // Link text updates before the host's separate link index catches up.
    // Wait for the renamed row's enabled control before sending pointer input.
    await browser.waitUntil(
      async () =>
        (await libraryRowNamed("return")
          .$(".inkline-library-uses")
          .getText()) === "Uses (2)",
    );
    await libraryRowNamed("return")
      .$(".inkline-library-uses")
      .waitForClickable();
    await libraryRowNamed("return").$(".inkline-library-uses").click();
    await browser.waitUntil(
      async () =>
        (await libraryRowNamed("return").$$(".inkline-library-note").length) ===
        2,
    );
    expect(
      await libraryRowNamed("return")
        .$$(".inkline-library-note")
        .map((note) => note.getText()),
    ).toEqual(["Inscription", "Notebook"]);
    // Close the original editor before reopening it from the usage list.
    // Wait for the host save first: the library reads the persisted note.
    await browser.waitUntil(async () =>
      browser.executeObsidian(async ({ app }) => {
        const file = app.vault.getFileByPath("Inscription.md");
        return (
          file !== null &&
          (await app.vault.read(file)).includes("![[return.ink.png]]")
        );
      }),
    );
    await browser.executeObsidian(({ app, obsidian }) => {
      for (const leaf of app.workspace.getLeavesOfType("markdown")) {
        if (
          leaf.view instanceof obsidian.MarkdownView &&
          leaf.view.file?.path === "Inscription.md"
        )
          leaf.detach();
      }
    });
    await libraryRowNamed("return")
      .$(".inkline-library-note=Inscription")
      .click();
    // The click opens the note in a leaf without waiting, and asking for
    // Reading view before that ends can leave the note in Live Preview
    // (#373). So wait for the note before asking, and then for the mode.
    await browser.waitUntil(
      async () =>
        browser.executeObsidian(
          ({ app, obsidian }) =>
            app.workspace.getActiveViewOfType(obsidian.MarkdownView)?.file
              ?.path === "Inscription.md",
        ),
      { timeoutMsg: "the active view is not the note clicked, Inscription" },
    );
    await browser.executeObsidian(async ({ app, obsidian }) => {
      const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
      if (view?.file === null || view === null)
        throw new Error("no inscription view");
      await view.leaf.openFile(view.file, { state: { mode: "preview" } });
    });
    await waitForReading((mode) => mode === "preview", "Reading view");
    for (const [theme, name] of [
      ["moonstone", "light"],
      ["obsidian", "dark"],
    ] as const) {
      await browser.executeObsidian(({ app }, chosen) => {
        const change: unknown = Reflect.get(app, "changeTheme");
        if (typeof change !== "function") throw new Error("no themes");
        Reflect.apply(change, app, [chosen]);
      }, theme);
      await waitForReading(
        (mode, images) => mode === "preview" && images === 3,
        `three symbols in Reading view, in the ${name} theme`,
      );
      const shown = await browser.execute(() =>
        Array.from(
          document.querySelectorAll(
            ".workspace-leaf.mod-active .markdown-reading-view img.inkline-symbol",
          ),
        ).map((image) => {
          const style = getComputedStyle(image);
          const rect = image.getBoundingClientRect();
          return {
            height: rect.height,
            fontSize: Number.parseFloat(style.fontSize),
            drop: -Number.parseFloat(style.verticalAlign),
            color: style.color,
            background: style.backgroundColor,
            mask: style.maskImage,
          };
        }),
      );
      for (const glyph of shown) {
        expect(glyph.height).toBeCloseTo(1.5 * glyph.fontSize, 0);
        expect(glyph.drop).toBeCloseTo(0.375 * glyph.fontSize, 0);
        expect(glyph.background).toBe(glyph.color);
        expect(glyph.mask).not.toBe("none");
      }
      await browser.$(".notice").waitForExist({ reverse: true });
      await saveScreenshot(`journey-${name}`);
    }
  });
});
