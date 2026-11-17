// Waits whose failures say what they last saw, in end-to-end tests.

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
