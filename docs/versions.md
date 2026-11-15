# Versions of this site

The guide lives in `docs/` on the repository's protected `main` branch. Each
page's footer records the installable version it describes and the exact main
commit used to build it; `version.json` records the same facts for tools.

## The current release

The default guide describes the newest published release, including
pre-releases. Behavior that has not been released is labelled **Unreleased**;
the
[changelog](https://github.com/viell-dev/slop-inkline/blob/main/CHANGELOG.md)
records those changes too.

Documentation corrections go through ordinary pull requests to `main` and deploy
from there. They do not need a separate documentation branch, a new software
release, or a moved tag.

Preparing a new software version can put its guide on main before its download
exists. The Pages workflow reads the version from `package.json`, which names
pre-releases as well as public releases, and keeps the existing site until that
version is published; then it is run again on `main`. Before the first release,
only the explicitly unreleased `0.0.0` guide can deploy.

## Copies of the file format

**Unreleased:** from 0.9.4, the [file format](./file-format.md) is also kept
outside this site, so that what a symbol file holds stays known if the site or
the repository goes. Every GitHub release carries a copy of it as of the commit
the release tags, named by the format's version and the document's revision,
listed in the release's `SHA256SUMS` and attested with its other files. From
1.0.0, each public release is also to ask
[Software Heritage](https://www.softwareheritage.org/) to archive the repository
and the [Wayback Machine](https://web.archive.org/) to keep this site's format
page, as the
[release guide](https://github.com/viell-dev/slop-inkline/blob/main/RELEASING.md#archive-copies)
describes.

## How it is deployed

The
[Pages workflow](https://github.com/viell-dev/slop-inkline/blob/main/.github/workflows/pages.yml)
builds VitePress from its own main commit, deploys to GitHub Pages, and reads
`version.json` and every page back. It fails unless the pages identify that
exact commit. It refuses tags and other branches, and has permission to deploy
Pages only: it cannot push code, change tags, or publish a release. The
`github-pages` environment permits deployment from `main` only.
