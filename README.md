<div align="center">

<img src="frontend/public/assets/logo.svg" alt="Letterboxarr Logo" width="100">

# Letterboxarr

</div>

Automatically sync your Letterboxd lists to your Radarr instance. This script periodically checks your configured Letterboxd lists and adds any new movies to Radarr.

![Letterboxarr Preview](screenshots/dashboard.png)

## Features

- 🎬 Scrapes multiple Letterboxd lists (watchlists, collections, actors, directors, etc.)
- 🏷️ Automatic tag assignment to movies based on their source list
- 🔄 Automatic periodic synchronization
- 📝 Keeps added movies, watched films and the lists themselves in a SQLite database
- 🌙 Reads your lists from Letterboxd in the background, so the interface never waits on a crawl
- 🐳 Docker support for easy deployment
- 🔍 Smart movie matching using title and year, falling back to TMDB ID
- ⚡ Configurable sync interval and filters
- 🎭 Per-list filtering (skip documentaries, short films, etc.)
- 🗂️ Movies view split into films, short films, documentaries and TV shows
- 📅 Upcoming tab listing what your lists are still waiting on, by release date in your country
- 👁️ Flags the films you have already watched on your Letterboxd profile
- 📊 Per-category watched progress on each watch item
- 🔄 Per-list refresh button to re-read a list from Letterboxd ahead of its next scheduled refresh
- ⚙️ YAML configuration file support
- 🌐 Web interface for configuration and monitoring

## Prerequisites

- A running Radarr instance
- Radarr API key
- Docker and Docker Compose (for containerized deployment)
- Python 3.11+ (for local deployment)
- Node.js 18+ (for frontend development)

## Setup

### 1. Get your Radarr API Key

1. Open Radarr web interface
2. Go to Settings → General → Security
3. Copy your API Key

### 2. Find your Quality Profile ID

Run this command to list available quality profiles:
```bash
curl -H "X-Api-Key: YOUR_API_KEY" http://your-radarr-url:7878/api/v3/qualityprofile
```

Note the `id` of your preferred quality profile.

### 3. Find your Root Folder Path

Run this command to list available root folders:
```bash
curl -H "X-Api-Key: YOUR_API_KEY" http://your-radarr-url:7878/api/v3/rootfolder
```

Note the `path` of your movies folder.

### 4. Create the configuration file

Copy the [example configuration file](examples/config.example.yml) to `config.yml` and customize it with your Radarr URL, API key, quality profile, root folder, and Letterboxd lists.

## Deployment Options

### Option 1: Docker Compose (Recommended)

Create a docker-compose.yml file:

```yaml
---
services:
  letterboxarr:
    image: fcote/letterboxarr:latest
    container_name: letterboxarr
    restart: unless-stopped
    ports:
      - "7373:7373"  # Web interface
    volumes:
      - ./config.yml:/app/config.yml  # Configuration file
      - ./data:/app/data              # SQLite database: added movies, watched films, crawled lists
    environment:
      - SECRET_KEY=${SECRET_KEY:-your-secret-key-change-this-in-production}
      - ADMIN_USERNAME=${ADMIN_USERNAME:-admin}
      - ADMIN_PASSWORD=${ADMIN_PASSWORD:-admin}
```

Build and run:
```bash
docker-compose up -d
```

Access the web interface at `http://localhost:7373`

### Option 2: Docker Run

```bash
docker build -t letterboxarr .

docker run -d \
  --name letterboxarr \
  --restart unless-stopped \
  -p 7373:7373 \
  -v $(pwd)/config.yml:/app/config.yml \
  -v $(pwd)/data:/app/data \
  -e SECRET_KEY=your-secret-key-change-this \
  -e ADMIN_USERNAME=admin \
  -e ADMIN_PASSWORD=admin \
  letterboxarr
```

Then access the web interface at `http://localhost:7373`

### Option 3: Local Development

Install Python dependencies:
```bash
cd frontend && npm install && npm run build
pip install -r requirements.txt
```

Run the web server:
```bash
python main.py
```

### Supported Letterboxd List Types

- **User Lists**: `username/watchlist`, `username/films`, `username/diary`
- **Collections**: `films/in/collection-name`
- **Popular/Charts**: `films/popular`, `films/popular/this/year`
- **People**: `actor/name`, `director/name`, `writer/name`
- **Genres**: `films/genre/horror`, `films/genre/sci-fi`
- **Custom Lists**: Any valid Letterboxd URL path

