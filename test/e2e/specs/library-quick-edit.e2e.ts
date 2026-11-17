// The library's rows and Quick edit in real Obsidian: the list's name, which
// shows no tooltip, and one Save of a symbol's name, readings, and
// translations, of nothing, a cancel, and one part failing. A new name alone is
// in library-renaming.e2e.ts, and readings and translations alone in
// symbol-text-library.e2e.ts. library-look.e2e.ts has how the rows look. Every
// symbol and note is synthetic.

import { browser, expect } from "@wdio/globals";
import { stalledAfter } from "../../../src/notes/file-writes.ts";
import { loadModules } from "../support/browser.ts";
import {
  createSymbol,
  hold,
  letGo,
  renamePastHold,
  startOver,
  symbolFiles,
  waitForHeld,
  waitForNotice,
} from "../support/editor.ts";
import { boxOf, pointAt, warmUpPointer } from "../support/hover.ts";
import { menuItems } from "../support/menus.ts";
import { saveScreenshot } from "../support/screenshots.ts";
import { showLibrary } from "../support/symbol-text-library.ts";
import { type Fields, fieldsOf } from "../support/symbol-text.ts";
import { bytesOf } from "../support/vault-files.ts";

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

/** The button of `role` in `file`'s row, above Quick edit's form when open. */
function rowButton(
  file: string,
  role: "insert" | "uses" | "edit",
): ReturnType<typeof browser.$> {
  return browser.$(rowOf(file)).$(`button[data-inkline-role="${role}"]`);
}

/**
 * Two of the ways to leave gate's Quick edit while its save waits, as a
 * person would: Cancel, and Esc on the row's own Quick edit. The third, a
 * click on that button, has a test of its own. Each calls the row's one way
 * of leaving, whichever step of the save waits, and that step alone decides
 * what is said, which quick-edit.test.ts checks for each step; so the tests
 * share the ways out between the two steps.
 */
const leavers = {
  cancel: ["Cancel", async () => formButton("Cancel").click()],
  escape: [
    "Esc on the row's Quick edit",
    async () => {
      await browser.execute(
        (selector) => {
          document.querySelector<HTMLElement>(selector)?.focus();
        },
        `${rowOf("gate.ink.png")} button[data-inkline-role="edit"]`,
      );
      expect(await focused()).toMatchObject({
        role: "edit",
        path: "gate.ink.png",
      });
      await browser.keys(["Escape"]);
    },
  ],
} as const;

/**
 * Waits past the double-click time, a few hundred milliseconds, so that the
 * next click on the same place is a click of its own.
 */
async function pastDoubleClick(): Promise<void> {
  await browser.pause(1000);
}

/**
 * The mouse. A press and its release need this one id: an action under another
 * is another pointer, at the corner of the window, and lets this one go with
 * no click.
 */
const mouse = () =>
  browser.action("pointer", {
    id: "mouse",
    parameters: { pointerType: "mouse" },
  });

/** Holds the main button down on the button of `role` in `file`'s row. */
async function pressOn(
  file: string,
  role: "insert" | "uses" | "edit",
): Promise<void> {
  const at = await browser.execute(
    (row, wanted) => {
      const target = document.querySelector(
        `${row} button[data-inkline-role="${wanted}"]`,
      );
      if (target === null) throw new Error(`no ${wanted} in ${row}`);
      const box = target.getBoundingClientRect();
      return {
        x: Math.round(box.left + box.width / 2),
        y: Math.round(box.top + box.height / 2),
      };
    },
    rowOf(file),
    role,
  );
  await mouse()
    .move({ origin: "viewport", ...at })
    .down()
    .perform(true);
}

/** Lets go of the button {@link pressOn} holds down, where the mouse is. */
async function release(): Promise<void> {
  await mouse().up().perform();
}

/**
 * Has the page note every click from now on, for {@link clicksSeen}, as the
 * role and row of the button it was on, and its count, as `edit gate.ink.png
 * 1`.
 */
