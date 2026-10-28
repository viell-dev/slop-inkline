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
such as `0.2.0` are ordinary releases. Number a candidate for the version it
would become: once candidates add features, not only fixes, the next one moves
to the next minor version, as `0.1.1-rc.10` was followed by `0.2.0-rc.1`.
GitHub's Releases page and API listed `0.1.1-rc.10` between `rc.4` and `rc.3`,
although its tag, dates, and SemVer order are right; nothing here relies on that
order, and the Pages workflow sorts releases by publication time. GitHub-only
candidates are installed manually from the ZIP, with no third-party installer
recommendation. The future community-directory release must use a plain `x.y.z`
version, as Obsidian's
[submission requirements](https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin)
specify. Directory submission still needs the owner's decision.

The older `0.1.0` release used a numeric tag with GitHub's prerelease flag. It
is public and immutable: do not rename it, replace assets, or reuse its tag. A
correction is published under a new version, preserving that record.

The maintaining agents publish a release once it is ready by the steps below,
without asking the owner for each one: GitHub releases are the plugin's channel.
Submitting the plugin to Obsidian's community directory, or a change of what
Inkline is for or where it is distributed, needs the owner's decision.

## Human release testing

A person must install and use a representative candidate before the first stable
release, including a stable release below 1.0, and before stable delivery of
substantial changes to the interface, interaction, or main user workflow.
Working functions, automated UI checks, agent review, and CI cannot establish
that the product is understandable and usable. Human testing complements all
required automated checks; it does not replace them.

For a routine fix, the release PR may reuse recorded human evidence while the
tested workflow remains representative. Link the report and explain what changed
since the tested build and why no further human pass is needed. Genuine earlier
use can supply evidence with its build, scope, feedback, and limits recorded;
silence, downloads, and a partial test are not blanket acceptance.

1. Prepare a brief practical test of the main user journey, including
   installation, discoverability, ordinary tasks, feedback, and recovery.
   Complete agent verification first. Supply a directly downloadable installable
   build, installation instructions, synthetic inputs, numbered tasks and
   expected outcomes. Ask what felt unclear or awkward as well as what failed,
   and request the build, environment, tested tasks, and remaining untested
   areas. Do not ask a person to build from source or reconstruct a development
   thread.
2. Create or reuse a dedicated issue before requesting the test. Use
   `Type: Maintenance` and `Needs: Human`, or `Needs: Owner` when only the owner
   can supply the answer; never both Needs labels. Assign the person being
   asked, including the owner when asking them under `Needs: Human`. If no
   tester is identified, assign the owner to arrange one. State the stable
   release it blocks, use `Status: Blocked` on the waiting release work, and
   link the request from the release tracker and preparation PR.
3. A prerelease can supply the test build after its required automated checks.
   Create the request before publishing it; add and verify the actual download
   links before handoff, and link the request in the release notes. A dry-run
   artifact is also usable if the recipient can download and install it. Before
   ending the thread, verify the live issue's assignee and labels and link it
   prominently with the pending action and release impact. Publishing a
   candidate or merging preparation does not finish the human request; do not
   close it through a PR closing keyword.
4. Record the person's actual observations separately from the agent's
   assessment. Retain useful partial results, request only missing coverage, and
   retest material fixes in affected workflows. Track and triage reported
   defects. Assess open defects against ordinary use, safety, accessibility, and
   advertised scope: a known-issues entry, enhancement label, or upstream cause
   does not by itself make one acceptable. Fix release blockers. An
   owner-identified blocker remains blocking until fixed or the owner explicitly
   changes its scope; agents cannot silently defer it past stable.
5. Before stable publication, the release PR links the completed human report,
   relevant defect dispositions, candidate-to-final changes, and remaining
   limits. Missing required coverage or unresolved blockers stop publication
   even with green CI. Keep the request open until its answer and resulting work
   are handled, or explicitly supersede it with a linked replacement. Check
   pending requests when maintenance resumes; an issue reply alone does not
   restart an agent unless monitoring is configured.

Agents continue to own implementation, verification, review, packaging,
publication, and follow-up. This gate requires a proportionate human usability
pass, not human code review or repeated approval for every routine release.

For Inkline, use a synthetic vault to draw and insert a symbol, edit it, rename
it, find its uses, and check the result in light and dark themes. Include
whether the drawing controls, guides, save/close behavior, and recovery make
sense.

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
then publishes it, which creates the tag on the commit that was built. GitHub
can list a new draft a few seconds late, so while its list shows no draft at
all, the check lists again, waiting up to 20 seconds in all; any draft it lists
is checked at once. Versions with a prerelease suffix are marked as prereleases;
plain versions become the latest release.

### When publishing fails part way

Run the same command again. Nothing is published until the last step, and a
draft has no tag and cannot be installed, so a second run can repair what the
first left:

- a single draft that holds exactly this build, for this commit, as after a
  failure in the last step, or after GitHub listed the new draft too late, is
  published as it is, by its id;
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

The repeatable update check is `test/e2e/manual/update.e2e.ts`, outside the
ordinary suite because it needs two actual release artifacts. After verifying
the downloaded checksums, extract the previous ZIP. In the Linux test
environment, set `E2E_PLUGIN_DIR` to its extracted `inkline/` directory,
`E2E_PREVIOUS_VERSION` to its version and `E2E_UPDATE_ZIP` to the new downloaded
ZIP. Keep the checkout at the new release commit, then run:

```sh
sh test/e2e/session.sh --spec test/e2e/manual/update.e2e.ts
```

For Docker, mount both artifact paths read-only and pass those variables to the
project's test image. The check refuses missing inputs or a non-temporary vault,
draws with the old release, saves a preference, extracts the new ZIP with
`unzip`, reloads the host, and verifies the unchanged drawing, note and
preferences through another plugin reload. It runs on both default host
versions; inspect the resulting screenshots as well as the assertions.

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
