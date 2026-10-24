import { browser, expect } from "@wdio/globals";
import { loadModules } from "../support/browser.ts";
import { createSymbol, startOver, waitForNotice } from "../support/editor.ts";
import { saveScreenshot } from "../support/screenshots.ts";

const nameField = () => browser.$(".inkline-library-rename-form input");
const errorField = () => browser.$(".inkline-library-rename-error");

function row(name: string): ReturnType<typeof browser.$> {
  return browser.$(
    `//div[contains(@class, "inkline-library-symbol")][.//div[contains(@class, "inkline-library-name")][text()="${name}"]]`,
  );
}

async function showLibrary(): Promise<void> {
  await browser.executeObsidianCommand("inkline:show-library");
  await browser.$(".inkline-library-list").waitForExist();
}

async function beginRename(name: string, typed: string): Promise<void> {
  await row(name).$(".inkline-library-rename").click();
  await nameField().waitForDisplayed();
  await nameField().setValue(typed);
}

async function waitForName(name: string): Promise<void> {
  await row(name).waitForExist();
  expect(await nameField().isExisting()).toBe(false);
}

/** Exact PNG bytes, independent of its name and Obsidian's image cache. */
async function bytesOf(path: string): Promise<string> {
  return browser.executeObsidian(async ({ app }, path) => {
    const file = app.vault.getFileByPath(path);
    if (file === null) throw new Error(`no ${path}`);
    return Array.from(new Uint8Array(await app.vault.readBinary(file))).join(
      ",",
    );
  }, path);
}

async function waitForError(text: string): Promise<void> {
  await browser.waitUntil(async () =>
    (await errorField().getText()).includes(text),
  );
  expect(await nameField().getProperty("readOnly")).toBe(false);
}

