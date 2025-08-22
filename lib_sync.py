import json
import os
import time

from lib_letterboxd import LetterboxdScraper
from lib_radarr import RadarrAPI


class LetterboxdRadarrSync:
    """Main sync orchestrator"""

    def __init__(self, logger, letterboxd_username: str, radarr_url: str,
                 radarr_api_key: str, quality_profile: int, root_folder: str,
                 monitor_movies: bool = True, search_movies: bool = True):
        self.logger = logger
        self.letterboxd = LetterboxdScraper(logger, letterboxd_username)
        self.radarr = RadarrAPI(logger, radarr_url, radarr_api_key, quality_profile,
                                root_folder, monitor_movies, search_movies)
        self.processed_movies = self._load_processed_movies()

    def _load_processed_movies(self) -> set:
        """Load previously processed movies from file"""
        try:
            if os.path.exists('processed_movies.json'):
                with open('processed_movies.json', 'r') as f:
                    return set(json.load(f))
        except Exception as e:
            self.logger.error(f"Error loading processed movies: {e}")
        return set()

    def _save_processed_movies(self):
        """Save processed movies to file"""
        try:
            with open('processed_movies.json', 'w') as f:
                json.dump(list(self.processed_movies), f)
        except Exception as e:
            self.logger.error(f"Error saving processed movies: {e}")

    def sync_once(self):
        """Perform a single sync operation"""
        self.logger.info("Starting sync operation")

        # Get watchlist from Letterboxd
        watchlist = self.letterboxd.get_watchlist()

        if not watchlist:
            self.logger.warning("No movies found in watchlist")
            return

        # Process each movie
        added_count = 0
        for movie in watchlist:
            # Create unique identifier
            movie_id = f"{movie['title']}_{movie.get('year', 'unknown')}"

            # Skip if already processed
            if movie_id in self.processed_movies:
                self.logger.debug(f"Skipping already processed: {movie['title']}")
                continue

            # Search for movie in Radarr/TMDB
            self.logger.info(f"Processing: {movie['title']} ({movie.get('year', 'N/A')})")
            radarr_movie = self.radarr.search_movie(movie['title'], movie.get('year'))

            if not radarr_movie:
                self.logger.warning(f"Could not find in TMDB: {movie['title']}")
                # Still mark as processed to avoid repeated failed searches
                self.processed_movies.add(movie_id)
                continue

            # Add to Radarr
            if self.radarr.add_movie(radarr_movie):
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