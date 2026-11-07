// Makes the pictures for Obsidian's community directory listing, as
// listing/README.md describes, from synthetic signs and notes: a screenshot of
// each main task at the 1200 by 800 pixels the listing asks for, and the icon
// from listing/icon.svg. It sits outside the ordinary suite's specs/ glob, as
// its result is pictures for a person to look at, not a check of the plugin.

import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import { defaultSettings } from "../../../src/settings.ts";
import type { Mark } from "../browser/pictures.ts";
import { loadModules } from "../support/browser.ts";
import {
  clickTop,
  draw,
  openAtMarker,
  startOver,
  surface,
  waitForEditor,
  waitForStatus,
} from "../support/editor.ts";
import { outputDirectory } from "../support/harness.ts";
import { saveScreenshot } from "../support/screenshots.ts";

const root = path.resolve(import.meta.dirname, "../../..");
const outputDir = outputDirectory(process.env.E2E_OUTPUT_DIR, root);

/** What the listing takes, in CSS pixels at a scale of one. */
const screen = { width: 1200, height: 800 };
/** The icon's side; the listing's form says nothing public about its size. */
const iconSide = 512;

type Point = readonly [number, number];
/** One stroke, as fractions of the sign's box across and down. */
type Path = readonly Point[];

/** `count` points along `at`, which takes a fraction of the way along. */
function along(count: number, at: (fraction: number) => Point): Path {
  return Array.from({ length: count + 1 }, (_, index) => at(index / count));
}

/** Part of an ellipse, from `start` to `end` turns clockwise from the right. */
function arc(
  [x, y]: Point,
  [across, down]: Point,
  start: number,
  end: number,
): Path {
  return along(32, (fraction) => {
    const angle = (start + (end - start) * fraction) * 2 * Math.PI;
    return [x + across * Math.cos(angle), y + down * Math.sin(angle)];
  });
}

/**
 * Straight lines through `points`, in the steps a hand makes: a stroke's width
 * follows its speed, so one of a few far-apart points would come out thin.
 */
function line(...points: Path): Path {
  return points.flatMap((point, index) => {
    const next = points[index + 1];
    if (next === undefined) return [point];
    const steps = Math.ceil(
      Math.hypot(next[0] - point[0], next[1] - point[1]) / 0.03,
    );
    return along(steps, (fraction): Point => [
      point[0] + (next[0] - point[0]) * fraction,
      point[1] + (next[1] - point[1]) * fraction,
    ]).slice(0, -1);
  });
}

/** A wavy line across the box at the height `y`. */
function wave(y: number): Path {
  return along(32, (fraction) => [
    0.04 + 0.92 * fraction,
    y + 0.1 * Math.sin(fraction * 3 * Math.PI),
  ]);
}

/** Invented signs, each a few strokes. */
const signs = {
  sun: [
    arc([0.5, 0.58], [0.3, 0.3], 0, 1),
    line([0.5, 0], [0.5, 0.14]),
    line([0.08, 0.14], [0.2, 0.26]),
    line([0.92, 0.14], [0.8, 0.26]),
  ],
  gate: [
    [
      ...line([0.14, 1], [0.14, 0.4]),
      ...arc([0.5, 0.4], [0.36, 0.38], 0.5, 1),
      ...line([0.86, 0.4], [0.86, 1]),
    ],
    line([0.14, 0.62], [0.86, 0.62]),
    line([0.5, 0.62], [0.5, 1]),
  ],
  water: [wave(0.2), wave(0.52), wave(0.84)],
  road: [
    line([0.1, 0.98], [0.46, 0.62], [0.22, 0.4], [0.64, 0.04]),
    line([0.58, 0.98], [0.94, 0.58]),
  ],
  stone: [
    line([0.5, 0.04], [0.96, 0.96], [0.04, 0.96], [0.5, 0.04]),
    line([0.5, 0.44], [0.5, 0.74]),
  ],
  speak: [
    arc([0.42, 0.5], [0.38, 0.46], 0.14, 0.86),
    line([0.5, 0.5], [0.98, 0.5]),
    line([0.76, 0.3], [0.76, 0.7]),
  ],
} as const satisfies Record<string, readonly Path[]>;

/** The signs in `names`, side by side, as marks for a picture to trace. */
function inscription(names: readonly (keyof typeof signs)[]): readonly Mark[] {
  const size = 92;
  const pen = 9;
  return names.flatMap((name, index) =>
    signs[name].flatMap((stroke) =>
      stroke.map(([x, y]) => ({
        x: Math.round(40 + index * 130 + x * size),
        y: Math.round(24 + y * size),
        width: pen,
        height: pen,
        colour: "#3b2f24",
      })),
    ),
  );
}

