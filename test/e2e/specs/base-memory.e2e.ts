// Base layers that nothing needs any more are let go, and what Undo, Redo, and
// drafts still need stays: a draft's stored picture once a newer draft is kept
// in its place, and the editor's decoded picture once no state that Undo or
// Redo can reach holds it. The memory test runs in a spec of its own, as it
// patches WeakMap and Map, and turns on V8's gc() for the window it runs in.

import { browser, expect } from "@wdio/globals";
import { loadModules } from "../support/browser.ts";
import {
  draw,
  fillStorage,
  freeStorage,
  openAtMarker,
  startOver,
  surface,
  waitForEditor,
  waitForStatus,
  writeNoise,
} from "../support/editor.ts";
import { saveScreenshot } from "../support/screenshots.ts";

/** Starts a new symbol in Editor.md, whose draft is the only one. */
async function insert(): Promise<void> {
  await openAtMarker("Editor.md", "HERE");
  await browser.executeObsidianCommand("inkline:insert-symbol");
  await waitForEditor();
}

/** Starts the drawing again from a copy of the symbol `name`. */
async function copy(name: string): Promise<void> {
  await browser.keys(["v"]);
  await browser.$(".prompt-input").waitForDisplayed();
  await browser.keys(name);
  await browser.keys(["Enter"]);
}

/**
 * The base layers that drafts keep, as the index lists them, with how many
 * characters each takes in local storage, and the key each draft names.
 */
async function storedBases(): Promise<{
  sizes: Record<string, number>;
  named: (string | undefined)[];
}> {
  return browser.executeObsidian(({ app }) => {
    const list = (key: string): string[] => {
      const values: unknown = app.loadLocalStorage(key);
      return Array.isArray(values)
        ? values.filter((value): value is string => typeof value === "string")
        : [];
    };
    const sizes: Record<string, number> = {};
    for (const key of list("inkline-draft-bases")) {
      const text: unknown = app.loadLocalStorage(`inkline-draft-base:${key}`);
      sizes[key] = typeof text === "string" ? text.length : 0;
    }
    const named = list("inkline-drafts").map((id) => {
      const text: unknown = app.loadLocalStorage(`inkline-draft:${id}`);
      if (typeof text !== "string") return undefined;
      const draft: unknown = JSON.parse(text);
      const layer: unknown =
        typeof draft === "object" && draft !== null
          ? Reflect.get(draft, "layer")
          : undefined;
      const key: unknown =
        typeof layer === "object" && layer !== null
          ? Reflect.get(layer, "key")
          : undefined;
      return typeof key === "string" ? key : undefined;
    });
    return { sizes, named };
  });
}

/** Whether a notice says that a draft could not be kept. */
async function draftRefused(): Promise<boolean> {
  return browser.$(".notice*=could not keep a draft").isExisting();
}

/** Whether the surface shows ink, in the text colour, in its middle. */
async function inkInMiddle(): Promise<boolean> {
  return browser.execute(() => {
    const canvas = activeDocument.querySelector(
      ".inkline-editor .inkline-surface",
    );
    if (canvas?.instanceOf(HTMLCanvasElement) !== true) {
      throw new Error("no surface");
    }
    return window.inklineTest.pictures.inkAt(
      canvas,
      Math.round(canvas.width / 2),
      Math.round(canvas.height / 2),
    ).ink;
  });
}

/** Waits for the surface's middle to show ink, or not. */
async function waitForInk(shown: boolean): Promise<void> {
  await browser.waitUntil(async () => (await inkInMiddle()) === shown, {
    timeoutMsg: shown ? "no picture shown" : "the picture is still shown",
  });
}

/**
 * Starts recording each base layer image the editor decodes, from now on, by
 * the image and a weak reference to it.
 */
async function watchDecoded(): Promise<void> {
  await browser.execute(() => {
    const images: WeakRef<OffscreenCanvas>[] = [];
    // Map too, so that an editor that kept its images in one would be seen
    // keeping them, rather than seen decoding none.
    const kinds = [WeakMap.prototype, Map.prototype];
    const originals = kinds.map((kind): unknown => Reflect.get(kind, "set"));
    kinds.forEach((kind, index) => {
      const original = originals[index];
      if (typeof original !== "function") throw new Error("no set()");
      Reflect.set(kind, "set", function (this: object, ...args: unknown[]) {
        const [key, value] = args;
        const image: unknown =
          typeof value === "object" && value !== null
            ? Reflect.get(value, "image")
            : undefined;
        if (key instanceof Uint8Array && image instanceof OffscreenCanvas) {
          images.push(new WeakRef(image));
        }
        return Reflect.apply(original, this, args) as unknown;
      });
    });
    Reflect.set(window, "inklineDecoded", {
      images,
      stop: () => {
        kinds.forEach((kind, index) => {
          Reflect.set(kind, "set", originals[index]);
        });
      },
    });
  });
}

/** Stops {@link watchDecoded}. */
async function stopWatching(): Promise<void> {
  await browser.execute(() => {
    const watch: unknown = Reflect.get(window, "inklineDecoded");
    const stop: unknown =
      typeof watch === "object" && watch !== null
        ? Reflect.get(watch, "stop")
        : undefined;
    if (typeof stop === "function") Reflect.apply(stop, watch, []);
    Reflect.deleteProperty(window, "inklineDecoded");
  });
}

/**
 * Collects garbage, and returns which of the images recorded are still there,
 * in the order they were decoded. What this sees is whether anything can
 * still reach an image, not how much memory the page or its GPU process uses.
 */
