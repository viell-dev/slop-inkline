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

Once a release is published, the Pages workflow is run on its tag, which deploys
the site from it.

A correction to the current release's documentation does not wait for a new
release, and never moves the release's tag. It goes on a branch named
`docs-<version>`, made from the release's tag, and the Pages workflow is run on
that branch. It refuses such a branch unless it contains the tag and changes
nothing outside `docs/` but the files that deploy the site, so that the site
never describes code that was not released, and a defect in the deployment can
still be mended for a release. Its dependencies cannot change there, so a
dependency that stops building the site waits for the next release. A
`docs-<version>` branch is made only by these steps, and a ruleset keeps it from
being deleted or rewritten, so that what a deployment was built from stays
readable.

## How it is deployed

The
[Pages workflow](https://github.com/viell-dev/slop-inkline/blob/main/.github/workflows/pages.yml)
builds the site with VitePress from the commit it runs on, never another, and
deploys it to GitHub Pages, then reads the deployed `version.json` and every
page back, and fails unless they are the commit it built. It has permission to
deploy Pages only: it cannot push to the repository, create a tag, or publish a
release. The repository's Pages are built by GitHub Actions, and its
`github-pages` environment takes deployments only from `main`, `docs-*`
branches, and version tags. These rules guard against mistakes, not against a
person with write access to the repository: a run on a tag or a `docs-*` branch
uses that ref's own workflow, which can deploy the site and nothing else, so
what such a ref can change is the site.
