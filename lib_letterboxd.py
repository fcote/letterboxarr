import re
import time
import json
import hashlib
import os
from threading import RLock
from typing import List, Dict, Optional, Set
from urllib.parse import urljoin

from curl_cffi import requests
from bs4 import BeautifulSoup

from lib_config import WatchListItem, create_letterboxd_cookie_filters, LetterboxdFilters

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


class LetterboxdScraper:
    """Scrapes Letterboxd for movie information from multiple sources"""

    def __init__(self, logger, cache_dir: str = 'data/cache', cache_ttl: int = 3600):
        self.logger = logger
        self.impersonations = list(IMPERSONATIONS)
        self.session = requests.Session(impersonate=self.impersonations[0])
        self.cache_dir = cache_dir
        self.cache_ttl = cache_ttl  # Cache TTL in seconds (default: 1 hour)
        # The session carries the filmFilter cookie, so only one crawl at a
        # time: the API and the sync thread both share this scraper
        self.crawl_lock = RLock()

        # Create cache directory if it doesn't exist
        if not os.path.exists(self.cache_dir):
            os.makedirs(self.cache_dir)

    def _get_cache_key(self, watch_item: WatchListItem, global_filters: LetterboxdFilters, limit: Optional[int] = None) -> str:
        """Generate a cache key based on watch item path, filters, and limit"""
        key_data = {
            'path': watch_item.path,
            'global_filters': global_filters.to_dict(),
            'limit': limit
        }
        if watch_item.filters:
            key_data['filters'] = watch_item.filters.to_dict()

        key_string = json.dumps(key_data, sort_keys=True)
        return hashlib.md5(key_string.encode()).hexdigest()

    def _get_cache_file_path(self, cache_key: str) -> str:
        """Get the full path to a cache file"""
        return os.path.join(self.cache_dir, f"movies_{cache_key}.json")

    def _is_cache_valid(self, cache_file_path: str) -> bool:
        """Check if cache file exists and is still valid (not expired)"""
        if not os.path.exists(cache_file_path):
            return False
        
        file_age = time.time() - os.path.getmtime(cache_file_path)
        return file_age < self.cache_ttl

    def _load_from_cache(self, cache_file_path: str) -> Optional[List[Dict]]:
        """Load movies from cache file"""
        try:
            with open(cache_file_path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError) as e:
            self.logger.warning(f"Error loading cache file {cache_file_path}: {e}")
            return None

    def _save_to_cache(self, cache_file_path: str, movies: List[Dict]) -> None:
        """Save movies to cache file"""
        try:
            with open(cache_file_path, 'w', encoding='utf-8') as f:
                json.dump(movies, f, ensure_ascii=False, indent=2)
        except IOError as e:
            self.logger.warning(f"Error saving cache file {cache_file_path}: {e}")

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

    def get_movies_from_path(self, watch_item: WatchListItem, global_filters: LetterboxdFilters,
                             limit: Optional[int] = None) -> List[Dict]:
        """Get movies from a specific Letterboxd path"""
        with self.crawl_lock:
            return self._crawl_path(watch_item, global_filters, limit)

    def _crawl_path(self, watch_item: WatchListItem, global_filters: LetterboxdFilters,
                    limit: Optional[int] = None) -> List[Dict]:
        # Check cache first
        cache_key = self._get_cache_key(watch_item, global_filters, limit)
        cache_file_path = self._get_cache_file_path(cache_key)
        
        if self._is_cache_valid(cache_file_path):
            cached_movies = self._load_from_cache(cache_file_path)
            if cached_movies is not None:
                self.logger.debug(f"Loading {len(cached_movies)} movies from cache for {watch_item.path}")
                return cached_movies
        
        # Cache miss or invalid, fetch from web
        self.logger.debug(f"Cache miss for {watch_item.path}, fetching from web")
        movies = []
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
                break

            soup = BeautifulSoup(response.content, 'html.parser')

            # Find movie posters/links
            movie_items = soup.find_all('div', attrs={'data-component-class': 'LazyPoster'})

            if not movie_items:
                self.logger.debug(f"No more movies found on page {page} of {watch_item.path}")
                break

            for item in movie_items:
                movie_data = self._extract_movie_data(item)
                if movie_data:
                    movies.append(movie_data)
                if limit and len(movies) >= limit:
                    self.logger.info(f"Found {len(movies)} movies in {watch_item.path}")
                    # Save to cache before returning
                    self._save_to_cache(cache_file_path, movies)
                    return movies

            # Check if there's a next page
            next_page = soup.find('a', class_='next')
            if not next_page:
                break

            page += 1
            time.sleep(1)  # Be respectful to the server

        self.logger.info(f"Found {len(movies)} movies in {watch_item.path}")
        
        # Save to cache
        if len(movies) > 0:
            self._save_to_cache(cache_file_path, movies)
        
        return movies

    def get_movies_from_path_by_category(self, watch_item: WatchListItem, global_filters: LetterboxdFilters,
                                         limit: Optional[int] = None) -> List[Dict]:
        """Get movies from a Letterboxd path, each tagged with a 'category'

        Letterboxd does not expose the category in the listing markup, but it can
        hide a category through the filmFilter cookie. Each category is therefore
        resolved by diffing the listing against the same listing with that single
        category hidden. Categories already excluded by the watch item filters
        cannot appear in the listing, so they cost no extra request.
        """
        movies = self.get_movies_from_path(watch_item, global_filters, limit)
        effective_filters = watch_item.filters or global_filters

        categories = {}
        for category, skip_attr in CATEGORY_SKIP_FILTERS:
            if getattr(effective_filters, skip_attr, False):
                continue

            hidden_item = self._with_hidden_category(watch_item, effective_filters, skip_attr)
            kept_slugs = {
                movie['letterboxd_slug']
                for movie in self.get_movies_from_path(hidden_item, global_filters, limit)
            }
            for movie in movies:
                slug = movie['letterboxd_slug']
                if slug not in kept_slugs:
                    categories.setdefault(slug, category)

        return [
            {**movie, 'category': categories.get(movie['letterboxd_slug'], CATEGORY_FILM)}
            for movie in movies
        ]

    def get_watched_slugs(self, username: str) -> Set[str]:
        """Get the slugs of every film the Letterboxd user has marked as watched

        Read from the member's public /films/ page, so no filters apply: the
        point is to know the whole watched history, not a filtered view of it.
        """
        watched_item = WatchListItem(path=f"{username}/films", filters=LetterboxdFilters())
        movies = self.get_movies_from_path(watched_item, LetterboxdFilters())
        self.logger.debug(f"{username} has watched {len(movies)} films")
        return {movie['letterboxd_slug'] for movie in movies}

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