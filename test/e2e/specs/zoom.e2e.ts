import { browser, expect } from "@wdio/globals";
import { Key } from "webdriverio";
import { unitsPerPixel } from "../../../src/format/record.ts";
import { lineBox } from "../../../src/ink/geometry.ts";
import { loadModules } from "../support/browser.ts";
import {
  draw,
  markEditor,
  openAtMarker,
  recordOf,
  settledSurface,
  startOver,
  storedDrafts,
  surface,
  waitForEditor,
  waitForNext,
  waitForStatus,
} from "../support/editor.ts";
import { setPageZoom } from "../support/cursor.ts";
import {
  boxOf,
  tops,
  watchTops,
  type Box,
  type Point,
} from "../support/pointer.ts";
import { saveScreenshot } from "../support/screenshots.ts";
import { framesDrawn } from "../support/waits.ts";

async function openEditor(): Promise<void> {
  await openAtMarker("Editor.md", "HERE");
  await browser.executeObsidianCommand("inkline:insert-symbol");
  await waitForEditor();
  await settledSurface();
}

async function zoomPressed(): Promise<string | null> {
  return browser.$('[data-inkline-button="zoom"]').getAttribute("aria-pressed");
}

/** The drawing area's size in CSS pixels, once it stops changing. */
async function surfaceSize(): Promise<{ width: number; height: number }> {
  return settledSurface();
}

/**
 * How many document pixels the drawing area shows across: the line box is
 * as tall as it is, so its width over its height, times the box's height.
 */
async function shownAcross(): Promise<number> {
  const { width, height } = await surfaceSize();
  return (width / height) * lineBox.height;
}

/** Taps at a fraction of the drawing area, and returns where the dot went. */
async function tap(x: number, y: number): Promise<{ x: number; y: number }> {
  const before = (await storedDrafts())[0]?.strokes.length ?? 0;
  await draw([[x, y]]);
  await browser.waitUntil(
    async () => ((await storedDrafts())[0]?.strokes.length ?? 0) > before,
  );
  const points = (await storedDrafts())[0]?.strokes.at(-1)?.points ?? [];
  return {
    x: (points[0] ?? 0) / unitsPerPixel,
    y: (points[1] ?? 0) / unitsPerPixel,
  };
}

/** How wide the preview shows the symbol, in CSS pixels, and its font size. */
async function previewWidth(): Promise<{ width: number; fontSize: number }> {
  return browser.execute(() => {
    const ink = document.querySelector(".inkline-editor .inkline-preview-ink");
    const line = document.querySelector(".inkline-editor .inkline-preview");
    if (!(ink instanceof HTMLCanvasElement) || !(line instanceof HTMLElement)) {
      throw new Error("no preview");
    }
    return {
      width: Number.parseFloat(ink.style.width),
      fontSize: Number.parseFloat(getComputedStyle(line).fontSize),
    };
  });
}

/** A place in the window, at fractions of the drawing area's box now. */
async function inWindow(x: number, y: number): Promise<Point> {
  const { left, right, top, bottom } = await boxOf(
    ".inkline-editor .inkline-surface",
  );
  return {
    x: Math.round(left + x * (right - left)),
    y: Math.round(top + y * (bottom - top)),
  };
}

/** The mouse, moving to `at` in the window in one report. */
function mouseTo(at: Point) {
  return browser
    .action("pointer", { parameters: { pointerType: "mouse" } })
    .move({ origin: "viewport", ...at, duration: 0 });
}

/** Clicks at `at` in the window, without moving between press and release. */
async function clickAt(at: Point): Promise<void> {
  await mouseTo(at).down().up().perform();
}

/** Keys pressed together, as by {@link drag}. */
type Chord = readonly string[];

/**
 * Presses the mouse at `from`, moves it to `to` in one report, and lets go
 * there without moving again, as a hand that stays still does. `keys` are
 * pressed in turn while it is held there, and the wheel turned by `wheel`
 * pixels down where it is, `before` and `after` milliseconds from the move
 * and the release. All of it is one WebDriver command: in Obsidian, any
 * other command between a press and its release ends the press as a lost
 * capture rather than a release, which says nothing of where the pointer is
 * (#391).
 */
async function drag(
  from: Point,
  to: Point,
  {
    keys = [],
    wheel,
    before = 400,
    after = 400,
  }: {
    keys?: readonly Chord[];
    wheel?: number;
    before?: number;
    after?: number;
  } = {},
): Promise<void> {
  const keyboard = browser.action("key");
  const scroll = browser.action("wheel");
  const pointer = browser.action("pointer", {
    parameters: { pointerType: "mouse" },
  });
  pointer
    .move({ origin: "viewport", ...from, duration: 0 })
    .down()
    .move({ origin: "viewport", ...to, duration: 0 })
    .pause(before);
  for (const source of [keyboard, scroll]) {
    source.pause(0).pause(0).pause(0).pause(before);
  }
  for (const chord of keys) {
    for (const key of chord) {
      keyboard.down(key);
      scroll.pause(10);
      pointer.pause(10);
    }
    for (const key of [...chord].reverse()) {
      keyboard.up(key);
      scroll.pause(10);
      pointer.pause(10);
    }
  }
  if (wheel !== undefined) {
    // At the pointer, from the window's corner, so that it does not move.
    scroll.scroll({ ...to, deltaX: 0, deltaY: wheel });
    keyboard.pause(10);
    pointer.pause(10);
  }
  keyboard.pause(after);
  scroll.pause(after);
  pointer.pause(after).up();
  await browser.actions([keyboard, scroll, pointer]);
}

