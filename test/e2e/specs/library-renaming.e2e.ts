import { browser, expect } from "@wdio/globals";
import { stalledAfter } from "../../../src/notes/file-writes.ts";
import { loadModules } from "../support/browser.ts";
import {
  addUnsaved,
  clickTop,
  createSymbol,
  delayVault,
  failSaves,
  restoreVault,
  startOver,
  symbolFiles,
  topButton,
  waitForNotice,
  waitForPanes,
} from "../support/editor.ts";
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
  // A row redrawn between a click's press and its release gets no click, which
  // #204 records, so this goes on until the form is there.
  await browser.waitUntil(async () => {
    if (await nameField().isExisting()) return true;
    await row(name).$(".inkline-library-rename").click();
    return nameField().isExisting();
  });
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

/** Has Obsidian update links without asking, or ask. */
async function setLinkUpdates(always: boolean): Promise<void> {
  await browser.executeObsidian(({ app }, value) => {
    const configurable = (
      candidate: object,
    ): candidate is { setConfig(key: string, value: unknown): void } =>
      "setConfig" in candidate && typeof candidate.setConfig === "function";
    if (!configurable(app.vault)) throw new Error("no vault settings");
    app.vault.setConfig("alwaysUpdateLinks", value);
  }, always);
}

/** Waits for a note to link to `symbol`, in Obsidian's index. */
async function waitForLink(note: string, symbol: string): Promise<void> {
  await browser.waitUntil(async () =>
    browser.executeObsidian(
      ({ app }, from, to) =>
        (app.metadataCache.resolvedLinks[from]?.[to] ?? 0) > 0,
      note,
      symbol,
    ),
  );
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
    await waitForLink(`Uses ${String(at)}.md`, "gate.ink.png");
  }
}

/** A note's text as its file holds it. */
async function noteText(note: string): Promise<string> {
  return browser.executeObsidian(async ({ app }, path) => {
    const file = app.vault.getFileByPath(path);
    if (file === null) throw new Error(`no ${path}`);
    return app.vault.read(file);
  }, note);
}

/** What a rename can stop in, as on a drive that stopped answering. */
const holdable = {
  /** Obsidian's own move of a file, in the real `renameFile`. */
  move: { owner: "adapter", method: "rename", ending: ".ink.png" },
  /** A note's save, which comes before the move. */
  save: { owner: "adapter", method: "write", ending: ".md" },
  /** A link's update in a note, which comes after the move. */
  link: { owner: "vault", method: "process", ending: ".md" },
} as const;

/** Has `what` wait until {@link letGo}. */
async function hold(what: keyof typeof holdable): Promise<void> {
  await browser.executeObsidian(({ app }, { owner, method, ending }) => {
    const target = owner === "adapter" ? app.vault.adapter : app.vault;
    const original: unknown = Reflect.get(target, method);
    if (typeof original !== "function") throw new Error(`no ${method}`);
    let settle: (failure?: string) => void = () => undefined;
    const gate = new Promise<void>((resolve, reject) => {
      settle = (failure) => {
        if (failure === undefined) resolve();
        else reject(new Error(failure));
      };
    });
    Reflect.set(window, "inklineHeldOwner", owner);
    Reflect.set(window, "inklineHeldMethod", method);
    Reflect.set(window, "inklineSettle", settle);
    Reflect.set(
      target,
      method,
      async (...args: unknown[]): Promise<unknown> => {
        const [first] = args;
        const path =
          typeof first === "object" && first !== null
            ? (Reflect.get(first, "path") as unknown)
            : first;
        if (typeof path === "string" && path.endsWith(ending)) {
          Reflect.set(window, "inklineHeld", true);
          await gate;
        }
        return Reflect.apply(original, target, args) as unknown;
      },
    );
  }, holdable[what]);
}

/** Waits for what {@link hold} held to be reached. */
async function waitForHeld(): Promise<void> {
  await browser.waitUntil(async () =>
    browser.execute(() => Reflect.get(window, "inklineHeld") === true),
  );
}

/** Lets go what {@link hold} held, or fails it with `failure`. */
async function letGo(failure?: string): Promise<void> {
  await browser.executeObsidian(({ app }, reason) => {
    const settle: unknown = Reflect.get(window, "inklineSettle");
    const owner: unknown = Reflect.get(window, "inklineHeldOwner");
    const method: unknown = Reflect.get(window, "inklineHeldMethod");
    if (typeof method === "string") {
      // Held, it became the object's own, over what its prototype has.
      Reflect.deleteProperty(
        owner === "adapter" ? app.vault.adapter : app.vault,
        method,
      );
    }
    for (const key of [
      "inklineSettle",
      "inklineHeldOwner",
      "inklineHeldMethod",
      "inklineHeld",
    ]) {
      Reflect.deleteProperty(window, key);
    }
    if (typeof settle === "function") {
      Reflect.apply(settle, undefined, [reason ?? undefined]);
    }
  }, failure ?? null);
}

