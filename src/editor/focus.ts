// What the element with the focus keeps for itself, as the editor's keys give
// way to it: the keys that type, in a text field, and the arrow keys, in any
// input, as Make ink's threshold slider moves by them.

/** Whether `element` takes typing: a text field or editable content. */
export function typing(element: Element | null): boolean {
  if (element?.instanceOf(HTMLElement) !== true) return false;
  return (
    element.isContentEditable ||
    element.instanceOf(HTMLTextAreaElement) ||
    element.instanceOf(HTMLSelectElement) ||
    (element.instanceOf(HTMLInputElement) &&
      !["button", "checkbox", "radio", "range", "submit"].includes(
        element.type,
      ))
  );
}

/**
 * Whether `element` keeps the arrow keys: a text field, or any input, as the
 * threshold's slider does.
 */
export function keepsArrows(element: Element | null): boolean {
  return typing(element) || element?.instanceOf(HTMLInputElement) === true;
}
