"""Keeping the stored Letterboxd listings up to date

Reads of a list answer from the database, so something has to put newer data
there: that is this. Every configured watch item, and the watched profile, is
re-read on the period from the configuration, in the background, and each
listing is only replaced once its replacement has been read in full.

Release dates are read here too, but on their own terms: a listing is one page
per hundred films and a release table is one page per film, so only the films
still waiting to be released are read, and far less often than the lists are.

Ratings are read the same way, and for the same reason: Letterboxd puts neither
an average nor a rating count on a listing page, so there is no reading them a
hundred at a time. What makes that affordable is that a rating belongs to the
film rather than to the list it was found through, so the backlog is the films
watched rather than the places they appear, and an average over thousands of
ratings is still the same average a month later.
"""

import time
from typing import Dict, List, NamedTuple, Optional

from lib_config import Config, WatchListItem
from lib_db import Database
from lib_letterboxd import CATEGORY_FILM, LetterboxdScraper

# How old a film's release table may be before it is read again. Dates are
# announced and moved over weeks, not minutes, so re-reading one on every sync
# round would be a page per film per hour for news that rarely comes.
RELEASE_MAX_AGE = 12 * 3600

# How many release tables one round will read. A watch list that has just been
# added brings its whole backlog at once, and reading all of it in one go would
# hold the round open for as long as it took; the rest is read by the rounds
# that follow, which is why the count left over is logged rather than passed
# over in silence.
RELEASE_READS_PER_ROUND = 100

# How old a film's ratings may be before they are read again. An average over
# thousands of ratings moves in the third decimal over a month, and what the
# watch items page does with it is order lists that are hundreds of films apart:
# reading these on the release dates' twelve hours would be a page per film per
# half-day to watch a number not move.
STATS_MAX_AGE = 30 * 86400

# How many ratings one round will read, on the same terms as the release tables
# above. Set far higher than those because this backlog is every film on every
# list rather than the few still waiting to come out: at a page a second it puts
# eight minutes on the end of a round, which is worth it to have a new watch
# list's ratings within a couple of rounds instead of over two days.
STATS_READS_PER_ROUND = 500


