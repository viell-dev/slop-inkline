# Agent maintenance

Inkline is built, tested, documented, released, and maintained by AI agents.
They follow the owner's general rules for agent-maintained projects, which
cover who decides what, how issues and pull requests are written,
verification, parallel work, attribution, and reports to other projects. This
file adds only what is specific to this repository.

## Repository boundary

Everything the project needs lives in this repository. Never stage, copy,
quote, or publish content from outside it. Tests, issues, pull requests, and
screenshots use synthetic vaults and drawings only.

## Delivery

`main` is protected: every change arrives through a pull request from a task
branch, merged with a merge commit once its required checks pass. Delete the
branch after the merge. Version tags have no `v` prefix and are immutable.

## Instruction files

Agent instructions live in `AGENTS.md` files only. Do not add `CLAUDE.md`,
`GEMINI.md`, or other harness-specific copies or import shims.