async function watchClicks(): Promise<void> {
  await browser.execute(() => {
    const seen: string[] = [];
    Reflect.set(window, "inklineClicks", seen);
    window.addEventListener(
      "click",
      (event) => {
        const target = event.target;
        const button =
          target instanceof Element
            ? target.closest("[data-inkline-role]")
            : null;
        const role = button?.getAttribute("data-inkline-role") ?? "-";
        const path =
          button
            ?.closest("[data-inkline-path]")
            ?.getAttribute("data-inkline-path") ?? "-";
        seen.push(`${role} ${path} ${String(event.detail)}`);
      },
      true,
    );
  });
}

/** The clicks heard since {@link watchClicks}. */
async function clicksSeen(): Promise<string[]> {
  return browser.execute(() => {
    const seen: unknown = Reflect.get(window, "inklineClicks");
    return Array.isArray(seen) ? seen.map(String) : [];
  });
}

/** How many Quick edit forms the library holds. */
async function formCount(): Promise<number> {
  return browser.$$(".inkline-library-edit-form").length;
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

/** Renames a symbol through the vault, as sync would, without Inkline. */
async function renameElsewhere(from: string, to: string): Promise<void> {
  await browser.executeObsidian(
    async ({ app }, path, next) => {
      const file = app.vault.getFileByPath(path);
      if (file === null) throw new Error(`no ${path}`);
      await app.vault.rename(file, next);
    },
    from,
    to,
  );
}

/** Opens `note` in a tab, which a rename saves and so reads first. */
async function openNote(note: string): Promise<void> {
  await browser.executeObsidian(async ({ app }, path) => {
    const file = app.vault.getFileByPath(path);
    if (file === null) throw new Error(`no ${path}`);
    await app.workspace.getLeaf(false).openFile(file);
  }, note);
}

/** Turns Inkline off, or on, as Settings does. */
async function inkline(on: boolean): Promise<void> {
  await browser.executeObsidian(async ({ app }, enable) => {
    const plugins: unknown = Reflect.get(app, "plugins");
    const method: unknown =
      typeof plugins === "object" && plugins !== null
        ? Reflect.get(plugins, enable ? "enablePlugin" : "disablePlugin")
        : undefined;
    if (typeof method !== "function") throw new Error("no plugin controls");
    await (Reflect.apply(method, plugins, ["inkline"]) as Promise<void>);
  }, on);
}

/**
 * Holds the next read of the symbol at `path` until {@link letReadGo}, as a
 * save reads its file in its turn before it writes.
 */
async function holdSymbolRead(path: string): Promise<void> {
  await browser.executeObsidian(({ app }, wanted) => {
    const read = app.vault.readBinary.bind(app.vault);
    let go = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      go = resolve;
    });
    Reflect.set(window, "inklineLetReadGo", go);
    Reflect.set(window, "inklineReadHeld", false);
    app.vault.readBinary = async (file) => {
      if (file.path !== wanted) return read(file);
      Reflect.deleteProperty(app.vault, "readBinary");
      Reflect.set(window, "inklineReadHeld", true);
      await gate;
      return read(file);
    };
  }, path);
}

/** Waits for the read {@link holdSymbolRead} holds to be reached. */
async function waitForHeldRead(): Promise<void> {
  await browser.waitUntil(async () =>
    browser.execute(() => Reflect.get(window, "inklineReadHeld") === true),
  );
}

/** Lets go the read {@link holdSymbolRead} holds, if there is one. */
async function letReadGo(): Promise<void> {
  await browser.execute(() => {
    const go: unknown = Reflect.get(window, "inklineLetReadGo");
    Reflect.deleteProperty(window, "inklineLetReadGo");
    if (typeof go === "function") Reflect.apply(go, undefined, []);
  });
}

/** The lines the row says, each as shown. */
async function errorLines(): Promise<string[]> {
  return browser.execute(() =>
    Array.from(
      document.querySelectorAll(".inkline-library-edit-error > div"),
    ).map((line) => line.textContent),
  );
}

