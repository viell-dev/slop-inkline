import { browser, expect } from "@wdio/globals";
import { loadModules } from "../support/browser.ts";
import {
  draw,
  openAtMarker,
  startOver,
  waitForEditor,
  waitForNotice,
  waitForStatus,
} from "../support/editor.ts";
import {
  closeTabs,
  createNote,
  marked,
  next,
  save,
  setLinkUpdates,
  showAs,
  waitForFile,
  waitForNote,
  zigzag,
} from "../support/insertion.ts";

/** Writes `text` to the note's file as it is, as another program would. */
async function writeFile(path: string, text: string): Promise<void> {
  await browser.executeObsidian(
    async ({ app }, file, written) => {
      const note = app.vault.getFileByPath(file);
      if (note === null) throw new Error(`no ${file}`);
      await app.vault.modify(note, written);
    },
    path,
    text,
  );
}

describe("Line endings a note's file changes to", function () {
  before(async function () {
    await loadModules();
  });

  beforeEach(async function () {
    await startOver();
  });

  const lf = "first\nleft  right\nlast\n";
  const crlf = lf.replaceAll("\n", "\r\n");

  /** Opens the editor for a symbol between `left ` and ` right`. */
  async function insertBetween(path: string): Promise<void> {
    await createNote(path, lf.replace("  right", " HERE right"));
    await openAtMarker(path, "HERE");
    await browser.executeObsidianCommand("inkline:insert-symbol");
    await waitForEditor();
    await draw(zigzag);
  }

  // The note's editor takes no symbol in either: the file does.
  const away = {
    "in Reading view": (path: string) => showAs(path, "preview"),
    closed: closeTabs,
  };

  for (const [state, leave] of Object.entries(away)) {
    // A place taken with \n, found in a file with \r\n, is the first step of
    // this test, which then goes the other way.
    it(`finds a place taken with \\r\\n in a file ${state} with \\n`, async function () {
      await insertBetween("Ends.md");
      await leave("Ends.md");
      await writeFile("Ends.md", crlf);
      // Taken from that file's text, just after the first symbol.
      await next(1);
      await waitForFile(
        "Ends.md",
        "first\r\nleft ![[001.ink.png]] right\r\nlast\r\n",
      );
      await writeFile("Ends.md", "first\nleft ![[001.ink.png]] right\nlast\n");
      await draw([[0.5, 0.5]]);
      await save();
      await waitForFile(
        "Ends.md",
        "first\nleft ![[001.ink.png]]![[002.ink.png]] right\nlast\n",
      );
    });

    it(`keeps every line ending of a file ${state} with both kinds`, async function () {
      await insertBetween("Ends.md");
      await leave("Ends.md");
      await writeFile("Ends.md", "first\nleft  right\r\nlast\n\r\nend");
      await save();
      await waitForFile(
        "Ends.md",
        "first\nleft ![[001.ink.png]] right\r\nlast\n\r\nend",
      );
    });
  }

  // A note in Reading view takes the symbol through its file as a closed one
  // does, as Inkline counts no editor in Reading view; the line endings of
  // that file are what the tests above keep in both.
  it("adds a line in the file's own ending once its place is gone, closed", async function () {
    await insertBetween("Ends.md");
    await closeTabs("Ends.md");
    await writeFile("Ends.md", "Line one.\r\nLine two.");
    await next(1);
    await waitForNotice("it was added at the end of Ends");
    await waitForFile(
      "Ends.md",
      "Line one.\r\nLine two.\r\n![[001.ink.png]]\r\n",
    );
    await draw([[0.5, 0.5]]);
    await save();
    await waitForFile(
      "Ends.md",
      "Line one.\r\nLine two.\r\n![[001.ink.png]]![[002.ink.png]]\r\n",
    );
  });

  it("keeps a file's line endings through a rename with nothing unsaved", async function () {
    await setLinkUpdates(true);
    await insertBetween("Ends.md");
    // Past the save that taking the marker away set off, which writes \n.
    await browser.pause(2100);
    await showAs("Ends.md", "preview");
    await writeFile("Ends.md", crlf);
    await browser.keys(["Control", "s"]);
    await waitForStatus("Saved");
    await waitForFile(
      "Ends.md",
      "first\r\nleft ![[001.ink.png]] right\r\nlast\r\n",
    );
    await showAs("Ends.md", "source");
    await waitForNote("first\nleft ![[001.ink.png]] right\nlast\n");
    await browser.waitUntil(async () =>
      browser.executeObsidian(
        ({ app }) =>
          (app.metadataCache.resolvedLinks["Ends.md"]?.["001.ink.png"] ?? 0) >
          0,
      ),
    );
    await browser.$(".inkline-editor .inkline-name").setValue("the long gate");
    await save();
    await waitForNote("first\nleft ![[the long gate.ink.png]] right\nlast\n");
    await waitForFile(
      "Ends.md",
      "first\r\nleft ![[the long gate.ink.png]] right\r\nlast\r\n",
    );
  });

  it("finds a place taken from a file with \\r\\n in the note's editor", async function () {
    await insertBetween("Ends.md");
    await showAs("Ends.md", "preview");
    await writeFile("Ends.md", crlf);
    await next(1);
    await showAs("Ends.md", "source");
    await waitForNote("first\nleft ![[001.ink.png]] right\nlast\n");
    await draw([[0.5, 0.5]]);
    await save();
    await waitForNote(
      "first\nleft ![[001.ink.png]]![[002.ink.png]] right\nlast\n",
    );
    expect(await marked("Ends.md")).toEqual([
      "first\nleft ![[001.ink.png]]![[002.ink.png]]| right\nlast\n",
    ]);
  });
});
