<div align="center">

<img src="frontend/public/assets/logo.svg" alt="Letterboxarr logo" width="100">

# Letterboxarr

Automatically sync Letterboxd lists to Radarr.

</div>

Letterboxarr periodically reads configured Letterboxd lists, adds new films to
Radarr, and serves a web interface for configuration and monitoring.

![Letterboxarr dashboard](screenshots/dashboard.png)

## Features

- Multiple Letterboxd watchlists, collections, custom lists, and people pages
- Global and per-list filters for documentaries, short films, TV shows, and
  unreleased titles
- Automatic Radarr tags based on the source list
- Configurable quality profile, root folder, monitoring, and search behavior
- Background synchronization with per-list manual refreshes
- Film categories, watched status, and progress for each watch item
- Upcoming releases for a preferred country
- Letterboxd rating, weighted-rating, and popularity sorting
- Persistent SQLite storage
- Authenticated web interface

## Quick start with Docker Compose

You need a running Radarr instance, its API key, and Docker with Compose.

1. Copy the example files:

   ```bash
   cp examples/config.example.yml config.yml
   cp examples/docker-compose.yml docker-compose.yml
   ```

2. Edit `config.yml` with your Radarr connection and Letterboxd watch items.

3. Set secure web credentials in a `.env` file used by Docker Compose:

   ```dotenv
   SECRET_KEY=replace-with-a-long-random-value
   ADMIN_USERNAME=admin
   ADMIN_PASSWORD=replace-with-a-strong-password
   ```

4. Start Letterboxarr:

   ```bash
   docker compose up -d
   ```

Open [http://localhost:7373](http://localhost:7373). Application data is stored
in `./data`, and the web interface can update the mounted `config.yml`.

> [!IMPORTANT]
> Without environment overrides, the login is `admin` / `admin` and the JWT
> secret is insecure. Change all three values before exposing the service.

## Configuration

The complete configuration template is in
[`examples/config.example.yml`](examples/config.example.yml).

### Radarr

Letterboxarr needs the Radarr URL, API key, quality-profile ID, and root-folder
path. Find the API key under **Settings → General → Security** in Radarr.

List available quality profiles:

```bash
curl -H "X-Api-Key: YOUR_API_KEY" \
  http://your-radarr-url:7878/api/v3/qualityprofile
```

List available root folders:

```bash
curl -H "X-Api-Key: YOUR_API_KEY" \
  http://your-radarr-url:7878/api/v3/rootfolder
```

Use the desired profile's `id` and root folder's `path` in `config.yml`.

### Letterboxd watch items

A watch item is normally the path after `letterboxd.com`, for example:

- `username/watchlist`
- `username/films`
- `films/in/collection-name`
- `films/popular/this/year`
- `actor/name`, `director/name`, or `writer/name`
- `films/genre/horror`

Other valid Letterboxd paths are accepted. Full URLs are accepted too. For a
private list shared “with anyone,” use the secret `https://boxd.it/...` URL from
its share menu; the ordinary list URL returns 404 to everyone except its owner.
Lists shared only with friends require a signed-in Letterboxd session and cannot
be read by Letterboxarr.

Each watch item can override the global filters and define Radarr tags. Invalid,
private, or refused paths are reported as unavailable rather than mistaken for
empty lists.

Set `letterboxd.username` to flag films already watched on a public Letterboxd
profile. Set `letterboxd.country` using Letterboxd's spelling, such as `USA`,
`UK`, `France`, or `Czechia`, to localize the Upcoming page.

## Upcoming releases

The Upcoming page shows future watchable releases for recent films in the
configured watch items. Festival premieres and physical releases are excluded
because they do not indicate when a film becomes generally available.

With a preferred country configured, Letterboxarr uses that country's next
release. If the country has no announced date, it falls back to the earliest
release elsewhere and labels the country used. A film already released in the
preferred country is no longer shown.

Release pages are comparatively expensive to crawl. Letterboxarr reads at most
100 per sync round and refreshes them no more than twice a day, so a new large
list may take several rounds to fill in.

## Local development

Local development requires Python 3.9+ and Node.js 22+.

```bash
cd frontend
npm install
npm run lint
npm run build
cd ..

python -m pip install -r requirements.txt
python -m pip install -r requirements-lint.txt
ruff check .
bandit -c pyproject.toml -r .
python main.py
```

Open [http://localhost:7373](http://localhost:7373). The standalone React
development server does not proxy `/api`; build the frontend and let FastAPI
serve it.

## Data persistence

`data/letterboxarr.db` stores:

- Films already handed to Radarr, preventing duplicate additions
- Watched films from the configured Letterboxd profile
- Complete Letterboxd listings and their filters
- Release dates and ratings
- Sync history

SQLite is the application's source of truth. Reads continue to use the last
complete listing during a refused request, rate limit, or Letterboxd outage; a
partial crawl never replaces stored data.

On first start after upgrading from legacy storage, Letterboxarr imports
`data/processed_movies.json`, renames it to `processed_movies.json.migrated`,
and removes superseded per-crawl cache files automatically.

## Contributing

Issues and pull requests are welcome.

## License

MIT

## Disclaimer

Letterboxarr is not affiliated with Letterboxd or Radarr. Use it responsibly and
respect both services' terms of use.
