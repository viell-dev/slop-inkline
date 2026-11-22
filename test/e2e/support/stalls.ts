// The wait before Inkline says that a save or a rename is waiting for
// Obsidian, in end-to-end tests. Users have five seconds, file-writes.ts's
// `stalledAfter`; a test that waits it out shortens it on the running plugin,
// and checks that the message comes sooner than the users' wait would let it.

import { browser } from "@wdio/globals";
import type { ChainablePromiseElement } from "webdriverio";
import { stalledAfter } from "../../../src/notes/file-writes.ts";

/**
 * The wait, in milliseconds, that a test of what is said of a save or a
 * rename that waits for Obsidian gives the plugin. A test that checks that
 * nothing is said yet does so well inside it, even on a busy machine, as it
 * would not be at one second (#320).
 */
export const shortStall = 2000;

/**
 * Has the running plugin say that a save or a rename waits for Obsidian once
 * it has waited `wait` milliseconds, from the next one that starts. It lasts
 * until the plugin loads again, which starts from the users' wait, or until
 * `startOver()` in support/editor.ts puts that back.
 */
export async function setStalledAfter(wait: number): Promise<void> {
  await browser.executeObsidian(({ plugins }, after) => {
    plugins.inkline.stalledAfter = after;
  }, wait);
}

/**
 * Waits for `line` to say that a save or a rename waits for Obsidian, and
 * returns what it says. The test asked for the save or rename at `since`, a
 * `Date.now()` from just before it did, with the plugin's wait shortened to
 * {@link shortStall}: the line must say so before the users' wait,
 * {@link stalledAfter}, has passed since then. So a watch that the shorter
 * wait does not reach fails the test, rather than only slowing it.
 */
export async function waitForStallSaid(
  line: () => ChainablePromiseElement,
  since: number,
): Promise<string> {
  let said = "";
  try {
    await browser.waitUntil(
      async () => {
        said = await line().getText();
        return said !== "";
      },
      // At least one look, however long the test took to get here.
      { timeout: Math.max(since + stalledAfter - Date.now(), 1) },
    );
  } catch (error) {
    throw new Error(
      `nothing was said of a wait ${String(Date.now() - since)} ms after the test asked, with the plugin's wait at ${String(shortStall)} ms and the users' at ${String(stalledAfter)} ms`,
      { cause: error },
    );
  }
  return said;
}
