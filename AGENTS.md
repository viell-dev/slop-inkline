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

Prettier formats Markdown at 80 columns. It joins a GitHub alert's `[!NOTE]`
marker with the text after it, which breaks the alert: put
`<!-- prettier-ignore -->` on the line before an alert in a repository file, and
check that the marker keeps its own line in issue and pull request bodies.

## Delivery

`main` is protected by the rulesets in [.github/rulesets/](.github/rulesets/):
every change arrives through a pull request from a task branch, and version tags
have no `v` prefix and are immutable. The files record the live rulesets but do
not apply them; after a pull request that changes one merges, update the live
ruleset to match. [.github/labels.json](.github/labels.json) is the label list
in the same way.

- Merge with a merge commit after checking the exact head:
  `gh pr merge --merge --match-head-commit <sha>`. Squash and rebase merges are
  disabled so that each commit keeps its own message and attribution trailer,
  and the history of reviewed rounds survives.
- Pull requests need not be up to date with `main` before merging, so that
  parallel pull requests do not wait for one another's end-to-end runs. CI runs
  again on `main` after every merge, and a failure there is fixed first.
- Zero required approvals is deliberate: the repository has a single account,
  and review is the independent review below.
- Delete the branch after the merge.

## Review

- Every pull request that can change what ships is reviewed by another agent, in
  a session of its own, running a different model from the one that wrote it,
  because a different model makes different mistakes. A model of another line,
  such as Claude Fable reviewing Claude Opus, or from another provider counts;
  another version, effort setting, or harness of the same model does not.
  Reviewers report findings and do not push to the branch.
- The author fixes or answers each finding. A material finding is closed only
  when the reviewer accepts the fix or the answer in a further round. The review
  names its model and the commit it covered; a behavior-changing commit pushed
  after it needs another round.
- Only wording and typo fixes in documentation, and comments, may skip
  independent review. Dependency updates, workflows, release steps,
  compatibility metadata such as `minAppVersion`, and any change that loosens
  these rules are always reviewed.

## Releases

[RELEASING.md](RELEASING.md) is the process. Publish only a release the owner
has authorized.

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
