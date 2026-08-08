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
    // Country whose release date the upcoming page reports, spelled as
    // Letterboxd spells it. Empty means every film is dated by its earliest
    // release wherever that happens to be.
    country?: string;
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

export interface UpcomingRelease {
  title: string;
  // Never null: only films Letterboxd gives a year of this year or later can
  // have a release still ahead of them, which is what puts one on this page
  year: number;
  letterboxd_url: string;
  letterboxd_slug: string;
  // What kind of entry it is. Never 'unreleased', which everything here is by
  // definition: this says what the film itself is, not the state it is in.
  category: MovieCategory;
  // ISO date, always today or later: a release that has happened is not upcoming
  date: string;
  // What Letterboxd calls the release: Theatrical, Theatrical limited, Digital,
  // TV. Never a premiere or a physical release — the API leaves those out, as
  // neither says anything about when the film can be watched.
  release_type: string;
  release_country: string;
  // False when the date is the earliest anywhere because the configured country
  // has none announced yet, which the row footnotes
  in_preferred_country: boolean;
  processed: boolean;
  tags: string[];
  // The watch items the film came from, so a release can be traced back to the
  // list that asked for it
  watch_items: { id: number; path: string; name: string | null }[];
}

export interface UpcomingReleases {
  // Null when none is configured, in which case every date is the earliest
  // anywhere and the page says so once rather than on every row
  country: string | null;
  releases: UpcomingRelease[];
  total_count: number;
  // Recent films with nothing left to come — some never had a date announced,
  // some have had all of theirs — against those whose release table has not
  // been read yet: nothing ahead against nothing known
  undated_count: number;
  unread_count: number;
  candidate_count: number;
  // Watch items configured, and how many have a listing to draw candidates
  // from, so an empty page can say which of the two it is
  list_count: number;
  read_list_count: number;
  // The set is only as current as its oldest read
  last_read: number | null;
}

export interface UpcomingRefreshResult {
  read: number;
  failed: number;
  // Films whose turn did not come this round, read by the next one
  left: number;
  candidates: number;
}

export interface LetterboxdTestResult {
  valid: boolean;
  movie_count?: number;
  sample_movies?: { title: string; year: number }[];
  error?: string;
}