/** What {@link watchPress} saw. */
interface Watched {
  /** The drawing area's presses, releases and lost captures, in order. */
  readonly events: readonly string[];
  /** What the editor showed as the pointer was let go, before it took that. */
  readonly released?: {
    /** The drawing area's height, in CSS pixels. */
    readonly height: number;
    readonly status: string;
    /** Whether Zoom was shown pressed. */
    readonly pressed: string | null;
    /** Whether the drawing area pressed was still in the window. */
    readonly connected: boolean;
    /** Whether the drawing area showed ink under the pointer. */
    readonly inked: boolean;
  };
}

/**
 * What the page does while the mouse is held, as {@link watchPress} says:
 * clicks Zoom or Fit, as a key on the button could; makes the editor 120
 * pixels narrower, which changes the drawing area's size; or moves the
 * editor 60 pixels right and tells the window it was resized, as when a
 * window's size changes and the editor stays in its middle; sets Obsidian's
 * page zoom to 125% at once, as Ctrl+= does by a smaller step, about 109.5%,
 * through the same webFrame; or clicks Readings and translations, as a key
 * on the button could, which opens its fields' row.
 */
type During = "zoom" | "fit" | "narrower" | "moved" | "page zoom" | "readings";

/**
 * Watches the next press on the drawing area, in the page, for
 * {@link watched}, doing `during` 150 milliseconds after the press: the test
 * itself cannot send a command then.
 */
async function watchPress(during?: During): Promise<void> {
  await browser.execute((action) => {
    const surface = document.querySelector(".inkline-editor .inkline-surface");
    const editor = document.querySelector(".inkline-editor");
    if (
      !(surface instanceof HTMLCanvasElement) ||
      !(editor instanceof HTMLElement)
    ) {
      throw new Error("no surface");
    }
    const previous: unknown = Reflect.get(window, "inklineTestWatch");
    if (previous instanceof AbortController) previous.abort();
    const watch = new AbortController();
    const seen: {
      events: string[];
      released?: {
        height: number;
        status: string;
        pressed: string | null;
        connected: boolean;
        inked: boolean;
      };
    } = { events: [] };
    Reflect.set(window, "inklineTestWatch", watch);
    Reflect.set(window, "inklineTestWatched", seen);
    /**
     * Sets the page zoom, as setPageZoom() does, from the page itself: found
     * now, so that a host without it fails here rather than in a timer, where
     * the test would see only that nothing happened.
     */
    const zoom = ((): (() => void) => {
      if (action !== "page zoom") return () => undefined;
      const load: unknown = Reflect.get(window, "require");
      if (typeof load !== "function") throw new Error("no host require");
      const electron: unknown = Reflect.apply(load, window, ["electron"]);
      const frame: unknown = Reflect.get(Object(electron), "webFrame");
      const set: unknown = Reflect.get(Object(frame), "setZoomFactor");
      if (typeof set !== "function") throw new Error("no host zoom");
      // Its result, which says nothing, is not passed on.
      return (): void => {
        Reflect.apply(set, frame, [1.25]);
      };
    })();
    const act = (): void => {
      if (action === "zoom" || action === "fit") {
        const button = editor.querySelector(
          `[data-inkline-button="${action}"]`,
        );
        if (button?.instanceOf(HTMLElement) === true) button.click();
      } else if (action === "narrower") {
        editor.style.width = `${String(editor.offsetWidth - 120)}px`;
      } else if (action === "moved") {
        editor.style.position = "relative";
        editor.style.left = "60px";
        window.dispatchEvent(new Event("resize"));
      } else if (action === "page zoom") {
        zoom();
      } else if (action === "readings") {
        const toggle = editor.querySelector(".inkline-text-toggle");
        if (toggle?.instanceOf(HTMLElement) === true) toggle.click();
      }
    };
    /**
     * Whether the drawing area shows ink, or anything, under `event`; not
     * once it has closed.
     */
    const inked = (event: PointerEvent): boolean => {
      if (!surface.isConnected || surface.clientWidth === 0) return false;
      const box = surface.getBoundingClientRect();
      const scale = surface.width / surface.clientWidth;
      const x = Math.floor(
        (event.clientX - box.left - surface.clientLeft) * scale,
      );
      const y = Math.floor(
        (event.clientY - box.top - surface.clientTop) * scale,
      );
      const data = surface
        .getContext("2d")
        ?.getImageData(x - 1, y - 1, 3, 3).data;
      return Array.from(data ?? []).some(
        (value, index) => index % 4 === 3 && value > 128,
      );
    };
    const { signal } = watch;
    for (const type of ["pointerdown", "pointerup", "lostpointercapture"]) {
      // Before the editor's own listeners, which are on the drawing area.
      window.addEventListener(
        type,
        (event) => {
          seen.events.push(type);
          if (type === "pointerdown" && action !== null) {
            window.setTimeout(act, 150);
          }
          if (type !== "pointerup" || seen.released !== undefined) return;
          seen.released = {
            height: surface.offsetHeight,
            status:
              document.querySelector(".inkline-editor .inkline-status")
                ?.textContent ?? "",
            pressed:
              document
                .querySelector('.inkline-editor [data-inkline-button="zoom"]')
                ?.getAttribute("aria-pressed") ?? null,
            connected: surface.isConnected,
            inked: event instanceof PointerEvent && inked(event),
          };
        },
        { capture: true, signal },
      );
    }
  }, during ?? null);
}

/** What {@link watchPress} saw, which stops it watching. */
async function watched(): Promise<Watched> {
  return browser.execute(() => {
    const watch: unknown = Reflect.get(window, "inklineTestWatch");
    if (watch instanceof AbortController) watch.abort();
    const seen: unknown = Reflect.get(window, "inklineTestWatched");
    return seen as Watched;
  });
}

/**
 * Drags from `from` to `to` as {@link drag} does, with `during` done in the
 * page while it is held, and returns what the editor showed as it was let
 * go, which it was, rather than lost.
 */
