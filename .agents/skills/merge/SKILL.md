---
name: merge
description: Put the current Letterboxarr changes on a conventional branch, commit and push them, create a Why/What pull request, prove it with CI, and squash-merge it to main. Use for /merge or when asked to commit, push, open a PR, and merge work without creating a release or tag.
---

Take the current work to a merged pull request: verify it, put it on a
`feat/<name>`, `fix/<name>` or `chore/<name>` branch, commit and push it, open a
PR with a useful Why/What description, require CI to pass, and squash-merge it
to `main`. This workflow does not create a version tag or GitHub Release.

## 1. Inspect the work and its base

Start with read-only checks:

```bash
git fetch origin main
git branch --show-current
git rev-list --left-right --count origin/main...HEAD
git status --short
git diff
git diff --cached
gh pr status
```

For new uncommitted work, require `HEAD` to equal `origin/main`. The current
branch may be `main` or a temporary branch such as `bb/<task>`; switch away from
it before committing. Stop if it is behind `origin/main`, or if commits ahead of
`origin/main` are unrelated to the requested work.

Resume an earlier merge attempt when the current conventional branch or its PR
contains the same intended change. Do not make a second branch, commit or PR
merely because the earlier run stopped while CI or GitHub was still working.

Inspect every changed and staged path. `.env` is gitignored and must stay that
way; stop rather than commit a credential or unrelated user change.

## 2. Describe and verify the change

Derive these from the diff without asking the user to supply routine wording:

- A conventional subject using `feat:`, `fix:` or `chore:` followed by a
  lowercase phrase describing the user-visible result. Do not end it with a
  period or say merely "update X".
- A **Why** paragraph explaining what was wrong or missing and how that appeared
  outside the code.
- A **What** paragraph explaining what now happens and why the implementation
  fits the repository.

Run verification appropriate to the diff before committing. This repository
has no test suite: use `cd frontend && npx tsc --noEmit` for frontend changes,
and exercise the real server or changed helper for backend behavior as directed
by `AGENTS.md`. Documentation-only changes need whitespace and syntax checks,
not an unrelated application build.

## 3. Switch to a conventional branch and commit

Turn the subject into a short lowercase kebab-case name without its prefix, and
switch automatically to the matching branch. Use three to six meaningful words
and remove punctuation rather than escaping it:

| subject | branch |
|---------|--------|
| `feat: page watch items as you scroll` | `feat/page-watch-items` |
| `fix: keep the search field during reload` | `fix/keep-search-field` |
| `chore: share merge guidance across agents` | `chore/share-merge-guidance` |

Do not ask the user to name the branch. If the name already belongs to unrelated
local or remote work, add a short meaningful qualifier rather than overwrite or
reuse it.

When `HEAD` equals `origin/main`, create the branch from `origin/main` and carry
the working-tree changes across:

```bash
git switch -c <type>/<name> origin/main
git add <intentional paths>
git commit --file <commit-message-file>
```

If the intended work is already committed on a temporary branch, create the
conventional branch at that exact HEAD and do not manufacture an empty commit.
If an intended conventional branch already exists, stay on it and commit only
remaining changes.

The commit message starts with the subject. Its body is prose based on Why and
What, wrapped at 76 columns. Preserve trailers the user supplied; do not add an
agent-specific co-author trailer unless requested. Keep the message file in the
thread's temporary storage so it cannot enter the commit.

## 4. Push and create the PR

```bash
git push --set-upstream origin <type>/<name>
gh pr create --base main --head <type>/<name> --title "<subject>" --body-file <pr-body-file>
```

Keep the PR body file in temporary storage. Its useful minimum structure is:

```markdown
## Why

<the externally visible problem or need>

## What

<the behavior and implementation that address it>
```

If a PR for the branch already exists, verify its base, title and body and
update the existing PR when necessary. Never open a duplicate.

## 5. Prove and merge the PR

Record the PR head, base and potential merge OIDs. Find and watch the
pull-request workflow for that potential merge commit, then read all three OIDs
again. If any changed while CI ran, repeat against the new candidate. Require a
stable, passing set:

```bash
gh pr view <number> --json headRefOid,baseRefOid,potentialMergeCommit
gh run list --workflow publish.yml --event pull_request --commit <potential-merge-oid> --json databaseId,headSha,status,conclusion,url
gh run watch <pr-run-id> --exit-status
gh pr view <number> --json headRefOid,baseRefOid,potentialMergeCommit
```

Squash-merge the exact checked head so the conventional subject becomes the
single commit on `main`:

```bash
gh pr merge <number> --squash --match-head-commit <checked-head-oid>
gh pr view <number> --json state,mergeCommit,url
git fetch origin main
git merge-base --is-ancestor <merge-commit> origin/main
```

Require the PR to report `MERGED`, provide a merge commit OID, and show that OID
in `origin/main`. Leave local and remote branch cleanup out of this workflow:
deleting the checked-out branch from a linked worktree can fail after a
successful merge and obscure the result.

Report the branch, commit, PR URL, passing PR workflow and merge commit. Do not
create or push any tag. On failure, name the first incomplete step and preserve
the branch and PR so the workflow can resume safely.
