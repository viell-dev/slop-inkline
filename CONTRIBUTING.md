# Contributing

Issues and pull requests from people and from agents are welcome. The project is
maintained by AI agents, as the [README](README.md#contributing) says, and its
owner follows it through issue and pull request descriptions rather than code,
so write them for a reader who has not seen the code. Agents maintaining the
repository also follow [AGENTS.md](AGENTS.md). Everyone follows the
[code of conduct](CODE_OF_CONDUCT.md).

If an agent wrote your issue or pull request, open it with a short note, such as
a `> [!NOTE]` callout, that says so, names the model and the tool that ran it,
and says whether you reviewed it. The maintaining agents mark their own posts
the same way.

## Report a defect

Search the open and closed
[issues](https://github.com/viell-dev/slop-inkline/issues) first, then open one
with the bug form. Only what happened is required. Anything else you can give
helps the maintainers find the cause sooner:

- the steps that led to it, from a new vault or note if you can, with any theme
  or other plugins the problem needs;
- what you expected instead;
- the Inkline version, the Obsidian version and installer version, the operating
  system, and what you draw with: a mouse, a trackpad, or another pointer;
- any error message, a screenshot, or a `.ink.png` file that shows the problem.

Use synthetic examples only, and leave private notes and drawings out of every
report. Agents should open an issue only when their operator has authorized
publishing it. Report vulnerabilities privately, as [SECURITY.md](SECURITY.md)
describes.

## Request a feature

Search the open and closed issues first, then use the feature form. Saying what
you want is enough. If you can, also say what it would help with in the notes
and symbols you work with, which helps weigh it.

Every request is weighed the same way, whoever makes it: users, the repository's
owner, or the maintaining agents themselves.

Some ideas are held, and that comes first. The owner collects ideas for later in
[#167](https://github.com/viell-dev/slop-inkline/issues/167). They may be
investigated, and none is approved for any release, so a request for one of them
waits for the owner's decision, however well it fits.

For any other request, two questions decide it, and it needs a yes to both:

- **Does it belong in Inkline?** Inkline is for writing notes in a script that
  no font has: one a person is working out, as in a game with an invented
  language, or one they are making up, as for a constructed language of their
  own. It has two jobs: writing such a symbol into a note as easily as a letter,
  and using it again as easily. A request fits when it makes one of those easier
  or safer. It supports desktop Obsidian with a mouse or trackpad. The
  [stable release goal](RELEASING.md#the-stable-release-goal), which the owner
  agreed, says what the first stable release covers. Until that release, adding
  to it is the owner's decision. Adding what it puts out of scope stays the
  owner's decision after that release too.
- **Is the benefit worth what it adds?** That means the code, tests,
  documentation, and support it needs for as long as the project is maintained,
  and the risk it brings to saving and drawing, where mistakes cost people their
  drawings.

The reasoning goes on the issue, and the request is accepted, narrowed to the
part that is worth it, or declined. A declined request is closed as not planned
with `Status: Won't Do`, saying what would reopen it. The owner decides changes
to what Inkline is for. A request outside that scope is a proposal to change it,
which the maintainers raise with the owner only when its benefit clearly
justifies the change.

An agent proposing a feature, for its operator or as a maintainer, reads
[What Inkline is](AGENTS.md#what-inkline-is) in AGENTS.md first.

## Set up

Development needs Node.js 24.22.1 or a later 24 release, or 26.12.1 or newer,
with the npm it ships, as WebdriverIO, which runs the end-to-end tests, needs
them. [.nvmrc](.nvmrc) names the version line that CI uses, so `nvm use` or
`fnm use` picks it.

```sh
git clone https://github.com/viell-dev/slop-inkline.git
cd slop-inkline
npm ci
npm run build
```

The build writes `main.js`, `manifest.json`, and `styles.css` to `dist/`. To try
it, copy them into `.obsidian/plugins/inkline/` in a test vault and enable
Inkline in Settings, Community plugins. `npm run dev` rebuilds on every change.
The built manifest names the version in `package.json`, which can be newer than
the root `manifest.json`, as [RELEASING.md](RELEASING.md) explains.

## Checks

```sh
npm run check
```

`check` runs ESLint with the rules of Obsidian's community directory review
(`eslint-plugin-obsidianmd`) and typescript-eslint's strict type-checked rules,
Prettier, the TypeScript checks of the plugin, the tests, the scripts, and the
documentation site's configuration, the unit tests, the build, and the
documentation site's build. A lint warning fails `check` as an error does, so
that a rule an update of the plugin adds as advice is seen before it merges:
follow it, or turn it off in `eslint.config.mjs` with the reason beside it.
`npm run format` applies Prettier. GitHub Actions runs `check` on Linux and
Windows, and a dependency audit on Linux. The
[plugin's guide](https://github.com/obsidianmd/eslint-plugin/blob/0.5.1/docs/configuration.md#community-plugin-scanner-configuration)
describes what the directory's scan runs.

## Tests

Unit tests use Vitest and live in `test/unit/`. They cover code that runs
without Obsidian; `npm test` runs them. Code that needs the browser's own
implementation, such as canvas encoding or how far a stream reads ahead, is also
tested in Obsidian's renderer: an end-to-end spec calls `loadModules()` from
`test/e2e/support/browser.ts`, which bundles `test/e2e/browser/entry.ts` and
makes the plugin's modules available there as `window.inklineTest`. It bundles
once for each spec file, and loads the bundle only into a window that does not
have it yet, so a spec calls it again in each window it opens and after Obsidian
reloads.

End-to-end tests live in `test/e2e/` and run the built plugin in real Obsidian
through WebdriverIO and
[wdio-obsidian-service](https://github.com/jesse-r-s-hines/wdio-obsidian-service).
Build first, then run them in one of two ways:

- `npm run test:e2e:docker` on any system with Docker, Windows included. It
  builds the image in `test/e2e/Dockerfile` from your checkout and runs the
  suite under a virtual display. The image never contains Obsidian; the first
  run downloads it into the Docker volume `inkline-obsidian-cache`. Runs from
  several checkouts can go at once: each runs the image it built, under a tag
  `inkline-e2e:run-…` of its own that it removes when it ends. A run killed
  before it could, as by closing its terminal, leaves its tag behind, which
  `docker image rm` takes away.
- `npm run test:e2e` directly on a desktop with a display. On Linux without one,
  `sh test/e2e/session.sh` starts Xvfb and herbstluftwm first, as CI does, with
  a display for each of up to four Obsidian versions, so that one version's
  windows never resize another's; it refuses more versions.

Direct runs also need Poppler's `pdftoppm` and `pdftotext` on `PATH` for the
native PDF-output checks. Docker includes them, and CI installs `poppler-utils`.
The checks retain the PDF, its rasterized page, text coordinates, and measured
print layout with the other end-to-end artifacts. The PDF test redirects the
save dialog and suppresses only the native request's post-export viewer flag, so
it writes the real PDF without launching a desktop application. Its snapshots
retain the original viewer request.

`OBSIDIAN_VERSIONS` picks the Obsidian versions as space-separated
`appVersion/installerVersion` pairs. The default,
`earliest/earliest latest/latest`, tests the manifest's `minAppVersion` on the
oldest installer that can run it, which has the oldest Electron a user can have,
and the latest public release. Downloads outside Docker go to
`.obsidian-cache/`. Outside Docker, `E2E_PLUGIN_DIR` picks the folder of plugin
files to install, `dist/` by default; the Release workflow names the release's
own files, and `test/e2e/specs/package.e2e.ts` checks that the test vault holds
exactly those. `npm run test:e2e:docker` always installs the build it makes in
its image.

Screenshots and logs go to `test-results/e2e/`, which CI uploads as artifacts; a
failed test leaves a screenshot named after it. `E2E_OUTPUT_DIR` picks another
directory, which must be new, empty, or an earlier run's output: the harness
marks its directory and refuses to clean any other. Screenshots are for review,
never compared with reference images: a test reads state, positions, or pixels
back from Obsidian. Where what Obsidian shows on the screen is itself the
subject and the DOM, a canvas or a saved file cannot give it, as with a CSS mask
or text drawn by the host, a test may measure the pixels of a screenshot of the
elements concerned, with stated tolerances. A screenshot of the window that a
test measures is the one it saves, with `saveScreenshotData()` from
`test/e2e/support/screenshots.ts`. Test vaults in `test/e2e/vaults/` and every
drawing a test uses are synthetic.

A press on the drawing area is let go in the WebDriver command that makes it, as
`draw()`, `drawShifted()`, and `drawAndHold()` in `test/e2e/support/editor.ts`
do. The area captures the pointer, and a press held into the next command loses
that capture with the button still down before its release arrives: the editor
ends the stroke as for a lost capture, and what the release does goes untested
([#391](https://github.com/viell-dev/slop-inkline/issues/391)). Keys pressed
while the button is down go in the same command, and what the page shows
meanwhile is read in the page, by a listener for the release, as `fill.e2e.ts`
does.

Each spec file runs in a WebdriverIO session of its own, which
wdio-obsidian-service starts with a new copy of the test vault and a new
Electron user data directory, which holds local storage. So a spec file starts
from the vault as it is in the repository, and need not reset what its last test
leaves behind; its tests still reset between them, as `startOver()` in
`test/e2e/support/editor.ts` does.

The test vault keeps deleted files in its own `.trash` folder: its
`.obsidian/app.json` sets Obsidian's **Deleted files** option, `trashOption`, to
`local`. So a test that deletes a file with `app.fileManager.trashFile`, as a
user would, deletes it wherever the suite runs. The system's trash fails in
Docker. From Obsidian 1.15.1, a deletion it refuses leaves the file where it was
and shows a notice, where earlier versions moved the file to `.trash` instead
([#257](https://github.com/viell-dev/slop-inkline/issues/257)). A test about the
system's trash itself would set the option back to `system`, and say why.

`test/e2e/manual/brat.e2e.ts` checks installing and updating through BRAT
against the published releases, on both default Obsidian versions. It stays
outside the suite and gates no release, as it needs BRAT's own release and
GitHub. Download BRAT's `main.js`, `manifest.json`, and `styles.css` into a new
directory, name the highest published version and an earlier one to update from,
and run it in the Docker image:

```sh
docker build --file test/e2e/Dockerfile --tag inkline-e2e .
docker run --rm --init --shm-size=1g \
  --env E2E_PLUGIN_DIR=/brat \
  --env E2E_BRAT_LATEST=1.0.0 --env E2E_BRAT_START=0.9.5 \
  --volume inkline-obsidian-cache:/cache \
  --volume "$PWD/test-results/e2e:/out" --volume "$PWD/brat:/brat:ro" \
  inkline-e2e --spec test/e2e/manual/brat.e2e.ts
```

What the update must keep goes by the version it starts from. From `0.9.2` on,
the file format is final, and the update keeps the drawing's strokes and an open
drawing's draft, as well as its pixels, the note, and the preferences. From an
earlier version, it keeps the pixels, the note, and the preferences: the symbol
opens as a picture to draw over, and the draft is dropped, as
[the install guide](https://viell-dev.github.io/slop-inkline/install#update)
says. So checking that strokes and a draft survive needs two published releases
from `0.9.2` on, as the pair above is: `0.9.5` and `1.0.0` passed it on
2026-11-16.

Before any request, the check refuses a missing version, a latest one before
`0.9.2`, and a start that is not earlier than the latest. Before BRAT's
requests, it refuses a version that is not published, and a latest one that is
not the highest. It uses no GitHub token, so its requests count against the 60
an hour that GitHub allows an address: it makes about 16 for each Obsidian
version, and refuses to start with fewer than 50 left.

`test/e2e/manual/listing.e2e.ts` also stays outside the suite: it makes the
pictures for Obsidian's community directory listing, as
[listing/README.md](listing/README.md) says.

The guide's pictures in `docs/screenshots/` come from two specs of the suite,
with synthetic symbols and notes. `test/e2e/specs/journey.e2e.ts` writes
`journey-tracing.png`, `journey-light.png`, and `journey-dark.png`, which go
there as `tracing.png`, `reading-light.png`, and `reading-dark.png`.
`test/e2e/specs/library-look.e2e.ts` writes the library's, in the default
sidebar at twice its size, as `library-rows-light.png`, `library-rows-dark.png`,
`library-quick-edit-light.png`, and `library-quick-edit-dark.png`, which go
there by the same names. Make them from the latest Obsidian, and copy them from
`test-results/e2e/screenshots/<versions>/`:

```sh
OBSIDIAN_VERSIONS=latest/latest npm run test:e2e:docker -- \
  --spec test/e2e/specs/journey.e2e.ts --spec test/e2e/specs/library-look.e2e.ts
```

`test/e2e/manual/eraser-edge.e2e.ts` stays outside it too: it erases a filled
ellipse along, across, and through its edge with every brush size, slowly and
quickly, with Zoom off and on, and reads the drawing area back in every frame,
which is how the eraser's moving edge in
[#341](https://github.com/viell-dev/slop-inkline/issues/341) was measured. It
writes `eraser-edge-<version>.json` to the output directory, and a picture of
each case's worst frame with the screenshots.
`test/e2e/specs/eraser-sweep.e2e.ts` asserts on a few of its cases in the suite.

`test/e2e/manual/save-time.e2e.ts` stays outside it too: it measures how long a
save of a large symbol takes and what that does to the rest of the plugin, which
is how the wait before a stalled save's message was chosen. It writes
`save-time-<version>.json` to the output directory.

`test/e2e/manual/open-time.e2e.ts` stays outside it too: it measures what each
step of reading a large symbol costs, where the main thread's time goes in a
whole open of the editor, by a CPU profile with each long task's share, and what
opening does beside the index reading the vault. It writes
`open-time-<version>.json` to the output directory.

`test/e2e/manual/rename-time.e2e.ts` stays outside it too: it measures how long
a rename takes by how many notes link to the symbol, and how often the vault
reports something meanwhile, which is how a rename that stopped is told from a
slow one. It writes `rename-time-<version>.json` to the output directory.

`test/e2e/manual/fixtures.e2e.ts` stays outside it too: it saves the drawings of
`test/fixtures/format/records.ts` as golden files, with the real save in
Obsidian, as its opening comment says.

`test/fixtures/pinned.sha256` lists the hash of every file in `test/fixtures`
that is not TypeScript, and a unit test fails when a file and the list disagree.
From the repository's root,
`sha256sum --text <file> >> test/fixtures/pinned.sha256` adds a new file's line,
and `sha256sum --check test/fixtures/pinned.sha256` checks them all.
[AGENTS.md](AGENTS.md#code) says what may change there, which from `1.0.0` is
nothing but new lines. `npm run check:pinned` checks that: it fails when a line
the list had in a release from `1.0.0` on is missing or different now. It reads
the release tags, so a clone without them fails until `git fetch --tags origin`
fetches them; a shallow clone stays shallow with
`git fetch --no-tags --depth=1 origin '+refs/tags/*:refs/tags/*'`. It is not
part of `check`, which a shallow clone must pass; CI runs it on Linux.

CI runs the end-to-end tests on Linux for every pull request, and the Docker
image weekly and on request. Outside Docker, CI splits the suite over four jobs
that run side by side, `e2e (1/4)` to `e2e (4/4)`, each on both Obsidian
versions, which keeps the wait to about a quarter of the suite. `E2E_SHARD`,
such as `2/4`, runs one such shard in a direct run, `npm run test:e2e` or
`sh test/e2e/session.sh`; `npm run test:e2e:docker` does not pass it on, so a
Docker run is never a shard. Unset, every spec file under `test/e2e/specs` runs,
at any depth, and `--spec` runs only the files it names, as the Release
workflow's run of two files does. The shards are balanced by the seconds in
`test/e2e/weights.json`, named by the spec file's path under `test/e2e/specs`. A
spec file the table does not list counts as its median, so a new one runs
without editing it. Each shard's log lists the files it runs.

Every run writes `durations.json` to the output directory: for each spec file
and each requested Obsidian version, such as `latest/latest`, the version it
resolved to, the seconds its worker took, and the worker's exit code, with the
run's own exit code. Each shard then checks its own record, with
`node test/e2e/shards.ts shard <i/n> test-results/e2e`: it fails unless this run
wrote it, for exactly that shard's spec files, each passed on every version.
Each shard uploads its output as the artifact `e2e-results-<i>-attempt-<n>`,
such as `e2e-results-2-attempt-1`, named by the attempt of the run, so that a
re-run of a shard leaves its record beside the earlier attempts' rather than
under the same name. The job named `e2e`, which `main` requires, passes only
when all four shards passed and their records, read with
`node test/e2e/shards.ts check <dir>`, show every spec file exactly once, passed
on both default versions, so that a file that runs nowhere, fails, or runs on
too few versions fails it, even after a re-run of some of the shards. It reads
of each shard only the record of its latest attempt, by the `-attempt-<n>` that
ends the name of the record's directory, so an earlier attempt's record, failed
or passing, never stands for a later one. Both checks expect the versions
`OBSIDIAN_VERSIONS` names, the default pair when it is unset.

To refresh the table, download a recent run of CI on `main` and commit the
result:

```sh
gh run download <run-id> --pattern 'e2e-results-*' --dir <dir>
node test/e2e/shards.ts weights <dir>
```

It takes each measured spec file's slower version, keeps the weight of one that
did not run, and drops a file that no longer exists. Of a shard that was re-run,
it reads only the latest attempt's record, as the check does. Runs from before
the attempt was in the artifacts' names have one artifact of each name per
attempt, and `gh run download` leaves only one of their records in its
directory, of either attempt: in run 44956202229, it was the earlier, failed
attempt's. A unit test fails when the greedy assignment of the current table
puts four shards more than 10% apart. The assignment is not optimal, so a better
split may exist; start with the assignment the failure prints. Then split a spec
file that dominates its shard, or change the number of shards in
`.github/workflows/ci.yml` and in that test.

The Directory checks workflow runs Obsidian's own action on every pull request,
which checks the plugin much as the community directory does. It is not a
required check, so that a new rule of Obsidian's doesn't stop unrelated pull
requests, but a failure there needs fixing before a public release.

## Documentation

The user guide and the reference are a [VitePress](https://vitepress.dev/) site
in `docs/`, which the Pages workflow deploys to GitHub Pages. `npm run docs:dev`
serves it with live reload, and `npm run docs:build`, part of `check`, builds it
and fails on a link to a page that does not exist. `test/unit/docs.test.ts`
checks that the site lists every command and every button's key as the code has
them, gives the code's defaults and the public release's minimum Obsidian
version, links only to headings and repository files that exist, and gives
example embeds that read as symbols. It holds the repository's own Markdown
documents, such as this one and the README, to the same: their links, by
GitHub's rules, the Obsidian and Node.js versions, the commands they name, their
examples, and the versions of the BRAT recipe above.

A change that users can see updates the guide in the same pull request. The
guide deploys from `main` and describes the newest public release. Clearly label
behavior absent from that release **Unreleased**, keeping the released
instructions usable. Author and PR review check the labels in the guide before
merge. A changelog entry also needs a label in the guide if the guide covers the
change. A pre-release PR keeps the labels. A public release PR removes them for
behavior it ships. [docs/versions.md](docs/versions.md) describes deployment and
corrections.

### What a change updates

A change updates every place that states what it changes, not only the guide.
These are the places for each kind of change. What is marked checked, the unit
tests compare with the code: `docs.test.ts` for the guide and the documents,
`listing.test.ts` for the listing, and `release.test.ts` for versions. What is
marked read, author and pull request review read for meaning.

- **A command, button, key, default, or notice:** the guide's keyboard,
  settings, drawing, and troubleshooting pages, and the README's first steps,
  checked; the editor's **Help** and its tooltips, read.
- **The Obsidian or Node.js version, or the platforms:** `versions.json` records
  the public release's minimum Obsidian version. `manifest.json` and
  `package.json` record the build's requirements. The README, the home and
  install pages, and Set up above, checked. Known limits and the listing's long
  description, read.
- **What Inkline reads, writes, or sends:** [SECURITY.md](SECURITY.md), the
  listing's long description, and the guide's drawing and recovery pages, read.
- **What a symbol file holds, or how it draws:** the file format and Without
  Inkline pages, and the pinned fixtures, as [AGENTS.md](AGENTS.md#code) says.
- **How a symbol shows in a note or in another app:** the rendering and Without
  Inkline pages; their example embeds, checked.
- **Installing, updating, or a release:** the install page, the README's
  Install, [RELEASING.md](RELEASING.md), and the recipes in [Tests](#tests); the
  BRAT recipe's versions, checked.
- **What Inkline is for:** the README, the home page, the listing's
  descriptions, the descriptions in `package.json` and the guide's
  configuration, [Request a feature](#request-a-feature), and the feature
  request form in `.github/ISSUE_TEMPLATE/`; the short description, checked
  against the manifest's. The repository's description on GitHub is a live
  setting: update it once the change has merged.
- **How it looks:** `docs/screenshots/` and `listing/screenshots/`; the
  listing's sizes, checked.
- **Anything users can see:** `Unreleased` in [CHANGELOG.md](CHANGELOG.md), and
  the guide's
  [Promises and evidence](https://viell-dev.github.io/slop-inkline/verification)
  for what tests it.

The tests also check every link in the guide and in these documents.

## Pull requests

Every change to `main` goes through a pull request with passing CI and is merged
with a merge commit. `main` requires the `verify (ubuntu-latest)`,
`verify (windows-latest)`, and `e2e` checks and resolved review threads, but no
approval from a second account.

- Describe the problem and the resulting behavior, the decisions the change
  makes, the alternatives rejected, and the remaining limits. Link the issue.
- Add a "Verification" section: the commands run, the inputs tried beyond the
  tests, the platforms and Obsidian versions checked, and whether another agent
  reviewed the change, at which commit, and why or why not.
- Add tests, update every document the change makes stale, as
  [What a change updates](#what-a-change-updates) lists, and add user-visible
  changes to `Unreleased` in [CHANGELOG.md](CHANGELOG.md).
- Keep each pull request to one change.

A maintaining agent reviews every pull request. Releases, changes that could
lose or damage a drawing, and changes to the checks and release steps that guard
them also get an independent review by another agent, as
[AGENTS.md](AGENTS.md#review) describes. Labels are used as
[AGENTS.md](AGENTS.md#labels) says.

## Dependencies

- Every dependency is pinned exactly, and the lockfile is committed. The plugin
  bundles its runtime libraries, which go in `dependencies`; tools go in
  `devDependencies`. Add a runtime library only when the need cannot be met in a
  few lines, and say why in the pull request.
- CI audits `dependencies`, the code that ships. It does not audit the
  development tools, so that an advisory published for one of them does not fail
  every unrelated pull request: Dependabot's alerts report those, and the pinned
  overview [#10](https://github.com/viell-dev/slop-inkline/issues/10) tracks the
  ones that wait on a dependency.
- `allowScripts` in `package.json` lists which dependencies may run install
  scripts. npm warns about any other; approve one only if the project needs its
  script.
- Dependabot proposes updates weekly, a week after their publication, with
  development dependencies grouped. Security updates are not delayed.
- [dependabot.yml](.github/dependabot.yml) owns the update holds and their
  reasons; `package.json` owns dependency overrides. The pinned overview
  [#10](https://github.com/viell-dev/slop-inkline/issues/10) indexes dependency
  limits, evidence, workarounds, and conditions for removing them. Revalidate a
  hold before changing it, retaining compatible updates and accounting for any
  security fixes it suppresses.

## Releases

[RELEASING.md](RELEASING.md) describes how versions are prepared and published.
