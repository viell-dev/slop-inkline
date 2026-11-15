// How the library's rows look and wait, in real Obsidian: what a row says
// under it, its readings, translations, and the notes that use it, as one list
// 4 px from the row and 12 px from the next, at the size of Quick edit's labels;
// the other rows' buttons that wait while one row is in Quick edit; and Quick
// edit's fields, which fit their text on every Obsidian tested, with
// field-sizing or without it. It also makes the guide's pictures of the
// library, in both themes, as CONTRIBUTING.md says. Every symbol and note is
// synthetic.

import { browser, expect } from "@wdio/globals";
import { Key } from "webdriverio";
import { loadModules } from "../support/browser.ts";
import { createSymbol, openAtMarker, startOver } from "../support/editor.ts";
import { saveClip, saveScreenshot } from "../support/screenshots.ts";

/** Fields to give a symbol. */
interface Fields {
  readonly reading?: readonly string[];
  readonly translation?: readonly string[];
}

/** A box's top and bottom, in pixels. */
interface Edges {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
}

/** A row of the library, as laid out. */
interface RowLayout {
  readonly path: string | null;
  readonly row: Edges;
  /** The bottom of the line with the symbol and its buttons. */
  readonly line: number;
  readonly values: Edges | null;
  readonly notes: Edges | null;
}

/** The space Obsidian's `--size-4-1` and `--size-4-2` give, in pixels. */
const gap = { around: 4, rows: 8 };

/**
 * The symbols the guide's pictures show: one with nothing to say, which no
 * note uses, ones with readings and translations or only a translation, and
 * ones whose notes are listed, under what they say and alone.
 */
const symbols: readonly (Fields & { file: string; strokes: number[] })[] = [
  { file: "arch.ink.png", strokes: [200, 900] },
  {
    file: "gate.ink.png",
    strokes: [150, 550, 950],
    reading: ["TA", "DA"],
    translation: ["door", "gate"],
  },
  {
    file: "sun.ink.png",
    strokes: [600],
    reading: ["HI", "SO", "TE", "NA"],
    translation: ["sun", "day"],
  },
  { file: "tower.ink.png", strokes: [100, 400, 700], translation: ["tower"] },
  { file: "water.ink.png", strokes: [300, 1000] },
];

/** The notes that use them, and what each holds. */
const notes = {
  "Inscription.md": "Signs: ![[gate.ink.png]]![[sun.ink.png]]\n",
  "Notebook.md":
    "The recurring sign: ![[gate.ink.png]] by ![[water.ink.png]]\n\nHERE\n",
} as const;

/** A symbol at `file`, drawn as `strokes`, that says `fields` about itself. */
async function symbolWith(
  file: string,
  strokes: readonly number[],
  fields: Fields,
): Promise<void> {
  await createSymbol(file, strokes);
  await browser.executeObsidian(
    async ({ app }, wanted, { reading, translation }) => {
      const found = app.vault.getFileByPath(wanted);
      if (found === null) throw new Error(`no ${wanted}`);
      const { text } = window.inklineTest;
      let bytes: Uint8Array = new Uint8Array(await app.vault.readBinary(found));
      if (reading !== undefined) {
        bytes = await text.writeText(bytes, "reading", reading);
      }
      if (translation !== undefined) {
        bytes = await text.writeText(bytes, "translation", translation);
      }
      await app.vault.modifyBinary(found, bytes.slice().buffer);
    },
    file,
    fields,
  );
}

/** Makes the symbols and notes, and waits for Obsidian to index the links. */
async function makeVault(): Promise<void> {
  for (const { file, strokes, ...fields } of symbols) {
    await symbolWith(file, strokes, fields);
  }
  await browser.executeObsidian(async ({ app }, wanted) => {
    for (const [path, text] of Object.entries(wanted)) {
      await app.vault.create(path, text);
    }
  }, notes);
  await browser.waitUntil(async () =>
    browser.executeObsidian(({ app }) => {
      const links = app.metadataCache.resolvedLinks;
      return (
        (links["Inscription.md"]?.["sun.ink.png"] ?? 0) > 0 &&
        (links["Notebook.md"]?.["water.ink.png"] ?? 0) > 0 &&
        (links["Notebook.md"]?.["gate.ink.png"] ?? 0) > 0 &&
        (links["Inscription.md"]?.["gate.ink.png"] ?? 0) > 0
      );
    }),
  );
}

