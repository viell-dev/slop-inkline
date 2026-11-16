import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { browser } from "@wdio/globals";
import { outputDirectory } from "./harness.ts";

const outputDir = outputDirectory(
  process.env.E2E_OUTPUT_DIR,
  path.resolve(import.meta.dirname, "../../.."),
);

/** Where this run's screenshots go, made if it is not there yet. */
async function screenshotFile(name: string): Promise<string> {
  const run = `${browser.getObsidianVersion()}-${browser.getObsidianInstallerVersion()}`;
  const directory = path.join(outputDir, "screenshots", run);
  await mkdir(directory, { recursive: true });
  return path.join(directory, `${name}.png`);
}

/**
 * Saves a screenshot of the Obsidian window under
 * `screenshots/<app version>-<installer version>/<name>.png` in the output
 * directory. The screenshots this saves are artifacts for review, never
 * assertions.
 */
export async function saveScreenshot(
  name: string,
  element?: ReturnType<typeof browser.$>,
): Promise<void> {
  const file = await screenshotFile(name);
  if (element === undefined) await browser.saveScreenshot(file);
  else await element.saveScreenshot(file);
}

/**
 * Saves a screenshot already taken, as `browser.takeScreenshot()` gives it,
 * where {@link saveScreenshot} would save it: for the artifact of a test that
 * measures a screenshot to be the very frame it measured.
 */
export async function saveScreenshotData(
  name: string,
  png: string,
): Promise<void> {
  await writeFile(await screenshotFile(name), Buffer.from(png, "base64"));
}

/** What {@link waitForPaint} waits for, besides what it always does. */
export interface PaintWait {
  /** The images to be loaded and decoded, and their masks, by selector. */
  readonly images?: string;
  /** The theme the body is to have, as Obsidian's `theme-` classes say. */
  readonly theme?: "light" | "dark";
}

/** How long {@link waitForPaint} waits, as `waitforTimeout` would. */
const paintTimeout = 20_000;

/**
 * Waits until a screenshot of the active window would show what the page now
 * holds, for a test that measures its pixels: the body in `theme`, every image
 * `images` finds loaded and decoded, and the pictures its CSS masks name too;
 * no CSS animation or transition running that ends; then two animation frames
 * in a row in which nothing in the body changed and the images' boxes stayed
 * where they were; then two frames more, so that a frame showing that state
 * has been drawn. Animations that never end, such as a blinking caret, go on
 * running, as they did before any screenshot.
 */
export async function waitForPaint(wanted: PaintWait = {}): Promise<void> {
  const failure = await browser.execute(
    async ({ images, theme }, timeout) => {
      const doc = activeDocument;
      const win = doc.defaultView ?? window;
      const until = performance.now() + timeout;
      const frame = () =>
        new Promise<void>((resolve) => {
          win.requestAnimationFrame(() => {
            resolve();
          });
        });
      const seen = { changed: false };
      const observer = new MutationObserver(() => {
        seen.changed = true;
      });
      observer.observe(doc.body, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
      });
      const decoded = new Map<string, Promise<boolean>>();
      /** Whether the picture at `url` loads and decodes. */
      const decodes = (url: string): Promise<boolean> => {
        let done = decoded.get(url);
        if (done === undefined) {
          const probe = new Image();
          probe.src = url;
          done = probe.decode().then(
            () => true,
            () => false,
          );
          decoded.set(url, done);
        }
        return done;
      };
      /** Whether the page is ready to be drawn, and the images' boxes. */
      const read = async (): Promise<{ ready: boolean; state: string }> => {
        if (
          theme !== undefined &&
          !doc.body.classList.contains(`theme-${theme}`)
        ) {
          return {
            ready: false,
            state: `the body is not in the ${theme} theme`,
          };
        }
        const boxes: string[] = [];
        const found =
          images === undefined ? [] : Array.from(doc.querySelectorAll(images));
        for (const image of found) {
          if (!image.instanceOf(HTMLImageElement)) {
            return { ready: false, state: "the images include a non-image" };
          }
          if (
            !image.complete ||
            image.naturalWidth === 0 ||
            !(await image.decode().then(
              () => true,
              () => false,
            ))
          ) {
            return {
              ready: false,
              state: `an image is not decoded: ${image.src}`,
            };
          }
          const style = win.getComputedStyle(image);
          const mask =
            style.getPropertyValue("mask-image") ||
            style.getPropertyValue("-webkit-mask-image");
          for (const [, url] of mask.matchAll(/url\("?([^")]*)"?\)/g)) {
            if (url !== undefined && !(await decodes(url))) {
              return { ready: false, state: `a mask does not decode: ${url}` };
            }
          }
          const box = image.getBoundingClientRect();
          boxes.push(
            [box.left, box.top, box.width, box.height].map(String).join(" "),
          );
        }
        return { ready: true, state: boxes.join(", ") };
      };
      /** The animations and transitions running that will end. */
      const ending = () =>
        doc
          .getAnimations()
          .filter(
            (animation) =>
              animation.playState === "running" &&
              animation.effect?.getComputedTiming().endTime !== Infinity,
          );
      try {
        let last: string | undefined;
        let quiet = 0;
        while (quiet < 2) {
          if (performance.now() > until) {
            return `the page did not settle: ${last ?? "nothing read"}`;
          }
          await frame();
          const animations = ending();
          if (animations.length > 0) {
            await Promise.race([
              Promise.allSettled(
                animations.map(async (animation) => animation.finished),
              ),
              new Promise((resolve) =>
                win.setTimeout(resolve, until - performance.now()),
              ),
            ]);
            quiet = 0;
            last = undefined;
            continue;
          }
          const now = await read();
          // What changed while it was read counts too.
          const still = !seen.changed && now.ready && now.state === last;
          seen.changed = false;
          last = now.state;
          quiet = still ? quiet + 1 : 0;
        }
        await frame();
        await frame();
        return null;
      } finally {
        observer.disconnect();
      }
    },
    wanted,
    paintTimeout,
  );
  if (failure !== null) throw new Error(failure);
}

/** A part of the window, in CSS pixels from its top left corner. */
export interface Clip {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Saves the part of the window in `clip`, drawn at `scale` times its size so
 * that it stays sharp on a screen of high density, where
 * {@link saveScreenshot} would save it. For a picture of a part smaller than
 * any one element, such as the guide's of the library's rows.
 */
export async function saveClip(
  name: string,
  clip: Clip,
  scale = 2,
): Promise<void> {
  const shot: unknown = await browser.sendCommandAndGetResult(
    "Page.captureScreenshot",
    {
      format: "png",
      clip: { ...clip, scale },
    },
  );
  const data =
    typeof shot === "object" && shot !== null && "data" in shot
      ? shot.data
      : undefined;
  if (typeof data !== "string") throw new Error("no screenshot data");
  await writeFile(await screenshotFile(name), Buffer.from(data, "base64"));
}
