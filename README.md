# Inkline

An Obsidian plugin for drawing symbols that no font has, so that you can write
them in your notes as easily as letters. Each symbol sits inside the line of
text like a character, at the text's size and in its color.

It is made for working out invented scripts, such as the languages of puzzle
games like Chants of Sennaar: draw a symbol where you meet it, name it with your
current guess at its meaning, rename it as your reading changes, and find every
note that uses it. Conlang glyphs, ciphers, game marks, and personal shorthand
work the same way.

Each symbol is a normal PNG file in your vault, embedded with a normal image
link, so your notes still show it if you disable or uninstall the plugin.

## Status

Under development, with no release yet; the planned work is in the
[issues](https://github.com/viell-dev/slop-inkline/issues). The first release
needs Obsidian 1.13.4 or later on desktop. This repository is a rewrite of an
earlier prototype; the rewrite changes the file format, the editor, and how
symbols are rendered, and keeps the prototype's files readable.

Inkline is written and maintained by AI agents, and no person reviews the code.
Changes are accepted on their unit tests, on end-to-end tests that run the
plugin in real Obsidian builds, and on review by the agent that wrote them, with
an independent review by another agent for releases and for changes that could
lose or damage a drawing, such as to the file format or saving.
[AGENTS.md](AGENTS.md) holds the agents' rules for this repository, and
[CONTRIBUTING.md](CONTRIBUTING.md) explains how to report a problem or
contribute.

## For theme and plugin authors

[docs/rendering.md](docs/rendering.md) describes the classes and properties
Inkline gives symbols in text, and how a plugin's own view of a note can show
them as text.

## License

[MIT](LICENSE)
