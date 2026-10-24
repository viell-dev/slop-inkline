# Releasing

A release is a GitHub release whose tag is the version, with no `v` prefix,
carrying the three files Obsidian installs: `main.js`, `manifest.json`, and
`styles.css`. The [Release workflow](.github/workflows/release.yml) builds them
from `main`, attests their build provenance, and publishes them with a
`SHA256SUMS` file. Published versions, tags, and release assets are never
replaced: a correction gets a new version. The repository's immutable releases
setting enforces this for published releases.

Versions are plain dotted numbers. Versions below 1.0.0 are published as GitHub
prereleases, which testers install with
[BRAT](https://github.com/TfTHacker/obsidian42-brat). Version 1.0.0 is the first
one submitted to Obsidian's community directory.

The maintaining agents publish a release once it is ready by the steps below,
without asking the owner for each one: GitHub releases are the plugin's channel.
Submitting the plugin to Obsidian's community directory, or a change of what
Inkline is for or where it is distributed, needs the owner's decision.

## Prepare the release pull request

On a branch from `main`:

1. If the release needs a newer Obsidian, raise `minAppVersion` in
   `manifest.json`. Do it here, not in a pull request of its own: until the
   release, `manifest.json` describes the published version, and the unit tests
   refuse a minimum that `versions.json` does not record for it.
2. Run `npm version <version> --no-git-tag-version`. It sets the version in
   `package.json` and `package-lock.json`, then `scripts/release.ts sync` copies
   it to `manifest.json` and maps it to the manifest's `minAppVersion` in
   `versions.json`, which Obsidian reads to offer older versions to older apps,
   and stages both files. Earlier releases keep their entries.
3. Rename `## Unreleased` in `CHANGELOG.md` to `## <version> - <YYYY-MM-DD>`,
   with the planned release date, and add an empty `## Unreleased` above it. The
   section becomes the release notes, so write it for users.
4. Update the user guide in `docs/` for the release: the "No release yet" boxes
   on the home and install pages, and how the release is installed, with BRAT
   for versions below 1.0.0. `test/unit/docs.test.ts` fails until they no longer
   say there is no release.
5. Run `node scripts/release.ts check <version>`, which the workflow runs too:
   it checks that the metadata files agree and that the changelog section
   exists.
6. Have another agent review the release pull request, as
   [AGENTS.md](AGENTS.md#review) requires: everything since the previous
   release, not only the version change. That covers the changes, the open
   defects, the evidence of the tests, compatibility with the Obsidian versions
   the manifest accepts, the files the release ships, the documentation, and
   installing and updating. Prefer a model other than the one that wrote most of
   the changes.

## Prepare without publishing

Run the Release workflow from the Actions tab or with
`gh workflow run release.yml --ref main -f version=<version>`. Without
`publish`, it is a dry run, which changes nothing outside the workflow run:

1. It refuses a commit whose required checks, `verify` on Linux and Windows and
   the end-to-end tests in both Obsidian versions, did not pass, or last passed
   more than a week ago, when the latest Obsidian release may have changed
   since. `node scripts/publish.ts ci <commit>` makes the same check by hand. To
   refresh a week-old commit, run CI on `main` again with
   `gh workflow run ci.yml --ref main`.
2. It runs `npm run check`, and refuses metadata or notes that do not match the
   version.
3. It builds the files and records their checksums.
4. It puts exactly those files in a test vault's plugin folder, where Obsidian
   loads them, in the manifest's `minAppVersion` on its oldest installer and in
   the latest public release, and checks that they are the files built, that the
   plugin loads with their version, commands, and styles, that it saves a symbol
   (`test/e2e/specs/package.e2e.ts`), and that it unloads and loads again
   (`test/e2e/specs/plugin.e2e.ts`). Obsidian's own download of a release, and
   BRAT's, are not exercised before one exists.
5. It uploads the files with the notes and checksums as the `release` artifact,
   and the end-to-end output as `release-e2e-results`.

With no version, it builds `main` as it is, with the `Unreleased` notes. Pull
requests that change the release steps run the dry run too, without step 1, as
their own CI is still running.

## Publish

After the release pull request merges and its checks pass on `main`, run:

```sh
gh workflow run release.yml --ref main -f version=<version> -f publish=true
```

The `prepare` job repeats every step of the dry run. `publish` refuses a version
whose tag already exists, unless it was published from exactly this build,
attests the files' provenance, creates the release as a draft with the files and
checksums, checks that the draft holds exactly those files for this commit, and
then publishes it, which creates the tag on the commit that was built. Versions
below 1.0.0 are marked as prereleases, and later ones as the latest release.

### When publishing fails part way

Run the same command again. Nothing is published until the last step, and a
draft has no tag and cannot be installed, so a second run can repair what the
first left:

- a single draft that holds exactly this build, for this commit, as after a
  failure in the last step, is published as it is, by its id;
- any other draft for the version, as after an upload that broke off, or one for
  another commit, is deleted and one is made again;
- if GitHub cannot say whether the version's tag exists, the run stops without
  changing anything;
- a version published already from exactly this build and commit, as when
  publishing reached GitHub but the run did not see it succeed, is left as it
  is, and the run goes on to verify it;
- any other version whose tag exists is refused, as its files are published and
  never replaced: if the published release is wrong, release a new version.

A draft left by a run that is not run again stays unpublished, and cannot be
installed; the next run for that version deletes it, or remove it by hand with
`gh release delete <version> --repo viell-dev/slop-inkline --yes`, which deletes
only the draft while the version has no tag.

`test/unit/publish.test.ts` runs these cases against a fake GitHub, failing at
each step.

## Verify

The `verify publication` job downloads the published assets, checks them against
`SHA256SUMS`, and verifies each file's attestation. If it fails because GitHub
did not answer, rerun that job alone with `gh run rerun <run-id> --failed`. If
the files or their attestations are wrong, the release is published and stays,
so record the defect and release a new version. To check by hand:

```sh
gh release download <version> --repo viell-dev/slop-inkline --dir check
gh attestation verify check/main.js --repo viell-dev/slop-inkline
```

Once those checks pass, verify the installation channel in a clean synthetic
vault with the current BRAT release:

1. Add `viell-dev/slop-inkline` in BRAT, leave the repository field to start
   validation, select **Latest version**, and enable Inkline. Compare installed
   `main.js` and `styles.css` with the verified downloads byte for byte, and
   compare every value in the installed `manifest.json` with the downloaded
   manifest after parsing both as JSON. BRAT 2.2.0 writes a compact manifest,
   changing its checksum without changing its values. The published downloads
   must still pass their original checksums and attestations above.
2. Draw, save, and reopen a synthetic symbol. Turn Inkline off and on again and
   check that its commands, symbol, and saved preferences remain available.
3. Exercise BRAT's update check and reinstall route, repeating the comparisons
   above and checking the drawing and saved preferences. In BRAT 2.2.0, add the
   repository again with the same version selection to reinstall it; its
   **Choose a single plugin to reinstall** command omits plugins tracked through
   that version selector, including **Latest version**. Also check installation
   of the specific version, which BRAT keeps fixed instead of updating
   automatically. An update check with no newer release verifies that path only;
   record an upgrade separately when a newer release exists.
4. Record the release commit, BRAT and Obsidian versions, downloaded checksums,
   attestation results, installation/update/reinstall results, and any evidence
   limits in the release pull request. Do this for both supported test hosts;
   never invent or modify a published release to simulate an update.

## Documentation

Once the release is published and verified, deploy the site from its tag, so
that the site describes the release users can install:

```sh
gh workflow run pages.yml --ref <version>
```

The workflow builds the commit it runs on and reads the deployed site back. A
correction to that documentation goes on a branch named `docs-<version>` from
the tag, changing only `docs/` and, to mend a defect in the deployment,
`.github/workflows/pages.yml`, `scripts/docs.ts`, or `scripts/lib/docs.ts`,
deployed with `gh workflow run pages.yml --ref docs-<version>`; the tag never
moves. [docs/versions.md](docs/versions.md) describes the rules.

## The community directory

New plugins are submitted through Obsidian's developer dashboard at
community.obsidian.md, which needs the owner's decision and sign-in: ask in an
issue with `Needs: Owner`, as [AGENTS.md](AGENTS.md#labels) describes, once the
release to submit is published. Later versions reach directory users from the
releases on their own. Before submitting, the plugin must pass the directory's
review rules, which `npm run lint` applies.
