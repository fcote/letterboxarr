import re
import time
import json
import hashlib
from threading import RLock
from typing import List, Dict, NamedTuple, Optional, Set, Tuple
from urllib.parse import urljoin

from curl_cffi import requests
from bs4 import BeautifulSoup

from lib_config import WatchListItem, create_letterboxd_cookie_filters, LetterboxdFilters
from lib_db import Database

# Categories a Letterboxd entry can be sorted into
CATEGORY_FILM = 'film'
CATEGORY_SHORT_FILM = 'short_film'
CATEGORY_DOCUMENTARY = 'documentary'
CATEGORY_TV_SHOW = 'tv_show'
CATEGORY_UNRELEASED = 'unreleased'

# Category detection order, paired with the filter that hides it on Letterboxd.
# Categories overlap (a short documentary is both, and anything can still be
# unreleased), so the first match wins. Unreleased comes first: nothing in it can
# be downloaded yet, whatever its type.
CATEGORY_SKIP_FILTERS = [
    (CATEGORY_UNRELEASED, 'skip_unreleased'),
    (CATEGORY_TV_SHOW, 'skip_tv_shows'),
    (CATEGORY_DOCUMENTARY, 'skip_documentaries'),
    (CATEGORY_SHORT_FILM, 'skip_short_films'),
]

# Browser fingerprints to impersonate, tried in order. Letterboxd's bot
# protection refuses some of them on member pages (a 403 on
# /<user>/films/page/2/ while page 1 answers fine), and which ones are refused
# changes over time, so a refused fingerprint falls through to the next.
IMPERSONATIONS = ['chrome', 'chrome131', 'safari17_0']


class ListPage(NamedTuple):
    """One page of a Letterboxd listing

    The name is only ever read off the first page, since that is the only one a
    crawl is sure to fetch and every page of a listing carries the same one.
    """
    movies: List[Dict]
    name: Optional[str] = None


