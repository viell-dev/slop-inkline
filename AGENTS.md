# Repository Notes

This is the public Inkline plugin repository. For the product overview and usage
surface, read [README.md](README.md).

Keep private planning, investigation notes, and local reference material outside
this repository in the parent project container.

## Module map

Source lives in `src/`, with each module holding one responsibility:

- `main.ts` — plugin entry point: registers commands, the `editor-menu` context
  items (Insert ink / Edit ink), the settings tab, and the render enhancer, and
  orchestrates insert/edit/discard flows.
- `ink-file.ts` — `InkFileService`: all vault file IO, `.ink.png` naming and
  slugging, the square canvas geometry and the export width-step ladder
  (`WIDTH_STEPS`: 0.4/0.6/0.8/1.0 of the square, with the snap helpers and
  round-trip epsilon), and blank PNG creation.
- `ink-editor-modal.ts` — `InkEditorModal`: the pen/eraser drawing canvas with
  undo/redo, rename, live width-step detection with pinnable crop/baseline
  guides, and grayscale-flatten on save. Exports crop to the smallest width
  step whose centered band contains all ink; width is recovered from the PNG
  aspect ratio alone (no metadata).
- `render-enhancer.ts` — `RenderEnhancer`: tags rendered ink `<img>` elements,
  applies display CSS variables, resolves the selected ink image (for the edit
  command), and refreshes previews after a save.
- `markdown-image.ts` — pure helpers for parsing Markdown/wiki image links and
  building embed Markdown. No Obsidian state beyond the `Editor` cursor.
- `canvas.ts` — shared canvas helpers (`loadImage`, `canvasToPngArrayBuffer`).
- `layout.ts` — shared vertical-layout math: measures the default text font's
  cap height and computes the baseline/cap-line positions and inline
  `vertical-align`. Used by both the editor guides and the render enhancer so
  they stay in sync.
- `settings.ts` — settings schema, defaults, and the settings tab.

Keep DOM/canvas helpers in `canvas.ts`, link parsing in `markdown-image.ts`, and
vertical-layout math in `layout.ts` rather than re-inlining them in feature
modules.

## Conventions

- Only use documented, public Obsidian API surface. Do not reach into
  undocumented internals (e.g. `MenuItem.setSubmenu`, `Menu.items`, or private
  DOM of core UI like the editor's Insert submenu or the `</>` edit-block
  button). If a nicer integration is only reachable through internals, prefer
  the supported top-level equivalent instead.
- Obsidian's native image right-click menu ("Copy image", "Swap file", "Reset
  size", …) has no documented event to append to, and it stops propagation on
  the image, so a capture-phase listener could only _replace_ it. Replacing the
  native menu is not acceptable, so there is intentionally no "Edit ink" item on
  the image right-click. Ink editing is reached via the `editor-menu` items and
  the `edit-inline-ink-at-cursor` command instead.

## Deferred / to consider

Ideas discussed but intentionally not built yet. Revisit these before reworking
the canvas, background, or alignment:

- **Height trimming.** Only width is trimmed (to a centered width-step band);
  height is always the full square, so the ascender/descender regions are
  reserved even when empty. Trimming height is harder than width because
  vertical position is baseline-relative — a height-trimmed image would need
  a stored baseline offset to re-anchor inline, unlike the width crop which
  needs no metadata.
- **Transparent background.** The pipeline currently stores opaque white and
  inverts the whole image in dark mode. A transparent background would blend
  better on off-white light themes and stop antialiased edges from haloing, and
  would make the reserved ascender/descender regions invisible. Cost: the eraser
  must become a `destination-out` composite (erase to transparent) instead of
  painting white, and `forceGrayscaleOpaque` must drop the force-opaque step
  while keeping alpha. Dark mode still needs the invert rule.
- **Alpha-mask + `currentColor` rendering.** The theme-proof endgame: store ink
  as an alpha mask and render it in the surrounding text color via CSS
  `mask-image`, so it matches any theme with no invert hack. More work than a
  plain `<img>` embed; a later milestone.
- **Custom-font alignment.** `layout.ts` measures only the default text font.
  Aligning to a note's custom font would need per-font metrics and probably a
  setting.
- **Alignment assumptions.** Cap height is measured once and nominal-fallback;
  guides are approximate. `displayHeight` must stay em-based for the
  `vertical-align = -(displayHeight - capHeight)/2` math to hold.