async function useTheme(theme: "moonstone" | "obsidian"): Promise<void> {
  await browser.executeObsidian(({ app }, wanted) => {
    const change: unknown = Reflect.get(app, "changeTheme");
    if (typeof change !== "function") throw new Error("no themes");
    Reflect.apply(change, app, [wanted]);
  }, theme);
  await browser.waitUntil(async () =>
    browser.execute(
      (dark) => document.body.classList.contains("theme-dark") === dark,
      theme === "obsidian",
    ),
  );
}

/** Sets the right sidebar's width, as dragging its edge does. */
async function setSidebar(width: number): Promise<void> {
  await browser.executeObsidian(({ app }, size) => {
    const sidebar = app.workspace.rightSplit;
    const setSize: unknown = Reflect.get(sidebar, "setSize");
    if (typeof setSize !== "function") throw new Error("no sidebar size");
    Reflect.apply(setSize, sidebar, [size]);
  }, width);
}

/** The selector of the library's row for `file`. */
function rowOf(file: string): string {
  return `.inkline-library-symbol[data-inkline-path="${file}"]`;
}

const form = () => browser.$(".inkline-library-edit-form");
const nameField = () => form().$("input");
const formButton = (text: "Save" | "Cancel") => form().$(`button=${text}`);

/** A text area of Quick edit. */
function area(field: "reading" | "translation"): ReturnType<typeof browser.$> {
  return form().$(`textarea[data-inkline-field="${field}"]`);
}

/** Opens the library, with its rows' values read and both lists of uses open. */
async function showLibrary(): Promise<void> {
  await browser.executeObsidianCommand("inkline:show-library");
  await browser.$(".inkline-library-list").waitForExist();
  await browser.waitUntil(async () =>
    browser.execute(
      () =>
        document.querySelectorAll(
          ".inkline-library-symbol .inkline-library-values",
        ).length === 3,
    ),
  );
  for (const file of ["gate.ink.png", "water.ink.png"]) {
    const uses = browser.$(rowOf(file)).$(".inkline-library-uses");
    await uses.waitForEnabled();
    await uses.click();
    await browser
      .$(rowOf(file))
      .$(".inkline-library-notes")
      .waitForExist({ timeoutMsg: `${file}'s uses did not open` });
  }
}

/** Opens Quick edit on `file`'s row, once its fields have read the file. */
async function quickEdit(file: string): Promise<void> {
  await browser.$(rowOf(file)).$(".inkline-library-edit").click();
  await formButton("Save").waitForEnabled();
}

async function waitForClosed(): Promise<void> {
  await form().waitForExist({ reverse: true });
}

/** Each row's boxes, top to bottom. */
async function layout(): Promise<RowLayout[]> {
  return browser.execute(() =>
    Array.from(document.querySelectorAll(".inkline-library-symbol")).map(
      (row) => {
        const box = (element: Element | null) => {
          if (element === null) return null;
          const { top, bottom, left, right } = element.getBoundingClientRect();
          return { top, bottom, left, right };
        };
        const whole = box(row);
        const insert = box(row.querySelector(".inkline-library-insert"));
        const actions = box(row.querySelector(".inkline-library-actions"));
        if (whole === null || insert === null || actions === null) {
          throw new Error("no row");
        }
        return {
          path: row.getAttribute("data-inkline-path"),
          row: whole,
          line: Math.max(insert.bottom, actions.bottom),
          values: box(row.querySelector(".inkline-library-values")),
          notes: box(row.querySelector(".inkline-library-notes")),
        };
      },
    ),
  );
}

/** A computed style's size and weight, as numbers. */
interface Type {
  readonly size: number;
  readonly weight: number;
}

