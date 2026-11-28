import { browser, expect } from "@wdio/globals";
import { buttonIcons, type ButtonLabels } from "../../../src/editor/buttons.ts";
import { loadModules } from "../support/browser.ts";
import { insert } from "../support/editing.ts";
import {
  draw,
  openAtMarker,
  startOver,
  surface,
  waitForEditor,
  waitForStatus,
} from "../support/editor.ts";
import { warmUpPointer } from "../support/hover.ts";
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

/**
 * Every button's accessible name, which Obsidian also shows as its tooltip,
 * the same whatever the buttons show: its text, any description, and its
 * shortcut. Written out, so that a name that changes, or one that the choice
 * of what buttons show changes, fails.
 */
const usual: Readonly<Record<string, string>> = {
  pen: "Pen (P)",
  eraser: "Eraser (E)",
  ellipse:
    "Ellipse: drag across a box to draw an ellipse with the pen or the eraser; hold Shift for a circle, or with the grid on to snap to it (O)",
  polygon:
    "Polygon: click each corner of a shape with straight sides; click the first corner again to close it, or the last to end it; hold Shift to snap a corner to the grid (Y)",
  path: "Path: place a curve by its points: click for a corner, or drag for a smooth point and its handles; drag a point or a handle's end to move it; click the first point to close the path, or the last to end it, and Finish path makes it ink; hold Shift to snap to the grid (A)",
  fill: "Toggle fill: while on, Ellipse, and Polygon or Path closed on its first point, draw solid shapes, with the pen or the eraser; it doesn't fill what is already drawn (B)",
  finish:
    "Finish path: make the path ink as it is, ended or still being placed; Enter first ends a path being placed, for adjusting (Enter)",
  "size-0": "Brush size S (1)",
  "size-1": "Brush size M (2)",
  "size-2": "Brush size L (3)",
  "size-3": "Brush size XL (4)",
  undo: "Undo (Mod+Z)",
  redo: "Redo (Mod+Shift+Z)",
  clear: "Clear (Delete)",
  "move-up":
    "Up: move the whole drawing up a pixel, or with Shift a grid cell's width (ArrowUp)",
  "move-down":
    "Down: move the whole drawing down a pixel, or with Shift a grid cell's width (ArrowDown)",
  guides: "Guides (G)",
  grid: "Grid: show a grid of dots as a guide; hold Shift while drawing to snap to it (Shift+G)",
  "flat-ends":
    "Flat ends: with the grid on, ends of freehand strokes and paths that Shift puts on a row, coming in at 45° or steeper, stop flush with it, rather than rounding past it (T)",
  copy: "Copy from: start from a copy of another symbol (V)",
  fit: "Fit: centre the drawing in the view, and out of Zoom show all of it if it is wider; the drawing itself stays as it is (F)",
  zoom: "Zoom: a taller view of the drawing, twice as large, with twice as many grid cells each way; the wheel, the left and right arrow keys, or its scroll bar move along it (Z)",
  save: "Save (Mod+Enter)",
  next: "Next: save and draw the next one (Mod+Shift+Enter)",
  help: "Help",
  choose: "Choose picture…: open a picture file to trace over",
  move: "Move: drag the picture or use the arrow keys; the wheel or + and − scale it about its middle (M)",
  ink: "Make ink: turn the picture into the symbol's ink, by a threshold (I)",
  remove: "Remove picture",
  light: "Light ink: the ink is lighter than the ground around it",
  apply: "Apply",
  cancel: "Cancel",
};

/**
 * Chooses `buttonLabels` for the setting, as its dropdown in Inkline's
 * settings does: Obsidian hands a person's choice there to the tab's
 * `setControlValue`. A new editor takes it from then on.
 */
