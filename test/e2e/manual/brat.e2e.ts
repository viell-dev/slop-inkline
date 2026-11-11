// Explicit check of installing and updating through BRAT, outside the ordinary
// suite's specs/ glob: it needs BRAT's own release and network access to GitHub,
// and drives BRAT's real dialogs against the published releases, with no token.
// Start the host with BRAT's three release files through E2E_PLUGIN_DIR.
// E2E_BRAT_LATEST names the highest published release, and E2E_BRAT_START an
// older one to update from. Missing or impossible versions fail before any
// request, by the rules of test/support/updates.ts, and versions that are not
// published, or a latest that is not the highest, before BRAT's requests,
// rather than silently skipping this check or spending GitHub's requests.
//
// What an update keeps goes by E2E_BRAT_START alone, as in update.e2e.ts. From
// 0.9.2 on, the file format is final, and an update keeps the drawing's
// strokes and an open drawing's draft as well as its pixels, note and
// preferences. From an earlier release it keeps the pixels, note and
// preferences: the symbol opens as a picture to draw over, and the draft is
// dropped, as the owner decided in #144.
import { createHash } from "node:crypto";
import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import { browser, expect } from "@wdio/globals";
import type { Plugin } from "obsidian";
import { obsidianPage } from "wdio-obsidian-service";
import {
  bratPublishedProblems,
  bratVersionProblems,
  keepsStrokesFrom,
  noStrokes,
} from "../../support/updates.ts";
import { loadModules } from "../support/browser.ts";
import {
  clickTop,
  draw,
  noteText,
  openAtMarker,
  recordOf,
  symbolFiles,
  waitForEditor,
  waitForNotice,
  waitForStatus,
} from "../support/editor.ts";
import { saveScreenshot } from "../support/screenshots.ts";

declare module "wdio-obsidian-service" {
  interface InstalledPlugins {
    obsidian42Brat: Plugin & {
      settings: {
        pluginSubListFrozenVersion: { repo: string; version: string }[];
      };
      saveSettings(): Promise<void>;
    };
  }
}

const repository = "viell-dev/slop-inkline";
const latest = process.env.E2E_BRAT_LATEST;
const start = process.env.E2E_BRAT_START;
const problems = bratVersionProblems(latest, start);
if (problems.length > 0 || latest === undefined || start === undefined) {
  throw new Error(problems.join("\n"));
}
const keepsStrokes = keepsStrokesFrom(start);

/** What a drawing and its preferences are saved as. */
interface Kept {
  readonly drawing: string;
  readonly preferences: string;
  readonly text: string;
}

