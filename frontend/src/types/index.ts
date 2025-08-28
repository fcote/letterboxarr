export interface User {
  username: string;
}

export interface LoginCredentials {
  username: string;
  password: string;
}

export interface Token {
  access_token: string;
  token_type: string;
}

export interface Config {
  sync: {
    interval_minutes: number;
  };
  radarr: {
    url: string;
    api_key: string;
    quality_profile: number;
    root_folder: string;
    monitor_added: boolean;
    search_added: boolean;
  };
  letterboxd: {
    filters: {
      skip_documentaries: boolean;
      skip_short_films: boolean;
      skip_unreleased: boolean;
      skip_tv_shows: boolean;
    };
    watch: WatchItem[];
  };
}

export interface WatchItem {
  id?: number;
  path: string;
  tags: string[];
  auto_add?: boolean;
  filters?: {
    skip_documentaries: boolean;
    skip_short_films: boolean;
    skip_unreleased: boolean;
    skip_tv_shows: boolean;
  } | null;
}

export interface Movie {
  title: string;
  year: number;
  letterboxd_url: string;
  letterboxd_slug: string;
  processed: boolean;
  tmdb_id?: string;
}

export interface WatchItemMovies {
  watch_item: {
    path: string;
    tags: string[];
  };
  movies: Movie[];
  total_count: number;
}

export interface LetterboxdTestResult {
  valid: boolean;
  movie_count?: number;
  sample_movies?: { title: string; year: number }[];
  error?: string;
}