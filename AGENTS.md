# Letterboxarr agent guide

Letterboxarr is a FastAPI service that scrapes Letterboxd lists and sends their
films to Radarr. `main.py` serves the API and built React SPA on port 7373 while
a background thread crawls and syncs. The application ships as one Docker image.

## Commands

```bash
# Run the API and built frontend at http://localhost:7373
python main.py

# Install and build the frontend
cd frontend && npm install && npm run build

# Type-check the frontend
cd frontend && npx tsc --noEmit

# Lint the frontend
cd frontend && npm run lint

# Install and run the backend linters
python -m pip install -r requirements-lint.txt
ruff check . && bandit -c pyproject.toml -r .

# Build the image
docker build -t letterboxarr .
```

There is no test suite. Verify changes against the running application, or use a
small throwaway script for a pure function. `npm start` serves the frontend on
port 3000, but API requests will fail because axios uses `/api` and
`frontend/package.json` has no proxy. Build the frontend and serve it through
the backend instead.

### Required lint checks

Pull request CI enforces the same checks listed above. Before handing off any
change, run every lint suite whose files could be affected:

- For frontend changes, run `cd frontend && npm run lint`.
- For backend or repository-level Python changes, run `ruff check .` and
  `bandit -c pyproject.toml -r .` from the repository root.
- For changes spanning both areas, run all three commands.

Treat `frontend/.oxlintrc.json` and the Ruff and Bandit sections of
`pyproject.toml` as the source of truth. Fix violations in the code. Do not
weaken a rule or add an inline suppression merely to make CI pass; suppress a
finding only when it is a genuine false positive, keep the suppression as
narrow as possible, and explain why it is safe in a full-sentence comment.

### Import safety

Importing `lib_api` constructs the global `LetterboxarrAPIContext`. When
`config.yml` exists, that import opens and migrates `data/letterboxarr.db` and
starts the live Letterboxd/Radarr sync thread. Do not import it while pointing at
data or services you are unwilling to modify.

## Architecture and invariants

```text
config.yml -> lib_config -> lib_sync
                              |-> lib_refresh -> lib_letterboxd -> SQLite
                              `-> lib_radarr
SQLite -> lib_api -> React SPA
```

- `lib_sync.LetterboxarrSync.sync_once()` runs a round: refresh listings, send
  new films to Radarr, read release tables, then read ratings.
- `lib_refresh.ListRefresher` owns stored-data freshness. API routes read SQLite
  and must never crawl Letterboxd.
- SQLite is the application's source of truth, not a disposable cache. Replace a
  listing only after its complete replacement has been read.
- A partial or refused crawl must raise. Returning partial results can overwrite
  a complete list and make downstream code treat missing films as removals.

### Crawl limits

All Letterboxd requests share `crawl_lock`; never make crawls concurrent. Paging
loops pause between requests. Release tables and ratings cost one page per film,
so `lib_refresh.py` budgets them separately:

| Data | Maximum age | Reads per round |
| --- | ---: | ---: |
| Release tables | 12 hours | 100 |
| Ratings | 30 days | 500 |

Increasing these values directly lengthens sync rounds. Unread work is logged
and carried into later rounds.

### Scraper constraints

- Use `curl_cffi`'s requests-compatible client, not Requests, for Letterboxd.
  Browser fingerprints are tried in order because some are refused on later
  member-list pages.
- `CATEGORY_SKIP_FILTERS` is ordered because categories overlap. Keep
  `unreleased` first.
- Parse release dates with `MONTHS`, not `strptime`; `%b` depends on locale.
- Watch items accept paths or full URLs. Preserve full `boxd.it` URLs because a
  privately shared list may 404 at its ordinary `/<member>/list/<slug>/` URL.
- Read posters from the main column. Cloned lists repeat their source's posters
  in the sidebar.

## Configuration

`config.yml` is the live application configuration and is edited both by hand
and through the UI. See `examples/config.example.yml`.

- A repository `.env` file is not loaded by the application.
  `lib_config.load_config_from_env()` has no call sites and is legacy code.
- `SECRET_KEY`, `ADMIN_USERNAME`, and `ADMIN_PASSWORD` are read from the
  environment when `lib_api` is imported. Their defaults are insecure.
- `letterboxd.country` must use Letterboxd's spelling from its release tables,
  such as `USA`, `UK`, `France`, or `Czechia`; it drives the Upcoming page.

## Code style

- Comments and docstrings explain why, in full sentences, and name the concrete
  failure an unusual rule prevents. Do not restate the code.
- Start docstrings with a phrase rather than a sentence, matching the existing
  code.
- Prefer real examples and counts over abstractions.
- Do not use emoji in code or comments.
- Keep frontend copy in sentence case and make empty states explain why no data
  is shown.

## Merges

Use the `merge` skill when asked to commit, push, create a PR and merge without
cutting a release. It switches to a conventional branch, writes a Why/What PR,
requires its build to pass, and squash-merges it to `main`. Claude exposes the
same workflow as `/merge`; `.agents/skills/merge/SKILL.md` remains the single
source of truth.

## Releases

Use the `release` skill with a `patch`, `minor`, or `major` bump. It switches to
a conventional branch, commits the work, opens and squash-merges a PR, tags the
merge, and watches the builds. Its full procedure and credential-failure
guidance live in `.agents/skills/release/SKILL.md`.

A `v*.*.*` tag publishes the versioned Docker image and GitHub Release; a push
to `main` publishes `latest`. Both workflows must pass.
