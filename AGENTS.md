# Repository Notes

This is the public Inkline plugin repository. For the product overview and usage
surface, read [README.md](README.md).

Keep private planning, investigation notes, and local reference material outside
this repository in the parent project container.

## Code style

The codebase is functional, not class-based. Rules that keep it that way:

- One exported function, type, or object per file, named after its export in
  camelCase (directories too). Private helpers that are only useful to that
  export stay in the same file. Return-type interfaces co-locate with their
  creator function.
- Classes exist only as thin Obsidian interop shells, built as a final step:
  `InklinePlugin` (`main.ts`), `InklineSettingTab`. The editor uses a plain
  `new Modal(app)` configured in `editor/openInkEditor.ts` instead of a
  subclass. Everything else is functions, closures, and plain records.
- Every tunable constant lives in `src/constants.ts`; many are candidates for
  future settings, so promoting one should only touch that file plus the call
  sites that switch to a settings read. Structural literals (CSS classes, DOM
  selectors) stay with the code that owns them.
- `effect` is used lightly: `Option` for nullable lookups (token at cursor,
  image-file resolution). No Effect runtime, generators, or wrapped async —
  plain `async`/`await` stays. Do not expand effect usage without need.
- No `as any`, avoid `any` entirely; prefer `unknown` and narrowing.

## Module map

Source lives in `src/`, grouped by feature, one export per file:

- `main.ts` — `InklinePlugin`: the required Obsidian Plugin subclass. Only
  wires commands, the `editor-menu` context items (Insert ink / Edit ink),
  the settings tab, the render enhancer, and settings load/save.
- `constants.ts` — every tunable constant, documented, including the export
  width-step ladder (`WIDTH_STEPS`: 0.4/0.6/0.8/1.0 of the square with its
  round-trip epsilon), image/surface sizes, zoom range, and brush table.
- `commands/` — the insert/edit command flows and the cursor→ink-file lookup.
- `editor/` — the drawing editor: `openInkEditor.ts` (Modal interop entry),
  `buildInkEditor.ts` (orchestrator owning the editor state closures), one
  `create*.ts` per UI piece (name field, toolbar, zoom, crop/baseline
  guides, history), plus stroke handling, shortcuts, load, and save. Exports
  crop to the smallest width step whose centered band contains all ink;
  width is recovered from the PNG aspect ratio alone (no metadata).
- `ink/` — pure width-step and image-size math (`snapWidthStep`,
  `snapAspectToWidthStep`, `clampImageSize`, the `WidthStep` type).
- `inkFiles/` — vault file IO and naming: `.ink.png` slugging, display
  names, auto-numbering, create/rename, collision-free stems.
- `markdown/` — pure Markdown/wiki image-link parsing and embed building. No
  Obsidian state beyond the `Editor` cursor.
- `canvas/` — shared canvas helpers: load image, PNG export, grayscale
  flatten, ink-extent measurement.
- `layout/` — shared vertical-layout math: measures the default text font's
  cap height and computes the baseline/cap-line positions and inline
  `vertical-align`. Used by both the editor guides and the render enhancer
  so they stay in sync.
- `render/` — the render enhancer: tags rendered ink `<img>` elements,
  applies display CSS variables, resolves the selected ink image (for the
  edit command), and refreshes previews after a save.
- `settings/` — settings schema, defaults, tab renderer, and the
  `InklineSettingTab` interop shell.

Keep DOM/canvas helpers in `canvas/`, link parsing in `markdown/`, and
vertical-layout math in `layout/` rather than re-inlining them in feature
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
  painting white, and `flattenCanvasToGrayscale` must drop the force-opaque
  step while keeping alpha. Dark mode still needs the invert rule.
- **Alpha-mask + `currentColor` rendering.** The theme-proof endgame: store ink
  as an alpha mask and render it in the surrounding text color via CSS
  `mask-image`, so it matches any theme with no invert hack. More work than a
  plain `<img>` embed; a later milestone.
- **Custom-font alignment.** `layout/` measures only the default text font.
  Aligning to a note's custom font would need per-font metrics and probably a
  setting.
- **Alignment assumptions.** Cap height is measured once and nominal-fallback;
  guides are approximate. `displayHeight` must stay em-based for the
  `vertical-align = -(displayHeight - capHeight)/2` math to hold.