const notes = {
  "The east tablet.md": [
    "Copied from the third floor. These signs are on every door, and no font has them, so each is a small drawing that sits in the line like a letter.",
    "",
    "## Transcription",
    "",
    "![[sun.ink.png]]![[gate.ink.png]] ![[water.ink.png]]![[road.ink.png]]![[stone.ink.png]] ![[sun.ink.png]]![[speak.ink.png]]",
    "",
    "## Working reading",
    "",
    "- ![[sun.ink.png]] **sun**, or perhaps _day_: above every east door.",
    "- ![[gate.ink.png]] **gate**: only on doors that open.",
    "- ![[water.ink.png]] **water**: on the fountain in the first hall.",
    "- ![[road.ink.png]] **road**: where a passage forks.",
    "",
    "With those guesses, the line says that the ![[sun.ink.png]] opens the ![[gate.ink.png]], and that the ![[water.ink.png]] follows the ![[road.ink.png]] to the ![[stone.ink.png]]. The last sign is still a mystery: ![[speak.ink.png]] might mean to speak.",
    "",
  ].join("\n"),
  "The fountain.md": [
    "The basin repeats two signs from the east tablet: ![[water.ink.png]] and ![[gate.ink.png]]. Below them is one more that I have seen before.",
    "",
    "Reading so far: the ![[water.ink.png]] leaves by the ![[gate.ink.png]] HERE",
    "",
  ].join("\n"),
  "Signs in every style.md": [
    "A sign takes the size and colour of the text around it, in any theme.",
    "",
    "# ![[sun.ink.png]] In a large heading",
    "",
    "## ![[gate.ink.png]] In a smaller heading",
    "",
    "> [!warning] ![[stone.ink.png]] In a callout",
    "> Doors marked ![[gate.ink.png]] and ![[stone.ink.png]] stay shut.",
    "",
    "> [!tip] ![[water.ink.png]] In another colour",
    "> The ![[water.ink.png]] sign is always beside a fountain.",
    "",
    "In **bold ![[road.ink.png]]**, and in ==a highlight ![[speak.ink.png]]==.",
    "",
  ].join("\n"),
};

/** Saves the signs, as the editor would, and the notes that use them. */
async function makeVault(): Promise<void> {
  await browser.executeObsidian(
    async ({ app }, drawn, texts) => {
      for (const [name, strokes] of Object.entries(drawn)) {
        const { bytes } = await window.inklineTest.canvas.saveInk(
          {
            strokes: strokes.map((stroke) => ({
              tool: "pen" as const,
              size: 192,
              points: stroke.flatMap(([x, y]) => [
                Math.round(160 + x * 1400),
                Math.round(620 + y * 1680),
              ]),
            })),
          },
          undefined,
          [],
        );
        await app.vault.createBinary(`${name}.ink.png`, bytes.slice().buffer);
      }
      for (const [name, text] of Object.entries(texts)) {
        await app.vault.create(name, text);
      }
    },
    signs,
    notes,
  );
  // The library counts uses from the link index, which follows a moment later.
  await browser.waitUntil(async () =>
    browser.executeObsidian(
      ({ app }) =>
        app.metadataCache.resolvedLinks["The east tablet.md"]?.[
          "speak.ink.png"
        ] !== undefined,
    ),
  );
}

async function theme(name: "moonstone" | "obsidian"): Promise<void> {
  await browser.executeObsidian(({ app }, chosen) => {
    const change: unknown = Reflect.get(app, "changeTheme");
    if (typeof change !== "function") throw new Error("no themes");
    Reflect.apply(change, app, [chosen]);
  }, name);
}

/** Shows `file`, with the file list out of the way, in `mode`. */
async function show(file: string, mode: "preview" | "source"): Promise<void> {
  await browser.executeObsidian(
    async ({ app }, wanted, chosen) => {
      const note = app.vault.getFileByPath(wanted);
      if (note === null) throw new Error(`no ${wanted}`);
      const leaf = app.workspace.getLeaf(false);
      await leaf.openFile(note, {
        active: true,
        state: { mode: chosen, source: false },
      });
      app.workspace.leftSplit.collapse();
    },
    file,
    mode,
  );
}

async function waitForReading(): Promise<void> {
  await browser.waitUntil(async () =>
    browser.execute(
      () =>
        document.querySelectorAll(
          ".workspace-leaf.mod-active .markdown-reading-view img.inkline-symbol",
        ).length > 0,
    ),
  );
}

/** Takes a screenshot, once nothing is passing, and checks it fits the form. */
async function shoot(name: string): Promise<void> {
  await browser.$(".notice").waitForExist({ reverse: true });
  // A transition still running would differ from one run to the next.
  await browser.execute(async () => {
    await Promise.allSettled(
      document
        .getAnimations()
        .filter(
          (animation) =>
            animation.effect?.getComputedTiming().iterations !== Infinity,
        )
        .map((animation) => animation.finished),
    );
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          resolve();
        });
      });
    });
  });
  await saveScreenshot(name);
  const run = `${browser.getObsidianVersion()}-${browser.getObsidianInstallerVersion()}`;
  const bytes = readFileSync(
    path.join(outputDir, "screenshots", run, `${name}.png`),
  );
  expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([
    screen.width,
    screen.height,
  ]);
}