async function imagesKept(): Promise<boolean[]> {
  return browser.executeObsidian(({ require }) => {
    const v8 = require("v8") as unknown as {
      setFlagsFromString(flags: string): void;
    };
    const vm = require("vm") as unknown as {
      runInNewContext(code: string): unknown;
    };
    // The flag takes effect for contexts made after it: this one's gc().
    v8.setFlagsFromString("--expose-gc");
    const collect = vm.runInNewContext("gc");
    if (typeof collect !== "function") throw new Error("no gc()");
    Reflect.apply(collect, undefined, []);
    const watch: unknown = Reflect.get(window, "inklineDecoded");
    const images: unknown =
      typeof watch === "object" && watch !== null
        ? Reflect.get(watch, "images")
        : undefined;
    if (!Array.isArray(images)) throw new Error("not watching");
    return images.map(
      (image) => image instanceof WeakRef && image.deref() !== undefined,
    );
  });
}

/** How many images {@link watchDecoded} has recorded. */
async function decodedCount(): Promise<number> {
  return browser.execute(() => {
    const watch: unknown = Reflect.get(window, "inklineDecoded");
    const images: unknown =
      typeof watch === "object" && watch !== null
        ? Reflect.get(watch, "images")
        : undefined;
    return Array.isArray(images) ? images.length : 0;
  });
}

/** Waits for {@link watchDecoded} to have recorded `count` images. */
async function waitForDecoded(count: number): Promise<void> {
  await browser.waitUntil(async () => (await decodedCount()) >= count, {
    timeoutMsg: `not ${String(count)} images decoded`,
  });
  expect(await decodedCount()).toBe(count);
}

describe("Base layers nothing needs", function () {
  before(async function () {
    await loadModules();
  });

  beforeEach(async function () {
    await startOver();
  });

  after(async function () {
    await startOver();
  });

  it("keeps a draft through copy after copy with room in storage for two pictures", async function () {
    // Noise, so that its picture takes room as a real one's does.
    await writeNoise("noise.ink.png", 256);
    await insert();
    await copy("noise");
    await waitForStatus("Started from a copy of noise");
    let { sizes, named } = await storedBases();
    const [size, ...others] = Object.values(sizes);
    if (size === undefined) throw new Error("no picture kept in the draft");
    expect(others).toEqual([]);
    expect(size).toBeGreaterThan(50_000);
    try {
      // Room for a picture and a half more. Each new one is stored before
      // the draft that names it, and the old one dropped after, so one more
      // is enough; with every old one kept, the third copy would not fit.
      await fillStorage(Math.round(size * 1.5));
      for (let count = 0; count < 4; count++) {
        const [before] = named;
        await copy("noise");
        await browser.waitUntil(
          async () =>
            (await draftRefused()) || (await storedBases()).named[0] !== before,
          { timeoutMsg: "the draft named the same picture" },
        );
        expect(await draftRefused()).toBe(false);
        ({ sizes, named } = await storedBases());
        expect(Object.keys(sizes)).toEqual(named);
      }
    } finally {
      await freeStorage();
    }
  });

  it("lets a decoded picture go once Undo and Redo cannot reach it, and keeps it until then", async function () {
    // A picture, which opens as a base layer: opaque and black, so all ink.
    await browser.executeObsidian(async ({ app }) => {
      const { canvas } = window.inklineTest;
      const data = new Uint8ClampedArray(8 * 8 * 4);
      for (let alpha = 3; alpha < data.length; alpha += 4) data[alpha] = 255;
      const bytes = await canvas.encodePixels({ width: 8, height: 8, data });
      await app.vault.createBinary("tower.ink.png", bytes.slice().buffer);
    });
    await insert();
    await watchDecoded();
    try {
      await copy("tower");
      await waitForDecoded(1);
      await waitForInk(true);
      await browser.keys(["Control", "z"]);
      await waitForInk(false);
      // Redo can bring it back, so it stays, and shows again at once.
      expect(await imagesKept()).toEqual([true]);
      await browser.keys(["Control", "Shift", "z"]);
      await waitForInk(true);
      await saveScreenshot("decoded-base-redone");
      await browser.keys(["Control", "z"]);
      await waitForInk(false);
      // A new change past the Undo leaves nothing to redo.
      await copy("tower");
      await waitForDecoded(2);
      await waitForInk(true);
      expect(await imagesKept()).toEqual([false, true]);
      await browser.keys(["Control", "z"]);
      await waitForInk(false);
      await draw([
        [0.1, 0.2],
        [0.2, 0.3],
      ]);
      expect(await imagesKept()).toEqual([false, false]);
      await copy("tower");
      await waitForDecoded(3);
      await copy("tower");
      await waitForDecoded(4);
      await waitForInk(true);
      // The third is one Undo away until 500 later changes push it out of
      // the history, after the two states before it.
      const taps = async (count: number): Promise<void> => {
        const tap = browser.action("pointer", {
          parameters: { pointerType: "mouse" },
        });
        for (let at = 0; at < count; at++) {
          tap
            .move({ origin: surface(), x: at % 7, y: 0, duration: 0 })
            .down()
            .up();
        }
        await tap.perform();
      };
      for (let done = 0; done < 490; done += 70) await taps(70);
      expect(await imagesKept()).toEqual([false, false, true, true]);
      await taps(20);
      expect(await imagesKept()).toEqual([false, false, false, true]);
      await waitForInk(true);
      await saveScreenshot("decoded-base-past-history");
    } finally {
      await stopWatching();
    }
  });
});
