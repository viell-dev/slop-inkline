# Install

::: info Prerelease

Inkline is distributed through
[GitHub releases](https://github.com/viell-dev/slop-inkline/releases). It is not
in Obsidian's community plugin directory. Install the release files manually; no
separate installer plugin is needed.

:::

## What you need

- Obsidian **1.13.4 or later** on desktop, with a mouse or a trackpad. Inkline
  is tested on Linux; Windows and macOS should work but are not tested.
  Obsidian's mobile apps do not offer it.
- A vault to try it in. A new vault, or a copy of one, keeps your own notes out
  of the way while you try a prerelease.

Each change is tested in Obsidian 1.13.4, on the oldest installer that can run
it, and in the latest public release of Obsidian. The host tests run on Linux;
see [Promises and evidence](./verification.md) for the tested platforms and
limits.

## Install the ZIP

1. Open the [releases page](https://github.com/viell-dev/slop-inkline/releases)
   and download **inkline-&lt;version&gt;.zip** from the release's **Assets**.
   Take the highest version number: GitHub can list a pre-release numbered 10 or
   more out of order. Every release so far is a pre-release, an alpha such as
   `0.3.0-alpha.1`: its features and its file format can still change, and a
   later one may not open symbols an earlier one saved. GitHub's **Source code**
   archives contain source files, not the built plugin.
2. Extract the ZIP into your vault's `.obsidian/plugins/` directory. The ZIP
   contains its own `inkline/` folder, so the result must be:

   ```text
   .obsidian/plugins/inkline/main.js
   .obsidian/plugins/inkline/manifest.json
   .obsidian/plugins/inkline/styles.css
   ```

   The `.obsidian` directory is hidden on some systems. If your vault uses a
   different configuration directory, use its `plugins/` directory instead.

3. In Obsidian, open **Settings → Community plugins**, turn community plugins on
   if needed, and enable **Inkline**. Restart Obsidian if it is not listed.

Inkline is ready: run **Inkline: Insert symbol** from the command palette in a
note, as [Your first symbol](./start.md) shows.

The ZIP has the same three plugin files as the loose assets. `SHA256SUMS`
records SHA-256 checksums for both. The older 0.1.0 release predates the install
ZIP; use the loose-file steps below for that version.

## Install the loose files

Download `main.js`, `manifest.json`, and `styles.css` from the same GitHub
release. Create `.obsidian/plugins/inkline/` in your vault and put all three
files inside it, then enable **Inkline** under **Settings → Community plugins**.
A vault with a different configuration directory has its plugins there instead.

## Build and install a development build

You need [Git](https://git-scm.com/) and [Node.js](https://nodejs.org/) 24 or
later with the npm it ships. A development build can include unreleased changes.

```sh
git clone https://github.com/viell-dev/slop-inkline.git
cd slop-inkline
npm ci
npm run build
```

The build writes `main.js`, `manifest.json`, and `styles.css` to `dist/`.
Install those three files with the loose-file steps above. To make a local
install ZIP as well, run `node scripts/package.ts dist test-results/package`.

## Update

1. Save any open drawing, then turn Inkline off under **Settings → Community
   plugins**.
2. Download the newer release's install ZIP and extract it into the same
   `.obsidian/plugins/` directory. Replace the three plugin files in `inkline/`;
   keep `data.json`, which stores your preferences. If your tool extracts
   elsewhere, copy only the three plugin files into the existing `inkline/`
   directory rather than replacing the directory. For a loose-file installation,
   replace only those same three files.
3. Turn Inkline on again, or restart Obsidian.

Your drawings remain ordinary PNG attachments in the vault. A symbol saved by a
newer version than the one you have opens with a notice to update Inkline rather
than in the editor, so that it is never saved over by a version that does not
understand it.

## Turn off or remove

Turn Inkline off under **Settings → Community plugins**, or uninstall it there,
which deletes its plugin directory. Your symbols stay in the vault with ordinary
embeds, which Obsidian shows as images, as
[Without Inkline](./without-inkline.md) describes. Turning Inkline off with an
editor open keeps its unsaved strokes as a draft, which the editor offers back
when Inkline is on again.
