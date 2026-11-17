// New symbols whose insertion into Editor.md fails, so that the file exists
// but its embed does not, in end-to-end tests.

import { browser } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import { loadModules } from "./browser.ts";
import { insert, zigzag } from "./editing.ts";
import { draw, waitForStatus } from "./editor.ts";

/**
 * Saves a new symbol whose insertion fails, so that its file exists but its
 * embed does not, then disables and enables Inkline and opens the note
 * again. The editor's draft names the file.
 */
export async function interruptInsertion(): Promise<void> {
  try {
    await failInsertion();
    await obsidianPage.disablePlugin("inkline");
  } finally {
    await unlockNotes();
  }
  await obsidianPage.enablePlugin("inkline");
  await loadModules();
  await obsidianPage.openFile("Editor.md");
}

/**
 * Saves a new symbol whose insertion fails, so that its file exists but its
 * embed does not, and leaves the editor open. Notes stay locked until
 * {@link unlockNotes}.
 */
export async function failInsertion(): Promise<void> {
  await browser.executeObsidian(({ app }) => {
    const vault = app.vault as typeof app.vault & {
      inklineProcess?: typeof app.vault.process;
    };
    vault.inklineProcess = vault.process.bind(vault);
    vault.process = () => Promise.reject(new Error("the note is locked"));
  });
  await insert();
  await draw(zigzag);
  // Show another note in the tab, so that the insertion has to edit the
  // note's file, which fails.
  await showWelcomeInstead();
  await browser.keys(["Control", "s"]);
  await waitForStatus("the note is locked");
}

/** Lets notes be edited again after {@link failInsertion}. */
export async function unlockNotes(): Promise<void> {
  await browser.executeObsidian(({ app }) => {
    const vault = app.vault as typeof app.vault & {
      inklineProcess?: typeof app.vault.process;
    };
    if (vault.inklineProcess !== undefined)
      vault.process = vault.inklineProcess;
  });
}

/**
 * Shows Welcome.md in every tab that shows Editor.md, so that no editor of
 * the note is open and an insertion has to edit its file.
 */
export async function showWelcomeInstead(): Promise<void> {
  const left = await browser.executeObsidian(async ({ app, obsidian }) => {
    const welcome = app.vault.getFileByPath("Welcome.md");
    if (welcome === null) throw new Error("no Welcome.md");
    const showing = () =>
      app.workspace
        .getLeavesOfType("markdown")
        .filter(
          (leaf) =>
            leaf.view instanceof obsidian.MarkdownView &&
            leaf.view.file?.path === "Editor.md",
        );
    for (const leaf of showing()) await leaf.openFile(welcome);
    return showing().length;
  });
  if (left !== 0) throw new Error("a tab still shows Editor.md");
}
