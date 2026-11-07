// Opening the largest symbols there are, as a person does. A read takes a second
// or two of work, which must go on in slices short enough for the page to keep
// painting and taking input, must find what it always found, and must leave
// nothing lost by what happens meanwhile, now that things can.

import { browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import { loadModules } from "../support/browser.ts";
import {
  clickTop,
  createSymbol,
  delayVault,
  draw,
  editFile,
  noteText,
  openAtMarker,
  restoreVault,
  startOver,
  storedDrafts,
  symbolFiles,
  timedEditorOpen,
  timedEditorSave,
  topButton,
  waitForEditor,
  waitForNotice,
  waitForStatus,
  writeNoise,
} from "../support/editor.ts";

/**
 * The two ways a symbol is large, as in save-responsiveness.e2e.ts: nearly the 8
 * MiB of PNG a base layer can hold, of noise, and the most pixels one can have,
 * which empty pixels make into a file of a few kilobytes. `budget` is the most
 * the shortest of three opens' longest task and longest frame may take, in ms.
 *
 * In Docker on Windows 11, beside other jobs, the shortest of three of the first
 * was 50 to 70 ms in Obsidian 1.13.4 and 1.15.0, and of the second 80 to 130 ms.
 * Before reads paused, the first was 2,600 to 3,200 ms, and the second 240 to
 * 350 ms. Timings alone would not show what this is for, so each open also says
 * what it found, and other tasks have to run all through it: a draw that looks
 * like it is sliced, but that a canvas puts off until later, is quick here and
 * long elsewhere.
 */
const symbols = [
  {
    file: "Bytes.ink.png",
    side: 2470,
    spacing: 1,
    least: 8_000_000,
    budget: 250,
  },
  {
    file: "Pixels.ink.png",
    side: 4096,
    spacing: 4099,
    least: 40_000,
    budget: 300,
  },
] as const;

/** How many times to open each. */
const opens = 3;

/** How long, in ms, a read is held up, to act while it goes on. */
const held = 1000;

const zigzag = [
  [0.4, 0.3],
  [0.45, 0.7],
  [0.5, 0.3],
  [0.55, 0.7],
] as const;

/** Makes a symbol of a picture of noise, as a person's first save does. */
async function largeSymbol(
  file: string,
  side: number,
  spacing: number,
): Promise<void> {
  await writeNoise(file, side, spacing);
  await editFile(file);
  await draw([
    [0.3, 0.3],
    [0.7, 0.35],
  ]);
  await timedEditorSave();
}

/**
 * What opening a symbol file finds, and what the plain steps find of the same
 * bytes: the record's text parsed at once, and its base layer's PNG decoded with
 * the browser's own `atob`, which reading no longer uses.
 */
async function opened(file: string) {
  return browser.executeObsidian(async ({ app }, wanted) => {
    const { canvas, drafts, inkFile, png, record } = window.inklineTest;
    const found = app.vault.getFileByPath(wanted);
    if (found === null) throw new Error(`no ${wanted}`);
    const bytes = new Uint8Array(await app.vault.readBinary(found));
    const ink = await canvas.openInk(bytes);
    if (ink.kind !== "editable") throw new Error(ink.kind);
    const { base } = ink.document;
    if (base === undefined) throw new Error("no base layer");
    const chunks = png.readChunks(bytes);
    const chunk = chunks.find(({ type }) => type === inkFile.recordChunkType);
    if (chunk === undefined) throw new Error("no record");
    const text = new TextDecoder().decode(
      await png.inflate(chunk.data.subarray(4), { limit: record.limits.text }),
    );
    const parsed = record.parseRecord(text);
    if (!parsed.ok) throw new Error(parsed.detail);
    const fields = JSON.parse(text) as { base: { png: string } };
    const plain = Uint8Array.from(atob(fields.base.png), (char) =>
      char.charCodeAt(0),
    );
    return {
      bytes: bytes.length,
      strokes: ink.document.strokes.length,
      sameStrokes:
        JSON.stringify(ink.document.strokes) ===
        JSON.stringify(parsed.record.strokes),
      base: await drafts.fingerprintOf(base.png),
      plainBase: await drafts.fingerprintOf(plain),
      damaged: chunks.filter((each) => each.damaged === true).length,
      problem: (await record.baseImageProblem(base.png)) ?? "none",
      size: [ink.base?.image.width, ink.base?.image.height],
    };
  }, file);
}

/**
 * How many tasks of its own the page ran while `file`'s record was read, up to
 * decoding its image, the first thing in a read that was ever a real wait, and
 * while that image was drawn, after it. None could run in work done in one go,
 * however fast the machine is.
 */
async function tasksDuringRead(file: string) {
  return browser.executeObsidian(async ({ app }, wanted) => {
    const { canvas } = window.inklineTest;
    const found = app.vault.getFileByPath(wanted);
    if (found === null) throw new Error(`no ${wanted}`);
    const bytes = new Uint8Array(await app.vault.readBinary(found));
    let tasks = 0;
    let reading: number | undefined;
    let decoded: number | undefined;
    const original: unknown = Reflect.get(window, "createImageBitmap");
    if (typeof original !== "function") throw new Error("no createImageBitmap");
    Reflect.set(
      window,
      "createImageBitmap",
      async (...args: unknown[]): Promise<unknown> => {
        reading ??= tasks;
        const bitmap = (await Reflect.apply(original, window, args)) as unknown;
        decoded ??= tasks;
        return bitmap;
      },
    );
    let running = true;
    const tick = (): void => {
      tasks++;
      if (running) window.setTimeout(tick, 0);
    };
    window.setTimeout(tick, 0);
    try {
      await canvas.openInk(bytes);
    } finally {
      running = false;
      Reflect.set(window, "createImageBitmap", original);
    }
    return { reading: reading ?? -1, drawing: tasks - (decoded ?? tasks) };
  }, file);
}

/** Asks to edit `file`, without waiting for the editor. */
async function ask(file: string): Promise<void> {
  await browser.executeObsidian(({ app, plugins }, wanted) => {
    const found = app.vault.getFileByPath(wanted);
    if (found === null) throw new Error(`no ${wanted}`);
    void plugins.inkline.editSymbol(found);
  }, file);
}

/** How many editors are open. */
async function editors(): Promise<number> {
  return (await browser.$$(".inkline-editor").getElements()).length;
}

/** Closes the editor on top, which has nothing to ask. */
async function closeEditor(): Promise<void> {
  await browser.keys(["Escape"]);
  await browser.$(".inkline-editor").waitForExist({ reverse: true });
}

/** Lets every read held up by `held` end. */
async function readsOver(): Promise<void> {
  await browser.pause(held + 700);
}

/** The text of every notice showing. */
async function notices(): Promise<string[]> {
  return browser.execute(() =>
    [...document.querySelectorAll(".notice")].map(
      (notice) => notice.textContent,
    ),
  );
}

/** The notices that say a symbol is opening. */
async function opening(): Promise<string[]> {
  return (await notices()).filter((notice) => notice.includes("Opening"));
}

/** Starts a new symbol from the note, and asks to copy `name` into it. */
async function copyFrom(name: string): Promise<void> {
  await browser.keys(["v"]);
  await browser.$(".prompt-input").waitForDisplayed();
  await browser.keys(name);
  await browser.keys(["Enter"]);
  await browser.$(".prompt-input").waitForExist({ reverse: true });
}

/** Opens the editor on a new symbol in the note. */
async function newSymbol(): Promise<void> {
  await openAtMarker("Editor.md", "HERE");
  await browser.executeObsidianCommand("inkline:insert-symbol");
  await waitForEditor();
}

/** A picture of every colour at every alpha, the same every time. */
function colours(width: number, height: number, opaque: boolean) {
  return browser.execute(
    async (across, down, solid) => {
      const { canvas } = window.inklineTest;
      const data = new Uint8ClampedArray(across * down * 4);
      let seed = 3;
      for (let index = 0; index < data.length; index++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        data[index] = solid && index % 4 === 3 ? 255 : seed >>> 24;
      }
      const png = await canvas.encodePixels({
        width: across,
        height: down,
        data,
      });
      return [...png];
    },
    width,
    height,
    opaque,
  );
}

describe("Opening a large symbol", function () {
  this.timeout(600_000);

  before(async function () {
    await loadModules();
    // Making the largest picture takes seconds in one script.
    await browser.setTimeout({ script: 120_000 });
  });

  beforeEach(async function () {
    await startOver();
  });

  after(async function () {
    await startOver();
  });

  for (const { file, side, spacing, least, budget } of symbols) {
    it(`keeps the page answering, and finds what it always found: ${file}`, async function () {
      await largeSymbol(file, side, spacing);
      const found = await opened(file);
      expect(found.bytes).toBeGreaterThan(least);
      expect(found.strokes).toBe(1);
      expect(found.sameStrokes).toBe(true);
      expect(found.base).toBe(found.plainBase);
      expect(found.damaged).toBe(0);
      expect(found.problem).toBe("none");
      expect(found.size).toEqual([side, side]);
      const tasks = await tasksDuringRead(file);
      console.log(`Tasks in a read of ${file}`, JSON.stringify(tasks));
      // Work done in one go leaves no room for any, however fast the machine is.
      expect(tasks.reading).toBeGreaterThan(1);
      expect(tasks.drawing).toBeGreaterThan(0);
      const runs: Awaited<ReturnType<typeof timedEditorOpen>>[] = [];
      for (let run = 0; run < opens; run++) {
        const open = await timedEditorOpen(file);
        runs.push(open);
        console.log(`Open ${String(run + 1)} of ${file}`, JSON.stringify(open));
        await closeEditor();
      }
      const shortest = (each: (run: (typeof runs)[number]) => number): number =>
        Math.min(...runs.map(each));
      // No frames would look like no long ones.
      expect(shortest((run) => run.thread.frames)).toBeGreaterThan(10);
      expect(shortest((run) => run.thread.longestTaskMs)).toBeLessThan(budget);
      expect(shortest((run) => run.thread.longestFrameMs)).toBeLessThan(budget);
      // Work done in one go has one frame as long as all of it, however fast the
      // machine is.
      expect(shortest((run) => run.totalMs)).toBeGreaterThan(
        2 * shortest((run) => run.thread.longestFrameMs),
      );
    });
  }

  it("lets a key reach the note in the middle of a read, and opens the symbol after it", async function () {
    await largeSymbol("Bytes.ink.png", 2470, 1);
    await openAtMarker("Editor.md", "HERE");
    await browser.execute(() => {
      window.addEventListener(
        "keydown",
        (event) => {
          if (event.key !== "q") return;
          Reflect.set(window, "inklineKeyAt", performance.now());
          // Whether the editor was there yet.
          Reflect.set(
            window,
            "inklineKeyBeforeEditor",
            document.querySelector(".inkline-editor") === null,
          );
        },
        { capture: true, once: true },
      );
    });
    await ask("Bytes.ink.png");
    await browser.keys(["q"]);
    await waitForEditor();
    expect(
      await browser.execute(
        () => Reflect.get(window, "inklineKeyBeforeEditor") as boolean,
      ),
    ).toBe(true);
    await closeEditor();
    expect(await noteText()).toBe(
      "The door is marked with q which means return.\n",
    );
  });

  it("draws a base layer a band at a time, to the pixels of one draw", async function () {
    for (const [width, height] of [
      [1, 1],
      [300, 127],
      [257, 128],
      [130, 129],
      [97, 385],
    ] as const) {
      const png = await colours(width, height, false);
      const differing = await browser.execute(
        async (bytes, across, down) => {
          const { canvas } = window.inklineTest;
          const file = Uint8Array.from(bytes);
          // What every version before 0.9.2 did with these pixels.
          const bitmap = await createImageBitmap(
            new Blob([file], { type: "image/png" }),
            { premultiplyAlpha: "none", colorSpaceConversion: "none" },
          );
          const whole = new OffscreenCanvas(across, down);
          const context = whole.getContext("2d", { willReadFrequently: true });
          if (context === null) throw new Error("no context");
          context.drawImage(bitmap, 0, 0);
          context.globalCompositeOperation = "source-in";
          context.fillStyle = "#7e7e7e";
          context.fillRect(0, 0, across, down);
          bitmap.close();
          const { image } = await canvas.drawableBase({
            x: 0,
            y: 0,
            width: 16,
            height: 16,
            png: file,
          });
          const bands = image.getContext("2d");
          if (bands === null) throw new Error("no context");
          const expected = context.getImageData(0, 0, across, down).data;
          const found = bands.getImageData(0, 0, across, down).data;
          let different = 0;
          for (let index = 0; index < expected.length; index++) {
            if (expected[index] !== found[index]) different++;
          }
          return different;
        },
        png,
        width,
        height,
      );
      expect(differing).toBe(0);
    }
  });

  it("makes the ink of a picture that it always made", async function () {
    for (const opaque of [false, true]) {
      const png = await colours(301, 389, opaque);
      const same = await browser.execute(async (bytes) => {
        const { canvas, drafts, pixels } = window.inklineTest;
        const file = Uint8Array.from(bytes);
        const bitmap = await createImageBitmap(
          new Blob([file], { type: "image/png" }),
          { premultiplyAlpha: "none", colorSpaceConversion: "none" },
        );
        const whole = canvas.readPixels(bitmap);
        bitmap.close();
        const { width, height } = whole;
        const expected = await canvas.encodePixels({
          width,
          height,
          data: pixels.inkPixels(width, height, pixels.inkAlpha(whole)),
        });
        const opened = await canvas.openPicture(file);
        const base = opened.document.base;
        if (base === undefined) throw new Error("no base layer");
        return (
          (await drafts.fingerprintOf(base.png)) ===
          (await drafts.fingerprintOf(expected))
        );
      }, png);
      expect(same).toBe(true);
    }
  });
});

describe("While a symbol opens", function () {
  this.timeout(120_000);

  before(async function () {
    await loadModules();
  });

  beforeEach(async function () {
    await startOver();
    await createSymbol("One.ink.png");
    await createSymbol("Two.ink.png", [400, 900]);
  });

  afterEach(async function () {
    await restoreVault();
  });

  after(async function () {
    await startOver();
  });

  it("opens it once, however often it is asked for", async function () {
    await delayVault("readBinary", held);
    await ask("One.ink.png");
    await ask("One.ink.png");
    await waitForEditor();
    await readsOver();
    expect(await editors()).toBe(1);
  });

  it("opens the symbol asked for last", async function () {
    await delayVault("readBinary", held);
    await ask("One.ink.png");
    await ask("Two.ink.png");
    await waitForEditor();
    await readsOver();
    expect(await editors()).toBe(1);
    expect(await browser.$(".inkline-editor .inkline-name").getValue()).toBe(
      "Two",
    );
  });

  it("can open a symbol again once it has given way to another", async function () {
    await delayVault("readBinary", held);
    await ask("One.ink.png");
    await ask("Two.ink.png");
    await ask("One.ink.png");
    await waitForEditor();
    await readsOver();
    expect(await editors()).toBe(1);
    expect(await browser.$(".inkline-editor .inkline-name").getValue()).toBe(
      "One",
    );
  });

  it("does not come up over a window opened meanwhile, which keeps what is typed", async function () {
    await delayVault("readBinary", held);
    await ask("One.ink.png");
    await browser.executeObsidianCommand("command-palette:open");
    await browser.$(".prompt-input").waitForDisplayed();
    await browser.keys("edi");
    await waitForNotice("One.ink.png did not open");
    await browser.keys("t");
    expect(await editors()).toBe(0);
    expect(await browser.$(".prompt-input").getValue()).toBe("edit");
    await browser.keys(["Escape"]);
  });

  it("says that it is opening while that takes long, and no longer", async function () {
    await delayVault("readBinary", held);
    await ask("One.ink.png");
    await waitForNotice("Opening One.ink.png…");
    await waitForEditor();
    await browser.waitUntil(async () => (await opening()).length === 0);
  });

  it("says nothing of a symbol that opens at once", async function () {
    await editFile("One.ink.png");
    await browser.pause(500);
    expect(await opening()).toEqual([]);
  });

  it("takes in a change made to the file while it was read", async function () {
    await delayVault("readBinary", held);
    await ask("One.ink.png");
    await browser.executeObsidian(async ({ app }) => {
      const found = app.vault.getFileByPath("One.ink.png");
      const other = app.vault.getFileByPath("Two.ink.png");
      if (found === null || other === null) throw new Error("no symbols");
      const { adapter } = app.vault;
      await adapter.writeBinary(
        found.path,
        await adapter.readBinary(other.path),
      );
      // Through the vault too, as nothing watches the disk in time here.
      await app.vault.modifyBinary(found, await adapter.readBinary(other.path));
    });
    await waitForEditor();
    await waitForStatus("Reloaded");
  });

  it("opens a file deleted while it was read, for saving to make again", async function () {
    await delayVault("readBinary", held);
    await ask("One.ink.png");
    await browser.executeObsidian(async ({ app }) => {
      const found = app.vault.getFileByPath("One.ink.png");
      if (found === null) throw new Error("no symbol");
      await app.fileManager.trashFile(found);
    });
    await waitForEditor();
    await waitForStatus("The file was deleted");
  });

  it("opens nothing once Inkline is disabled", async function () {
    await delayVault("readBinary", held);
    await ask("One.ink.png");
    await obsidianPage.disablePlugin("inkline");
    await readsOver();
    expect(await editors()).toBe(0);
    await obsidianPage.enablePlugin("inkline");
    await loadModules();
    await browser.executeObsidianCommand("inkline:show-library");
    await browser.$(".inkline-library-list").waitForExist();
  });

  it("asks again about a change when Reload finds the drawing has moved on", async function () {
    await editFile("One.ink.png");
    await draw(zigzag);
    await browser.executeObsidian(async ({ app }) => {
      const found = app.vault.getFileByPath("One.ink.png");
      const other = app.vault.getFileByPath("Two.ink.png");
      if (found === null || other === null) throw new Error("no symbols");
      await app.vault.modifyBinary(found, await app.vault.readBinary(other));
    });
    await browser.waitUntil(
      async () => (await topButton("Reload")) !== undefined,
    );
    await delayVault("readBinary", 2 * held);
    await clickTop("Reload");
    await draw([
      [0.2, 0.2],
      [0.3, 0.8],
    ]);
    await browser.waitUntil(
      async () => (await topButton("Keep mine")) !== undefined,
    );
    await clickTop("Keep mine");
    const [draft] = await storedDrafts();
    // What the file opened with, the zigzag, and the stroke drawn meanwhile.
    expect(draft?.strokes).toHaveLength(3);
  });

  it("copies nothing over a drawing the editor is asking about", async function () {
    await newSymbol();
    await draw(zigzag);
    await delayVault("readBinary", held);
    await copyFrom("One");
    await browser.keys(["Escape"]);
    await browser.waitUntil(
      async () => (await topButton("Keep drawing")) !== undefined,
    );
    await waitForStatus("Not copied: One was still being read");
    await clickTop("Keep drawing");
    await browser.keys(["Control", "s"]);
    await waitForStatus("Saved");
    const [draft] = await storedDrafts();
    expect(draft).toBeUndefined();
    const record = await browser.executeObsidian(async ({ app }) => {
      const { inkFile, record: format } = window.inklineTest;
      const file = app.vault.getFileByPath("001.ink.png");
      if (file === null) throw new Error("no 001");
      const source = await inkFile.readInkFile(
        new Uint8Array(await app.vault.readBinary(file)),
      );
      return source.kind === "record"
        ? format.serializeRecord(source.record)
        : source.kind;
    });
    // One zigzag, not the two strokes of the symbol it would have copied.
    expect((JSON.parse(record) as { strokes: unknown[] }).strokes).toHaveLength(
      1,
    );
  });

  it("keeps a stroke drawn while a copy is read, for Undo to bring back", async function () {
    await newSymbol();
    await draw(zigzag);
    await delayVault("readBinary", held);
    await copyFrom("One");
    await draw([
      [0.2, 0.2],
      [0.3, 0.8],
    ]);
    await waitForStatus("Started from a copy of One");
    await browser.keys(["Control", "z"]);
    await browser.waitUntil(async () => {
      const [draft] = await storedDrafts();
      return draft?.strokes.length === 2;
    });
  });

  it("copies nothing once the editor has closed", async function () {
    await newSymbol();
    await delayVault("readBinary", held);
    await copyFrom("One");
    await closeEditor();
    await readsOver();
    expect(await editors()).toBe(0);
    expect(await notices()).toEqual([]);
    expect(await symbolFiles()).toEqual(["One.ink.png", "Two.ink.png"]);
  });
});