async function storeLabels(buttonLabels: ButtonLabels): Promise<void> {
  await browser.executeObsidian(async ({ app, obsidian }, value) => {
    const settings: unknown = Reflect.get(app, "setting");
    const tabs: unknown =
      typeof settings === "object" && settings !== null
        ? Reflect.get(settings, "pluginTabs")
        : undefined;
    const tab: unknown = Array.isArray(tabs)
      ? tabs.find((candidate: unknown) => {
          if (!(candidate instanceof obsidian.PluginSettingTab)) return false;
          const plugin: unknown = Reflect.get(candidate, "plugin");
          const manifest: unknown =
            typeof plugin === "object" && plugin !== null
              ? Reflect.get(plugin, "manifest")
              : undefined;
          return (
            typeof manifest === "object" &&
            manifest !== null &&
            Reflect.get(manifest, "id") === "inkline"
          );
        })
      : undefined;
    if (!(tab instanceof obsidian.PluginSettingTab)) {
      throw new Error("no settings tab of Inkline's");
    }
    await tab.setControlValue("buttonLabels", value);
    // The tab answers nothing, so a choice it refused would pass unseen and
    // leave the tests after this one under the choice before.
    if (tab.getControlValue("buttonLabels") !== value) {
      throw new Error(`the settings tab did not take ${value} for the labels`);
    }
  }, buttonLabels);
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
  /** Obsidian's accent, which the background is mixed from. */
  readonly accent: readonly number[];
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
        accent: rgb(style.getPropertyValue("--interactive-accent").trim()),
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

describe("The editor", function () {
  before(async function () {
    await loadModules();
  });

  beforeEach(async function () {
    await startOver();
    await warmUpPointer();
  });

  it("names each button with its text and shortcut, shows that on hover, and marks the current tool", async function () {
    await insert();
    const state = await browser.execute(() => {
      const button = (id: string): HTMLElement | null =>
        document.querySelector(`[data-inkline-button="${id}"]`);
      return {
        pen: button("pen")?.getAttribute("aria-pressed"),
        eraser: button("eraser")?.getAttribute("aria-pressed"),
        undo: button("undo")?.hasAttribute("disabled"),
        focused: document.activeElement?.classList.contains("inkline-surface"),
      };
    });
    expect(state).toEqual({
      pen: "true",
      eraser: "false",
      undo: true,
      focused: true,
    });
    const buttons = await browser.execute(() =>
      [...document.querySelectorAll("[data-inkline-button]")].map((button) => ({
        id: button.getAttribute("data-inkline-button") ?? "",
        text: button.textContent,
        name: button.getAttribute("aria-label") ?? "",
      })),
    );
    expect(buttons.length).toBeGreaterThan(10);
    for (const { text, name } of buttons) {
      expect(name.toLowerCase()).toContain(text.toLowerCase());
    }
    // A button's name is its tooltip, which Obsidian shows from it: with a
    // description, a label of its own, or neither, and the shortcut after.
    const names = Object.fromEntries(buttons.map(({ id, name }) => [id, name]));
    expect(names).toMatchObject({
      copy: "Copy from: start from a copy of another symbol (V)",
      "size-0": "Brush size S (1)",
      pen: "Pen (P)",
      next: "Next: save and draw the next one (Mod+Shift+Enter)",
      grid: "Grid: show a grid of dots as a guide; hold Shift while drawing to snap to it (Shift+G)",
      fit: "Fit: centre the drawing in the view, and out of Zoom show all of it if it is wider; the drawing itself stays as it is (F)",
    });
    const tooltip = async (id: string, text: string): Promise<void> => {
      const button = await browser
        .$(`[data-inkline-button="${id}"]`)
        .getElement();
      let step = 0;
      await browser.waitUntil(
        async () => {
          // Obsidian shows a mouse no tooltip until it has seen it move twice
          // (#270), so each look moves it again, within the button.
          step++;
          await browser
            .action("pointer", { parameters: { pointerType: "mouse" } })
            .move({ origin: button, x: step % 2 === 0 ? -2 : 2, y: 0 })
            .perform();
          return (
            (await browser.execute(
              () => document.querySelector(".tooltip")?.textContent ?? "",
            )) === text
          );
        },
        { timeoutMsg: `no tooltip "${text}"` },
      );
      await surface().moveTo();
    };
    await tooltip("copy", "Copy from: start from a copy of another symbol (V)");
    await tooltip("size-0", "Brush size S (1)");
    // Both save, so both look it.
    for (const id of ["save", "next"]) {
      expect(
        await browser.$(`[data-inkline-button="${id}"]`).getAttribute("class"),
      ).toContain("mod-cta");
    }
    await browser.keys(["e"]);
    const eraser = browser.$('[data-inkline-button="eraser"]');
    expect(await eraser.getAttribute("aria-pressed")).toBe("true");
  });

  // What each button shows is buttonStates's to say, which buttons.test.ts
  // checks in full; this checks that the editor shows it, as the keys and a
  // click change what it holds, and what the keys of switches that are off
  // say instead.
  it("shows each switch's state on its button as it changes, and says why one is off", async function () {
    await insert();
    /**
     * Each button's `aria-pressed`, or "-", and whether it is on or off, or
     * "missing" for a button the editor does not have.
     */
    const shown = (ids: readonly string[]): Promise<Record<string, string>> =>
      browser.execute(
        (ids: readonly string[]) =>
          Object.fromEntries(
            ids.map((id) => {
              const button = document.querySelector(
                `[data-inkline-button="${id}"]`,
              );
              if (button === null) return [id, "missing"];
              const pressed = button.getAttribute("aria-pressed") ?? "-";
              const off = button.hasAttribute("disabled");
              return [id, `${pressed} ${off ? "off" : "on"}`];
            }),
          ),
        ids,
      );
    /** Waits for the buttons named to show what `states` says of each. */
    const showing = async (states: Record<string, string>): Promise<void> => {
      let last: Record<string, string> = {};
      await browser.waitUntil(
        async () => {
          last = await shown(Object.keys(states));
          return Object.entries(states).every(
            ([id, state]) => last[id] === state,
          );
        },
        { timeoutMsg: `buttons show ${JSON.stringify(last)}` },
      );
    };
    // A new editor's: the pen, freehand, with no grid and no picture.
    await showing({
      pen: "true on",
      ellipse: "false on",
      polygon: "false on",
      path: "false on",
      fill: "false off",
      finish: "- off",
      grid: "false on",
      "flat-ends": "false off",
      move: "false off",
      remove: "- off",
      ink: "false off",
      undo: "- off",
      redo: "- off",
      save: "- on",
    });
    // The key of a switch that is off says why, and changes nothing.
    await browser.keys("b");
    await waitForStatus("Toggle fill is for Ellipse, Polygon, and Path");
    await browser.keys("t");
    await waitForStatus(
      "Flat ends is for freehand strokes and paths on the grid",
    );
    await showing({ fill: "false off", "flat-ends": "false off" });
    // A shape turns Toggle fill on, which its button then switches.
    await browser.keys("o");
    await showing({ ellipse: "true on", fill: "false on" });
    await browser.$('[data-inkline-button="fill"]').click();
    await showing({ fill: "true on" });
    // The grid turns Flat ends on, for freehand strokes and paths alone.
    await browser.keys(["Shift", "g"]);
    await showing({ grid: "true on", "flat-ends": "false off" });
    await browser.keys("o");
    await showing({
      ellipse: "false on",
      fill: "false off",
      "flat-ends": "false on",
    });
    await browser.keys("t");
    await showing({ "flat-ends": "true on" });
    await browser.keys("y");
    await showing({ polygon: "true on", "flat-ends": "false off" });
    // A path keeps it, as it cuts a path's ends as it cuts a freehand one's.
    await browser.keys("a");
    await showing({
      polygon: "false on",
      path: "true on",
      "flat-ends": "true on",
    });
  });
});

describe("Editor buttons", function () {
  /** The theme classes the body had, to restore after each test. */
  let theme: string[] = [];

  before(async function () {
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

  it("spaces the toolbar's rows as a row that wraps is spaced", async function () {
    await openEditor();
    const spacing = await browser.execute(() => {
      const rows = [
        ...activeDocument.querySelectorAll<HTMLElement>(
          ".inkline-editor .inkline-toolbar",
        ),
      ];
      const first = rows[0];
      if (first === undefined) throw new Error("no toolbar");
      const wrap = parseFloat(getComputedStyle(first).rowGap);
      const gaps = rows
        .slice(1)
        .map(
          (row, index) =>
            row.getBoundingClientRect().top -
            (rows[index]?.getBoundingClientRect().bottom ?? Number.NaN),
        );
      const last = rows.at(-1);
      // What follows it on the screen: the picture's bar is there, hidden.
      let after = last?.nextElementSibling;
      while (
        after instanceof HTMLElement &&
        after.getClientRects().length === 0
      ) {
        after = after.nextElementSibling;
      }
      return {
        wrap,
        gaps,
        after:
          last === undefined || !(after instanceof HTMLElement)
            ? undefined
            : after.getBoundingClientRect().top -
              last.getBoundingClientRect().bottom,
        bottom: last === undefined ? "" : getComputedStyle(last).marginBottom,
      };
    });
    // Three rows: tools, history, and the view and its buttons.
    expect(spacing.gaps).toHaveLength(2);
    expect(spacing.wrap).toBeGreaterThan(0);
    for (const gap of spacing.gaps) expect(gap).toBeCloseTo(spacing.wrap, 1);
    // The last row keeps its own, larger space to what follows it.
    expect(spacing.bottom).not.toBe(`${String(spacing.wrap)}px`);
    expect(spacing.after).toBeGreaterThan(spacing.wrap);
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
    // Each of the toolbar's three rows fits at the usual width.
    expect(await toolbarRows()).toBe(3);
    expect(rowsBefore).toBeGreaterThanOrEqual(3);
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
    // WebDriver reads no text while Obsidian's tooltip is still fading in.
    await browser.waitUntil(
      async () => (await browser.$(".tooltip").getText()) !== "",
    );
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
            // The mix, not the plain accent that is only a fallback for a
            // browser that cannot read it: every supported one can.
            expect(button.background).not.toEqual(button.accent);
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
