// Makes the version 1 golden files of test/fixtures/format: it saves each
// drawing of records.ts with the real save, in Obsidian's Chromium, so that a
// file's pixels are what its record draws, and writes the files to the output
// directory's `golden` folder. It sits outside the ordinary suite's specs/
// glob, as its result is files to check in, not a check of the plugin.
//
//   OBSIDIAN_VERSIONS=latest/latest npm run test:e2e:docker -- \
//     --spec test/e2e/manual/fixtures.e2e.ts
//
// Then copy the files into test/fixtures/format, and add their hashes to
// test/fixtures/pinned.sha256. From the first stable release the files in there
// never change: a new case gets a new drawing and new files.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { browser, expect } from "@wdio/globals";
import { encodePng } from "../../support/png.ts";
import {
  goldenFiles,
  goldenImages,
  goldenText,
  iTxtData,
  type GoldenImage,
} from "../../fixtures/format/records.ts";
import { loadModules, toBase64 } from "../support/browser.ts";
import { outputDirectory } from "../support/harness.ts";

const root = path.resolve(import.meta.dirname, "../../..");
const output = path.join(
  outputDirectory(process.env.E2E_OUTPUT_DIR, root),
  "golden",
);

/** A golden base layer's image: grey ink with its alpha. */
function baseImage({ side, alpha }: GoldenImage): Uint8Array {
  const data = new Uint8Array(side * side * 4);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      data.set([126, 126, 126, alpha(x, y)], (y * side + x) * 4);
    }
  }
  return encodePng({ width: side, height: side, data });
}

describe("The golden files", function () {
  before(async function () {
    await loadModules();
    await mkdir(output, { recursive: true });
  });

  for (const [name, drawing] of Object.entries(goldenFiles)) {
    it(`saves ${name}`, async function () {
      const image = goldenImages[name];
      const text = Object.entries(goldenText[name] ?? {}).map(
        ([keyword, value]) => [...iTxtData(keyword, value)],
      );
      const saved = await browser.execute(
        async (strokes, place, png, chunks) => {
          const { canvas, record } = window.inklineTest;
          const bytes = Uint8Array.from(atob(png), (char) =>
            char.charCodeAt(0),
          );
          const layer = place === null ? undefined : { ...place, png: bytes };
          const document =
            layer === undefined ? { strokes } : { strokes, base: layer };
          const base =
            layer === undefined ? undefined : await canvas.drawableBase(layer);
          const file = await canvas.saveInk(
            document,
            base,
            chunks.map((data) => ({
              chunk: { type: "iTXt", data: Uint8Array.from(data) },
              afterData: false,
            })),
          );
          return {
            text: record.serializeRecord(file.record),
            file: record.toBase64(file.bytes),
          };
        },
        drawing.strokes,
        drawing.base ?? null,
        image === undefined ? "" : toBase64(baseImage(image)),
        text,
      );
      await writeFile(
        path.join(output, `${name}.ink.png`),
        Buffer.from(saved.file, "base64"),
      );
      await writeFile(path.join(output, `${name}.json`), `${saved.text}\n`);
      expect(saved.text.length).toBeGreaterThan(0);
    });
  }
});
