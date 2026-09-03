# Agent instructions

This file provides guidance to coding agents working in this repository.

## What this is

Letterboxarr scrapes Letterboxd lists and feeds the films on them to Radarr. It
is one FastAPI process (`main.py`, port 7373) that serves both the JSON API and
the built React SPA, with a background thread doing the crawling and syncing.
Deployed as a single Docker image.

## Commands

```bash
# Run the server (serves API + frontend/build at http://localhost:7373)
python main.py

# Frontend: build, then let the backend serve it
cd frontend && npm install && npm run build

# Frontend typecheck — the only static check in the repo
cd frontend && npx tsc --noEmit

# Docker
docker build -t letterboxarr .
```

**There is no test suite** — no pytest, no `*.test.tsx`, and `react-scripts
test` has nothing to run. Verify changes by exercising the real thing: run the
server, or import the module and call the function against real scraped data.
When you touch a pure function, a throwaway script comparing its output across
cases is the expected level of rigour.

`cd frontend && npm start` will serve the UI on :3000 but **its API calls will
404** — `package.json` has no `proxy` field and axios uses a relative
`baseURL: '/api'`. Build and let the backend serve it.

## Importing the backend has side effects

`lib_api.py` constructs its `LetterboxarrAPIContext` singleton **at module
import time** (`context = LetterboxarrAPIContext()` at the bottom of the class
definitions). Importing `lib_api` for any reason — including to unit-test one
pure function — loads `config.yml`, opens/migrates `./data/letterboxarr.db`,
and starts the background sync thread against the live Letterboxd and Radarr.

For a quick check of a pure helper, this is usually tolerable (the thread dies
with the process), but know that it happens and never do it against data you
care about.

## Architecture

Data flows in one direction, and every read the UI does stops at SQLite:

```
config.yml ──> lib_config     watch items (Letterboxd paths + per-list filters/tags)
                   │
                   v
              lib_letterboxd  scraper: curl_cffi impersonation + BeautifulSoup
                   │
                   v
              lib_db          SQLite — the source of truth, not a cache
                   │
        ┌──────────┴──────────┐
        v                     v
   lib_radarr            lib_api          FastAPI routes, JWT auth, serves the SPA
   (adds movies)         (reads stored data only)
```

`lib_sync.LetterboxarrSync.sync_once()` is the round, driven on the configured
interval by `LetterboxarrThread`: refresh the listings, hand new films to
Radarr, then read release tables, then read ratings. `lib_refresh.ListRefresher`
owns all the "keep the stored data fresh" logic.

### The database is the application's data, not a cache

This is the single most important idea in the codebase and it is why
`lib_db.py` has no expiry anywhere. API reads answer from SQLite; the
background refresher replaces a stored listing **only once its replacement has
been read in full**. A crawl that is slow, refused or rate-limited therefore
degrades into serving yesterday's list rather than serving nothing or, worse,
serving a half-read list as if films had left it.

Consequences worth internalising before changing scraper or refresher code:

- A partial crawl must raise, not return what it got. Returning a short list
  silently overwrites a complete one, which reads downstream as films having
  been removed — and auto-add reacts to that.
- Endpoints never crawl. Opening a page must not wait on Letterboxd. If you
  need data the UI doesn't have, the fix goes in `ListRefresher`, not the route.

### Crawl budgets

Letterboxd rate-limits and bot-blocks, so every request goes through a single
`crawl_lock` — no two crawls ever run concurrently — and the paging loops sleep
a second between pages. Listings are a page per hundred films;
release tables and ratings are a page *per film*, so they are budgeted
separately in `lib_refresh.py`:

| | max age | reads per round |
|---|---|---|
| Release tables | 12 h | 100 |
| Ratings | 30 d | 500 |

Anything left over is logged and picked up by later rounds. Raising these has a
direct wall-clock cost on every sync round — the constants carry the reasoning
in their comments.

### Scraper specifics (`lib_letterboxd.py`)

- **`curl_cffi`, not `requests`**, for browser TLS impersonation. Fingerprints
  are tried in order because Letterboxd refuses some of them on member pages
  (a 403 on page 2 while page 1 answers fine).
- **Categories overlap** (`film`, `short_film`, `documentary`, `tv_show`,
  `unreleased`) so `CATEGORY_SKIP_FILTERS` is ordered and first match wins,
  with `unreleased` first.
- **Dates are parsed against a `MONTHS` table, not `strptime`** — `%b` follows
  the process locale, and a base image that set one would silently stop reading
  every date on the page.
- **Watch items accept a path or a whole URL.** A privately shared list is only
  reachable through its secret `boxd.it` link; its ordinary
  `/<member>/list/<slug>/` URL 404s for everyone but the owner.
- Posters must be read from the main column, not the whole document — a cloned
  list shows its source's posters in the sidebar on every page.

## Configuration

`config.yml` (gitignored; see `examples/config.example.yml`) is the only live
configuration path — edited through the UI as well as by hand. Two traps:

- **`.env` in the repo root is not read by the application.** Nothing imports
  `python-dotenv`, and `lib_config.load_config_from_env()` — which reads
  `RADARR_*`, `LETTERBOXD_USERNAME`, `SYNC_INTERVAL_MINUTES` — **has no call
  sites and is dead legacy code**. Those variables are for docker-compose and
  shell use only. Changing them changes nothing about a running app.
- The env vars that *are* live are read by `lib_api.py` at import:
  `SECRET_KEY`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`. All three have insecure
  defaults.

`letterboxd.country` matters more than it looks: it is spelled the way
Letterboxd spells it in a film's releases table (`USA`, `UK`, `France`,
`Czechia`), and it drives the whole Upcoming tab.

## Code style

The prose in this codebase is load-bearing and quite specific — match it rather
than defaulting to house style.

- **Comments and docstrings say *why*, in full sentences**, and name the
  concrete failure they prevent ("a 403 on page two of a 264-film list cut it
  to a hundred"). They do not restate what the code does. A rule with a
  non-obvious edge gets a paragraph explaining the edge, not a bullet list.
- **Docstring first line is a phrase, not a sentence** — "The release a film is
  dated by, None when it has none still to come".
- Real examples over abstractions: an actual film, an actual count.
- No emoji in code or comments. Frontend copy is sentence case and explains
  itself to the user (see the empty states in `UpcomingPage.tsx`, which
  distinguish four reasons a page can be empty).

## Releases

Use the `release` skill with a `patch`, `minor` or `major` bump. It runs commit
→ push → annotated tag and watches the builds. See
`.agents/skills/release/SKILL.md` for the conventions and known credential
failures.

Pushing a `v*.*.*` tag publishes to Docker Hub and cuts a GitHub Release; a
push to `main` moves `latest`. **Both** runs must pass — the Docker Hub login
is step 5 of 8, so a lapsed credential leaves a tag with no image behind it.
