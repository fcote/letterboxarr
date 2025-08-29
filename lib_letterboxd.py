import re
import time
import json
import hashlib
import os
from typing import List, Dict, Optional
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

from lib_config import WatchListItem, create_letterboxd_cookie_filters, LetterboxdFilters


class LetterboxdScraper:
    """Scrapes Letterboxd for movie information from multiple sources"""

    def __init__(self, logger, cache_dir: str = 'data/cache', cache_ttl: int = 3600):
        self.logger = logger
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        })
        self.cache_dir = cache_dir
        self.cache_ttl = cache_ttl  # Cache TTL in seconds (default: 1 hour)
        
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

    def get_movies_from_path(self, watch_item: WatchListItem, global_filters: LetterboxdFilters,
                             limit: Optional[int] = None) -> List[Dict]:
        """Get movies from a specific Letterboxd path"""
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

        if cookie_filters:
            self.session.cookies.set('filmFilter', cookie_filters, domain='letterboxd.com')
        
        page = 1
        while True:
            page_url = urljoin(url, f"page/{page}/")
            self.logger.debug(f"Fetching page {page} from {watch_item.path}")

            try:
                response = self.session.get(page_url)
                response.raise_for_status()
            except requests.RequestException as e:
                self.logger.error(f"Error fetching page {page} from {watch_item.path}: {e}")
                break

            soup = BeautifulSoup(response.content, 'html.parser')

            # Find movie posters/links
            movie_items = soup.find_all('div', attrs={'data-component-class': 'globals.comps.LazyPoster'})

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
        self._save_to_cache(cache_file_path, movies)
        
        return movies

    def get_movie_tmdb_id(self, letterboxd_slug: str) -> Optional[int]:
        """Fetch TMDB ID for a movie from Letterboxd"""
        url = f"https://letterboxd.com/film/{letterboxd_slug}/"
        try:
            response = self.session.get(url)
            response.raise_for_status()
        except requests.RequestException as e:
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