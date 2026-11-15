// The library's rows and Quick edit in real Obsidian: the space that keeps what
// a row shows under its name with that row, the list's name, which shows no
// tooltip, and one Save of a symbol's name, readings, and translations, of each
// alone, of nothing, a cancel, and one part failing. Every symbol and note is
// synthetic.

import { browser, expect } from "@wdio/globals";
import { stalledAfter } from "../../../src/notes/file-writes.ts";
import { loadModules } from "../support/browser.ts";
import {
  createSymbol,
  hold,
  letGo,
  startOver,
  symbolFiles,
  waitForHeld,
  waitForNotice,
} from "../support/editor.ts";
import { saveScreenshot } from "../support/screenshots.ts";

/** Fields to give a symbol. */
interface Fields {
  readonly reading?: readonly string[];
  readonly translation?: readonly string[];
}

/** An element's edges, in pixels. */
interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** A symbol at `file` that says `fields` about itself. */
async function symbolWith(file: string, fields: Fields): Promise<void> {
  await createSymbol(file);
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

/** What a file's fields say, from the file itself. */
async function fieldsOf(file: string): Promise<{
  reading: readonly string[];
  translation: readonly string[];
}> {
  return browser.executeObsidian(async ({ app }, wanted) => {
    const found = app.vault.getFileByPath(wanted);
    if (found === null) throw new Error(`no ${wanted}`);
    const { png, text } = window.inklineTest;
    const bytes = new Uint8Array(await app.vault.readBinary(found));
    return text.readText(png.readChunks(bytes));
  }, file);
}

/** A file's bytes, to compare. */
async function bytesOf(file: string): Promise<string> {
  return browser.executeObsidian(async ({ app }, wanted) => {
    const found = app.vault.getFileByPath(wanted);
    if (found === null) throw new Error(`no ${wanted}`);
    return Array.from(new Uint8Array(await app.vault.readBinary(found))).join(
      ",",
    );
  }, file);
}

/** A note's text and when it was last written, from its file. */
async function noteOf(
  path: string,
): Promise<{ text: string; mtime: number } | undefined> {
  return browser.executeObsidian(async ({ app }, wanted) => {
    const file = app.vault.getFileByPath(wanted);
    return file === null
      ? undefined
      : { text: await app.vault.read(file), mtime: file.stat.mtime };
  }, path);
}

/** Makes `note`, which embeds `symbol`, and waits for Obsidian to index it. */
async function noteUsing(note: string, symbol: string): Promise<void> {
  await browser.executeObsidian(
    async ({ app }, path, embedded) => {
      await app.vault.create(path, `See ![[${embedded}]] here.\n`);
    },
    note,
    symbol,
  );
  await browser.waitUntil(async () =>
    browser.executeObsidian(
      ({ app }, from, to) =>
        (app.metadataCache.resolvedLinks[from]?.[to] ?? 0) > 0,
      note,
      symbol,
    ),
  );
}

/** Has Obsidian update links without asking. */
async function updateLinks(): Promise<void> {
  await browser.executeObsidian(({ app }) => {
    const setConfig: unknown = Reflect.get(app.vault, "setConfig");
    if (typeof setConfig !== "function") throw new Error("no vault settings");
    Reflect.apply(setConfig, app.vault, ["alwaysUpdateLinks", true]);
  });
}

async function showLibrary(): Promise<void> {
  await browser.executeObsidianCommand("inkline:show-library");
  await browser.$(".inkline-library-list").waitForExist();
}

/** The selector of the library's row for `file`. */
function rowOf(file: string): string {
  return `.inkline-library-symbol[data-inkline-path="${file}"]`;
}

const form = () => browser.$(".inkline-library-edit-form");
const nameField = () => form().$("input");
const formButton = (text: "Save" | "Cancel") => form().$(`button=${text}`);
const formError = () => form().$(".inkline-library-edit-error");

/** A text area of Quick edit. */
function area(field: "reading" | "translation"): ReturnType<typeof browser.$> {
  return form().$(`textarea[data-inkline-field="${field}"]`);
}

/** Opens Quick edit on `file`'s row, once its fields have read the file. */
async function quickEdit(file: string): Promise<void> {
  await browser.$(rowOf(file)).$(".inkline-library-edit").click();
  await formButton("Save").waitForEnabled();
}

async function waitForClosed(): Promise<void> {
  await form().waitForExist({ reverse: true });
}

/** What has the focus: its tag, role in a row, row, and field. */
async function focused(): Promise<{
  tag: string | null;
  role: string | null;
  path: string | null;
  field: string | null;
  text: string | null;
}> {
  return browser.execute(() => {
    const active = document.activeElement;
    return {
      tag: active?.tagName ?? null,
      role: active?.getAttribute("data-inkline-role") ?? null,
      path:
        active
          ?.closest("[data-inkline-path]")
          ?.getAttribute("data-inkline-path") ?? null,
      field: active?.getAttribute("data-inkline-field") ?? null,
      text: active?.tagName === "BUTTON" ? active.textContent : null,
    };
  });
}

/** Waits for the row of `file` to show `text` among its values. */
async function waitForValues(file: string, text: string): Promise<void> {
  await browser.waitUntil(async () => {
    const line = browser.$(rowOf(file)).$(".inkline-library-values");
    return (await line.isExisting()) && (await line.getText()).includes(text);
  });
}

/**
 * Has the vault's next writes of symbol files fail with `reason`, as a full or
 * read-only disk would, until {@link writeAgain}.
 */
async function failWrites(reason: string): Promise<void> {
  await browser.executeObsidian(({ app }, why) => {
    app.vault.modifyBinary = () => Promise.reject(new Error(why));
  }, reason);
}

/** Puts back the vault's own writes, counting those from now on. */
async function writeAgain(): Promise<void> {
  await browser.executeObsidian(({ app }) => {
    Reflect.deleteProperty(app.vault, "modifyBinary");
    const write = app.vault.modifyBinary.bind(app.vault);
    Reflect.set(window, "inklineWrites", 0);
    app.vault.modifyBinary = (...args) => {
      Reflect.set(
        window,
        "inklineWrites",
        Number(Reflect.get(window, "inklineWrites")) + 1,
      );
      return write(...args);
    };
  });
}

/** How many symbol writes there were since {@link writeAgain}. */
async function writesSince(): Promise<number> {
  return browser.execute(() => Number(Reflect.get(window, "inklineWrites")));
}

/** Has Obsidian's renames fail with `reason`, until {@link renameAgain}. */
async function failRenames(reason: string): Promise<void> {
  await browser.executeObsidian(({ app }, why) => {
    Reflect.set(
      app.fileManager,
      "inklineOriginalRename",
      app.fileManager.renameFile.bind(app.fileManager),
    );
    app.fileManager.renameFile = () => Promise.reject(new Error(why));
  }, reason);
}

/** Puts back Obsidian's own renames, if {@link failRenames} took them. */
async function renameAgain(): Promise<void> {
  await browser.executeObsidian(({ app }) => {
    const original: unknown = Reflect.get(
      app.fileManager,
      "inklineOriginalRename",
    );
    if (typeof original !== "function") return;
    Reflect.set(app.fileManager, "renameFile", original);
    Reflect.deleteProperty(app.fileManager, "inklineOriginalRename");
  });
}

/**
 * Moves the pointer to `x`, `y` in the window, as a person's mouse would, and
 * returns the classes of what the page heard the pointer move over there, so
 * that a check of what shows there knows the pointer reached it.
 */
async function pointAt(x: number, y: number): Promise<string> {
  await browser.execute(() => {
    Reflect.deleteProperty(window, "inklinePointer");
    document.addEventListener(
      "mousemove",
      ({ target }) => {
        Reflect.set(
          window,
          "inklinePointer",
          target instanceof HTMLElement ? target.className : "",
        );
      },
      { capture: true, once: true },
    );
  });
  await browser
    .action("pointer")
    .move({ origin: "viewport", x: Math.round(x), y: Math.round(y) })
    .perform();
  return browser.execute(() => String(Reflect.get(window, "inklinePointer")));
}

/**
 * Moves the mouse a little in an empty part of the window, as a person has
 * before they rest it anywhere. Obsidian, 1.13 and 1.15 alike, counts the
 * mouse's moves so as to tell it from a touch, and shows no tooltip for a
 * pointer it has seen move fewer than twice.
 */
async function warmUpPointer(): Promise<void> {
  const pane = await boxOf(".workspace-split.mod-root");
  for (const step of [0, 1, 2]) {
    expect(
      await pointAt(pane.left + 40 + 10 * step, pane.bottom - 40),
    ).not.toContain("inkline");
  }
}

/** The box of the first element `selector` finds. */
async function boxOf(selector: string): Promise<Box> {
  return browser.execute((wanted) => {
    const found = document.querySelector(wanted);
    if (found === null) throw new Error(`no ${wanted}`);
    const { left, right, top, bottom } = found.getBoundingClientRect();
    return { left, right, top, bottom };
  }, selector);
}

/**
 * Has the page note every tooltip Obsidian shows from now on, however brief,
 * for {@link tooltipsSeen}.
 */
async function watchTooltips(): Promise<void> {
  await browser.execute(() => {
    const seen: string[] = [];
    Reflect.set(window, "inklineTooltips", seen);
    const note = (): void => {
      for (const tooltip of document.querySelectorAll(".tooltip")) {
        seen.push(tooltip.textContent);
      }
    };
    const watcher = new MutationObserver(note);
    watcher.observe(document.body, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    Reflect.set(window, "inklineTooltipWatcher", watcher);
  });
}

/** The tooltips seen since {@link watchTooltips}, which stops watching. */
async function tooltipsSeen(): Promise<string[]> {
  return browser.execute(() => {
    const watcher: unknown = Reflect.get(window, "inklineTooltipWatcher");
    if (watcher instanceof MutationObserver) watcher.disconnect();
    const seen: unknown = Reflect.get(window, "inklineTooltips");
    return Array.isArray(seen) ? seen.map(String) : [];
  });
}

describe("The library's rows", function () {
  before(async function () {
    await loadModules();
  });

  beforeEach(async function () {
    await startOver();
    await browser.executeObsidian(({ app }) => {
      app.workspace.detachLeavesOfType("inkline-library");
    });
  });

  after(async function () {
    await startOver();
  });

  for (const theme of ["moonstone", "obsidian"] as const) {
    it(`keep each row's readings and translations nearer it than the next row, in the ${theme} theme`, async function () {
      await browser.executeObsidian(({ app }, wanted) => {
        const change: unknown = Reflect.get(app, "changeTheme");
        if (typeof change !== "function") throw new Error("no themes");
        Reflect.apply(change, app, [wanted]);
      }, theme);
      await symbolWith("a plain.ink.png", {});
      await symbolWith("b said.ink.png", {
        reading: ["TA", "DA"],
        translation: ["field"],
      });
      await symbolWith("c read.ink.png", { reading: ["KA"] });
      await symbolWith("d last.ink.png", {});
      await showLibrary();
      await waitForValues("b said.ink.png", "Translation: field");
      await waitForValues("c read.ink.png", "Reading: KA");
      const rows = await browser.execute(() =>
        Array.from(document.querySelectorAll(".inkline-library-symbol")).map(
          (row) => {
            const box = (element: Element | null) => {
              if (element === null) return null;
              const { top, bottom } = element.getBoundingClientRect();
              return { top, bottom };
            };
            const insert = box(row.querySelector(".inkline-library-insert"));
            const actions = box(row.querySelector(".inkline-library-actions"));
            if (insert === null || actions === null) throw new Error("no row");
            return {
              path: row.getAttribute("data-inkline-path"),
              top: row.getBoundingClientRect().top,
              bottom: row.getBoundingClientRect().bottom,
              // The line with the symbol and its buttons.
              line: Math.max(insert.bottom, actions.bottom),
              values: box(row.querySelector(".inkline-library-values")),
            };
          },
        ),
      );
      expect(rows.map(({ path }) => path)).toEqual([
        "a plain.ink.png",
        "b said.ink.png",
        "c read.ink.png",
        "d last.ink.png",
      ]);
      // Each row's values sit at least 4 pixels nearer its own line than the
      // next row, and rows with none still have space between them.
      const nearer = 4;
      for (const [index, row] of rows.entries()) {
        const next = rows[index + 1];
        if (next === undefined) continue;
        expect(next.top - row.bottom).toBeGreaterThanOrEqual(nearer);
        if (row.values === null) continue;
        const above = row.values.top - row.line;
        const below = next.top - row.values.bottom;
        expect(above).toBeGreaterThanOrEqual(0);
        expect(below - above).toBeGreaterThanOrEqual(nearer);
      }
      await saveScreenshot(`library-rows-spacing-${theme}`);
    });
  }

  it("show no tooltip over the list's empty space, and keep its name for a screen reader", async function () {
    // A name the row shortens, whose button's tooltip has the whole of it.
    const wanted =
      "c name long enough to go on past the end of the list and wrap onto a line of its own there";
    await symbolWith("a plain.ink.png", {});
    await symbolWith("b said.ink.png", { reading: ["TA"] });
    await symbolWith(`${wanted}.ink.png`, {});
    await showLibrary();
    await waitForValues("b said.ink.png", "Reading: TA");
    // A tooltip that should show does, after Obsidian's delay, which says how
    // long to wait for one that should not.
    const long = await boxOf(
      `${rowOf(`${wanted}.ink.png`)} .inkline-library-insert`,
    );
    await warmUpPointer();
    await watchTooltips();
    const start = Date.now();
    expect(
      await pointAt((long.left + long.right) / 2, (long.top + long.bottom) / 2),
    ).not.toBe("");
    try {
      await browser.waitUntil(async () =>
        browser.execute(
          (text) => document.querySelector(".tooltip")?.textContent === text,
          wanted,
        ),
      );
    } catch (error) {
      const focus = await browser.execute(() => document.hasFocus());
      throw new Error(
        `the tooltips were ${JSON.stringify(await tooltipsSeen())}, and the window ${focus ? "had" : "lacked"} the focus`,
        { cause: error },
      );
    }
    const delay = Date.now() - start;
    const patience = Math.max(1500, 3 * delay);
    await tooltipsSeen();

    // The long name's own can still be going as the pointer leaves.
    const others = (seen: string[]) => [
      ...new Set(seen.filter((text) => text !== wanted)),
    ];
    const plain = await boxOf(rowOf("a plain.ink.png"));
    const said = await boxOf(rowOf("b said.ink.png"));
    const values = await boxOf(
      `${rowOf("b said.ink.png")} .inkline-library-values`,
    );
    const middle = (plain.left + plain.right) / 2;
    // The line of a row's values, and then the space between two rows.
    await watchTooltips();
    expect(await pointAt(middle, (values.top + values.bottom) / 2)).toContain(
      "inkline-values",
    );
    await browser.pause(patience);
    await saveScreenshot("library-no-tooltip");
    expect(others(await tooltipsSeen())).toEqual([]);
    await watchTooltips();
    expect(await pointAt(middle, (plain.bottom + said.top) / 2)).toContain(
      "inkline-library-list",
    );
    await browser.pause(patience);
    expect(others(await tooltipsSeen())).toEqual([]);
    const list = browser.$(".inkline-library-list");
    expect(await list.getAttribute("aria-label")).toBe(null);
    expect(await list.getComputedRole()).toBe("list");
    expect(await list.getComputedLabel()).toBe("Symbols");

    // Quick edit has a name of its own, which shows no tooltip either.
    await quickEdit("b said.ink.png");
    expect(await form().getAttribute("aria-label")).toBe(null);
    expect(await form().getComputedRole()).toBe("form");
    expect(await form().getComputedLabel()).toBe("Quick edit b said");
    await watchTooltips();
    const hint = await boxOf(".inkline-library-edit-form .inkline-text-hint");
    expect(
      await pointAt((hint.left + hint.right) / 2, (hint.top + hint.bottom) / 2),
    ).toContain("inkline-text-hint");
    await browser.pause(patience);
    expect(others(await tooltipsSeen())).toEqual([]);
  });
});

describe("Quick edit in the library", function () {
  before(async function () {
    await loadModules();
  });

  beforeEach(async function () {
    await startOver();
    await browser.executeObsidian(({ app }) => {
      app.workspace.detachLeavesOfType("inkline-library");
    });
    await updateLinks();
  });

  afterEach(async function () {
    await renameAgain();
    await browser.executeObsidian(({ app }) => {
      Reflect.deleteProperty(app.vault, "modifyBinary");
    });
    await letGo();
  });

  after(async function () {
    await startOver();
  });

  it("opens on the name, with the readings and translations, and takes the keys", async function () {
    await symbolWith("gate.ink.png", {
      reading: ["TA"],
      translation: ["door"],
    });
    await symbolWith("tower.ink.png", {});
    await showLibrary();
    expect(
      await browser
        .$(rowOf("gate.ink.png"))
        .$(".inkline-library-edit")
        .getText(),
    ).toBe("Quick edit");
    await quickEdit("gate.ink.png");
    await saveScreenshot("library-quick-edit");
    expect(await nameField().getValue()).toBe("gate");
    expect(await area("reading").getValue()).toBe("TA");
    expect(await area("translation").getValue()).toBe("door");
    // The name has the focus, all of it selected, as for a rename.
    const selection = await browser.execute(() => {
      const active = document.activeElement;
      if (!(active instanceof HTMLInputElement)) return null;
      return active.value.slice(
        active.selectionStart ?? 0,
        active.selectionEnd ?? 0,
      );
    });
    expect(selection).toBe("gate");
    // Tab goes through the fields in the order they show.
    const order: (string | null)[] = [];
    for (let step = 0; step < 4; step++) {
      await browser.keys(["Tab"]);
      const now = await focused();
      order.push(now.field ?? now.text);
    }
    expect(order).toEqual(["reading", "translation", "Save", "Cancel"]);
    // One row at a time: another row's Quick edit goes back to this one.
    await browser.$(rowOf("tower.ink.png")).$(".inkline-library-edit").click();
    expect(await browser.$$(".inkline-library-edit-form").length).toBe(1);
    expect((await focused()).tag).toBe("INPUT");
    await browser.keys(["Escape"]);
    await waitForClosed();
    expect(await focused()).toMatchObject({
      role: "edit",
      path: "gate.ink.png",
    });
  });

  it("saves a new name alone, with links following, and leaves the file's bytes", async function () {
    await symbolWith("gate.ink.png", { reading: ["TA"] });
    await noteUsing("Uses.md", "gate.ink.png");
    const before = await bytesOf("gate.ink.png");
    await showLibrary();
    await quickEdit("gate.ink.png");
    await nameField().setValue("arch");
    await browser.keys(["Enter"]);
    await waitForClosed();
    expect(await symbolFiles()).toEqual(["arch.ink.png"]);
    expect(await bytesOf("arch.ink.png")).toBe(before);
    await browser.waitUntil(async () =>
      ((await noteOf("Uses.md"))?.text ?? "").includes("![[arch.ink.png]]"),
    );
    await browser.waitUntil(
      async () => (await focused()).path === "arch.ink.png",
    );
    expect((await focused()).role).toBe("edit");
  });

  it("saves readings and translations alone, and leaves the name and the notes", async function () {
    await symbolWith("gate.ink.png", { reading: ["TA"] });
    await noteUsing("Uses.md", "gate.ink.png");
    const note = await noteOf("Uses.md");
    await showLibrary();
    await quickEdit("gate.ink.png");
    await area("reading").setValue("KA\nGA");
    await area("translation").setValue("door");
    await formButton("Save").click();
    await waitForClosed();
    expect(await symbolFiles()).toEqual(["gate.ink.png"]);
    expect(await fieldsOf("gate.ink.png")).toEqual({
      reading: ["KA", "GA"],
      translation: ["door"],
    });
    await waitForValues("gate.ink.png", "Readings: KA, GA");
    expect(await noteOf("Uses.md")).toEqual(note);
    expect(await focused()).toMatchObject({
      role: "edit",
      path: "gate.ink.png",
    });
  });

  it("saves a name, readings and translations with one Save", async function () {
    await symbolWith("gate.ink.png", {
      reading: ["TA"],
      translation: ["door"],
    });
    await noteUsing("Uses.md", "gate.ink.png");
    await showLibrary();
    await quickEdit("gate.ink.png");
    await nameField().setValue("arch");
    await area("reading").setValue("KA");
    await area("translation").click();
    await browser.keys(["Control", "a"]);
    await browser.keys(["Delete"]);
    // Mod+Enter saves from any field.
    await browser.keys(["Control", "Enter"]);
    await waitForClosed();
    expect(await symbolFiles()).toEqual(["arch.ink.png"]);
    expect(await fieldsOf("arch.ink.png")).toEqual({
      reading: ["KA"],
      translation: [],
    });
    await waitForValues("arch.ink.png", "Reading: KA");
    await browser.waitUntil(async () =>
      ((await noteOf("Uses.md"))?.text ?? "").includes("![[arch.ink.png]]"),
    );
    expect(await focused()).toMatchObject({
      role: "edit",
      path: "arch.ink.png",
    });
  });

  it("closes with nothing changed, and writes and renames nothing", async function () {
    await symbolWith("gate.ink.png", { reading: ["TA"] });
    const before = await bytesOf("gate.ink.png");
    await showLibrary();
    await writeAgain();
    await quickEdit("gate.ink.png");
    await formButton("Save").click();
    await waitForClosed();
    // The same name with spaces around it is the same name.
    await quickEdit("gate.ink.png");
    await nameField().setValue("  gate ");
    await browser.keys(["Enter"]);
    await waitForClosed();
    expect(await symbolFiles()).toEqual(["gate.ink.png"]);
    expect(await bytesOf("gate.ink.png")).toBe(before);
    expect(await writesSince()).toBe(0);
  });

  for (const [how, leave] of [
    ["Cancel", async () => formButton("Cancel").click()],
    ["Esc", async () => browser.keys(["Escape"])],
  ] as const) {
    it(`leaves everything as it was with ${how}`, async function () {
      await symbolWith("gate.ink.png", { reading: ["TA"] });
      const before = await bytesOf("gate.ink.png");
      await showLibrary();
      await quickEdit("gate.ink.png");
      await nameField().setValue("arch");
      await area("reading").setValue("KA");
      await leave();
      await waitForClosed();
      expect(await symbolFiles()).toEqual(["gate.ink.png"]);
      expect(await bytesOf("gate.ink.png")).toBe(before);
      expect(await focused()).toMatchObject({
        role: "edit",
        path: "gate.ink.png",
      });
    });
  }

  it("refuses a name before it writes anything, and keeps all that was typed", async function () {
    await symbolWith("gate.ink.png", { reading: ["TA"] });
    await createSymbol("tower.ink.png");
    const before = await bytesOf("gate.ink.png");
    await showLibrary();
    await quickEdit("gate.ink.png");
    await nameField().setValue("TOWER");
    await area("reading").setValue("KA");
    await formButton("Save").click();
    await browser.waitUntil(async () =>
      (await formError().getText()).includes("already has a symbol named"),
    );
    expect(await bytesOf("gate.ink.png")).toBe(before);
    expect(await nameField().getValue()).toBe("TOWER");
    expect(await area("reading").getValue()).toBe("KA");
    expect((await focused()).tag).toBe("INPUT");
    await nameField().setValue("arch");
    await browser.keys(["Enter"]);
    await waitForClosed();
    expect(await symbolFiles()).toEqual(["arch.ink.png", "tower.ink.png"]);
    expect((await fieldsOf("arch.ink.png")).reading).toEqual(["KA"]);
  });

  it("keeps the readings saved and the name typed when the rename fails, and then renames alone", async function () {
    await symbolWith("gate.ink.png", { reading: ["TA"] });
    await showLibrary();
    await quickEdit("gate.ink.png");
    await nameField().setValue("arch");
    await area("reading").setValue("KA ");
    await failRenames("the disk is read-only");
    await formButton("Save").click();
    await browser.waitUntil(async () =>
      (await formError().getText()).includes("the disk is read-only"),
    );
    expect(await formError().getText()).toContain(
      "The readings and translations are saved, but the symbol was not renamed:",
    );
    await saveScreenshot("library-quick-edit-rename-failed", form());
    expect(await symbolFiles()).toEqual(["gate.ink.png"]);
    expect((await fieldsOf("gate.ink.png")).reading).toEqual(["KA"]);
    // What was typed stays, the readings as saved, and the name to try again.
    expect(await nameField().getValue()).toBe("arch");
    expect(await nameField().getProperty("readOnly")).toBe(false);
    expect(await area("reading").getValue()).toBe("KA");
    expect(await area("reading").getProperty("readOnly")).toBe(false);
    expect((await focused()).tag).toBe("INPUT");
    await renameAgain();
    await writeAgain();
    await browser.keys(["Enter"]);
    await waitForClosed();
    expect(await symbolFiles()).toEqual(["arch.ink.png"]);
    expect((await fieldsOf("arch.ink.png")).reading).toEqual(["KA"]);
    // The readings were saved already, so the second Save only renamed.
    expect(await writesSince()).toBe(0);
  });

  it("renames nothing when the readings cannot be written, and keeps both", async function () {
    await symbolWith("gate.ink.png", { reading: ["TA"] });
    const before = await bytesOf("gate.ink.png");
    await showLibrary();
    await quickEdit("gate.ink.png");
    await nameField().setValue("arch");
    await area("reading").setValue("KA");
    await failWrites("the disk is full");
    await formButton("Save").click();
    await browser.waitUntil(async () =>
      (await formError().getText()).includes("the disk is full"),
    );
    expect(await formError().getText()).toContain("Nothing was renamed.");
    expect(await symbolFiles()).toEqual(["gate.ink.png"]);
    expect(await bytesOf("gate.ink.png")).toBe(before);
    expect(await nameField().getValue()).toBe("arch");
    expect(await area("reading").getValue()).toBe("KA");
    expect(await area("reading").getProperty("readOnly")).toBe(false);
    await writeAgain();
    await formButton("Save").click();
    await waitForClosed();
    expect(await symbolFiles()).toEqual(["arch.ink.png"]);
    expect((await fieldsOf("arch.ink.png")).reading).toEqual(["KA"]);
  });

  it("does not rename once left while its readings wait to be written", async function () {
    await symbolWith("gate.ink.png", { reading: ["TA"] });
    await showLibrary();
    await quickEdit("gate.ink.png");
    await nameField().setValue("arch");
    await area("reading").setValue("KA");
    await hold("write");
    await formButton("Save").click();
    await waitForHeld();
    const wait = form().$(".inkline-save-wait");
    await browser.waitUntil(async () => (await wait.getText()) !== "", {
      timeout: stalledAfter + 15_000,
    });
    expect(await wait.getText()).toContain(
      "Waiting for Obsidian to finish writing a file.",
    );
    await formButton("Cancel").click();
    await waitForClosed();
    await waitForNotice("so it may still finish. It will not be renamed.");
    await letGo();
    await waitForNotice("Saved gate.");
    await browser.pause(500);
    expect(await symbolFiles()).toEqual(["gate.ink.png"]);
    expect((await fieldsOf("gate.ink.png")).reading).toEqual(["KA"]);
  });

  it("follows a rename made elsewhere when the name is untouched, and keeps it", async function () {
    await symbolWith("gate.ink.png", { reading: ["TA"] });
    await showLibrary();
    await quickEdit("gate.ink.png");
    // Renamed as sync would, without Inkline.
    await browser.executeObsidian(async ({ app }) => {
      const file = app.vault.getFileByPath("gate.ink.png");
      if (file === null) throw new Error("no gate");
      await app.vault.rename(file, "arch.ink.png");
    });
    await browser.waitUntil(
      async () => (await nameField().getValue()) === "arch",
    );
    await area("reading").setValue("KA");
    await formButton("Save").click();
    await waitForClosed();
    expect(await symbolFiles()).toEqual(["arch.ink.png"]);
    expect((await fieldsOf("arch.ink.png")).reading).toEqual(["KA"]);
  });

  it("keeps a name typed through a rename made elsewhere, and renames from there", async function () {
    await symbolWith("gate.ink.png", { reading: ["TA"] });
    await showLibrary();
    await quickEdit("gate.ink.png");
    await nameField().setValue("lintel");
    await browser.executeObsidian(async ({ app }) => {
      const file = app.vault.getFileByPath("gate.ink.png");
      if (file === null) throw new Error("no gate");
      await app.vault.rename(file, "arch.ink.png");
    });
    // The form's name follows the file, and the name typed stays.
    await browser.waitUntil(
      async () => (await form().getComputedLabel()) === "Quick edit arch",
    );
    expect(await nameField().getValue()).toBe("lintel");
    await browser.keys(["Enter"]);
    await waitForClosed();
    expect(await symbolFiles()).toEqual(["lintel.ink.png"]);
  });
});
