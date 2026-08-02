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

### Authentication

The web interface is protected by authentication. Default credentials:
- Username: `admin` (configurable via `ADMIN_USERNAME` environment variable)
- Password: `admin` (configurable via `ADMIN_PASSWORD` environment variable)

**Important**: Change these credentials in production by setting the environment variables.

## Data Persistence

Everything is kept in a single SQLite database, `letterboxarr.db`, in the `/app/data` directory in the container (mapped to `./data` on the host):

- **Added movies** — the movies already handed to Radarr, so they are not added twice and failed lookups are not retried on every sync.
- **Watched films** — the films marked as watched on the configured Letterboxd profile. Refreshed on the sync interval, but only topped up: `/films/by/date/` lists films newest-logged first, so the refresh reads pages until one holds nothing new and stops, which is a single page when nothing has been watched since the last check. Adding films is all a top-up can do, so the profile is also re-read in full once a day to pick up anything no longer watched.
- **Crawled listings** — each list, with the filters it was read with. Resolving categories reads a list several times, so a single watch item is five listings.

Nothing in the database expires. Reads always answer from it, however old it is, and a listing is only ever replaced once a newer read of the same listing has come back in full — so a refused page, a rate limit or a Letterboxd outage costs you a refresh, not your lists. Keeping it current is the background round's job: every `interval_minutes` it reads the watch lists from Letterboxd and then hands what they hold to Radarr, in that order, so a film added to a list reaches Radarr in the same round. The per-list refresh button does the reading half on demand for a single list.

The previous storage is imported on first start: the entries in `processed_movies.json` are copied into the database and the file is renamed to `processed_movies.json.migrated`, and the `data/cache` directory of per-crawl JSON files is removed. Nothing needs to be done by hand; downgrading is still possible by renaming the file back. Databases written before the listings stopped being a cache keep their added movies and watched films, and read their lists again on the first refresh.

## Contributing

Feel free to submit issues or pull requests for improvements!

## License

MIT License

## Disclaimer

This tool is not affiliated with Letterboxd or Radarr. Use responsibly and respect the terms of service of both platforms.