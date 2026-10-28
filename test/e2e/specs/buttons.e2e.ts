import { browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import { buttonIcons, type ButtonLabels } from "../../../src/editor/buttons.ts";
import { defaultSettings } from "../../../src/settings.ts";
import { loadModules } from "../support/browser.ts";
import {
  draw,
  openAtMarker,
  startOver,
  waitForEditor,
} from "../support/editor.ts";
import { saveScreenshot } from "../support/screenshots.ts";

/** One of the editor's buttons, as it is shown and named. */
interface Shown {
  readonly id: string;
  /** Its accessible name, which Obsidian also shows as its tooltip. */
  readonly label: string;
  /** Its visible text, without the icon. */
  readonly text: string;
  /** Whether it shows an icon: drawn, visible, and stroked. */
  readonly icon: boolean;
  /** The colour of the icon's stroke, which should be the button's own. */
  readonly iconColour: string | undefined;
  readonly colour: string;
  /** Its place, relative to the editor's content. */
  readonly left: number;
  readonly right: number;
  readonly top: number;
}

/** Stores `buttonLabels` as the setting, as the settings tab would. */
async function storeLabels(buttonLabels: ButtonLabels): Promise<void> {
  await obsidianPage.disablePlugin("inkline");
  await browser.executeObsidian(
    async ({ app }, settings) => {
      await app.vault.adapter.write(
        `${app.vault.configDir}/plugins/inkline/data.json`,
        JSON.stringify(settings),
      );
    },
    { ...defaultSettings, buttonLabels },
  );
  await obsidianPage.enablePlugin("inkline");
  await loadModules();
}

async function openEditor(): Promise<void> {
  await openAtMarker("Editor.md", "HERE");
  await browser.executeObsidianCommand("inkline:insert-symbol");
  await waitForEditor();
}

/** Every button the editor has, the hidden bar Make ink opens included. */
async function shownButtons(): Promise<Shown[]> {
  return browser.execute(() => {
    const editor = activeDocument.querySelector(".inkline-editor");
    const content = editor?.querySelector(".modal-content");
    if (!editor || !content) throw new Error("no editor");
    const box = content.getBoundingClientRect();
    return [...editor.querySelectorAll("[data-inkline-button]")].map(
      (button) => {
        if (!button.instanceOf(HTMLElement)) {
          throw new Error("not an element");
        }
        const svg = button.querySelector(".inkline-button-icon svg");
        const drawn = svg?.getBoundingClientRect();
        // The icon's first shape, whose stroke is what shows.
        const shape = svg?.querySelector("path, circle, rect, line, polyline");
        const style = svg ? getComputedStyle(svg) : undefined;
        const stroke = shape ? getComputedStyle(shape) : undefined;
        const rect = button.getBoundingClientRect();
        return {
          id: button.dataset.inklineButton ?? "",
          label: button.getAttribute("aria-label") ?? "",
          text: button.textContent.trim(),
          icon:
            drawn !== undefined &&
            drawn.width > 0 &&
            drawn.height > 0 &&
            style?.visibility === "visible" &&
            Number(style.opacity) > 0 &&
            stroke !== undefined &&
            Number.parseFloat(stroke.strokeWidth) > 0,
          // The colour the icon is drawn in, which a transparent stroke
          // would leave different from the button's.
          iconColour: stroke?.stroke,
          colour: getComputedStyle(button).color,
          left: rect.left - box.left,
          right: rect.right - box.left,
          top: rect.top - box.top,
        };
      },
    );
  });
}

/** The buttons of the toolbar and the picture's bar, which are shown. */
function visible(buttons: Shown[]): Shown[] {
  const converting = new Set(["light", "apply", "cancel"]);
  return buttons.filter((button) => !converting.has(button.id));
}

/** Each button's accessible name, by its id. */
function labels(buttons: Shown[]): Record<string, string> {
  return Object.fromEntries(buttons.map((button) => [button.id, button.label]));
}

/** The rows the toolbar's buttons take: how many distinct tops they have. */
async function toolbarRows(): Promise<number> {
  return browser.execute(() => {
    const tops = [
      ...activeDocument.querySelectorAll(".inkline-toolbar button"),
    ].map((button) => Math.round(button.getBoundingClientRect().top));
    return new Set(tops).size;
  });
}

/** A pressed button's text and background colours, as sRGB from 0 to 255. */
interface Pressed {
  readonly id: string;
  readonly text: readonly number[];
  readonly background: readonly number[];
}

/** The pressed buttons' colours, resolved by drawing each on a canvas. */
async function pressedColours(): Promise<Pressed[]> {
  return browser.execute(() => {
    const context = new OffscreenCanvas(1, 1).getContext("2d", {
      willReadFrequently: true,
    });
    if (context === null) throw new Error("no context");
    const rgb = (css: string): number[] => {
      context.clearRect(0, 0, 1, 1);
      // A canvas keeps its last colour when given one it cannot read.
      const unread = "#010203";
      context.fillStyle = unread;
      context.fillStyle = css;
      if (context.fillStyle === unread) throw new Error(`unread ${css}`);
      context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data.slice(0, 3)];
    };
    return [
      ...activeDocument.querySelectorAll(
        '.inkline-editor button[aria-pressed="true"]',
      ),
    ].map((button) => {
      const style = getComputedStyle(button);
      return {
        id: button.getAttribute("data-inkline-button") ?? "",
        text: rgb(style.color),
        background: rgb(style.backgroundColor),
      };
    });
  });
}

