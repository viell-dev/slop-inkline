import { browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import { defaultSettings } from "../../../src/settings.ts";
import { loadModules } from "../support/browser.ts";
import {
  createSymbol,
  draw,
  guideRows,
  noteText,
  openAtMarker,
  settledSurface,
  startOver,
  waitForEditor,
  waitForNotice,
  waitForStatus,
} from "../support/editor.ts";
import { saveScreenshot } from "../support/screenshots.ts";

let mainWindow = "";

/** Opens the real settings tab, including Obsidian's separate settings window. */
async function openSettings(): Promise<void> {
  await browser.executeObsidianCommand("app:open-settings");
  await browser.waitUntil(
    async () => {
      for (const handle of await browser.getWindowHandles()) {
        await browser.switchToWindow(handle);
        if (await browser.$(".vertical-tab-nav-item=Inkline").isExisting())
          return true;
      }
      return false;
    },
    {
      timeout: 5000,
      timeoutMsg: "Inkline's settings tab did not open in any window",
    },
  );
  const tab = browser.$(".vertical-tab-nav-item=Inkline");
  await tab.waitForDisplayed();
  await tab.click();
  await setting("Insert trigger").waitForDisplayed();
}

/** The row of a setting, by its visible label. */
function setting(name: string): ReturnType<typeof browser.$> {
  return browser.$(
    `//div[contains(concat(' ', normalize-space(@class), ' '), ' setting-item ')][.//div[contains(@class, 'setting-item-name')][normalize-space(.)="${name}"]]`,
  );
}

async function closeSettings(): Promise<void> {
  const settingsWindow = await browser.getWindowHandle();
  if (settingsWindow !== mainWindow) {
    await browser.closeWindow();
    await browser.waitUntil(
      async () => !(await browser.getWindowHandles()).includes(settingsWindow),
    );
  } else {
    await browser.keys(["Escape"]);
  }
  await browser.switchToWindow(mainWindow);
  await browser.execute(() => {
    window.focus();
  });
  await browser.$(".vertical-tab-content").waitForExist({ reverse: true });
}

async function toggle(name: string): Promise<void> {
  await setting(name).$(".checkbox-container").click();
}

/** Waits for the preferences written to disk, not just the displayed control. */
async function waitForStored(expected: Record<string, unknown>): Promise<void> {
  await browser.waitUntil(async () => {
    const data = await browser.executeObsidian(async ({ plugins }) => {
      const stored: unknown = await plugins.inkline.loadData();
      return stored;
    });
    return (
      typeof data === "object" &&
      data !== null &&
      Object.entries(expected).every(
        ([key, value]) => Reflect.get(data, key) === value,
      )
    );
  });
}

describe("Inkline settings", function () {
  before(async function () {
    mainWindow = await browser.getWindowHandle();
  });

  beforeEach(async function () {
    for (const handle of await browser.getWindowHandles()) {
      if (handle === mainWindow) continue;
      await browser.switchToWindow(handle);
      await browser.closeWindow();
    }
    await browser.switchToWindow(mainWindow);
    await startOver();
    await obsidianPage.disablePlugin("inkline");
    await browser.executeObsidian(async ({ app }, defaults) => {
      await app.vault.adapter.write(
        `${app.vault.configDir}/plugins/inkline/data.json`,
        JSON.stringify(defaults),
      );
    }, defaultSettings);
    await obsidianPage.enablePlugin("inkline");
    await loadModules();
  });

  after(async function () {
    await startOver();
    // As in beforeEach, without the plugin, which the last test run may have
    // left off or loading.
    await obsidianPage.disablePlugin("inkline");
    await browser.executeObsidian(async ({ app }, defaults) => {
      await app.vault.adapter.write(
        `${app.vault.configDir}/plugins/inkline/data.json`,
        JSON.stringify(defaults),
      );
    }, defaultSettings);
    await obsidianPage.enablePlugin("inkline");
  });

  it("shows all five controls with their defaults", async function () {
    await openSettings();
    expect(await setting("Insert trigger").$("input").getValue()).toBe(";;");
    expect(await setting("Brush size").$("select").getValue()).toBe("1");
    expect(await setting("Symbol size").$("input").getValue()).toBe("100");
    // Pen pressure was removed with pen-device support (#101).
    expect(await setting("Pen pressure").isExisting()).toBe(false);
    for (const name of ["Text colour", "Guides"]) {
      expect(
        await setting(name).$(".checkbox-container").getAttribute("class"),
      ).toContain("is-enabled");
    }
    await saveScreenshot("settings");
    await closeSettings();
  });

  it("uses a changed trigger immediately and refuses an ordinary word", async function () {
    await createSymbol("gate.ink.png");
    await openSettings();
    await setting("Insert trigger").$("input").setValue("::");
    await waitForStored({ trigger: "::" });
    await setting("Insert trigger").$("input").setValue("word");
    await setting("Brush size").$("select").click();
    await closeSettings();
    await waitForStored({ trigger: "::" });
    await openAtMarker("Editor.md", "HERE");
    await browser.keys([";", ";", "g", "a"]);
    expect(await browser.$(".inkline-suggestion").isExisting()).toBe(false);
    await browser.executeObsidian(({ app, obsidian }) => {
      const editor = app.workspace.getActiveViewOfType(
        obsidian.MarkdownView,
      )?.editor;
      if (editor === undefined) throw new Error("no editor");
      editor.setValue("Read ");
      editor.setCursor({ line: 0, ch: 5 });
      editor.focus();
    });
    await browser.keys([":", ":", "g", "a"]);
    await browser.$(".inkline-suggestion-name=gate").waitForExist();
    await browser.keys(["Enter"]);
    await browser.waitUntil(
      async () => (await noteText()) === "Read ![[gate.ink.png]]",
    );
  });

  it("keeps drawing defaults across reload and applies them to a new editor", async function () {
    await openSettings();
    await setting("Brush size").$("select").selectByAttribute("value", "3");
    await toggle("Guides");
    await waitForStored({ brushSize: 3, guides: false });
    await closeSettings();
    await obsidianPage.disablePlugin("inkline");
    await obsidianPage.enablePlugin("inkline");
    await openAtMarker("Editor.md", "HERE");
    await browser.executeObsidianCommand("inkline:insert-symbol");
    await waitForEditor();
    await settledSurface();
    expect(
      await browser
        .$('[data-inkline-button="size-3"]')
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      await browser
        .$('[data-inkline-button="guides"]')
        .getAttribute("aria-pressed"),
    ).toBe("false");
    expect((await guideRows()).drawn).toBe(0);
    await draw(
      [
        [0.3, 0.3],
        [0.5, 0.7],
      ],
      "pen",
    );
    await browser.keys(["Control", "s"]);
    await waitForStatus("Saved");
    const strokes = await browser.executeObsidian(async ({ app }) => {
      const file = app.vault.getFileByPath("001.ink.png");
      if (file === null) throw new Error("no saved symbol");
      const opened = await window.inklineTest.canvas.openInk(
        new Uint8Array(await app.vault.readBinary(file)),
      );
      if (opened.kind !== "editable")
        throw new Error("saved symbol cannot be edited");
      return opened.document.strokes;
    });
    expect(strokes).toHaveLength(1);
    // A pen draws as a mouse does: pen pressure is no longer recorded (#101).
    expect(strokes[0]?.pressure).toBe(false);
  });

  it("applies size and stored colour to open notes while preserving explicit sizes", async function () {
    await createSymbol("gate.ink.png");
    await browser.executeObsidian(async ({ app }) => {
      const note = await app.vault.create(
        "Settings.md",
        "Plain ![[gate.ink.png]] and sized ![[gate.ink.png|24]].\n",
      );
      await app.workspace
        .getLeaf(false)
        .openFile(note, { state: { mode: "preview" } });
    });
    await browser.$(".markdown-reading-view img.inkline-symbol").waitForExist();
    const sizes = () =>
      browser.execute(() =>
        Array.from(
          document.querySelectorAll<HTMLImageElement>(
            ".markdown-reading-view img.inkline-symbol",
          ),
        ).map((image) => ({
          height: image.getBoundingClientRect().height,
          sized: image.hasAttribute("width") || image.hasAttribute("height"),
          mask: getComputedStyle(image).maskImage,
          objectPosition: getComputedStyle(image).objectPosition,
        })),
      );
    const before = await sizes();
    expect(before).toHaveLength(2);
    await openSettings();
    await setting("Symbol size").$("input").click();
    await browser.keys(["Home"]);
    // Native slider keys: 50%, then ten 5% steps to 100%, then ten to 150%.
    for (let step = 0; step < 20; step++) await browser.keys(["ArrowRight"]);
    await toggle("Text colour");
    await waitForStored({ symbolScale: 150, textColor: false });
    await closeSettings();
    const after = await sizes();
    for (let index = 0; index < before.length; index++) {
      const original = before[index];
      const changed = after[index];
      expect(changed?.height).toBeCloseTo(
        (original?.height ?? 0) * (original?.sized === true ? 1 : 1.5),
        0,
      );
      expect(changed?.mask).toBe("none");
      expect(changed?.objectPosition).toBe("50% 50%");
    }
    const first = await browser
      .$(".markdown-reading-view img.inkline-symbol")
      .getElement();
    await saveScreenshot("settings-stored-colour");
    const shot = await browser.takeElementScreenshot(first.elementId);
    const grey = await browser.execute(async (png) => {
      const bytes = Uint8Array.from(atob(png), (character) =>
        character.charCodeAt(0),
      );
      const image = await createImageBitmap(new Blob([bytes]));
      const { data } = window.inklineTest.canvas.readPixels(image);
      image.close();
      let count = 0;
      for (let pixel = 0; pixel < data.length; pixel += 4) {
        if (
          [0, 1, 2].every(
            (channel) => Math.abs((data[pixel + channel] ?? 0) - 126) <= 4,
          )
        )
          count++;
      }
      return count;
    }, shot);
    expect(grey).toBeGreaterThan(0);
    await obsidianPage.disablePlugin("inkline");
    expect(
      await browser.execute(() =>
        document.documentElement.style.getPropertyValue("--inkline-scale"),
      ),
    ).toBe("");
    expect(
      await browser.execute(() =>
        document.documentElement.hasClass("inkline-stored-color"),
      ),
    ).toBe(false);
  });

  it("applies display settings to new and existing popout windows", async function () {
    await createSymbol("gate.ink.png");
    await openSettings();
    await setting("Symbol size").$("input").click();
    await browser.keys(["End"]);
    await toggle("Text colour");
    await waitForStored({ symbolScale: 200, textColor: false });
    await closeSettings();
    await browser.executeObsidian(async ({ app }) => {
      const note = await app.vault.create(
        "Popout.md",
        "See ![[gate.ink.png]].\n",
      );
      await app.workspace
        .openPopoutLeaf()
        .openFile(note, { state: { mode: "preview" } });
    });
    const popoutState = () =>
      browser.executeObsidian(({ app }) => {
        const view = app.workspace
          .getLeavesOfType("markdown")
          .find((leaf) => leaf.view.containerEl.doc !== document)?.view;
        const doc = view?.containerEl.doc;
        const image = doc?.querySelector("img.inkline-symbol");
        return {
          scale: doc?.documentElement.style.getPropertyValue("--inkline-scale"),
          stored: doc?.documentElement.hasClass("inkline-stored-color"),
          mask:
            image === null || image === undefined
              ? undefined
              : doc?.defaultView?.getComputedStyle(image).maskImage,
        };
      });
    await browser.waitUntil(async () => (await popoutState()).mask === "none");
    expect(await popoutState()).toEqual({
      scale: "2",
      stored: true,
      mask: "none",
    });
    await openSettings();
    await setting("Symbol size").$("input").click();
    await browser.keys(["Home"]);
    await toggle("Text colour");
    await waitForStored({ symbolScale: 50, textColor: true });
    await closeSettings();
    const changed = await popoutState();
    expect(changed.scale).toBe("0.5");
    expect(changed.stored).toBe(false);
    expect(changed.mask).not.toBe("none");
    await browser.executeObsidian(({ app }) => {
      for (const leaf of app.workspace.getLeavesOfType("markdown")) {
        if (leaf.view.containerEl.doc !== document) leaf.detach();
      }
    });
    // Detaching the last leaf starts native window closure. Finish that
    // cleanup before the next test enumerates and switches to its windows.
    await browser.waitUntil(
      async () => {
        const handles = await browser.getWindowHandles();
        return handles.length === 1 && handles[0] === mainWindow;
      },
      { timeoutMsg: "the detached popout window did not close" },
    );
  });

  it("stores rapid changes in order when the first write is still pending", async function () {
    await openSettings();
    await browser.executeObsidian(({ plugins }) => {
      const plugin = plugins.inkline;
      const original = plugin.saveData.bind(plugin);
      Reflect.set(
        plugin,
        "inklineOriginalSaveData",
        plugin.saveData.bind(plugin),
      );
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      Reflect.set(plugin, "inklineReleaseSettings", release);
      let first = true;
      let finished = 0;
      Reflect.set(plugin, "inklineSettingsWrites", finished);
      plugin.saveData = async (data: unknown) => {
        if (first) {
          first = false;
          await gate;
        }
        await original(data);
        Reflect.set(plugin, "inklineSettingsWrites", ++finished);
      };
    });
    try {
      await toggle("Guides");
      await toggle("Text colour");
      await browser.executeObsidian(({ plugins }) => {
        const release: unknown = Reflect.get(
          plugins.inkline,
          "inklineReleaseSettings",
        );
        if (typeof release !== "function") throw new Error("no write gate");
        Reflect.apply(release, undefined, []);
      });
      await browser.waitUntil(async () =>
        browser.executeObsidian(
          ({ plugins }) =>
            Reflect.get(plugins.inkline, "inklineSettingsWrites") === 2,
        ),
      );
      await waitForStored({ guides: false, textColor: false });
    } finally {
      await browser.executeObsidian(({ plugins }) => {
        const plugin = plugins.inkline;
        const original: unknown = Reflect.get(
          plugin,
          "inklineOriginalSaveData",
        );
        if (typeof original !== "function")
          throw new Error("no saved saveData");
        const release: unknown = Reflect.get(plugin, "inklineReleaseSettings");
        if (typeof release === "function")
          Reflect.apply(release, undefined, []);
        Reflect.set(plugin, "saveData", original);
        Reflect.deleteProperty(plugin, "inklineOriginalSaveData");
        Reflect.deleteProperty(plugin, "inklineReleaseSettings");
        Reflect.deleteProperty(plugin, "inklineSettingsWrites");
      });
    }
    await closeSettings();
  });

  it("reports a failed settings write and allows the next change to persist", async function () {
    await openSettings();
    await browser.executeObsidian(({ plugins }) => {
      const plugin = plugins.inkline;
      Reflect.set(
        plugin,
        "inklineOriginalSaveData",
        plugin.saveData.bind(plugin),
      );
      plugin.saveData = () => Promise.reject(new Error("disk is full"));
    });
    try {
      await toggle("Guides");
      await waitForNotice("Inkline settings could not be saved");
    } finally {
      await browser.executeObsidian(({ plugins }) => {
        const plugin = plugins.inkline;
        const original: unknown = Reflect.get(
          plugin,
          "inklineOriginalSaveData",
        );
        if (typeof original !== "function")
          throw new Error("no saved saveData");
        Reflect.set(plugin, "saveData", original);
        Reflect.deleteProperty(plugin, "inklineOriginalSaveData");
      });
    }
    await toggle("Text colour");
    await waitForStored({ guides: false, textColor: false });
    await closeSettings();
  });

  it("starts with defaults when stored settings are malformed", async function () {
    await obsidianPage.disablePlugin("inkline");
    await browser.executeObsidian(async ({ app }) => {
      await app.vault.adapter.write(
        `${app.vault.configDir}/plugins/inkline/data.json`,
        "{broken",
      );
    });
    await obsidianPage.enablePlugin("inkline");
    await openSettings();
    expect(await setting("Insert trigger").$("input").getValue()).toBe(";;");
    expect(await setting("Symbol size").$("input").getValue()).toBe("100");
    await closeSettings();
  });
});
