from typing import Optional, Dict, List

import requests


class MultipleMatchesError(ValueError):
    pass


class RadarrAPI:
    """Interface with Radarr API"""

    def __init__(self, logger, url: str, api_key: str, quality_profile: int,
                 root_folder: str, monitor_movies: bool = True, search_movies: bool = True):
        self.logger = logger
        self.base_url = url.rstrip('/')
        self.api_key = api_key
        self.quality_profile = quality_profile
        self.root_folder = root_folder
        self.monitor_movies = monitor_movies
        self.search_movies = search_movies
        self.session = requests.Session()
        self.session.headers.update({
            'X-Api-Key': api_key,
            'Content-Type': 'application/json'
        })

    def search_movie(self, title: str, year: Optional[int] = None, tmdb_id: Optional[int] = None) -> Optional[Dict]:
        """Search for a movie in Radarr/TMDB"""
        if tmdb_id:
            search_term = f"tmdb:{tmdb_id}"
        else:
            search_term = f"{title}"
            if year:
                search_term += f" {year}"

        try:
            response = self.session.get(
                f"{self.base_url}/api/v3/movie/lookup",
                params={'term': search_term}
            )
            response.raise_for_status()

            results = response.json()
            if not results:
                self.logger.warning(f"No results found for: {search_term}")
                return None

            matches = []
            for movie in results:
                # Exact title and year match
                if year and movie.get('year') == year:
                    if movie.get('title', '').lower() == title.lower():
                        matches.append(movie)

            if len(matches) == 1:
                return matches[0]

            raise MultipleMatchesError(f"Multiple matches found for {search_term}")

        except requests.RequestException as e:
            self.logger.error(f"Error searching for movie {title}: {e}")
            return None

    def get_existing_movies(self) -> List[Dict]:
        """Get all movies currently in Radarr"""
        try:
            response = self.session.get(f"{self.base_url}/api/v3/movie")
            response.raise_for_status()
            return response.json()
        except requests.RequestException as e:
            self.logger.error(f"Error fetching existing movies: {e}")
            return []

    def add_movie(self, movie_data: Dict) -> bool:
        """Add a movie to Radarr"""
        # Check if movie already exists
        existing = self.get_existing_movies()
        tmdb_id = movie_data.get('tmdbId')

        if any(m.get('tmdbId') == tmdb_id for m in existing):
            self.logger.info(f"Movie already in Radarr: {movie_data.get('title')}")
            return False

        # Prepare the movie data for adding
        add_data = {
            'title': movie_data['title'],
            'tmdbId': movie_data['tmdbId'],
            'year': movie_data.get('year'),
            'qualityProfileId': self.quality_profile,
            'rootFolderPath': self.root_folder,
            'monitored': self.monitor_movies,
            'addOptions': {
                'searchForMovie': self.search_movies
            }
        }

        # Include additional data if available
        if 'imdbId' in movie_data:
            add_data['imdbId'] = movie_data['imdbId']
        if 'images' in movie_data:
            add_data['images'] = movie_data['images']

        try:
            response = self.session.post(
                f"{self.base_url}/api/v3/movie",
                json=add_data
            )
            response.raise_for_status()
            self.logger.info(f"Successfully added: {movie_data['title']}")
            return True
        except requests.RequestException as e:
            self.logger.error(f"Error adding movie {movie_data['title']}: {e}")
            if hasattr(e, 'response') and e.response:
                self.logger.error(f"Response: {e.response.text}")
            return False

    def get_quality_profiles(self) -> List[Dict]:
        """Get available quality profiles"""
        try:
            response = self.session.get(f"{self.base_url}/api/v3/qualityprofile")
            response.raise_for_status()
            return response.json()
        except requests.RequestException as e:
            self.logger.error(f"Error fetching quality profiles: {e}")
            return []

    def get_root_folders(self) -> List[Dict]:
        """Get available root folders"""
        try:
            response = self.session.get(f"{self.base_url}/api/v3/rootfolder")
            response.raise_for_status()
            return response.json()
        except requests.RequestException as e:
            self.logger.error(f"Error fetching root folders: {e}")
            return []