/** How what a row says under it is set: sizes, weights, and where it starts. */
async function lettering() {
  return browser.execute(() => {
    const find = (selector: string): Element => {
      const found = document.querySelector(selector);
      if (found === null) throw new Error(`no ${selector}`);
      return found;
    };
    const type = (selector: string) => {
      const style = getComputedStyle(find(selector));
      return {
        size: Number.parseFloat(style.fontSize),
        weight: Number(style.fontWeight),
      };
    };
    const left = (selector: string) =>
      find(selector).getBoundingClientRect().left;
    const gate = '.inkline-library-symbol[data-inkline-path="gate.ink.png"]';
    const item = getComputedStyle(find(`${gate} .inkline-library-notes li`));
    return {
      label: type(`${gate} .inkline-values-label`),
      value: type(`${gate} .inkline-values bdi`),
      line: type(`${gate} .inkline-values`),
      usesLabel: type(`${gate} .inkline-library-notes-label`),
      usesText: find(`${gate} .inkline-library-notes-label`).textContent,
      item: {
        size: Number.parseFloat(item.fontSize),
        bullet: item.listStyleType,
        display: item.display,
      },
      note: type(`${gate} .inkline-library-note`),
      padding: getComputedStyle(find(`${gate} .inkline-library-values`))
        .paddingInlineStart,
      starts: {
        row: left(gate),
        values: left(`${gate} .inkline-library-values`),
        label: left(`${gate} .inkline-values-label`),
        uses: left(`${gate} .inkline-library-notes-label`),
        item: left(`${gate} .inkline-library-notes li`),
      },
    };
  });
}

/** The size of a Quick edit field's label, which is the form's label size. */
async function formLabel(): Promise<Type> {
  return browser.execute(() => {
    const label = document.querySelector(
      ".inkline-library-edit-form .inkline-text-field > span",
    );
    if (label === null) throw new Error("no label");
    const style = getComputedStyle(label);
    return {
      size: Number.parseFloat(style.fontSize),
      weight: Number(style.fontWeight),
    };
  });
}

/** A row's buttons, as the page and a screen reader have them. */
interface ButtonState {
  readonly path: string | null;
  readonly role: string | null;
  readonly disabled: boolean;
  /** What its description says, from what `aria-describedby` points to. */
  readonly described: string | null;
}

/** Every button in every row, and Show more. */
async function buttons(): Promise<ButtonState[]> {
  return browser.execute(() =>
    Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        ".inkline-library-list button[data-inkline-role]",
      ),
    ).map((button) => {
      const id = button.getAttribute("aria-describedby");
      return {
        path:
          button
            .closest("[data-inkline-path]")
            ?.getAttribute("data-inkline-path") ?? null,
        role: button.getAttribute("data-inkline-role"),
        disabled: button.disabled,
        described:
          id === null ? null : (document.getElementById(id)?.textContent ?? ""),
      };
    }),
  );
}

/** What has the focus: its tag, and the row and role it has in one. */
async function focused() {
  return browser.execute(() => {
    const active = document.activeElement;
    return {
      tag: active?.tagName ?? null,
      inForm: active?.closest(".inkline-library-edit-form") !== null,
      path:
        active
          ?.closest("[data-inkline-path]")
          ?.getAttribute("data-inkline-path") ?? null,
      role: active?.getAttribute("data-inkline-role") ?? null,
    };
  });
}

/** A Quick edit field's height, and what makes up a line of it. */
async function fieldBox(field: "reading" | "translation") {
  return browser.execute((wanted) => {
    const found = document.querySelector<HTMLTextAreaElement>(
      `.inkline-library-edit-form textarea[data-inkline-field="${wanted}"]`,
    );
    if (found === null) throw new Error(`no ${wanted} field`);
    const style = getComputedStyle(found);
    const sum = (a: string, b: string) =>
      Number.parseFloat(a) + Number.parseFloat(b);
    return {
      height: found.getBoundingClientRect().height,
      line: Number.parseFloat(style.lineHeight),
      edges:
        sum(style.paddingTop, style.paddingBottom) +
        sum(style.borderTopWidth, style.borderBottomWidth),
      scroll: found.scrollHeight,
      client: found.clientHeight,
      inline: found.style.height,
    };
  }, field);
}

/** The height a field of `lines` lines has, by its box. */
function linesHigh(
  box: { line: number; edges: number },
  lines: number,
): number {
  return lines * box.line + box.edges;
}

/** Types `lines` into `field`, in place of what it holds, a line each. */
async function typeLines(
  field: "reading" | "translation",
  lines: readonly string[],
): Promise<void> {
  await area(field).click();
  await browser.keys([Key.Ctrl, "a"]);
  await browser.keys(["Backspace"]);
  for (const [index, line] of lines.entries()) {
    if (index > 0) await browser.keys(["Enter"]);
    if (line !== "") await browser.keys(Array.from(line));
  }
}

