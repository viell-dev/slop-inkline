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

Versions are plain `x.y.z`, with no `v` prefix, build metadata or prerelease
suffix. **An odd minor version is a pre-release, and an even one a public
release:**

| Versions            | What they are                                     |
| ------------------- | ------------------------------------------------- |
| `0.9.0`, `0.9.1`, … | Pre-releases of `1.0.0`, the first public release |
| `1.0.0`, `1.0.1`, … | Public releases; a patch release is a fix         |
| `1.1.0`, `1.1.1`, … | Pre-releases of `1.2.0`, the next public release  |

A line of pre-releases counts its builds in the patch number, and leads to the
next even minor version, or from the last odd minor of a major version to the
next major. Each pre-release carries GitHub's prerelease flag, and its section
of the changelog, which is its release notes, opens by saying its stage:

- **alpha:** features still arrive and change, and the
  [file format](docs/file-format.md#compatibility) is a draft, so a later alpha
  need not open files an earlier one wrote. Releases remain alphas until a
  stable release goal is agreed with the owner, as below.
- **beta:** the features of the agreed stable release goal are complete; fixes
  and polish follow. A beta that needs a new feature gives way to an alpha of
  the next pre-release line.
- **rc:** a build meant to become the public release unchanged, for its last
  checks, including the human pass described below.

**This is an exception to the SemVer prerelease convention,** for a host that
cannot order it. Obsidian compares versions number by number, so its updater
takes `1.0.0-rc.1` for newer than `1.0.0` and would never offer `1.0.0` to
someone who installed the rc, and its community directory accepts only `x.y.z`.
With plain versions, Obsidian, BRAT and SemVer all order releases the same way.
Users tell a pre-release by its odd minor version and its prerelease flag on
GitHub. The owner's decision and the evidence are in
[#141](https://github.com/viell-dev/slop-inkline/issues/141). Revisit it if
Obsidian orders SemVer prerelease versions correctly, or offers a channel for
pre-releases. Releases before `0.9.0` carried SemVer suffixes, as
`0.3.0-alpha.8`, and stay pre-releases; `0.9.0` sorts above all of them, in
either order.

Leaving alpha needs a stable release goal agreed with the owner: what the first
stable release supports, its tasks, formats, and platforms, what stays out, and
when beta, rc, and stable begin. The maintaining agents propose it in an issue
with `Needs: Owner`, record the agreement there, and link it here. With a goal
agreed, they move to beta and rc on the evidence, recorded in the release pull
request; a case the goal does not settle goes back to the owner. The proposed
goal is [#144](https://github.com/viell-dev/slop-inkline/issues/144); the owner
decided on 2026-11-05 that the builds after 0.3.0-alpha.8 are betas.

Each new version must be higher than every published version, in SemVer's order
and in Obsidian's, or someone on that version is never offered it. The two
differ on the old suffixes: Obsidian reads `0.3.0-alpha.8` as the numbers 0, 3,
0, 8, and so ranks it above `0.3.0`. `node scripts/publish.ts order <version>`
checks both against the published releases, and the Release workflow runs it.
This covers public releases too: once `1.1.0` is published, a fix for the public
line is `1.2.0`, not `1.0.1`.

Every release, public or pre-release, is a GitHub release with the install ZIP
and the loose files: Obsidian's own installer and BRAT download `main.js`,
`manifest.json`, and `styles.css` by name, and the ZIP is for installing by
hand, the route the [install guide](docs/install.md) describes. BRAT is an
optional alternative, never a requirement
([#149](https://github.com/viell-dev/slop-inkline/issues/149)). The first public
release, `1.0.0`, is also the first in Obsidian's community directory, which
lists public releases only.

The maintaining agents publish prereleases once ready by the steps below,
without asking the owner for each one: GitHub releases are the plugin's channel.
**Stable publication is on hold by the owner's explicit instruction in
[#5](https://github.com/viell-dev/slop-inkline/issues/5).** Passing human
testing does not lift it. A stable release requires the owner's explicit change
of direction as well as the agreed goal, human evidence, and blocker
dispositions below. The release tracker in #5 links the applicable human test
requests and remaining work.

Submitting the plugin to Obsidian's community directory, or a change of what
Inkline is for or where it is distributed, needs the owner's decision.

## Where a version is recorded

Obsidian reads `manifest.json` from the head of `main`, offers the version it
names to everyone with Inkline from the directory, and downloads that release's
loose files, whatever GitHub's prerelease flag says. So `manifest.json` on
`main` only ever names a public release, and `package.json` names the release a
commit builds. Every pre-release takes the same path, so the steps a listing
depends on are in use before it:

| What                 | Preparing a pre-release            | Preparing a public release        |
| -------------------- | ---------------------------------- | --------------------------------- |
| `package.json`       | The new version                    | The new version                   |
| `manifest.json`      | Unchanged: the last public release | The new version                   |
| `versions.json`      | Unchanged                          | Maps it to `minAppVersion`        |
| `CHANGELOG.md`       | `## <version> - <date>`            | `## <version> - <date>`           |
| The guide's footer   | That version, once published       | That version, once published      |
| `dist/manifest.json` | That version, from `package.json`  | The same bytes as `manifest.json` |

`npm run build` writes `dist/manifest.json` from the repository's manifest with
the version in `package.json`, and the release's `manifest.json` and ZIP are
that file. So a pre-release's assets name its own version, as BRAT and an
installation by hand need, though the commit it tags has an earlier
`manifest.json`. Nothing else differs, and `main.js` and `styles.css` hold no
version. The version comes from the tagged commit rather than from the
workflow's input, so building that commit gives the same bytes, and the
attestations name that commit.

Until `1.0.0`, `manifest.json` stays at `0.9.0`, the last pre-release to reach
it. It has no public release to name, nothing reads it while nothing is listed,
and Obsidian's review refuses `0.0.0` as a placeholder.

`versions.json` is what Obsidian falls back on for an app older than the
manifest's `minAppVersion`: it takes the highest version there that the app can
run. Only public releases belong in it, and it is empty until `1.0.0`.

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
   `manifest.json`. Do it here, not in a pull request of its own: until then
   `manifest.json` describes the published version, and the unit tests check its
   compatibility entry when preparing a public release. Pre-releases are checked
   against their declared minimum in the host matrix. A pre-release's raised
   minimum reaches `main` ahead of the public release, which is safe: an older
   app falls back on `versions.json`, which still maps that release to the
   minimum it was published with.
2. Run `npm version <version> --no-git-tag-version`. It sets the version in
   `package.json` and `package-lock.json`. For a public release,
   `scripts/release.ts sync` then copies it to `manifest.json`, maps it to the
   manifest's `minAppVersion` in `versions.json`, and stages both files. For a
   pre-release it changes neither, as [above](#where-a-version-is-recorded).
3. Rename `## Unreleased` in `CHANGELOG.md` to `## <version> - <YYYY-MM-DD>`,
   with the planned release date, and add an empty `## Unreleased` above it. The
   section becomes the release notes, so write it for users.
4. Update the user guide in `docs/` for the release: the "No release yet" boxes
   on the home and install pages, and the manual ZIP installation and update
   path. `test/unit/docs.test.ts` fails until they no longer say there is no
   release. Remove **Unreleased** labels only from behavior included in this
   release; retain labels for later work.
5. Run `node scripts/release.ts check <version>` and
   `node scripts/publish.ts order <version>`, which the workflow runs too. The
   first checks that `package.json` names the version, that the changelog
   section exists, and that the metadata files agree: a public version is in
   `manifest.json` and `versions.json`, and a pre-release is in neither, with
   `manifest.json` no higher than it. The unit tests hold every commit to the
   same rules, so a pre-release's version cannot reach `main`'s manifest. The
   second needs GitHub, and `GH_TOKEN` if the CLI is not signed in.
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
   version, and a version that is not higher than every published one. A version
   already published passes this step, so that a publication can resume; the
   publish step then accepts only that same build.
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
their own CI is still running. To rehearse a prepared version on its pull
request, once that head's CI has passed, run the workflow on the branch with
`gh workflow run release.yml --ref <branch> -f version=<version>`.

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
is checked at once. Pre-releases, by their odd minor version or a suffix, get
GitHub's prerelease flag; public releases become the latest release.

### Publish a public release straight after it merges

Once Inkline is listed, merging a public release makes `main` offer a version
that has no release yet, and Obsidian's update fails for anyone who tries it
until the release exists. The wait is CI on the merge commit, about 10 minutes,
and the Release workflow, about 2:

1. Finish the review and rehearse the version on the pull request's head, as
   [above](#prepare-without-publishing), before merging.
2. Merge nothing else until the release is out: each merge makes a new commit
   that needs its own CI.
3. Run the publish command as soon as the merge commit's checks pass.
4. If it cannot finish soon, revert the change to `manifest.json` and
   `versions.json` with a pull request, so that `main` names the last public
   release again.

A pre-release has no such wait: merging its preparation changes no version that
Obsidian reads.

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
gh attestation verify check/main.js --repo viell-dev/slop-inkline \
  --source-digest "$(git rev-parse <version>^{commit})"
```

The commit matters most for a pre-release's `manifest.json`, which differs from
the file in that commit by its version. The job checks that version too. After
publication the workflow also extracts the verified downloaded ZIP and compares
every installed file with the loose release assets. Verify the manual
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
community.obsidian.md, which needs the owner's decision and sign-in:
[#141](https://github.com/viell-dev/slop-inkline/issues/141) lists what it takes
and what only the owner can do, and says where the listing material is. The
steps above already keep a pre-release's version off `main`.

The dashboard's automated review runs after each release and can take a plugin
out of search. `npm run lint` holds as errors every rule the review's newest
layer does, in required CI. Obsidian's own action adds checks of the manifest,
the README, the styles and the bundle, but it cannot run in CI until the
repository's Actions settings allow it:
[#155](https://github.com/viell-dev/slop-inkline/issues/155) says what that
takes and records its results.

The review also rebuilds the plugin and compares the result with the release,
which no public check reproduces. Obsidian's action looks for a build at
`dist/main.js` among others, and its plugin's guide treats `dist/` as build
output, but only the dashboard's **Review branch** can show that the review does
too; a clean build of `0.9.0` on Node.js 24 gave the published bytes. The
review's findings appear only in the owner's dashboard.

Two steps can only happen around the listing, and #141 tracks them: recheck on
the day that the `inkline` id is free, and watch the first pre-release after
listing, as whether a GitHub pre-release of a listed plugin starts a scan is not
documented.
