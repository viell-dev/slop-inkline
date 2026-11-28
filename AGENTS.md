# Agent maintenance

Inkline is built, tested, documented, released, and maintained by AI agents.
They follow the owner's general rules for agent-maintained projects, which cover
who decides what, how issues and pull requests are written, verification,
parallel work, attribution, and reports to other projects. This file adds only
what is specific to this repository; [CONTRIBUTING.md](CONTRIBUTING.md) holds
the setup, checks, and tests that apply to everyone.

## What Inkline is

[SCOPE.md](SCOPE.md) says what Inkline is, what it is for, what it covers, and
where it might go, and how to decide whether a request belongs. Read it before
judging a feature, a review finding, or a description of Inkline, and keep it in
step as it says. Where a decision of the owner's, on an issue or a pull request,
differs from it, the decision wins, and that document is what to fix.

In short: Inkline is a desktop Obsidian plugin for notating and reusing the
symbols of a script the person cannot type, whether they are working one out or
making one up. The ideas held in
[#167](https://github.com/viell-dev/slop-inkline/issues/167), and pen input,
wait for the owner, and growing Inkline beyond its agreed core is the owner's
decision.

## Repository boundary

Everything the project needs lives in this repository. Never stage, copy, quote,
or publish content from outside it. Tests, issues, pull requests, and
screenshots use synthetic vaults and drawings only.

## Code

- Write TypeScript as TypeScript: model data with types, narrow `unknown` at
  boundaries with type guards, and never use `any` or `as any`. Casts are for
  validated boundaries only.
- Group code into a few cohesive modules rather than one export per file. Keep
  logic that does not need Obsidian in plain modules with unit tests, and keep
  Obsidian's classes thin.
- The plugin uses web APIs only, no Node.js or Electron modules; the build fails
  on a Node.js import. Tools under `scripts/` and `test/` run in Node.js.
- Scripts are TypeScript that Node.js runs directly, so they use only erasable
  syntax and import files with their `.ts` extension.
- `src/format/` reads and writes symbol files, and `src/ink/` draws them;
  [docs/file-format.md](docs/file-format.md) specifies both. A change to what
  files hold or how strokes are drawn updates that document in the same pull
  request. The pinned files in `test/fixtures/format` and
  `test/fixtures/outline` pin what files hold and how they look.
  `test/fixtures/pinned.sha256` lists the hash of every data file in
  `test/fixtures`, those and the pictures, and
  `test/unit/format/pinned-files.test.ts` fails when a file and the list
  disagree. `test/unit/format/limits.test.ts` writes out each of the format's
  limits as a number, at the limit and just past it, as a test that names a
  constant moves with it.
  - Until the first stable release, a change may still alter the format, and
    files written by earlier pre-releases need not keep opening. Such a change
    updates the pinned files it affects, their lines in that list, and any limit
    it moves in that test in the same pull request, and says in the changelog
    which files stop opening or look different. It is still reviewed as below.
    The format's document stays at revision 1, and a change to its normative
    text updates the date under its title.
  - From `1.0.0`, the first stable release, the pinned files are never changed:
    users' files must keep opening and looking the same, so a new case gets a
    new pinned file, and a change to how a record draws is a new format version,
    as [the format's versions](docs/file-format.md#versions) say. A change to
    that document's normative text makes a new revision, with its number and
    date under the title.
  - From `1.0.0`, `pinned.sha256` only grows: a new pinned file adds a line, and
    no line ever changes or goes. A wrong hash means the change that caused it
    is wrong, so fix that change, and never update the list to make the test
    pass, even when a new browser makes the pinned files look like the easy
    thing to regenerate: they are the only record of how symbols looked. CI
    enforces this on every pull request: `npm run check:pinned` fails when a
    line the list had in a release from `1.0.0` on, by its immutable tag, is
    missing or different now. Such a failure means the change is wrong, as a
    wrong hash does: never update the list, the tags, or the check to pass it.
    The limits in `limits.test.ts` are as fixed: a number there changes only
    with a new format version, which keeps the old one's.
  - `src/ink/freehand.ts` is part of the format, adapted from perfect-freehand
    so that no package update can change it. Keep it and the steps in the
    format's document saying the same thing.
- `src/editor/drafts.ts` keeps unsaved drawings as drafts in the vault's local
  storage, in a layout that `draftVersion` names. A draft outlives the version
  that kept it, through an update and through going back to an earlier version,
  as with BRAT or an older ZIP, so no version deletes or rewrites one it cannot
  read. From `1.0.1`, a version keeps a draft whose `version` is higher than its
  own as it is, never offers it, says so when its symbol opens, and keeps every
  base layer whose key, in the form below, is in one of its strings or property
  names, until 30 days after its `savedAt`, or for good if that cannot be read;
  `1.0.0` and earlier delete such drafts.
  - A change to the layout raises `draftVersion`, and reads or converts drafts
    of the previous layout, with a unit test that keeps a stored draft of that
    layout and offers it back, as `drafts.test.ts` does for layout 2, which
    every version from `0.9.2` on stores. The stored text in such a test never
    changes.
  - A later layout stores its drafts in one of two ways. Either each draft is a
    compatible entry: JSON under `inkline-draft:<id>`, its id listed in
    `inkline-drafts`, with a numeric `version`, its `target` and `savedAt` as
    layout 2 has them, and the key of every base layer it uses from
    `inkline-draft-bases` in one of its strings or property names. Each such key
    has the form `crypto.randomUUID()` gives, as every version from `0.9.2` on
    has made them: 36 characters, lowercase hexadecimal digits in groups of 8,
    4, 4, 4 and 12, joined by hyphens. A base layer indexed there under a key of
    any other form is not kept for a later draft: `1.0.1` drops it once no draft
    of layout 2 names it. Or it keeps its drafts, its base layers, and both
    their indexes under keys of its own, which earlier versions never read: they
    then keep all of it, but cannot say when a symbol opens that a draft of it
    is kept. A layout that mixes the two, as with drafts under new keys and base
    layers in `inkline-draft-bases`, loses those base layers in `1.0.1`.
  - The guarantee needs one writer at a time between reading an index and
    writing it back. Obsidian opens a vault in one window, whose popouts share
    its scripts, so only one version of the plugin is loaded, and every step of
    `DraftStore` that reads an index and writes it runs without pausing. A later
    version keeps both. It never writes a draft of its layout under an id that
    holds one of an earlier layout either: an editor knows the draft it offers
    or restored by its id alone until it removes or replaces it.
  - A change to the layout is reviewed as a change to drafts, as
    [Review](#review) says.

## Tests

- Every behavior change comes with tests. Code that needs Obsidian gets an
  end-to-end test in `test/e2e/`; run the suite with `npm run test:e2e:docker`
  before pushing, and look at the screenshots it writes.
- Assert on state, positions, and pixels read back from Obsidian, never by
  comparing screenshots with reference images. Where what Obsidian shows on the
  screen is itself the subject and the DOM, a canvas or a saved file cannot give
  it, as with a CSS mask or text drawn by the host, a test may measure the
  pixels of a screenshot of the elements concerned in the host, assert on the
  measurements with stated tolerances, and keep the screenshot as an artifact.
  Use `editor.getValue()` rather than `vault.cachedRead()` for a note's text
  right after a change: the cache can still hold the old text.

## Documents

The user guide in `docs/` describes what the plugin does now, and what is
planned as planned; [CONTRIBUTING.md](CONTRIBUTING.md#documentation) says how it
is built, checked, and deployed, and
[which places a change updates](CONTRIBUTING.md#what-a-change-updates), there
and in the repository's own documents and listing. Keep the file format and the
rendering contract as developer reference there. Prettier formats Markdown at 80
columns; leave a blank line after a VitePress container's opening `:::` line and
before its closing one, or Prettier joins them with the text. It joins a GitHub
alert's `[!NOTE]` marker with the text after it, which breaks the alert: put
`<!-- prettier-ignore -->` on the line before an alert in a repository file, and
check that the marker keeps its own line in issue and pull request bodies.

## Delivery

`main` is protected by the rulesets in [.github/rulesets/](.github/rulesets/):
every change arrives through a pull request from a task branch, and version tags
have no `v` prefix and are immutable. The files record the live rulesets but do
not apply them; after a pull request that changes one merges, update the live
ruleset to match. [.github/labels.json](.github/labels.json) is the label list
in the same way. The Settings workflow compares the live labels and rulesets
with these files, and checks how issues and pull requests use the labels, weekly
and on request; run it after applying a change. It also runs on a pull request
that changes its own code, where it fails while a change to the files in the
same pull request is not applied yet. GitHub shows a ruleset's bypass actors to
administrators only, so it compares them only when run with such a token, as
`node scripts/settings.ts` with `GH_TOKEN` set.

- Merge with a merge commit after checking the exact head:
  `gh pr merge --merge --match-head-commit <sha>`. Squash and rebase merges are
  disabled so that each commit keeps its own message and attribution trailer,
  and the history of reviewed rounds survives.
- Pull requests need not be up to date with `main` before merging, so that
  parallel pull requests do not wait for one another's end-to-end runs. CI runs
  again on `main` after every merge, and a failure there is fixed first.
- Zero required approvals is deliberate: the repository has a single account,
  and review is as the next section describes.
- Delete the branch after the merge.

## Review

- Every review, whether the author's own pass or an independent one, judges how
  the code is written as well as whether it works. No person reviews the code,
  so review is the only check that keeps it current instead of letting it drift
  toward whatever was written first. Once the behavior is confirmed, the code
  should be readable, idiomatic, consistent in structure and naming,
  appropriately tested, and in line with current best practices where
  reasonable. Working code that adds poor patterns still needs changes.
- The conventions of Obsidian and of the libraries in use shape idioms, error
  handling, composition, file layout, naming, and tests, ahead of generic
  defaults. Check a dependency's current documentation rather than remembered
  conventions.
- A deliberate departure from the better practice is acceptable when that
  practice is infeasible here, such as under a host, dependency, or
  compatibility constraint, or when the chosen form is significantly faster. A
  marginal gain does not justify the inconsistency; measure it, with a benchmark
  or a profile, rather than assume it. Explain the reason in a code comment at
  that site, with the constraint or the measured difference and the condition
  for revisiting it where one exists. An unexplained departure is a finding.
  Profile hot paths from time to time as well, to check whether idiomatic code
  there costs more than expected.
- Look for the source of a weak pattern, not only its instance. When a pull
  request faithfully copies one from merged code, examples, templates, or
  guidance, the precedent is the defect rather than the submitter's work, and
  the finding names it. Before settling that pull request, correct the source in
  separate ones: one for the code and one for the guidance, as applicable. Then
  either replace the original with a new pull request built on the corrected
  base, or refactor it in place to the corrected pattern. Link them all to each
  other, so that the history shows why the original changed.
- Weigh style findings by the project's scope and maturity, like other work, in
  proportion to the code they touch. Prefer established practices with a clear
  benefit over churn for novelty.
- The author reviews the complete diff once the checks pass, trying inputs the
  tests do not cover. Whether another agent also reviews it is the author's
  decision, by the change's sensitivity, complexity, impact, and uncertainty
  rather than its size; record the choice and its reason in the pull request's
  verification section.
- An independent review is by another agent in a session of its own, with fresh
  context; it reports findings and does not push to the branch. The same model
  or provider may review. Prefer a different one for a release and for
  particularly sensitive or complex work, as a different model makes different
  mistakes.
- These always get an independent review, as users' drawings and the published
  releases depend on them:
  - a release pull request, which reviews everything since the previous release,
    as [RELEASING.md](RELEASING.md#prepare-the-release-pull-request) describes;
  - a change to what symbol files hold, how they are read, or how strokes are
    drawn (`src/format/`, `src/ink/`, and the pinned fixtures);
  - a change to how saving, drafts, renames, or insertion can lose a stroke,
    damage a file, or change text it was not asked to change;
  - a change to the release steps, to a workflow that can write to the
    repository or publish, to the rulesets, or to compatibility metadata such as
    `minAppVersion`;
  - a change that removes, skips, or weakens a test, a lint rule, or a required
    check, or that changes a setting, rather than the code, so that a failing
    change can merge;
  - a change that loosens these rules.
- Ordinary, well-understood changes, such as documentation, tests, tooling, and
  small fixes outside those areas, can rest on the author's review.
- The author fixes or answers each finding. A material fix, a finding the author
  disputes, or any other material change pushed after the reviewed commit of a
  pull request these rules require to be reviewed, gets a further round covering
  the changes since that commit. The review names its model and the commit it
  covered.
- Never weaken a check or a safeguard to get a change merged: fix the change, or
  record why the check is wrong and fix the check in its own reviewed change.

## Labels

[.github/labels.json](.github/labels.json) lists the labels, shared with the
owner's other agent-maintained projects.

- Every issue and pull request has one `Type:` label, and at most one `Status:`
  label for where it stands now.
- A request that only the owner can answer, such as a decision about what to
  work on, their sign-in, access, or their own observation, goes in an issue of
  its own, assigned to the owner, with `Needs: Owner`. One that another suitable
  person can answer gets `Needs: Human` instead; use only the more specific of
  the two. Assign the person being asked under either label, including the owner
  when asking them to test. The issue says exactly what is needed, why human
  input is required, the recommendation, what result to expect, and which work
  waits for it; a test request names the build and how to install it, explains
  what changed and how to use it, and lists every question in a section of its
  own at the end, as [RELEASING.md](RELEASING.md#human-release-testing) says.
- Agents own functional verification. A person must also try the first stable
  release and substantial interface or workflow changes before stable
  publication, as [RELEASING.md](RELEASING.md#human-release-testing) describes.
  Automated evidence and agent review cannot replace that usability judgement.
- Before ending a thread with a human request, verify its live assignee and
  labels and link it with the pending action and release impact. Keep the issue
  open after candidate publication or preparation merges; close it only after
  the answer and resulting work are handled. Check outstanding requests when
  maintenance resumes and record answers received elsewhere.
- `Status: Blocked` marks work that waits on a stated condition, with links to
  the issues and pull requests it affects. Optional feedback blocks nothing.

## Dependencies

The pinned issue [#10](https://github.com/viell-dev/slop-inkline/issues/10) is
the overview of every defect or limit in a dependency, Obsidian included, that
affects Inkline. Each entry names the versions, the effect, the evidence, how
Inkline handles it, and one state: blocked upstream, worked around, resolved
upstream, or upstream route unavailable. Log each check of upstream there, and
check again during maintenance and before a release. An Obsidian defect that
does not block Inkline is not reported upstream from this project: link an
existing public report from the overview when there is one. A report would need
the owner's own account, so one that blocks Inkline with no workaround goes to
the owner in an issue with `Needs: Owner`.

## Releases

[RELEASING.md](RELEASING.md) is the process. The maintaining agents publish a
prerelease on GitHub once it is ready by those steps, without asking the owner
for each one. The owner's explicit stable-publication hold in
[#5](https://github.com/viell-dev/slop-inkline/issues/5) remains binding until
the owner lifts it there, as the release guide explains; the owner lifted it for
`1.0.0` on 2026-11-16. The owner decided in
[#141](https://github.com/viell-dev/slop-inkline/issues/141) that `1.0.0` is
also the first release in Obsidian's community directory. Submitting it there is
the owner's own step, with their sign-in, once it is published on GitHub, as
#141 lists. Changing what Inkline is for or where it is distributed needs the
owner's decision. `manifest.json` on `main` is what Obsidian offers, so a
pre-release's version stays out of it; see
[RELEASING.md](RELEASING.md#where-a-version-is-recorded).

## The prototype branch

`prototype` holds the history of the earlier prototype, frozen by a ruleset.
Read it for reference, for example with `git show prototype:src/main.ts`, but
never merge it or base work on it. Its drawings are not test fixtures. Once
nothing needs it, delete the branch and its ruleset in the pull request that
makes it unneeded.

## The pen-input branch

`pen-input` preserves pen-device support: pen pressure, a pen's eraser end, palm
rejection, and the Pen pressure setting. The owner's scope decision is in
[#101](https://github.com/viell-dev/slop-inkline/issues/101). Read it for
reference, as with `git show pen-input:src/editor/pointer.ts`. Do not delete it,
merge it, or base work on it without the owner's decision. Symbol files hold no
pressure: bringing pen input back would be a new format version.

## Instruction files

Agent instructions live in `AGENTS.md` files only. Do not add `CLAUDE.md`,
`GEMINI.md`, or other harness-specific copies or import shims.