/**
 * Moves the pointer out of the library and waits for any tooltip to go, so that
 * a picture of it shows no hover.
 */
async function pointerAway(): Promise<void> {
  const at = await browser.execute(() => {
    const pane = document.querySelector(".workspace-split.mod-root");
    if (pane === null) throw new Error("no main pane");
    const box = pane.getBoundingClientRect();
    return { x: Math.round(box.left + 40), y: Math.round(box.bottom - 40) };
  });
  await browser
    .action("pointer")
    .move({ origin: "viewport", ...at })
    .perform();
  await browser.$(".tooltip").waitForExist({ reverse: true });
}

/**
 * Saves a picture of the library, from its top to just under its last row,
 * for the guide.
 */
async function pictureOfLibrary(name: string): Promise<void> {
  await pointerAway();
  const clip = await browser.execute(() => {
    const leaf = document.querySelector(
      '.workspace-leaf-content[data-type="inkline-library"]',
    );
    const list = document.querySelector(".inkline-library-list");
    if (leaf === null || list === null) throw new Error("no library");
    const whole = leaf.getBoundingClientRect();
    const bottom = Math.min(whole.bottom, list.getBoundingClientRect().bottom);
    return {
      x: Math.floor(whole.left),
      y: Math.floor(whole.top),
      width: Math.ceil(whole.width),
      height: Math.ceil(bottom + 12 - whole.top),
    };
  });
  await saveClip(name, clip);
}