describe("Renaming in the symbol library", function () {
  before(async function () {
    await loadModules();
  });

  beforeEach(async function () {
    await startOver();
    await browser.executeObsidian(({ app }) => {
      app.workspace.detachLeavesOfType("inkline-library");
      const configurable = (
        candidate: object,
      ): candidate is { setConfig(key: string, value: unknown): void } =>
        "setConfig" in candidate && typeof candidate.setConfig === "function";
      if (!configurable(app.vault)) throw new Error("no vault settings");
      app.vault.setConfig("alwaysUpdateLinks", true);
    });
  });

  after(async function () {
    await startOver();
  });

  it("renames the file and its referring links without changing its drawing", async function () {
    await createSymbol("Runes/gate.ink.png");
    const original = await bytesOf("Runes/gate.ink.png");
    await browser.executeObsidian(async ({ app }) => {
      await app.vault.create("Uses.md", "Read ![[Runes/gate.ink.png]] here.\n");
      await app.vault.create("More.md", "Again ![[Runes/gate.ink.png]].\n");
    });
    await browser.waitUntil(async () =>
      browser.executeObsidian(
        ({ app }) =>
          (app.metadataCache.resolvedLinks["Uses.md"]?.["Runes/gate.ink.png"] ??
            0) > 0 &&
          (app.metadataCache.resolvedLinks["More.md"]?.["Runes/gate.ink.png"] ??
            0) > 0,
      ),
    );
    await showLibrary();
    await beginRename("gate", "tower");
    await saveScreenshot("library-rename");
    await browser.keys(["Enter"]);
    await waitForName("tower");
    expect(await bytesOf("Runes/tower.ink.png")).toBe(original);
    await browser.waitUntil(async () =>
      browser.executeObsidian(
        ({ app }) =>
          (app.metadataCache.resolvedLinks["Uses.md"]?.[
            "Runes/tower.ink.png"
          ] ?? 0) > 0 &&
          (app.metadataCache.resolvedLinks["More.md"]?.[
            "Runes/tower.ink.png"
          ] ?? 0) > 0,
      ),
    );
    const uses = await browser.executeObsidian(async ({ app }) => {
      const note = app.vault.getFileByPath("Uses.md");
      if (note === null) throw new Error("no Uses.md");
      return {
        text: await app.vault.read(note),
        oldExists: app.vault.getFileByPath("Runes/gate.ink.png") !== null,
      };
    });
    expect(uses.oldExists).toBe(false);
    expect(uses.text.replace(/!\[\[[^\]]+\]\]/g, "<symbol>")).toBe(
      "Read <symbol> here.\n",
    );
    await browser.waitUntil(
      async () =>
        (await row("tower").$(".inkline-library-uses").getText()) === "2 notes",
    );
  });

  it("cancels with Escape and saves a name in another script with Enter", async function () {
    await createSymbol("gate.ink.png");
    await showLibrary();
    await beginRename("gate", "discarded");
    await browser.keys(["Escape"]);
    await waitForName("gate");
    await beginRename("gate", "塔");
    await browser.keys(["Enter"]);
    await waitForName("塔");
    expect(
      await browser.execute(() =>
        document.activeElement?.getAttribute("data-inkline-role"),
      ),
    ).toBe("rename");
  });

  it("keeps an invalid or failed name to correct and retry", async function () {
    await createSymbol("gate.ink.png");
    await createSymbol("tower.ink.png");
    const other = await bytesOf("tower.ink.png");
    await showLibrary();
    await beginRename("gate", "TOWER");
    await browser.keys(["Enter"]);
    await waitForError("already has");
    expect(await nameField().getValue()).toBe("TOWER");
    await nameField().setValue("CON");
    await browser.keys(["Enter"]);
    await waitForError("Windows keeps");
    await nameField().setValue("arch");
    await browser.executeObsidian(({ app }) => {
      Reflect.set(
        app.fileManager,
        "inklineOriginalRename",
        app.fileManager.renameFile.bind(app.fileManager),
      );
      app.fileManager.renameFile = () =>
        Promise.reject(new Error("the disk is read-only"));
    });
    try {
      await browser.keys(["Enter"]);
      await waitForError("read-only");
      expect(await nameField().getValue()).toBe("arch");
      await saveScreenshot("library-rename-error");
    } finally {
      await browser.executeObsidian(({ app }) => {
        const original: unknown = Reflect.get(
          app.fileManager,
          "inklineOriginalRename",
        );
        if (typeof original !== "function")
          throw new Error("no original rename");
        Reflect.set(app.fileManager, "renameFile", original);
        Reflect.deleteProperty(app.fileManager, "inklineOriginalRename");
      });
    }
    await browser.keys(["Enter"]);
    await waitForName("arch");
    expect(await bytesOf("tower.ink.png")).toBe(other);
  });

  it("refuses a file deleted and replaced while its name is being edited", async function () {
    await createSymbol("gate.ink.png");
    await showLibrary();
    await beginRename("gate", "arch");
    await browser.executeObsidian(async ({ app }) => {
      const file = app.vault.getFileByPath("gate.ink.png");
      if (file === null) throw new Error("no gate");
      await app.fileManager.trashFile(file);
    });
    await createSymbol("gate.ink.png", [1200, 1800]);
    const replacement = await bytesOf("gate.ink.png");
    await browser.keys(["Enter"]);
    await waitForError("no longer in the vault");
    expect(await nameField().getValue()).toBe("arch");
    expect(await bytesOf("gate.ink.png")).toBe(replacement);
    expect(
      await browser.executeObsidian(
        ({ app }) => app.vault.getFileByPath("arch.ink.png") === null,
      ),
    ).toBe(true);
    await browser.$(".inkline-library-rename-form").$("button=Cancel").click();
    await waitForName("gate");
  });

  it("refuses a stale file menu while another name is being edited", async function () {
    await createSymbol("gate.ink.png");
    await createSymbol("tower.ink.png");
    await showLibrary();
    await beginRename("gate", "arch");
    await browser.executeObsidian(async ({ app }) => {
      const file = app.vault.getFileByPath("tower.ink.png");
      if (file === null) throw new Error("no tower");
      await app.fileManager.trashFile(file);
    });
    await createSymbol("tower.ink.png", [1200]);
    await row("tower").$(".inkline-library-insert").click({ button: "right" });
    await waitForNotice(
      "tower changed or was deleted. Finish renaming to refresh the library.",
    );
    expect(await browser.$(".menu").isExisting()).toBe(false);
    expect(await nameField().getValue()).toBe("arch");
  });

  it("keeps the entered name and caret through vault changes", async function () {
    await createSymbol("gate.ink.png");
    await showLibrary();
    await beginRename("gate", "tower");
    await browser.execute(() => {
      document
        .querySelector<HTMLInputElement>(".inkline-library-rename-form input")
        ?.setSelectionRange(2, 2);
    });
    await createSymbol("other.ink.png");
    await browser.pause(300);
    expect(await nameField().getValue()).toBe("tower");
    expect(await nameField().getProperty("selectionStart")).toBe(2);
    await browser.keys(["Enter"]);
    await waitForName("tower");
    expect(await row("other").isExisting()).toBe(true);
  });

  it("starts a pending rename only once", async function () {
    await createSymbol("gate.ink.png");
    await showLibrary();
    await beginRename("gate", "arch");
    await browser.executeObsidian(({ app }) => {
      const original = app.fileManager.renameFile.bind(app.fileManager);
      Reflect.set(app.fileManager, "inklineOriginalRename", original);
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      Reflect.set(app.fileManager, "inklineReleaseRename", release);
      Reflect.set(app.fileManager, "inklineRenameCalls", 0);
      app.fileManager.renameFile = async (file, path) => {
        const calls: unknown = Reflect.get(
          app.fileManager,
          "inklineRenameCalls",
        );
        Reflect.set(
          app.fileManager,
          "inklineRenameCalls",
          typeof calls === "number" ? calls + 1 : 1,
        );
        await gate;
        await original(file, path);
      };
    });
    try {
      await browser.keys(["Enter"]);
      await browser.waitUntil(async () =>
        browser.executeObsidian(
          ({ app }) => Reflect.get(app.fileManager, "inklineRenameCalls") === 1,
        ),
      );
      expect(await nameField().getProperty("readOnly")).toBe(true);
      await browser.keys(["Enter", "Escape"]);
      expect(await nameField().isExisting()).toBe(true);
      await browser.executeObsidian(({ app }) => {
        const release: unknown = Reflect.get(
          app.fileManager,
          "inklineReleaseRename",
        );
        if (typeof release !== "function") throw new Error("no rename gate");
        Reflect.apply(release, undefined, []);
      });
      await waitForName("arch");
      expect(
        await browser.executeObsidian(({ app }) => {
          const calls: unknown = Reflect.get(
            app.fileManager,
            "inklineRenameCalls",
          );
          return calls;
        }),
      ).toBe(1);
    } finally {
      await browser.executeObsidian(({ app }) => {
        const original: unknown = Reflect.get(
          app.fileManager,
          "inklineOriginalRename",
        );
        const release: unknown = Reflect.get(
          app.fileManager,
          "inklineReleaseRename",
        );
        if (typeof release === "function")
          Reflect.apply(release, undefined, []);
        if (typeof original !== "function")
          throw new Error("no original rename");
        Reflect.set(app.fileManager, "renameFile", original);
        Reflect.deleteProperty(app.fileManager, "inklineOriginalRename");
        Reflect.deleteProperty(app.fileManager, "inklineReleaseRename");
        Reflect.deleteProperty(app.fileManager, "inklineRenameCalls");
      });
    }
  });
});
