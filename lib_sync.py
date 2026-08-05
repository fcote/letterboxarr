import time
from threading import Event, Lock, Thread
from typing import Dict, List, Optional, Tuple

from lib_db import Database, get_database
from lib_letterboxd import LetterboxdScraper
from lib_radarr import RadarrAPI, MultipleMatchesError
from lib_config import Config
from lib_refresh import ListRefresher


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
        self.refresher = ListRefresher(logger, config, self.letterboxd, self.db)
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

    def sync_once(self, refresh: bool = False, max_age: Optional[float] = None):
        """Perform a single sync operation, recording it as a sync run

        With refresh, the watch lists are read from Letterboxd first, so what
        goes to Radarr is what they hold now rather than what they held at the
        last read. Failing to read them is not failing the sync: the stored
        lists may still hold movies the last round did not get to.

        The release dates of the films still waiting to come out are read last,
        after Radarr has been handed everything: they are a page per film, and a
        film reaching Radarr today is worth more than a date being one round
        older than it had to be.

        The run is recorded around all of it, which is what makes "a sync is
        in progress" mean the whole round to everything watching it.
        """
        if not self.sync_lock.acquire(blocking=False):
            self.logger.info("A sync is already running, skipping this one")
            return

        run_id = self.db.start_sync_run()
        added = considered = 0
        error = None
        try:
            if refresh:
                try:
                    self.refresher.refresh_all(max_age)
                except Exception as e:
                    self.logger.error(f"Error refreshing the watch lists: {e}")
            added, considered = self._sync()
            if refresh:
                try:
                    self.refresher.refresh_releases()
                except Exception as e:
                    self.logger.error(f"Error refreshing the release dates: {e}")
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


class LetterboxarrThread(Thread):
    """Runs a round on the configured interval: read the lists, then sync them

    One interval covers both halves, and in that order, so a film added to a
    watch list reaches Radarr in the same round rather than waiting for the
    next one.

    The wait between rounds is an Event rather than a sleep, so stopping the
    thread takes effect at once instead of at the end of the interval: saving
    the configuration replaces this thread, and one that only noticed an hour
    later would leave two rounds running against the same Letterboxd account.
    """

    def __init__(self, logger, sync_instance: LetterboxarrSync):
        super().__init__(name='Letterboxarr sync', daemon=True)
        self.logger = logger
        self.sync_instance = sync_instance
        self.interval_minutes = sync_instance.config.sync.interval_minutes
        self.stop_event = Event()
        self.first_round = True

    def run(self):
        self.logger.info(f"Starting continuous sync (interval: {self.interval_minutes} minutes)")

        while not self.stop_event.is_set():
            try:
                self.run_round()
            except Exception as e:
                self.logger.error(f"Error during sync: {e}")

            self.stop_event.wait(self.interval_minutes * 60)

        self.logger.info("Stopped continuous sync")

    def run_round(self):
        """Read every watch list from Letterboxd, then hand what they hold to Radarr

        The first round only re-reads the lists already older than the interval,
        so restarting does not set the whole crawl going again; every round
        after that re-reads them all, which is what the interval asks for.
        """
        max_age = self.interval_minutes * 60 if self.first_round else None
        self.first_round = False
        self.sync_instance.sync_once(refresh=True, max_age=max_age)

    def stop(self, timeout: float = 1):
        """Ask the thread to stop and give it a moment to notice

        A round already under way is not interrupted: it may be halfway through
        adding a movie to Radarr. The thread is a daemon, so an unfinished one
        never holds the process open.
        """
        self.stop_event.set()
        self.join(timeout=timeout)