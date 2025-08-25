import json
import os
import time

from lib_letterboxd import LetterboxdScraper
from lib_radarr import RadarrAPI, MultipleMatchesError
from lib_config import Config


class LetterboxdRadarrSync:
    """Main sync orchestrator"""

    # Data directory
    DATA_DIR = './data'

    # Filepath for processed movies
    PROCESSED_MOVIES_FILEPATH = './data/processed_movies.json'

    def __init__(self, logger, config: Config):
        self.logger = logger
        self.config = config
        self.letterboxd = LetterboxdScraper(logger)
        self.radarr = RadarrAPI(
            logger, 
            config.radarr.url, 
            config.radarr.api_key, 
            config.radarr.quality_profile,
            config.radarr.root_folder, 
            config.radarr.monitor_added, 
            config.radarr.search_added
        )
        self.processed_movies = self._load_processed_movies()

    def _load_processed_movies(self) -> set:
        """Load previously processed movies from file"""
        try:
            if os.path.exists(LetterboxdRadarrSync.PROCESSED_MOVIES_FILEPATH):
                with open(LetterboxdRadarrSync.PROCESSED_MOVIES_FILEPATH, 'r') as f:
                    return set(json.load(f))
        except Exception as e:
            self.logger.error(f"Error loading processed movies: {e}")
        return set()

    def _save_processed_movies(self):
        """Save processed movies to file"""
        try:
            if not os.path.exists(LetterboxdRadarrSync.DATA_DIR):
                os.makedirs(LetterboxdRadarrSync.DATA_DIR)

            with open(LetterboxdRadarrSync.PROCESSED_MOVIES_FILEPATH, 'w') as f:
                json.dump(list(self.processed_movies), f)
        except Exception as e:
            self.logger.error(f"Error saving processed movies: {e}")

    def sync_once(self):
        """Perform a single sync operation"""
        self.logger.info("Starting sync operation")

        # Get movies from all configured watch lists
        movies = self.letterboxd.get_movies_from_watch_lists(self.config.letterboxd.watch)

        if not movies:
            self.logger.warning("No movies found in any watch lists")
            return

        # Process each movie
        added_count = 0
        for movie in movies:
            # Create unique identifier
            movie_id = f"{movie['title']}_{movie.get('year', 'unknown')}"

            # Skip if already processed
            if movie_id in self.processed_movies:
                self.logger.debug(f"Skipping already processed: {movie['title']}")
                continue

            # Search for movie in Radarr/TMDB
            self.logger.info(f"Processing: {movie['title']} ({movie.get('year', 'N/A')}) - Tags: {movie.get('tags', [])}")
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
                self.processed_movies.add(movie_id)
                continue

            # Add to Radarr with tags
            tags = movie.get('tags', [])
            if self.radarr.add_movie(radarr_movie, tags):
                added_count += 1

            # Mark as processed
            self.processed_movies.add(movie_id)

            # Small delay between additions
            time.sleep(0.5)

        # Save processed movies
        self._save_processed_movies()

        self.logger.info(f"Sync complete. Added {added_count} new movies")

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