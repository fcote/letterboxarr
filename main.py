#!/usr/bin/env python3
"""
Letterboxd to Radarr Watchlist Sync
Monitors Letterboxd lists and imports movies to Radarr
"""

import sys
import logging
from pathlib import Path

from lib_sync import LetterboxdRadarrSync
from lib_config import ConfigLoader, load_config_from_env

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


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
            config = load_config_from_env(logger)
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