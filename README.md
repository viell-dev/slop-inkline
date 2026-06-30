# Inkline

Inkline is an Obsidian plugin for small inline grayscale ink images: symbols, puzzle marks, conlang glyphs, compact notation, and short handwritten fragments that sit inside prose like a word.

The plugin stores each drawing as a normal PNG file in the vault and inserts it with standard Markdown image syntax, so notes remain readable if the plugin is disabled.

## Status

Early development. The initial scope is deliberately narrow:

- Inline Markdown image embeds.
- Black ink on an opaque white background.
- Pen and eraser tools.
- Small fixed canvas presets.
- Human-readable names with incrementing defaults.

## Usage

Run **Insert inline ink** from the command palette while editing a Markdown note. Inkline prompts for a name, creates a PNG attachment, inserts a Markdown image embed, and opens the editor.

Click an Inkline image in rendered Markdown to reopen it.

## Development

```bash
npm install
npm run build
```

For manual testing, copy or symlink this repository into an Obsidian vault under:

```text
.obsidian/plugins/inkline/
```

Then build and enable the plugin in Obsidian.