/** Has the page note down anything the form says of a wait, however brief. */
async function watchForWait(): Promise<void> {
  await browser.execute(() => {
    Reflect.deleteProperty(window, "inklineSawWait");
    const watcher = new MutationObserver(() => {
      const shown = document.querySelector(".inkline-save-wait");
      if (shown !== null && shown.textContent !== "") {
        Reflect.set(window, "inklineSawWait", true);
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
  return browser.execute(() => {
    const watcher: unknown = Reflect.get(window, "inklineWaitWatcher");
    if (watcher instanceof MutationObserver) watcher.disconnect();
    return Reflect.get(window, "inklineSawWait") === true;
  });
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

  describe("when Obsidian does not finish a rename", function () {
    /** Long enough for a rename to have waited, with a margin for a busy machine. */
    const waited = stalledAfter + 15_000;

    const form = () => browser.$(".inkline-library-rename-form");
    const formButton = (text: "Save" | "Cancel") => form().$(`button=${text}`);
    const waitLine = () => form().$(".inkline-save-wait");

    /** Waits for the form to say its rename waits, and returns what it says. */
    async function waitForWait(): Promise<string> {
      await browser.waitUntil(async () => (await waitLine().getText()) !== "", {
        timeout: waited,
        timeoutMsg: "the form never said its rename waits",
      });
      return waitLine().getText();
    }

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
      await browser.waitUntil(
        async () => (await topButton("Just once")) !== undefined,
      );
      // Obsidian has moved the file by now, and asks only about the links.
      expect(await symbolFiles()).toEqual(["lintel.ink.png"]);
      await browser.pause(stalledAfter + 1500);
      expect(await waitLine().getText()).toBe("");
      expect(await formButton("Cancel").isEnabled()).toBe(false);
      await clickTop("Just once");
      await waitForName("lintel");
      expect(await sawWait()).toBe(false);
      expect(await noteText("Uses 0.md")).toContain("lintel.ink.png");
      expect(await browser.$(".notice*=Renamed").isExisting()).toBe(false);
    });

    it("says nothing of a slow rename that keeps moving, however long it takes", async function () {
      // Longer than the wait, a note at a time, as a much used symbol takes.
      const notes = 5;
      await usedSymbol(notes);
      await showLibrary();
      await beginRename("gate", "lintel");
      await watchForWait();
      await delayVault("process", (stalledAfter * 2) / notes, "before");
      await browser.keys(["Enter"]);
      await nameField().waitForExist({
        reverse: true,
        timeout: stalledAfter * 3 + 15_000,
      });
      expect(await sawWait()).toBe(false);
      for (let at = 0; at < notes; at++) {
        expect(await noteText(`Uses ${String(at)}.md`)).toContain("lintel");
      }
    });

    it("says so of a rename held back, keeps the name, and ends with it", async function () {
      await usedSymbol();
      await showLibrary();
      await beginRename("gate", "lintel");
      await hold("move");
      await browser.keys(["Enter"]);
      await waitForHeld();
      const said = await waitForWait();
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

    for (const [how, leave] of [
      ["Cancel", async () => formButton("Cancel").click()],
      ["Esc", async () => browser.keys(["Escape"])],
    ] as const) {
      it(`leaves a rename held back with ${how}, says it may still finish, and it does`, async function () {
        await usedSymbol();
        await showLibrary();
        await beginRename("gate", "lintel");
        await hold("move");
        // By the mouse, as Save takes the focus with it when it goes off.
        await formButton("Save").click();
        await waitForHeld();
        await waitForWait();
        await leave();
        await waitForName("gate");
        await waitForNotice("may still finish");
        await letGo();
        await waitForName("lintel");
        await waitForNotice("Renamed gate to lintel");
        expect(await noteText("Uses 0.md")).toContain("lintel.ink.png");
      });
    }

    it("says so if a rename left behind fails, with the name typed", async function () {
      await usedSymbol();
      await showLibrary();
      await beginRename("gate", "lintel");
      await hold("move");
      await browser.keys(["Enter"]);
      await waitForHeld();
      await waitForWait();
      await formButton("Cancel").click();
      await waitForName("gate");
      await letGo("the drive went away");
      await waitForNotice(
        "gate could not be renamed to lintel: the drive went away",
      );
      expect(await symbolFiles()).toEqual(["gate.ink.png"]);
    });

    it("refuses a second rename while Obsidian has the first", async function () {
      await usedSymbol();
      await showLibrary();
      await beginRename("gate", "lintel");
      await hold("move");
      await browser.keys(["Enter"]);
      await waitForHeld();
      await waitForWait();
      await formButton("Cancel").click();
      await waitForName("gate");
      await beginRename("gate", "arch");
      await browser.keys(["Enter"]);
      // Obsidian would say this one was done, with nothing renamed.
      await waitForError("Obsidian is still renaming this symbol");
      expect(await nameField().getValue()).toBe("arch");
      await formButton("Cancel").click();
      await letGo();
      await waitForName("lintel");
      expect(await symbolFiles()).toEqual(["lintel.ink.png"]);
    });

    it("gives the form back when a rename held back fails", async function () {
      await usedSymbol();
      await showLibrary();
      await beginRename("gate", "lintel");
      await hold("move");
      await browser.keys(["Enter"]);
      await waitForHeld();
      await waitForWait();
      await letGo("the drive went away");
      await waitForError("the drive went away");
      expect(await waitLine().getText()).toBe("");
      expect(await nameField().getValue()).toBe("lintel");
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
      await addUnsaved("Uses 0.md", "Opening.\n", "start");
      await hold("save");
      await browser.keys(["Enter"]);
      await waitForHeld();
      await waitForWait();
      await formButton("Cancel").click();
      await waitForName("gate");
      expect(await browser.$(".notice*=may still finish").isExisting()).toBe(
        false,
      );
      await letGo();
      // The note's own save goes on, and nothing follows it.
      await browser.waitUntil(async () =>
        (await noteText("Uses 0.md")).startsWith("Opening."),
      );
      await browser.pause(500);
      expect(await symbolFiles()).toEqual(["gate.ink.png"]);
      expect(await noteText("Uses 0.md")).toContain("gate.ink.png");
    });

    it("counts from the answer, for a rename held after Obsidian's question", async function () {
      await usedSymbol();
      await setLinkUpdates(false);
      await showLibrary();
      await beginRename("gate", "lintel");
      await hold("link");
      await browser.keys(["Enter"]);
      await browser.waitUntil(
        async () => (await topButton("Just once")) !== undefined,
      );
      await browser.pause(stalledAfter + 1000);
      await clickTop("Just once");
      await waitForHeld();
      // A question held open that long must not count towards the wait.
      await browser.pause(stalledAfter / 2);
      expect(await waitLine().getText()).toBe("");
      const said = await waitForWait();
      expect(said).toContain("Waiting for Obsidian to finish renaming a file.");
      await letGo();
      await waitForName("lintel");
      await waitForNotice("Renamed gate to lintel");
      expect(await noteText("Uses 0.md")).toContain("lintel.ink.png");
    });

    it("takes the message back when Obsidian's question opens at last", async function () {
      await usedSymbol();
      await setLinkUpdates(false);
      await showLibrary();
      await beginRename("gate", "lintel");
      await hold("move");
      await browser.keys(["Enter"]);
      await waitForHeld();
      await waitForWait();
      await letGo();
      // The move ends, and only then does Obsidian ask about the links.
      await browser.waitUntil(
        async () => (await topButton("Just once")) !== undefined,
      );
      await browser.waitUntil(async () => (await waitLine().getText()) === "");
      expect(await formButton("Cancel").isEnabled()).toBe(false);
      await clickTop("Just once");
      await waitForName("lintel");
      expect(await noteText("Uses 0.md")).toContain("lintel.ink.png");
    });
  });

  describe("with a note holding unsaved text", function () {
    const saved = "The door  ![[gate.ink.png]] today.\n";
    const opening = "Opening unsaved line.\n";
    const renamed = `${opening}The door  ![[lintel.ink.png]] today.\n`;

    /**
     * Opens a note that embeds the symbol, begins renaming it in the library
     * with Obsidian set to ask about links, and adds unsaved text to the note.
     * The text comes last, as the note's blur saves what it holds by then.
     */
    async function renameWithText(): Promise<void> {
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
      await browser.waitUntil(
        async () => (await topButton("Just once")) !== undefined,
      );
      // An editor saves itself two seconds after an edit.
      await browser.pause(2500);
      await clickTop("Just once");
      await waitForName("lintel");
      await waitForPanes("Uses.md", renamed);
      await browser.waitUntil(async () => (await onDisk()) === renamed);
    });

    it("refuses the rename if the note cannot be saved, and changes nothing", async function () {
      await renameWithText();
      const restore = await failSaves();
      try {
        await browser.keys(["Enter"]);
        await waitForError("the note Uses could not be saved first");
      } finally {
        await restore();
      }
      expect(await nameField().getValue()).toBe("lintel");
      expect(await symbolFiles()).toEqual(["gate.ink.png"]);
      expect(await onDisk()).toBe(saved);
      await waitForPanes("Uses.md", `${opening}${saved}`);
      await browser.keys(["Enter"]);
      await clickTop("Just once");
      await waitForName("lintel");
      await waitForPanes("Uses.md", renamed);
      await browser.waitUntil(async () => (await onDisk()) === renamed);
    });
  });
});