class LetterboxdScraper:
    """Scrapes Letterboxd for movie information from multiple sources"""

    def __init__(self, logger, db: Database):
        self.logger = logger
        self.db = db
        self.impersonations = list(IMPERSONATIONS)
        self.session = requests.Session(impersonate=self.impersonations[0])
        # The session carries the filmFilter cookie, so only one crawl at a
        # time: the API and the sync thread both share this scraper
        self.crawl_lock = RLock()

    @staticmethod
    def _list_key(watch_item: WatchListItem, global_filters: LetterboxdFilters) -> str:
        """The key a listing is stored under: its path and the filters it was read with"""
        key_data = {
            'path': watch_item.path,
            'global_filters': global_filters.to_dict()
        }
        if watch_item.filters:
            key_data['filters'] = watch_item.filters.to_dict()

        key_string = json.dumps(key_data, sort_keys=True)
        return hashlib.md5(key_string.encode()).hexdigest()

    def get_movies_from_watch_lists(self, watch_items: List[WatchListItem], global_filters: LetterboxdFilters) -> List[Dict]:
        """Fetch and parse movies from multiple watch lists"""
        all_movies = []
        
        for watch_item in watch_items:
            if not watch_item.auto_add:
                self.logger.info(f"Skipping watch list {watch_item.path} because auto_add is False")
                continue

            self.logger.info(f"Processing watch list: {watch_item.path}")
            movies = self.get_movies_from_path(watch_item, global_filters)
            
            # Add tags and auto_add flag to movies
            for movie in movies:
                movie['tags'] = watch_item.tags.copy()
                movie['auto_add'] = watch_item.auto_add
            
            all_movies.extend(movies)
        
        # Remove duplicates based on letterboxd_slug
        # Merge tags and auto_add flags from duplicate movies
        movies_dict = {}
        for movie in all_movies:
            slug = movie['letterboxd_slug']
            if slug not in movies_dict:
                movies_dict[slug] = movie.copy()
            else:
                # Merge tags from duplicate movies
                existing_tags = set(movies_dict[slug]['tags'])
                new_tags = set(movie['tags'])
                movies_dict[slug]['tags'] = list(existing_tags.union(new_tags))
                # auto_add should be True if ANY source watch list has auto_add=True
                movies_dict[slug]['auto_add'] = movies_dict[slug]['auto_add'] or movie['auto_add']
        
        unique_movies = list(movies_dict.values())
        
        self.logger.info(f"Found {len(unique_movies)} unique movies across all watch lists")
        return unique_movies

    def _get(self, url: str):
        """Fetch a Letterboxd page, falling back to another browser fingerprint on a 403

        The working fingerprint is moved to the front so the rest of the crawl
        stops paying for the refused ones.
        """
        response = None
        for impersonate in list(self.impersonations):
            response = self.session.get(url, impersonate=impersonate)
            if response.status_code != 403:
                self.impersonations.remove(impersonate)
                self.impersonations.insert(0, impersonate)
                break
            self.logger.debug(f"Letterboxd refused fingerprint '{impersonate}' for {url}")

        response.raise_for_status()
        return response

    def _set_film_filter(self, cookie_filters: str) -> None:
        """Set the filmFilter cookie for the next requests, dropping any previous one

        Letterboxd echoes the cookie back on the '.letterboxd.com' domain, so
        setting a new value would otherwise leave the previous one in the jar and
        keep filtering the listing with it.
        """
        for cookie in list(self.session.cookies.jar):
            if cookie.name == 'filmFilter':
                self.session.cookies.jar.clear(cookie.domain, cookie.path, cookie.name)

        if cookie_filters:
            self.session.cookies.set('filmFilter', cookie_filters, domain='letterboxd.com')

    def get_movies_from_path(self, watch_item: WatchListItem,
                             global_filters: LetterboxdFilters) -> List[Dict]:
        """The stored listing of a Letterboxd path, reading it if there is none

        Never re-reads a listing it already has, however old: keeping it current
        is the refresher's job, so browsing the movies page answers from the
        database instead of waiting minutes on a crawl.
        """
        list_key = self._list_key(watch_item, global_filters)

        stored = self.db.get_list(list_key)
        if stored is not None:
            self.logger.debug(f"Read {len(stored)} stored movies for {watch_item.path}")
            return stored

        with self.crawl_lock:
            # Whoever held the lock may have been reading this very listing
            stored = self.db.get_list(list_key)
            if stored is not None:
                return stored

            self.logger.info(f"No stored listing for {watch_item.path}, reading it now")
            return self._read_list(list_key, watch_item, global_filters)

    def refresh_path(self, watch_item: WatchListItem, global_filters: LetterboxdFilters,
                     max_age: Optional[float] = None) -> bool:
        """Re-read a listing from Letterboxd and store it over the previous one

        A listing read more recently than max_age is left alone, which is what
        stops a restart from crawling everything again. Returns whether the
        stored listing was replaced, so a crawl that came back empty and left
        the previous one in place does not count as a refresh.
        """
        list_key = self._list_key(watch_item, global_filters)

        with self.crawl_lock:
            fetched_at = self.db.get_list_fetched_at(list_key)
            if max_age is not None and fetched_at is not None \
                    and time.time() - fetched_at < max_age:
                return False

            self._read_list(list_key, watch_item, global_filters)
            return self.db.get_list_fetched_at(list_key) != fetched_at

    def _read_list(self, list_key: str, watch_item: WatchListItem,
                   global_filters: LetterboxdFilters) -> List[Dict]:
        """Crawl a listing and store it, keeping what is stored if it comes back empty

        Must be called under the crawl lock. An empty result is far more often a
        refused page than an emptied list, and storing it would replace a good
        listing with nothing until the next refresh.
        """
        movies, name = self._fetch_path(watch_item, global_filters)

        if not movies:
            stored = self.db.get_list(list_key)
            if stored is not None:
                self.logger.warning(
                    f"Letterboxd returned no movies for {watch_item.path}, keeping the stored listing"
                )
                return stored
            return []

        self.db.save_list(list_key, watch_item.path, movies, name)
        return movies

    def _fetch_path(self, watch_item: WatchListItem,
                    global_filters: LetterboxdFilters) -> Tuple[List[Dict], Optional[str]]:
        """Crawl every page of a Letterboxd path, without touching the database

        Returns the films and the name Letterboxd gives the path, the latter None
        when the page did not carry one.
        """
        movies = []
        name = None
        for page in self._iter_pages(watch_item, global_filters):
            movies.extend(page.movies)
            name = name or page.name

        self.logger.info(f"Found {len(movies)} movies in {watch_item.path}")
        return movies, name

    def _iter_pages(self, watch_item: WatchListItem, global_filters: LetterboxdFilters):
        """Yield the films of a Letterboxd path one ListPage at a time

        Pages are only fetched as the caller asks for them, so a caller that has
        seen enough stops the crawl by walking away from the generator.
        """
        url = f"https://letterboxd.com/{watch_item.path}/"

        # Set up filters as cookies if specified
        if watch_item.filters:
            cookie_filters = create_letterboxd_cookie_filters(watch_item.filters)
        else:
            cookie_filters = create_letterboxd_cookie_filters(global_filters)

        self._set_film_filter(cookie_filters)

        page = 1
        while True:
            page_url = url if page == 1 else urljoin(url, f"page/{page}/")
            self.logger.debug(f"Fetching page {page} from {watch_item.path}")

            try:
                response = self._get(page_url)
            except requests.RequestsError as e:
                self.logger.error(f"Error fetching page {page} from {watch_item.path}: {e}")
                return

            soup = BeautifulSoup(response.content, 'html.parser')

            # Find movie posters/links
            movie_items = soup.find_all('div', attrs={'data-component-class': 'LazyPoster'})

            if not movie_items:
                self.logger.debug(f"No more movies found on page {page} of {watch_item.path}")
                return

            yield ListPage(
                movies=[
                    movie for movie in (self._extract_movie_data(item) for item in movie_items)
                    if movie
                ],
                name=self._extract_list_name(soup) if page == 1 else None
            )

            # Check if there's a next page
            next_page = soup.find('a', class_='next')
            if not next_page:
                return

            page += 1
            time.sleep(1)  # Be respectful to the server

    def get_movies_from_path_by_category(self, watch_item: WatchListItem,
                                         global_filters: LetterboxdFilters) -> List[Dict]:
        """Get movies from a Letterboxd path, each tagged with a 'category'

        Letterboxd does not expose the category in the listing markup, but it can
        hide a category through the filmFilter cookie. Each category is therefore
        resolved by diffing the listing against the same listing with that single
        category hidden. Categories already excluded by the watch item filters
        cannot appear in the listing, so they cost no extra request.
        """
        movies = self.get_movies_from_path(watch_item, global_filters)
        return self._categorise(
            movies, watch_item, global_filters,
            lambda variant: self.get_movies_from_path(variant, global_filters)
        )

    def get_stored_list(self, watch_item: WatchListItem,
                        global_filters: LetterboxdFilters) -> Optional[List[Dict]]:
        """The stored listing of a path, or None if it has never been read

        Unlike get_movies_from_path this never crawls, so a caller with many
        listings to report on can say "not read yet" for the ones that are
        missing instead of waiting minutes on Letterboxd for each of them.
        """
        return self.db.get_list(self._list_key(watch_item, global_filters))

    def get_stored_movies_by_category(self, watch_item: WatchListItem,
                                      global_filters: LetterboxdFilters) -> Optional[List[Dict]]:
        """Categorised movies of a path from storage alone, None if never read

        A variant that has not been read leaves its category unresolved rather
        than holding the whole listing back: knowing a list's size and how much
        of it is watched is worth having before every category can be told apart.
        """
        movies = self.get_stored_list(watch_item, global_filters)
        if movies is None:
            return None

        return self._categorise(
            movies, watch_item, global_filters,
            lambda variant: self.get_stored_list(variant, global_filters)
        )

    def _categorise(self, movies: List[Dict], watch_item: WatchListItem,
                    global_filters: LetterboxdFilters, listing_of) -> List[Dict]:
        """Tag each movie with the category its absence from a variant reveals

        A movie missing from the listing read with one category hidden is of that
        category, and the first match wins since the categories overlap. Whatever
        listing_of cannot supply is skipped, leaving those movies as plain films.
        """
        categories = {}
        for category, hidden_item in self._category_variants(watch_item, global_filters):
            listing = listing_of(hidden_item)
            if listing is None:
                continue

            kept_slugs = {movie['letterboxd_slug'] for movie in listing}
            for movie in movies:
                slug = movie['letterboxd_slug']
                if slug not in kept_slugs:
                    categories.setdefault(slug, category)

        return [
            {**movie, 'category': categories.get(movie['letterboxd_slug'], CATEGORY_FILM)}
            for movie in movies
        ]

    def refresh_watch_item(self, watch_item: WatchListItem, global_filters: LetterboxdFilters,
                           max_age: Optional[float] = None) -> int:
        """Re-read every listing a watch item is shown from, returning how many were read

        That is the listing itself plus the one-category-hidden variants the
        movies page needs to tell a short film from a documentary, so a refreshed
        watch item is entirely refreshed rather than half old.
        """
        variants = [watch_item] + [
            variant for _, variant in self._category_variants(watch_item, global_filters)
        ]
        return sum(
            self.refresh_path(variant, global_filters, max_age) for variant in variants
        )

    def _category_variants(self, watch_item: WatchListItem, global_filters: LetterboxdFilters):
        """The (category, watch item with that category hidden) pairs worth reading

        A category the watch item already filters out cannot appear in its
        listing, so hiding it would read the very same listing again.
        """
        effective_filters = watch_item.filters or global_filters

        for category, skip_attr in CATEGORY_SKIP_FILTERS:
            if getattr(effective_filters, skip_attr, False):
                continue
            yield category, self._with_hidden_category(watch_item, effective_filters, skip_attr)

    def get_watched_slugs(self, username: str) -> Set[str]:
        """The slugs of every film the Letterboxd user has marked as watched

        Read from the member's public /films/ page, so no filters apply: the
        point is to know the whole watched history, not a filtered view of it.

        Answers from the database once the profile is known, whatever its age;
        keeping it current is refresh_watched's job. Only a profile that has
        never been read is read here, since reporting a member with thousands of
        films as having watched nothing would have every list look unwatched.
        """
        stored = self.db.get_watched_slugs(username)
        if stored is not None:
            self.logger.debug(f"{username} has watched {len(stored)} films (stored)")
            return stored

        with self.crawl_lock:
            stored = self.db.get_watched_slugs(username)
            if stored is not None:
                return stored

            self.logger.info(f"{username} has never been read, reading the profile now")
            return self._read_watched(username, None)

    def refresh_watched(self, username: str, max_age: Optional[float] = None) -> bool:
        """Bring the watched profile up to date, returning whether it was read

        Once a profile is known it is topped up rather than re-read, which for a
        member with thousands of films is one page instead of dozens. Only a
        whole re-read notices a film that is no longer watched, so one is still
        done daily.
        """
        known = self.db.get_watched_slugs(username)

        if known is not None and max_age is not None:
            refreshed_at = self.db.get_watched_refreshed_at(username)
            if refreshed_at is not None and time.time() - refreshed_at < max_age:
                return False

        if known is None or self.db.needs_full_watched_refresh(username):
            self._read_watched(username, known)
        else:
            self._top_up_watched(username, known)
        return True

    def _read_watched(self, username: str, known: Optional[Set[str]]) -> Set[str]:
        """Read a member's whole watched history, replacing what is stored"""
        watched_item = WatchListItem(path=f"{username}/films", filters=LetterboxdFilters())
        try:
            with self.crawl_lock:
                movies, _ = self._fetch_path(watched_item, LetterboxdFilters())
        except Exception as e:
            if known is None:
                raise
            self.logger.warning(f"Could not refresh watched films for {username}, reusing the stored set: {e}")
            return known

        # Same reasoning as a stored listing: an empty profile page is far more
        # likely a refused request than a member who has watched nothing
        if not movies:
            if known is not None:
                self.logger.warning(f"Letterboxd returned no watched films for {username}, reusing the stored set")
                return known
            return set()

        self.db.save_watched_films(username, movies)
        self.logger.info(f"{username} has watched {len(movies)} films")
        return {movie['letterboxd_slug'] for movie in movies}

    def _top_up_watched(self, username: str, known: Set[str]) -> Set[str]:
        """Add whatever a member has watched since the profile was last read

        /films/by/date/ is ordered by when each film was logged, newest first, so
        the crawl stops at the first page that holds nothing new. Stopping on a
        whole page rather than the first familiar film leaves room for films
        logged on the same day to come back in a different order.
        """
        recent_item = WatchListItem(path=f"{username}/films/by/date", filters=LetterboxdFilters())
        # Films logged while the crawl is running push the rest of the listing
        # back a place, so the same film can turn up on two consecutive pages
        seen = set(known)
        added = []
        pages = 0

        try:
            with self.crawl_lock:
                for page in self._iter_pages(recent_item, LetterboxdFilters()):
                    pages += 1
                    fresh = [
                        movie for movie in page.movies
                        if movie['letterboxd_slug'] not in seen
                    ]
                    if not fresh:
                        break
                    seen.update(movie['letterboxd_slug'] for movie in fresh)
                    added.extend(fresh)
        except Exception as e:
            self.logger.warning(f"Could not top up watched films for {username}, reusing the stored set: {e}")
            return known

        if pages == 0:
            # Not even the first page came back; treat it as a failed refresh
            self.logger.warning(f"Letterboxd returned no watched films for {username}, reusing the stored set")
            return known

        self.db.add_watched_films(username, added)
        self.logger.info(
            f"{username} has watched {len(added)} more films since the last check "
            f"({len(seen)} in total, read {pages} page(s))"
        )
        return seen

    @staticmethod
    def _with_hidden_category(watch_item: WatchListItem, effective_filters: LetterboxdFilters,
                              skip_attr: str) -> WatchListItem:
        """Copy a watch item with one extra category hidden by its filters"""
        filters = LetterboxdFilters(**effective_filters.to_dict())
        setattr(filters, skip_attr, True)
        return WatchListItem(
            path=watch_item.path,
            filters=filters,
            tags=list(watch_item.tags),
            auto_add=watch_item.auto_add
        )

    def get_movie_tmdb_id(self, letterboxd_slug: str) -> Optional[int]:
        """Fetch TMDB ID for a movie from Letterboxd"""
        url = f"https://letterboxd.com/film/{letterboxd_slug}/"
        try:
            with self.crawl_lock:
                response = self._get(url)
        except requests.RequestsError as e:
            self.logger.error(f"Error fetching movie page: {e}")
            return None

        soup = BeautifulSoup(response.content, 'html.parser')
        body = soup.find('body')
        if body:
            return int(body.get('data-tmdb-id'))
        return None

    @staticmethod
    def _extract_list_name(soup) -> Optional[str]:
        """What Letterboxd calls the page a listing was read from

        The Open Graph title is what every shape of listing page agrees on: a
        watchlist gives "<member>'s Watchlist", a list "IMDb Top 250", a crew or
        cast page "Films directed by James Gray". The heading is only there on
        the pages built around one, so it stands in when the meta tag is missing.
        """
        meta = soup.find('meta', attrs={'property': 'og:title'})
        heading = soup.find('h1', class_='title-1')

        for name in (meta.get('content') if meta else None,
                     heading.get_text(' ', strip=True) if heading else None):
            if name and name.strip():
                return name.strip()

        return None

    def _extract_movie_data(self, item) -> Optional[Dict]:
        """Extract movie information from a poster element"""
        try:
            # Get the film slug for additional details
            film_link = item.get('data-item-slug')
            if not film_link:
                return None

            # Get title
            img = item.find('img')
            title = img.get('alt') if img else None

            if not title:
                return None

            # Try to extract year from the data attributes or fetch detail page
            year = self._extract_year(item)

            # Clean title (remove year if it's in the title)
            title_clean = re.sub(r'\s*\(\d{4}\)\s*$', '', title)

            return {
                'title': title_clean,
                'year': year,
                'letterboxd_slug': film_link
            }

        except Exception as e:
            self.logger.error(f"Error extracting movie data: {e}")
            return None

    @staticmethod
    def _extract_year(item) -> Optional[int]:
        """Try to extract year from various sources"""
        # Check data attributes
        year_attr = item.get('data-film-year')
        if year_attr:
            try:
                return int(year_attr)
            except (ValueError, TypeError):
                pass

        # Try to get from title if it's in format "Title (YYYY)"
        full_name = item.get('data-item-full-display-name')
        if full_name:
            year_match = re.search(r'\((\d{4})\)', full_name)
            if year_match:
                try:
                    return int(year_match.group(1))
                except ValueError:
                    pass

        return None