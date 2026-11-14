# Agent maintenance

Inkline is built, tested, documented, released, and maintained by AI agents.
They follow the owner's general rules for agent-maintained projects, which cover
who decides what, how issues and pull requests are written, verification,
parallel work, attribution, and reports to other projects. This file adds only
what is specific to this repository; [CONTRIBUTING.md](CONTRIBUTING.md) holds
the setup, checks, and tests that apply to everyone.

## What Inkline is

This section says what Inkline is, what it is for, what it covers, and where it
might go. Read it before judging a feature, a review finding, or a description
of Inkline. The owner decides what Inkline is for and what its releases cover.
Where a decision of theirs, on an issue or a pull request, differs from this
section, the decision wins, and this section is what to fix.

### What it is

Inkline is a plugin for Obsidian, the note-taking app, for writing symbols that
no font has into notes. A person draws a symbol once, in a small editor sized to
a line of text, and Inkline saves it in the vault as a PNG image and embeds it
in the note with an ordinary image link. The symbol then shows in the line like
a character, by default at the size and colour of the text around it. To write
it again, the person types the insert trigger, a few characters set in Inkline's
settings (`;;` unless changed), then a few letters of the symbol's name, and
picks it from the list that opens.

It runs in desktop Obsidian, and symbols are drawn with a mouse or a trackpad.
It has had no stable release yet; when the first is published is the owner's
decision, as [Releases](#releases) says.

### What it is for

Inkline is for keeping notes in a script that the person cannot type.

Computers store text as characters from Unicode, a standard list of the
characters of the world's writing systems. A script that someone invented is
usually not in it, so the person has no keyboard layout to type it and no font
to show it. Without a tool, they fall back on stand-ins, such as a made-up name
or a number for each symbol, and have to remember which stand-in is which.
Inkline removes the stand-in: the symbol itself goes in the note.

"Symbols that no font has" is the plain way to say this to users, who know fonts
better than Unicode. It is shorthand, not a technical claim: a script outside
Unicode can still have a font, through characters Unicode leaves for private
use, and a person who has such a font and a way to type it does not need Inkline
for that script.

### Two directions

People come to a script they cannot type from two directions:

- **Working one out.** Some games are built around an invented language, and
  working out what its script says is the game. The player draws symbols that
  someone else made, copying them from what the game shows.
- **Making one up.** A person creating a constructed language, a conlang, can
  give it a script of its own. They draw symbols they make themselves.

The two are essentially the same work. Both write the script among ordinary
text, both write the same symbols many times, and both change what they record
about a symbol over time, one as they learn more and the other as the design
changes. The difference is whose symbols are drawn.

Wherever Inkline is described, give the two equal place, or use words that cover
both. The owner has set no rule for design choices between them. The
maintainers' rule is to judge a feature by the two needs below, not by which
direction asked for it, and to weigh a choice that helps one direction and costs
the other like any design choice, with the tradeoff recorded on its issue.

Other uses, such as a cipher or a personal shorthand, work the same way. They
are welcome, and they add no commitments of their own: a change counts when it
serves the two needs, whoever asks for it.

### Two needs

1. **Notate.** Writing a symbol that cannot be typed into a note should be as
   easy as writing a letter. It happens where the person is writing, and the
   result reads as part of the text, not as a picture set into a paragraph.
2. **Reuse.** Writing a symbol already drawn should be as easy again, in any
   note, without drawing it a second time or looking for its file. Each symbol
   is one file, however many notes use it, so a change to it shows everywhere.

Reuse matters as much as notation. A symbol is drawn once and written many
times, so a tool that only put drawings into notes would meet the first need and
leave the second undone.

"Easy" is the aim, not a measured promise. Nothing here claims a number of
seconds or keys, or that no drawing skill is needed. Tracing helps when a symbol
already exists as a picture, as in a game; a shape that exists nowhere yet still
has to be drawn.

Both needs rest on two commitments Inkline already keeps:

- **Keeping drawings safe.** Unsaved work is kept as a draft, and the editor
  asks before it closes with changes that are not saved.
- **Keeping notes readable without Inkline.** Each symbol is an ordinary PNG
  file with an ordinary embed, so a note still shows it with Inkline turned off
  or removed, and other apps can show the picture from a standard Markdown link.

### What a symbol records

A symbol has a name, which is its file's name and what notes link to. It can
also record readings, how it is read aloud, and translations, what it means,
filled in from the editor or the library. The lists that insert a symbol find it
by its name, a reading, or a translation. Editing the readings and translations
changes no note, and renaming a symbol updates the links to it as Obsidian's
settings say. Today, what Inkline records is about one symbol at a time.

### Scope

**The first stable release.** The core is notating and reusing single symbols,
with their readings and translations, in desktop Obsidian with a mouse or a
trackpad. The first stable release, `1.0.0`, delivers it. Its exact feature list
is the [stable release goal](RELEASING.md#the-stable-release-goal) the owner
agreed, and only the owner changes it.

The owner has confirmed that this target stands. In the owner's judgement,
today's features are enough even for a script written right to left in words of
several symbols, as long as it is not mixed much with the person's own language
in one line. That is a judgement about the target, not a claim that Inkline
supports writing directions.

**Later releases.** The owner has not said what later releases cover, beyond the
direction under [Vision](#vision), which approves nothing. Until the owner
decides otherwise, the agreed scope after `1.0.0` stays the core above, and
within it the maintainers weigh a request as
[Deciding what belongs](#deciding-what-belongs) says. Growing Inkline beyond the
core is a change of scope, and so is adding a capability the agreed goal
explicitly put outside the first stable release, even one that would otherwise
fit the core. Both are the owner's decision. When it is unclear whether a change
does either, the maintainers establish whether it fits the agreed scope before
building it, and a change that needs a wider scope is not built without the
owner's decision.

**Held ideas.** The owner collects ideas for Inkline's future in
[#167](https://github.com/viell-dev/slop-inkline/issues/167), and adds to it.
They are ideas only. Investigating whether one is possible is allowed, and
nothing more: none is approved for any release, and none has a version or a
date. An idea that fits the purpose is not approved by fitting it, and an idea
that is held is not ruled out for good. The issue's comments, the agents'
"vision" report among them, describe what Inkline could become, not what it is
for or what is planned; [Vision](#vision) below is what the owner has said. Pen
input is held as well, as [the pen-input branch](#the-pen-input-branch) says.

### Deciding what belongs

Ask three questions, in order. A yes to one is not a yes to the next.

1. **Is it held?** An idea in #167, or one that depends on one, waits for the
   owner, however well it fits. So does pen input.
2. **Does it serve the purpose?** It does when it makes notating or reusing a
   symbol easier or safer, in either direction.
3. **Is it in the agreed scope, and worth its cost?** Until `1.0.0`, the agreed
   scope is the feature list of the stable release goal, and adding to that list
   is the owner's decision. After it, the agreed scope is as Later releases
   under [Scope](#scope) sets out. Within it, the maintainers accept, narrow, or
   decline a request that serves the purpose and is not held, by its cost: the
   code, tests, documentation, and support it needs for as long as the project
   is maintained, and the risk it brings to people's drawings.
   [Request a feature](CONTRIBUTING.md#request-a-feature) says how a request is
   recorded and closed.

A request outside the purpose, or for something only the owner can add, is a
proposal to change the scope. The maintainers raise it with the owner, in an
issue with `Needs: Owner`, only when its benefit clearly justifies the change;
otherwise they decline it, with the reason on the issue. Only the owner changes
what Inkline is for, or the agreed goal of a stable release.

### Keeping to the scope

Agents that iterate on their own work tend to widen it a little at a time. These
rules keep the purpose and scope where the owner put them.

- **Describe Inkline as it is.** Say what the current release does. Do not
  describe a held idea, a research result, or a possible future as what Inkline
  is, does, or is for.
- **Bound the scope by what Inkline is.** Say what it is and what it covers, and
  add no lists of what it is not: such a list reads as complete, goes stale as
  things change, and needs upkeep, while the core above already sets the bounds.
  Two records are different. The user guide's known limits tell users what a
  feature does not do and what to do instead. The stable release goal's "Out of
  scope" line records what the owner agreed for `1.0.0`: only the owner changes
  it, and it is not copied or extended elsewhere.
- **Research is not a plan.** Investigations, experiment branches, prototypes,
  and comments on what Inkline could become approve nothing. An idea does not
  become scope by being written down, repeated, or researched further.
- **An agent's own idea is a feature request.** So is a review suggestion that
  adds a capability. Weigh it by the three questions on an issue, and build it
  only if it passes them.
- **An aim is not a promise.** "Easy" is the goal. A description claims only
  what Inkline does now, and adds no measures the owner did not set.
- **Say what it is for, not only how it works.** "Draws small inline images"
  says how it works, and leaves out reuse and the people it is for.
- **Keep both directions in view.** Wording that fits only one direction, such
  as calling everything recorded about a symbol a guess, leaves the other out.

### Vision

This is where Inkline might go after its first stable release, as far as the
owner has said. It is a direction, not a plan: nothing here is approved,
scheduled, or promised.

The owner has said that later versions might grow beyond single symbols, into
features such as words, compound symbols, and dictionaries, and has called that
a future problem.

Unless the owner changes it, the purpose stays the same: helping a person write
and reuse the symbols of a script they cannot type, from either direction. Each
idea would be judged by that purpose and its cost, and approved or not by the
owner. The owner has also said that how such features would look has no single
answer: it depends on the script and on how the person takes notes. No design
should be assumed in advance.

### Keeping this section in step

A change to this section updates the places that
[What a change updates](CONTRIBUTING.md#what-a-change-updates) lists for what
Inkline is for, and a change to those places checks that this section still
agrees. A stable release updates what this section says about releases.

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
    thing to regenerate: they are the only record of how symbols looked. The
    limits in `limits.test.ts` are as fixed: a number there changes only with a
    new format version, which keeps the old one's.
  - `src/ink/freehand.ts` is part of the format, adapted from perfect-freehand
    so that no package update can change it. Keep it and the steps in the
    format's document saying the same thing.

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
  waits for it; a test request names the build, gives synthetic inputs, numbered
  steps with their expected results, and what to report.
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
[#5](https://github.com/viell-dev/slop-inkline/issues/5) remains binding, as the
release guide explains. Submitting the plugin to Obsidian's community directory,
or changing what Inkline is for or where it is distributed, needs the owner's
decision. `manifest.json` on `main` is what Obsidian offers, so a pre-release's
version stays out of it; see
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
