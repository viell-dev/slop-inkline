import { browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import { loadModules } from "../support/browser.ts";
import { inklineOn } from "../support/editing.ts";
import {
  createSymbol,
  delayVault,
  hold,
  letGo,
  openAtMarker,
  startOver,
  undoStubs,
  waitForDelayed,
  waitForHeld,
} from "../support/editor.ts";
import {
  holdNextRead,
  holdNextWrite,
  waitForHeldWrite,
} from "../support/symbol-text.ts";
import { noteOnDisk } from "../support/vault-files.ts";

describe("The editor", function () {
  before(async function () {
    await loadModules();
  });

  beforeEach(async function () {
    await startOver();
  });

  // A test that fails midway can leave a file operation held or replaced, or
  // Inkline off, which every test after it would then fail on.
  afterEach(async function () {
    await undoStubs();
    if (!(await inklineOn())) {
      await obsidianPage.enablePlugin("inkline");
      await loadModules();
    }
  });

  it("starts each test from the vault as it was, with a note's save under way", async function () {
    const original = await noteOnDisk("Editor.md");
    await openAtMarker("Editor.md", "HERE");
    // A save held across the reset, as a slow disk would hold one, by a delay
    // rather than a gate, as it is the reset itself that has to wait it out.
    await delayVault("modify", 1500, "before");
    await browser.executeObsidian(({ app, obsidian }) => {
      const view = app.workspace.getActiveViewOfType(obsidian.MarkdownView);
      if (view === null) throw new Error("no Markdown view");
      view.editor.setValue("Text from the test before\n");
      void view.save();
    });
    await startOver();
    // Had the reset not waited for it, the save would land after it.
    await waitForDelayed("modify");
    expect(await noteOnDisk("Editor.md")).toBe(original);
  });

  it("starts each test with nothing held, after one that failed with an operation held", async function () {
    /**
     * Reads Editor.md through the vault, or, `process`, changes it into
     * itself, its outcome kept as `key`: not as `error`, which WebdriverIO
     * takes for an error of its own.
     */
    async function startRead(
      key: string,
      how: "read" | "process" = "read",
    ): Promise<void> {
      await browser.executeObsidian(
        ({ app }, name, method) => {
          const file = app.vault.getFileByPath("Editor.md");
          if (file === null) throw new Error("no Editor.md");
          const outcome: { text?: string; failure?: string } = {};
          Reflect.set(window, name, outcome);
          const reading =
            method === "read"
              ? app.vault.read(file)
              : app.vault.process(file, (text) => text);
          reading.then(
            (text) => {
              outcome.text = text;
            },
            (error: unknown) => {
              outcome.failure = error instanceof Error ? error.message : "?";
            },
          );
        },
        key,
        how,
      );
    }
    async function outcomeOf(
      key: string,
    ): Promise<{ text?: string; failure?: string }> {
      return browser.execute((name) => {
        const outcome: unknown = Reflect.get(window, name);
        return outcome ?? {};
      }, key);
    }
    const original = await noteOnDisk("Editor.md");
    // A read held at its gate, as a test that failed between waitForHeld()
    // and letGo() leaves it, and the cleanup that the next test starts with.
    await hold("read", "Editor.md");
    await startRead("inklineEarlierRead");
    await waitForHeld();
    await undoStubs();
    await browser.waitUntil(
      async () => (await outcomeOf("inklineEarlierRead")).failure !== undefined,
      { timeoutMsg: "the earlier read stayed held" },
    );
    expect(await outcomeOf("inklineEarlierRead")).toEqual({
      failure: "The test ended with this held.",
    });
    // The next test's gate, straight after that cleanup, as it would come:
    // it is not reached until its own operation reaches it. Half a second
    // can only show that it is not reached yet, but a gate left marked
    // reached would be seen in the first look, at once.
    await hold("read", "Editor.md");
    const reachedEarly = await waitForHeld(500).then(
      () => true,
      () => false,
    );
    expect(reachedEarly).toBe(false);
    await startRead("inklineLaterRead");
    await waitForHeld();
    expect(await outcomeOf("inklineLaterRead")).toEqual({});
    await letGo();
    await browser.waitUntil(
      async () => (await outcomeOf("inklineLaterRead")).text !== undefined,
      { timeoutMsg: "the later read stayed held" },
    );
    expect(await outcomeOf("inklineLaterRead")).toEqual({ text: original });
    // What Obsidian does itself, as a link's update, is let go instead.
    await hold("link", "Editor.md");
    await startRead("inklineLinkUpdate", "process");
    await waitForHeld();
    await undoStubs();
    await browser.waitUntil(
      async () => Object.keys(await outcomeOf("inklineLinkUpdate")).length > 0,
      { timeoutMsg: "the link's update stayed held" },
    );
    expect(await outcomeOf("inklineLinkUpdate")).toEqual({ text: original });
    // A later test's own replacement of the method that gate held, which a
    // bare letGo() in its finally must leave alone: cleanup took the gate.
    await browser.executeObsidian(({ app }) => {
      const process = app.vault.process.bind(app.vault);
      const own = async (...asked: Parameters<typeof process>) =>
        process(...asked);
      app.vault.process = own;
      Reflect.set(window, "inklineOwnProcess", own);
    });
    try {
      await letGo();
      expect(
        await browser.executeObsidian(
          ({ app }) =>
            Reflect.get(app.vault, "process") ===
            Reflect.get(window, "inklineOwnProcess"),
        ),
      ).toBe(true);
    } finally {
      await browser.executeObsidian(({ app }) => {
        Reflect.deleteProperty(app.vault, "process");
        Reflect.deleteProperty(window, "inklineOwnProcess");
      });
    }
    await browser.execute(() => {
      Reflect.deleteProperty(window, "inklineEarlierRead");
      Reflect.deleteProperty(window, "inklineLaterRead");
      Reflect.deleteProperty(window, "inklineLinkUpdate");
    });
  });

  it("starts each test with nothing held, after one that failed with a symbol's read and write held", async function () {
    const file = "Held.ink.png";
    await createSymbol(file);
    // A write and a read of the symbol held at their gates, as a test of a
    // symbol's text that failed before it let them go leaves them, and the
    // cleanup that the next test starts with. Each outcome is kept as a key
    // of the window: not as `error`, which WebdriverIO takes for its own.
    await holdNextWrite();
    await browser.executeObsidian(async ({ app }, wanted) => {
      const found = app.vault.getFileByPath(wanted);
      if (found === null) throw new Error(`no ${wanted}`);
      const bytes = await app.vault.readBinary(found);
      const outcome: { written?: boolean; failure?: string } = {};
      Reflect.set(window, "inklineHeldWrite", outcome);
      app.vault.modifyBinary(found, bytes).then(
        () => {
          outcome.written = true;
        },
        (error: unknown) => {
          outcome.failure = error instanceof Error ? error.message : "?";
        },
      );
    }, file);
    await waitForHeldWrite();
    await holdNextRead(file);
    // The read reaches its gate in this call: the held method runs up to its
    // wait before it returns.
    await browser.executeObsidian(({ app }, wanted) => {
      const found = app.vault.getFileByPath(wanted);
      if (found === null) throw new Error(`no ${wanted}`);
      const outcome: { read?: number; failure?: string } = {};
      Reflect.set(window, "inklineHeldRead", outcome);
      app.vault.readBinary(found).then(
        (bytes) => {
          outcome.read = bytes.byteLength;
        },
        (error: unknown) => {
          outcome.failure = error instanceof Error ? error.message : "?";
        },
      );
    }, file);
    async function outcomes(): Promise<{
      write: { written?: boolean; failure?: string };
      read: { read?: number; failure?: string };
    }> {
      return browser.execute(() => ({
        write: Reflect.get(window, "inklineHeldWrite") as {
          written?: boolean;
          failure?: string;
        },
        read: Reflect.get(window, "inklineHeldRead") as {
          read?: number;
          failure?: string;
        },
      }));
    }
    expect(await outcomes()).toEqual({ write: {}, read: {} });
    await undoStubs();
    // Let go, as the tests' own clean-up let them go before this one did.
    await browser.waitUntil(
      async () => {
        const { write, read } = await outcomes();
        return Object.keys(write).length > 0 && Object.keys(read).length > 0;
      },
      { timeoutMsg: "the held read or write stayed held" },
    );
    const { write, read } = await outcomes();
    expect(write).toEqual({ written: true });
    expect(Object.keys(read)).toEqual(["read"]);
    expect(read.read).toBeGreaterThan(0);
    // Nothing of the gates is left for the next test's own to be taken for:
    // a held write marked reached, a way to let one go, or a replaced method.
    expect(
      await browser.executeObsidian(({ app }) => [
        ...Object.keys(window).filter(
          (key) =>
            [
              "inklineLetReadGo",
              "inklineLetWriteGo",
              "inklineWriteHeld",
            ].includes(key) || key.startsWith("inklineAtEnd-"),
        ),
        ...["readBinary", "modifyBinary"].filter((name) =>
          Object.hasOwn(app.vault, name),
        ),
      ]),
    ).toEqual([]);
    await browser.execute(() => {
      Reflect.deleteProperty(window, "inklineHeldWrite");
      Reflect.deleteProperty(window, "inklineHeldRead");
    });
  });
});
