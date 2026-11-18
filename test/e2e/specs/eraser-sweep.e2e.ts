// The eraser takes away exactly what its brush sweeps, and what it took stays
// taken as it goes on (#341). A filled ellipse is erased freehand, along its
// edge, through it, across it, back on itself, and round a loop, and the
// drawing area is read back in every frame the editor draws while the pointer
// moves: no ink comes back outside the brush, the release changes nothing,
// what the record draws is what the last frame showed, and no ink is left
// within the brush's sweep or taken beyond it. test/e2e/manual/eraser-edge.e2e.ts
// measures the same for every brush size and speed.

import { browser, expect } from "@wdio/globals";
import { loadModules } from "../support/browser.ts";
import { recordOf, startOver } from "../support/editor.ts";
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
  type Doc,
  type PathName,
} from "../support/erasing.ts";
import { save } from "../support/editing.ts";
import { saveScreenshot, saveScreenshotData } from "../support/screenshots.ts";
import { framesDrawn } from "../support/waits.ts";

/** The middle of the loop path, which its brush never reaches. */
const island: Doc = [288, 96];
/** A point on the loop, which its brush passes over. */
const onLoop: Doc = [288, 66];

/** Erases along `way` slowly with brush `size`, and works out what moved. */
async function erase(
  way: PathName,
  label: (typeof sizes)[number]["label"],
  zoom: boolean,
  keep: readonly Doc[] = [],
) {
  const size = sizes.find((each) => each.label === label);
  if (size === undefined) throw new Error(`no size ${label}`);
  const { view, strokes } = await eraseFilledEllipse(zoom);
  await browser.keys([size.key]);
  await framesDrawn();
  await record();
  await drag(pointerPath(paths[way], view, speeds.slow), 8);
  await draftHolds(strokes + 1);
  const { picture, ...numbers } = await analyse(size.diameter, keep);
  if (typeof picture === "string") {
    await saveScreenshotData(
      `eraser-sweep-${way}-${label}-zoom-${zoom ? "on" : "off"}-frame`,
      picture,
    );
  }
  await saveScreenshot(
    `eraser-sweep-${way}-${label}-zoom-${zoom ? "on" : "off"}`,
    browser.$(".inkline-editor .inkline-surface"),
  );
  return { numbers, picture };
}

/** What every case must show, with its numbers in the failure. */
function expectSteady(numbers: Awaited<ReturnType<typeof erase>>["numbers"]) {
  const { way, ...shown } = numbers;
  console.log(JSON.stringify(shown), `from ${String(way.length / 2)} points`);
  expect(numbers).toMatchObject({
    kind: "fill",
    // No ink came back where the brush had taken it.
    returnedInside: 0,
    // The release, and the record, draw what the last frame showed.
    releaseChanged: 0,
    redrawChanged: 0,
    // Nothing shown erased came back by the end.
    restored: 0,
    // No ink inside the brush's circle, nor within its sweep, nor erased
    // beyond it, more than a pixel from its edge.
    underBrush: 0,
    missing: 0,
    extra: 0,
  });
  // Behind the brush, an edge pixel may change as much as antialiasing lets
  // two drawings of one shape differ, from rounding to whole units, but never
  // by half its ink. At the brush's own circle, which moves, it can more.
  expect(numbers.riseBehind).toBeLessThan(128);
  expect(numbers.frames).toBeGreaterThan(20);
}

describe("The eraser", function () {
  // Each case reads back hundreds of frames of the drawing area.
  this.timeout(5 * 60 * 1000);

  before(async function () {
    await loadModules();
    await browser.setTimeout({ script: 5 * 60 * 1000 });
  });

  beforeEach(async function () {
    await startOver();
  });

  it("keeps the edge it leaves along a curve where it is", async function () {
    expectSteady((await erase("edge-arc", "XL", false)).numbers);
  });

  it("keeps the edge it leaves rounding a corner where it is", async function () {
    expectSteady((await erase("inner-arc", "L", false)).numbers);
  });

  it("keeps the edge it leaves where it is, zoomed in", async function () {
    expectSteady((await erase("inner-arc", "XL", true)).numbers);
  });

  it("takes away exactly its brush's width across an edge", async function () {
    expectSteady((await erase("across", "M", false)).numbers);
  });

  it("takes away exactly its brush's width where it turns back", async function () {
    expectSteady((await erase("turning back", "L", false)).numbers);
  });

  it("leaves the ink a loop goes round, and saves what it showed", async function () {
    const { numbers } = await erase("loop", "M", false, [island, onLoop]);
    expectSteady(numbers);
    const [middle, ring] = numbers.kept;
    expect(middle?.before).toBeGreaterThanOrEqual(192);
    expect(middle?.after).toBeGreaterThanOrEqual(192);
    expect(ring?.before).toBeGreaterThanOrEqual(192);
    expect(ring?.after).toBeLessThan(64);
    // The file holds the area as the draft did, moved only by the crop.
    const [draft] = await browser.executeObsidian(({ app }) =>
      new window.inklineTest.drafts.DraftStore(app)
        .list()
        .map((each) => each.strokes.at(-1)?.points ?? []),
    );
    await save();
    const saved = JSON.parse(await recordOf("001.ink.png")) as {
      strokes: { tool: string; kind?: string; points: number[] }[];
    };
    const eraser = saved.strokes.at(-1);
    expect(eraser?.tool).toBe("eraser");
    expect(eraser?.kind).toBe("fill");
    const dx = (eraser?.points[0] ?? 0) - (draft?.[0] ?? 0);
    expect(Math.abs(dx % 16)).toBe(0);
    expect(eraser?.points).toEqual(
      draft?.map((value, at) => (at % 2 === 0 ? value + dx : value)),
    );
  });
});
