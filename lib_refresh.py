"""Keeping the stored Letterboxd listings up to date

Reads of a list answer from the database, so something has to put newer data
there: that is this. Every configured watch item, and the watched profile, is
re-read on the period from the configuration, in the background, and each
listing is only replaced once its replacement has been read in full.
"""

from typing import Dict, Optional

from lib_config import Config, WatchListItem
from lib_db import Database
from lib_letterboxd import LetterboxdScraper


class ListRefresher:
    """Re-reads the watch items and the watched profile from Letterboxd"""

    def __init__(self, logger, config: Config, scraper: LetterboxdScraper, db: Database):
        self.logger = logger
        self.config = config
        self.scraper = scraper
        self.db = db

    def refresh_all(self, max_age: Optional[float] = None) -> Dict:
        """Re-read every watch item and the watched profile

        A listing read less than max_age ago is left alone, which is what keeps
        a restart from crawling everything it already has. One watch item that
        fails does not stop the others: a private list or a refused page should
        cost that list its refresh, not the whole round.
        """
        watch_items = self.config.letterboxd.watch
        self.logger.info(f"Refreshing {len(watch_items)} watch list(s) from Letterboxd")

        refreshed = 0
        failed = 0
        for watch_item in watch_items:
            try:
                refreshed += self.refresh_watch_item(watch_item, max_age)
            except Exception as e:
                failed += 1
                self.logger.error(f"Error refreshing {watch_item.path}: {e}")

        pruned = self.db.prune_lists([watch_item.path for watch_item in watch_items])
        if pruned:
            self.logger.info(f"Dropped {pruned} listing(s) that are no longer watched")

        watched = self._refresh_watched(max_age)

        self.logger.info(
            f"Refresh done: {refreshed} listing(s) re-read, {failed} watch list(s) failed"
        )
        return {'refreshed': refreshed, 'failed': failed, 'pruned': pruned, 'watched': watched}

    def refresh_watch_item(self, watch_item: WatchListItem,
                           max_age: Optional[float] = None) -> int:
        """Re-read one watch item, returning how many of its listings were read"""
        return self.scraper.refresh_watch_item(
            watch_item, self.config.letterboxd.filters, max_age
        )

    def _refresh_watched(self, max_age: Optional[float]) -> bool:
        """Re-read the watched profile, if one is configured"""
        username = self.config.letterboxd.username
        if not username:
            return False

        try:
            return self.scraper.refresh_watched(username, max_age)
        except Exception as e:
            self.logger.error(f"Error refreshing the watched films of {username}: {e}")
            return False
