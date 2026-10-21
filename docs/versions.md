# Versions of this site

Each page's footer says which version of Inkline the site describes and the
commit it was built from; `version.json` at the site's root says the same for
tools.

## Before the first release

Inkline has no release yet, so the site describes the development version on
`main`, and says so on its home page and in every footer. Each change merged to
`main` deploys it again.

## Once Inkline has releases

The site will describe the newest release, prereleases included, since that is
the version you can install. Changes merged after it appear with the next
release; until then, the `Unreleased` section of the
[changelog](https://github.com/viell-dev/slop-inkline/blob/main/CHANGELOG.md)
lists them.

A correction to the current release's documentation does not wait for a new
release, and never moves the release's tag. It goes on a branch named
`docs-<version>`, made from the release's tag, and is deployed on request. The
Pages workflow refuses such a branch unless it contains the tag and changes
nothing outside `docs/`, so that the site never describes code that was not
released.

## How it is deployed

The [Pages workflow](https://github.com/viell-dev/slop-inkline/blob/main/.github/workflows/pages.yml)
builds the site with VitePress and deploys it to GitHub Pages, then reads the
deployed `version.json` and every page back, and fails unless they are the
commit it built. It has permission to deploy Pages only: it cannot push to the
repository, create a tag, or publish a release.