async function dragWatched(
  from: Point,
  to: Point,
  options: Parameters<typeof drag>[2] = {},
  during?: During,
): Promise<NonNullable<Watched["released"]>> {
  await watchPress(during);
  await drag(from, to, options);
  const { events, released } = await watched();
  expect(events.slice(0, 2)).toEqual(["pointerdown", "pointerup"]);
  if (released === undefined) throw new Error("not let go");
  return released;
}

/** The strokes the editor keeps, from its draft. */
async function keptStrokes(): Promise<{ tool: string; points: number[] }[]> {
  return ((await storedDrafts())[0]?.strokes ?? []).map(({ tool, points }) => ({
    tool,
    points: [...points],
  }));
}

/** Waits for the draft to hold `count` strokes, and gives the last. */
async function strokeAt(count: number) {
  await browser.waitUntil(async () => (await keptStrokes()).length === count, {
    timeoutMsg: `the draft never held ${String(count)} strokes`,
  });
  return (await keptStrokes()).at(-1);
}

/**
 * Drags from `from` to `to` pressing Zoom while held there, by its key or
 * its button, and returns what the editor showed as it was let go.
 */
async function dragZooming(
  from: Point,
  to: Point,
  by: "key" | "button",
): Promise<NonNullable<Watched["released"]>> {
  return by === "key"
    ? dragWatched(from, to, { keys: [["z"]] })
    : dragWatched(from, to, {}, "zoom");
}

/** What the scroll bar below a zoomed drawing area shows, as it is now. */
interface ScrollBar {
  /** Its row's height, in CSS pixels: none while it has no row. */
  readonly height: number;
  /** Whether its thumb shows, as while the drawing reaches past the view. */
  readonly shown: boolean;
  /** Its track's and its thumb's boxes, in the window's CSS pixels. */
  readonly track: Box;
  readonly thumb: Box;
  readonly role: string | null;
  readonly orientation: string | null;
  /** Whether it says it controls the drawing area. */
  readonly controlsSurface: boolean;
  readonly value: string | null;
  readonly hidden: string | null;
  /** Whether it can take the focus. */
  readonly focusable: boolean;
}

async function scrollBar(): Promise<ScrollBar> {
  return browser.execute(() => {
    const editor = document.querySelector(".inkline-editor");
    const bar = editor?.querySelector(".inkline-scroll");
    const thumb = bar?.querySelector(".inkline-scroll-thumb");
    if (!(bar instanceof HTMLElement) || !(thumb instanceof HTMLElement)) {
      throw new Error("no scroll bar");
    }
    const box = (element: Element) => {
      const { left, right, top, bottom } = element.getBoundingClientRect();
      return { left, right, top, bottom };
    };
    const controls = bar.getAttribute("aria-controls") ?? "";
    return {
      height: bar.offsetHeight,
      shown:
        bar.offsetHeight > 0 &&
        getComputedStyle(thumb).visibility === "visible",
      track: box(bar),
      thumb: box(thumb),
      role: bar.getAttribute("role"),
      orientation: bar.getAttribute("aria-orientation"),
      controlsSurface:
        controls !== "" &&
        document.getElementById(controls) ===
          editor?.querySelector(".inkline-surface"),
      value: bar.getAttribute("aria-valuenow"),
      hidden: bar.getAttribute("aria-hidden"),
      focusable: bar.tabIndex >= 0 || thumb.tabIndex >= 0,
    };
  });
}

/** Whether the drawing area has the focus. */
async function surfaceFocused(): Promise<boolean> {
  return browser.execute(
    () =>
      document.activeElement?.matches(".inkline-editor .inkline-surface") ===
      true,
  );
}

/** Presses the mouse at `from` in the window, moves it to `to`, and lets go. */
async function mouseDrag(from: Point, to: Point): Promise<void> {
  await mouseTo(from)
    .down()
    .move({ origin: "viewport", ...to, duration: 100 })
    .up()
    .perform();
}

/** How many of the preview's pixels hold ink. */
async function previewInk(): Promise<number> {
  return browser.execute(() => {
    const ink = document.querySelector(".inkline-editor .inkline-preview-ink");
    if (!(ink instanceof HTMLCanvasElement)) throw new Error("no preview");
    const context = ink.getContext("2d");
    if (context === null) throw new Error("no context");
    const { data } = context.getImageData(0, 0, ink.width, ink.height);
    let count = 0;
    for (let index = 3; index < data.length; index += 4) {
      if ((data[index] ?? 0) > 0) count++;
    }
    return count;
  });
}

