"""
Letterboxarr
FastAPI web server for managing letterboxarr configuration and monitoring
"""
import logging
from threading import Thread, Event

import uvicorn

from lib_api import load_config

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

if __name__ == "__main__":
    # Initialize config on startup
    load_config()

    # Import after config is loaded
    from lib_api import current_config, sync_instance, app

    # Log configuration
    logger.info(f"  Radarr URL: {current_config.radarr.url}")
    logger.info(f"  Quality Profile: {current_config.radarr.quality_profile}")
    logger.info(f"  Root Folder: {current_config.radarr.root_folder}")
    logger.info(f"  Sync Interval: {current_config.sync.interval_minutes} minutes")
    logger.info(f"  Watch Lists: {len(current_config.letterboxd.watch)} configured")

    for i, watch_item in enumerate(current_config.letterboxd.watch):
        logger.info(f"    {i+1}. {watch_item.path} (tags: {watch_item.tags})")

    # Start the sync
    thread = Thread(target=sync_instance.run_continuous, args=(current_config.sync.interval_minutes,))
    thread.daemon = True
    thread.start()
    stop_event = Event()

    # Run the server
    uvicorn.run(app, host="0.0.0.0", port=7373)

    stop_event.set()
    thread.join(timeout=1)
