<!--
If an AI agent wrote or submitted this pull request, start with a note saying
which agent, for whom, and whether a person reviewed it, for example:

> [!NOTE]
> Written and submitted by <model> via <harness> for <person>, who has not
> reviewed it.
-->

## Problem and resulting behavior

Describe what happens before and after this change for a reader who has not seen
the code, and link the issue.

## Decisions and limits

Explain the choices that matter to users and reviewers, the alternatives
rejected, and the remaining limits.

## Verification

For a release or substantial UI/workflow change, assess the human-testing gate
in RELEASING.md. Link the assigned test request and pending stable-release
blockers, or the completed human report and why it still covers this candidate.
State what changed since the tested build and how relevant open defects were
resolved or accepted. Candidate publication and this PR's merge must not close
an unanswered human request; link it in the handoff as well.

List the commands run, the inputs tried beyond the tests, the platforms and
Obsidian versions checked, and the CI run. Say whether another agent reviewed
the change, at which commit, and why or why not. Confirm that the documentation
and tests agree with the change and that `CHANGELOG.md` lists it under
`Unreleased`.

Confirm that guide changes describe the newest published release or visibly
label unreleased behavior **Unreleased**, preserving the released instructions.
For a release PR, remove those labels only for behavior included in the release.
