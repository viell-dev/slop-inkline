# Install

::: warning No release yet

Inkline has no release, so the only way to try it is to build it from its
source, as below. Once it has releases, versions below 1.0.0 will be GitHub
prereleases that you install with
[BRAT](https://github.com/TfTHacker/obsidian42-brat), and 1.0.0 will be offered
for Obsidian's community plugin directory.

:::

## What you need

- Obsidian **1.13.4 or later** on Windows, macOS, or Linux. Inkline is for
  desktop only: Obsidian's mobile apps do not offer it.
- To build it: [Git](https://git-scm.com/), and [Node.js](https://nodejs.org/)
  24 or later with the npm it ships.
- A vault to try it in. A new vault, or a copy of one, keeps your own notes out
  of the way while you try an unreleased build.

Each change is tested in Obsidian 1.13.4, on the oldest installer that can run
it, and in the latest public release of Obsidian.

## Build and install a development build

1. Get the source and build it:

   ```sh
   git clone https://github.com/viell-dev/slop-inkline.git
   cd slop-inkline
   npm ci
   npm run build
   ```

   The build writes three files to `dist/`: `main.js`, `manifest.json`, and
   `styles.css`.

2. In your vault's folder, make the folder `.obsidian/plugins/inkline/`, and
   copy the three files into it. The `.obsidian` folder is hidden on macOS and
   Linux; a vault set to use another configuration folder has its plugins there
   instead.
3. In Obsidian, open **Settings → Community plugins**. If community plugins are
   turned off, turn them on.
4. Under **Installed plugins**, turn on **Inkline**. If it is not listed yet,
   reload the list of plugins with the button beside that heading.

Inkline is ready: run **Inkline: Insert symbol** from the command palette in a
note, as [Your first symbol](./start.md) shows.

## Update

Get the newer source and build it again, copy the three files over the old ones,
then turn Inkline off and on again under **Settings → Community plugins**, or
restart Obsidian.

```sh
git pull
npm ci
npm run build
```

A symbol saved by a newer version of Inkline than the one you have opens with a
notice to update Inkline rather than in the editor, so that it is never saved
over by a version that does not understand it.

## Turn off or remove

Turn Inkline off under **Settings → Community plugins**, or uninstall it there,
which deletes its folder. Your symbols stay: they are PNG files in your vault
with ordinary embeds, which Obsidian shows as images, as
[Without Inkline](./without-inkline.md) describes. Turning Inkline off with an
editor open keeps its unsaved strokes as a draft, which the editor offers back
when Inkline is on again.
