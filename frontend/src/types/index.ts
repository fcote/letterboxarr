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
    username?: string;
    filters: {
      skip_documentaries: boolean;
      skip_short_films: boolean;
      skip_unreleased: boolean;
      skip_tv_shows: boolean;
    };
    watch: WatchItem[];
  };
}

export interface QualityProfile {
  id: number;
  name: string;
}

export interface SyncRun {
  id: number;
  started_at: number;
  finished_at: number | null;
  added: number;
  considered: number;
  error: string | null;
}

export interface SyncStatus {
  running: boolean;
  started_at: number | null;
  last: SyncRun | null;
}

export interface AddedMovie {
  movie_id: string;
  letterboxd_slug: string | null;
  title: string;
  year: number | null;
  tags: string[];
  added_at: number;
}

export interface DashboardSummary {
  watch_items: number;
  added_to_radarr: number;
  added_last_week: number;
  watched: number | null;
  recently_added: AddedMovie[];
  // Oldest stored listing, so how current the least current watch item is
  lists_refreshed_at: number | null;
  sync: {
    running: boolean;
    last: SyncRun | null;
  };
}

export interface WatchItem {
  id?: number;
  path: string;
  // What Letterboxd calls the list, null until a crawl has read it. Read-only:
  // it comes from the stored listing, not from anything the form sends back.
  name?: string | null;
  // When this list was last read from Letterboxd, null if it never has been
  last_refreshed?: number | null;
  tags: string[];
  auto_add?: boolean;
  filters?: {
    skip_documentaries: boolean;
    skip_short_films: boolean;
    skip_unreleased: boolean;
    skip_tv_shows: boolean;
  } | null;
}

export type MovieCategory = 'film' | 'short_film' | 'documentary' | 'tv_show' | 'unreleased';

export interface Movie {
  title: string;
  year: number;
  letterboxd_url: string;
  letterboxd_slug: string;
  processed: boolean;
  tmdb_id?: string;
  category?: MovieCategory;
  // null when no Letterboxd profile is configured, so watched status is unknown
  watched?: boolean | null;
}

export interface WatchItemMovies {
  watch_item: {
    path: string;
    // What Letterboxd calls the list, null until a crawl has read it
    name?: string | null;
    tags: string[];
  };
  movies: Movie[];
  // When this list was last read from Letterboxd, null if it never has been
  last_refreshed: number | null;
  total_count: number;
  category_counts?: Record<MovieCategory, number>;
  watched_count?: number | null;
}

export interface CategoryProgress {
  category: MovieCategory;
  total: number;
  // null when no Letterboxd profile is configured, so watched status is unknown
  watched: number | null;
}

export interface WatchItemProgress {
  item_id: number;
  // False until the list has been read from Letterboxd at least once, in which
  // case every count is zero and there is nothing to report yet
  read: boolean;
  total: number;
  watched: number | null;
  categories: CategoryProgress[];
}

export interface LetterboxdTestResult {
  valid: boolean;
  movie_count?: number;
  sample_movies?: { title: string; year: number }[];
  error?: string;
}