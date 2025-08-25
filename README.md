# Letterboxarr : Letterboxd to Radarr Sync

Automatically sync your Letterboxd lists to your Radarr instance. This script periodically checks your configured Letterboxd lists and adds any new movies to Radarr.

## Features

- 🎬 Scrapes multiple Letterboxd lists (watchlists, collections, actors, directors, etc.)
- 🏷️ Automatic tag assignment to movies based on their source list
- 🔄 Automatic periodic synchronization
- 📝 Tracks processed movies to avoid duplicates
- 🐳 Docker support for easy deployment
- 🔍 Smart movie matching using title and year, falling back to TMDB ID
- ⚡ Configurable sync interval and filters
- 🎭 Per-list filtering (skip documentaries, short films, etc.)
- ⚙️ YAML configuration file support

## Prerequisites

- A running Radarr instance
- Radarr API key
- Docker and Docker Compose (for containerized deployment)
- Python 3.11+ (for local deployment)

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

### 4. Create Configuration File

Copy the example configuration:
```bash
cp config.example.yml config.yml
```

Edit `config.yml` with your settings:
```yaml
sync:
  schedule:
    interval_minutes: 60

radarr:
  url: http://radarr:7878
  api_key: your-api-key-here
  quality_profile: 1
  root_folder: /movies
  monitor_added: true
  search_added: true

letterboxd:
  filters:
    skip_documentaries: false
    skip_short_films: false
    skip_unreleased: false
    skip_tv_shows: true
  watch:
    - username/watchlist:
        tags:
          - watchlist
    - films/popular
    - actor/daniel-day-lewis
```

## Deployment Options

### Option 1: Docker Compose (Recommended)

1. Create your `config.yml` file (see setup section above)

2. Create a docker-compose.yml file:

```yaml
---
services:
  letterboxarr:
    image: fcote/letterboxarr:latest
    container_name: letterboxarr
    restart: unless-stopped
    volumes:
      - ./config.yml:/app/config.yml  # Configuration file
      - ./data:/app/data              # Persistent storage for tracking processed movies
```

3. Build and run:
```bash
docker-compose up -d
```

### Option 2: Docker Run

```bash
docker build -t letterboxarr .

docker run -d \
  --name letterboxarr \
  --restart unless-stopped \
  -v $(pwd)/config.yml:/app/config.yml \
  -v $(pwd)/data:/app/data \
  letterboxarr
```

### Option 3: Local Python

#### With Configuration File (Recommended)

1. Install dependencies:
```bash
pip install -r requirements.txt
```

2. Create your `config.yml` file (see setup section above)

3. Run the script:
```bash
python main.py
```

## Configuration Reference

### YAML Configuration (config.yml)

```yaml
sync:
  schedule:
    interval_minutes: 60          # How often to check for new movies

radarr:
  url: http://radarr:7878         # Radarr instance URL
  api_key: your-api-key           # Your Radarr API key (required)
  quality_profile: 1              # Quality profile ID to use
  root_folder: /movies            # Root folder path for movies
  monitor_added: true             # Monitor newly added movies
  search_added: true              # Start searching for newly added movies

letterboxd:
  filters:                        # Global filters (can be overridden per-list)
    skip_documentaries: false     # Skip documentary films
    skip_short_films: false       # Skip short films
    skip_unreleased: false        # Skip unreleased films
    skip_tv_shows: true           # Skip TV shows/series
  
  watch:                          # List of Letterboxd pages to monitor
    - username/watchlist          # Simple watchlist
    - username/watchlist:         # Watchlist with custom settings
        filters:
          skip_documentaries: true
        tags:
          - watchlist
    - films/popular               # Popular films
    - actor/daniel-day-lewis      # Actor filmography
    - director/david-fincher      # Director filmography
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

## Data Persistence

The script maintains a `processed_movies.json` file to track which movies have been processed. This prevents duplicate additions and unnecessary API calls. This file is stored in the `/app/data` directory in the container (mapped to `./data` on the host).

## Contributing

Feel free to submit issues or pull requests for improvements!

## License

MIT License

## Disclaimer

This tool is not affiliated with Letterboxd or Radarr. Use responsibly and respect the terms of service of both platforms.