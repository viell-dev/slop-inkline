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

/**
 * Holds back the load of the next menu to show, and returns what lets it run,
 * which answers how many it held. A menu takes the keyboard only as it loads,
 * in a timer of its own, which can run after it has been chosen from.
 */
export async function holdMenuLoad(): Promise<() => Promise<number>> {
  await browser.executeObsidian(({ obsidian }) => {
    const menu = obsidian.Menu.prototype;
    const load: unknown = Reflect.get(menu, "load");
    if (typeof load !== "function") throw new Error("a menu has no load");
    const held: (() => void)[] = [];
    Reflect.set(window, "inklineHeldLoads", { load, held });
    Reflect.set(menu, "load", function (this: unknown): void {
      held.push(() => {
        Reflect.apply(load, this, []);
      });
    });
  });
  return () =>
    browser.executeObsidian(({ obsidian }) => {
      const { load, held } = Reflect.get(window, "inklineHeldLoads") as {
        load: unknown;
        held: (() => void)[];
      };
      Reflect.set(obsidian.Menu.prototype, "load", load);
      for (const run of held) run();
      return held.length;
    });
}

/**
 * Has the next menu to show choose its item `title` itself, the moment the
 * menu is there, which is before Obsidian's timer can load it.
 */
export async function chooseOnShowing(title: string): Promise<void> {
  await browser.execute((wanted) => {
    const watcher = new MutationObserver(() => {
      const item = Array.from(
        document.querySelectorAll(".menu .menu-item-title"),
      ).find((found) => found.textContent === wanted);
      const button = item?.closest(".menu-item");
      if (!button?.instanceOf(HTMLElement)) return;
      watcher.disconnect();
      button.click();
    });
    watcher.observe(document.body, { childList: true });
  }, title);
}

/**
 * Waits for the open menu to take the keyboard. Timers of the same length run
 * in order, so this one comes after the one that loads the menu; until then
 * Escape does nothing to the menu. Call it with the main window active, as
 * Obsidian sets that timer there, even for a menu in a popout window.
 */
export async function menuLoaded(): Promise<void> {
  await browser.execute(
    () =>
      new Promise<void>((resolve) => {
        window.setTimeout(resolve, 0);
      }),
  );
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
 * Escape starts with the first call. This is what found the cause of #78,
 * and it says where to look if the editor ever stays open after Escape again.
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
