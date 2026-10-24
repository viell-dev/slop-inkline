# Install

::: info Prerelease

Inkline 0.1.0 is a GitHub prerelease. Install it with
[BRAT](https://github.com/TfTHacker/obsidian42-brat); Inkline is not in
Obsidian's community plugin directory.

:::

## What you need

- Obsidian **1.13.4 or later** on Windows, macOS, or Linux. Inkline is for
  desktop only: Obsidian's mobile apps do not offer it.
- A vault to try it in. A new vault, or a copy of one, keeps your own notes out
  of the way while you try a prerelease.

Each change is tested in Obsidian 1.13.4, on the oldest installer that can run
it, and in the latest public release of Obsidian.

## Install with BRAT

1. In **Settings → Community plugins**, turn community plugins on if needed,
   browse for **BRAT**, install it, and enable it.
2. In **Settings → BRAT**, choose **Add beta plugin**.
3. Enter `viell-dev/slop-inkline` as the repository, then press **Tab** to leave
   the field and start validation. Wait for the versions to load and select
   **Latest version**. You can select **0.1.0 (Prerelease)** instead to stay on
   that specific version.
4. Leave **Enable after installing the plugin** on and choose **Add plugin**.

Inkline is ready: run **Inkline: Insert symbol** from the command palette in a
note, as [Your first symbol](./start.md) shows. A GitHub token is not needed for
this public repository.

## Install the release files manually

Download `main.js`, `manifest.json`, and `styles.css` from the
[0.1.0 release](https://github.com/viell-dev/slop-inkline/releases/tag/0.1.0).
Put all three in your vault's `.obsidian/plugins/inkline/` folder, then enable
**Inkline** under **Settings → Community plugins**. A vault with a different
configuration folder has its plugins there instead. `SHA256SUMS` records the
files' SHA-256 checksums.

## Build and install a development build

You need [Git](https://git-scm.com/) and [Node.js](https://nodejs.org/) 24 or
later with the npm it ships. A development build can include unreleased changes.

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

With BRAT, run its **Plugins: Check for updates to all beta plugins and UPDATE**
command, or enable **Auto-update plugins at startup** in its settings. A
specific version selected during installation stays fixed until you change it in
BRAT.

For a manual installation, download the newer release's three files and replace
the old ones. For a development build, pull the newer source and run `npm ci`
and `npm run build` again, then copy the three files. Turn Inkline off and on
again under **Settings → Community plugins**, or restart Obsidian.

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
