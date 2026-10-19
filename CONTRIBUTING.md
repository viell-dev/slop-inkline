# Contributing

Issues and pull requests from people and from agents are welcome. The project is
maintained by AI agents, as the [README](README.md#status) says, and its owner
follows it through issue and pull request descriptions rather than code, so
write them for a reader who has not seen the code. Agents maintaining the
repository also follow [AGENTS.md](AGENTS.md). Everyone follows the
[code of conduct](CODE_OF_CONDUCT.md).

If an agent wrote your issue or pull request, open it with a short note, such as
a `> [!NOTE]` callout, that says so, names the model and the tool that ran it,
and says whether you reviewed it. The maintaining agents mark their own posts
the same way.

## Report a defect

Search the open and closed
[issues](https://github.com/viell-dev/slop-inkline/issues) first, then open one
with the bug form's details:

- the Inkline version, the Obsidian version and installer version, the operating
  system, and what you draw with: mouse, trackpad, pen, or touch;
- numbered steps from a new vault or note, with any theme or other plugins the
  problem needs;
- what happened, with any error message;
- what you expected instead.

A screenshot or a `.ink.png` file that shows the problem helps. Use synthetic
examples only, and leave private notes and drawings out of every report. Agents
should open an issue only when their operator has authorized publishing it.
Report vulnerabilities privately, as [SECURITY.md](SECURITY.md) describes.

## Set up

Development needs Node.js 24 or newer, with the npm it ships.

```sh
git clone https://github.com/viell-dev/slop-inkline.git
cd slop-inkline
npm ci
npm run build
```

The build writes `main.js`, `manifest.json`, and `styles.css` to `dist/`. To try
it, copy them into `.obsidian/plugins/inkline/` in a test vault and enable
Inkline in Settings, Community plugins. `npm run dev` rebuilds on every change.

## Checks

```sh
npm run check
```

`check` runs ESLint with the rules of Obsidian's community directory review
(`eslint-plugin-obsidianmd`) and typescript-eslint's strict type-checked rules,
Prettier, the TypeScript checks of the plugin, the tests, and the scripts, the
unit tests, and the build. `npm run format` applies Prettier. GitHub Actions
runs `check` on Linux and Windows, and a dependency audit on Linux.

## Tests

Unit tests use Vitest and live in `test/unit/`. They cover code that runs
without Obsidian; `npm test` runs them. Code that needs the browser's own
implementation, such as canvas encoding or how far a stream reads ahead, is also
tested in Obsidian's renderer: an end-to-end spec calls `loadModules()` from
`test/e2e/support/browser.ts`, which bundles `test/e2e/browser/entry.ts` and
makes the plugin's modules available there as `window.inklineTest`.

End-to-end tests live in `test/e2e/` and run the built plugin in real Obsidian
through WebdriverIO and
[wdio-obsidian-service](https://github.com/jesse-r-s-hines/wdio-obsidian-service).
Build first, then run them in one of two ways:

- `npm run test:e2e:docker` on any system with Docker, Windows included. It
  builds the image in `test/e2e/Dockerfile` from your checkout and runs the
  suite under a virtual display. The image never contains Obsidian; the first
  run downloads it into the Docker volume `inkline-obsidian-cache`.
- `npm run test:e2e` directly on a desktop with a display. On Linux without one,
  `sh test/e2e/session.sh` starts Xvfb and herbstluftwm first, as CI does.

`OBSIDIAN_VERSIONS` picks the Obsidian versions as space-separated
`appVersion/installerVersion` pairs. The default,
`earliest/earliest latest/latest`, tests the manifest's `minAppVersion` on the
oldest installer that can run it, which has the oldest Electron a user can have,
and the latest public release. Downloads outside Docker go to
`.obsidian-cache/`.

Screenshots and logs go to `test-results/e2e/`, which CI uploads as an artifact.
`E2E_OUTPUT_DIR` picks another directory, which must be new, empty, or an
earlier run's output: the harness marks its directory and refuses to clean any
other. Screenshots are for review, never assertions: a test reads state,
positions, or pixels back from Obsidian. Test vaults in `test/e2e/vaults/` and
every drawing a test uses are synthetic.

CI runs the end-to-end tests on Linux for every pull request, and the Docker
image weekly and on request.

## Pull requests

Every change to `main` goes through a pull request with passing CI and is merged
with a merge commit. `main` requires the `verify (ubuntu-latest)`,
`verify (windows-latest)`, and `e2e` checks and resolved review threads, but no
approval from a second account.

- Describe the problem and the resulting behavior, the decisions the change
  makes, the alternatives rejected, and the remaining limits. Link the issue.
- Add a "Verification" section: the commands run, the inputs tried beyond the
  tests, and the platforms and Obsidian versions checked.
- Add tests, update every document the change makes stale, and add user-visible
  changes to `Unreleased` in [CHANGELOG.md](CHANGELOG.md).
- Keep each pull request to one change.

Pull requests that change what ships are also reviewed by an agent from a
different model provider, as [AGENTS.md](AGENTS.md#review) describes.

## Dependencies

- Every dependency is pinned exactly, and the lockfile is committed. The plugin
  bundles its runtime libraries, which go in `dependencies`; tools go in
  `devDependencies`. Add a runtime library only when the need cannot be met in a
  few lines, and say why in the pull request.
- CI audits `dependencies`, the code that ships. The test tools carry advisories
  that only WebdriverIO 10 fixes, which `wdio-obsidian-service` does not support
  yet; [#9](https://github.com/viell-dev/slop-inkline/issues/9) tracks them.
- `allowScripts` in `package.json` lists which dependencies may run install
  scripts. npm warns about any other; approve one only if the project needs its
  script.
- Dependabot proposes updates weekly, a week after their publication, with
  development dependencies grouped. Security updates are not delayed.
- Some updates are held back, with the reason next to each in
  [dependabot.yml](.github/dependabot.yml): TypeScript 6.1 and later, ESLint 10,
  and WebdriverIO 10. `package.json` overrides the `obsidian` and `typescript`
  versions that `eslint-plugin-obsidianmd` asks for with the project's own. The
  pinned issue [#10](https://github.com/viell-dev/slop-inkline/issues/10) lists
  every such limit.

## Releases

[RELEASING.md](RELEASING.md) describes how versions are prepared and published.
