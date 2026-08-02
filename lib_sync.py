import time
from threading import Lock, Thread, Event
from typing import Dict, List, Optional, Tuple

from lib_db import Database, get_database
from lib_letterboxd import LetterboxdScraper
from lib_radarr import RadarrAPI, MultipleMatchesError
from lib_config import Config


def movie_key(movie: Dict) -> str:
    """The id a movie is recorded under once added to Radarr"""
    return f"{movie['title']}_{movie.get('year', 'unknown')}"


class LetterboxarrSync:
    """Main sync orchestrator"""

    def __init__(self, logger, config: Config, db: Optional[Database] = None):
        self.logger = logger
        self.config = config
        self.db = db or get_database(logger)
        self.letterboxd = LetterboxdScraper(logger, self.db)
        self.radarr = RadarrAPI(
            logger,
            config.radarr.url,
            config.radarr.api_key,
            config.radarr.quality_profile,
            config.radarr.root_folder,
            config.radarr.monitor_added,
            config.radarr.search_added
        )
        # The timer thread and the API both start syncs; two at once would hand
        # Radarr the same movie twice
        self.sync_lock = Lock()

    @property
    def processed_movies(self) -> set:
        """Ids of the movies already handed to Radarr"""
        return self.db.get_added_ids()

    def mark_processed(self, movie_id: str, slug: Optional[str] = None, title: Optional[str] = None,
                       year: Optional[int] = None, tags: Optional[List[str]] = None) -> None:
        """Record a movie as handed to Radarr so later syncs skip it"""
        self.db.add_movie(movie_id, slug=slug, title=title, year=year, tags=tags)

    def sync_once(self):
        """Perform a single sync operation, recording it as a sync run"""
        if not self.sync_lock.acquire(blocking=False):
            self.logger.info("A sync is already running, skipping this one")
            return

        run_id = self.db.start_sync_run()
        added = considered = 0
        error = None
        try:
            added, considered = self._sync()
        except Exception as e:
            error = str(e)
            raise
        finally:
            self.db.finish_sync_run(run_id, added=added, considered=considered, error=error)
            self.sync_lock.release()

    def _sync(self) -> Tuple[int, int]:
        """Run one sync, returning how many movies were added and looked at"""
        self.logger.info("Starting sync operation")

        # Get movies from all configured watch lists
        movies = self.letterboxd.get_movies_from_watch_lists(
            watch_items=self.config.letterboxd.watch,
            global_filters=self.config.letterboxd.filters
        )

        if not movies:
            self.logger.warning("No movies found in any watch lists")
            return 0, 0

        # Read the whole set once: the loop below checks it for every movie
        processed_ids, processed_slugs = self.db.get_added_keys()

        # Process each movie
        added_count = 0
        for movie in movies:
            # Create unique identifier
            movie_id = movie_key(movie)

            # Skip if already processed
            if movie_id in processed_ids or movie['letterboxd_slug'] in processed_slugs:
                self.logger.debug(f"Skipping already processed: {movie['title']}")
                continue

            # Check if movie should be auto-added to Radarr
            auto_add = movie.get('auto_add', True)
            
            # Search for movie in Radarr/TMDB
            self.logger.info(f"Processing: {movie['title']} ({movie.get('year', 'N/A')}) - Tags: {movie.get('tags', [])} - Auto-add: {auto_add}")
            radarr_movie = None
            try:
                radarr_movie = self.radarr.search_movie(movie['title'], movie.get('year'))
            except MultipleMatchesError:
                tmdb_id = self.letterboxd.get_movie_tmdb_id(movie['letterboxd_slug'])
                if tmdb_id:
                    radarr_movie = self.radarr.search_movie(movie['title'], movie.get('year'), tmdb_id)

            if not radarr_movie:
                self.logger.warning(f"Could not find in TMDB: {movie['title']}")
                # Still mark as processed to avoid repeated failed searches
                self.mark_processed(movie_id, slug=movie['letterboxd_slug'],
                                    title=movie['title'], year=movie.get('year'))
                processed_ids.add(movie_id)
                continue

            # Add to Radarr with tags only if auto_add is True
            if auto_add:
                tags = movie.get('tags', [])
                if self.radarr.add_movie(radarr_movie, tags):
                    added_count += 1
                # Mark as processed
                self.mark_processed(movie_id, slug=movie['letterboxd_slug'],
                                    title=movie['title'], year=movie.get('year'), tags=tags)
                processed_ids.add(movie_id)
            else:
                self.logger.info(f"Skipping auto-add for: {movie['title']} (auto_add=False)")

            # Small delay between additions
            time.sleep(0.5)

        self.logger.info(f"Sync complete. Added {added_count} new movies")
        return added_count, len(movies)

    def run_continuous(self, interval_minutes: int = 60):
        """Run sync continuously at specified interval"""
        self.logger.info(f"Starting continuous sync (interval: {interval_minutes} minutes)")

        while True:
            try:
                self.sync_once()
            except Exception as e:
                self.logger.error(f"Error during sync: {e}")

            self.logger.info(f"Sleeping for {interval_minutes} minutes...")
            time.sleep(interval_minutes * 60)

class LetterboxarrThread(Thread):
    """Thread for running continuous sync"""

    def __init__(self, sync_instance: LetterboxarrSync):
        super().__init__()
        self.sync_instance = sync_instance
        self.daemon = True
        self.stop_event = Event()

    def run(self):
        self.sync_instance.run_continuous(self.sync_instance.config.sync.interval_minutes)

    def stop(self):
        self.stop_event.set()
        self.join(timeout=1)