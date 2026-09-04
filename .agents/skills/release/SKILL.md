---
name: release
description: Create a conventional branch and PR, merge it, tag it, and verify a Letterboxarr release. Use when asked to release or publish a patch, minor, or major version of this repository.
---

Take the working tree from where it is to a published release: one conventional
commit on a `feat/<name>`, `fix/<name>` or `chore/<name>` branch, a reviewed-by-CI
pull request with a useful Why/What description, a squash merge, an annotated
tag on that merge, and the Docker images and GitHub Release the tag builds.

The user's request says which part of the version moves. It must be `patch`,
`minor` or `major`. **If the user says none of those, ask which — do not
guess.** The keyword decides the number; it does not decide whether the
release is worth cutting.

## 1. Preflight and release copy

Inspect before changing git or GitHub:

```bash
git fetch origin main --tags
git branch --show-current
git rev-list --left-right --count origin/main...HEAD
git status --short
git tag --sort=-v:refname | head -1
gh pr status
```

For a new release, require `HEAD` to equal `origin/main`. The current branch may
be `main` or a temporary branch such as `bb/<task>`; the release flow replaces
that branch context in the next step. Stop if the current branch has commits
not on `origin/main`, because silently folding old branch work into the release
would make the PR larger than the working-tree change the user approved. Stop
if it is behind, too, rather than building on a stale base.

There must be a working-tree change to commit. A clean tree at an already
tagged commit has nothing to release. If an earlier run already created the
release branch, PR, merge or tag, inspect those artifacts and resume the first
unfinished step instead of creating replacements.

Check the diff and staged files for credentials. `.env` is gitignored and must
stay that way.

Before making the branch, write these pieces of release copy:

- A conventional subject using `feat:`, `fix:` or `chore:` followed by a
  lowercase phrase describing what changed for a user. Do not end it with a
  period or say merely "update X".
- A **Why** paragraph saying what was wrong or missing and what that looked like
  from outside the code.
- A **What** paragraph saying what now happens and why that is the right rule.
  Name real examples, counts or components where that makes the explanation
  concrete.

The prefix and version usually agree: `feat:` with `minor`, and `fix:` or
`chore:` with `patch`. A breaking change can be `major`. **If the requested
bump and the actual change disagree, ask before creating the branch.**

Run verification appropriate to the diff before committing. The repository has
no test suite, so use `cd frontend && npx tsc --noEmit` for frontend changes
and exercise the real server or changed helper for backend behavior as directed
by `AGENTS.md`. A Docker build in CI is not a substitute for proving the change
works.

## 2. Switch to the release branch and commit

Turn the subject into a short lowercase kebab-case name without the prefix,
then switch automatically to the matching branch:

| subject | branch |
|---------|--------|
| `feat: page watch items as you scroll` | `feat/page-watch-items` |
| `fix: keep the search field during reload` | `fix/keep-search-field` |
| `chore: share guidance across coding tools` | `chore/share-agent-guidance` |

Use three to six meaningful words; remove punctuation rather than escaping it.
Do not ask the user to name the branch. If that name exists locally or on the
remote for unrelated work, append the target version, such as
`fix/keep-search-field-v1-9-2`, instead of overwriting or reusing it.
Treat an existing branch as a resumable release only when its open or merged PR
has the same subject, target version and `main` base; otherwise it is unrelated.

```bash
git switch -c <type>/<name> origin/main
git add <intentional paths>
git commit --file <commit-message-file>
```

The commit message starts with the subject, then uses prose paragraphs based on
Why and What. Wrap the body at 76 columns. Preserve trailers supplied by the
user; do not add an agent-specific co-author trailer unless requested.

## 3. Push and open the pull request

```bash
git push --set-upstream origin <type>/<name>
gh pr create --base main --head <type>/<name> --title "<subject>" --body-file <pr-body-file>
```

Keep commit-message and PR-body files in the thread's temporary storage, not in
the repository, so release prose cannot accidentally become part of the commit.

The PR body has exactly this useful minimum structure, with prose rather than
restating the headings:

```markdown
## Why

<the externally visible problem or need>

## What

<the behavior and implementation that address it>
```

Keep the PR URL and number for the remaining commands and final report.

## 4. Prove the PR and merge it

Record the PR head, base and potential merge OIDs. Find the pull-request run for
that potential merge commit and watch that exact run, then read all three OIDs
again. If any changed while CI ran, repeat against the new merge commit. Require
a stable, passing set before merging:

