#!/usr/bin/env python3
"""
Letterboxd to Radarr Watchlist Sync
Monitors a Letterboxd watchlist and imports movies to Radarr
"""

import os
import logging

from lib_sync import LetterboxdRadarrSync

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def main():
    """Main entry point"""
    # Get configuration from environment variables
    letterboxd_user = os.getenv('LETTERBOXD_USERNAME')
    radarr_url = os.getenv('RADARR_URL')
    radarr_api_key = os.getenv('RADARR_API_KEY')
    quality_profile = int(os.getenv('RADARR_QUALITY_PROFILE'))
    root_folder = os.getenv('RADARR_ROOT_FOLDER')
    monitor_movies = os.getenv('RADARR_MONITOR_ADDED_MOVIES', 'true').lower() == 'true'
    search_movies = os.getenv('RADARR_START_SEARCHING_ADDED_MOVIES', 'true').lower() == 'true'
    sync_interval = int(os.getenv('SYNC_INTERVAL_MINUTES', '60'))

    if not radarr_api_key:
        logger.error("RADARR_API_KEY environment variable is required")
        exit(1)

    if not letterboxd_user:
        logger.error("LETTERBOXD_USERNAME environment variable is required")
        exit(1)

    if not radarr_url:
        logger.error("RADARR_URL environment variable is required")
        exit(1)

    if not quality_profile:
        logger.error("RADARR_QUALITY_PROFILE environment variable is required")
        exit(1)

    # Create sync instance
    sync = LetterboxdRadarrSync(
        logger=logger,
        letterboxd_username=letterboxd_user,
        radarr_url=radarr_url,
        radarr_api_key=radarr_api_key,
        quality_profile=quality_profile,
        root_folder=root_folder,
        monitor_movies=monitor_movies,
        search_movies=search_movies
    )

    # Log configuration
    logger.info("Configuration:")
    logger.info(f"  Letterboxd User: {letterboxd_user}")
    logger.info(f"  Radarr URL: {radarr_url}")
    logger.info(f"  Quality Profile: {quality_profile}")
    logger.info(f"  Root Folder: {root_folder}")
    logger.info(f"  Sync Interval: {sync_interval} minutes")

    # Run continuous sync
    sync.run_continuous(sync_interval)


if __name__ == "__main__":
    main()