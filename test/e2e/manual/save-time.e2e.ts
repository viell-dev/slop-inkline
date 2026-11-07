// Measures what saving a large symbol costs in real Obsidian: how long a save
// takes, which is what src/notes/file-writes.ts chooses its `stalledAfter` by,
// and whether the rest of the plugin feels stuck while one runs. It sits outside
// the ordinary suite's specs/ glob: its result is numbers for a person to read,
// written to save-time-<version>.json in the end-to-end output, and it takes
// minutes. Every symbol is synthetic: the largest is a picture of noise, which
// PNG cannot compress, of nearly the 8 MiB a base layer can hold, so that its file
// is about as large as a saved symbol gets.

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { browser } from "@wdio/globals";
import { loadModules } from "../support/browser.ts";
import {
  createSymbol,
  draw,
  startOver,
  waitForEditor,
  waitForStatus,
} from "../support/editor.ts";
import { outputDirectory } from "../support/harness.ts";

const root = path.resolve(import.meta.dirname, "../../..");
const outputDir = outputDirectory(process.env.E2E_OUTPUT_DIR, root);

/** The symbols to save, and the side of each one's picture of noise. */
const symbols = [
  { file: "Ordinary.ink.png", side: 0 },
  { file: "Picture 1024.ink.png", side: 1024 },
  { file: "Picture 2300.ink.png", side: 2300 },
] as const;

/** How many times to save each. */
const runs = 5;

/** Other symbols in the library, for its filter to go through. */
const others = 100;

/** A stroke away from the middle, moved a little each time. */
function stroke(run: number): [number, number][] {
  const y = 0.2 + (run % 6) / 10;
  return [
    [0.3, y],
    [0.7, y + 0.05],
  ];
}

/** Writes a picture of noise, which PNG cannot compress, as a symbol. */
async function writeNoise(file: string, side: number): Promise<void> {
  await browser.executeObsidian(
    async ({ app }, filePath, size) => {
      const { canvas } = window.inklineTest;
      const data = new Uint8ClampedArray(size * size * 4);
      let seed = 7;
      for (let index = 0; index < size * size; index++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        data[index * 4 + 3] = seed >>> 24;
      }
      const bytes = await canvas.encodePixels({
        width: size,
        height: size,
        data,
      });
      await app.vault.createBinary(filePath, bytes.slice().buffer);
    },
    file,
    side,
  );
}

/** Opens the editor on a symbol file. */
async function editFile(file: string): Promise<void> {
  await browser.executeObsidian(({ app, plugins }, wanted) => {
    const found = app.vault.getFileByPath(wanted);
    if (found === null) throw new Error(`no ${wanted}`);
    void plugins.inkline.editSymbol(found);
  }, file);
  await waitForEditor();
}

/** The size of `file`, in bytes. */
async function sizeOf(file: string): Promise<number> {
  return browser.executeObsidian(({ app }, wanted) => {
    const found = app.vault.getFileByPath(wanted);
    if (found === null) throw new Error(`no ${wanted}`);
    return found.stat.size;
  }, file);
}

/**
 * Saves the open editor by its button, which closes it, and reports what that
 * took: from pressing it to the editor closing, and each read and write of the
 * vault meanwhile, which is the part that a stalled save would wait on.
 */
async function timedEditorSave() {
  return browser.executeObsidian(async ({ app }) => {
    const { mainThread } = window.inklineTest;
    const button = document.querySelector<HTMLElement>(
      '[data-inkline-button="save"]',
    );
    if (button === null) throw new Error("no save button");
    const thread = mainThread.watchMainThread();
    const vault = mainThread.watchVault(app.vault);
    const start = performance.now();
    button.click();
    while (document.querySelector(".inkline-editor") !== null) {
      await new Promise((resolve) => window.setTimeout(resolve, 2));
    }
    const totalMs = performance.now() - start;
    return { totalMs, thread: thread(), vault: vault() };
  });
}

/**
 * How long `saveInk` alone takes for `file`, and what the main thread goes
 * through meanwhile, to tell that work from the save around it.
 */
async function timedEncoding(file: string) {
  return browser.executeObsidian(async ({ app }, wanted) => {
    const { canvas, mainThread } = window.inklineTest;
    const found = app.vault.getFileByPath(wanted);
    if (found === null) throw new Error(`no ${wanted}`);
    const opened = await canvas.openInk(
      new Uint8Array(await app.vault.readBinary(found)),
    );
    if (opened.kind !== "editable") throw new Error(`cannot open ${wanted}`);
    const thread = mainThread.watchMainThread();
    const start = performance.now();
    await canvas.saveInk(opened.document, opened.base, opened.carried);
    const totalMs = performance.now() - start;
    return { totalMs, thread: thread() };
  }, file);
}

