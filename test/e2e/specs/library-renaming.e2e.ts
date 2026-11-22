import { browser, expect } from "@wdio/globals";
import { loadModules } from "../support/browser.ts";
import {
  addUnsaved,
  clickTop,
  createSymbol,
  delayVault,
  failSaves,
  hold,
  holdIndex,
  letGo,
  restoreVault,
  startOver,
  symbolFiles,
  waitForFailedSaves,
  waitForHeld,
  waitForIndexWait,
  waitForNotice,
  waitForPanes,
  waitForTop,
} from "../support/editor.ts";
import { saveScreenshot } from "../support/screenshots.ts";
import {
  setStalledAfter,
  shortStall,
  waitForStallSaid,
} from "../support/stalls.ts";
import { showLibrary } from "../support/symbol-text-library.ts";
import {
  bytesOf,
  noteOnDisk,
  waitForLinkWithoutSaving,
} from "../support/vault-files.ts";
import { setLinkUpdates } from "../support/insertion.ts";

const quickEditNameField = () => browser.$(".inkline-library-edit-form input");
const errorField = () => browser.$(".inkline-library-edit-error");

function libraryRowNamed(name: string): ReturnType<typeof browser.$> {
  return browser.$(
    `//div[contains(@class, "inkline-library-symbol")][.//div[contains(@class, "inkline-library-name")][text()="${name}"]]`,
  );
}

async function beginRename(name: string, typed: string): Promise<void> {
  // A notice from the test before can lie over the button and take the click,
  // as it would a person's (#214).
  await browser.execute(() => {
    for (const notice of activeDocument.querySelectorAll(".notice")) {
      notice.remove();
    }
  });
  await libraryRowNamed(name).$(".inkline-library-edit").click();
  await quickEditNameField().waitForDisplayed();
  // Save waits for the fields to read the file's readings and translations.
  await browser
    .$(".inkline-library-edit-form")
    .$("button=Save")
    .waitForEnabled();
  await quickEditNameField().setValue(typed);
}

/**
 * Waits for a row named `name` that is not in Quick edit, whose buttons, name
 * and all, stay above its form, and checks that no form is left open.
 */
async function waitForName(name: string): Promise<void> {
  await browser
    .$(
      `//div[contains(@class, "inkline-library-symbol")][not(.//form)][.//div[contains(@class, "inkline-library-name")][text()="${name}"]]`,
    )
    .waitForExist();
  expect(await quickEditNameField().isExisting()).toBe(false);
}

async function waitForError(text: string): Promise<void> {
  await browser.waitUntil(async () =>
    (await errorField().getText()).includes(text),
  );
  expect(await quickEditNameField().getProperty("readOnly")).toBe(false);
}

/** Makes a symbol that `count` notes embed. */
async function usedSymbol(count = 1): Promise<void> {
  await createSymbol("gate.ink.png");
  await browser.executeObsidian(async ({ app }, notes) => {
    for (let at = 0; at < notes; at++) {
      await app.vault.create(
        `Uses ${String(at)}.md`,
        "See ![[gate.ink.png]].\n",
      );
    }
  }, count);
  for (let at = 0; at < count; at++) {
    await waitForLinkWithoutSaving(`Uses ${String(at)}.md`, "gate.ink.png");
  }
}

/**
 * Has the page note down anything the form says of a wait, however brief,
 * and when, by the page's clock, it first said it.
 */
