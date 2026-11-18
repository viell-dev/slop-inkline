// The library's rows and forms for a symbol's readings and translations, in
// end-to-end tests.

import { browser } from "@wdio/globals";

/** Opens the library in the right sidebar. */
export async function showLibrary(): Promise<void> {
  await browser.executeObsidianCommand("inkline:show-library");
  await browser.$(".inkline-library-list").waitForExist();
}

/**
 * The library's row for the symbol at `file`: the first library's, when a
 * test has opened a second.
 */
export function row(file: string): ReturnType<typeof browser.$> {
  return browser.$(`.inkline-library-symbol[data-inkline-path="${file}"]`, {
    strict: false,
  });
}

/** What the row for `file` shows of its values. */
export async function shownValues(file: string): Promise<string> {
  const line = row(file).$(".inkline-library-values");
  return (await line.isExisting()) ? await line.getText() : "";
}

/** Waits for the row of `file` to show `text` among its values. */
export async function waitForValues(file: string, text: string): Promise<void> {
  let shown = "";
  try {
    await browser.waitUntil(async () => {
      shown = await shownValues(file);
      return shown.includes(text);
    });
  } catch (error) {
    throw new Error(`waited for "${text}" in ${file}, and saw "${shown}"`, {
      cause: error,
    });
  }
}

/** Opens Quick edit for `file`, once its fields have read the file. */
export async function openFields(file: string): Promise<void> {
  await row(file).$('[data-inkline-role="edit"]').click();
  await browser.waitUntil(async () => {
    const save = formSave();
    return (await save.isExisting()) && (await save.isEnabled());
  });
}

export const formSave = () =>
  browser.$(".inkline-library-edit-buttons button[type=submit]");

export const formError = () => browser.$(".inkline-library-edit-error");

/** The form's fields are gone, as after a save or a cancel. */
export async function waitForClosedForm(): Promise<void> {
  await browser
    .$(".inkline-library-edit-form", { strict: false })
    .waitForExist({ reverse: true });
}

/** What the open list shows: each row's name, and why it is there. */
export async function rows(): Promise<{ name: string; why: string }[]> {
  return browser.execute(() =>
    Array.from(activeDocument.querySelectorAll(".suggestion-item")).map(
      (item) => ({
        name: item.querySelector(".inkline-suggestion-name")?.textContent ?? "",
        why: item.querySelector(".inkline-values")?.textContent ?? "",
      }),
    ),
  );
}

/** Waits for the open list to show a row named `name`, and returns the rows. */
export async function waitForRow(
  name: string,
): Promise<{ name: string; why: string }[]> {
  let shown: { name: string; why: string }[] = [];
  try {
    await browser.waitUntil(async () => {
      shown = await rows();
      return shown.some((each) => each.name === name);
    });
  } catch (error) {
    throw new Error(`no row "${name}" among ${JSON.stringify(shown)}`, {
      cause: error,
    });
  }
  return shown;
}

/** Saves the library's fields, under an editor or not. */
export function saveFields(): void {
  document
    .querySelector<HTMLFormElement>(".inkline-library-edit-form")
    ?.requestSubmit();
}

/**
 * Opens a second library, and in it the fields of `file` as it is now, under an
 * editor or not, and sets `field`'s value. The library is new so that its row is
 * for what is at the path now, and the first library's fields, which are saving,
 * stay as they are.
 */
export async function fieldsInSecondLibrary(
  file: string,
  field: "reading" | "translation",
  text: string,
): Promise<void> {
  await browser.executeObsidian(async ({ app }) => {
    await app.workspace
      .getLeaf("split")
      .setViewState({ type: "inkline-library", active: false });
  });
  const button = `.inkline-library-symbol[data-inkline-path="${file}"] [data-inkline-role="edit"]`;
  await browser.waitUntil(async () =>
    browser.execute((selector) => {
      const found = document.querySelector<HTMLElement>(selector);
      found?.click();
      return found !== null;
    }, button),
  );
  const unsaved = async (): Promise<boolean> =>
    browser.execute(
      (name, value) => {
        const form = [
          ...document.querySelectorAll<HTMLFormElement>(
            ".inkline-library-edit-form",
          ),
        ].find(
          (each) =>
            each.querySelector<HTMLButtonElement>("button[type=submit]")
              ?.disabled === false,
        );
        const area = form?.querySelector<HTMLTextAreaElement>(
          `textarea[data-inkline-field="${name}"]`,
        );
        if (area === null || area === undefined) return false;
        area.value = value;
        area.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      },
      field,
      text,
    );
  await browser.waitUntil(unsaved);
}

/** How many of the library's fields are open. */
export async function openForms(): Promise<number> {
  return browser.$$(".inkline-library-edit-form").length;
}