describe("The library's look", function () {
  before(async function () {
    await loadModules();
  });

  beforeEach(async function () {
    await startOver();
    await browser.executeObsidian(({ app }) => {
      app.workspace.detachLeavesOfType("inkline-library");
    });
    await useTheme("moonstone");
    // The default sidebar's width, which the guide's pictures show.
    await setSidebar(300);
    await makeVault();
  });

  afterEach(async function () {
    await useTheme("moonstone");
  });

  after(async function () {
    await startOver();
  });

  for (const [theme, name] of [
    ["moonstone", "light"],
    ["obsidian", "dark"],
  ] as const) {
    it(`lays out what a row says as one list 4 px from it and 12 px from the next, in the ${name} theme`, async function () {
      await useTheme(theme);
      await showLibrary();
      const rows = await layout();
      expect(rows.map(({ path }) => path)).toEqual(
        symbols.map(({ file }) => file),
      );
      const [arch, gate, sun, tower, water] = rows;
      if (
        arch === undefined ||
        gate === undefined ||
        sun === undefined ||
        tower === undefined ||
        water === undefined
      ) {
        throw new Error("a row is missing");
      }
      // A row with nothing under it keeps the list's gap to the next.
      expect(arch.values).toBeNull();
      expect(arch.notes).toBeNull();
      expect(arch.row.bottom).toBeCloseTo(arch.line, 0);
      expect(gate.row.top - arch.row.bottom).toBeCloseTo(gap.rows, 0);
      // Readings and translations, then uses, as one list.
      if (gate.values === null || gate.notes === null) {
        throw new Error("gate shows too little");
      }
      expect(gate.values.top - gate.line).toBeCloseTo(gap.around, 0);
      expect(gate.notes.top - gate.values.bottom).toBeCloseTo(0, 0);
      expect(sun.row.top - gate.notes.bottom).toBeCloseTo(
        gap.around + gap.rows,
        0,
      );
      // Readings and translations alone, and a translation alone.
      for (const [row, next] of [
        [sun, tower],
        [tower, water],
      ] as const) {
        if (row.values === null)
          throw new Error(`no values in ${String(row.path)}`);
        expect(row.notes).toBeNull();
        expect(row.values.top - row.line).toBeCloseTo(gap.around, 0);
        expect(next.row.top - row.values.bottom).toBeCloseTo(
          gap.around + gap.rows,
          0,
        );
      }
      // Uses alone.
      if (water.notes === null) throw new Error("water's uses are not open");
      expect(water.values).toBeNull();
      expect(water.notes.top - water.line).toBeCloseTo(gap.around, 0);
      expect(water.row.bottom - water.notes.bottom).toBeCloseTo(gap.around, 0);

      const set = await lettering();
      // From the start of the row, with no padding of their own.
      expect(set.padding).toBe("0px");
      expect(set.starts.values).toBeCloseTo(set.starts.row, 0);
      expect(set.starts.label).toBeCloseTo(set.starts.row, 0);
      expect(set.starts.uses).toBeCloseTo(set.starts.row, 0);
      expect(set.starts.item).toBeGreaterThan(set.starts.uses);
      // Labels in bold; values and notes as they were.
      expect(set.label.weight).toBeGreaterThanOrEqual(700);
      expect(set.usesLabel.weight).toBeGreaterThanOrEqual(700);
      expect(set.usesText).toBe("Uses:");
      expect(set.value.weight).toBeLessThan(600);
      expect(set.note.weight).toBeLessThan(600);
      expect(set.item.bullet).toBe("disc");
      expect(set.item.display).toBe("list-item");
      await pictureOfLibrary(`library-rows-${name}`);

      // Quick edit's labels are the size all of it takes.
      await quickEdit("sun.ink.png");
      const label = await formLabel();
      for (const type of [
        set.label,
        set.value,
        set.line,
        set.usesLabel,
        set.note,
      ]) {
        expect(type.size).toBe(label.size);
      }
      expect(set.item.size).toBe(label.size);
      // Its readings fit their four lines, and the rows that wait say so.
      const reading = await fieldBox("reading");
      expect(reading.height).toBeCloseTo(linesHigh(reading, 4), 0);
      const disabled = (await buttons()).filter((button) => button.disabled);
      expect(
        disabled.map(({ path, role }) => `${String(path)} ${String(role)}`),
      ).toEqual([
        "arch.ink.png uses",
        "arch.ink.png edit",
        "gate.ink.png uses",
        "gate.ink.png edit",
        "tower.ink.png uses",
        "tower.ink.png edit",
        "water.ink.png uses",
        "water.ink.png edit",
      ]);
      await pictureOfLibrary(`library-quick-edit-${name}`);
      await formButton("Cancel").click();
      await waitForClosed();
    });
  }

  it("disables the other rows' Uses and Quick edit during Quick edit, and gives them back", async function () {
    await openAtMarker("Notebook.md", "HERE");
    await showLibrary();
    const before = await buttons();
    await quickEdit("sun.ink.png");
    const note = "Save or cancel Quick edit to use this.";
    const during = await buttons();
    // A button disabled already, as Uses with no notes is, stays as it was.
    expect(during).toEqual(
      before
        .filter(({ path }) => path !== "sun.ink.png")
        .map((button) =>
          button.role === "insert" || button.disabled
            ? button
            : { ...button, disabled: true, described: note },
        ),
    );
    // A screen reader still hears what each is, and that it is unavailable.
    const gateUses = browser
      .$(rowOf("gate.ink.png"))
      .$(".inkline-library-uses");
    const towerEdit = browser
      .$(rowOf("tower.ink.png"))
      .$(".inkline-library-edit");
    expect(await gateUses.getComputedRole()).toBe("button");
    expect(await gateUses.getComputedLabel()).toBe("Uses (2)");
    expect(await gateUses.getAttribute("aria-expanded")).toBe("true");
    expect(await towerEdit.getComputedLabel()).toBe(
      "Quick edit the name, readings, and translations of tower",
    );
    // Clicks on them do nothing, and leave the focus in the form.
    await nameField().click();
    await gateUses.click();
    await towerEdit.click();
    await browser.pause(200);
    expect(await browser.$$(".inkline-library-edit-form").length).toBe(1);
    expect(await nameField().getValue()).toBe("sun");
    expect(await focused()).toMatchObject({
      tag: "INPUT",
      inForm: true,
      path: "sun.ink.png",
    });
    // The notes listed still open, and a symbol still inserts.
    expect(
      await browser.$(rowOf("gate.ink.png")).$$(".inkline-library-note").length,
    ).toBe(2);
    await browser
      .$(rowOf("tower.ink.png"))
      .$(".inkline-library-insert")
      .click();
    await browser.waitUntil(async () =>
      browser.executeObsidian(({ app, obsidian }) => {
        const view = app.workspace
          .getLeavesOfType("markdown")
          .map((leaf) => leaf.view)
          .find(
            (found) =>
              found instanceof obsidian.MarkdownView &&
              found.file?.path === "Notebook.md",
          );
        return (
          view instanceof obsidian.MarkdownView &&
          view.editor.getValue().includes("![[tower.ink.png]]")
        );
      }),
    );
    await formButton("Cancel").click();
    await waitForClosed();
    // Given back as the form closes, with no click kept for later: gate's
    // uses stay open, and tower's, which it now has, can open.
    await browser.waitUntil(
      async () =>
        (await browser
          .$(rowOf("tower.ink.png"))
          .$(".inkline-library-uses")
          .getText()) === "Uses (1)",
    );
    await browser.pause(400);
    const after = await buttons();
    expect(after.filter((button) => button.described !== null)).toEqual([]);
    expect(
      after
        .filter((button) => button.disabled)
        .map(({ path, role }) => `${String(path)} ${String(role)}`),
    ).toEqual(["arch.ink.png uses"]);
    expect(await gateUses.getAttribute("aria-expanded")).toBe("true");
    expect(
      await browser.$(rowOf("gate.ink.png")).$$(".inkline-library-note").length,
    ).toBe(2);
    expect(await focused()).toMatchObject({
      path: "sun.ink.png",
      role: "edit",
    });
    await saveScreenshot("library-buttons-given-back");
  });

  it("disables Show more during Quick edit, which draws its rows only after", async function () {
    await browser.executeObsidian(async ({ app }) => {
      const { canvas } = window.inklineTest;
      const { bytes } = await canvas.saveInk({ strokes: [] }, undefined, []);
      for (let at = 0; at < 100; at++) {
        await app.vault.createBinary(
          `row ${String(at).padStart(3, "0")}.ink.png`,
          bytes.slice().buffer,
        );
      }
    });
    await browser.executeObsidianCommand("inkline:show-library");
    const more = browser.$(".inkline-library-more");
    await more.waitForExist();
    await quickEdit("arch.ink.png");
    expect(await more.getProperty("disabled")).toBe(true);
    expect((await buttons()).find(({ role }) => role === "more")).toMatchObject(
      {
        described: "Save or cancel Quick edit to use this.",
      },
    );
    await more.click();
    await formButton("Cancel").click();
    await waitForClosed();
    // Closing redraws the list, Show more with it, which takes a moment on a
    // busy host: wait for the new button, then give a click held from Quick
    // edit time to show more rows, which it must not.
    await browser.waitUntil(
      async () =>
        await browser.execute(() => {
          const button = document.querySelector(".inkline-library-more");
          return button instanceof HTMLButtonElement && !button.disabled;
        }),
      { timeoutMsg: "Show more did not come back enabled after Quick edit" },
    );
    await browser.pause(400);
    expect(
      await browser.$(".inkline-library-more").getProperty("disabled"),
    ).toBe(false);
    expect(await browser.$$(".inkline-library-symbol").length).toBe(100);
  });

  it("fits Quick edit's fields to their text, from two lines to eight", async function () {
    const native = await browser.execute(() =>
      CSS.supports("field-sizing", "content"),
    );
    console.log(
      `Obsidian ${browser.getObsidianVersion()}, installer ${browser.getObsidianInstallerVersion()}: field-sizing ${native ? "supported" : "missing, sized by script"}`,
    );
    await showLibrary();
    // Opened on four readings, it shows all four.
    await quickEdit("sun.ink.png");
    let reading = await fieldBox("reading");
    expect(reading.height).toBeCloseTo(linesHigh(reading, 4), 0);
    expect(reading.scroll).toBeLessThanOrEqual(reading.client);
    // Fewer than two lines take two.
    const translation = await fieldBox("translation");
    expect(translation.height).toBeCloseTo(linesHigh(translation, 2), 0);
    await typeLines("translation", ["sun"]);
    expect((await fieldBox("translation")).height).toBeCloseTo(
      linesHigh(translation, 2),
      0,
    );
    await typeLines("translation", []);
    expect((await fieldBox("translation")).height).toBeCloseTo(
      linesHigh(translation, 2),
      0,
    );
    // It grows a line at a time, and stops at eight, past which it scrolls.
    const lines = ["HI", "SO", "TE", "NA", "MU", "RA", "KE", "PO", "LI", "WE"];
    for (const count of [5, 6, 8, 10]) {
      await typeLines("reading", lines.slice(0, count));
      reading = await fieldBox("reading");
      expect(reading.height).toBeCloseTo(
        linesHigh(reading, Math.min(count, 8)),
        0,
      );
    }
    expect(reading.scroll).toBeGreaterThan(reading.client);
    // And shrinks back as lines go.
    await typeLines("reading", ["HI", "SO", "TE"]);
    expect((await fieldBox("reading")).height).toBeCloseTo(
      linesHigh(reading, 3),
      0,
    );
    // A line too long for the field wraps, and the field fits what wraps.
    await typeLines("reading", [
      "a reading long enough to go on past the end of the field, wrap onto a second line of it, then onto a third, and in a sidebar this wide onto a fourth",
    ]);
    reading = await fieldBox("reading");
    const wrapped = (reading.height - reading.edges) / reading.line;
    expect(wrapped).toBeGreaterThanOrEqual(2.95);
    expect(Math.abs(wrapped - Math.round(wrapped))).toBeLessThan(0.05);
    expect(reading.scroll).toBeLessThanOrEqual(reading.client);
    await saveScreenshot("library-quick-edit-fitted");
  });

  it("keeps a field at the height it is dragged to", async function () {
    await showLibrary();
    await quickEdit("gate.ink.png");
    const start = await fieldBox("reading");
    expect(start.height).toBeCloseTo(linesHigh(start, 2), 0);
    // The handle, in the field's end corner at the bottom.
    const corner = await browser.execute(() => {
      const found = document.querySelector(
        '.inkline-library-edit-form textarea[data-inkline-field="reading"]',
      );
      if (found === null) throw new Error("no reading field");
      const box = found.getBoundingClientRect();
      return { x: Math.round(box.right - 3), y: Math.round(box.bottom - 3) };
    });
    await browser
      .action("pointer", { parameters: { pointerType: "mouse" } })
      .move({ origin: "viewport", ...corner })
      .down()
      .move({
        origin: "viewport",
        x: corner.x,
        y: corner.y + 30,
        duration: 200,
      })
      .move({
        origin: "viewport",
        x: corner.x,
        y: corner.y + 60,
        duration: 200,
      })
      .up()
      .perform();
    const dragged = await fieldBox("reading");
    expect(dragged.inline).not.toBe("");
    expect(dragged.height).toBeGreaterThan(start.height + 40);
    // Lines typed after that leave it as it was dragged.
    await typeLines("reading", ["TA", "DA", "RA"]);
    expect((await fieldBox("reading")).height).toBeCloseTo(dragged.height, 0);
    await typeLines("reading", ["TA"]);
    expect((await fieldBox("reading")).height).toBeCloseTo(dragged.height, 0);
  });

  it("opens a note it lists, and with Ctrl a new tab for it", async function () {
    await showLibrary();
    const tabs = async () =>
      browser.executeObsidian(
        ({ app }) => app.workspace.getLeavesOfType("markdown").length,
      );
    const activePath = async () =>
      browser.executeObsidian(
        ({ app }) => app.workspace.getActiveFile()?.path ?? null,
      );
    await browser.$(rowOf("gate.ink.png")).$("a=Inscription").click();
    await browser.waitUntil(
      async () => (await activePath()) === "Inscription.md",
    );
    const open = await tabs();
    const link = browser.$(rowOf("gate.ink.png")).$("a=Notebook");
    await link.waitForClickable();
    const at = await browser.execute(() => {
      const found = Array.from(
        document.querySelectorAll(".inkline-library-note"),
      ).find((note) => note.textContent === "Notebook");
      if (found === undefined) throw new Error("no Notebook link");
      const box = found.getBoundingClientRect();
      return {
        x: Math.round(box.left + box.width / 2),
        y: Math.round(box.top + box.height / 2),
      };
    });
    await browser.actions([
      browser.action("key").down(Key.Ctrl).pause(100).pause(100).up(Key.Ctrl),
      browser
        .action("pointer", { parameters: { pointerType: "mouse" } })
        .move({ origin: "viewport", ...at })
        .down()
        .up()
        .pause(100),
    ]);
    await browser.waitUntil(async () => (await tabs()) === open + 1);
    expect(
      await browser.executeObsidian(({ app }) =>
        app.workspace
          .getLeavesOfType("markdown")
          .map((leaf) => leaf.getViewState().state?.file)
          .sort(),
      ),
    ).toEqual(["Inscription.md", "Notebook.md"]);
  });
});
