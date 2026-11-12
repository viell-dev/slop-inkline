# Install

::: info Prerelease

Inkline is distributed through
[GitHub releases](https://github.com/viell-dev/slop-inkline/releases). It is not
in Obsidian's community plugin directory yet; see
[the plan for 1.0.0](#the-community-directory). Install the release files
manually; no separate installer plugin is needed. If you would rather have
updates arrive by themselves, [BRAT](#install-with-brat) is an optional
alternative.

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
   Take the highest version number. Every release so far is a pre-release. From
   0.9.0 on, a pre-release has an odd minor version, such as `0.9.0` or `1.1.2`,
   and a public release an even one, such as `1.0.0`; earlier pre-releases have
   a suffix, such as `0.3.0-alpha.8`. The 0.9 releases lead to 1.0.0: 0.9.0 and
   0.9.1 are betas, and from 0.9.2 on they are release candidates, each meant to
   become 1.0.0 unchanged. The file format is final from 0.9.2, so a symbol
   saved by an earlier version opens as a picture, as [Update](#update) says.
   GitHub's **Source code** archives contain source files, not the built plugin.
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

Your drawings remain ordinary PNG attachments in the vault.

**Updating from a version before 0.9.2:** the file format became final in 0.9.2,
and Inkline no longer reads the strokes of earlier files. Your symbols and the
notes that use them don't change, and they look as they did, but each symbol
opens in the editor as a
[picture to draw over](./recovery.md#pictures-without-strokes), and the editor
says why. Saving one stores strokes from then on. Unsaved drawings kept as
[drafts](./recovery.md#drafts-after-a-crash) by an earlier version are dropped,
so finish what you are drawing before you update.

A symbol saved by a newer version than the one you have opens with a notice to
update Inkline rather than in the editor, so that it is never saved over by a
version that does not understand it.

## Install with BRAT

[BRAT](https://github.com/TfTHacker/obsidian42-brat) is a third-party plugin
that installs other plugins from their GitHub releases and keeps them updated.
It is an optional alternative to the steps above, never a requirement, and it
installs the same `main.js`, `manifest.json`, and `styles.css`. Inkline's tests
show that it works, not that it is safe to use, and BRAT does not check
`SHA256SUMS`.

1. Under **Settings → Community plugins**, turn community plugins on if needed,
   select **Browse**, then install and enable **BRAT**.
2. Run **BRAT: Plugins: Add a beta plugin for testing (with or without
   version)** from the command palette.
3. Enter `viell-dev/slop-inkline` under **Repository** and press Tab. BRAT lists
   the versions once you leave the field.
4. Select **Select a version...** and choose **latest**, to follow every new
   release, or a version number, to stay on that release.
5. Leave **Enable after installing the plugin** on and **GitHub token** empty,
   and select **Add plugin**.

**latest** always takes the highest version number, whether or not GitHub marks
that release as a pre-release: BRAT has no setting to leave pre-releases out.
Every release so far is a pre-release, so it gives you the newest of them. To
stay on public releases once there are some, choose a public version, such as
`1.0.0`, and change it yourself.

With **latest**, BRAT looks for a new version about a minute after Obsidian
starts, unless you turn off **Auto-update plugins at startup** in its settings,
and when you run **BRAT: Plugins: Check for updates to all beta plugins and
UPDATE**. It replaces the three plugin files and reloads Inkline, so you need
not turn it off first. `data.json` and your drawings stay as they are. An open
editor closes when Inkline reloads, and keeps its unsaved strokes as a
[draft](./recovery.md#drafts-after-a-crash), which it offers back when you next
open that symbol, or a new symbol in the same note. Pre-releases are for
testing, so choose a version number if you want to decide when you update.

BRAT never updates a version you chose. To change it, or to move between a
version and **latest**, repeat steps 2 to 5 with your new choice, and BRAT
installs it at once.

## The community directory

**Planned, not available yet.** The plan is that 1.0.0, the first public
release, is also the first release in Obsidian's community plugin directory, so
that you can install it under **Settings → Community plugins → Browse** and
Obsidian offers its updates.

The directory will offer public releases only, those with an even minor version.
Pre-releases stay on the
[releases page](https://github.com/viell-dev/slop-inkline/releases), where every
release keeps its ZIP and loose files, and BRAT remains an optional way to
follow them.

Obsidian offers its updates to every installed plugin with a directory entry,
however you installed it. Someone on a 0.9 pre-release will be offered 1.0.0.
Someone on a later pre-release, such as `1.1.0`, stays on it until a public
release is higher, such as `1.2.0`.

## Turn off or remove

Turn Inkline off under **Settings → Community plugins**, or uninstall it there,
which deletes its plugin directory. Your symbols stay in the vault with ordinary
embeds, which Obsidian shows as images, as
[Without Inkline](./without-inkline.md) describes. Turning Inkline off with an
editor open keeps its unsaved strokes as a draft, which the editor offers back
when Inkline is on again.

**Unreleased:** turning Inkline off also closes **Inkline: Insert existing
symbol**, and stops a rename or a change of readings and translations that the
library is still saving, with a notice saying so, so that you can make it again
once Inkline is on. A rename that Obsidian has not begun, from the library or
the editor, stops at once even if it is waiting for Obsidian to index the vault
or finish another rename.

If you installed Inkline with BRAT, also remove `viell-dev/slop-inkline` from
the **Beta plugin list** in BRAT's settings, with its **×** button, twice: BRAT
otherwise installs it again at its next check. Removing it there leaves the
plugin installed. A plugin added since Obsidian started can be missing from the
list until you restart Obsidian.
