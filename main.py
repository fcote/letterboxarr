"""
Letterboxarr
FastAPI web server for managing letterboxarr configuration and monitoring
"""
import logging

import uvicorn

from lib_api import context

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

if __name__ == "__main__":
    # Log configuration
    logger.info(f"  Radarr URL: {context.current_config.radarr.url}")
    logger.info(f"  Quality Profile: {context.current_config.radarr.quality_profile}")
    logger.info(f"  Root Folder: {context.current_config.radarr.root_folder}")
    logger.info(f"  Sync Interval: {context.current_config.sync.interval_minutes} minutes")
    logger.info(f"  Watch Lists: {len(context.current_config.letterboxd.watch)} configured")

    for i, watch_item in enumerate(context.current_config.letterboxd.watch):
        logger.info(f"    {i+1}. {watch_item.path} (tags: {watch_item.tags})")

    # Run the server
    uvicorn.run(context.app, host="0.0.0.0", port=7373)
