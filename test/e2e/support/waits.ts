// Waits in end-to-end tests: for a condition, with a failure that says what
// it last saw, and for the frames the editor draws.

import { browser } from "@wdio/globals";

/**
 * Waits for `condition` as `browser.waitUntil` does, and if it times out,
 * fails with the message `say` makes then. A `timeoutMsg` given to waitUntil
 * itself is made before the wait starts, so it cannot tell what the wait
 * last saw: use this for any message that names something the wait reads
 * (#281, #337). If `say` fails too, the timeout is still what is reported.
 */
export async function waitOrSay(
  condition: () => Promise<boolean>,
  say: () => string | Promise<string>,
): Promise<void> {
  try {
    await browser.waitUntil(condition);
  } catch (error) {
    const message = await Promise.resolve()
      .then(say)
      .catch(
        (failed: unknown) =>
          `the wait timed out, and its state was not read: ${String(failed)}`,
      );
    throw new Error(message, { cause: error });
  }
}

/**
 * Waits for the window to draw two frames. What was done before that asked
 * for a frame, as a change to the editor's view does, has then been drawn:
 * it draws in the first, and the second comes once the first is done. A
 * check that something was not drawn waits for this first, so that it does
 * not look too early.
 *
 * `thenTask` also waits for a task after each frame, for work that a frame
 * leaves to run once it ends.
 */
export async function framesDrawn({
  thenTask = false,
}: { thenTask?: boolean } = {}): Promise<void> {
  await browser.execute(async (task) => {
    for (let count = 0; count < 2; count++) {
      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => {
          if (task) window.setTimeout(resolve, 0);
          else resolve();
        });
      });
    }
  }, thenTask);
}
