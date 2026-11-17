// Steps for a canvas and its cards in end-to-end tests.

import { browser } from "@wdio/globals";
import { click, placeOf, settled, type Point } from "./pointer.ts";

/**
 * Fits the active canvas's cards to its window, once they have drawn their
 * symbols: a canvas opens where it was last left, and a smaller window can
 * leave them out of sight.
 */
export async function fitCards(): Promise<void> {
  await browser
    .$(".canvas-node img.inkline-symbol", { strict: false })
    .waitForExist();
  await browser.waitUntil(async () =>
    browser.execute(() =>
      Array.from(
        document.querySelectorAll<HTMLImageElement>(".canvas-node img"),
      ).every((image) => image.complete),
    ),
  );
  const fit = browser.$(
    '.workspace-leaf.mod-active .canvas-controls [aria-label*="fit" i]',
  );
  try {
    await fit.waitForExist({ timeout: 3000 });
  } catch (error) {
    const labels = await browser.execute(() =>
      Array.from(document.querySelectorAll(".canvas-controls *"))
        .map((item) => item.getAttribute("aria-label"))
        .filter((label) => label !== null),
    );
    throw new Error(`no fit control in ${labels.join(", ")}`, { cause: error });
  }
  await fit.click();
  await placeOf(".canvas-node img.inkline-symbol");
}

/** Opens the canvas at `path`, with its cards in sight and none focused. */
export async function openCanvas(path: string): Promise<void> {
  await browser.executeObsidian(async ({ app }, file) => {
    const found = app.vault.getFileByPath(file);
    if (found === null) throw new Error(`no ${file}`);
    const leaf = app.workspace.getLeaf(false);
    await leaf.openFile(found);
    app.workspace.setActiveLeaf(leaf, { focus: true });
  }, path);
  await fitCards();
  await leaveCards();
}

/** Clicks the canvas beside its cards, which ends any selection or editing. */
export async function leaveCards(): Promise<void> {
  const blank = await browser.execute(() => {
    const wrapper = document.querySelector(
      ".workspace-leaf.mod-active .canvas-wrapper",
    );
    if (wrapper === null) throw new Error("no canvas");
    const box = wrapper.getBoundingClientRect();
    return { x: Math.round(box.x + 30), y: Math.round(box.y + 30) };
  });
  await click(blank);
  await browser.waitUntil(async () =>
    browser.execute(
      () =>
        document.querySelector(
          ".canvas-node.is-focused, .canvas-node.is-selected",
        ) === null,
    ),
  );
}

/** The middle of the last `selector` in the card whose text holds `card`. */
export async function placeInCard(
  card: string,
  selector: string,
): Promise<Point> {
  return settled(
    () =>
      browser.execute(
        (text, wanted) => {
          const card = Array.from(
            document.querySelectorAll(".canvas-node"),
          ).find((node) => node.textContent.includes(text));
          const found = Array.from(card?.querySelectorAll(wanted) ?? []).at(-1);
          if (found === undefined) return null;
          const box = found.getBoundingClientRect();
          return {
            x: Math.round(box.x + box.width / 2),
            y: Math.round(box.y + box.height / 2),
          };
        },
        card,
        selector,
      ),
    `${selector} in the card with ${card}`,
  );
}

/** Puts the cursor at `text` in the card's editor. */
export async function cursorInCard(text: string): Promise<void> {
  await browser.waitUntil(async () =>
    browser.executeObsidian(({ app }, wanted) => {
      const editor = app.workspace.activeEditor?.editor;
      if (editor === undefined) return false;
      const at = editor.getValue().indexOf(wanted);
      if (at === -1) return false;
      editor.focus();
      editor.setCursor(editor.offsetToPos(at));
      return true;
    }, text),
  );
}

/**
 * The middle of `selector` in the card's editor, in the window's pixels: the
 * editor is a document of its own, in a frame the canvas can scale.
 */
export async function placeInCardEditor(selector: string): Promise<Point> {
  return settled(
    () =>
      browser.execute((wanted) => {
        const frame = document.querySelector<HTMLIFrameElement>(
          ".canvas-node.is-editing iframe",
        );
        const found = frame?.contentDocument?.querySelector(wanted);
        if (frame === null || found === undefined || found === null) {
          return null;
        }
        const outer = frame.getBoundingClientRect();
        const box = found.getBoundingClientRect();
        const scale = outer.width / frame.offsetWidth;
        return {
          x: Math.round(outer.x + (box.x + box.width / 2) * scale),
          y: Math.round(outer.y + (box.y + box.height / 2) * scale),
        };
      }, selector),
    `${selector} in the card's editor`,
  );
}
