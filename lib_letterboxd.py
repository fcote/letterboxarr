import re
import time
from typing import List, Dict, Optional

import requests
from bs4 import BeautifulSoup


class LetterboxdScraper:
    """Scrapes Letterboxd watchlist for movie information"""

    def __init__(self, logger, username: str):
        self.logger = logger
        self.username = username
        self.base_url = f"https://letterboxd.com/{username}/watchlist"
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        })

    def get_watchlist(self) -> List[Dict]:
        """Fetch and parse the watchlist"""
        movies = []
        page = 1

        while True:
            url = f"{self.base_url}/page/{page}/"
            self.logger.info(f"Fetching Letterboxd page {page}")

            try:
                response = self.session.get(url)
                response.raise_for_status()
            except requests.RequestException as e:
                self.logger.error(f"Error fetching Letterboxd page: {e}")
                break

            soup = BeautifulSoup(response.content, 'html.parser')

            # Find movie posters/links
            movie_items = soup.find_all('div', attrs={'data-component-class': 'globals.comps.LazyPoster'})

            if not movie_items:
                self.logger.info(f"No more movies found on page {page}")
                break

            for item in movie_items:
                movie_data = self._extract_movie_data(item)
                if movie_data:
                    movies.append(movie_data)

            # Check if there's a next page
            next_page = soup.find('a', class_='next')
            if not next_page:
                break

            page += 1
            time.sleep(1)  # Be respectful to the server

        self.logger.info(f"Found {len(movies)} movies in watchlist")
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