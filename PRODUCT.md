# Letterboxarr product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The documented setup requires someone operating a Radarr instance with access
to its API key and Docker Compose or a local Python environment. The interface
provides authenticated configuration and monitoring.

Open decision: confirm the primary audience and the relative importance of
hands-off automation versus film discovery and collection browsing.

## Product Purpose

Automatically sync configured Letterboxd lists to Radarr. Users configure their
sources and filters, then monitor background synchronization and inspect films
without manually transferring every title.

## Operating Context

- Letterboxarr ships as one Docker image. FastAPI serves the React application
  and API on port 7373.
- Users connect an existing Radarr instance, choose its quality profile and
  root folder, and configure Letterboxd watch items.
- Overview shows synchronization status, recent additions, and watch lists.
  Watch lists manages sources, tags, and automatic additions. Each list links
  to its films. Upcoming shows release information; Settings controls the
  integrations, synchronization, and filters.
- A public Letterboxd profile supplies watched status. A preferred country
  determines which upcoming release dates are relevant.
- Configuration can be changed through the UI or by editing `config.yml`.

## Capabilities and Constraints

- Sources include watchlists, collections, custom lists, people pages, and
  other supported Letterboxd paths. Preserve full privately shared `boxd.it`
  URLs. Friends-only lists cannot be read without a signed-in session.
- Global and per-list filters cover documentaries, short films, TV shows, and
  unreleased titles. Sources can supply Radarr tags.
- Film information includes ratings, watched status, categories, and additions
  to Radarr. Rating, weighted-rating, and popularity sorting are supported.
- SQLite is persistent application data. A refused or partial crawl must not
  replace a complete stored list or appear to be an empty list.
- API reads use stored data; background synchronization owns freshness.
  Manual per-list refreshes are supported. All Letterboxd crawls are serialized.
- Release and rating reads have separate budgets, so large lists can take
  multiple rounds to fill in. Preserve the limits documented in `AGENTS.md`.
- Upcoming excludes festival and physical releases. When the preferred country
  has no announced date, the earliest release elsewhere is shown with its
  country. Films already released in the preferred country are omitted.
- Letterboxarr adds films to Radarr; an addition does not establish that a film
  has been downloaded or is available to watch.

## Brand Commitments

The existing product name is Letterboxarr. Repository instructions require
sentence-case UI copy and empty states that explain why no data is shown.
Keep the distinction between Letterboxd sources and Radarr additions clear.
The README states that Letterboxarr is not affiliated with either service.

## Evidence on Hand

- `README.md` documents the product, supported workflows, and deployment.
- `examples/config.example.yml` supplies the configuration reference.
- `frontend/public/assets/logo.svg` and accompanying PNG assets contain the
  existing logo.
- `screenshots/` contains existing interface captures using sample data;
  these are not evidence of real customer activity.
- `AGENTS.md` records implementation invariants and required checks.

## Product Principles

These principles follow the documented behavior and repository constraints:

1. Preserve complete stored data when external services fail.
2. Make source configuration and synchronization outcomes understandable.
3. Respect user filters, source-specific settings, and country preferences.
4. Make delayed, unavailable, and empty data distinguishable.

## Open Decisions

Additional audience priorities, essential device contexts, and product-specific
accessibility requirements have not been confirmed. Existing responsive
navigation, keyboard focus treatment, skip link, and reduced-motion support
are implementation evidence to preserve during scoped refinements, not a claim
of audited accessibility compliance.