/** Closes the editor without saving what it holds. */
async function discard(): Promise<void> {
  await browser.keys(["Escape"]);
  await clickTop("Discard");
  await browser.$(".inkline-editor").waitForExist({ reverse: true });
}

describe("The listing's pictures", function () {
  before(async function () {
    await startOver();
    await browser.executeObsidian(async ({ plugins }, defaults) => {
      await plugins.inkline.saveData(defaults);
    }, defaultSettings);
    await obsidianPage.disablePlugin("inkline");
    await obsidianPage.enablePlugin("inkline");
    await loadModules();
    // Whatever size the window manager gives the window, the page lays out
    // and shoots at this one.
    await browser.sendCommand("Emulation.setDeviceMetricsOverride", {
      ...screen,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await browser.waitUntil(async () =>
      browser.execute((width) => window.innerWidth === width, screen.width),
    );
    await makeVault();
  });

  after(async function () {
    await browser.sendCommand("Emulation.clearDeviceMetricsOverride", {});
    await startOver();
  });

  it("renders the icon", async function () {
    const svg = readFileSync(path.join(root, "listing/icon.svg"), "utf8");
    const encoded = await browser.execute(
      async (text, side) => {
        const image = new Image();
        image.src = `data:image/svg+xml;base64,${btoa(text)}`;
        await image.decode();
        const canvas = new OffscreenCanvas(side, side);
        const context = canvas.getContext("2d");
        if (context === null) throw new Error("no 2D canvas context");
        context.drawImage(image, 0, 0, side, side);
        const blob = await canvas.convertToBlob({ type: "image/png" });
        const bytes = new Uint8Array(await blob.arrayBuffer());
        return btoa(String.fromCharCode(...bytes));
      },
      svg,
      iconSide,
    );
    const directory = path.join(outputDir, "screenshots");
    await mkdir(directory, { recursive: true });
    await writeFile(
      path.join(directory, "listing-icon.png"),
      Buffer.from(encoded, "base64"),
    );
  });

  it("shows symbols in a note, and where the library finds them", async function () {
    await theme("obsidian");
    await show("The east tablet.md", "preview");
    await waitForReading();
    await browser.executeObsidianCommand("inkline:show-library");
    await browser.$(".inkline-library-list").waitForExist();
    const row = browser.$(
      `//div[contains(@class, "inkline-library-symbol")][.//div[contains(@class, "inkline-library-name")][text()="water"]]`,
    );
    await row.$(".inkline-library-uses").waitForClickable();
    await row.$(".inkline-library-uses").click();
    await browser.waitUntil(
      async () => (await row.$$(".inkline-library-note").length) === 3,
    );
    await shoot("listing-1-reading");
  });

  it("offers symbols by name while typing", async function () {
    await theme("moonstone");
    await show("The fountain.md", "source");
    await openAtMarker("The fountain.md", "HERE");
    await browser.keys([";", ";"]);
    await browser.$(".suggestion-container").waitForExist();
    await shoot("listing-2-suggest");
    await browser.keys(["Escape"]);
  });

  it("draws a symbol on the line's guides", async function () {
    await theme("obsidian");
    await browser.executeObsidianCommand("inkline:insert-symbol");
    await waitForEditor();
    for (const stroke of signs.road) {
      await draw(stroke.map(([x, y]) => [0.42 + x * 0.16, 0.22 + y * 0.46]));
    }
    await browser.$(".inkline-editor .inkline-name").setValue("road");
    await surface().moveTo({ xOffset: 330, yOffset: 110 });
    await shoot("listing-3-drawing");
    await discard();
  });

  it("traces a pasted picture and turns it into ink", async function () {
    await theme("moonstone");
    await browser.executeObsidianCommand("inkline:insert-symbol");
    await waitForEditor();
    await browser.execute(
      async (marks) => {
        await window.inklineTest.pictures.copyPicture(
          440,
          140,
          "#f1e7d0",
          marks,
        );
      },
      inscription(["gate", "sun", "stone"]),
    );
    await browser.keys(["Control", "v"]);
    await waitForStatus("Tracing over the picture");
    await browser.keys(["i"]);
    await browser.$('[data-inkline-button="apply"]').waitForDisplayed();
    await shoot("listing-4-tracing");
    await discard();
  });

  it("follows the size and colour of the text", async function () {
    await show("Signs in every style.md", "preview");
    await waitForReading();
    await browser.executeObsidian(({ app }) => {
      app.workspace.rightSplit.collapse();
    });
    await shoot("listing-5-text");
  });
});