/** Reads `url` through the host, as BRAT does. */
async function download(url: string): Promise<string> {
  return browser.executeObsidian(
    async ({ obsidian }, address) => (await obsidian.requestUrl(address)).text,
    url,
  );
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** The version of Inkline running in the host, if one is. */
async function loadedVersion(): Promise<string | null> {
  return browser.executeObsidian(({ plugins }) =>
    "inkline" in plugins ? plugins.inkline.manifest.version : null,
  );
}

/** What BRAT tracks Inkline as: `latest`, or a version it holds to. */
async function trackedVersion(): Promise<string | undefined> {
  return browser.executeObsidian(
    ({ plugins }, repo) =>
      plugins.obsidian42Brat.settings.pluginSubListFrozenVersion.find(
        (entry) => entry.repo === repo,
      )?.version,
    repository,
  );
}

/** The directory the host keeps Inkline's files in. */
async function pluginFolder(): Promise<string> {
  const location = await browser.executeObsidian(({ app, obsidian }) => {
    if (!(app.vault.adapter instanceof obsidian.FileSystemAdapter))
      throw new Error("This check requires a desktop test vault");
    return {
      vault: app.vault.adapter.getBasePath(),
      config: app.vault.configDir,
    };
  });
  const vault = realpathSync(location.vault);
  if (!vault.startsWith("/tmp/"))
    throw new Error("This check only uses disposable Linux test vaults");
  return path.join(vault, location.config, "plugins", "inkline");
}

/** Logs the addresses that the host's requests go to, until a reload. */
async function recordRequests(): Promise<void> {
  await browser.executeObsidian(({ require: load }) => {
    interface Ipc {
      send(channel: string, ...args: unknown[]): void;
    }
    const { ipcRenderer } = load("electron") as { ipcRenderer: Ipc };
    const send = ipcRenderer.send.bind(ipcRenderer);
    const requests: string[] = [];
    Object.assign(window, { inklineBratRequests: requests });
    ipcRenderer.send = (channel, ...args) => {
      for (const arg of args) {
        if (typeof arg === "object" && arg !== null && "url" in arg) {
          requests.push(String(arg.url));
        }
      }
      send(channel, ...args);
    };
  });
}

/** The requests logged since {@link recordRequests}, which it then forgets. */
async function recordedRequests(): Promise<string[]> {
  return browser.execute(() => {
    const { inklineBratRequests: requests } = window as unknown as {
      inklineBratRequests: string[];
    };
    return requests.splice(0);
  });
}

/** Chooses `version`, or `latest`, in BRAT's list of versions. */
async function chooseVersion(version: string): Promise<void> {
  const chooser = browser.$("button.brat-version-selector");
  await chooser.waitForClickable();
  await chooser.click();
  await browser.$(".prompt-input").setValue(version);
  await browser.keys("Enter");
  await browser.$(".prompt-input").waitForExist({ reverse: true });
}

/** Adds Inkline to BRAT through its dialog, tracking `version`. */
async function addThroughBrat(version: string): Promise<void> {
  await browser.executeObsidianCommand("obsidian42-brat:AddBetaPlugin");
  await browser.$(".brat-full-width-input").setValue(repository);
  // BRAT lists the versions once the field loses focus.
  await browser.keys("Tab");
  await chooseVersion(version);
  await saveScreenshot(`brat-add-${version}`);
  await browser.$(".brat-modal button.mod-cta").click();
  await browser.$(".brat-modal").waitForExist({ reverse: true });
}

/**
 * Leaves BRAT as it would be for someone who added Inkline as the latest
 * version when `start` was the highest release: choosing the latest version in
 * its dialog now would install it at once, rather than as an update.
 */
async function trackLatest(): Promise<void> {
  await browser.executeObsidian(async ({ plugins }, repo) => {
    const { obsidian42Brat: brat } = plugins;
    const entry = brat.settings.pluginSubListFrozenVersion.find(
      (candidate) => candidate.repo === repo,
    );
    if (entry === undefined) throw new Error("BRAT does not track Inkline");
    entry.version = "latest";
    await brat.saveSettings();
  }, repository);
}

/** Runs BRAT's update command and waits for it to finish. */
async function updateThroughBrat(): Promise<void> {
  await browser.execute(() => {
    for (const notice of document.querySelectorAll(".notice")) notice.remove();
  });
  await browser.executeObsidianCommand(
    "obsidian42-brat:checkForUpdatesAndUpdate",
  );
  await waitForNotice("Checking for plugin updates COMPLETED");
}

/** Checks that the installed files are the release's, as BRAT writes them. */
async function expectReleaseFiles(version: string): Promise<void> {
  const base = `https://github.com/${repository}/releases/download/${version}`;
  const sums = await download(`${base}/SHA256SUMS`);
  const published: unknown = JSON.parse(
    await download(`${base}/manifest.json`),
  );
  const folder = await pluginFolder();
  for (const name of ["main.js", "styles.css"]) {
    expect(sums).toContain(
      `${sha256(readFileSync(path.join(folder, name)))}  ${name}`,
    );
  }
  // BRAT writes the manifest again, with the same values.
  const manifest: unknown = JSON.parse(
    readFileSync(path.join(folder, "manifest.json"), "utf8"),
  );
  expect(manifest).toEqual(published);
}

/** Checks that BRAT downloaded the release's three plugin files, and no more. */
async function expectDownloads(version: string): Promise<void> {
  const prefix = `https://github.com/${repository}/releases/download/`;
  const downloads = (await recordedRequests()).filter((url) =>
    url.startsWith(prefix),
  );
  expect(new Set(downloads)).toEqual(
    new Set(
      ["main.js", "manifest.json", "styles.css"].map(
        (name) => `${prefix}${version}/${name}`,
      ),
    ),
  );
}

/** Draws and saves a symbol, and saves a preference. */
async function drawAndKeep(): Promise<Kept> {
  await openAtMarker("Editor.md", "HERE");
  await browser.executeObsidianCommand("inkline:insert-symbol");
  await waitForEditor();
  await draw([
    [0.3, 0.3],
    [0.5, 0.7],
    [0.7, 0.3],
  ]);
  await browser.keys(["Control", "Enter"]);
  await browser.$(".inkline-editor").waitForExist({ reverse: true });
  expect(await symbolFiles()).toEqual(["001.ink.png"]);
  await browser.waitUntil(async () =>
    (await noteText()).includes("![[001.ink.png]]"),
  );
  await browser.executeObsidian(async ({ plugins }) => {
    const stored: unknown = await plugins.inkline.loadData();
    await plugins.inkline.saveData({
      ...(typeof stored === "object" && stored !== null ? stored : {}),
      brushSize: 3,
    });
  });
  return readKept();
}

async function readKept(): Promise<Kept> {
  const folder = await pluginFolder();
  return {
    drawing: sha256(
      readFileSync(path.join(folder, "..", "..", "..", "001.ink.png")),
    ),
    preferences: readFileSync(path.join(folder, "data.json"), "utf8"),
    text: await noteText(),
  };
}

/** How many drafts the host's storage lists, as any release so far keeps them. */
async function keptDrafts(): Promise<number> {
  // Read as stored: the checkout's own DraftStore would drop an earlier
  // release's drafts as it read them.
  return browser.executeObsidian(({ app }) => {
    const ids: unknown = app.loadLocalStorage("inkline-drafts");
    return Array.isArray(ids) ? ids.length : 0;
  });
}

/**
 * Checks the drawing, note and preference, then edits with what was saved:
 * the strokes, or, from a release before the final format, the picture.
 */
async function expectKept(kept: Kept, stage: string): Promise<void> {
  expect(await readKept()).toEqual(kept);
  await browser.executeObsidian(async ({ app, plugins }) => {
    const file = app.vault.getFileByPath("001.ink.png");
    if (file === null) throw new Error("The drawing disappeared");
    await plugins.inkline.editSymbol(file);
  });
  await waitForEditor();
  if (keepsStrokes) {
    expect(await browser.$(".inkline-status").getText()).not.toContain(
      noStrokes,
    );
  } else {
    await waitForStatus(noStrokes);
  }
  expect(
    await browser
      .$('[data-inkline-button="size-3"]')
      .getAttribute("aria-pressed"),
  ).toBe("true");
  await saveScreenshot(`brat-${stage}`);
  await browser.keys("Escape");
  await browser.$(".inkline-editor").waitForExist({ reverse: true });
}

describe("Installing and updating through BRAT", function () {
  this.timeout(240_000);

  before(async function () {
    const limits = JSON.parse(
      await download("https://api.github.com/rate_limit"),
    ) as { resources: { core: { remaining: number } } };
    const { remaining } = limits.resources.core;
    // A run on both Obsidian versions makes about 34 of them.
    if (remaining < 50) {
      throw new Error(
        `GitHub allows ${String(remaining)} more unauthenticated requests this hour; wait for its limit to reset`,
      );
    }
    // Every release fits on the page for many years yet.
    const releases = JSON.parse(
      await download(
        `https://api.github.com/repos/${repository}/releases?per_page=100`,
      ),
    ) as { tag_name: string }[];
    const published = bratPublishedProblems(
      latest,
      start,
      releases.map((release) => release.tag_name),
    );
    if (published.length > 0) throw new Error(published.join("\n"));
  });

  it("installs the highest release as the latest version", async function () {
    await recordRequests();
    await addThroughBrat("latest");
    await browser.waitUntil(async () => (await loadedVersion()) === latest);
    expect(await trackedVersion()).toBe("latest");
    await expectDownloads(latest);
    await expectReleaseFiles(latest);
    expect(readdirSync(await pluginFolder()).sort()).toEqual([
      "main.js",
      "manifest.json",
      "styles.css",
    ]);
    await updateThroughBrat();
    expect(await loadedVersion()).toBe(latest);
    await saveScreenshot("brat-latest-installed");
    // Uninstalling, which turns a plugin off and deletes its folder, is not
    // enough while BRAT still lists the repository.
    const folder = await pluginFolder();
    await obsidianPage.disablePlugin("inkline");
    rmSync(folder, { recursive: true });
    await updateThroughBrat();
    expect(existsSync(path.join(folder, "main.js"))).toBe(true);
    expect(await loadedVersion()).toBeNull();
  });

  it("holds a chosen version until it follows the latest again", async function () {
    await browser.reloadObsidian({ vault: "test/e2e/vaults/basic" });
    await recordRequests();
    await addThroughBrat(start);
    await browser.waitUntil(async () => (await loadedVersion()) === start);
    expect(await trackedVersion()).toBe(start);
    await expectDownloads(start);
    await expectReleaseFiles(start);
    const kept = await drawAndKeep();
    await updateThroughBrat();
    expect(await loadedVersion()).toBe(start);
    await addThroughBrat("latest");
    await browser.waitUntil(async () => (await loadedVersion()) === latest);
    expect(await trackedVersion()).toBe("latest");
    await expectReleaseFiles(latest);
    await expectKept(kept, "changed-version");
  });

  it("updates a release it follows, keeping the drawing and preference", async function () {
    await browser.reloadObsidian({ vault: "test/e2e/vaults/basic" });
    await addThroughBrat(start);
    await browser.waitUntil(async () => (await loadedVersion()) === start);
    const kept = await drawAndKeep();
    await trackLatest();
    await recordRequests();
    await updateThroughBrat();
    await browser.waitUntil(async () => (await loadedVersion()) === latest);
    await expectDownloads(latest);
    await expectReleaseFiles(latest);
    await expectKept(kept, "updated");
    await obsidianPage.disablePlugin("inkline");
    await obsidianPage.enablePlugin("inkline");
    expect(await loadedVersion()).toBe(latest);
    await expectKept(kept, "updated-reloaded");
  });

  it(`updates at startup, ${keepsStrokes ? "keeping an open drawing as a draft" : `dropping the draft ${start} kept`}`, async function () {
    await browser.reloadObsidian({ vault: "test/e2e/vaults/basic" });
    await addThroughBrat(start);
    await browser.waitUntil(async () => (await loadedVersion()) === start);
    await trackLatest();
    // Enabled for the next start too, once Obsidian has saved that.
    await browser.waitUntil(
      async () =>
        readFileSync(
          path.join(await pluginFolder(), "..", "..", "community-plugins.json"),
          "utf8",
        ).includes('"inkline"'),
      { timeoutMsg: "Obsidian did not save that Inkline is enabled" },
    );
    // BRAT looks for updates a minute after each start of Obsidian.
    await browser.refresh();
    await browser.waitUntil(async () => (await loadedVersion()) === start);
    // A plugin loads before Obsidian has read the vault's files.
    await browser.waitUntil(async () =>
      browser.executeObsidian(
        ({ app }) => app.vault.getFileByPath("Editor.md") !== null,
      ),
    );
    await openAtMarker("Editor.md", "HERE");
    await browser.executeObsidianCommand("inkline:insert-symbol");
    await waitForEditor();
    await draw([
      [0.3, 0.3],
      [0.5, 0.7],
      [0.7, 0.3],
    ]);
    await browser.waitUntil(async () => (await keptDrafts()) > 0, {
      timeoutMsg: `${start} kept no draft of the drawing`,
    });
    await browser.waitUntil(async () => (await loadedVersion()) === latest, {
      timeout: 90_000,
    });
    await browser.$(".inkline-editor").waitForExist({ reverse: true });
    await saveScreenshot("brat-updated-at-startup");
    await browser.executeObsidianCommand("inkline:insert-symbol");
    if (!keepsStrokes) {
      // No question about the draft: the editor opens at once, with nothing
      // in it, as Esc then closes it without asking.
      await waitForEditor();
      expect(await browser.$$(".modal-container").length).toBe(1);
      await saveScreenshot("brat-draft-dropped");
      await browser.keys("Escape");
      await browser.$(".inkline-editor").waitForExist({ reverse: true });
      expect(await symbolFiles()).toEqual([]);
      return;
    }
    await clickTop("Restore");
    await waitForEditor();
    await saveScreenshot("brat-draft-restored");
    await browser.keys(["Control", "Enter"]);
    await browser.$(".inkline-editor").waitForExist({ reverse: true });
    expect(await symbolFiles()).toEqual(["001.ink.png"]);
    await loadModules();
    const record = JSON.parse(await recordOf("001.ink.png")) as {
      strokes: unknown[];
    };
    expect(record.strokes).toHaveLength(1);
  });
});
