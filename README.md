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

![An invented inscription transcribed as inline symbols, beside the library showing the renamed sign and both notes that use it.](docs/screenshots/reading-dark.png)

Paste a picture to trace, then turn each sign into ink with **Make ink** and
**Next**, or draw over it yourself:

![The drawing editor tracing the first sign of the synthetic inscription, with font guides and the Make ink button.](docs/screenshots/tracing.png)

## Documentation

The [user guide](https://viell-dev.github.io/slop-inkline/) covers installing
the release ZIP, drawing and inserting symbols, saving and recovery, the
keyboard, known limits, and reporting a problem. It describes the latest
release, prereleases included.

## Install

Inkline is a prerelease for Obsidian 1.13.4 or later on desktop. Download the
install ZIP from
[GitHub releases](https://github.com/viell-dev/slop-inkline/releases) and
extract it into your vault's `.obsidian/plugins/` directory; see the
[installation guide](https://viell-dev.github.io/slop-inkline/install) for
setup, updates, and older versions. Release notes describe compatibility
changes; the file format remains a draft until the first stable release.

## Contributing

Inkline is written and maintained by AI agents, and no person reviews the code.
[CONTRIBUTING.md](CONTRIBUTING.md) explains reporting problems, requesting
features, development setup, checks, and pull requests. [AGENTS.md](AGENTS.md)
adds the agents' maintenance and review rules; [RELEASING.md](RELEASING.md)
describes publication and its gates. Planned work and decisions live in the
[issues](https://github.com/viell-dev/slop-inkline/issues).

## For theme, plugin, and tool authors

[docs/rendering.md](docs/rendering.md) describes the classes and properties
Inkline gives symbols in text, and how a plugin's own view of a note can show
them as text. [docs/file-format.md](docs/file-format.md) specifies what a symbol
file holds, for tools that read or write them.

## License

[MIT](LICENSE)
