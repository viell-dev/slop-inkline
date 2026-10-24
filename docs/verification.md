# Promises and evidence

What Inkline promises, and the checks that show each promise holds. Every check
here runs on every pull request unless it says otherwise;
[CONTRIBUTING.md](https://github.com/viell-dev/slop-inkline/blob/main/CONTRIBUTING.md)
says how to run them.

## Where the checks run

| Check                     | What it runs                                                                                                                                                                | Where                                                                                                                            |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `verify (ubuntu-latest)`  | `npm run check`: ESLint with Obsidian's directory rules, Prettier, types, the unit tests, the build, and this site's build                                                  | GitHub Actions, Linux; required                                                                                                  |
| `verify (windows-latest)` | The same                                                                                                                                                                    | GitHub Actions, Windows; required                                                                                                |
| `e2e`                     | The end-to-end suite in real Obsidian: 1.13.4, the manifest's minimum, on the oldest installer that runs it, and the latest public release                                  | GitHub Actions, Linux, under Xvfb; required                                                                                      |
| `e2e in Docker`           | The same suite in the image `npm run test:e2e:docker` builds                                                                                                                | Weekly and on request                                                                                                            |
| Weekly CI                 | Every check above, so that a new Obsidian release is tested within a week                                                                                                   | Mondays                                                                                                                          |
| Settings                  | The live labels and rulesets against their files, and every issue's labels                                                                                                  | Weekly and on request                                                                                                            |
| Pages                     | This site, deployed and read back page by page                                                                                                                              | After each change to `main` until the first release; then on request, on the newest release's tag or its `docs-<version>` branch |
| Release                   | The commit's required CI, the release checks, and the release's own files installed in Obsidian, as a dry run on request and on pull requests that change the release steps | On request, and on those pull requests                                                                                           |

The end-to-end tests assert on state, positions, and pixels read back from
Obsidian, never on screenshots; their screenshots are kept as artifacts for
review.

## The promises

### Symbol files stay readable, and look the same

A symbol is a PNG with a version 1 record, which every later version reads, and
saving it again never changes it.

- Unit tests of the PNG codec, the record, and symbol files:
  [png.test.ts](https://github.com/viell-dev/slop-inkline/blob/main/test/unit/format/png.test.ts),
  [record.test.ts](https://github.com/viell-dev/slop-inkline/blob/main/test/unit/format/record.test.ts),
  and
  [ink-file.test.ts](https://github.com/viell-dev/slop-inkline/blob/main/test/unit/format/ink-file.test.ts),
  including chunks that are not well formed and files from later versions.
- Pinned golden files in
  [test/fixtures/format](https://github.com/viell-dev/slop-inkline/tree/main/test/fixtures/format),
  read on every change, in Node.js and in Obsidian's own renderer
  ([format.e2e.ts](https://github.com/viell-dev/slop-inkline/blob/main/test/e2e/specs/format.e2e.ts)).
  They are never changed: a new case gets a new file.
- Pinned stroke outlines in
  [test/fixtures/outline](https://github.com/viell-dev/slop-inkline/tree/main/test/fixtures/outline):
  an update of the stroke library that would change how saved strokes look fails
  [outline.test.ts](https://github.com/viell-dev/slop-inkline/blob/main/test/unit/ink/outline.test.ts).
- In Obsidian, saving a symbol again after reopening it gives the same bytes,
  however far the drawing sits from the origin, and the pixels the browser
  decodes are exactly those encoded
  ([ink.e2e.ts](https://github.com/viell-dev/slop-inkline/blob/main/test/e2e/specs/ink.e2e.ts)).

### The prototype's files and other pictures open

- Synthetic files in the prototype's format, at two sizes, in
  [test/fixtures/legacy](https://github.com/viell-dev/slop-inkline/tree/main/test/fixtures/legacy),
  open as a base layer of their own pixels, pixel for pixel, scaled to the
  line's height
  ([ink.e2e.ts](https://github.com/viell-dev/slop-inkline/blob/main/test/e2e/specs/ink.e2e.ts)).
- Pictures without a record, transparent ones, pictures one or two pixels high,
  and records that cannot be scaled open from their pixels, and a record from a
  later version is refused (the same file).

### Symbols read as characters

- In Live Preview and Reading view, in light and dark themes, a symbol stands on
  the text's baseline, as tall as the line box, and its pixels take the text's
  colour, read back from Obsidian
  ([render.e2e.ts](https://github.com/viell-dev/slop-inkline/blob/main/test/e2e/specs/render.e2e.ts)).
- The same holds in callouts, tables, embedded notes, hover previews, canvas
  cards, and popout windows; symbol files on their own and images from outside
  the vault stay pictures; and with Inkline disabled, symbols are plain images
  (the same file).

### Drawing is never lost

- The close question, saving from it, a failed save that keeps the editor open,
  strokes drawn while a save runs, and a stroke still being drawn when saving
  ([editor.e2e.ts](https://github.com/viell-dev/slop-inkline/blob/main/test/e2e/specs/editor.e2e.ts)).
- Drafts: kept when Inkline is disabled, through a restart while a save writes
  the file, when the storage refuses one, offered to one editor at a time, and a
  first save that an interruption cut short finished from its draft (the same
  file, and
  [drafts.test.ts](https://github.com/viell-dev/slop-inkline/blob/main/test/unit/editor/drafts.test.ts)).
- A file changed on disk while the editor is open: taken in, asked about,
  reloaded with the drawing one undo away, never saved over when it cannot be
  read, and saved again where it was if deleted (the same file, and
  [disk.test.ts](https://github.com/viell-dev/slop-inkline/blob/main/test/unit/editor/disk.test.ts)).

### Text it was not asked to change stays as it was

- The link scanner, which reads links as Obsidian does, with a randomized test
  that an insertion never lands inside a link and moves nothing outside one
  ([links.test.ts](https://github.com/viell-dev/slop-inkline/blob/main/test/unit/notes/links.test.ts)
  and
  [insertion.test.ts](https://github.com/viell-dev/slop-inkline/blob/main/test/unit/notes/insertion.test.ts)).
- In Obsidian: a symbol goes after a link, an embed, or an address the cursor
  was in; into the note it was started in, through its live editor or its file;
  and found again after the text moved
  ([editor.e2e.ts](https://github.com/viell-dev/slop-inkline/blob/main/test/e2e/specs/editor.e2e.ts)).
  Type to insert lists nothing in code or front matter, and the links it writes
  lead back to their symbols
  ([suggest.e2e.ts](https://github.com/viell-dev/slop-inkline/blob/main/test/e2e/specs/suggest.e2e.ts)).
- Names and renames: what a file name cannot hold, names a folder already has,
  renames that fail, and names given elsewhere
  ([names.test.ts](https://github.com/viell-dev/slop-inkline/blob/main/test/unit/notes/names.test.ts)
  and
  [editor.e2e.ts](https://github.com/viell-dev/slop-inkline/blob/main/test/e2e/specs/editor.e2e.ts)).
- Edit symbol only where the cursor or the pointer is on a symbol, in every
  entry point
  ([entry.e2e.ts](https://github.com/viell-dev/slop-inkline/blob/main/test/e2e/specs/entry.e2e.ts)).
- The library lists symbols and their referring notes, filters by name and
  folder, follows file and link changes, and inserts successive symbols without
  replacing selected text or splitting a link
  ([catalog.test.ts](https://github.com/viell-dev/slop-inkline/blob/main/test/unit/library/catalog.test.ts)
  and
  [library.e2e.ts](https://github.com/viell-dev/slop-inkline/blob/main/test/e2e/specs/library.e2e.ts)).

### Preferences are kept and apply where they are shown

- Validated defaults and saved values, including invalid data
  ([settings.test.ts](https://github.com/viell-dev/slop-inkline/blob/main/test/unit/settings.test.ts)).
- The real settings tab, immediate trigger changes, drawing defaults after
  reload, stored-grey pixels and explicit sizes, new and existing popouts,
  ordered writes, write failures followed by recovery, and malformed settings
  ([settings.e2e.ts](https://github.com/viell-dev/slop-inkline/blob/main/test/e2e/specs/settings.e2e.ts)).

### The keyboard reaches everything but drawing

- Each control is labelled, its tooltip shows its key, toggles say whether they
  are on, and keys give way to a text field
  ([editor.e2e.ts](https://github.com/viell-dev/slop-inkline/blob/main/test/e2e/specs/editor.e2e.ts)).
- This site lists every command and every button's key as the code has them
  ([docs.test.ts](https://github.com/viell-dev/slop-inkline/blob/main/test/unit/docs.test.ts)).

### It stays quick

Each of these asserts a budget beside its correctness checks:

| What                                                                                     | Budget      | Where                                                                                              |
| ---------------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------- |
| Tagging a thousand symbols in a note, the fastest of five runs                           | 50 ms       | [render.e2e.ts](https://github.com/viell-dev/slop-inkline/blob/main/test/e2e/specs/render.e2e.ts)  |
| Searching 5,000 symbols as each letter of a name is typed, each query's fastest of three | 100 ms      | [scale.e2e.ts](https://github.com/viell-dev/slop-inkline/blob/main/test/e2e/specs/scale.e2e.ts)    |
| Keeping a draft with a large base layer, after the first                                 | 50 ms each  | [editor.e2e.ts](https://github.com/viell-dev/slop-inkline/blob/main/test/e2e/specs/editor.e2e.ts)  |
| Previewing the ink of a 4K screenshot                                                    | 300 ms      | [ink.e2e.ts](https://github.com/viell-dev/slop-inkline/blob/main/test/e2e/specs/ink.e2e.ts)        |
| Saving, without waiting for the window to be idle                                        | 700 ms each | [editor.e2e.ts](https://github.com/viell-dev/slop-inkline/blob/main/test/e2e/specs/editor.e2e.ts)  |
| Reading long lines of failed links in one pass                                           | 3 s each    | [links.test.ts](https://github.com/viell-dev/slop-inkline/blob/main/test/unit/notes/links.test.ts) |

### A release is what was tested

- A release is refused unless the commit's required checks, the end-to-end tests
  in both Obsidian versions included, passed within the last week
  ([publish.test.ts](https://github.com/viell-dev/slop-inkline/blob/main/test/unit/publish.test.ts)).
- Before publishing, the release's own files are installed in Obsidian, in the
  oldest and the latest version, and must be those files byte for byte, load
  with their version, commands, and styles, and save a symbol
  ([package.e2e.ts](https://github.com/viell-dev/slop-inkline/blob/main/test/e2e/specs/package.e2e.ts)).
  Every end-to-end run checks the build in `dist/` the same way.
- A publication that fails part way can run again without replacing anything
  published: each failure is run against a fake GitHub
  ([publish.test.ts](https://github.com/viell-dev/slop-inkline/blob/main/test/unit/publish.test.ts)).

### What this site and the repository say agrees

- The release metadata agrees across `package.json`, `manifest.json`, and
  `versions.json`, and each release has its changelog section
  ([release.test.ts](https://github.com/viell-dev/slop-inkline/blob/main/test/unit/release.test.ts)).
- This site's commands, keys, defaults, Obsidian version, links, and example
  embeds agree with the code
  ([docs.test.ts](https://github.com/viell-dev/slop-inkline/blob/main/test/unit/docs.test.ts)),
  and what deploys follows [Versions of this site](./versions.md)
  ([docs-source.test.ts](https://github.com/viell-dev/slop-inkline/blob/main/test/unit/docs-source.test.ts)).

## Checks shown to fail

A check is only evidence if it fails when what it checks breaks. Pull requests
record where they broke the behaviour on purpose and watched the check fail, or
ran a check against the code before a fix: among them, the checks of code in
fences ([#50](https://github.com/viell-dev/slop-inkline/pull/50)), the link
scanner's budgets against each earlier slow scanner
([#49](https://github.com/viell-dev/slop-inkline/pull/49)), the test of a failed
rename with a slow stroke
([#51](https://github.com/viell-dev/slop-inkline/pull/51)), the harness's waits
with slowed frames ([#53](https://github.com/viell-dev/slop-inkline/pull/53)),
the budgets for tagging and for searching a large vault against slow code
([#54](https://github.com/viell-dev/slop-inkline/pull/54)), and the release's CI
check against a commit whose CI never ran
([#55](https://github.com/viell-dev/slop-inkline/pull/55)).

## Limits of this evidence

- The end-to-end tests run on Linux only. The unit tests and the build also run
  on Windows; Obsidian on Windows and macOS is not tested.
- Pens and touch are tested with WebDriver's pointer events, which carry
  pressure and pointer types, not with real devices.
- Obsidian's mobile apps are not tested, as Inkline does not support them.
- Printing and PDF export of notes with symbols are not checked yet.
- CI's runners have the DejaVu fonts, and the Docker image DejaVu and Noto; a
  theme's own font is checked through the guides' measurement, not by eye.
- Installing a published release, and its attestation, are not tested yet, as
  there is no release.
- The budgets are wall-clock times. Each leaves room for a slow machine, but
  heavy work beside a run can still exceed one; such a failure is investigated,
  not run again until it passes.
