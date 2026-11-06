// Steps for reading and choosing from Obsidian's menus, and for the symbol
// editor a menu opens, in end-to-end tests.

import { browser } from "@wdio/globals";
import { waitForEditor } from "./editor.ts";

/** The titles of the menu that is open, top first. */
export async function menuItems(): Promise<string[]> {
  return browser.execute(() =>
    Array.from(document.querySelectorAll(".menu .menu-item-title")).map(
      (item) => item.textContent,
    ),
  );
}

/** Chooses the open menu's item `title`. */
export async function choose(title: string): Promise<void> {
  const chosen = await browser.execute((wanted) => {
    const item = Array.from(
      document.querySelectorAll(".menu .menu-item-title"),
    ).find((found) => found.textContent === wanted);
    const button = item?.closest(".menu-item");
    if (!button?.instanceOf(HTMLElement)) return false;
    button.click();
    return true;
  }, title);
  if (!chosen) throw new Error(`no menu item "${title}"`);
}

/** The name of the symbol the open editor edits, from its title. */
export async function editorName(): Promise<string> {
  await waitForEditor();
  return browser.execute(() => {
    const title = document.querySelector(".inkline-editor .modal-title");
    const field = title?.querySelector("input");
    return field?.value ?? title?.textContent ?? "";
  });
}

/**
 * Where the focus is, what menus and modals are open, and where the last
 * Escape key went and whether anything handled it, as JSON. Watching for
 * Escape starts with the first call. #78 asks for this if the editor ever
 * stays open after Escape again.
 */
export async function escapeState(): Promise<string> {
  return browser.execute(() => {
    const root = document.documentElement;
    const describe = (target: EventTarget | null): string => {
      if (!(target instanceof Element)) {
        return target === null ? "none" : target.constructor.name;
      }
      const classes = Array.from(target.classList).join(".");
      return `${target.tagName.toLowerCase()}${classes === "" ? "" : `.${classes}`}`;
    };
    if (!root.hasAttribute("data-inkline-escape-watch")) {
      root.setAttribute("data-inkline-escape-watch", "");
      window.addEventListener(
        "keydown",
        (event) => {
          if (event.key !== "Escape") return;
          const target = describe(event.target);
          // After every handler has had the event.
          window.setTimeout(() => {
            root.setAttribute(
              "data-inkline-last-escape",
              JSON.stringify({ target, handled: event.defaultPrevented }),
            );
          }, 0);
        },
        { capture: true },
      );
    }
    return JSON.stringify({
      focus: describe(document.activeElement),
      windowFocused: document.hasFocus(),
      menus: document.querySelectorAll(".menu").length,
      modals: Array.from(document.querySelectorAll(".modal-container")).map(
        (container) => describe(container.querySelector(".modal")),
      ),
      lastEscape: root.getAttribute("data-inkline-last-escape"),
    });
  });
}

/** Closes the open editor, which has no changes. */
export async function closeEditor(): Promise<void> {
  const before = await escapeState();
  await browser.keys(["Escape"]);
  try {
    await browser.$(".inkline-editor").waitForExist({ reverse: true });
  } catch (error) {
    throw new Error(
      `the editor stayed open after Escape (#78): before ${before}, after ${await escapeState()}`,
      { cause: error },
    );
  }
}
