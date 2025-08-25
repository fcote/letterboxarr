# Letterboxarr : Letterboxd to Radarr Sync

Automatically sync your Letterboxd watchlist to your Radarr instance. This script periodically checks your Letterboxd watchlist and adds any new movies to Radarr.

## Features

- 🎬 Scrapes Letterboxd watchlist (no API key needed)
- 🔄 Automatic periodic synchronization
- 📝 Tracks processed movies to avoid duplicates
- 🐳 Docker support for easy deployment
- 🔍 Smart movie matching using title and year
- ⚡ Configurable sync interval

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

## Deployment Options

### Option 1: Docker Compose (Recommended)

1. Create a docker-compose.yml file with the following content:

```yaml
---
services:
  letterboxarr:
    image: fcote/letterboxarr:latest
    container_name: letterboxarr
    restart: unless-stopped
    environment:
      - RADARR_API_KEY=your_radarr_api_key_here
      - LETTERBOXD_USERNAME=your_letterboxd_username_here
      - RADARR_URL=http://radarr:7878             # Change to your Radarr URL
      - RADARR_QUALITY_PROFILE=1                  # Change to your preferred quality profile ID
      - RADARR_ROOT_FOLDER=/movies                # Change to your movies folder path
      - RADARR_MONITOR_ADDED_MOVIES=true          # Monitor added movies
      - RADARR_START_SEARCHING_ADDED_MOVIES=true  # Start searching for added movies
      - SYNC_INTERVAL_MINUTES=60                  # How often to check for new movies

    volumes:
      - ./data:/app/data  # Persistent storage for tracking processed movies
```

2. Build and run:
```bash
docker-compose up -d
```

3. Check logs:
```bash
docker-compose logs -f
```

### Option 2: Docker Run

```bash
docker build -t letterboxarr .

docker run -d \
  --name letterboxarr \
  --restart unless-stopped \
  -e RADARR_API_KEY=your_api_key \
  -e LETTERBOXD_USERNAME=your_letterboxd_username \
  -e RADARR_URL=http://192.168.1.100:7878 \
  -e RADARR_QUALITY_PROFILE=4 \
  -e RADARR_ROOT_FOLDER=/movies \
  -e RADARR_MONITOR_ADDED_MOVIES=true \
  -e RADARR_START_SEARCHING_ADDED_MOVIES=true \
  -e SYNC_INTERVAL_MINUTES=60 \
  -v $(pwd)/data:/app/data \
  letterboxarr
```

### Option 3: Local Python

1. Install dependencies:
```bash
pip install -r requirements.txt
```

2. Set environment variables:
```bash
export RADARR_API_KEY=your_api_key
export LETTERBOXD_USERNAME=your_letterboxd_username
export RADARR_URL=http://localhost:7878
export RADARR_QUALITY_PROFILE=4
export RADARR_ROOT_FOLDER=/movies
export RADARR_MONITOR_ADDED_MOVIES=true
export RADARR_START_SEARCHING_ADDED_MOVIES=true
export SYNC_INTERVAL_MINUTES=60
```

3. Run the script:
```bash
python main.py
```

## Configuration

| Environment Variable                  | Required | Default | Description                      |
|---------------------------------------|----------|---------|----------------------------------|
| `RADARR_API_KEY`                      | Yes      | -       | Your Radarr API key              |
| `LETTERBOXD_USERNAME`                 | Yes      | -       | Letterboxd username to sync      |
| `RADARR_URL`                          | Yes      | -       | URL to your Radarr instance      |
| `RADARR_QUALITY_PROFILE`              | Yes      | -       | Quality profile ID to use        |
| `RADARR_ROOT_FOLDER`                  | Yes      | -       | Root folder path for movies      |
| `RADARR_MONITOR_ADDED_MOVIES`         | No       | true    | Monitor added movies             |
| `RADARR_START_SEARCHING_ADDED_MOVIES` | No       | true    | Start searching for added movies |
| `SYNC_INTERVAL_MINUTES`               | No       | 60      | Minutes between sync operations  |

## Network Configuration

### If Radarr is on the same machine:
- Use `http://localhost:7878` or `http://host.docker.internal:7878` (for Docker on Mac/Windows)

### If Radarr is in the same Docker network:
- Use the container name, e.g., `http://radarr:7878`

### If Radarr is on another machine:
- Use the machine's IP address, e.g., `http://192.168.1.100:7878`

## Data Persistence

The script maintains a `processed_movies.json` file to track which movies have been processed. This prevents duplicate additions and unnecessary API calls. This file is stored in the `/app/data` directory in the container (mapped to `./data` on the host).

## Contributing

Feel free to submit issues or pull requests for improvements!

## License

MIT License

## Disclaimer

This tool is not affiliated with Letterboxd or Radarr. Use responsibly and respect the terms of service of both platforms.