/** Waits for the row's wait line, and returns what it says. */
async function waitForWait(): Promise<string> {
  const line = form().$(".inkline-save-wait");
  await browser.waitUntil(async () => (await line.getText()) !== "", {
    timeout: stalledAfter + 15_000,
    timeoutMsg: "the row never said its save waits",
  });
  return line.getText();
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

/** How wide the library's list is, and how far what it holds reaches. */
async function listWidths(): Promise<{ client: number; scroll: number }> {
  return browser.execute(() => {
    const list = document.querySelector(".inkline-library-list");
    if (list === null) throw new Error("no list");
    return { client: list.clientWidth, scroll: list.scrollWidth };
  });
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
    // A press a failed test left held down.
    await browser.releaseActions();
    await renameAgain();
    await browser.executeObsidian(({ app }) => {
      Reflect.deleteProperty(app.vault, "modifyBinary");
      Reflect.deleteProperty(app.vault, "readBinary");
    });
    await letGo();
    await letReadGo();
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
    // One row at a time: another row's Quick edit waits, and Tab passes it.
    const other = browser.$(rowOf("tower.ink.png")).$(".inkline-library-edit");
    expect(await other.getProperty("disabled")).toBe(true);
    await browser.keys(["Tab"]);
    expect(await focused()).toMatchObject({
      role: "insert",
      path: "tower.ink.png",
    });
    await browser.keys(["Shift", "Tab"]);
    expect((await focused()).text).toBe("Cancel");
    // A click on it leaves the focus in this one.
    await other.click();
    await browser.pause(200);
    expect(await browser.$$(".inkline-library-edit-form").length).toBe(1);
    expect((await focused()).text).toBe("Cancel");
    await browser.keys(["Escape"]);
    await waitForClosed();
    expect(await focused()).toMatchObject({
      role: "edit",
      path: "gate.ink.png",
    });
  });

  it("fits the narrowest sidebar, a long name and all", async function () {
    const name = "a name long enough to go on past the end of the list";
    await symbolWith(`${name}.ink.png`, { reading: ["TA"] });
    await showLibrary();
    // The narrowest Obsidian lets a sidebar be, less the library's padding.
    await setSidebar(200);
    try {
      await browser.waitUntil(async () => (await listWidths()).client === 176);
      await quickEdit(`${name}.ink.png`);
      await area("translation").setValue("a translation long enough to wrap");
      const widths = await listWidths();
      expect(widths.scroll).toBeLessThanOrEqual(widths.client);
      expect(await nameField().getValue()).toBe(name);
      await saveScreenshot("library-quick-edit-narrow");
    } finally {
      await setSidebar(300);
    }
  });

  // A new name alone is library-renaming.e2e.ts's first two tests, and the
  // readings and translations alone symbol-text-library.e2e.ts's "changes only
  // the text chunks, and no note": the same Save, through the same steps.
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

  it("leaves everything as it was with Cancel, and with Esc", async function () {
    await symbolWith("gate.ink.png", { reading: ["TA"] });
    const before = await bytesOf("gate.ink.png");
    await showLibrary();
    for (const leave of [
      async () => formButton("Cancel").click(),
      async () => browser.keys(["Escape"]),
    ]) {
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
    }
  });

  it("heads the form with the row's buttons, whose Quick edit closes it as Cancel does", async function () {
    await symbolWith("gate.ink.png", {
      reading: ["TA"],
      translation: ["door"],
    });
    await noteUsing("Uses.md", "gate.ink.png");
    const before = await bytesOf("gate.ink.png");
    await showLibrary();
    const row = () => browser.$(rowOf("gate.ink.png"));
    const uses = () => rowButton("gate.ink.png", "uses");
    const own = () => rowButton("gate.ink.png", "edit");
    await uses().click();
    await row().$(".inkline-library-notes").waitForExist();
    expect(await own().getAttribute("aria-expanded")).toBe("false");
    await quickEdit("gate.ink.png");
    // The symbol, Uses and Quick edit stay, and the form takes the place of
    // the readings, translations and notes under them.
    expect(await row().$(".inkline-library-name").getText()).toBe("gate");
    expect(await row().$(".inkline-library-picture").isExisting()).toBe(true);
    expect(await row().$(".inkline-library-values").isExisting()).toBe(false);
    expect(await row().$(".inkline-library-notes").isExisting()).toBe(false);
    expect(await row().$(".inkline-library-edit-form").isExisting()).toBe(true);
    expect(await rowButton("gate.ink.png", "insert").isEnabled()).toBe(true);
    // Its Uses waits, as the other rows' do, and shows no list meanwhile.
    expect(await uses().isEnabled()).toBe(false);
    expect(await uses().getAttribute("aria-expanded")).toBe("false");
    // Its Quick edit says that its form is open, and still works.
    expect(await own().isEnabled()).toBe(true);
    expect(await own().getAttribute("aria-expanded")).toBe("true");
    expect(await own().getComputedRole()).toBe("button");
    expect(await own().getComputedLabel()).toBe(
      "Quick edit the name, readings, and translations of gate",
    );
    // Back from the name, Tab reaches it and then the symbol, past Uses.
    await browser.keys(["Shift", "Tab"]);
    expect(await focused()).toMatchObject({
      role: "edit",
      path: "gate.ink.png",
    });
    await browser.keys(["Shift", "Tab"]);
    expect(await focused()).toMatchObject({
      role: "insert",
      path: "gate.ink.png",
    });
    await browser.keys(["Tab"]);
    await browser.keys(["Tab"]);
    expect(await focused()).toMatchObject({
      tag: "INPUT",
      path: "gate.ink.png",
    });
    // A click on it drops what was typed, as Cancel does, and keeps the focus.
    await nameField().setValue("arch");
    await area("reading").setValue("KA");
    await own().click();
    await waitForClosed();
    expect(await symbolFiles()).toEqual(["gate.ink.png"]);
    expect(await bytesOf("gate.ink.png")).toBe(before);
    expect(await focused()).toMatchObject({
      role: "edit",
      path: "gate.ink.png",
    });
    expect(await own().getAttribute("aria-expanded")).toBe("false");
    // What showed under the buttons shows again.
    expect(await row().$(".inkline-library-values").getText()).toContain(
      "Reading: TA",
    );
    expect(await row().$$(".inkline-library-note").length).toBe(1);
    expect(await uses().getAttribute("aria-expanded")).toBe("true");
    // From the keyboard, Space opens it, and Enter or Esc on it closes it.
    for (const key of ["Enter", "Escape"]) {
      await browser.keys([" "]);
      await formButton("Save").waitForEnabled();
      expect(await focused()).toMatchObject({
        tag: "INPUT",
        path: "gate.ink.png",
      });
      await browser.keys(["Shift", "Tab"]);
      expect(await focused()).toMatchObject({ role: "edit" });
      await browser.keys([key]);
      await waitForClosed();
      expect(await focused()).toMatchObject({
        role: "edit",
        path: "gate.ink.png",
      });
    }
    // A double-click opens it, and the second click leaves it open, with the
    // focus back on the name, still selected.
    await pastDoubleClick();
    await own().doubleClick();
    await formButton("Save").waitForEnabled();
    await browser.pause(300);
    expect(await browser.$$(".inkline-library-edit-form").length).toBe(1);
    expect(await own().getAttribute("aria-expanded")).toBe("true");
    expect(await focused()).toMatchObject({
      tag: "INPUT",
      path: "gate.ink.png",
    });
    expect(
      await browser.execute(() => {
        const active = document.activeElement;
        return active instanceof HTMLInputElement
          ? active.value.slice(
              active.selectionStart ?? 0,
              active.selectionEnd ?? 0,
            )
          : null;
      }),
    ).toBe("gate");
    // On the open row, a double-click closes it, dropping what was typed, and
    // its second click opens no new form.
    await area("reading").setValue("KA");
    await pastDoubleClick();
    await own().doubleClick();
    await waitForClosed();
    await browser.pause(300);
    expect(await browser.$$(".inkline-library-edit-form").length).toBe(0);
    expect(await own().getAttribute("aria-expanded")).toBe("false");
    expect(await bytesOf("gate.ink.png")).toBe(before);
    expect(await focused()).toMatchObject({
      role: "edit",
      path: "gate.ink.png",
    });
  });

  it("opens no second form when the row is closed during a press on its Quick edit, and saves nothing from the one it keeps", async function () {
    await symbolWith("gate.ink.png", { reading: ["TA"] });
    const before = await bytesOf("gate.ink.png");
    await showLibrary();
    await quickEdit("gate.ink.png");
    await area("reading").setValue("KA");
    await pastDoubleClick();
    await watchClicks();
    await pressOn("gate.ink.png", "edit");
    try {
      // Esc on the button the press focused closes the row. The list holds
      // off drawing again until the press ends, so the form stays till then.
      expect(await focused()).toMatchObject({
        role: "edit",
        path: "gate.ink.png",
      });
      await browser.keys(["Escape"]);
      await browser.pause(200);
      expect(await formCount()).toBe(1);
      expect(
        await rowButton("gate.ink.png", "edit").getAttribute("aria-expanded"),
      ).toBe("false");
      // That form saves nothing.
      await browser.execute(() => {
        document
          .querySelector<HTMLFormElement>(".inkline-library-edit-form")
          ?.requestSubmit();
      });
      await browser.pause(500);
      expect(await bytesOf("gate.ink.png")).toBe(before);
    } finally {
      await release();
    }
    // The press ends on the button, so its release is a click on it, which
    // opens no form while the list still holds the closed one. The list then
    // draws the row closed.
    await browser.waitUntil(async () => (await clicksSeen()).length > 0, {
      timeoutMsg: "the release clicked nothing",
    });
    expect(await clicksSeen()).toEqual(["edit gate.ink.png 1"]);
    await waitForClosed();
    await browser.pause(500);
    expect(await formCount()).toBe(0);
    expect(await bytesOf("gate.ink.png")).toBe(before);
    expect(await focused()).toMatchObject({
      role: "edit",
      path: "gate.ink.png",
    });
  });

  it("opens no other row while a row closed during a press keeps its form", async function () {
    await symbolWith("gate.ink.png", { reading: ["TA"] });
    await symbolWith("sun.ink.png", { reading: ["SO"] });
    const before = await bytesOf("gate.ink.png");
    await showLibrary();
    await quickEdit("gate.ink.png");
    await area("reading").setValue("KA");
    await pastDoubleClick();
    await pressOn("gate.ink.png", "edit");
    try {
      await browser.keys(["Escape"]);
      await browser.pause(200);
      expect(await formCount()).toBe(1);
      // Sun's Quick edit no longer waits, and from the keyboard opens nothing
      // until the list is drawn again without gate's form.
      expect(await rowButton("sun.ink.png", "edit").isEnabled()).toBe(true);
      await browser.execute(
        (selector) => {
          document.querySelector<HTMLElement>(selector)?.focus();
        },
        `${rowOf("sun.ink.png")} button[data-inkline-role="edit"]`,
      );
      expect(await focused()).toMatchObject({
        role: "edit",
        path: "sun.ink.png",
      });
      await browser.keys(["Enter"]);
      await browser.pause(300);
      expect(await formCount()).toBe(1);
      expect(
        await browser
          .$(rowOf("sun.ink.png"))
          .$(".inkline-library-edit-form")
          .isExisting(),
      ).toBe(false);
      expect(
        await rowButton("sun.ink.png", "edit").getAttribute("aria-expanded"),
      ).toBe("false");
    } finally {
      await release();
    }
    // Once the press ends, the list is drawn with no form, and sun opens.
    await waitForClosed();
    await rowButton("sun.ink.png", "edit").click();
    await formButton("Save").waitForEnabled();
    expect(await formCount()).toBe(1);
    expect(
      await browser
        .$(rowOf("sun.ink.png"))
        .$(".inkline-library-edit-form")
        .isExisting(),
    ).toBe(true);
    expect(await area("reading").getValue()).toBe("SO");
    expect(await bytesOf("gate.ink.png")).toBe(before);
  });

  it("shows the symbol's menu from its row in Quick edit, and leaves the fields their own", async function () {
    await symbolWith("gate.ink.png", { reading: ["TA"] });
    await showLibrary();
    await quickEdit("gate.ink.png");
    // In a field, the menu is the one for its text, not the file's.
    await nameField().click({ button: "right" });
    await browser.pause(300);
    expect(await menuItems()).not.toContain("Edit symbol");
    // On the symbol above, the file's menu, as on any other row.
    await rowButton("gate.ink.png", "insert").click({ button: "right" });
    await browser.waitUntil(async () =>
      (await menuItems()).includes("Edit symbol"),
    );
    expect(await menuItems()).toContain("Open in new tab");
    await saveScreenshot("library-quick-edit-menu");
  });

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

  for (const [how, leave] of [leavers.cancel, leavers.escape]) {
    it(`does not rename once left with ${how} while its readings wait to be written`, async function () {
      await symbolWith("gate.ink.png", { reading: ["TA"] });
      await showLibrary();
      await quickEdit("gate.ink.png");
      await nameField().setValue("arch");
      await area("reading").setValue("KA");
      await hold("write");
      await formButton("Save").click();
      await waitForHeld();
      // Until the save says it waits, neither can leave it.
      const wait = form().$(".inkline-save-wait");
      expect(await wait.getText()).toBe("");
      expect(await formButton("Cancel").isEnabled()).toBe(false);
      expect(await rowButton("gate.ink.png", "edit").isEnabled()).toBe(false);
      await browser.waitUntil(async () => (await wait.getText()) !== "", {
        timeout: stalledAfter + 15_000,
      });
      expect(await wait.getText()).toContain(
        "Waiting for Obsidian to finish writing a file.",
      );
      expect(await formButton("Cancel").isEnabled()).toBe(true);
      expect(await rowButton("gate.ink.png", "edit").isEnabled()).toBe(true);
      await leave();
      await waitForClosed();
      await waitForNotice("so it may still finish. It will not be renamed.");
      await letGo();
      await waitForNotice("Saved gate.");
      await browser.pause(500);
      expect(await symbolFiles()).toEqual(["gate.ink.png"]);
      expect((await fieldsOf("gate.ink.png")).reading).toEqual(["KA"]);
    });
  }

  it("refuses a rename once the symbol is renamed elsewhere while its readings are written", async function () {
    await symbolWith("gate.ink.png", { reading: ["TA"] });
    await showLibrary();
    await quickEdit("gate.ink.png");
    await nameField().setValue("arch");
    await area("reading").setValue("KA");
    await hold("write");
    await formButton("Save").click();
    await waitForHeld();
    // As sync would, while the write waits for the disk.
    await renameElsewhere("gate.ink.png", "synced.ink.png");
    await letGo();
    await browser.waitUntil(async () =>
      (await formError().getText()).includes("renamed to synced.ink.png"),
    );
    expect(await errorLines()).toEqual([
      "The readings and translations are saved, but the symbol was not renamed:",
      "the file was renamed to synced.ink.png meanwhile",
    ]);
    expect(await symbolFiles()).toEqual(["synced.ink.png"]);
    expect((await fieldsOf("synced.ink.png")).reading).toEqual(["KA"]);
    expect(await nameField().getValue()).toBe("arch");
    // Save again renames it from the name it has now.
    await browser.keys(["Enter"]);
    await waitForClosed();
    expect(await symbolFiles()).toEqual(["arch.ink.png"]);
    expect((await fieldsOf("arch.ink.png")).reading).toEqual(["KA"]);
  });

  it("says the readings are saved when the rename after them is left with the row's Quick edit", async function () {
    await symbolWith("gate.ink.png", { reading: ["TA"] });
    await noteUsing("Uses.md", "gate.ink.png");
    await openNote("Uses.md");
    await showLibrary();
    await quickEdit("gate.ink.png");
    await nameField().setValue("arch");
    await area("reading").setValue("KA");
    // The rename reads the open note to see whether it has text to save.
    await hold("read");
    await formButton("Save").click();
    await waitForHeld();
    const said = await waitForWait();
    expect(said).toContain("Waiting for Obsidian to finish renaming a file.");
    expect(said).toContain("The readings and translations are saved.");
    expect(await rowButton("gate.ink.png", "edit").isEnabled()).toBe(true);
    await rowButton("gate.ink.png", "edit").click();
    await waitForClosed();
    await waitForNotice("Saved gate. It was not renamed.");
    await letGo();
    await browser.pause(500);
    expect(await symbolFiles()).toEqual(["gate.ink.png"]);
    expect((await fieldsOf("gate.ink.png")).reading).toEqual(["KA"]);
  });

  it("says in a notice what was saved once Inkline is turned off during the rename", async function () {
    await symbolWith("gate.ink.png", { reading: ["TA"] });
    await noteUsing("Uses.md", "gate.ink.png");
    await openNote("Uses.md");
    await showLibrary();
    await quickEdit("gate.ink.png");
    await nameField().setValue("arch");
    await area("reading").setValue("KA");
    await hold("read");
    await formButton("Save").click();
    await waitForHeld();
    try {
      await inkline(false);
      await letGo();
      await waitForNotice(
        "Saved gate. gate could not be renamed to arch: Inkline was disabled",
      );
    } finally {
      await letGo();
      await inkline(true);
    }
    expect(await symbolFiles()).toEqual(["gate.ink.png"]);
    expect((await fieldsOf("gate.ink.png")).reading).toEqual(["KA"]);
  });

  it("says in a notice what was not done once Inkline is turned off during the write", async function () {
    await symbolWith("gate.ink.png", { reading: ["TA"] });
    await showLibrary();
    await quickEdit("gate.ink.png");
    await nameField().setValue("arch");
    await area("reading").setValue("KA");
    await holdSymbolRead("gate.ink.png");
    await formButton("Save").click();
    await waitForHeldRead();
    try {
      await inkline(false);
      await letReadGo();
      await waitForNotice(
        "The readings and translations of gate were not saved, and it was not renamed to arch: Inkline was disabled",
      );
    } finally {
      await letReadGo();
      await inkline(true);
    }
    expect(await symbolFiles()).toEqual(["gate.ink.png"]);
    expect((await fieldsOf("gate.ink.png")).reading).toEqual(["TA"]);
  });

  it("renames nothing when the file changed under the write, and says so", async function () {
    await symbolWith("gate.ink.png", { reading: ["TA"] });
    const before = await bytesOf("gate.ink.png");
    await showLibrary();
    await quickEdit("gate.ink.png");
    await nameField().setValue("arch");
    await area("reading").setValue("KA");
    // The change reaches the write's read with the vault telling nobody.
    await browser.executeObsidian(async ({ app }) => {
      const file = app.vault.getFileByPath("gate.ink.png");
      if (file === null) throw new Error("no gate");
      const { text } = window.inklineTest;
      const read = app.vault.readBinary.bind(app.vault);
      const bytes = await text.writeText(
        new Uint8Array(await read(file)),
        "reading",
        ["theirs"],
      );
      const buffer = bytes.slice().buffer;
      app.vault.readBinary = () => {
        Reflect.deleteProperty(app.vault, "readBinary");
        return Promise.resolve(buffer);
      };
    });
    await formButton("Save").click();
    await browser.waitUntil(async () =>
      (await formError().getText()).includes("nothing was saved or renamed"),
    );
    expect(await errorLines()).toEqual([
      "The file changed meanwhile, so nothing was saved or renamed.",
    ]);
    expect(await symbolFiles()).toEqual(["gate.ink.png"]);
    expect(await bytesOf("gate.ink.png")).toBe(before);
    expect(await nameField().getValue()).toBe("arch");
    expect(await area("reading").getValue()).toBe("KA");
  });

  it("says only that the readings are saved when the rename is disturbed after them", async function () {
    await symbolWith("gate.ink.png", { reading: ["TA"] });
    await noteUsing("Uses.md", "gate.ink.png");
    await showLibrary();
    await quickEdit("gate.ink.png");
    await nameField().setValue("lintel");
    await area("reading").setValue("KA");
    // Past every check, as a change already on its way to the disk would be.
    await hold("move");
    await formButton("Save").click();
    await waitForHeld();
    // The very rename, as sync would make it, which leaves the links.
    await renamePastHold("gate.ink.png", "lintel.ink.png");
    await letGo();
    await browser.waitUntil(async () =>
      (await formError().getText()).includes("did not finish the rename"),
    );
    expect(await errorLines()).toEqual([
      "The readings and translations are saved.",
      "Obsidian did not finish the rename, though the file is lintel.ink.png now, so links to it may still have the old name",
    ]);
    expect(await symbolFiles()).toEqual(["lintel.ink.png"]);
    expect((await fieldsOf("lintel.ink.png")).reading).toEqual(["KA"]);
    // Nothing is left to save.
    await browser.keys(["Enter"]);
    await waitForClosed();
    expect(await symbolFiles()).toEqual(["lintel.ink.png"]);
  });

  // Its first rename elsewhere is the one a name untouched follows, and the
  // second follows on from there.
  it("never renames a file back through two renames elsewhere, with the name untouched", async function () {
    await symbolWith("gate.ink.png", { reading: ["TA"] });
    await showLibrary();
    await quickEdit("gate.ink.png");
    await renameElsewhere("gate.ink.png", "arch.ink.png");
    await browser.waitUntil(
      async () => (await nameField().getValue()) === "arch",
    );
    await renameElsewhere("arch.ink.png", "portal.ink.png");
    await browser.waitUntil(
      async () => (await nameField().getValue()) === "portal",
    );
    await area("reading").setValue("KA");
    await formButton("Save").click();
    await waitForClosed();
    expect(await symbolFiles()).toEqual(["portal.ink.png"]);
    expect((await fieldsOf("portal.ink.png")).reading).toEqual(["KA"]);
  });

  it("keeps a refused name's reason through a change to the file", async function () {
    await symbolWith("gate.ink.png", { reading: ["TA"] });
    await createSymbol("tower.ink.png");
    await showLibrary();
    await quickEdit("gate.ink.png");
    await nameField().setValue("TOWER");
    await browser.keys(["Enter"]);
    await browser.waitUntil(async () =>
      (await formError().getText()).includes("already has a symbol named"),
    );
    // As sync would bring in a translation.
    await browser.executeObsidian(async ({ app }) => {
      const file = app.vault.getFileByPath("gate.ink.png");
      if (file === null) throw new Error("no gate");
      const { text } = window.inklineTest;
      const bytes = await text.writeText(
        new Uint8Array(await app.vault.readBinary(file)),
        "translation",
        ["door"],
      );
      await app.vault.modifyBinary(file, bytes.slice().buffer);
    });
    await browser.waitUntil(
      async () => (await area("translation").getValue()) === "door",
    );
    expect(await formError().getText()).toContain("already has a symbol named");
  });

  it("takes in a file deleted during the save once the row is given back", async function () {
    await symbolWith("gate.ink.png", { reading: ["TA"] });
    await showLibrary();
    await quickEdit("gate.ink.png");
    await area("reading").setValue("KA");
    await holdSymbolRead("gate.ink.png");
    await formButton("Save").click();
    await waitForHeldRead();
    // Deleted while the save reads it, which the row does not look at then.
    await browser.executeObsidian(async ({ app }) => {
      const file = app.vault.getFileByPath("gate.ink.png");
      if (file === null) throw new Error("no gate");
      await app.fileManager.trashFile(file);
    });
    await letReadGo();
    await browser.waitUntil(async () => (await errorLines()).length > 0);
    // What the save found stays, and Save is off for a file that has gone.
    await browser.waitUntil(
      async () => !(await formButton("Save").isEnabled()),
    );
    expect(await errorLines()).not.toEqual([]);
    expect(await area("reading").getValue()).toBe("KA");
    expect(await symbolFiles()).toEqual([]);
  });

  it("keeps a name typed through a rename made elsewhere, and renames from there", async function () {
    await symbolWith("gate.ink.png", { reading: ["TA"] });
    await showLibrary();
    await quickEdit("gate.ink.png");
    await nameField().setValue("lintel");
    // As sync would, into another folder.
    await browser.executeObsidian(async ({ app }) => {
      const file = app.vault.getFileByPath("gate.ink.png");
      if (file === null) throw new Error("no gate");
      await app.vault.createFolder("Signs");
      await app.vault.rename(file, "Signs/arch.ink.png");
    });
    // The form's name follows the file, and the name typed stays.
    await browser.waitUntil(
      async () => (await form().getComputedLabel()) === "Quick edit arch",
    );
    expect(await nameField().getValue()).toBe("lintel");
    // The row's buttons above it name the symbol as it is now.
    const row = browser.$(rowOf("Signs/arch.ink.png"));
    expect(await row.$(".inkline-library-edit-form").isExisting()).toBe(true);
    expect(await row.$(".inkline-library-name").getText()).toBe("arch");
    expect(await row.$(".inkline-library-folder-name").getText()).toBe("Signs");
    expect(
      await rowButton("Signs/arch.ink.png", "edit").getComputedLabel(),
    ).toBe("Quick edit the name, readings, and translations of arch");
    await browser.keys(["Enter"]);
    await waitForClosed();
    expect(await symbolFiles()).toEqual(["Signs/lintel.ink.png"]);
    expect(await focused()).toMatchObject({
      role: "edit",
      path: "Signs/lintel.ink.png",
    });
  });
});