async function watchForWait(): Promise<void> {
  await browser.execute(() => {
    Reflect.deleteProperty(window, "inklineSawWait");
    const watcher = new MutationObserver(() => {
      const shown = document.querySelector(".inkline-save-wait");
      if (
        shown !== null &&
        shown.textContent !== "" &&
        !Reflect.has(window, "inklineSawWait")
      ) {
        Reflect.set(window, "inklineSawWait", performance.now());
      }
    });
    watcher.observe(document.body, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    Reflect.set(window, "inklineWaitWatcher", watcher);
  });
}

/** Whether the form has said anything of a wait, and stops listening. */
async function sawWait(): Promise<boolean> {
  return (await waitSaidAt()) !== undefined;
}

/**
 * When, by the page's clock, the form first said anything of a wait, or
 * undefined if it has not, and stops listening.
 */
async function waitSaidAt(): Promise<number | undefined> {
  // WebDriver hands back undefined as null.
  const at = await browser.execute((): number | null => {
    const watcher: unknown = Reflect.get(window, "inklineWaitWatcher");
    if (watcher instanceof MutationObserver) watcher.disconnect();
    const seen: unknown = Reflect.get(window, "inklineSawWait");
    return typeof seen === "number" ? seen : null;
  });
  return at ?? undefined;
}

describe("Renaming in the symbol library", function () {
  before(async function () {
    await loadModules();
  });

  beforeEach(async function () {
    await startOver();
    await browser.executeObsidian(({ app }) => {
      app.workspace.detachLeavesOfType("inkline-library");
    });
    await setLinkUpdates(true);
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
        (await libraryRowNamed("tower")
          .$(".inkline-library-uses")
          .getText()) === "Uses (2)",
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
    ).toBe("edit");
  });

  it("keeps an invalid or failed name to correct and retry", async function () {
    await createSymbol("gate.ink.png");
    await createSymbol("tower.ink.png");
    const other = await bytesOf("tower.ink.png");
    await showLibrary();
    await beginRename("gate", "TOWER");
    await browser.keys(["Enter"]);
    await waitForError("already has");
    expect(await quickEditNameField().getValue()).toBe("TOWER");
    await quickEditNameField().setValue("CON");
    await browser.keys(["Enter"]);
    await waitForError("Windows keeps");
    await quickEditNameField().setValue("arch");
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
      expect(await quickEditNameField().getValue()).toBe("arch");
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
    expect(await quickEditNameField().getValue()).toBe("arch");
    expect(await bytesOf("gate.ink.png")).toBe(replacement);
    expect(
      await browser.executeObsidian(
        ({ app }) => app.vault.getFileByPath("arch.ink.png") === null,
      ),
    ).toBe(true);
    await browser.$(".inkline-library-edit-form").$("button=Cancel").click();
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
    await libraryRowNamed("tower")
      .$(".inkline-library-insert")
      .click({ button: "right" });
    await waitForNotice(
      "tower changed or was deleted. Finish editing to refresh the library.",
    );
    expect(await browser.$(".menu").isExisting()).toBe(false);
    expect(await quickEditNameField().getValue()).toBe("arch");
  });

  it("keeps the entered name and caret through vault changes", async function () {
    await createSymbol("gate.ink.png");
    await showLibrary();
    await beginRename("gate", "tower");
    await browser.execute(() => {
      document
        .querySelector<HTMLInputElement>(".inkline-library-edit-form input")
        ?.setSelectionRange(2, 2);
    });
    await createSymbol("other.ink.png");
    // The list draws nothing while a row is edited, so nothing shows that it
    // heard of the new file to wait for: this waits past the 100 ms in which it
    // gathers a burst of changes before it would draw, and the new file's row,
    // not there yet, shows that it drew nothing.
    await browser.pause(300);
    expect(await libraryRowNamed("other").isExisting()).toBe(false);
    expect(await quickEditNameField().getValue()).toBe("tower");
    expect(await quickEditNameField().getProperty("selectionStart")).toBe(2);
    await browser.keys(["Enter"]);
    await waitForName("tower");
    expect(await libraryRowNamed("other").isExisting()).toBe(true);
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
      expect(await quickEditNameField().getProperty("readOnly")).toBe(true);
      await browser.keys(["Enter", "Escape"]);
      expect(await quickEditNameField().isExisting()).toBe(true);
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

  describe("when the symbol changes while a rename saves the open notes", function () {
    /**
     * Begins renaming `gate.ink.png`, which an open note embeds, to `typed`,
     * and holds the rename where it reads that note to see whether it has text
     * to save, as a slow disk could hold it for any time.
     */
    async function renameHeld(typed: string): Promise<void> {
      await usedSymbol();
      await browser.executeObsidian(async ({ app }) => {
        const note = app.vault.getFileByPath("Uses 0.md");
        if (note === null) throw new Error("no note");
        await app.workspace.getLeaf(false).openFile(note);
      });
      await showLibrary();
      await beginRename("gate", typed);
      await hold("read");
      await browser.keys(["Enter"]);
      await waitForHeld();
    }

    afterEach(async function () {
      await letGo();
    });

    // A symbol deleted and replaced meanwhile is rename-races.e2e.ts's "saves
    // a symbol deleted and replaced while open notes are saved": the same hold,
    // in the same check of the rename, which the library says as the two
    // below.
    it("refuses a symbol renamed elsewhere meanwhile, and renames it from there when asked again", async function () {
      await renameHeld("lintel");
      // Renamed as sync would, without Inkline.
      await browser.executeObsidian(async ({ app }) => {
        const file = app.vault.getFileByPath("gate.ink.png");
        if (file === null) throw new Error("no gate");
        await app.vault.rename(file, "arch.ink.png");
      });
      await letGo();
      await waitForError("the file was renamed to arch.ink.png meanwhile");
      expect(await quickEditNameField().getValue()).toBe("lintel");
      expect(await symbolFiles()).toEqual(["arch.ink.png"]);
      await browser.keys(["Enter"]);
      await waitForName("lintel");
      expect(await symbolFiles()).toEqual(["lintel.ink.png"]);
    });

    it("refuses a name another symbol took meanwhile, in any letter case", async function () {
      await renameHeld("lintel");
      await createSymbol("LINTEL.ink.png", [1200]);
      await letGo();
      await waitForError("already has a symbol named lintel");
      expect(await quickEditNameField().getValue()).toBe("lintel");
      expect(await symbolFiles()).toEqual(["LINTEL.ink.png", "gate.ink.png"]);
    });
  });

  describe("when the symbol changes while Obsidian would wait to move it", function () {
    /**
     * Begins renaming `gate.ink.png`, which an open note embeds, to `typed`,
     * with Obsidian's index held on another note, as on a slow disk or while
     * sync brings in notes. Obsidian's `renameFile` waits for the index before
     * it moves a file; this waits until the rename waits for it.
     */
    async function renameWhileIndexing(typed: string): Promise<void> {
      await usedSymbol();
      await browser.executeObsidian(async ({ app }) => {
        const note = app.vault.getFileByPath("Uses 0.md");
        if (note === null) throw new Error("no note");
        await app.workspace.getLeaf(false).openFile(note);
      });
      await showLibrary();
      await beginRename("gate", typed);
      await holdIndex();
      await browser.keys(["Enter"]);
      await waitForIndexWait();
    }

    afterEach(async function () {
      await letGo();
    });

    // A symbol deleted and replaced is rename-races.e2e.ts's "saves a symbol
    // deleted and replaced while Obsidian indexes the vault": the same wait, in
    // the same check of the rename, which the library says as the test below.
    it("refuses a symbol renamed elsewhere while Obsidian indexes the vault, and keeps that name", async function () {
      await renameWhileIndexing("lintel");
      // Renamed as sync would, without Inkline.
      await browser.executeObsidian(async ({ app }) => {
        const file = app.vault.getFileByPath("gate.ink.png");
        if (file === null) throw new Error("no gate");
        await app.vault.rename(file, "arch.ink.png");
      });
      await letGo();
      await waitForError("the file was renamed to arch.ink.png meanwhile");
      expect(await quickEditNameField().getValue()).toBe("lintel");
      expect(await symbolFiles()).toEqual(["arch.ink.png"]);
    });

    // What comes between once Obsidian moves the file, a replacement, a file
    // at the new name, or the very rename made elsewhere, is
    // rename-races.e2e.ts's three tests "as Obsidian moves it": the same hold,
    // heard by the same watch of the move, and said in the same words. The
    // library shows what it is told as above, and library-quick-edit.e2e.ts's
    // "says only that the readings are saved when the rename is disturbed after
    // them" has the row that then has nothing left to save.
  });

  describe("when Obsidian does not finish a rename", function () {
    const form = () => browser.$(".inkline-library-edit-form");
    const formButton = (text: "Save" | "Cancel") => form().$(`button=${text}`);
    const waitLine = () => form().$(".inkline-save-wait");

    /**
     * Waits for the form to say its rename waits, asked for at `since`, and
     * returns what it says.
     */
    async function waitForWait(since: number): Promise<string> {
      return waitForStallSaid(waitLine, since);
    }

    beforeEach(async function () {
      await setStalledAfter(shortStall);
    });

    afterEach(async function () {
      // A rename left waiting would hold up the vault's reset.
      await letGo();
      await restoreVault();
    });

    it("says nothing during Obsidian's question, however long it stays open", async function () {
      await usedSymbol();
      await setLinkUpdates(false);
      await showLibrary();
      await beginRename("gate", "lintel");
      await watchForWait();
      await browser.keys(["Enter"]);
      await waitForTop("Just once");
      // Obsidian has moved the file by now, and asks only about the links.
      expect(await symbolFiles()).toEqual(["lintel.ink.png"]);
      await browser.pause(shortStall + 1500);
      expect(await waitLine().getText()).toBe("");
      expect(await formButton("Cancel").isEnabled()).toBe(false);
      await clickTop("Just once");
      await waitForName("lintel");
      expect(await sawWait()).toBe(false);
      expect(await noteOnDisk("Uses 0.md")).toContain("lintel.ink.png");
      expect(await browser.$(".notice*=Renamed").isExisting()).toBe(false);
    });

    it("says nothing of a slow rename that keeps moving, however long it takes", async function () {
      // Longer than the wait, a note at a time, as a much used symbol takes.
      // Here the wait is twice the short one, so that each note comes 3.2 s
      // before it would be up: room for a busy machine to hold a note back,
      // which is all that could make this rename look stopped.
      const wait = shortStall * 2;
      const apart = 800;
      const notes = 6;
      await setStalledAfter(wait);
      await usedSymbol(notes);
      await showLibrary();
      await beginRename("gate", "lintel");
      await watchForWait();
      await delayVault("process", apart, "before");
      await browser.keys(["Enter"]);
      await quickEditNameField().waitForExist({
        reverse: true,
        timeout: notes * apart + 15_000,
      });
      expect(await sawWait()).toBe(false);
      for (let at = 0; at < notes; at++) {
        expect(await noteOnDisk(`Uses ${String(at)}.md`)).toContain("lintel");
      }
    });

    it("says so of a rename held back, keeps the name, and ends with it", async function () {
      await usedSymbol();
      await showLibrary();
      await beginRename("gate", "lintel");
      await hold("move");
      const asked = Date.now();
      await browser.keys(["Enter"]);
      await waitForHeld();
      const said = await waitForWait(asked);
      expect(said).toContain("Waiting for Obsidian to finish renaming a file.");
      expect(said).toContain("goes on by itself when it does");
      expect(said).toContain("copy the name you typed and restart Obsidian");
      expect(said).toContain("Cancel closes this, and stops the rename");
      await saveScreenshot("rename-wait-library", form());
      // What was typed is there to copy, from the field that has the focus.
      const shown = await browser.execute(() => {
        const active = document.activeElement;
        if (active?.tagName !== "INPUT") return undefined;
        const field = active as HTMLInputElement;
        field.select();
        return {
          selected: field.value.slice(
            field.selectionStart ?? 0,
            field.selectionEnd ?? 0,
          ),
          readOnly: field.readOnly,
        };
      });
      expect(shown).toEqual({ selected: "lintel", readOnly: true });
      expect(await formButton("Save").isEnabled()).toBe(false);
      expect(await formButton("Cancel").isEnabled()).toBe(true);
      expect(await symbolFiles()).toEqual(["gate.ink.png"]);
      await letGo();
      await waitForName("lintel");
      await waitForNotice("Renamed gate to lintel");
      expect(await symbolFiles()).toEqual(["lintel.ink.png"]);
    });

    // Leaving with Cancel is "refuses a second rename while Obsidian has the
    // first" below, which goes on to the end of the rename as this does. Esc in
    // the field is a handler of its own.
    it("leaves a rename held back with Esc, says it may still finish, and it does", async function () {
      await usedSymbol();
      await showLibrary();
      await beginRename("gate", "lintel");
      await hold("move");
      const asked = Date.now();
      // By the mouse, as Save takes the focus with it when it goes off.
      await formButton("Save").click();
      await waitForHeld();
      await waitForWait(asked);
      await browser.keys(["Escape"]);
      await waitForName("gate");
      await waitForNotice("may still finish");
      await letGo();
      await waitForName("lintel");
      await waitForNotice("Renamed gate to lintel");
      expect(await noteOnDisk("Uses 0.md")).toContain("lintel.ink.png");
    });

    it("says so if a rename left behind fails, with the name typed", async function () {
      await usedSymbol();
      await showLibrary();
      await beginRename("gate", "lintel");
      await hold("move");
      const asked = Date.now();
      await browser.keys(["Enter"]);
      await waitForHeld();
      await waitForWait(asked);
      await formButton("Cancel").click();
      await waitForName("gate");
      await letGo("the drive went away");
      await waitForNotice(
        "gate could not be renamed to lintel: the drive went away",
      );
      expect(await symbolFiles()).toEqual(["gate.ink.png"]);
    });

    it("says what happened to a rename left behind that something came between", async function () {
      await usedSymbol();
      await showLibrary();
      await beginRename("gate", "lintel");
      await hold("move");
      const asked = Date.now();
      await browser.keys(["Enter"]);
      await waitForHeld();
      await waitForWait(asked);
      await formButton("Cancel").click();
      await waitForName("gate");
      await browser.executeObsidian(async ({ app }) => {
        const file = app.vault.getFileByPath("gate.ink.png");
        if (file === null) throw new Error("no gate");
        await app.fileManager.trashFile(file);
      });
      await createSymbol("gate.ink.png", [1200, 1800]);
      await letGo();
      await waitForNotice(
        "Renaming gate to lintel: the file was deleted while Obsidian was renaming it, and Obsidian renamed another file to lintel.ink.png",
      );
      expect(await symbolFiles()).toEqual(["lintel.ink.png"]);
    });

    it("refuses a second rename while Obsidian has the first", async function () {
      await usedSymbol();
      await showLibrary();
      await beginRename("gate", "lintel");
      await hold("move");
      const asked = Date.now();
      await browser.keys(["Enter"]);
      await waitForHeld();
      await waitForWait(asked);
      await formButton("Cancel").click();
      await waitForName("gate");
      await waitForNotice("may still finish");
      await beginRename("gate", "arch");
      await browser.keys(["Enter"]);
      // Obsidian would say this one was done, with nothing renamed.
      await waitForError("Obsidian is still renaming this symbol");
      expect(await quickEditNameField().getValue()).toBe("arch");
      await formButton("Cancel").click();
      await letGo();
      await waitForName("lintel");
      await waitForNotice("Renamed gate to lintel");
      expect(await symbolFiles()).toEqual(["lintel.ink.png"]);
      expect(await noteOnDisk("Uses 0.md")).toContain("lintel.ink.png");
    });

    it("gives the form back when a rename held back fails", async function () {
      await usedSymbol();
      await showLibrary();
      await beginRename("gate", "lintel");
      await hold("move");
      const asked = Date.now();
      await browser.keys(["Enter"]);
      await waitForHeld();
      await waitForWait(asked);
      await letGo("the drive went away");
      await waitForError("the drive went away");
      expect(await waitLine().getText()).toBe("");
      expect(await quickEditNameField().getValue()).toBe("lintel");
      expect(await formButton("Save").isEnabled()).toBe(true);
      expect(await formButton("Cancel").isEnabled()).toBe(true);
    });

    it("stops a rename held in a note's save, which then renames nothing", async function () {
      await usedSymbol();
      await browser.executeObsidian(async ({ app }) => {
        const note = app.vault.getFileByPath("Uses 0.md");
        if (note === null) throw new Error("no note");
        await app.workspace.getLeaf(false).openFile(note);
      });
      await showLibrary();
      await beginRename("gate", "lintel");
      await hold("save");
      const asked = Date.now();
      // The note saves itself two seconds after an edit, which on a busy
      // machine can come before the rename's save: the rename then finds
      // nothing to save, or finds that save held, and on Obsidian 1.13 a save
      // during another returns at once, so the rename is refused. So the text
      // is added and the rename begun in one step, as Enter in the field would
      // begin it (#234).
      await browser.executeObsidian(({ app, obsidian }, text) => {
        const view = app.workspace
          .getLeavesOfType("markdown")
          .map((leaf) => leaf.view)
          .find(
            (open) =>
              open instanceof obsidian.MarkdownView &&
              open.file?.path === "Uses 0.md",
          );
        const form = document.querySelector(".inkline-library-edit-form");
        if (!(view instanceof obsidian.MarkdownView))
          throw new Error("no note");
        if (!(form instanceof HTMLFormElement)) throw new Error("no form");
        view.editor.replaceRange(text, view.editor.offsetToPos(0));
        form.requestSubmit();
      }, "Opening.\n");
      await waitForHeld();
      await waitForWait(asked);
      await formButton("Cancel").click();
      await waitForName("gate");
      expect(await browser.$(".notice*=may still finish").isExisting()).toBe(
        false,
      );
      await letGo();
      // The note's save goes on, and nothing follows it.
      await browser.waitUntil(async () =>
        (await noteOnDisk("Uses 0.md")).startsWith("Opening."),
      );
      await browser.pause(500);
      expect(await symbolFiles()).toEqual(["gate.ink.png"]);
      expect(await noteOnDisk("Uses 0.md")).toContain("gate.ink.png");
    });

    it("stops a rename held in Obsidian's index, which then renames nothing", async function () {
      await usedSymbol();
      await showLibrary();
      await beginRename("gate", "lintel");
      await holdIndex();
      const asked = Date.now();
      await browser.keys(["Enter"]);
      await waitForIndexWait();
      const said = await waitForWait(asked);
      expect(said).toContain("Waiting for Obsidian to finish renaming a file.");
      expect(await formButton("Cancel").isEnabled()).toBe(true);
      await formButton("Cancel").click();
      await waitForName("gate");
      expect(await browser.$(".notice*=may still finish").isExisting()).toBe(
        false,
      );
      await letGo();
      // The index catches up, and nothing follows it.
      await browser.waitUntil(async () =>
        browser.executeObsidian(
          ({ app }) => app.metadataCache.getCache("Synced.md") !== null,
        ),
      );
      await browser.pause(500);
      expect(await symbolFiles()).toEqual(["gate.ink.png"]);
      expect(await noteOnDisk("Uses 0.md")).toContain("gate.ink.png");
    });

    it("counts from the answer, for a rename held after Obsidian's question", async function () {
      await usedSymbol();
      await setLinkUpdates(false);
      await showLibrary();
      await beginRename("gate", "lintel");
      await hold("link");
      await watchForWait();
      await browser.keys(["Enter"]);
      await waitForTop("Just once");
      await browser.pause(shortStall + 1000);
      // The answer, timed by the page's clock as it is clicked.
      await browser.execute(() => {
        document.addEventListener(
          "click",
          () => {
            Reflect.set(window, "inklineAnsweredAt", performance.now());
          },
          { capture: true, once: true },
        );
      });
      const answered = Date.now();
      await clickTop("Just once");
      await waitForHeld();
      const said = await waitForWait(answered);
      expect(said).toContain("Waiting for Obsidian to finish renaming a file.");
      // A question held open that long must not count towards the wait, which
      // would then be said at the first look after the answer, within a
      // quarter of a second, or during the question. Counted from the answer,
      // it comes eight looks of a quarter of a second after it. Both are
      // timed in the page, where a busy machine can only make the looks
      // later, and so the message too.
      const saidAt = await waitSaidAt();
      const answeredAt = await browser.execute((): unknown => {
        const at: unknown = Reflect.get(window, "inklineAnsweredAt");
        Reflect.deleteProperty(window, "inklineAnsweredAt");
        return at;
      });
      if (saidAt === undefined || typeof answeredAt !== "number") {
        throw new Error("the page did not time the answer and the message");
      }
      expect(saidAt - answeredAt).toBeGreaterThan(shortStall / 2);
      await letGo();
      await waitForName("lintel");
      await waitForNotice("Renamed gate to lintel");
      expect(await noteOnDisk("Uses 0.md")).toContain("lintel.ink.png");
    });

    it("takes the message back when Obsidian's question opens at last", async function () {
      await usedSymbol();
      await setLinkUpdates(false);
      await showLibrary();
      await beginRename("gate", "lintel");
      await hold("move");
      const asked = Date.now();
      await browser.keys(["Enter"]);
      await waitForHeld();
      await waitForWait(asked);
      await letGo();
      // The move ends, and only then does Obsidian ask about the links.
      await waitForTop("Just once");
      await browser.waitUntil(async () => (await waitLine().getText()) === "");
      expect(await formButton("Cancel").isEnabled()).toBe(false);
      await clickTop("Just once");
      await waitForName("lintel");
      expect(await noteOnDisk("Uses 0.md")).toContain("lintel.ink.png");
    });
  });

  describe("with a note holding unsaved text", function () {
    const saved = "The door  ![[gate.ink.png]] today.\n";
    const opening = "Opening unsaved line.\n";
    const renamed = `${opening}The door  ![[lintel.ink.png]] today.\n`;

    /**
     * Opens a note that embeds the symbol, and begins renaming it in the
     * library with Obsidian set to ask about links.
     */
    async function beginWithNote(): Promise<void> {
      await createSymbol("gate.ink.png");
      await setLinkUpdates(false);
      await browser.executeObsidian(async ({ app }, text) => {
        const note = await app.vault.create("Uses.md", text);
        await app.workspace.getLeaf(false).openFile(note);
      }, saved);
      await browser.waitUntil(async () =>
        browser.executeObsidian(
          ({ app }) =>
            (app.metadataCache.resolvedLinks["Uses.md"]?.["gate.ink.png"] ??
              0) > 0,
        ),
      );
      await showLibrary();
      await beginRename("gate", "lintel");
    }

    /**
     * {@link beginWithNote}, then adds unsaved text to the note. The text comes
     * last, as the note's blur saves what it holds by then.
     */
    async function renameWithText(): Promise<void> {
      await beginWithNote();
      await addUnsaved("Uses.md", opening, "start");
    }

    /** The note's text on disk. */
    async function onDisk(): Promise<string> {
      return browser.executeObsidian(async ({ app }) => {
        const note = app.vault.getFileByPath("Uses.md");
        if (note === null) throw new Error("no note");
        return app.vault.read(note);
      });
    }

    it("keeps the text when the note's own save falls due during Obsidian's question", async function () {
      await renameWithText();
      await browser.keys(["Enter"]);
      await waitForTop("Just once");
      // An editor saves itself two seconds after an edit.
      await browser.pause(2500);
      await clickTop("Just once");
      await waitForName("lintel");
      await waitForPanes("Uses.md", renamed);
      await browser.waitUntil(async () => (await onDisk()) === renamed);
    });

    it("saves text typed in a note while the rename reads another", async function () {
      await createSymbol("gate.ink.png");
      await setLinkUpdates(false);
      const order = await browser.executeObsidian(
        async ({ app, obsidian }, text) => {
          const note = await app.vault.create("Uses.md", text);
          await app.workspace.getLeaf(false).openFile(note);
          const other = await app.vault.create("Other.md", "Nothing here.\n");
          await app.workspace.getLeaf("split").openFile(other);
          return app.workspace
            .getLeavesOfType("markdown")
            .map(({ view }) =>
              view instanceof obsidian.MarkdownView ? view.file?.path : "",
            );
        },
        saved,
      );
      // The rename reads the notes in this order, so that Uses.md has been
      // found saved by the time it waits on Other.md.
      expect(order).toEqual(["Uses.md", "Other.md"]);
      await browser.waitUntil(async () =>
        browser.executeObsidian(
          ({ app }) =>
            (app.metadataCache.resolvedLinks["Uses.md"]?.["gate.ink.png"] ??
              0) > 0,
        ),
      );
      await showLibrary();
      await beginRename("gate", "lintel");
      await hold("read", "Other.md");
      try {
        await browser.keys(["Enter"]);
        await waitForHeld();
        await addUnsaved("Uses.md", opening, "start");
      } finally {
        await letGo();
      }
      await waitForTop("Just once");
      // An editor saves itself two seconds after an edit.
      await browser.pause(2500);
      await clickTop("Just once");
      await waitForName("lintel");
      await waitForPanes("Uses.md", renamed);
      await browser.waitUntil(async () => (await onDisk()) === renamed);
    });

    it("refuses the rename if the note cannot be saved, and changes nothing", async function () {
      await beginWithNote();
      // Saves fail before the text is added, and until the file is read and
      // the note's own save has failed as well as the rename's (#234).
      const restore = await failSaves();
      try {
        await addUnsaved("Uses.md", opening, "start");
        await browser.keys(["Enter"]);
        await waitForError("the note Uses could not be saved first");
        await waitForFailedSaves("Uses.md", 2);
        expect(await onDisk()).toBe(saved);
      } finally {
        await restore();
      }
      expect(await quickEditNameField().getValue()).toBe("lintel");
      expect(await symbolFiles()).toEqual(["gate.ink.png"]);
      await waitForPanes("Uses.md", `${opening}${saved}`);
      await browser.keys(["Enter"]);
      await clickTop("Just once");
      await waitForName("lintel");
      await waitForPanes("Uses.md", renamed);
      await browser.waitUntil(async () => (await onDisk()) === renamed);
    });
  });
});
