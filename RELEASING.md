# Releasing

A release is a GitHub release whose tag is the version, with no `v` prefix,
carrying the three files Obsidian installs: `main.js`, `manifest.json`, and
`styles.css`, plus `inkline-<version>.zip` containing those files inside an
`inkline/` directory for extraction into `.obsidian/plugins/`, and a copy of
[the format's specification](#the-formats-specification). The
[Release workflow](.github/workflows/release.yml) builds them from `main`,
attests their build provenance, and publishes the loose files, the ZIP, and the
specification with a `SHA256SUMS` file. Published versions, tags, and release
assets are never replaced: a correction gets a new version. The repository's
immutable releases setting enforces this for published releases.

Versions are plain `x.y.z`, with no `v` prefix, build metadata or prerelease
suffix. **An odd minor version is a pre-release, and an even one a public
release:**

| Versions            | What they are                                                                |
| ------------------- | ---------------------------------------------------------------------------- |
| `0.9.0`, `0.9.1`, … | Pre-releases of `1.0.0`, the first public release                            |
| `1.0.0`, `1.0.1`, … | Public releases; a patch is a fix, until `1.1.0` is published                |
| `1.1.0`, `1.1.1`, … | Pre-releases of `1.2.0`, the next public release, which is also the next fix |

A line of pre-releases counts its builds in the patch number, and leads to the
next even minor version, or from the last odd minor of a major version to the
next major. Each pre-release carries GitHub's prerelease flag, and its section
of the changelog, which is its release notes, opens by saying its stage:

- **alpha:** features still arrive and change, and the
  [file format](docs/file-format.md#versions) is a draft, so a later alpha need
  not open files an earlier one wrote. Releases remain alphas until a stable
  release goal is agreed with the owner, as below.
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
request; a case the goal does not settle goes back to the owner. The agreed goal
is [below](#the-stable-release-goal); the owner decided on 2026-11-05 that the
builds after 0.3.0-alpha.8 are betas.

Each new version must be higher than every published version, in SemVer's order
and in Obsidian's, or someone on that version is never offered it. The two
differ on the old suffixes: Obsidian reads `0.3.0-alpha.8` as the numbers 0, 3,
0, 8, and so ranks it above `0.3.0`. `node scripts/publish.ts order <version>`
checks both against the published releases, and the Release workflow runs it.

This covers public releases too. A patch such as `1.0.1` is a fix only until the
next pre-release line starts: once `1.1.0` is published, `1.0.1` is lower than
it and is refused, so a fix for the public line is the next public release,
`1.2.0`. Releases come from `main` alone, so a `1.0.1` built then would hold
`1.1.x` anyway.

Every release, public or pre-release, is a GitHub release with the install ZIP
and the loose files: Obsidian's own installer and BRAT download `main.js`,
`manifest.json`, and `styles.css` by name, and the ZIP is for installing by
hand, the route the [install guide](docs/install.md) describes. From 0.9.4, each
also carries the format's specification, which no installer reads. BRAT is an
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

## The stable release goal

The owner agreed this goal for `1.0.0` in
[#144](https://github.com/viell-dev/slop-inkline/issues/144), changing its
section on formats there, and widened it with readings and translations in
[#187](https://github.com/viell-dev/slop-inkline/issues/187). A change to it is
the owner's decision.

**The first stable release is for** desktop Obsidian, with a mouse or trackpad,
as [#101](https://github.com/viell-dev/slop-inkline/issues/101) decided.

**What it does:**

- Draw a symbol: Pen, Eraser, Ellipse, Polygon, Toggle fill, brush sizes,
  guides, grid, Flat ends, Zoom, and moving the drawing.
- Trace a picture, by hand or with Make ink.
- Insert a symbol, by the insert command or by typing its name after the
  trigger.
- Reuse and manage symbols: the library, renaming, finding uses, Copy from,
  editing one that is used in several places, and readings and translations,
  filled in from the editor or the library, by which the lists find a symbol.
- Show symbols in text in every view, in both themes, in print and in PDF.
- Recover unsaved work from drafts.

**Formats:** `.ink.png`, version 1. Files from before the first public release
need not open, as the owner decided: only those from that release onward have to
stay compatible. From it, every file must keep opening and looking the same, or
be upgraded by a converter.
[#172](https://github.com/viell-dev/slop-inkline/issues/172) records the
format's review.

**Platforms:** Obsidian 1.13.4 and later. Linux is tested in real Obsidian.
Windows and macOS are allowed and expected to work, without tests in the real
host.

**Out of scope:** mobile, pen and touch devices, free brush sizes, colours,
layers, selecting or transforming parts of a drawing, and ready-made symbol
libraries.

**Stages:**

- **Beta:** those features are complete, which means the points of
  [#126](https://github.com/viell-dev/slop-inkline/issues/126) are handled. Then
  only fixes and polish follow.
- **rc:** the owner's report on the beta is handled, no known defect blocks
  ordinary use, and the format has stopped changing.
- **Stable:** the owner's pass on the rc, no release blockers, and the owner's
  explicit word that the hold in
  [#5](https://github.com/viell-dev/slop-inkline/issues/5) is lifted. Nothing
  here lifts it.

**Version:** the first public release is `1.0.0`, and it is the first in
Obsidian's directory, as the owner decided in
[#141](https://github.com/viell-dev/slop-inkline/issues/141) on 2026-11-05. The
builds before it are pre-releases: `0.9.0` is the first beta, `0.9.2` the first
rc, `0.9.3` the second, and `0.9.4` the third.

### Why 0.9.4 is an rc

0.9.3 was the second rc. The owner's pass on it, in
[#212](https://github.com/viell-dev/slop-inkline/issues/212), found it close to
ready and asked for changes before `1.0.0`, so 0.9.3 could not become `1.0.0`
unchanged. 0.9.4 makes them, with the fixes found since, so that `1.0.0` can be
0.9.4 with a new version number and its documents. It meets each of the
conditions above:

- **The owner's reports are handled.** Their report on the beta, `0.9.1`, in
  [#150](https://github.com/viell-dev/slop-inkline/issues/150), was delivered in
  0.9.3. Their pass on 0.9.3 asked for four changes, and each has been
  delivered:
  - symbols on the text's baseline,
    [#261](https://github.com/viell-dev/slop-inkline/issues/261);
  - space between the library's rows, and no stray tooltip,
    [#262](https://github.com/viell-dev/slop-inkline/issues/262);
  - one Quick edit for a symbol's name, readings and translations, with Uses its
    own button, [#263](https://github.com/viell-dev/slop-inkline/issues/263);
  - a double-click on a symbol opening the editor,
    [#264](https://github.com/viell-dev/slop-inkline/issues/264), where Obsidian
    lets a click through.

  They change the interface, so the owner tries 0.9.4 in a pass of its own.

- **No known defect blocks ordinary use.** 0.9.4 fixes the defects that 0.9.3
  left open: [#243](https://github.com/viell-dev/slop-inkline/issues/243),
  [#245](https://github.com/viell-dev/slop-inkline/issues/245),
  [#247](https://github.com/viell-dev/slop-inkline/issues/247),
  [#249](https://github.com/viell-dev/slop-inkline/issues/249), and
  [#250](https://github.com/viell-dev/slop-inkline/issues/250).
  [#238](https://github.com/viell-dev/slop-inkline/issues/238) was closed
  without a change, as its cost is a moment's. Each defect still open is
  recorded with the reason it waits:
  - [#271](https://github.com/viell-dev/slop-inkline/issues/271): rarer layouts
    where the `;;` list's check still reads code differently from Reading view.
    In all but two the list stays closed where it could have opened, and in
    those two no render has shown that Obsidian reads it as code;
  - [#255](https://github.com/viell-dev/slop-inkline/issues/255): a faint line
    along the edges of a symbol in some PDF viewers, not in Obsidian;
  - [#267](https://github.com/viell-dev/slop-inkline/issues/267): in a
    right-to-left interface, the punctuation of Inkline's notices and tooltips,
    which Obsidian draws, moves to the start;
  - [#279](https://github.com/viell-dev/slop-inkline/issues/279): what a Quick
    edit row shows when a read and a save both report something, which never
    changes what is written.

  A symbol can still sit up to about a pixel off the baseline at 100% zoom, a
  little more at other zooms, as the guide's known limits say. The refactoring
  the review of 0.9.2 asked for, #226 to #228, waits until after `1.0.0`, so
  that the build the owner tries is the one that ships.

- **The format has stopped changing.** The review the owner asked for ended
  after ten cycles, with all four reviewers agreeing on the same commit, and
  tests hold its limits and pinned files
  ([#197](https://github.com/viell-dev/slop-inkline/issues/197)). Nothing in
  0.9.4 changes it; each release now carries its specification as an asset.

The owner's pass on it decides what follows, and the hold in
[#5](https://github.com/viell-dev/slop-inkline/issues/5) stands.

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

## The format's specification

Every release from 0.9.4 on carries a copy of
[docs/file-format.md](docs/file-format.md), so that each published version keeps
the document that says what its symbol files hold, even if this repository and
the guide are gone
([#194](https://github.com/viell-dev/slop-inkline/issues/194)). The copy is the
document of the commit the release tags, byte for byte, named by the format's
version in its title and the revision under it:
`inkline-file-format-version-1-revision-1.md` for revision 1 of version 1. The
document tells a version of the format from a revision of itself, so the name
spells out both, and neither number reads as Inkline's own, which the ZIP's name
gives. `node scripts/release.ts specification <directory>` writes the copy, and
refuses a document whose title and revision it cannot read. The publish step
refuses a copy that is not the checkout's own, and the verify job compares the
published copy with the commit's document.

The name gives the revision, not the bytes. From `1.0.0`, a change to the
normative text makes a new revision and so a new name, but an informative
section, such as What Inkline does, can change within one. Until then the
document stays at revision 1, and a change to its normative text moves only the
date under the title, as [AGENTS.md](AGENTS.md#code) says. The date and
`SHA256SUMS` tell such copies apart.

Pre-releases carry it too, so that building, checking, attesting, and verifying
it are in use before `1.0.0`, as the rest of a release's path is. Nothing that
installs Inkline reads it: Obsidian's installer downloads `manifest.json`,
`main.js`, and `styles.css` from the release by name, as
[its guide](https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin) says,
and BRAT looks each up by its exact name among the release's assets
([BRAT 2.2.0](https://github.com/TfTHacker/obsidian42-brat/blob/e61b74abc5c967cd31fb01654b796ad651da6250/src/features/githubUtils.ts#L335-L349)),
as the ZIP and `SHA256SUMS` beside them already show. The install ZIP still
holds only the three plugin files.

The document reads as a file of its own: it links only to its own headings and
to full addresses, and uses none of the guide's own syntax, which
`test/unit/docs.test.ts` keeps true. Its links to the pinned fixtures lead to
`main`, where those files never change from `1.0.0`, and the copy of the
repository that [Archive copies](#archive-copies) asks for holds them too.

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
   layout and bytes, copies the format's specification, and records checksums
   for all five assets.
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
until the release exists. The wait is CI on the merge commit, about 30 minutes,
and the Release workflow, about 2:

1. Finish the review, check that the Directory checks workflow passed on the
   pull request's head, and rehearse the version there, as
   [above](#prepare-without-publishing), before merging.
2. Merge nothing else until the release is out: each merge makes a new commit
   that needs its own CI.
3. Run the publish command as soon as the merge commit's checks pass.
4. If it cannot finish soon,
   [roll back](#if-a-public-release-cannot-be-published).

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
each step, and `test/unit/publish-cli.test.ts` runs them down to the exact `gh`
commands, as no dry run sends them.

### If a public release cannot be published

Run the command again first. If that cannot finish soon, take `main` back to the
last public release, so that Obsidian offers a version that exists.

**Stop every attempt first, and find out what it did.** A run keeps the commit
it started from, so one still queued or running would publish after the rollback
merges, and nothing in it would notice.

1. List every Release run that has not finished, whatever its state, as one
   waiting behind another shows as `pending`, not `queued`, and through every
   page, as `gh run list` stops at the newest few:
   `gh api --paginate repos/viell-dev/slop-inkline/actions/workflows/release.yml/runs --jq '.workflow_runs[] | select(.status != "completed") | .id'`.
   Cancel each with `gh run cancel <run>`, then list them again, until none are
   left: cancelling one lets the next start. Cancelling cannot take back a
   request GitHub has already accepted, which is why the next step comes after
   it.
2. Ask whether the version has a tag, as only a published release has one:
   `git ls-remote --tags origin refs/tags/<version>`.
   - **It has one:** the release is published, so `main` names a version that
     exists and there is nothing to roll back. Go on to [verify](#verify) that
     build. A defect in it gets a new version.
   - **It has none:** the version is still free. Go on below.
   - **GitHub cannot say:** roll back all the same, as a version that exists is
     what users need, but treat the version as possibly published, and ask again
     before going on with it.

Revert the whole release pull request, not only its manifest. `package.json`
names the release a commit builds, and the unit tests refuse a public version
there that `manifest.json` and `versions.json` do not carry, so a partial revert
could not merge. Reverting the merge brings back the files that passed CI before
it: `package.json` and the lockfile with the version they had, `manifest.json`,
`versions.json`, the changelog, and the guide. On a new branch, where
`<merge-commit>` is the release pull request's merge:

```sh
git switch --create revert-<version> origin/main
git revert -m 1 <merge-commit>
```

Merge that as an ordinary pull request. It changes files on `main` only:
published versions, their tags, and their assets stay as they are, and a draft
left behind has no tag, and is replaced by the next run for that version.

To go on with the release, fix what stopped it, then bring the preparation back
on a new branch. Merging the old branch again would change nothing, as Git
counts it as merged, so revert the revert, where `<revert-commit>` is the commit
the revert made:

```sh
git switch --create prepare-<version>-again origin/main
git revert <revert-commit>
```

That restores the whole preparation. Update the changelog's date, and go on from
step 5 of [the release pull request](#prepare-the-release-pull-request), with a
review of what changed. The version stays free while it has no tag, so ask again
as in step 2 before starting. If it turns out to have one, it is published and
`publish.ts` refuses it, so prepare the next version instead.

`test/unit/rollback.test.ts` runs these commands as they stand here, in a
synthetic repository, and puts each state through the checks CI runs.

## Verify

The `verify publication` job downloads the published assets, checks them against
`SHA256SUMS`, verifies each file's attestation, and checks that the copy of the
specification is the commit's `docs/file-format.md`. If it fails because GitHub
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
   `data.json` and vault attachments; turn Inkline on and recheck both. From a
   release before `0.9.2`, the drawing's file and look stay, and it opens as a
   picture to draw over, as [the goal](#the-stable-release-goal) allows.
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
`unzip`, reloads the host, and verifies the unchanged symbol file, note and
preferences through another plugin reload, that the note still shows the symbol,
and that a stroke drawn over it and a new symbol save and reopen. Then, in a
fresh copy of the vault, it leaves the old release's editor open over a saved
symbol with an unsaved stroke, updates the same way, and opens the symbol again.

What the symbol must open as, and what becomes of its draft, go by
`E2E_PREVIOUS_VERSION` alone. From a release before `0.9.2` the symbol is a
picture to draw over, whose status line says why, and the draft is dropped, as
[the install guide](docs/install.md#update) says, so the editor asks nothing.
From `0.9.2` on it is the strokes, and the editor offers the draft back, which
saves both strokes, so that a release that stopped reading either fails with no
change to the check. It runs on both default host versions; inspect the
resulting screenshots as well as the assertions.

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

## Archive copies

For a public release, once it is published and verified and its guide is
deployed, ask two public archives to keep copies, so that the format's
specification outlives this repository and its site
([#194](https://github.com/viell-dev/slop-inkline/issues/194)). Neither needs an
account or a token. Pre-releases skip this step. A failure here changes nothing
about the release: ask again later. Record both results in the release pull
request with the verification.

1. Ask Software Heritage to archive the repository, tags included:

   ```sh
   curl --fail --request POST "https://archive.softwareheritage.org/api/1/origin/save/git/url/https://github.com/viell-dev/slop-inkline/"
   ```

   It answers with the request, whose `save_request_status` is `accepted` for a
   repository on GitHub. The same address without `--request POST` lists the
   requests: wait until the new one's `save_task_status` is `succeeded`, and ask
   again if it is `failed`. Anonymous use is limited to 120 requests an hour.
   Then check that the archive holds the release's tag. The latest visit, from

   ```sh
   curl --fail "https://archive.softwareheritage.org/api/1/origin/https://github.com/viell-dev/slop-inkline/visit/latest/?require_snapshot=true"
   ```

   must have a `date` after the publication and a `status` of `full`, and its
   `snapshot` must list `refs/tags/<version>` first among its `branches` at
   `https://archive.softwareheritage.org/api/1/snapshot/<snapshot>/?branches_from=refs/tags/<version>&branches_count=1`.

2. Ask the Wayback Machine to keep the guide's format page, by opening this
   address in a browser or with:

   ```sh
   curl --fail --output /dev/null "https://web.archive.org/save/https://viell-dev.github.io/slop-inkline/file-format"
   ```

   Anonymous saves are limited to a few a minute, and an answer of 429 means to
   wait and ask again. To check that it took,
   `https://archive.org/wayback/available?url=https://viell-dev.github.io/slop-inkline/file-format&timestamp=<YYYYMMDD>`
   gives the capture closest to that day: its `timestamp` must be from the day
   of the save and its `status` `200`, and the page at its `url` must name the
   release in its footer.

## The community directory

New plugins are submitted through Obsidian's developer dashboard at
community.obsidian.md, which needs the owner's decision and sign-in:
[#141](https://github.com/viell-dev/slop-inkline/issues/141) lists what it takes
and what only the owner can do. [listing/](listing/README.md) holds what the
listing form asks for, and the steps above keep a pre-release's version off
`main`.

The dashboard's automated review runs after each release and can take a plugin
out of search. `npm run lint` holds as errors every rule the review's newest
layer does, in required CI. The Directory checks workflow runs Obsidian's own
action on every pull request, adding checks of the manifest, the README, the
styles, and the bundle. It is not a required check, so that a new rule of
Obsidian's stops no unrelated work, but a failure there needs fixing before a
public release.

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
