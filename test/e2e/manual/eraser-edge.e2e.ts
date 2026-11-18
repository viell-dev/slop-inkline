// Measures, for #341, whether the edge the eraser leaves moves as it goes. It
// draws a filled ellipse, erases across and along its edge, through it and
// round a loop in it, with each brush size, slowly and quickly, with Zoom off
// and on, and reads the drawing area's pixels back in every frame the editor
// draws while the pointer moves. It compares each frame with the one before,
// with the drawing after the release and a redraw of its record, and with the
// exact sweep of a round brush along the way the pointer went; for a smooth
// eraser stroke, as Inkline 1.0.0 saves, also with a redraw of its points so
// far. It sits outside the suite and asserts nothing: it writes its numbers
// to eraser-edge-<version>.json in the end-to-end output, and, under
// screenshots/<version>/, eraser-edge-<case>.png: the frame where most ink
// came back outside the brush, before and after, and what changed, red where
// ink came back and blue where it went, with the brush's circle in green.
// specs/eraser-sweep.e2e.ts asserts on a few of the same cases. Run it after
// `npm run build` with
// `npm run test:e2e:docker -- --spec test/e2e/manual/eraser-edge.e2e.ts`.

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { browser } from "@wdio/globals";
import { loadModules } from "../support/browser.ts";
import { startOver } from "../support/editor.ts";
import {
  analyse,
  draftHolds,
  drag,
  eraseFilledEllipse,
  paths,
  pointerPath,
  record,
  sizes,
  speeds,
  type Analysis,
} from "../support/erasing.ts";
import { outputDirectory } from "../support/harness.ts";
import { saveScreenshotData } from "../support/screenshots.ts";
import { framesDrawn } from "../support/waits.ts";

const root = path.resolve(import.meta.dirname, "../../..");
const outputDir = outputDirectory(process.env.E2E_OUTPUT_DIR, root);

describe("Erasing along an edge (#341)", function () {
  // Each Zoom setting takes 30 minutes or more on a busy machine.
  this.timeout(90 * 60 * 1000);
  const results: Record<string, Omit<Analysis, "picture" | "way">> = {};

  before(async function () {
    await loadModules();
    // Reading back hundreds of frames of a magnified surface takes a while.
    await browser.setTimeout({ script: 10 * 60 * 1000 });
  });

  beforeEach(async function () {
    await startOver();
  });

  after(async function () {
    const version = `${browser.getObsidianVersion()}-${browser.getObsidianInstallerVersion()}`;
    await writeFile(
      path.join(outputDir, `eraser-edge-${version}.json`),
      `${JSON.stringify(results, null, 2)}\n`,
    );
  });

  for (const zoom of [false, true]) {
    it(`erases along a filled ellipse's edge with Zoom ${zoom ? "on" : "off"}`, async function () {
      const { view: at, strokes } = await eraseFilledEllipse(zoom);
      for (const [pathName, way] of Object.entries(paths)) {
        for (const [speedName, step] of Object.entries(speeds)) {
          for (const size of sizes) {
            await browser.keys([size.key]);
            await framesDrawn();
            await record();
            await drag(pointerPath(way, at, step), 8);
            await draftHolds(strokes + 1);
            const {
              picture,
              way: _way,
              ...numbers
            } = await analyse(size.diameter, [], false);
            const name = `${pathName}-${speedName}-${size.label}-zoom-${zoom ? "on" : "off"}`;
            results[name] = numbers;
            console.log(name, JSON.stringify(numbers));
            if (typeof picture === "string") {
              await saveScreenshotData(`eraser-edge-${name}`, picture);
            }
            // Back to the whole ellipse.
            await browser.keys(["Control", "z"]);
            await draftHolds(strokes);
            await framesDrawn();
          }
        }
      }
    });
  }
});