/** Opens the library in the right sidebar. */
async function showLibrary(): Promise<void> {
  await browser.executeObsidianCommand("inkline:show-library");
  await browser.$(".inkline-library-list").waitForExist();
}

/** Opens a second library, whose filter stays free while the first's form is open. */
async function secondLibrary(): Promise<void> {
  await browser.executeObsidian(async ({ app }) => {
    await app.workspace
      .getLeaf("split")
      .setViewState({ type: "inkline-library", active: false });
  });
  await browser.waitUntil(
    async () =>
      (await browser.$$(".inkline-library-search").getElements()).length === 2,
  );
}

/** Opens the fields of `file` in the first library that shows it. */
async function openFields(file: string): Promise<void> {
  const button = `.inkline-library-symbol[data-inkline-path="${file}"] [data-inkline-role="text"]`;
  await browser.waitUntil(async () =>
    browser.execute((selector) => {
      const found = document.querySelector<HTMLElement>(selector);
      found?.click();
      return found !== null;
    }, button),
  );
  await browser.waitUntil(async () =>
    browser.execute(() => {
      const save = document.querySelector<HTMLButtonElement>(
        ".inkline-library-text-buttons button",
      );
      return save?.disabled === false;
    }),
  );
}

/**
 * Saves `value` as the reading from the form open now, and reports what that
 * took, from asking to the form closing. With `filtering`, the other library's
 * filter is used all the while, as a person going on working would.
 */
async function timedLibrarySave(value: string, filtering: boolean) {
  return browser.executeObsidian(
    async ({ app }, text, filter) => {
      const { mainThread } = window.inklineTest;
      const form = document.querySelector<HTMLFormElement>(
        ".inkline-library-text-form",
      );
      const area = form?.querySelector("textarea");
      if (form === null || area === null || area === undefined) {
        throw new Error("no form");
      }
      area.value = text;
      area.dispatchEvent(new Event("input", { bubbles: true }));
      const field = [
        ...document.querySelectorAll<HTMLInputElement>(
          ".inkline-library-search",
        ),
      ].find((each) => !each.disabled);
      if (filter && field === undefined) throw new Error("no free filter");
      const typing =
        filter && field !== undefined
          ? mainThread.keepFiltering(field)
          : undefined;
      const thread = mainThread.watchMainThread();
      const vault = mainThread.watchVault(app.vault);
      const start = performance.now();
      form.requestSubmit();
      while (document.contains(form)) {
        await new Promise((resolve) => window.setTimeout(resolve, 2));
      }
      const totalMs = performance.now() - start;
      return { totalMs, thread: thread(), vault: vault(), typing: typing?.() };
    },
    value,
    filtering,
  );
}

/** What the page does with no save running, to compare with. */
async function idle(ms: number) {
  return browser.execute(async (wait) => {
    const { mainThread } = window.inklineTest;
    const field = [
      ...document.querySelectorAll<HTMLInputElement>(".inkline-library-search"),
    ].find((each) => !each.disabled);
    if (field === undefined) throw new Error("no free filter");
    const typing = mainThread.keepFiltering(field);
    const thread = mainThread.watchMainThread();
    await new Promise((resolve) => window.setTimeout(resolve, wait));
    return { thread: thread(), typing: typing() };
  }, ms);
}

/**
 * Asks the two libraries' forms to save, the large file's first, and reports how
 * long each took, from the moment each was asked.
 */
async function timedSaveBehind(large: string, small: string) {
  return browser.execute(
    async (first, second) => {
      const forms = [
        ...document.querySelectorAll<HTMLFormElement>(
          ".inkline-library-text-form",
        ),
      ];
      const set = (form: HTMLFormElement | undefined, text: string): void => {
        const area = form?.querySelector("textarea");
        if (area === null || area === undefined) throw new Error("no field");
        area.value = text;
        area.dispatchEvent(new Event("input", { bubbles: true }));
      };
      const [one, two] = forms;
      if (one === undefined || two === undefined) throw new Error("no forms");
      set(one, first);
      set(two, second);
      const closed = async (form: HTMLFormElement): Promise<number> => {
        const start = performance.now();
        while (document.contains(form)) {
          await new Promise((resolve) => window.setTimeout(resolve, 2));
        }
        return performance.now() - start;
      };
      one.requestSubmit();
      const firstClosed = closed(one);
      two.requestSubmit();
      const secondClosed = closed(two);
      return { firstMs: await firstClosed, secondMs: await secondClosed };
    },
    large,
    small,
  );
}

