import { browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import { loadModules } from "../support/browser.ts";
import {
  createSymbol,
  editorOpen,
  noteText,
  openAtMarker,
  startOver,
  symbolFiles,
  waitForNotice,
} from "../support/editor.ts";
import { choose, menuItems } from "../support/menus.ts";
import { saveScreenshot } from "../support/screenshots.ts";

async function isLoaded(): Promise<boolean> {
  return browser.executeObsidian(({ plugins }) => "inkline" in plugins);
}

/** The ids of Inkline's commands that Obsidian has. */
async function inklineCommands(): Promise<string[]> {
  return browser.executeObsidian(({ app }) => {
    const commands = Reflect.get(app, "commands") as {
      commands: Record<string, unknown>;
    };
    return Object.keys(commands.commands)
      .filter((id) => id.startsWith("inkline:"))
      .sort();
  });
}

/** How many images in the main window Inkline has tagged as symbols. */
async function tagged(): Promise<number> {
  return browser.execute(
    () => document.querySelectorAll("img.inkline-symbol").length,
  );
}

/** The symbol scale Inkline gives the main window, empty without Inkline. */
async function windowScale(): Promise<string> {
  return browser.execute(() =>
    document.documentElement.style.getPropertyValue("--inkline-scale"),
  );
}

/** Opens `path` in the active tab, in Live Preview or Reading view. */
async function open(path: string, mode: "live" | "preview"): Promise<void> {
  await browser.executeObsidian(
    async ({ app }, file, viewMode) => {
      const found = app.vault.getFileByPath(file);
      if (found === null) throw new Error(`no ${file}`);
      await app.workspace
        .getLeaf(false)
        .openFile(found, { state: { mode: viewMode, source: false } });
    },
    path,
    mode === "live" ? "source" : "preview",
  );
}

/** Waits for the active note to read `text`, failing with what it read. */
async function waitForText(text: string): Promise<void> {
  let read = "";
  try {
    await browser.waitUntil(async () => {
      read = await noteText();
      return read === text;
    });
  } catch (error) {
    throw new Error(
      `waited for ${JSON.stringify(text)}, but the note read ${JSON.stringify(read)}`,
      { cause: error },
    );
  }
}

/** A vault call held back until a test lets it go. */
interface Held {
  /** Waits for the call to have started. */
  readonly reached: () => Promise<void>;
  /** Lets it go on, and leaves later calls alone. */
  readonly release: () => Promise<void>;
}

/**
 * Holds back the next `app.vault[method]` of the file at `path`, so that a
 * test can act while it waits.
 */
async function holdVault(
  method: "read" | "readBinary",
  path: string,
): Promise<Held> {
  await browser.executeObsidian(
    ({ app }, name, wanted) => {
      const original: unknown = Reflect.get(app.vault, name);
      if (typeof original !== "function") throw new Error(`no ${name}`);
      const held = { reached: false, release: (): void => undefined };
      const gate = new Promise<void>((resolve) => {
        held.release = resolve;
      });
      Reflect.set(window, "inklineHeld", held);
      Reflect.set(
        app.vault,
        name,
        async (...args: unknown[]): Promise<unknown> => {
          const [file] = args;
          if (
            !held.reached &&
            typeof file === "object" &&
            file !== null &&
            Reflect.get(file, "path") === wanted
          ) {
            held.reached = true;
            await gate;
          }
          const result: unknown = await Reflect.apply(
            original,
            app.vault,
            args,
          );
          return result;
        },
      );
    },
    method,
    path,
  );
  return {
    reached: async () => {
      await browser.waitUntil(async () =>
        browser.execute(
          () =>
            (Reflect.get(window, "inklineHeld") as { reached: boolean })
              .reached,
        ),
      );
    },
    release: async () => {
      await browser.executeObsidian(({ app }, name) => {
        Reflect.deleteProperty(app.vault, name);
        (Reflect.get(window, "inklineHeld") as { release(): void }).release();
      }, method);
    },
  };
}

describe("The plugin", function () {
  it("is loaded when the vault opens", async function () {
    expect(await isLoaded()).toBe(true);
    await obsidianPage.openFile("Welcome.md");
    await saveScreenshot("loaded");
  });

  it("unloads and loads again", async function () {
    await obsidianPage.disablePlugin("inkline");
    expect(await isLoaded()).toBe(false);
    await obsidianPage.enablePlugin("inkline");
    expect(await isLoaded()).toBe(true);
  });
});

// Obsidian leaves a plugin's dialogs and menus open as it unloads it, and its
// callbacks and awaits can still come: none of them may act for Inkline then.
describe("What Inkline started, once it unloads", function () {
  before(async function () {
    await loadModules();
  });

  beforeEach(async function () {
    if (!(await isLoaded())) await obsidianPage.enablePlugin("inkline");
    await startOver();
    // A notice from the test before can lie over a button and take the click.
    await browser.execute(() => {
      for (const notice of document.querySelectorAll(".notice")) {
        notice.remove();
      }
    });
    await createSymbol("tower.ink.png");
    await browser.executeObsidian(async ({ app }) => {
      await app.vault.create("Unload.md", "First ONE, then TWO.\n");
    });
  });

  after(async function () {
    if (!(await isLoaded())) await obsidianPage.enablePlugin("inkline");
    await startOver();
  });

  it("closes Insert existing symbol as it unloads, and a new one inserts once it is back", async function () {
    await openAtMarker("Unload.md", "ONE");
    await browser.executeObsidianCommand("inkline:insert-existing-symbol");
    await browser.$(".prompt-input").waitForDisplayed();
    await obsidianPage.disablePlugin("inkline");
    await browser.$(".prompt").waitForExist({ reverse: true });
    expect(await noteText()).toBe("First , then TWO.\n");
    await obsidianPage.enablePlugin("inkline");
    await openAtMarker("Unload.md", "TWO");
    await browser.executeObsidianCommand("inkline:insert-existing-symbol");
    await browser.$(".prompt-input").waitForDisplayed();
    await browser.keys(["Enter"]);
    await waitForText("First , then ![[tower.ink.png]].\n");
  });

  it("inserts nothing from a choice that reaches the dialog after it unloads", async function () {
    await openAtMarker("Unload.md", "ONE");
    // Keeps the next dialog to open, which is Inkline's.
    await browser.executeObsidian(({ obsidian }) => {
      const prototype = obsidian.SuggestModal.prototype;
      const open: unknown = Reflect.get(prototype, "open");
      if (typeof open !== "function") throw new Error("a dialog has no open");
      Reflect.set(window, "inklineOpen", {
        open,
        own: Object.hasOwn(prototype, "open"),
      });
      Reflect.set(prototype, "open", function (this: unknown): void {
        Reflect.set(window, "inklineDialog", this);
        Reflect.apply(open, this, []);
      });
    });
    try {
      await browser.executeObsidianCommand("inkline:insert-existing-symbol");
      await browser.$(".prompt-input").waitForDisplayed();
      // The dialog's first suggestion, as a choice made just before the
      // unload would carry it.
      await browser.execute(() => {
        const dialog = Reflect.get(window, "inklineDialog") as {
          getSuggestions(query: string): unknown[];
        };
        Reflect.set(window, "inklineChoice", dialog.getSuggestions("")[0]);
      });
      await obsidianPage.disablePlugin("inkline");
      await browser.execute(() => {
        const dialog = Reflect.get(window, "inklineDialog") as {
          onChooseSuggestion(item: unknown, event: KeyboardEvent): void;
        };
        dialog.onChooseSuggestion(
          Reflect.get(window, "inklineChoice"),
          new KeyboardEvent("keydown", { key: "Enter" }),
        );
      });
      await browser.pause(300);
      expect(await noteText()).toBe("First , then TWO.\n");
    } finally {
      await browser.executeObsidian(({ obsidian }) => {
        const prototype = obsidian.SuggestModal.prototype;
        const { open, own } = Reflect.get(window, "inklineOpen") as {
          open: unknown;
          own: boolean;
        };
        if (own) Reflect.set(prototype, "open", open);
        else Reflect.deleteProperty(prototype, "open");
      });
    }
  });

  it("opens nothing from a symbol's menu chosen after it unloads", async function () {
    await browser.executeObsidian(async ({ app }) => {
      await app.vault.create("Menu.md", "A ![[tower.ink.png]] here.\n");
    });
    await open("Menu.md", "preview");
    const image = browser.$(".markdown-reading-view img.inkline-symbol");
    await image.waitForExist();
    await browser.waitUntil(async () =>
      image.getProperty("complete").then((complete) => complete === true),
    );
    await browser.pause(500);
    await image.click({ button: "right" });
    await browser.waitUntil(async () =>
      (await menuItems()).includes("Edit symbol"),
    );
    // Counts reads of the symbol, the first thing opening it does.
    await browser.executeObsidian(({ app }) => {
      const read = app.vault.readBinary.bind(app.vault);
      Reflect.set(window, "inklineReads", 0);
      app.vault.readBinary = (file) => {
        if (file.path === "tower.ink.png") {
          Reflect.set(
            window,
            "inklineReads",
            Number(Reflect.get(window, "inklineReads")) + 1,
          );
        }
        return read(file);
      };
    });
    try {
      await obsidianPage.disablePlugin("inkline");
      // Obsidian leaves the menu open, with the item still in it.
      expect(await menuItems()).toContain("Edit symbol");
      await choose("Edit symbol");
      await browser.pause(500);
      expect(
        await browser.execute((): unknown =>
          Reflect.get(window, "inklineReads"),
        ),
      ).toBe(0);
      expect(await editorOpen()).toBe(false);
    } finally {
      await browser.executeObsidian(({ app }) => {
        Reflect.deleteProperty(app.vault, "readBinary");
      });
    }
  });

  it("stops a library rename still waiting as it unloads, and says so", async function () {
    await openAtMarker("Unload.md", "ONE");
    await browser.executeObsidianCommand("inkline:show-library");
    await browser.$(".inkline-library-rename").waitForExist();
    await browser.$(".inkline-library-rename").click();
    const form = browser.$(".inkline-library-rename-form");
    await form.$("input").waitForDisplayed();
    await form.$("input").setValue("renamed");
    // A rename saves the open notes first, reading each.
    const held = await holdVault("read", "Unload.md");
    try {
      await form.$("button=Save").click();
      await held.reached();
      await obsidianPage.disablePlugin("inkline");
    } finally {
      await held.release();
    }
    await waitForNotice(
      "tower could not be renamed to renamed: Inkline was disabled",
    );
    expect(await symbolFiles()).toEqual(["tower.ink.png"]);
  });

  it("stops a library save of readings still waiting as it unloads, and says so", async function () {
    await browser.executeObsidianCommand("inkline:show-library");
    const button = browser.$('[data-inkline-role="text"]');
    await button.waitForExist();
    await button.click();
    const save = browser.$(".inkline-library-text-buttons button");
    await browser.waitUntil(
      async () => (await save.isExisting()) && (await save.isEnabled()),
    );
    await browser.$('textarea[data-inkline-field="reading"]').setValue("tau");
    // A save reads the file in its turn, before it writes.
    const held = await holdVault("readBinary", "tower.ink.png");
    try {
      await save.click();
      await held.reached();
      await obsidianPage.disablePlugin("inkline");
    } finally {
      await held.release();
    }
    await waitForNotice(
      "The readings and translations of tower were not saved: Inkline was disabled",
    );
    const text = await browser.executeObsidian(async ({ app }) => {
      const file = app.vault.getFileByPath("tower.ink.png");
      if (file === null) throw new Error("no tower.ink.png");
      return window.inklineTest.text.readFileText(
        new Uint8Array(await app.vault.readBinary(file)),
      );
    });
    expect(text).toEqual({ reading: [], translation: [] });
  });

  it("ignores a layout callback that comes after it unloads, and tags symbols when it loads", async function () {
    await browser.executeObsidian(async ({ app }) => {
      await app.vault.create("Layout.md", "A ![[tower.ink.png]] here.\n");
    });
    await open("Layout.md", "live");
    await browser.$("img.inkline-symbol").waitForExist();
    await obsidianPage.disablePlugin("inkline");
    // A load whose callback waits, as it would for a layout not ready yet.
    await browser.executeObsidian(({ app }) => {
      app.workspace.onLayoutReady = (callback) => {
        Reflect.set(window, "inklineLayoutCallback", callback);
      };
    });
    try {
      await obsidianPage.enablePlugin("inkline");
    } finally {
      await browser.executeObsidian(({ app }) => {
        Reflect.deleteProperty(app.workspace, "onLayoutReady");
      });
    }
    await browser.executeObsidian(({ plugins }) => {
      Reflect.set(window, "inklineLoaded", plugins.inkline);
    });
    await obsidianPage.disablePlugin("inkline");
    try {
      expect(await tagged()).toBe(0);
      await browser.execute(() => {
        (Reflect.get(window, "inklineLayoutCallback") as () => void)();
      });
      expect(await tagged()).toBe(0);
      expect(await windowScale()).toBe("");
      // No observer tags a symbol added now.
      await browser.executeObsidian(async ({ app }) => {
        const file = app.vault.getFileByPath("Layout.md");
        if (file === null) throw new Error("no Layout.md");
        await app.vault.modify(
          file,
          "A ![[tower.ink.png]] here, ![[tower.ink.png]] there.\n",
        );
      });
      await browser.waitUntil(
        async () => (await browser.$$(".markdown-source-view img").length) >= 2,
      );
      // Settled where the note puts them, for the right-click below too.
      await browser.pause(500);
      expect(await tagged()).toBe(0);
      // Nor does a listener give its menu Edit symbol.
      const image = browser.$(".markdown-source-view img");
      await browser.waitUntil(async () =>
        image.getProperty("complete").then((complete) => complete === true),
      );
      await image.click({ button: "right" });
      await browser.waitUntil(async () => (await menuItems()).length > 0);
      expect(await menuItems()).not.toContain("Edit symbol");
      await browser.keys(["Escape"]);
    } finally {
      // Undoes whatever the callback started, should it have.
      await browser.execute(() => {
        (
          Reflect.get(window, "inklineLoaded") as { onunload(): void }
        ).onunload();
      });
    }
    await obsidianPage.enablePlugin("inkline");
    await browser.$(".markdown-source-view img.inkline-symbol").waitForExist();
    expect(await windowScale()).toBe("1");
  });

  // Last, as a failure here could leave behind what it registered.
  it("registers nothing when it unloads while its settings are read, and loads in full again", async function () {
    await open("Unload.md", "preview");
    await browser.executeObsidian(async ({ app }) => {
      const file = app.vault.getFileByPath("Unload.md");
      if (file === null) throw new Error("no Unload.md");
      await app.vault.modify(file, "A ![[tower.ink.png]] here.\n");
    });
    await browser.$("img.inkline-symbol").waitForExist();
    await obsidianPage.disablePlugin("inkline");
    await browser.executeObsidian(({ app, obsidian }) => {
      const prototype = obsidian.Plugin.prototype;
      const loadData: unknown = Reflect.get(prototype, "loadData");
      if (typeof loadData !== "function") throw new Error("no loadData");
      const held = {
        reached: false,
        release: (): void => undefined,
        loadData,
      };
      const gate = new Promise<void>((resolve) => {
        held.release = resolve;
      });
      Reflect.set(window, "inklineHeldLoad", held);
      Reflect.set(
        prototype,
        "loadData",
        async function (this: { manifest: { id: string } }): Promise<unknown> {
          if (this.manifest.id === "inkline" && !held.reached) {
            held.reached = true;
            await gate;
          }
          return Reflect.apply(loadData, this, []);
        },
      );
      const plugins = Reflect.get(app, "plugins") as {
        enablePluginAndSave(id: string): Promise<unknown>;
      };
      Reflect.set(
        window,
        "inklineEnabling",
        plugins.enablePluginAndSave("inkline"),
      );
    });
    try {
      await browser.waitUntil(async () =>
        browser.execute(
          () =>
            (Reflect.get(window, "inklineHeldLoad") as { reached: boolean })
              .reached,
        ),
      );
      // The instance loading, which Obsidian lists before it has loaded.
      await browser.executeObsidian(({ app }) => {
        const plugins = Reflect.get(app, "plugins") as {
          plugins: Record<string, unknown>;
        };
        Reflect.set(window, "inklineLoading", plugins.plugins.inkline);
      });
      await obsidianPage.disablePlugin("inkline");
    } finally {
      await browser.executeObsidian(async ({ obsidian }) => {
        const held = Reflect.get(window, "inklineHeldLoad") as {
          release(): void;
          loadData: unknown;
        };
        Reflect.set(obsidian.Plugin.prototype, "loadData", held.loadData);
        held.release();
        await Reflect.get(window, "inklineEnabling");
      });
    }
    try {
      expect(await isLoaded()).toBe(false);
      expect(await inklineCommands()).toEqual([]);
      expect(await windowScale()).toBe("");
      expect(await tagged()).toBe(0);
    } finally {
      // Undoes what that load registered, should it have: Obsidian unloads a
      // plugin only once, and this one counts as unloaded.
      await browser.execute(() => {
        const loading = Reflect.get(window, "inklineLoading") as {
          unload(): void;
        };
        Reflect.set(loading, "_loaded", true);
        loading.unload();
      });
    }
    await obsidianPage.enablePlugin("inkline");
    expect(await inklineCommands()).toEqual([
      "inkline:edit-symbol-at-cursor",
      "inkline:insert-existing-symbol",
      "inkline:insert-symbol",
      "inkline:show-library",
    ]);
    await browser.$("img.inkline-symbol").waitForExist();
  });
});