### Tags and Filtering

Movies from each list can be automatically tagged in Radarr. Filters can be applied globally or per-list to skip certain types of content.

### Upcoming Releases

The **Upcoming** tab lists the films your watch lists are still waiting on, soonest first, with a button to hand one to Radarr ahead of time so it is monitored and grabbed the day it lands.

Each row opens with what kind of entry it is — the same film strip, clock, video camera and screen the movies page counts films, short films, documentaries and TV shows under — and carries a chip per watch list the film came from, marked by the kind of list it is. Letterboxd names its own listings after what gathers them, so a chip for `director/denis-villeneuve` reads "Denis Villeneuve" rather than a row of lists all reading "Films directed b…". Hovering either the icon or the chips gives the full names, the date and how far off it is, the release and its country, and the tags. Note that a category your filters skip never reaches these lists at all, so filtering out documentaries means no row can ever be marked as one.

Festival premieres and physical releases are left out: neither says anything about when a film can actually be watched, and dating a film by a red carpet nobody can attend or by a disc pressed months after it has been streaming would put a date on the page that is no use. A film left with nothing but one of those counts as having nothing ahead.

Set `letterboxd.country` — on the configuration page or in `config.yml` — to be told when a film comes out where you are. Each film is dated by its soonest release still to come in that country. A film with **no** date announced there at all is dated by the soonest release anywhere instead, and the row says which country that was rather than pretending the date is local; a film whose dates there have all passed is out where you are, so it drops off the page rather than being dated by a release on the other side of the world.

Only dates still ahead are considered, so a film that has already opened stays on the page for its digital or later local release rather than disappearing the day it premiered somewhere. Films with nothing ahead are counted on the page rather than listed.

Only films from the current year onwards are considered. Finding them costs one or two pages per list rather than all of them: each list is read again sorted by release date, newest first, and the crawl stops as soon as it is past the current year. Each of those films then has its release table read from its own Letterboxd page, at most 100 per round and no more often than twice a day, so a long watch list fills in over a few rounds rather than in one long crawl. A film first released in an earlier year is not looked at, so a late local or home-media date for one of those will not appear.

### Authentication

The web interface is protected by authentication. Default credentials:
- Username: `admin` (configurable via `ADMIN_USERNAME` environment variable)
- Password: `admin` (configurable via `ADMIN_PASSWORD` environment variable)

**Important**: Change these credentials in production by setting the environment variables.

## Data Persistence

Everything is kept in a single SQLite database, `letterboxarr.db`, in the `/app/data` directory in the container (mapped to `./data` on the host):

- **Added movies** — the movies already handed to Radarr, so they are not added twice and failed lookups are not retried on every sync.
- **Watched films** — the films marked as watched on the configured Letterboxd profile. Refreshed on the sync interval, but only topped up: `/films/by/date/` lists films newest-logged first, so the refresh reads pages until one holds nothing new and stops, which is a single page when nothing has been watched since the last check. Adding films is all a top-up can do, so the profile is also re-read in full once a day to pick up anything no longer watched.
- **Crawled listings** — each list, with the filters it was read with and the order it was read in. Resolving categories reads a list several times, and the Upcoming tab reads the head of it once more sorted by release date, so a single watch item is six listings.
- **Release dates** — every date announced for the recent films your lists hold, one row per country and release type, alongside when each film's page was last read. A film read and found to have no date announced is remembered as such, so it is not read again on the next round.

Nothing in the database expires. Reads always answer from it, however old it is, and a listing is only ever replaced once a newer read of the same listing has come back in full — so a refused page, a rate limit or a Letterboxd outage costs you a refresh, not your lists. Keeping it current is the background round's job: every `interval_minutes` it reads the watch lists from Letterboxd and then hands what they hold to Radarr, in that order, so a film added to a list reaches Radarr in the same round. The per-list refresh button does the reading half on demand for a single list.

The previous storage is imported on first start: the entries in `processed_movies.json` are copied into the database and the file is renamed to `processed_movies.json.migrated`, and the `data/cache` directory of per-crawl JSON files is removed. Nothing needs to be done by hand; downgrading is still possible by renaming the file back. Databases written before the listings stopped being a cache keep their added movies and watched films, and read their lists again on the first refresh.

## Contributing

Feel free to submit issues or pull requests for improvements!

## License

MIT License

## Disclaimer

This tool is not affiliated with Letterboxd or Radarr. Use responsibly and respect the terms of service of both platforms.