/** WCAG 2.2's contrast ratio between two sRGB colours. */
function contrast(a: readonly number[], b: readonly number[]): number {
  const luminance = (colour: readonly number[]): number => {
    const [r = 0, g = 0, bl = 0] = colour.map((value) => {
      const c = value / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

/** Sets Obsidian's accent colour, or its default with an empty one. */
async function setAccent(colour: string): Promise<void> {
  await browser.executeObsidian(({ app }, accent) => {
    const appearance = app as unknown as {
      vault: { setConfig(key: string, value: string): void };
      updateAccentColor(): void;
    };
    appearance.vault.setConfig("accentColor", accent);
    appearance.updateAccentColor();
  }, colour);
}

describe("Editor buttons", function () {
  /** The names under the default, to compare the other choices with. */
  let usual: Record<string, string> = {};
  /** The theme classes the body had, to restore after each test. */
  let theme: string[] = [];

  before(async function () {
    await startOver();
    await storeLabels("both");
    await openEditor();
    usual = labels(await shownButtons());
    await startOver();
    theme = await browser.execute(() =>
      [...document.body.classList].filter(
        (name) => name === "theme-light" || name === "theme-dark",
      ),
    );
  });
  afterEach(async function () {
    await startOver();
    await browser.execute((themes) => {
      document.body.removeClass("theme-light", "theme-dark");
      for (const name of themes) document.body.addClass(name);
    }, theme);
  });
  after(async function () {
    await storeLabels("both");
  });

  it("shows each button's icon beside its text by default", async function () {
    await storeLabels("both");
    await openEditor();
    const buttons = await shownButtons();
    const withIcons = buttons.filter((button) => button.icon);
    // Every button with an icon in the table, and only those, shows it.
    expect(withIcons.map((button) => button.id).sort()).toEqual(
      Object.keys(buttonIcons).sort(),
    );
    for (const button of buttons) {
      expect(button.text).not.toBe("");
      if (button.icon) expect(button.iconColour).toBe(button.colour);
    }
    expect(buttons.find((button) => button.id === "pen")?.label).toBe(
      "Pen (P)",
    );
    expect(buttons.find((button) => button.id === "size-0")?.text).toBe("S");
    expect(labels(buttons)).toEqual(usual);
    await saveScreenshot("buttons-both", browser.$(".inkline-editor"));
  });

  it("shows only icons, keeping names, shortcuts, states and keys", async function () {
    const rowsBefore = await (async () => {
      await storeLabels("both");
      await openEditor();
      const rows = await toolbarRows();
      await startOver();
      return rows;
    })();
    await storeLabels("icons");
    await openEditor();
    const buttons = await shownButtons();
    expect(labels(buttons)).toEqual(usual);
    for (const button of buttons) {
      if (button.id in buttonIcons) {
        expect(button.icon).toBe(true);
        expect(button.text).toBe("");
        expect(button.iconColour).toBe(button.colour);
      } else {
        expect(button.icon).toBe(false);
        expect(button.text).not.toBe("");
      }
    }
    // The toolbar fits in one row at the usual width, where text wraps it.
    expect(await toolbarRows()).toBe(1);
    expect(rowsBefore).toBeGreaterThan(1);
    // The pen is chosen, and Undo has nothing to undo.
    const pen = browser.$('[data-inkline-button="pen"]');
    const undo = browser.$('[data-inkline-button="undo"]');
    expect(await pen.getAttribute("aria-pressed")).toBe("true");
    expect(await undo.isEnabled()).toBe(false);
    const pressed = await shownButtons();
    const penShown = pressed.find((button) => button.id === "pen");
    const eraserShown = pressed.find((button) => button.id === "eraser");
    expect(penShown?.iconColour).toBe(penShown?.colour);
    expect(penShown?.colour).not.toBe(eraserShown?.colour);
    await draw([
      [0.3, 0.5],
      [0.7, 0.5],
    ]);
    await browser.waitUntil(async () => undo.isEnabled());
    // The keyboard reaches and presses a button that shows only its icon.
    await browser.execute(() => {
      const eraser = activeDocument.querySelector(
        '[data-inkline-button="eraser"]',
      );
      if (eraser?.instanceOf(HTMLElement) !== true) throw new Error("none");
      eraser.focus();
    });
    await browser.keys([" "]);
    await browser.waitUntil(
      async () =>
        (await browser
          .$('[data-inkline-button="eraser"]')
          .getAttribute("aria-pressed")) === "true",
    );
    expect(await pen.getAttribute("aria-pressed")).toBe("false");
    // Pointing at it shows its name and shortcut.
    await browser.$('[data-inkline-button="zoom"]').moveTo();
    await browser
      .$(".tooltip")
      .waitForDisplayed({ timeoutMsg: "no tooltip over Zoom" });
    expect(await browser.$(".tooltip").getText()).toBe(usual.zoom);
    await saveScreenshot("buttons-icons", browser.$(".inkline-editor"));
  });

  it("shows only text when chosen, as before icons", async function () {
    await storeLabels("text");
    await openEditor();
    const buttons = await shownButtons();
    expect(labels(buttons)).toEqual(usual);
    for (const button of buttons) {
      expect(button.icon).toBe(false);
      expect(button.text).not.toBe("");
    }
    expect(
      await browser.$(".inkline-editor .inkline-button-icon").isExisting(),
    ).toBe(false);
  });

  it("keeps a pressed button's text readable on the accent, in both themes", async function () {
    await storeLabels("both");
    await openEditor();
    const measured: string[] = [];
    try {
      // Obsidian's default, a light accent it puts black text on, and a
      // mid blue it puts white text on.
      for (const accent of ["", "#ffd400", "#3d7be0"]) {
        await setAccent(accent);
        for (const name of ["theme-light", "theme-dark"]) {
          await browser.execute((wanted) => {
            document.body.removeClass("theme-light", "theme-dark");
            document.body.addClass(wanted);
          }, name);
          const pressed = await pressedColours();
          // The pen, the M brush and Guides start pressed.
          expect(pressed.map((button) => button.id)).toEqual([
            "pen",
            "size-1",
            "guides",
          ]);
          for (const button of pressed) {
            const ratio = contrast(button.text, button.background);
            measured.push(
              `${accent || "default"} ${name} ${button.id} ${ratio.toFixed(2)}`,
            );
            expect(ratio).toBeGreaterThanOrEqual(4.5);
          }
        }
      }
    } finally {
      console.log("Pressed contrast", JSON.stringify(measured));
      await setAccent("");
    }
  });

  for (const choice of ["both", "icons"] as const) {
    it(`keeps every button in a narrow editor in the dark theme: ${choice}`, async function () {
      await storeLabels(choice);
      await browser.execute(() => {
        document.body.removeClass("theme-light");
        document.body.addClass("theme-dark");
      });
      await openEditor();
      await browser.execute(() => {
        const editor = activeDocument.querySelector(".inkline-editor");
        if (editor?.instanceOf(HTMLElement) !== true) throw new Error("none");
        editor.setCssProps({ width: "420px" });
      });
      const width = await browser.execute(() => {
        const content = activeDocument.querySelector(
          ".inkline-editor .modal-content",
        );
        if (!content) throw new Error("no editor");
        return content.getBoundingClientRect().width;
      });
      const buttons = visible(await shownButtons());
      for (const button of buttons) {
        expect(button.left).toBeGreaterThanOrEqual(0);
        expect(button.right).toBeLessThanOrEqual(width + 0.5);
        if (button.icon) expect(button.iconColour).toBe(button.colour);
      }
      await saveScreenshot(
        `buttons-narrow-dark-${choice}`,
        browser.$(".inkline-editor"),
      );
    });
  }
});
