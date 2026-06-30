# Repository Notes

This is the public Inkline plugin repository. For the product overview and usage surface, read [README.md](README.md).

Keep private planning, investigation notes, and local reference material outside this repository in the parent project container.

## Module map

Source lives in `src/`, with each module holding one responsibility:

- `main.ts` — plugin entry point: registers commands, the settings tab, and the render enhancer, and orchestrates insert/edit/discard flows.
- `ink-file.ts` — `InkFileService`: all vault file IO, `.ink.png` naming and slugging, canvas presets, and blank PNG creation.
- `ink-editor-modal.ts` — `InkEditorModal`: the pen/eraser drawing canvas with undo/redo, rename, and grayscale-flatten on save.
- `render-enhancer.ts` — `RenderEnhancer`: tags rendered ink `<img>` elements, applies display CSS variables, handles click-to-edit, and refreshes previews after a save.
- `markdown-image.ts` — pure helpers for parsing Markdown/wiki image links and building embed Markdown. No Obsidian state beyond the `Editor` cursor.
- `canvas.ts` — shared canvas helpers (`loadImage`, `canvasToPngArrayBuffer`).
- `settings.ts` — settings schema, defaults, and the settings tab.

Keep DOM/canvas helpers in `canvas.ts` and link parsing in `markdown-image.ts` rather than re-inlining them in feature modules.