```bash
gh pr view <number> --json headRefOid,baseRefOid,potentialMergeCommit
gh run list --workflow publish.yml --event pull_request --commit <potential-merge-oid> --json databaseId,headSha,status,conclusion,url
gh run watch <pr-run-id> --exit-status
gh pr view <number> --json headRefOid,baseRefOid,potentialMergeCommit
gh pr merge <number> --squash --match-head-commit <checked-head-oid>
gh pr view <number> --json state,mergeCommit,url
```

Use a squash merge so the conventional subject remains the single release
commit on `main`. Do not tag an open PR or the head of its feature branch. The
PR must report `MERGED` and provide a merge commit OID.

Leave the local and remote release branches in place during publishing. In a
linked worktree, `gh pr merge --delete-branch` can try to delete the branch that
worktree has checked out. Branch cleanup is separate from the release and must
not delay or endanger the tag.

## 5. Prove the merged commit

Fetch `main` after the merge and verify the reported merge commit is contained
in `origin/main`. This works in a BB worktree where local `main` may be checked
out elsewhere; do not try to force-switch that worktree.

```bash
git fetch origin main --tags
git merge-base --is-ancestor <merge-commit> origin/main
```

Even a stable PR check cannot atomically prevent `main` moving in the instant
before an unprotected repository accepts the merge. Find and watch the `main`
push run for the exact merge commit before creating a tag. This validates the
commit that will actually be released, not merely the PR's earlier candidate:

```bash
gh run list --workflow publish.yml --event push --branch main --commit <merge-commit> --json databaseId,headSha,status,conclusion,url
gh run watch <main-run-id> --exit-status
```

If the exact `main` run does not pass, stop without tagging. Name its failing
step and leave the already merged PR visible for diagnosis.

## 6. Version and tag the merge

Calculate the target from the latest `vX.Y.Z` tag found during preflight:

| keyword | from `v1.7.4` |
|---------|---------------|
| `patch` | `v1.7.5` |
| `minor` | `v1.8.0` |
| `major` | `v2.0.0` |

Fetch tags once more immediately before tagging. Require the latest version tag
to be exactly the one recorded during preflight and require the target tag not
to exist. If either condition changed while the PR was open, stop and report
the collision; do not create an out-of-order version, move a tag, replace it or
silently renumber a release after its PR has merged.

```bash
git tag -a vX.Y.Z <merge-commit> -m "<tag message>"
git push origin vX.Y.Z
```

Tags are annotated, never lightweight. The message is the subject with its
`feat:`/`fix:`/`chore:` prefix dropped and its first letter capitalised —
*Keep the search field during reload*.

## 7. Watch the tag publish

Three builds matter over the whole flow:

- **the PR build** proves the proposed image builds before merge;
- **the merge push to `main`** publishes the `latest` image;
- **the tag push** publishes images `X.Y.Z`, `X.Y`, `X`, and the GitHub Release.

The PR and `main` runs were watched before tagging. Query the publishing
workflow for the tag push at the merge SHA. A run may take a moment to
register, so repeat this read-only query for a short bounded period until it
contains the `vX.Y.Z` head branch, then watch that exact run ID:

```bash
gh run list --workflow publish.yml --event push --branch vX.Y.Z --commit <merge-commit> --json databaseId,headSha,status,conclusion,url
gh run watch <tag-run-id> --exit-status
```

Report the branch, PR, merge commit, tag and all three build conclusions. Do not
call the release done until the PR, `main` and tag runs are green. A tag existing
proves nothing about the image: Docker Hub login is step 5 of 8, so a credential
failure leaves a tag with nothing published behind it.

On failure, name the failing step:

```bash
gh run view <id> --json jobs -q '.jobs[].steps[] | select(.conclusion=="failure") | "\(.number). \(.name)"'
gh run view <id> --log-failed
```

## Known failures

**`unauthorized: personal access token is expired`** at *Log in to Docker Hub*.
The `DOCKERHUB_TOKEN` repository secret has lapsed. It needs a new Docker Hub
PAT with **Read & Write** scope, from
<https://app.docker.com/settings/personal-access-tokens>, set with
`gh secret set DOCKERHUB_TOKEN`. Credential rotation is a separate privileged
action: pause for the user's authorization and use the `secrets` skill to
receive it without exposing its value. Once the user confirms the secret was
replaced, run `gh run rerun <id>` on each affected push run — they read the
secret at run time, so nothing needs re-pushing or re-tagging.

**`Resource not accessible by personal access token`** from `gh run rerun`.
The `GITHUB_TOKEN` in the environment is underscoped or stale — re-running
needs **Actions: read and write**. The shell inherits its value from whatever
launched the session, so a token rotated since then is not visible: re-source
the shell's secrets file and retry before concluding the token itself is wrong.
Failing that, re-run the jobs from the run's page on GitHub.
