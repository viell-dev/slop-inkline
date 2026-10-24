# Versions of this site

The guide lives in `docs/` on the repository's protected `main` branch. Each
page's footer records the installable version it describes and the exact main
commit used to build it; `version.json` records the same facts for tools.

## The current release

The default guide describes the newest published release, including release
candidates. Behavior that has not been released is labelled **Unreleased**; the
[changelog](https://github.com/viell-dev/slop-inkline/blob/main/CHANGELOG.md)
records those changes too.

Documentation corrections go through ordinary pull requests to `main` and deploy
from there. They do not need a separate documentation branch, a new software
release, or a moved tag. The historical `docs-0.1.0` branch records an earlier
deployment; it is no longer used for current guide updates.

Preparing a new software version can put its guide on main before its download
exists. The Pages workflow keeps the existing site until that version is
published, then it is run again on `main`. Before the first release, only the
explicitly unreleased `0.0.0` guide can deploy.

## How it is deployed

The
[Pages workflow](https://github.com/viell-dev/slop-inkline/blob/main/.github/workflows/pages.yml)
builds VitePress from its own main commit, deploys to GitHub Pages, and reads
`version.json` and every page back. It fails unless the pages identify that
exact commit. It refuses tags and other branches, and has permission to deploy
Pages only: it cannot push code, change tags, or publish a release.
