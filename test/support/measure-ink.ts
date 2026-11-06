// Prints what Make ink makes of the pictures in ink-pictures.ts, by the code of
// a commit to compare with and by this checkout's:
//
//   node test/support/measure-ink.ts <commit> [pictures a group] [seed]
//
// It lists the pictures one by one, then counts the random pictures of each
// group, then moves the slider over every threshold of each: how many pictures
// make other ink than the commit did at any threshold, how many make more ink as
// it moves away from their ink, and how many have more partly covered pixels at
// any threshold than the commit gave them. Reading
// `src/ink/pixels.ts` from the commit keeps the comparison honest as the code
// moves on.

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as current from "../../src/ink/pixels.ts";
import {
  inkGrowth,
  inkPictures,
  madeInk,
  measureInk,
  randomGroups,
  sweepInk,
  type InkCode,
  type InkResult,
} from "./ink-pictures.ts";

/** `src/ink/pixels.ts` as `commit` has it. */
async function codeAt(commit: string): Promise<InkCode> {
  const source = execFileSync("git", ["show", `${commit}:src/ink/pixels.ts`], {
    encoding: "utf8",
  });
  // Its own imports still come from this checkout.
  const folder = new URL("../../src/ink/", import.meta.url);
  const rewritten = source.replace(
    /from "(\.\.?\/[^"]+)"/g,
    (_, path: string) => `from "${new URL(path, folder).href}"`,
  );
  const directory = mkdtempSync(join(tmpdir(), "inkline-measure-"));
  const file = join(directory, "pixels.ts");
  writeFileSync(file, rewritten);
  try {
    // eslint-disable-next-line no-unsanitized/method -- a file written just above from this repository's history
    return (await import(pathToFileURL(file).href)) as InkCode;
  } finally {
    rmSync(directory, { recursive: true });
  }
}

function percent(share: number): string {
  return `${(share * 100).toFixed(share > 0 && share < 0.1 ? 1 : 0)}%`;
}

function start({ threshold, light }: InkResult): string {
  return `${String(threshold)} ${light ? "light" : "dark"}`;
}

const [commit, count = "100", seed = "20261106"] = process.argv.slice(2);
if (commit === undefined) {
  console.error("usage: measure-ink.ts <commit> [pictures a group] [seed]");
  process.exit(1);
}
const before = await codeAt(commit);

console.log(
  "| Picture | Default before | after | Found before | after | Stray before | after | Partial before | after |",
);
console.log("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
let kind = "";
for (const picture of inkPictures()) {
  if (picture.kind !== kind) {
    kind = picture.kind;
    console.log(`| **${kind}** | | | | | | | | |`);
  }
  const was = measureInk(before, picture);
  const now = measureInk(current, picture);
  console.log(
    `| ${picture.name} | ${start(was)} | ${start(now)} | ${percent(was.found)} | ${percent(now.found)} | ${percent(was.stray)} | ${percent(now.stray)} | ${percent(was.partial)} | ${percent(now.partial)} |`,
  );
}

console.log();
console.log(`Random pictures, seed ${seed}, ${count} a group:`);
console.log();
console.log(
  "| Group | Ink wanted before | after | Default changed | Fixed | Harmed | Ink differs at any threshold | Grew on the slider before | after | Largest growth before | after | Softer anywhere |",
);
console.log(
  "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
);
for (const [group, pictures] of randomGroups(Number(count), Number(seed))) {
  let wasGood = 0;
  let nowGood = 0;
  let changed = 0;
  let fixed = 0;
  let harmed = 0;
  let grewBefore = 0;
  let grewAfter = 0;
  let mostBefore = 0;
  let mostAfter = 0;
  let softer = 0;
  let differs = 0;
  for (const picture of pictures()) {
    const was = measureInk(before, picture);
    const now = measureInk(current, picture);
    if (madeInk(was)) wasGood++;
    if (madeInk(now)) nowGood++;
    if (was.threshold !== now.threshold || was.light !== now.light) changed++;
    if (!madeInk(was) && madeInk(now)) fixed++;
    if (madeInk(was) && !madeInk(now)) harmed++;
    let grewThen = 0;
    let growsNow = 0;
    let anySofter = false;
    let anyDiffers = false;
    for (const light of [true, false]) {
      const then = sweepInk(before, picture, light);
      const here = sweepInk(current, picture, light);
      grewThen = Math.max(grewThen, inkGrowth(then.ink, light));
      growsNow = Math.max(growsNow, inkGrowth(here.ink, light));
      anySofter ||= here.partial.some(
        (value, at) => value > (then.partial[at] ?? 0),
      );
      anyDiffers ||= here.ink.some((value, at) => value !== then.ink[at]);
    }
    if (grewThen > 0) grewBefore++;
    if (growsNow > 0) grewAfter++;
    mostBefore = Math.max(mostBefore, grewThen);
    mostAfter = Math.max(mostAfter, growsNow);
    if (anySofter) softer++;
    if (anyDiffers) differs++;
  }
  console.log(
    `| ${group.name} | ${String(wasGood)} | ${String(nowGood)} | ${String(changed)} | ${String(fixed)} | ${String(harmed)} | ${String(differs)} | ${String(grewBefore)} | ${String(grewAfter)} | ${mostBefore.toFixed(1)} | ${mostAfter.toFixed(1)} | ${String(softer)} |`,
  );
}