class UpcomingCandidates(NamedTuple):
    """The films a release can still be expected for, and where they came from

    read_lists comes back with them rather than being counted again: working it
    out means reading every stored listing, which is the expensive half of
    finding the films in the first place. A page with nothing on it needs it to
    tell "no list holds anything recent" from "no list has been read yet".
    """
    films: List[Dict]
    read_lists: int


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

    def upcoming_candidates(self) -> UpcomingCandidates:
        """The films a release can still be expected for, by slug

        That is the films of this year and later the watch items hold: reading
        the release table of every film on every list would be thousands of
        pages for a handful of answers, and a film from an earlier year has
        already had every release it is going to get.

        Read from the stored listings alone, so this never crawls; a list that
        has not been read yet simply contributes nothing. A film on several
        lists is one candidate carrying all of them, since a release is worth
        listing once however many lists it came from.
        """
        candidates: Dict[str, Dict] = {}
        read_lists = 0

        for item_id, watch_item in enumerate(self.config.letterboxd.watch):
            movies = self.scraper.get_upcoming_films(
                watch_item, self.config.letterboxd.filters
            )
            if movies is None:
                continue

            # What kind of thing each entry is, read off the same listings the
            # movies page is categorised from. A list whose category variants
            # have not been read yet places nothing, which is a film until it
            # has been: no page waits on a crawl to say what it already knows.
            categories = self.scraper.get_stored_categories(
                watch_item, self.config.letterboxd.filters
            )

            read_lists += 1
            for movie in movies:
                candidate = candidates.setdefault(movie['letterboxd_slug'], {
                    'letterboxd_slug': movie['letterboxd_slug'],
                    'title': movie['title'],
                    'year': movie.get('year'),
                    'category': CATEGORY_FILM,
                    'tags': [],
                    'watch_items': []
                })
                candidate['watch_items'].append({'id': item_id, 'path': watch_item.path})
                candidate['tags'].extend(
                    tag for tag in watch_item.tags if tag not in candidate['tags']
                )

                # A film on several lists takes the first kind any of them could
                # place it under. What a film is does not depend on the list it
                # was found through, so the lists cannot disagree; one of them
                # not having read its variants yet is what this is for.
                category = categories.get(movie['letterboxd_slug'], CATEGORY_FILM)
                if category != CATEGORY_FILM:
                    candidate['category'] = category

        return UpcomingCandidates(list(candidates.values()), read_lists)

    def refresh_releases(self, max_age: Optional[float] = RELEASE_MAX_AGE) -> Dict:
        """Read the release table of every film still waiting on one

        A film read more recently than max_age is left alone, so a round costs
        nothing once the backlog is through. One film that fails is one film
        without dates until the next round, not a round that stopped: a page
        that could not be read stores nothing, which is what has it read again.
        """
        candidates = self.upcoming_candidates().films
        read_at = self.db.get_release_reads()
        now = time.time()

        due = [
            candidate for candidate in candidates
            if max_age is None
            or candidate['letterboxd_slug'] not in read_at
            or now - read_at[candidate['letterboxd_slug']] >= max_age
        ]

        # Longest unread first, so the films nothing is known about lead. Only
        # the first hundred of a round are read, and in the order the watch
        # lists happen to be configured in the same hundred would be read every
        # time: a film at the back would stay unread however often the button
        # was pressed.
        due.sort(key=lambda candidate: read_at.get(candidate['letterboxd_slug'], 0))

        if not due:
            self.logger.debug(f"Release dates are current for all {len(candidates)} recent film(s)")
            return {'read': 0, 'failed': 0, 'left': 0, 'candidates': len(candidates)}

        left = max(0, len(due) - RELEASE_READS_PER_ROUND)
        self.logger.info(
            f"Reading release dates for {len(due) - left} of {len(candidates)} recent film(s)"
            + (f", {left} left for the next round" if left else "")
        )

        read = 0
        failed = 0
        for index, candidate in enumerate(due[:RELEASE_READS_PER_ROUND]):
            # Between every pair of pages, whether or not the last one worked: a
            # run of refused pages is when pausing matters most, and skipping the
            # wait on failure would go at Letterboxd hardest just then
            if index:
                time.sleep(1)

            try:
                releases = self.scraper.get_film_releases(candidate['letterboxd_slug'])
            except Exception as e:
                releases = None
                self.logger.error(
                    f"Error reading the release dates of {candidate['letterboxd_slug']}: {e}"
                )

            if releases is None:
                failed += 1
                continue

            self.db.save_film_releases(candidate, releases)
            read += 1

        self.logger.info(f"Release dates: {read} film(s) read, {failed} failed")
        return {'read': read, 'failed': failed, 'left': left, 'candidates': len(candidates)}

    def stats_candidates(self) -> List[Dict]:
        """Every film the watch items hold, by slug

        Unlike the upcoming candidates above this is all of them, not only the
        recent ones: what the ratings are for is ordering whole lists, and a
        list whose older half went unread would be ordered on its newer half.

        Read from the stored listings alone, so this never crawls. A film on
        several lists is one candidate: a rating belongs to the film, which is
        what keeps this the few thousand films watched rather than the far
        larger number of places they appear.
        """
        candidates: Dict[str, Dict] = {}

        for watch_item in self.config.letterboxd.watch:
            movies = self.scraper.get_stored_list(watch_item, self.config.letterboxd.filters)
            if movies is None:
                continue

            for movie in movies:
                candidates.setdefault(movie['letterboxd_slug'], {
                    'letterboxd_slug': movie['letterboxd_slug'],
                    'title': movie['title'],
                    'year': movie.get('year')
                })

        return list(candidates.values())

    def refresh_stats(self, max_age: Optional[float] = STATS_MAX_AGE) -> Dict:
        """Read how Letterboxd's members rated every film the watch items hold

        A film read more recently than max_age is left alone, so a round costs
        nothing once the backlog is through. One film that fails is one film
        without a rating until the next round, not a round that stopped.
        """
        candidates = self.stats_candidates()
        read_at = self.db.get_stats_reads()
        now = time.time()

        due = [
            candidate for candidate in candidates
            if max_age is None
            or candidate['letterboxd_slug'] not in read_at
            or now - read_at[candidate['letterboxd_slug']] >= max_age
        ]

        # Longest unread first, on the same reasoning as the release tables: the
        # films nothing is known about lead, and a film at the back of the
        # configured order still comes round rather than never being reached
        due.sort(key=lambda candidate: read_at.get(candidate['letterboxd_slug'], 0))

        if not due:
            self.logger.debug(f"Ratings are current for all {len(candidates)} film(s)")
            return {'read': 0, 'failed': 0, 'left': 0, 'candidates': len(candidates)}

        left = max(0, len(due) - STATS_READS_PER_ROUND)
        self.logger.info(
            f"Reading ratings for {len(due) - left} of {len(candidates)} film(s)"
            + (f", {left} left for the next round" if left else "")
        )

        read = 0
        failed = 0
        for index, candidate in enumerate(due[:STATS_READS_PER_ROUND]):
            # Between every pair of pages, whether or not the last one worked,
            # for the reason the release tables above wait
            if index:
                time.sleep(1)

            try:
                stats = self.scraper.get_film_stats(candidate['letterboxd_slug'])
            except Exception as e:
                stats = None
                self.logger.error(
                    f"Error reading the ratings of {candidate['letterboxd_slug']}: {e}"
                )

            if stats is None:
                failed += 1
                continue

            self.db.save_film_stats(candidate, stats)
            read += 1

        self.logger.info(f"Ratings: {read} film(s) read, {failed} failed")
        return {'read': read, 'failed': failed, 'left': left, 'candidates': len(candidates)}

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