/**
 * Starts a save that keeps the editor open, and draws real strokes all through
 * it, and reports what the strokes met.
 */
async function timedDrawingThroughSave(run: number) {
  await draw(stroke(run));
  await browser.execute(() => {
    const { mainThread } = window.inklineTest;
    const thread = mainThread.watchMainThread();
    const started = performance.now();
    let savedMs: number | undefined;
    const status = document.querySelector(".inkline-status");
    if (status === null) throw new Error("no status");
    const seen = new MutationObserver(() => {
      if (status.textContent.startsWith("Saved")) {
        savedMs ??= performance.now() - started;
      }
    });
    seen.observe(status, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    Reflect.set(window, "inklineStopWatching", () => {
      seen.disconnect();
      return { savedMs, thread: thread() };
    });
  });
  await Promise.all([
    browser.keys(["Control", "s"]),
    (async () => {
      for (let count = 0; count < 12; count++) await draw(stroke(run + count));
    })(),
  ]);
  await waitForStatus("Saved");
  return browser.execute(() => {
    const stop: unknown = Reflect.get(window, "inklineStopWatching");
    if (typeof stop !== "function") throw new Error("not watching");
    return Reflect.apply(stop, undefined, []) as unknown;
  });
}

describe("What saving a large symbol costs", function () {
  this.timeout(3_600_000);

  before(async function () {
    await loadModules();
    await startOver();
  });

  after(async function () {
    await startOver();
  });

  it("measures saves, and what they do to the rest of the plugin", async function () {
    const version = browser.getObsidianVersion();
    const results: Record<string, unknown> = { obsidian: version };
    const save = (): Promise<void> =>
      writeFile(
        path.join(outputDir, `save-time-${version}.json`),
        JSON.stringify(results, undefined, 2),
      );
    for (let index = 0; index < others; index++) {
      await createSymbol(`Others/symbol ${String(index)}.ink.png`);
    }
    for (const { file, side } of symbols) {
      if (side === 0) await createSymbol(file);
      else await writeNoise(file, side);
      await editFile(file);
      await draw(stroke(0));
      const first = await timedEditorSave();
      const saves = [];
      for (let run = 0; run < runs; run++) {
        await editFile(file);
        await draw(stroke(run + 1));
        saves.push(await timedEditorSave());
      }
      results[file] = {
        bytes: await sizeOf(file),
        first,
        editor: saves,
        encoding: await timedEncoding(file),
      };
      await save();
    }
    await showLibrary();
    await secondLibrary();
    for (const { file } of symbols) {
      const library = [];
      for (let run = 0; run < runs; run++) {
        await openFields(file);
        library.push(await timedLibrarySave(`TA${String(run)}`, false));
      }
      const filtering = [];
      for (let run = 0; run < runs; run++) {
        await openFields(file);
        filtering.push(await timedLibrarySave(`DA${String(run)}`, true));
      }
      Object.assign(results[file] as object, { library, filtering });
      await save();
    }
    results.idle = await idle(3000);
    await save();
    const large = symbols[2].file;
    const small = symbols[0].file;
    const behind = [];
    for (let run = 0; run < runs; run++) {
      await openFields(large);
      await browser.execute((wanted) => {
        // The second library's row, as the first's is a form now.
        const rows = document.querySelectorAll<HTMLElement>(
          `.inkline-library-symbol[data-inkline-path="${wanted}"] [data-inkline-role="text"]`,
        );
        [...rows].at(-1)?.click();
      }, small);
      await browser.waitUntil(async () =>
        browser.execute(
          () =>
            [
              ...document.querySelectorAll<HTMLButtonElement>(
                ".inkline-library-text-buttons button[type=submit]",
              ),
            ].filter((button) => !button.disabled).length === 2,
        ),
      );
      behind.push(await timedSaveBehind(`Q${String(run)}`, `R${String(run)}`));
    }
    results.behind = behind;
    await save();
    await editFile(large);
    const drawing = [];
    for (let run = 0; run < runs; run++) {
      drawing.push(await timedDrawingThroughSave(run));
    }
    results.drawing = drawing;
    await save();
  });
});
