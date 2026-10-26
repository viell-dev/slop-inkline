# Agent maintenance

Inkline is built, tested, documented, released, and maintained by AI agents.
They follow the owner's general rules for agent-maintained projects, which cover
who decides what, how issues and pull requests are written, verification,
parallel work, attribution, and reports to other projects. This file adds only
what is specific to this repository; [CONTRIBUTING.md](CONTRIBUTING.md) holds
the setup, checks, and tests that apply to everyone.

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
- The plugin uses web APIs only, no Node.js or Electron modules, so that mobile
  can follow; the build fails on a Node.js import. Tools under `scripts/` and
  `test/` run in Node.js.
- Scripts are TypeScript that Node.js runs directly, so they use only erasable
  syntax and import files with their `.ts` extension.
- `src/format/` reads and writes symbol files, and `src/ink/` draws them;
  [docs/file-format.md](docs/file-format.md) specifies both. A change to what
  files hold or how strokes are drawn updates that document in the same pull
  request. The pinned files in `test/fixtures/` (golden files, stroke outlines,
  and the prototype-format files) are never changed: users' files must keep
  opening and looking the same, so a new case gets a new pinned file, and an
  update of `perfect-freehand` that changes the pinned outlines changes how
  saved symbols look.

## Tests

- Every behavior change comes with tests. Code that needs Obsidian gets an
  end-to-end test in `test/e2e/`; run the suite with `npm run test:e2e:docker`
  before pushing, and look at the screenshots it writes.
- Assert on state, positions, and pixels read back from Obsidian, never on
  screenshots. Use `editor.getValue()` rather than `vault.cachedRead()` for a
  note's text right after a change: the cache can still hold the old text.

## Documents

The user guide in `docs/` describes what the plugin does now, and what is
planned as planned; [CONTRIBUTING.md](CONTRIBUTING.md#documentation) says how it
is built, checked, and deployed. Keep the file format and the rendering contract
as developer reference there. Prettier formats Markdown at 80 columns; leave a
blank line after a VitePress container's opening `:::` line and before its
closing one, or Prettier joins them with the text. It joins a GitHub alert's
`[!NOTE]` marker with the text after it, which breaks the alert: put
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
  input is required, the recommendation, what result to expect, and which
  work waits for it; a test request names the build, gives synthetic inputs,
  numbered steps with their expected results, and what to report.
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
release on GitHub once it is ready by those steps, without asking the owner for
each one. Submitting the plugin to Obsidian's community directory, or changing
what Inkline is for or where it is distributed, needs the owner's decision.

## The prototype branch

`prototype` holds the history of the earlier prototype, frozen by a ruleset.
Read it for reference, for example with `git show prototype:src/main.ts`, but
never merge it or base work on it. Its drawings are not test fixtures: test
legacy import with synthetic drawings in the prototype's format. Once nothing
needs it, delete the branch and its ruleset in the pull request that makes it
unneeded.

## Instruction files

Agent instructions live in `AGENTS.md` files only. Do not add `CLAUDE.md`,
`GEMINI.md`, or other harness-specific copies or import shims.
