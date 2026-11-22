// Checks that reading a long text takes linear time, against linear work timed
// in the same run, so that what slows the machine slows both, for tests that
// bound a reader's time without trusting the wall clock alone (#403).

import { expect } from "vitest";

/** How long `work` takes, in ms. */
function timed(work: () => unknown): number {
  const start = performance.now();
  work();
  return performance.now() - start;
}

/**
 * Goes through `text` 64 times, one character at a time, and gives back a hash
 * of what it read: a linear amount of work. 64 is `stepsPerChar` in
 * `src/notes/inline.ts`, the steps reading a paragraph may take for each of
 * its characters.
 */
export function simplePasses(text: string): number {
  let hash = 0;
  for (let pass = 0; pass < 64; pass++) {
    for (let index = 0; index < text.length; index++) {
      hash = (Math.imul(hash, 31) + text.charCodeAt(index)) | 0;
    }
  }
  return hash;
}

/**
 * That `read`, a reading of `text`, takes less than `times` as long as the
 * fastest of three runs of {@link simplePasses} over it. A reading that a pause
 * of the machine's slowed is tried again, up to three times in all; one more
 * than three times past the limit is not, as no pause of the machine's comes
 * near that, so that a real regression reports at once rather than after
 * minutes.
 */
export function expectLinear(
  text: string,
  read: () => unknown,
  times: number,
): void {
  const hashes = new Set<number>();
  const linear = Math.min(
    ...[0, 1, 2].map(() =>
      timed(() => {
        hashes.add(simplePasses(text));
      }),
    ),
  );
  // The passes agree, and what they give back is used, so that none of their
  // work can be left out.
  expect(hashes.size).toBe(1);
  const limit = times * linear;
  let reading = timed(read);
  for (let run = 1; run < 3 && reading >= limit && reading < 3 * limit; run++) {
    reading = Math.min(reading, timed(read));
  }
  expect(
    reading,
    `a reading of ${reading.toFixed(0)} ms, against ${linear.toFixed(0)} ms for the simple passes`,
  ).toBeLessThan(limit);
}
