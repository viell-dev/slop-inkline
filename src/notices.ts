// Inkline's notices. A notice is Obsidian's, in an element every plugin's
// notices share, which a right-to-left interface lays out from the right, and
// that moves the full stop at the end of an English sentence to its start
// (#267). Each notice Inkline shows is marked as its own, so that styles.css
// keeps its English in order without changing anyone else's.

import type { Notice } from "obsidian";

/** The class the message of each of Inkline's notices gets. */
export const noticeClass = "inkline-notice";

/**
 * Marks `notice` as Inkline's, and gives it back, as in
 * `markNotice(new Notice("…"))`. The notice is made where it is shown, so
 * that Obsidian's lint rules still read its words there; a lint rule of
 * Inkline's refuses a notice that is not marked.
 */
export function markNotice(notice: Notice): Notice {
  notice.messageEl.addClass(noticeClass);
  return notice;
}

/** What a notice says of `error`. */
export function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
