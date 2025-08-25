#!/usr/bin/env python3
"""
Letterboxd to Radarr Watchlist Sync
Monitors Letterboxd lists and imports movies to Radarr
"""

import os
import sys
import logging
from pathlib import Path

from lib_sync import LetterboxdRadarrSync
from lib_config import ConfigLoader, Config, SyncConfig, RadarrConfig, LetterboxdConfig, LetterboxdFilters, WatchListItem

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def load_config_from_env():
    """Load configuration from environment variables (legacy support)"""
    logger.info("Loading configuration from environment variables (legacy mode)")
    
    # Required environment variables
    radarr_api_key = os.getenv('RADARR_API_KEY')
    radarr_url = os.getenv('RADARR_URL')
    quality_profile = os.getenv('RADARR_QUALITY_PROFILE')
    letterboxd_user = os.getenv('LETTERBOXD_USERNAME')
    
    # Check required variables
    missing_vars = []
    if not radarr_api_key:
        missing_vars.append('RADARR_API_KEY')
    if not radarr_url:
        missing_vars.append('RADARR_URL')
    if not quality_profile:
        missing_vars.append('RADARR_QUALITY_PROFILE')
    if not letterboxd_user:
        missing_vars.append('LETTERBOXD_USERNAME')
    
    if missing_vars:
        logger.error("Missing required environment variables:")
        for var in missing_vars:
            logger.error(f"  - {var}")
        sys.exit(1)
    
    # Create config from environment variables
    sync_config = SyncConfig(
        interval_minutes=int(os.getenv('SYNC_INTERVAL_MINUTES', '60'))
    )
    
    radarr_config = RadarrConfig(
        url=radarr_url,
        api_key=radarr_api_key,
        quality_profile=int(quality_profile),
        root_folder=os.getenv('RADARR_ROOT_FOLDER', '/movies'),
        monitor_added=os.getenv('RADARR_MONITOR_ADDED_MOVIES', 'true').lower() == 'true',
        search_added=os.getenv('RADARR_START_SEARCHING_ADDED_MOVIES', 'true').lower() == 'true'
    )
    
    letterboxd_filters = LetterboxdFilters(
        skip_documentaries=False,
        skip_short_films=False,
        skip_unreleased=False,
        skip_tv_shows=True
    )
    
    # Create simple watchlist from username
    watch_items = [WatchListItem(path=f"{letterboxd_user}/watchlist")]
    
    letterboxd_config = LetterboxdConfig(
        filters=letterboxd_filters,
        watch=watch_items
    )
    
    return Config(
        sync=sync_config,
        radarr=radarr_config,
        letterboxd=letterboxd_config
    )


def main():
    """Main entry point"""
    config_path = "config.yml"
    
    # Try to load from the config file first, then fall back to environment variables
    if Path(config_path).exists():
        try:
            # Load configuration from YAML file
            config = ConfigLoader.load_config(config_path)
            
            # Validate configuration
            validation_errors = ConfigLoader.validate_config(config)
            if validation_errors:
                logger.error("Configuration validation failed:")
                for error in validation_errors:
                    logger.error(f"  - {error}")
                sys.exit(1)
            
            logger.info("Configuration loaded from config.yml")

        except Exception as e:
            logger.error(f"Error loading configuration file: {e}")
            sys.exit(1)
    else:
        # Fall back to environment variables
        logger.warning(f"Configuration file {config_path} not found, trying environment variables...")
        try:
            config = load_config_from_env()
        except Exception as e:
            logger.error(f"Error loading configuration from environment: {e}")
            logger.error("Please create a config.yml file or set the required environment variables")
            sys.exit(1)

    # Create sync instance
    sync = LetterboxdRadarrSync(logger=logger, config=config)

    # Log configuration
    logger.info("Configuration loaded successfully:")
    logger.info(f"  Radarr URL: {config.radarr.url}")
    logger.info(f"  Quality Profile: {config.radarr.quality_profile}")
    logger.info(f"  Root Folder: {config.radarr.root_folder}")
    logger.info(f"  Sync Interval: {config.sync.interval_minutes} minutes")
    logger.info(f"  Watch Lists: {len(config.letterboxd.watch)} configured")
    
    for i, watch_item in enumerate(config.letterboxd.watch):
        logger.info(f"    {i+1}. {watch_item.path} (tags: {watch_item.tags})")

    # Run continuous sync
    sync.run_continuous(config.sync.interval_minutes)


if __name__ == "__main__":
    main()