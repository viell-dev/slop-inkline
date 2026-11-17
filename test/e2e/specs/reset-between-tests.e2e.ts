import { browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import { loadModules } from "../support/browser.ts";
import { inklineOn } from "../support/editing.ts";
import {
  delayVault,
  hold,
  letGo,
  openAtMarker,
  undoStubs,
  waitForDelayed,
  waitForHeld,
  startOver,
} from "../support/editor.ts";
import { fileText } from "../support/vault-files.ts";

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
    const original = await fileText("Editor.md");
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
    expect(await fileText("Editor.md")).toBe(original);
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
    const original = await fileText("Editor.md");
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
});
