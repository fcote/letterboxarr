---
name: release
description: Commit, push, tag, and verify a Letterboxarr release. Use when asked to release or publish a patch, minor, or major version of this repository.
---

Take the working tree from where it is to a published release: one commit, a
push to `main`, an annotated tag, and the Docker images and GitHub Release the
tag builds.

The user's request says which part of the version moves. It must be `patch`,
`minor` or `major`. **If the user says none of those, ask which — do not
guess.** The keyword decides the number; it does not decide whether the
release is worth cutting.

## 1. Preflight

Stop and say why if any of these does not hold:

```bash
git branch --show-current          # must be main
git fetch --tags origin
git rev-list --left-right --count origin/main...main   # must not be behind
git status --short
git tag --sort=-v:refname | head -1
```

- **On `main`.** Tags are cut from it, so a release from anywhere else tags a
  commit the published image will not match.
- **Not behind `origin/main`.** Rebase or merge first; a tag on a stale main
  ships without whatever landed in between.
- **Something to release.** Either changes to commit, or a clean tree whose
  HEAD is not yet tagged. A clean tree at an already-tagged commit means there
  is nothing to do — say so rather than cutting an empty release.
- **Nothing secret staged.** `.env` is gitignored and must stay that way.

## 2. Commit

The repo's convention, visible in `git log`:

- **Subject**: `feat:`, `fix:` or `chore:`, then a lowercase phrase saying what
  changed from the point of view of someone using it. No trailing period. Not
  "update X" — what the change does, e.g. *fix: leave a film off the upcoming
  tab once it is out where you are*.
- **Body**: prose paragraphs, not bullets. What was wrong and what it looked
  like from the outside, then what it does now and why that is the right rule,
  then whatever else moved with it. Name real examples — an actual film, an
  actual list, an actual number. Wrap at 76 columns.
- **Trailer**: Preserve any trailers the user supplied. Do not add an
  agent-specific co-author trailer unless the user asks for one.

The prefix and the keyword usually agree — `feat:` with `minor`, `fix:` with
`patch`. **If they disagree, say so and ask** before committing. A `feat:`
released as a patch is usually one of them being wrong.

Write the message to a file or heredoc rather than a `-m` string, so the body
keeps its paragraphs.

## 3. Version

From the latest `vX.Y.Z` tag:

| keyword | from `v1.7.4` |
|---------|---------------|
| `patch` | `v1.7.5` |
| `minor` | `v1.8.0` |
| `major` | `v2.0.0` |

## 4. Push and tag

```bash
git push origin main
git tag -a vX.Y.Z -m "<tag message>"
git push origin vX.Y.Z
```

Tags are **annotated**, never lightweight. The message is the commit subject
with the `feat:`/`fix:`/`chore:` prefix dropped and the first letter
capitalised — *Leave a film off the upcoming tab once it is out where you are*.

Push `main` before the tag so the tag build never runs against a commit the
branch has not got.

## 5. Watch the publish

Both pushes trigger `.github/workflows/publish.yml`, and they publish different
things — both need to pass:

- **the tag push** → images `X.Y.Z`, `X.Y`, `X`, plus the GitHub Release
- **the `main` push** → the `latest` image

```bash
gh run list --limit 2 --json databaseId,headBranch,status
gh run watch <id> --exit-status
```

Report both conclusions. On a failure, name the failing step:

```bash
gh run view <id> --json jobs -q '.jobs[].steps[] | select(.conclusion=="failure") | "\(.number). \(.name)"'
gh run view <id> --log-failed
```

Do not call the release done until both runs are green. The git tag existing
proves nothing about the image — login is step 5 of 8, so a credential failure
leaves a tag with nothing published behind it.

## Known failures

**`unauthorized: personal access token is expired`** at *Log in to Docker Hub*.
The `DOCKERHUB_TOKEN` repository secret has lapsed. It needs a new Docker Hub
PAT with **Read & Write** scope, from
<https://app.docker.com/settings/personal-access-tokens>, set with
`gh secret set DOCKERHUB_TOKEN`. Then `gh run rerun <id>` on both runs — they
read the secret at run time, so nothing needs re-pushing or re-tagging.

**`Resource not accessible by personal access token`** from `gh run rerun`.
The `GITHUB_TOKEN` in the environment is underscoped or stale — re-running
needs **Actions: read and write**. The shell inherits its value from whatever
launched the session, so a token rotated since then is not visible: re-source
the shell's secrets file and retry before concluding the token itself is wrong.
Failing that, re-run the jobs from the run's page on GitHub.
