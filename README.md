# Inkline

Inkline is an Obsidian plugin for small inline grayscale ink images: symbols,
puzzle marks, conlang glyphs, and compact handwritten notation that sit inside
prose like a single character.

The plugin stores each drawing as a normal PNG file in the vault and inserts it
as a standard Obsidian image embed, so notes remain readable if the plugin is
disabled.

Inkline marks editable images with the `.ink.png` filename suffix. New files
follow Obsidian's attachment-location setting exactly, and you can move them
anywhere in the vault.

## Status

Early development. The initial scope is deliberately narrow:

- Inline image embeds.
- Black ink on an opaque white background.
- Pen and eraser tools.
- A square drawing canvas that exports at one of four widths (0.4, 0.6, 0.8,
  or 1.0 of the square), snapped to the smallest centered band that contains
  the drawing, with on-canvas crop and baseline guides that can be pinned.
- Human-readable names with incrementing defaults.

## Usage

Run **Insert inline ink** from the command palette while editing a Markdown
note. Inkline creates a PNG attachment, inserts an image embed, and opens the
editor.

Place the cursor on an Inkline image link, or select a rendered Inkline image in
Live Preview, then run **Edit inline ink at cursor** to reopen it.

## Caveats

- If an ink file is renamed outside Inkline and loses the `.ink.png` suffix, it
  becomes a plain image. Rendering and editability key on that suffix.
- Duplicating a note does not duplicate its ink files. Both notes embed the same
  file, so edits from either note affect both.

## Development

```bash
npm install
npm run build
```

`npm run build` type-checks the TypeScript source, bundles the plugin, and
writes a local test/release payload to:

```text
dist/
  manifest.json
  main.js
  styles.css
```

For manual testing, copy or symlink `dist/` into an Obsidian vault under:

```text
.obsidian/plugins/inkline/
```

Then enable the plugin in Obsidian.

### Source layout

```text
src/
  main.ts             Plugin entry: commands, settings, and editor wiring.
  ink-file.ts         InkFileService: vault IO, naming, canvas geometry.
  ink-editor-modal.ts InkEditorModal: pen/eraser canvas, undo/redo, save.
  render-enhancer.ts  RenderEnhancer: tags and refreshes rendered ink embeds.
  markdown-image.ts   Markdown/wiki image link parsing and embed helpers.
  canvas.ts           Shared canvas helpers (load image, export PNG).
  settings.ts         Settings schema and settings tab.
```
