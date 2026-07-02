import type { Modal } from "obsidian";

/**
 * Swallow backdrop clicks on the editor modal so a stray click cannot
 * close it.
 *
 * @remarks
 * Obsidian closes a modal when its backdrop is clicked; a stray click just
 * past the canvas edge must not throw away unsaved strokes, so backdrop
 * clicks are stopped before the core handler sees them. Esc and the close
 * button still close the modal (without saving); a blocked click with
 * unsaved changes shows a short toast pointing at those exits.
 *
 * @param modal - The editor modal to protect.
 * @param hasUnsavedChanges - Whether unsaved strokes or an unsaved rename
 *   exist; decides if the blocked click shows the toast.
 */
export function blockBackdropClose(
  modal: Modal,
  hasUnsavedChanges: () => boolean,
): void {
  const bgEl = modal.containerEl.querySelector(".modal-bg");
  if (!bgEl) {
    return;
  }

  let toastEl: HTMLElement | null = null;

  const showUnsavedChangesToast = (): void => {
    toastEl?.remove();

    const nextToastEl = modal.modalEl.createDiv({
      cls: "inkline-unsaved-toast",
      text:
        "Unsaved changes: use Save and Close to keep them, " +
        "or discard with Esc or the close button.",
    });
    nextToastEl.addEventListener("animationend", () => {
      nextToastEl.remove();
      if (toastEl === nextToastEl) {
        toastEl = null;
      }
    });

    toastEl = nextToastEl;
  };

  for (const type of ["pointerdown", "mousedown", "click"] as const) {
    modal.containerEl.addEventListener(
      type,
      (event) => {
        if (event.target !== bgEl) {
          return;
        }

        event.stopImmediatePropagation();
        // Only the final click event raises the toast, so one blocked
        // click cannot stack three of them.
        if (type === "click" && hasUnsavedChanges()) {
          showUnsavedChangesToast();
        }
      },
      { capture: true },
    );
  }
}
