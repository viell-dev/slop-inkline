import { browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import { stalledAfter } from "../../../src/notes/file-writes.ts";
import { loadModules } from "../support/browser.ts";
import { inklineOn } from "../support/editing.ts";
import {
  createSymbol,
  delayVault,
  hold,
  holdDecoding,
  letGo,
  openAtMarker,
  startOver,
  undoStubs,
  waitForDelayed,
  waitForHeld,
  waitForHeldDecoding,
} from "../support/editor.ts";
import { setStalledAfter, shortStall } from "../support/stalls.ts";
import {
  holdNextRead,
  holdNextWrite,
  letReadGo,
  letWriteGo,
  waitForHeldRead,
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

  it("starts each test with the users' wait before a save or a rename is said to wait, after one that shortened it", async function () {
    await setStalledAfter(shortStall);
    await startOver();
    expect(
      await browser.executeObsidian(
        ({ plugins }) => plugins.inkline.stalledAfter,
      ),
    ).toBe(stalledAfter);
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
              "inklineReadHeld",
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

  it("starts each test from the vault as it was, after one that failed with a symbol's write held", async function () {
    const original = await noteOnDisk("Editor.md");
    // A write held at its gate, as a test that failed before it let the write
    // go leaves it, and slow once let go, as a busy disk would make it: long
    // enough that a reset that did not wait for it would come first.
    await delayVault("modifyBinary", 3000, "before");
    await holdNextWrite();
    await startWrite("Editor.md", "Text from the test before\n");
    await waitForHeldWrite();
    await startOver();
    // Had the reset not waited for it, the write would land after it.
    await waitForDelayed("modifyBinary");
    expect(await writeOutcome()).toEqual({ written: true });
    expect(await noteOnDisk("Editor.md")).toBe(original);
  });

  it("starts each test from the vault as it was, after one that failed with a note's save held", async function () {
    const original = await noteOnDisk("Editor.md");
    // A save of the note held at hold()'s gate, as a test that failed before
    // it let the save go leaves it, and slow once let go, as a busy disk would
    // make it: long enough that a reset that did not wait for it would come
    // first. The slow write is the adapter's own, under the gate, and the
    // clean-up takes it away with the gate.
    await browser.executeObsidian(({ app }) => {
      const { adapter } = app.vault;
      const write = adapter.write.bind(adapter);
      adapter.write = async (path, data, options) => {
        if (path === "Editor.md") {
          await new Promise((resolve) => window.setTimeout(resolve, 3000));
        }
        await write(path, data, options);
      };
    });
    await hold("save", "Editor.md");
    await browser.executeObsidian(({ app }) => {
      const outcome: { written?: boolean; failure?: string } = {};
      Reflect.set(window, "inklineHeldSave", outcome);
      app.vault.adapter.write("Editor.md", "Text from the test before\n").then(
        () => {
          outcome.written = true;
        },
        (error: unknown) => {
          outcome.failure = error instanceof Error ? error.message : "?";
        },
      );
    });
    await waitForHeld();
    await startOver();
    // Had the reset not waited for it, the save would land after it.
    await browser.waitUntil(
      async () => Object.keys(await writeOutcome("inklineHeldSave")).length > 0,
      { timeoutMsg: "the held save never ended" },
    );
    expect(await writeOutcome("inklineHeldSave")).toEqual({ written: true });
    expect(await noteOnDisk("Editor.md")).toBe(original);
    await browser.execute(() => {
      Reflect.deleteProperty(window, "inklineHeldSave");
    });
  });

  it("resets nothing while a decoding it let go is still under way", async function () {
    // A decoding that, let go, goes on until the test ends it, under the
    // gate. Its end is made here, so that the test ends it whatever fails.
    await browser.execute(() => {
      const decode: unknown = Reflect.get(window, "createImageBitmap");
      let end = (): void => undefined;
      const ended = new Promise<void>((resolve) => {
        end = resolve;
      });
      Reflect.set(window, "inklineEndDecoding", end);
      Reflect.set(window, "inklineOwnCreateImageBitmap", decode);
      Reflect.set(window, "createImageBitmap", async (...args: unknown[]) => {
        await ended;
        if (typeof decode !== "function") throw new Error("no decoding");
        return Reflect.apply(decode, window, args) as unknown;
      });
    });
    try {
      // A file the fixture does not have, which only a reset takes away.
      await browser.executeObsidian(async ({ app }) => {
        await app.vault.create("Extra.md", "Not in the fixture.\n");
      });
      await holdDecoding();
      await browser.execute(() => {
        const outcome: { width?: number; failure?: string } = {};
        Reflect.set(window, "inklineDecoded", outcome);
        createImageBitmap(new ImageData(1, 1)).then(
          (bitmap) => {
            outcome.width = bitmap.width;
            bitmap.close();
          },
          (error: unknown) => {
            outcome.failure = error instanceof Error ? error.message : "?";
          },
        );
      });
      await waitForHeldDecoding();
      expect(await failure(startOver({ letGoBound: 300 }))).toContain(
        "undoStubs() let go what the decoding gate held, and it did not finish within 300 ms",
      );
      expect(await extraOnDisk()).toBe(true);
    } finally {
      await endCall("inklineEndDecoding");
      await browser.execute(() => {
        const own: unknown = Reflect.get(window, "inklineOwnCreateImageBitmap");
        Reflect.deleteProperty(window, "inklineOwnCreateImageBitmap");
        if (typeof own === "function") {
          Reflect.set(window, "createImageBitmap", own);
        }
      });
    }
    // Once it ends, the clean-up goes on, and the reset takes the file away.
    await startOver({ letGoBound: 300 });
    expect(
      await browser.execute((): unknown =>
        Reflect.get(window, "inklineDecoded"),
      ),
    ).toEqual({ width: 1 });
    expect(await extraOnDisk()).toBe(false);
    await browser.execute(() => {
      Reflect.deleteProperty(window, "inklineDecoded");
    });
  });

  it("resets nothing while a symbol's write it let go is still under way, however often it is asked", async function () {
    // A write that, let go, goes on until the test ends it: what the clean-up
    // waits for cannot end by itself, however fast the disk. Its end is made
    // here, so that the test ends it whatever fails.
    await browser.executeObsidian(({ app }) => {
      let end = (): void => undefined;
      const ended = new Promise<void>((resolve) => {
        end = resolve;
      });
      Reflect.set(window, "inklineEndWrite", end);
      app.vault.modifyBinary = () => ended;
    });
    try {
      // A file the fixture does not have, which only a reset takes away.
      await browser.executeObsidian(async ({ app }) => {
        await app.vault.create("Extra.md", "Not in the fixture.\n");
      });
      await holdNextWrite();
      await startWrite("Editor.md", "Text from the test before\n");
      await waitForHeldWrite();
      const named =
        "undoStubs() let go what the next-write gate held, and it did not finish within 300 ms";
      expect(await failure(startOver({ letGoBound: 300 }))).toContain(named);
      expect(await extraOnDisk()).toBe(true);
      // A second clean-up, with nothing left to let go, still waits for it.
      expect(await failure(startOver({ letGoBound: 300 }))).toContain(named);
      expect(await extraOnDisk()).toBe(true);
    } finally {
      await endCall("inklineEndWrite");
    }
    // Once it ends, the clean-up goes on, and the reset takes the file away.
    await startOver({ letGoBound: 300 });
    expect(await writeOutcome()).toEqual({ written: true });
    expect(await extraOnDisk()).toBe(false);
  });

  it("holds one symbol's write, and lets the next go on, through a wrapper over its gate", async function () {
    // A write of Editor.md that, let go, goes on until the test ends it, and
    // every other write as the vault makes it. Its end is made here, so that
    // the test ends it whatever fails.
    await browser.executeObsidian(({ app }) => {
      const write = app.vault.modifyBinary.bind(app.vault);
      let end = (): void => undefined;
      const ended = new Promise<void>((resolve) => {
        end = resolve;
      });
      Reflect.set(window, "inklineEndWrite", end);
      app.vault.modifyBinary = async (file, data, options) => {
        if (file.path !== "Editor.md") return write(file, data, options);
        await ended;
        return write(file, data, options);
      };
    });
    try {
      await holdNextWrite();
      // A wrapper put over the gate, which keeps the gate on the vault where
      // the first write would otherwise have taken it off.
      await delayVault("modifyBinary", 0, "after");
      await startWrite("Editor.md", "Text from the test before\n");
      await waitForHeldWrite();
      await startWrite(
        "Welcome.md",
        "Text from the test before\n",
        "inklineOtherWrite",
      );
      // The second write is not taken for the held one: it goes on, and ends
      // one way or the other, which the check below then reports.
      await browser.waitUntil(
        async () => {
          const outcome = await writeOutcome("inklineOtherWrite");
          return outcome.written !== undefined || outcome.failure !== undefined;
        },
        { timeoutMsg: "the second write was held too" },
      );
      expect(await writeOutcome("inklineOtherWrite")).toEqual({
        written: true,
      });
      expect(await writeOutcome()).toEqual({});
      // The held one is still the gate's: let go, the clean-up waits for it.
      expect(await failure(startOver({ letGoBound: 300 }))).toContain(
        "undoStubs() let go what the next-write gate held, and it did not finish within 300 ms",
      );
    } finally {
      await endCall("inklineEndWrite");
    }
    // Once ended, the write goes to the disk, so the clean-up gets its
    // ordinary time for it here.
    await startOver();
    expect(await writeOutcome()).toEqual({ written: true });
    await browser.execute(() => {
      Reflect.deleteProperty(window, "inklineOtherWrite");
    });
  });
  it("refuses to hold a symbol's read or write while one is held", async function () {
    const file = "Held.ink.png";
    await createSymbol(file);
    const refusal = async (holding: Promise<void>): Promise<string> =>
      holding.then(
        () => "",
        (error: unknown) => (error instanceof Error ? error.message : "?"),
      );
    await holdNextWrite();
    expect(await refusal(holdNextWrite())).toContain(
      "a write is already held: let it go first",
    );
    await holdNextRead(file);
    expect(await refusal(holdNextRead(file))).toContain(
      "a read is already held: let it go first",
    );
    // Once let go, the next can be held.
    await letWriteGo();
    await letReadGo();
    await holdNextWrite();
    await holdNextRead(file);
    await letWriteGo();
    await letReadGo();
  });

  it("holds nothing with a symbol's gate let go before its read or write came", async function () {
    await createSymbol("A.ink.png");
    await createSymbol("B.ink.png");
    /** Whether a gate's read or write is marked as having reached it. */
    async function marked(): Promise<{ read: boolean; write: boolean }> {
      return browser.execute(() => ({
        read: Reflect.get(window, "inklineReadHeld") === true,
        write: Reflect.get(window, "inklineWriteHeld") === true,
      }));
    }
    /** The vault's methods that a gate replaced and left in place. */
    async function replaced(): Promise<string[]> {
      return browser.executeObsidian(({ app }) =>
        ["readBinary", "modifyBinary"].filter((name) =>
          Object.hasOwn(app.vault, name),
        ),
      );
    }
    // A's gate let go before any read came, and then B's set up.
    await holdNextRead("A.ink.png");
    await letReadGo();
    expect(await replaced()).toEqual([]);
    await holdNextRead("B.ink.png");
    // A read of A goes straight on, and is not taken for B's.
    const readOfA = await browser.executeObsidian(async ({ app }) => {
      const found = app.vault.getFileByPath("A.ink.png");
      if (found === null) throw new Error("no A.ink.png");
      return (await app.vault.readBinary(found)).byteLength;
    });
    expect(readOfA).toBeGreaterThan(0);
    expect(await marked()).toEqual({ read: false, write: false });
    // B's read is held at B's gate.
    await browser.executeObsidian(({ app }) => {
      const found = app.vault.getFileByPath("B.ink.png");
      if (found === null) throw new Error("no B.ink.png");
      const outcome: { read?: number; failure?: string } = {};
      Reflect.set(window, "inklineReadOfB", outcome);
      app.vault.readBinary(found).then(
        (bytes) => {
          outcome.read = bytes.byteLength;
        },
        (error: unknown) => {
          outcome.failure = error instanceof Error ? error.message : "?";
        },
      );
    });
    await waitForHeldRead();
    const readOfB = async (): Promise<{ read?: number; failure?: string }> =>
      browser.execute(
        () =>
          Reflect.get(window, "inklineReadOfB") as {
            read?: number;
            failure?: string;
          },
      );
    expect(await readOfB()).toEqual({});
    await letReadGo();
    await browser.waitUntil(async () => (await readOfB()).read !== undefined, {
      timeoutMsg: "B's read stayed held",
    });
    // A write's gate let go before any write came: the next write goes
    // straight on, and nothing marks it as held.
    await holdNextWrite();
    await letWriteGo();
    expect(await replaced()).toEqual([]);
    await browser.executeObsidian(async ({ app }) => {
      const found = app.vault.getFileByPath("A.ink.png");
      if (found === null) throw new Error("no A.ink.png");
      await app.vault.modifyBinary(found, await app.vault.readBinary(found));
    });
    expect(await marked()).toEqual({ read: false, write: false });
    expect(await replaced()).toEqual([]);
    await browser.execute(() => {
      Reflect.deleteProperty(window, "inklineReadOfB");
    });
  });
});

/**
 * Starts a write of `text` to `file` through the vault, without waiting for
 * it, and keeps its outcome under `key` for {@link writeOutcome}.
 */
async function startWrite(
  file: string,
  text: string,
  key = "inklineWriteOutcome",
): Promise<void> {
  await browser.executeObsidian(
    ({ app }, path, body, name) => {
      const found = app.vault.getFileByPath(path);
      if (found === null) throw new Error(`no ${path}`);
      const outcome: { written?: boolean; failure?: string } = {};
      Reflect.set(window, name, outcome);
      app.vault.modifyBinary(found, new TextEncoder().encode(body).buffer).then(
        () => {
          outcome.written = true;
        },
        (error: unknown) => {
          outcome.failure = error instanceof Error ? error.message : "?";
        },
      );
    },
    file,
    text,
    key,
  );
}

/** How the write {@link startWrite} started under `key` ended, if it has. */
async function writeOutcome(key = "inklineWriteOutcome"): Promise<{
  written?: boolean;
  failure?: string;
}> {
  return browser.execute(
    (name) =>
      Reflect.get(window, name) as {
        written?: boolean;
        failure?: string;
      },
    key,
  );
}

/** What a clean-up failed with, or "" if it did not. */
async function failure(cleaning: Promise<void>): Promise<string> {
  return cleaning.then(
    () => "",
    (error: unknown) => (error instanceof Error ? error.message : "?"),
  );
}

/** Ends the call a test keeps going under `key`, if it has not ended. */
async function endCall(key: string): Promise<void> {
  await browser.execute((name) => {
    const end: unknown = Reflect.get(window, name);
    Reflect.deleteProperty(window, name);
    if (typeof end === "function") Reflect.apply(end, undefined, []);
  }, key);
}

/** Whether the vault's folder holds Extra.md, which the fixture does not. */
async function extraOnDisk(): Promise<boolean> {
  return browser.executeObsidian(async ({ app }) =>
    app.vault.adapter.exists("Extra.md"),
  );
}
