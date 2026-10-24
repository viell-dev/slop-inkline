# Releasing

A release is a GitHub release whose tag is the version, with no `v` prefix,
carrying the three files Obsidian installs: `main.js`, `manifest.json`, and
`styles.css`, plus `inkline-<version>.zip` containing those files inside an
`inkline/` directory for extraction into `.obsidian/plugins/`. The
[Release workflow](.github/workflows/release.yml) builds them from `main`,
attests their build provenance, and publishes the loose files and ZIP with a
`SHA256SUMS` file. Published versions, tags, and release assets are never
replaced: a correction gets a new version. The repository's immutable releases
setting enforces this for published releases.

Use SemVer versions without a `v` prefix or build metadata. Release candidates
use a suffix such as `0.1.1-rc.1` and the GitHub prerelease flag; plain versions
such as `0.2.0` are ordinary releases. GitHub-only candidates are installed
manually from the ZIP, with no third-party installer recommendation. The future
community-directory release must use a plain `x.y.z` version, as Obsidian's
[submission requirements](https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin)
specify. Directory submission still needs the owner's decision.

The older `0.1.0` release used a numeric tag with GitHub's prerelease flag. It
is public and immutable: do not rename it, replace assets, or reuse its tag. A
correction is published under a new version, preserving that record.

The maintaining agents publish a release once it is ready by the steps below,
without asking the owner for each one: GitHub releases are the plugin's channel.
Submitting the plugin to Obsidian's community directory, or a change of what
Inkline is for or where it is distributed, needs the owner's decision.

## Prepare the release pull request

On a branch from `main`:

1. If the release needs a newer Obsidian, raise `minAppVersion` in
   `manifest.json`. Do it here, not in a pull request of its own: until the
   release, `manifest.json` describes the published version, and the unit tests
   check its numeric compatibility entry when preparing a plain release.
   Candidates are checked against their declared minimum in the host matrix.
2. Run `npm version <version> --no-git-tag-version`. It sets the version in
   `package.json` and `package-lock.json`, then `scripts/release.ts sync` copies
   it to `manifest.json` and, for a plain release, maps it to the manifest's
   `minAppVersion` in `versions.json`, which Obsidian reads to offer older
   versions to older apps, and stages both files. RCs do not enter this numeric
   directory map; earlier releases keep their entries.
3. Rename `## Unreleased` in `CHANGELOG.md` to `## <version> - <YYYY-MM-DD>`,
   with the planned release date, and add an empty `## Unreleased` above it. The
   section becomes the release notes, so write it for users.
4. Update the user guide in `docs/` for the release: the "No release yet" boxes
   on the home and install pages, and the manual ZIP installation and update
   path. `test/unit/docs.test.ts` fails until they no longer say there is no
   release. Remove **Unreleased** labels only from behavior included in this
   release; retain labels for later work.
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
3. It builds the files, makes a reproducible install ZIP, verifies its exact
   layout and bytes, and records checksums for all four assets.
4. It extracts the ZIP with the system archive tool and puts its `inkline/`
   directory in a test vault's plugin folder, where Obsidian loads them, in the
   manifest's `minAppVersion` on its oldest installer and in the latest public
   release, and checks that they are the files built, that the plugin loads with
   their version, commands, and styles, that it saves a symbol
   (`test/e2e/specs/package.e2e.ts`), and that it unloads and loads again
   (`test/e2e/specs/plugin.e2e.ts`). Downloaded assets are verified after
   publication, when they first exist.
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
with a prerelease suffix are marked as prereleases; plain versions become the
latest release.

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

After publication the workflow also extracts the verified downloaded ZIP and
compares every installed file with the loose release assets. Verify the manual
installation and update journey in a clean synthetic vault on both supported
Obsidian hosts:

1. Extract the ZIP into `.obsidian/plugins/`, enable Inkline, and confirm its
   version, commands, and styles. The release preparation already tested these
   exact extracted bytes; published checksums and attestations tie the download
   to that tested build.
2. Draw, save, and reopen a synthetic symbol. Save a preference, turn Inkline
   off and on, and confirm the drawing and preference survive.
3. For an update, start from the actual previous release, save a synthetic
   drawing and preference, turn Inkline off, and extract the new ZIP into the
   same plugins directory. Replace only the three plugin files, preserving
   `data.json` and vault attachments; turn Inkline on and recheck both.
4. Record the release commit, Obsidian versions, checksums, attestation and
   installation/update results, and evidence limits in the release PR. Never
   invent or modify a published release to simulate an upgrade.

## Documentation

The guide and its corrections live on protected `main`. Once a release is
published and verified, deploy the same main commit with:

```sh
gh workflow run pages.yml --ref main
```

A documentation correction is an ordinary PR to main and deploys after merge.
The workflow builds its own commit and reads every deployed page back. It
refuses any other ref and waits while main's prepared version has not been
published, so users keep the existing installable guide. Unreleased behavior
must be identified explicitly. No documentation branch or tag move is needed;
[docs/versions.md](docs/versions.md) describes the policy.

## The community directory

New plugins are submitted through Obsidian's developer dashboard at
community.obsidian.md, which needs the owner's decision and sign-in: ask in an
issue with `Needs: Owner`, as [AGENTS.md](AGENTS.md#labels) describes, once the
release to submit is published. Later versions reach directory users from the
releases on their own. Before submitting, the plugin must pass the directory's
review rules, which `npm run lint` applies.
