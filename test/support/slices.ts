// Work done in slices, for tests of what it does and of where it can pause.

import { vi } from "vitest";

/**
 * Runs `work` with a clock that finds every slice over at every look, so that
 * it pauses wherever it can, however fast the machine is, and returns what it
 * made and how many times it paused.
 */
export async function paused<T>(
  work: (pause: () => Promise<void>) => Promise<T>,
): Promise<{ result: T; pauses: number }> {
  let now = 0;
  const clock = vi.spyOn(performance, "now").mockImplementation(() => {
    now += 1000;
    return now;
  });
  let pauses = 0;
  try {
    const result = await work(() => {
      pauses += 1;
      return Promise.resolve();
    });
    return { result, pauses };
  } finally {
    clock.mockRestore();
  }
}

/** Bytes that compress hardly at all, the same every time. */
export function noise(length: number): Uint8Array<ArrayBuffer> {
  let seed = 7;
  return Uint8Array.from({ length }, () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed >>> 24;
  });
}
