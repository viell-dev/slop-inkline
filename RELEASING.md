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
4. Run `node scripts/release.ts check <version>`, which the workflow runs too:
   it checks that the metadata files agree and that the changelog section
   exists.
5. Have another agent review the release pull request, as
   [AGENTS.md](AGENTS.md#review) requires: everything since the previous
   release, not only the version change. That covers the changes, the open
   defects, the evidence of the tests, compatibility with the Obsidian versions
   the manifest accepts, the files the release ships, the documentation, and
   installing and updating. Prefer a model other than the one that wrote most of
   the changes.

## Prepare without publishing

Run the Release workflow from the Actions tab or with
`gh workflow run release.yml --ref main -f version=<version>`. Without
`publish`, it is a dry run: it runs the checks, refuses metadata or notes that
do not match the version, builds the files, and uploads them with the notes and
checksums as the `release` artifact. With no version, it builds `main` as it is,
with the `Unreleased` notes. Pull requests that change the release steps run the
dry run too.

## Publish

After the release pull request merges and its checks pass on `main`, run:

```sh
gh workflow run release.yml --ref main -f version=<version> -f publish=true
```

The `prepare` job repeats the checks and the build. `publish` refuses a version
whose tag already exists, attests the files' provenance, creates the release as
a draft with the files and checksums, and then publishes it, which creates the
tag on the commit that was built. Versions below 1.0.0 are marked as
prereleases, and later ones as the latest release.

## Verify

The `verify publication` job downloads the published assets, checks them against
`SHA256SUMS`, and verifies each file's attestation. To check by hand:

```sh
gh release download <version> --repo viell-dev/slop-inkline --dir check
gh attestation verify check/main.js --repo viell-dev/slop-inkline
```

## Documentation

Once a release is published, the Pages workflow deploys the site from its tag,
so that the site describes the release users can install, and reads it back. A
correction to that documentation goes on a branch named `docs-<version>` from
the tag, changing only `docs/`, deployed with
`gh workflow run pages.yml --ref main -f ref=docs-<version>`; the tag never
moves. [docs/versions.md](docs/versions.md) describes the rules.

## The community directory

New plugins are submitted through Obsidian's developer dashboard at
community.obsidian.md, which needs the owner's decision and sign-in: ask in an
issue with `Needs: Owner`, as [AGENTS.md](AGENTS.md#labels) describes, once the
release to submit is published. Later versions reach directory users from the
releases on their own. Before submitting, the plugin must pass the directory's
review rules, which `npm run lint` applies.
