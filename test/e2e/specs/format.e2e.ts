import { readFile } from "node:fs/promises";
import path from "node:path";
import { browser, expect } from "@wdio/globals";
import type { InkRecord } from "../../../src/format/record.ts";
import { loadModules, toBase64 } from "../support/browser.ts";

const fixtures = path.resolve(import.meta.dirname, "../../fixtures/format");

describe("The file format in Obsidian's renderer", function () {
  before(async function () {
    await loadModules();
  });

  it("stops inflating within a few slices of the limit", async function () {
    const result = await browser.execute(async () => {
      const { png } = window.inklineTest;
      // 64 MiB of zeros, about 64 KiB compressed.
      const compressed = await png.deflate(new Uint8Array(64 * 1024 * 1024));
      let consumed = 0;
      try {
        await png.inflate(compressed, {
          limit: 1024 * 1024,
          onInput: (bytes) => (consumed = bytes),
        });
        return { refused: false, consumed, length: compressed.length };
      } catch (error) {
        return {
          refused: true,
          consumed,
          length: compressed.length,
          message: String(error),
        };
      }
    });
    expect(result.refused).toBe(true);
    expect(result.message).toContain("data expands beyond 1048576 bytes");
    // A 1 KiB slice of zeros inflates to about 1 MiB, so the limit is passed
    // within a few slices.
    expect(result.consumed).toBeLessThanOrEqual(4 * 1024);
    expect(result.length).toBeGreaterThan(32 * 1024);
  });

  for (const name of ["v1-strokes", "v1-base"]) {
    it(`reads the golden file ${name}`, async function () {
      const bytes = await readFile(path.join(fixtures, `${name}.ink.png`));
      const expected = await readFile(
        path.join(fixtures, `${name}.json`),
        "utf8",
      );
      const text = await browser.execute(async (base64: string) => {
        const { inkFile, record } = window.inklineTest;
        const data = Uint8Array.from(atob(base64), (char) =>
          char.charCodeAt(0),
        );
        const source = await inkFile.readInkFile(data);
        return source.kind === "record"
          ? `${record.serializeRecord(source.record)}\n`
          : JSON.stringify(source);
      }, toBase64(bytes));
      expect(text).toBe(expected);
    });
  }

  it("adds a record to a PNG the canvas encodes and reads it back", async function () {
    const result = await browser.execute(async () => {
      const { inkFile, png, record } = window.inklineTest;
      const canvas = new OffscreenCanvas(8, 12);
      const context = canvas.getContext("2d");
      if (context === null) throw new Error("no 2D context");
      context.fillStyle = "#7c7c7c";
      context.fillRect(2, 3, 4, 5);
      const encoded = new Uint8Array(
        await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer(),
      );
      const written: InkRecord = {
        box: { pxPerEm: 128, width: 8, height: 12, baseline: 9 },
        strokes: [
          { tool: "pen", size: 16, pressure: true, points: [32, 48, 200] },
        ],
      };
      const file = await inkFile.writeInkFile(encoded, written);
      const source = await inkFile.readInkFile(file);
      const pixels = (bytes: Uint8Array): string =>
        png
          .readChunks(bytes)
          .filter((chunk) => chunk.type === "IDAT")
          .map((chunk) => chunk.data.join(","))
          .join(";");
      return {
        types: png.readChunks(file).map((chunk) => chunk.type),
        read:
          source.kind === "record"
            ? record.serializeRecord(source.record)
            : JSON.stringify(source),
        expected: record.serializeRecord(written),
        samePixels: pixels(file) === pixels(encoded),
      };
    });
    expect(result.types.slice(0, 2)).toEqual(["IHDR", "iTXt"]);
    expect(result.types).toContain("IDAT");
    expect(result.read).toBe(result.expected);
    expect(result.samePixels).toBe(true);
  });
});