describe("Zoom", function () {
  before(async function () {
    await loadModules();
  });
  beforeEach(async function () {
    await startOver();
  });
  afterEach(async function () {
    await setPageZoom(1);
  });
  it("shows the drawing taller with Z or the button, as far as the window allows", async function () {
    await openEditor();
    const usual = await surfaceSize();
    expect(await zoomPressed()).toBe("false");
    await browser.keys("z");
    await waitForStatus("Zoomed in");
    await browser.waitUntil(
      async () => (await surfaceSize()).height > usual.height * 1.3,
    );
    const zoomed = await surfaceSize();
    expect(await zoomPressed()).toBe("true");
    expect(zoomed.width).toBe(usual.width);
    const { limit, scrolls, full } = await browser.execute(() => {
      const editor = document.querySelector(".inkline-editor");
      if (!(editor instanceof HTMLElement)) throw new Error("no editor");
      const most = Number.parseFloat(getComputedStyle(editor).maxHeight);
      return {
        limit: window.innerHeight * 0.55,
        // With a whole pixel of rounding.
        scrolls: editor.scrollHeight > editor.clientHeight + 1,
        full: Math.abs(editor.getBoundingClientRect().height - most) < 2,
      };
    });
    // The controls stay in view, without a scrollbar that would narrow it.
    expect(scrolls).toBe(false);
    // Twice as tall, or as tall as the window allows.
    expect(zoomed.height).toBeLessThanOrEqual(
      Math.max(limit, usual.height) + 1,
    );
    expect(
      Math.abs(zoomed.height - usual.height * 2) < 2 ||
        Math.abs(zoomed.height - limit) < 2 ||
        full,
    ).toBe(true);
    await saveScreenshot("zoom-in");
    await browser.$('[data-inkline-button="zoom"]').click();
    await waitForStatus("Zoomed out");
    await browser.waitUntil(
      async () => Math.abs((await surfaceSize()).height - usual.height) < 1,
    );
    expect(await zoomPressed()).toBe("false");
  });

  it("maps the pointer to the drawing at either size, about the same middle", async function () {
    await openEditor();
    const middle = await tap(0.5, 0.5);
    await browser.keys("z");
    await waitForStatus("Zoomed in");
    const across = await shownAcross();
    const again = await tap(0.5, 0.5);
    // The middle stays where it was, to a pixel of rounding.
    expect(Math.abs(again.x - middle.x)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(again.y - middle.y)).toBeLessThanOrEqual(1.5);
    // A quarter of the way across is a quarter of what the surface shows.
    const right = await tap(0.75, 0.25);
    expect(Math.abs(right.x - again.x - across / 4)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(right.y - lineBox.height / 4)).toBeLessThanOrEqual(1.5);
    // Shown larger, the drawing is still one line of text tall.
    expect(across).toBeLessThan(4.5 * lineBox.pxPerEm * 0.75);
  });

  it("moves along the drawing with the wheel and the arrow keys", async function () {
    await openEditor();
    await browser.keys("z");
    await waitForStatus("Zoomed in");
    const across = await shownAcross();
    const start = await tap(0.5, 0.5);
    await browser.keys("ArrowRight");
    const arrowed = await tap(0.5, 0.5);
    expect(Math.abs(arrowed.x - start.x - across / 4)).toBeLessThanOrEqual(1.5);
    const { width } = await surfaceSize();
    await browser
      .action("wheel")
      .scroll({ origin: await surface().getElement(), deltaY: 100 })
      .perform();
    const wheeled = await tap(0.5, 0.5);
    expect(
      Math.abs(wheeled.x - arrowed.x - (100 / width) * across),
    ).toBeLessThanOrEqual(1.5);
    await browser.keys("ArrowLeft");
    const back = await tap(0.5, 0.5);
    expect(Math.abs(back.x - wheeled.x + across / 4)).toBeLessThanOrEqual(1.5);
  });

  it("centres the drawing with Fit, staying zoomed", async function () {
    await openEditor();
    // A short stroke left of the middle.
    await draw([
      [0.2, 0.5],
      [0.3, 0.5],
    ]);
    await browser.waitUntil(async () => (await storedDrafts()).length === 1);
    const points = (await storedDrafts())[0]?.strokes[0]?.points ?? [];
    const centre =
      ((points[0] ?? 0) + (points.at(-2) ?? 0)) / 2 / unitsPerPixel;
    await browser.keys("z");
    await waitForStatus("Zoomed in");
    for (let step = 0; step < 6; step++) await browser.keys("ArrowRight");
    await browser.keys("f");
    expect(await zoomPressed()).toBe("true");
    const middle = await tap(0.5, 0.5);
    // Fit centres the drawing's ink with its side bearings, to a few pixels.
    expect(Math.abs(middle.x - centre)).toBeLessThanOrEqual(12);
  });

  // Zooming moves what the pointer is over, so a release where the pointer
  // was would land elsewhere in the drawing (#382). Each drag is let go with
  // no move, where it was in the window before Zoom, and saves just what the
  // same drag without Zoom saves, through the editor's own mapping of the
  // release.
  for (const { what, keys, by } of [
    { what: "a pen stroke", keys: [], by: "key" },
    { what: "a pen stroke", keys: [], by: "button" },
    { what: "an eraser stroke", keys: ["e"], by: "key" },
    { what: "an ellipse", keys: ["o"], by: "button" },
    { what: "an eraser's ellipse", keys: ["e", "o"], by: "key" },
  ] as const) {
    it(`waits until ${what} is let go, pressed by its ${by}`, async function () {
      await openEditor();
      for (const key of keys) await browser.keys(key);
      const usual = await surfaceSize();
      const from = await inWindow(0.3, 0.65);
      const to = await inWindow(0.6, 0.35);
      await drag(from, to);
      const alone = await strokeAt(1);
      const released = await dragZooming(from, to, by);
      expect(released).toMatchObject({
        height: usual.height,
        status: "Zooming in once you let go",
        pressed: "true",
        connected: true,
      });
      // The pen's stroke ends under the pointer, where an ellipse, which
      // keeps inside the box dragged, and the eraser over nothing show none.
      if (what === "a pen stroke") expect(released.inked).toBe(true);
      await waitForStatus("Zoomed in");
      expect(await strokeAt(2)).toEqual(alone);
      expect((await surfaceSize()).height).toBeGreaterThan(usual.height * 1.3);
      expect(await zoomPressed()).toBe("true");
      await saveScreenshot(`zoom-after-${what.replaceAll(/\W+/g, "-")}`);
    });
  }

  it("waits until a polygon's corner is let go", async function () {
    await openEditor();
    await browser.keys("y");
    const usual = await surfaceSize();
    const first = await inWindow(0.3, 0.65);
    const second = await inWindow(0.6, 0.35);
    await clickAt(first);
    await clickAt(second);
    await browser.keys("Enter");
    const alone = await strokeAt(1);
    await clickAt(first);
    // Pressed where the corner goes, held there, and let go.
    const released = await dragZooming(second, second, "key");
    expect(released).toEqual({
      height: usual.height,
      status: "Zooming in once you let go",
      pressed: "true",
      connected: true,
      inked: true,
    });
    await waitForStatus("Zoomed in");
    await browser.keys("Enter");
    expect(await strokeAt(2)).toEqual(alone);
  });

  it("waits until a path's handle is let go", async function () {
    await openEditor();
    await browser.keys("a");
    const usual = await surfaceSize();
    const first = await inWindow(0.3, 0.65);
    const second = await inWindow(0.6, 0.35);
    const handle = await inWindow(0.7, 0.35);
    await clickAt(first);
    await drag(second, handle);
    // Enter ends the path, and Enter again makes it ink.
    await browser.keys("Enter");
    await browser.keys("Enter");
    const alone = await strokeAt(1);
    await clickAt(first);
    // Pressed where the smooth point goes, dragged out to its handle's end,
    // held there, and let go.
    const released = await dragZooming(second, handle, "key");
    expect(released).toEqual({
      height: usual.height,
      status: "Zooming in once you let go",
      pressed: "true",
      connected: true,
      inked: true,
    });
    await waitForStatus("Zoomed in");
    await browser.keys("Enter");
    await browser.keys("Enter");
    expect(await strokeAt(2)).toEqual(alone);
  });

  it("stays as it was when pressed twice while drawing, and waits to zoom out", async function () {
    await openEditor();
    const usual = await surfaceSize();
    const from = await inWindow(0.3, 0.65);
    const to = await inWindow(0.6, 0.35);
    await drag(from, to);
    const alone = await strokeAt(1);
    await watchPress();
    await drag(from, to, { keys: [["z"], ["z"]] });
    // The second press says nothing, as the line says only what is done.
    expect((await watched()).released).toEqual({
      height: usual.height,
      status: "",
      pressed: "false",
      connected: true,
      inked: true,
    });
    expect(await strokeAt(2)).toEqual(alone);
    await framesDrawn();
    expect(await surfaceSize()).toEqual(usual);
    expect(await zoomPressed()).toBe("false");
    // Zoomed in, it waits to zoom out in the same way.
    await browser.keys("z");
    await waitForStatus("Zoomed in");
    const zoomed = await surfaceSize();
    const released = await dragZooming(
      await inWindow(0.3, 0.65),
      await inWindow(0.6, 0.35),
      "button",
    );
    expect(released).toEqual({
      height: zoomed.height,
      status: "Zooming out once you let go",
      pressed: "false",
      connected: true,
      inked: true,
    });
    await waitForStatus("Zoomed out");
    await strokeAt(3);
    await browser.waitUntil(
      async () => Math.abs((await surfaceSize()).height - usual.height) < 1,
    );
  });

  it("takes a zoom asked for while drawing to the next symbol, with Next", async function () {
    await openEditor();
    const usual = await surfaceSize();
    await markEditor();
    await watchPress();
    // Held until well after the next editor has opened.
    await drag(await inWindow(0.3, 0.65), await inWindow(0.6, 0.35), {
      keys: [["z"], [Key.Ctrl, Key.Shift, Key.Enter]],
      after: 5000,
    });
    // This editor had closed before the pointer was let go, without zooming.
    expect((await watched()).released?.connected).toBe(false);
    await waitForNext(1);
    expect(await zoomPressed()).toBe("true");
    await browser.waitUntil(
      async () => (await surfaceSize()).height > usual.height * 1.3,
    );
    const record = JSON.parse(await recordOf("001.ink.png")) as {
      strokes: unknown[];
    };
    expect(record.strokes).toHaveLength(1);
  });

  // Fit moves the view as Zoom does, and pressed while drawing waits for the
  // release in the same way (#393).
  for (const by of ["key", "button"] as const) {
    it(`waits until a stroke is let go to fit, pressed by its ${by}`, async function () {
      await openEditor();
      await browser.keys("z");
      await waitForStatus("Zoomed in");
      const usual = await surfaceSize();
      // Something off the middle, for Fit to bring there.
      await drag(await inWindow(0.05, 0.5), await inWindow(0.15, 0.5));
      await strokeAt(1);
      const from = await inWindow(0.3, 0.65);
      const to = await inWindow(0.6, 0.35);
      await drag(from, to);
      const alone = await strokeAt(2);
      const released =
        by === "key"
          ? await dragWatched(from, to, { keys: [["f"]] })
          : await dragWatched(from, to, {}, "fit");
      expect(released).toMatchObject({
        height: usual.height,
        status: "Fitting once you let go",
        inked: true,
      });
      expect(await strokeAt(3)).toEqual(alone);
      // Then it fits, which says nothing.
      await browser.waitUntil(
        async () =>
          (await browser.$(".inkline-editor .inkline-status").getText()) === "",
      );
      await drag(from, to);
      expect((await strokeAt(4))?.points).not.toEqual(alone?.points);
    });
  }

  // The wheel and the arrow keys move a zoomed view along the drawing while
  // a stroke is drawn, which can be meant, to take it past the edge: what is
  // drawn goes on to where the pointer then is in the drawing, and shows
  // there before it is let go (#393).
  for (const { by, options } of [
    { by: "the wheel", options: { wheel: 150 } },
    { by: "an arrow key", options: { keys: [[Key.ArrowRight]] } },
  ] as const) {
    it(`carries a stroke along as ${by} moves the view under it`, async function () {
      await openEditor();
      // No guides, so that only ink shows under the pointer.
      await browser.keys("g");
      await browser.keys("z");
      await waitForStatus("Zoomed in");
      const from = await inWindow(0.3, 0.65);
      const to = await inWindow(0.6, 0.35);
      await drag(from, to);
      const alone = await strokeAt(1);
      const released = await dragWatched(from, to, options);
      expect(released.inked).toBe(true);
      const carried = await strokeAt(2);
      // The same drag in the view as it now is, for where the pointer is in
      // the drawing after the move.
      await drag(from, to);
      const after = await strokeAt(3);
      expect(carried?.points.slice(0, 2)).toEqual(alone?.points.slice(0, 2));
      expect(carried?.points.slice(-2)).toEqual(after?.points.slice(-2));
      expect(after?.points.slice(-2)).not.toEqual(alone?.points.slice(-2));
      await saveScreenshot(`carried-by-${by.replaceAll(/\W+/g, "-")}`);
    });
  }

  // A path's point or handle being dragged goes on to the pointer in the
  // same way, so that its end is still under it when it is let go (#393).
  for (const { by, options } of [
    { by: "the wheel", options: { wheel: 150 } },
    { by: "an arrow key", options: { keys: [[Key.ArrowRight]] } },
  ] as const) {
    it(`carries a path's handle along as ${by} moves the view under it`, async function () {
      await openEditor();
      // No guides, so that only the path and its controls show.
      await browser.keys("g");
      await browser.keys("z");
      await waitForStatus("Zoomed in");
      await browser.keys("a");
      await clickAt(await inWindow(0.3, 0.65));
      // Pressed where a smooth point goes, its handle dragged out, and the
      // view moved along while it is held.
      const released = await dragWatched(
        await inWindow(0.5, 0.4),
        await inWindow(0.6, 0.4),
        options,
      );
      // The handle's end, a filled dot, is under the pointer.
      expect(released.inked).toBe(true);
      // Ended, and made ink.
      await browser.keys("Enter");
      await browser.keys("Enter");
      expect((await strokeAt(1))?.points.length).toBeGreaterThan(2);
    });
  }

  // A change to the window's or the drawing area's size moves the drawing
  // under the pointer, which may have moved with the window, so what is
  // drawn ends where it was shown, as when the editor loses the pointer
  // (#393).
  for (const { what, during } of [
    { what: "the drawing area changes size", during: "narrower" },
    { what: "the window's size changes", during: "moved" },
    // Obsidian's page zoom resizes the window's CSS viewport (#418).
    { what: "the page zoom changes", during: "page zoom" },
    // Its fields' row changes the editor's size (#445).
    { what: "Readings and translations opens", during: "readings" },
  ] as const) {
    it(`ends a stroke where it was shown when ${what}`, async function () {
      await openEditor();
      const from = await inWindow(0.3, 0.65);
      const to = await inWindow(0.6, 0.35);
      await drag(from, to);
      const alone = await strokeAt(1);
      const released = await dragWatched(from, to, {}, during);
      expect(released.status).toBe(
        "Ended the stroke where it showed: the drawing area moved",
      );
      expect(await strokeAt(2)).toEqual(alone);
      // Letting go added nothing.
      await framesDrawn();
      expect(await keptStrokes()).toHaveLength(2);
    });
  }

  it("keeps the preview and the image's edges whole when zoomed and moved along", async function () {
    await openEditor();
    // Wider than the zoomed view shows.
    await draw([
      [0.08, 0.5],
      [0.5, 0.5],
      [0.92, 0.5],
    ]);
    await browser.waitUntil(async () => (await storedDrafts()).length === 1);
    await framesDrawn();
    const usual = await previewWidth();
    const inked = await previewInk();
    await browser.keys("z");
    await waitForStatus("Zoomed in");
    await framesDrawn();
    expect(Math.abs((await previewWidth()).width - usual.width)).toBeLessThan(
      1,
    );
    for (let step = 0; step < 8; step++) await browser.keys("ArrowRight");
    await framesDrawn();
    const moved = await previewWidth();
    expect(Math.abs(moved.width - usual.width)).toBeLessThan(1);
    // Still the whole symbol, not the part in view.
    expect(await previewInk()).toBeGreaterThan(inked * 0.9);
    // The saved image is as wide as the preview said.
    await browser.keys(["Control", "s"]);
    await waitForStatus("Saved");
    const saved = await browser.executeObsidian(async ({ app }) => {
      const file = app.vault.getFileByPath("001.ink.png");
      if (file === null) throw new Error("no saved symbol");
      const bitmap = await window.inklineTest.canvas.decodePng(
        new Uint8Array(await app.vault.readBinary(file)),
      );
      const { width } = bitmap;
      bitmap.close();
      return width;
    });
    const expected = (usual.width * lineBox.pxPerEm) / usual.fontSize;
    expect(Math.abs(saved - expected)).toBeLessThanOrEqual(1.5);
  });

  it("keeps its middle through repeated zooming", async function () {
    await openEditor();
    const start = await tap(0.5, 0.5);
    for (let step = 0; step < 20; step++) await browser.keys("z");
    await waitForStatus("Zoomed out");
    const end = await tap(0.5, 0.5);
    expect(Math.abs(end.x - start.x)).toBeLessThanOrEqual(1);
    // Where the window limits the zoom to a width of no whole number of
    // pixels, as an 803-pixel surface in a 768-pixel window does, rounding
    // moved the middle a pixel each time: the view alone, a hundred times.
    const middle = await browser.execute(() => {
      const view = new window.inklineTest.view.InkView(createEl("canvas"));
      view.resize(803, 1);
      const before = view.center;
      for (let round = 0; round < 100; round++) {
        view.heightLimit = 768 * 0.55;
        view.magnified = true;
        view.resize(803, 1);
        view.magnified = false;
        view.resize(803, 1);
      }
      return { before, after: view.center };
    });
    expect(middle.after).toBe(middle.before);
  });

  it("measures and previews the ink as a save crops it, however far away its erasers go", async function () {
    const result = await browser.execute(async () => {
      const { view, canvas, record } = window.inklineTest;
      const surface = createEl("canvas");
      document.body.append(surface);
      try {
        const dot = (x: number, tool: "pen" | "eraser", size: number) => ({
          tool,
          size: size * record.unitsPerPixel,
          points: [x * record.unitsPerPixel, 100 * record.unitsPerPixel],
        });
        /** What the view and a save make of a document, as the editor shows it. */
        const compare = async (
          strokes: ReturnType<typeof dot>[],
          fontSize: number,
        ) => {
          const document = { strokes };
          const ink = new view.InkView(surface);
          const xs = strokes.map((stroke) => (stroke.points[0] ?? 0) / 16);
          ink.fit(Math.min(...xs), Math.max(...xs));
          ink.resize(803, 1);
          ink.render(document, undefined, undefined);
          const preview = createEl("canvas");
          ink.drawPreview(preview, fontSize);
          const context = preview.getContext("2d");
          if (context === null) throw new Error("no context");
          const { data } = context.getImageData(
            0,
            0,
            preview.width,
            preview.height,
          );
          // Ink in the first and the last tenth of the preview's columns.
          const inkIn = (from: number, to: number) => {
            for (let y = 0; y < preview.height; y++) {
              for (let x = from; x < to; x++) {
                if ((data[(y * preview.width + x) * 4 + 3] ?? 0) > 0) {
                  return true;
                }
              }
            }
            return false;
          };
          const tenth = Math.max(1, Math.floor(preview.width / 10));
          let total = 0;
          for (let index = 3; index < data.length; index += 4) {
            total += data[index] ?? 0;
          }
          const saved = await canvas.saveInk(document, undefined, []);
          return {
            image: ink.image,
            saved: { left: saved.left, width: saved.width },
            any: inkIn(0, preview.width),
            total,
            size: [preview.width, preview.height],
            alpha: Array.from(
              { length: data.length / 4 },
              (_, pixel) => data[pixel * 4 + 3] ?? 0,
            ).join(","),
            first: inkIn(0, tenth),
            last: inkIn(preview.width - tenth, preview.width),
          };
        };
        return {
          // A pen dot, and a tiny eraser a quarter of a million pixels away.
          distant: await compare(
            [dot(100, "pen", 10), dot(-262144, "eraser", 1)],
            16,
          ),
          // Two dots far apart, at a size whose preview height is fractional.
          apart: await compare([dot(100, "pen", 10), dot(2100, "pen", 10)], 17),
          // Three small dots with the middle one erased by a larger eraser,
          // and the two that are left alone.
          erased: await compare(
            [
              dot(50, "pen", 6),
              dot(100, "pen", 6),
              dot(150, "pen", 6),
              dot(100, "eraser", 12),
            ],
            17,
          ),
          left: await compare([dot(50, "pen", 6), dot(150, "pen", 6)], 17),
        };
      } finally {
        surface.remove();
      }
    });
    for (const [name, found] of Object.entries(result)) {
      // The edges the view shows are where a save crops.
      expect([name, found.image.left]).toEqual([name, found.saved.left]);
      expect([name, found.image.right - found.image.left]).toEqual([
        name,
        found.saved.width,
      ]);
    }
    expect(result.distant.any).toBe(true);
    expect([result.apart.first, result.apart.last]).toEqual([true, true]);
    // An erased dot leaves nothing behind in the preview, pixel for pixel,
    // as in a save.
    expect(result.erased.size).toEqual(result.left.size);
    expect(result.erased.alpha).toBe(result.left.alpha);
  });

  // A scroll bar below the zoomed drawing area shows where the view is, and
  // moves it along, while the drawing reaches past the view (#446 §5).
  describe("the scroll bar", function () {
    /** Draws a stroke across most of the usual view, wider than Zoom shows. */
    async function drawWide(): Promise<void> {
      await draw([
        [0.08, 0.5],
        [0.5, 0.5],
        [0.92, 0.5],
      ]);
      await browser.waitUntil(async () => (await storedDrafts()).length === 1);
    }

    it("shows only while zoomed and the drawing reaches past the view", async function () {
      await openEditor();
      const usual = await surfaceSize();
      // Out of Zoom, no row.
      expect((await scrollBar()).height).toBe(0);
      // A short stroke the zoomed view shows whole: the row, with no bar.
      await draw([
        [0.45, 0.5],
        [0.55, 0.5],
      ]);
      await browser.waitUntil(async () => (await storedDrafts()).length === 1);
      await browser.keys("z");
      await waitForStatus("Zoomed in");
      await framesDrawn();
      const row = await scrollBar();
      expect(row.height).toBeGreaterThan(0);
      expect(row.shown).toBe(false);
      expect(row.hidden).toBe("true");
      // One reaching past both sides of the view: the bar, with a thumb as
      // much shorter than its track as the view is narrower than the drawing.
      await draw([
        [0.02, 0.6],
        [0.98, 0.6],
      ]);
      await browser.waitUntil(async () => (await scrollBar()).shown);
      const bar = await scrollBar();
      // Its row kept its height as the bar came.
      expect(bar.height).toBe(row.height);
      expect(bar.hidden).toBeNull();
      expect(bar.role).toBe("scrollbar");
      expect(bar.orientation).toBe("horizontal");
      expect(bar.controlsSurface).toBe(true);
      expect(bar.focusable).toBe(false);
      // In the middle of what it spans, as the view is.
      expect(Number(bar.value)).toBeGreaterThan(30);
      expect(Number(bar.value)).toBeLessThan(70);
      const thumb = bar.thumb.right - bar.thumb.left;
      const track = bar.track.right - bar.track.left;
      expect(thumb).toBeGreaterThan(0);
      expect(thumb).toBeLessThan(track * 0.9);
      await saveScreenshot("zoom-scroll-bar");
      // Zoomed out, the row goes, and the drawing area is as it was.
      await browser.keys("z");
      await waitForStatus("Zoomed out");
      await browser.waitUntil(
        async () => Math.abs((await surfaceSize()).height - usual.height) < 1,
      );
      expect((await scrollBar()).height).toBe(0);
    });

    it("moves along the drawing as its thumb is dragged and its track pressed", async function () {
      await openEditor();
      await drawWide();
      await browser.keys("z");
      await waitForStatus("Zoomed in");
      await browser.waitUntil(async () => (await scrollBar()).shown);
      const across = await shownAcross();
      const start = await tap(0.5, 0.5);
      const before = await scrollBar();
      const track = before.track.right - before.track.left;
      const thumb = before.thumb.right - before.thumb.left;
      // The thumb is to the track as the view is to what the bar spans.
      const span = (across * track) / thumb;
      const middle = (before.thumb.top + before.thumb.bottom) / 2;
      const grab = Math.round((before.thumb.left + before.thumb.right) / 2);
      await mouseDrag(
        { x: grab, y: Math.round(middle) },
        { x: grab + 40, y: Math.round(middle) },
      );
      // The focus stays on the drawing area, for its keys.
      expect(await surfaceFocused()).toBe(true);
      const dragged = await tap(0.5, 0.5);
      const expected = (40 * (span - across)) / (track - thumb);
      expect(Math.abs(dragged.x - start.x - expected)).toBeLessThanOrEqual(2);
      // A press on the track brings the thumb's middle there, as far as it
      // goes: here, to the end of what the bar spans.
      const end = await scrollBar();
      await clickAt({
        x: Math.round(end.track.right - 2),
        y: Math.round(middle),
      });
      await browser.waitUntil(async () => (await scrollBar()).value === "100");
      const atEnd = await scrollBar();
      expect(Math.abs(atEnd.thumb.right - atEnd.track.right)).toBeLessThan(1);
      await clickAt({
        x: Math.round(end.track.left + 2),
        y: Math.round(middle),
      });
      await browser.waitUntil(async () => (await scrollBar()).value === "0");
      // The wheel over the bar moves along too, as over the drawing area.
      const left = await tap(0.5, 0.5);
      const { width } = await surfaceSize();
      // From the window's corner, as with no origin.
      await browser
        .action("wheel")
        .scroll({
          x: Math.round((end.track.left + end.track.right) / 2),
          y: Math.round(middle),
          deltaX: 0,
          deltaY: 100,
        })
        .perform();
      const wheeled = await tap(0.5, 0.5);
      expect(
        Math.abs(wheeled.x - left.x - (100 / width) * across),
      ).toBeLessThanOrEqual(1.5);
    });

    // The bar comes as the wheel takes the view past the drawing during a
    // stroke, in a row that was there all along, so that the drawing area
    // stays where it is under the pointer (#427), and the stroke goes on to
    // the pointer (#393).
    it("comes during a stroke without moving the drawing area", async function () {
      await openEditor();
      await browser.keys("z");
      await waitForStatus("Zoomed in");
      const from = await inWindow(0.4, 0.65);
      const to = await inWindow(0.6, 0.35);
      await drag(from, to);
      await strokeAt(1);
      await framesDrawn();
      expect((await scrollBar()).shown).toBe(false);
      await watchTops();
      const released = await dragWatched(from, to, { wheel: 600 });
      expect(released.inked).toBe(true);
      await strokeAt(2);
      const seen = await tops();
      expect(seen.at(-1)?.type).toBe("pointerup");
      expect(new Set(seen.map(({ top }) => top)).size).toBe(1);
      expect((await scrollBar()).shown).toBe(true);
    });

    it("takes Obsidian's scroll bar colours, in light and dark themes", async function () {
      const themes = await browser.execute(() =>
        Array.from(document.body.classList).filter(
          (name) => name === "theme-light" || name === "theme-dark",
        ),
      );
      try {
        await openEditor();
        await drawWide();
        await browser.keys("z");
        await waitForStatus("Zoomed in");
        await browser.waitUntil(async () => (await scrollBar()).shown);
        // Away from the thumb, which takes another colour under the pointer.
        await mouseTo({ x: 1, y: 1 }).perform();
        const colours: string[] = [];
        for (const theme of ["theme-light", "theme-dark"]) {
          const seen = await browser.execute(async (wanted) => {
            document.body.classList.remove("theme-light", "theme-dark");
            document.body.classList.add(wanted);
            const thumb = document.querySelector(
              ".inkline-editor .inkline-scroll-thumb",
            );
            if (!(thumb instanceof HTMLElement)) throw new Error("no thumb");
            // The colour the theme gives its own scroll bars' thumbs.
            const probe = document.createElement("div");
            probe.style.backgroundColor = "var(--scrollbar-thumb-bg)";
            document.body.append(probe);
            await new Promise((resolve) => requestAnimationFrame(resolve));
            const own = getComputedStyle(probe).backgroundColor;
            probe.remove();
            return { thumb: getComputedStyle(thumb).backgroundColor, own };
          }, theme);
          expect(seen.thumb).toBe(seen.own);
          expect(seen.thumb).not.toBe("rgba(0, 0, 0, 0)");
          colours.push(seen.thumb);
          await saveScreenshot(`zoom-scroll-bar-${theme}`);
        }
        expect(colours[0]).not.toBe(colours[1]);
      } finally {
        await browser.execute((restore) => {
          document.body.classList.remove("theme-light", "theme-dark");
          document.body.classList.add(...restore);
        }, themes);
      }
    });
  });
});
