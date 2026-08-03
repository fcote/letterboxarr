"""SQLite storage for Letterboxarr

Replaces the JSON files that used to live under ./data: one file per crawl for
the scraper cache, and processed_movies.json for the movies added to Radarr.
A single database holds the crawled lists, the films watched on the Letterboxd
profile and the movies added to Radarr, all keyed by Letterboxd slug so they
can be read together.

Nothing here expires. What has been read from Letterboxd is the application's
data, not a cache of it: reads always answer from the database, and the
background refresher replaces a listing once it has a newer one in hand. That
way a slow, refused or rate-limited crawl degrades into serving yesterday's
list rather than serving nothing.

Both the API threadpool and the background threads use the same instance, so
every statement runs under a lock on a single connection.
"""
import json
import os
import sqlite3
import time
from glob import glob
from threading import RLock
from typing import Dict, List, Optional, Sequence, Set, Tuple

DATA_DIR = './data'
DB_PATH = os.path.join(DATA_DIR, 'letterboxarr.db')

# Storage the database replaces, imported then set aside on first run
LEGACY_PROCESSED_MOVIES = os.path.join(DATA_DIR, 'processed_movies.json')
LEGACY_CACHE_DIR = os.path.join(DATA_DIR, 'cache')

SCHEMA = """
CREATE TABLE IF NOT EXISTS films (
    slug  TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    year  INTEGER
);

-- One row per stored listing: a path read with a given set of filters.
-- fetched_at is when it was last read from Letterboxd, which is what the
-- refresher schedules on; it is not an expiry. name is what Letterboxd calls
-- the path ("IMDb Top 250", "Films directed by James Gray"), null until a crawl
-- has managed to read it.
CREATE TABLE IF NOT EXISTS lists (
    list_key   TEXT PRIMARY KEY,
    path       TEXT NOT NULL,
    name       TEXT,
    fetched_at REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_lists_path ON lists(path);

-- The films a listing contained, in the order Letterboxd returned them
CREATE TABLE IF NOT EXISTS list_films (
    list_key TEXT    NOT NULL REFERENCES lists(list_key) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    slug     TEXT    NOT NULL REFERENCES films(slug),
    PRIMARY KEY (list_key, position)
);

-- refreshed_at covers incremental refreshes, which only ever add films;
-- full_refreshed_at is the last whole re-read, the only thing that notices a
-- film the member has un-watched.
CREATE TABLE IF NOT EXISTS watched_profiles (
    username          TEXT PRIMARY KEY,
    refreshed_at      REAL NOT NULL,
    full_refreshed_at REAL
);

CREATE TABLE IF NOT EXISTS watched_films (
    username TEXT NOT NULL REFERENCES watched_profiles(username) ON DELETE CASCADE,
    slug     TEXT NOT NULL REFERENCES films(slug),
    PRIMARY KEY (username, slug)
);

-- Movies handed to Radarr. movie_id is the historical "<title>_<year>" key;
-- slug is null for rows imported from processed_movies.json.
CREATE TABLE IF NOT EXISTS added_movies (
    movie_id TEXT PRIMARY KEY,
    slug     TEXT,
    title    TEXT,
    year     INTEGER,
    tags     TEXT,
    added_at REAL
);

CREATE INDEX IF NOT EXISTS idx_added_movies_slug ON added_movies(slug);

-- One row per sync. finished_at is null while it runs, so an open row is what
-- "a sync is in progress" means; error holds why one stopped early.
CREATE TABLE IF NOT EXISTS sync_runs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at  REAL NOT NULL,
    finished_at REAL,
    added       INTEGER NOT NULL DEFAULT 0,
    considered  INTEGER NOT NULL DEFAULT 0,
    error       TEXT
);
"""

# Columns added after a database may already have been created, applied on open.
# Every watched set written before full_refreshed_at existed came from a whole
# re-read, so the existing timestamp is backfilled into it. Listings stored
# before lists.name existed have none to backfill: the next refresh reads it.
ADDED_COLUMNS = [
    ('watched_profiles', 'full_refreshed_at', 'REAL',
     "UPDATE watched_profiles SET full_refreshed_at = refreshed_at"),
    ('lists', 'name', 'TEXT', None),
]

# Tables and columns renamed when crawled listings stopped being a cache, applied
# on open before the schema is created so the rows survive the change of name.
RENAMED_TABLES = [
    ('crawls', 'lists'),
    ('crawl_films', 'list_films'),
]
RENAMED_COLUMNS = [
    ('lists', 'cache_key', 'list_key'),
    ('list_films', 'cache_key', 'list_key'),
]


class Database:
    """Crawled lists, watched films and added movies, in one SQLite file"""

    def __init__(self, logger, db_path: str = DB_PATH, watched_full_ttl: int = 86400):
        self.logger = logger
        self.db_path = db_path
        # Seconds before a watched profile has to be re-read in full rather than
        # topped up: only a whole re-read notices films that are no longer watched
        self.watched_full_ttl = watched_full_ttl
        self.lock = RLock()

        directory = os.path.dirname(db_path)
        if directory and not os.path.exists(directory):
            os.makedirs(directory)

        self.connection = sqlite3.connect(db_path, check_same_thread=False)
        self.connection.row_factory = sqlite3.Row
        self.connection.execute("PRAGMA journal_mode=WAL")
        self.connection.execute("PRAGMA foreign_keys=ON")
        self.connection.execute("PRAGMA busy_timeout=5000")

        self._rename_legacy_tables()
        with self.connection:
            self.connection.executescript(SCHEMA)

        self._add_missing_columns()
        self._migrate_legacy_storage()
        self._close_interrupted_sync_runs()

    def close(self) -> None:
        with self.lock:
            self.connection.close()

    # -- Stored lists -----------------------------------------------------

    def get_list(self, list_key: str) -> Optional[List[Dict]]:
        """Films of a stored listing, or None if it has never been read

        Whatever its age: a listing is only ever replaced by a newer read of the
        same listing, never dropped for being old.
        """
        with self.lock:
            stored = self.connection.execute(
                "SELECT 1 FROM lists WHERE list_key = ?", (list_key,)
            ).fetchone()

            if not stored:
                return None

            rows = self.connection.execute(
                """SELECT films.slug, films.title, films.year
                   FROM list_films
                   JOIN films ON films.slug = list_films.slug
                   WHERE list_films.list_key = ?
                   ORDER BY list_films.position""",
                (list_key,)
            ).fetchall()

        return [self._as_movie(row) for row in rows]

    def get_list_fetched_at(self, list_key: str) -> Optional[float]:
        """When a listing was last read from Letterboxd, None if it never was"""
        with self.lock:
            row = self.connection.execute(
                "SELECT fetched_at FROM lists WHERE list_key = ?", (list_key,)
            ).fetchone()

        return row['fetched_at'] if row else None

    def get_path_fetched_at(self, path: str) -> Optional[float]:
        """When a watch item was last read, taken from its oldest filter variant

        Resolving categories reads the same path under several filters, and the
        movies page only shows the whole set once every one of them is in, so
        the oldest is what "this list was last refreshed" means.
        """
        with self.lock:
            row = self.connection.execute(
                "SELECT MIN(fetched_at) AS oldest FROM lists WHERE path = ?", (path,)
            ).fetchone()

        return row['oldest'] if row else None

    def get_path_name(self, path: str) -> Optional[str]:
        """What Letterboxd calls a watch item, None if no crawl has read a name

        Every filter variant of a path is read off the same Letterboxd page and
        so carries the same name; the most recently read one answers.
        """
        with self.lock:
            row = self.connection.execute(
                """SELECT name FROM lists WHERE path = ? AND name IS NOT NULL
                   ORDER BY fetched_at DESC LIMIT 1""",
                (path,)
            ).fetchone()

        return row['name'] if row else None

    def save_list(self, list_key: str, path: str, movies: Sequence[Dict],
                  name: Optional[str] = None) -> None:
        """Store a listing just read from Letterboxd, replacing the previous one"""
        try:
            with self.lock, self.connection:
                # A crawl that could not read the name keeps the stored one,
                # rather than dropping a good name over a page that changed shape
                if name is None:
                    stored = self.connection.execute(
                        "SELECT name FROM lists WHERE list_key = ?", (list_key,)
                    ).fetchone()
                    name = stored['name'] if stored else None

                self._upsert_films(movies)
                self.connection.execute("DELETE FROM lists WHERE list_key = ?", (list_key,))
                self.connection.execute(
                    "INSERT INTO lists (list_key, path, name, fetched_at) VALUES (?, ?, ?, ?)",
                    (list_key, path, name, time.time())
                )
                self.connection.executemany(
                    "INSERT INTO list_films (list_key, position, slug) VALUES (?, ?, ?)",
                    [(list_key, position, movie['letterboxd_slug'])
                     for position, movie in enumerate(movies)]
                )
        except sqlite3.Error as e:
            self.logger.warning(f"Error storing the listing of {path}: {e}")

    def last_list_refresh(self) -> Optional[float]:
        """When the least recently read listing was read, None if there are none

        The whole set is only as current as its oldest member, so that is what
        the dashboard reports as the last refresh.
        """
        with self.lock:
            row = self.connection.execute("SELECT MIN(fetched_at) AS oldest FROM lists").fetchone()

        return row['oldest'] if row else None

    def prune_lists(self, paths: Sequence[str]) -> int:
        """Drop the listings of paths no longer watched, returning how many went

        Editing a watch item changes its path and leaves the old listings behind
        with nothing to refresh them; deleting one leaves all of them behind.
        Nothing is pruned when no path is watched at all: that is as much a
        configuration that failed to load as it is an empty watch list.
        """
        if not paths:
            return 0

        try:
            placeholders = ','.join('?' * len(paths))
            with self.lock, self.connection:
                cursor = self.connection.execute(
                    f"DELETE FROM lists WHERE path NOT IN ({placeholders})", tuple(paths)
                )
            return cursor.rowcount
        except sqlite3.Error as e:
            self.logger.warning(f"Error pruning listings that are no longer watched: {e}")
            return 0

    # -- Watched films ----------------------------------------------------

    def get_watched_slugs(self, username: str) -> Optional[Set[str]]:
        """Slugs watched by a profile, or None if it has never been read

        Whatever its age, like the stored listings: the refresher is what brings
        it up to date, and a profile read yesterday is a far better answer than
        no profile at all.
        """
        with self.lock:
            profile = self.connection.execute(
                "SELECT 1 FROM watched_profiles WHERE username = ?", (username,)
            ).fetchone()

            if not profile:
                return None

            rows = self.connection.execute(
                "SELECT slug FROM watched_films WHERE username = ?", (username,)
            ).fetchall()

        return {row['slug'] for row in rows}

    def get_watched_refreshed_at(self, username: str) -> Optional[float]:
        """When the profile was last checked for new films, None if never"""
        with self.lock:
            row = self.connection.execute(
                "SELECT refreshed_at FROM watched_profiles WHERE username = ?", (username,)
            ).fetchone()

        return row['refreshed_at'] if row else None

    def needs_full_watched_refresh(self, username: str) -> bool:
        """Whether topping the profile up is no longer enough and it must be re-read

        A profile that has never been read in full, or not for longer than the
        full TTL, is due: incremental refreshes only add films, so nothing else
        ever drops a film the member has un-watched.
        """
        with self.lock:
            profile = self.connection.execute(
                "SELECT full_refreshed_at FROM watched_profiles WHERE username = ?", (username,)
            ).fetchone()

        if not profile or profile['full_refreshed_at'] is None:
            return True
        return time.time() - profile['full_refreshed_at'] >= self.watched_full_ttl

    def save_watched_films(self, username: str, movies: Sequence[Dict]) -> None:
        """Replace the watched films of a profile with a whole re-read"""
        now = time.time()
        try:
            with self.lock, self.connection:
                self._upsert_films(movies)
                self.connection.execute(
                    "DELETE FROM watched_profiles WHERE username = ?", (username,)
                )
                self.connection.execute(
                    """INSERT INTO watched_profiles (username, refreshed_at, full_refreshed_at)
                       VALUES (?, ?, ?)""",
                    (username, now, now)
                )
                self.connection.executemany(
                    "INSERT OR IGNORE INTO watched_films (username, slug) VALUES (?, ?)",
                    [(username, movie['letterboxd_slug']) for movie in movies]
                )
        except sqlite3.Error as e:
            self.logger.warning(f"Error saving watched films for {username}: {e}")

    def add_watched_films(self, username: str, movies: Sequence[Dict]) -> None:
        """Add newly watched films to a profile and mark it refreshed

        Called with no movies when nothing new turned up, which still counts as a
        refresh: the profile was checked and is up to date.
        """
        try:
            with self.lock, self.connection:
                self._upsert_films(movies)
                self.connection.executemany(
                    "INSERT OR IGNORE INTO watched_films (username, slug) VALUES (?, ?)",
                    [(username, movie['letterboxd_slug']) for movie in movies]
                )
                self.connection.execute(
                    "UPDATE watched_profiles SET refreshed_at = ? WHERE username = ?",
                    (time.time(), username)
                )
        except sqlite3.Error as e:
            self.logger.warning(f"Error adding watched films for {username}: {e}")

    # -- Added movies -----------------------------------------------------

    def get_added_keys(self) -> Tuple[Set[str], Set[str]]:
        """Every key a movie added to Radarr can be recognised by: ids and slugs"""
        with self.lock:
            rows = self.connection.execute("SELECT movie_id, slug FROM added_movies").fetchall()

        return (
            {row['movie_id'] for row in rows},
            {row['slug'] for row in rows if row['slug']}
        )

    def get_added_ids(self) -> Set[str]:
        """The "<title>_<year>" ids of the movies added to Radarr"""
        return self.get_added_keys()[0]

    def add_movie(self, movie_id: str, slug: Optional[str] = None, title: Optional[str] = None,
                  year: Optional[int] = None, tags: Optional[Sequence[str]] = None) -> None:
        """Record a movie as handed to Radarr"""
        try:
            with self.lock, self.connection:
                self.connection.execute(
                    """INSERT INTO added_movies (movie_id, slug, title, year, tags, added_at)
                       VALUES (?, ?, ?, ?, ?, ?)
                       ON CONFLICT(movie_id) DO UPDATE SET
                           slug     = COALESCE(excluded.slug, added_movies.slug),
                           title    = COALESCE(excluded.title, added_movies.title),
                           year     = COALESCE(excluded.year, added_movies.year),
                           tags     = COALESCE(excluded.tags, added_movies.tags),
                           added_at = COALESCE(added_movies.added_at, excluded.added_at)""",
                    (movie_id, slug, title, year,
                     json.dumps(list(tags)) if tags else None, time.time())
                )
        except sqlite3.Error as e:
            self.logger.error(f"Error recording added movie {movie_id}: {e}")

    # -- Sync runs --------------------------------------------------------

    def start_sync_run(self) -> Optional[int]:
        """Open a sync run and return its id"""
        try:
            with self.lock, self.connection:
                cursor = self.connection.execute(
                    "INSERT INTO sync_runs (started_at) VALUES (?)", (time.time(),)
                )
            return cursor.lastrowid
        except sqlite3.Error as e:
            self.logger.warning(f"Error recording the start of a sync: {e}")
            return None

    def finish_sync_run(self, run_id: Optional[int], added: int = 0, considered: int = 0,
                        error: Optional[str] = None) -> None:
        """Close a sync run with what it did"""
        if run_id is None:
            return

        try:
            with self.lock, self.connection:
                self.connection.execute(
                    """UPDATE sync_runs
                       SET finished_at = ?, added = ?, considered = ?, error = ?
                       WHERE id = ?""",
                    (time.time(), added, considered, error, run_id)
                )
        except sqlite3.Error as e:
            self.logger.warning(f"Error recording the end of a sync: {e}")

    def get_running_sync_run(self) -> Optional[Dict]:
        """The sync in progress, if there is one"""
        with self.lock:
            row = self.connection.execute(
                "SELECT * FROM sync_runs WHERE finished_at IS NULL ORDER BY started_at DESC LIMIT 1"
            ).fetchone()

        return dict(row) if row else None

    def get_last_sync_run(self) -> Optional[Dict]:
        """The most recent finished sync"""
        with self.lock:
            row = self.connection.execute(
                """SELECT * FROM sync_runs WHERE finished_at IS NOT NULL
                   ORDER BY finished_at DESC LIMIT 1"""
            ).fetchone()

        return dict(row) if row else None

    # -- Dashboard counts -------------------------------------------------

    def count_added(self, since: Optional[float] = None) -> int:
        """How many movies have been handed to Radarr, optionally since a time

        Rows imported from processed_movies.json have no added_at, so they only
        ever count towards the total, never towards a window.
        """
        with self.lock:
            if since is None:
                row = self.connection.execute("SELECT COUNT(*) AS n FROM added_movies").fetchone()
            else:
                row = self.connection.execute(
                    "SELECT COUNT(*) AS n FROM added_movies WHERE added_at >= ?", (since,)
                ).fetchone()

        return row['n']

    def count_watched(self, username: str) -> Optional[int]:
        """How many films the profile has watched, None if it has never been read"""
        with self.lock:
            profile = self.connection.execute(
                "SELECT 1 FROM watched_profiles WHERE username = ?", (username,)
            ).fetchone()
            if not profile:
                return None

            row = self.connection.execute(
                "SELECT COUNT(*) AS n FROM watched_films WHERE username = ?", (username,)
            ).fetchone()

        return row['n']

    def get_recently_added(self, limit: int = 8) -> List[Dict]:
        """The most recently added movies, newest first

        Rows without an added_at were imported from the old JSON file and have
        no known date, so they are left out rather than dated arbitrarily.
        """
        with self.lock:
            rows = self.connection.execute(
                """SELECT movie_id, slug, title, year, tags, added_at FROM added_movies
                   WHERE added_at IS NOT NULL ORDER BY added_at DESC LIMIT ?""",
                (limit,)
            ).fetchall()

        return [
            {
                'movie_id': row['movie_id'],
                'letterboxd_slug': row['slug'],
                'title': row['title'] or row['movie_id'],
                'year': row['year'],
                'tags': json.loads(row['tags']) if row['tags'] else [],
                'added_at': row['added_at']
            }
            for row in rows
        ]

    # -- Internals --------------------------------------------------------

    def _close_interrupted_sync_runs(self) -> None:
        """Close runs left open by a process that stopped mid-sync

        Nothing can still be running when the database is opened, so an open row
        at this point is a sync that was killed, not one in progress.
        """
        try:
            with self.lock, self.connection:
                cursor = self.connection.execute(
                    """UPDATE sync_runs SET finished_at = started_at, error = ?
                       WHERE finished_at IS NULL""",
                    ('Interrupted before it finished',)
                )
            if cursor.rowcount:
                self.logger.info(f"Marked {cursor.rowcount} unfinished sync run(s) as interrupted")
        except sqlite3.Error as e:
            self.logger.warning(f"Error closing interrupted sync runs: {e}")

    def _upsert_films(self, movies: Sequence[Dict]) -> None:
        """Add films to the catalogue, keeping any year we already knew"""
        self.connection.executemany(
            """INSERT INTO films (slug, title, year) VALUES (?, ?, ?)
               ON CONFLICT(slug) DO UPDATE SET
                   title = excluded.title,
                   year  = COALESCE(excluded.year, films.year)""",
            [(movie['letterboxd_slug'], movie['title'], movie.get('year')) for movie in movies]
        )

    @staticmethod
    def _as_movie(row: sqlite3.Row) -> Dict:
        """Shape a film row like the scraper's own output"""
        return {
            'title': row['title'],
            'year': row['year'],
            'letterboxd_slug': row['slug']
        }

    def _rename_legacy_tables(self) -> None:
        """Apply the renames of tables and columns that kept their contents

        Runs before the schema is created: CREATE TABLE IF NOT EXISTS would
        otherwise make an empty table under the new name and leave the rows
        stranded under the old one.
        """
        existing = {
            row['name']
            for row in self.connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
        }

        for old, new in RENAMED_TABLES:
            if old not in existing or new in existing:
                continue
            try:
                with self.lock, self.connection:
                    self.connection.execute(f"ALTER TABLE {old} RENAME TO {new}")
            except sqlite3.Error as e:
                self.logger.error(f"Error renaming {old} to {new} in {self.db_path}: {e}")
                continue
            self.logger.info(f"Renamed {old} to {new} in {self.db_path}")

        for table, old, new in RENAMED_COLUMNS:
            columns = {
                row['name'] for row in self.connection.execute(f"PRAGMA table_info({table})")
            }
            if old not in columns or new in columns:
                continue
            try:
                with self.lock, self.connection:
                    self.connection.execute(f"ALTER TABLE {table} RENAME COLUMN {old} TO {new}")
            except sqlite3.Error as e:
                self.logger.error(f"Error renaming {table}.{old} to {new} in {self.db_path}: {e}")
                continue
            self.logger.info(f"Renamed {table}.{old} to {table}.{new} in {self.db_path}")

        if any(old in existing for old, _ in RENAMED_TABLES):
            self._drop_listings_of_the_previous_scheme()

    def _drop_listings_of_the_previous_scheme(self) -> None:
        """Empty the listings carried over from the cache the database used to be

        Their keys were derived from a crawl limit that no longer exists, so
        nothing reads them and nothing refreshes them: they would sit there for
        good, and dragging the last-refresh dates back with them. The first
        refresh after the upgrade reads them all again.
        """
        try:
            with self.lock, self.connection:
                cursor = self.connection.execute("DELETE FROM lists")
        except sqlite3.Error as e:
            self.logger.error(f"Error dropping the listings of the previous scheme: {e}")
            return

        if cursor.rowcount:
            self.logger.info(
                f"Dropped {cursor.rowcount} listing(s) stored under the previous scheme, "
                f"they will be read again on the next refresh"
            )

    def _add_missing_columns(self) -> None:
        """Add columns introduced after a database on disk may have been created"""
        for table, column, column_type, backfill in ADDED_COLUMNS:
            existing = {
                row['name']
                for row in self.connection.execute(f"PRAGMA table_info({table})")
            }
            if column in existing:
                continue

            try:
                with self.lock, self.connection:
                    self.connection.execute(
                        f"ALTER TABLE {table} ADD COLUMN {column} {column_type}"
                    )
                    if backfill:
                        self.connection.execute(backfill)
            except sqlite3.Error as e:
                self.logger.error(f"Error adding {table}.{column} to {self.db_path}: {e}")
                continue

            self.logger.info(f"Added {table}.{column} to {self.db_path}")

    def _migrate_legacy_storage(self) -> None:
        """Import processed_movies.json and drop the crawl cache files

        Runs once: the JSON file is renamed afterwards so a restart does not
        resurrect entries deleted from the database. The crawl files are not
        worth importing, the first refresh replaces them anyway.
        """
        self._import_legacy_processed_movies()
        self._remove_legacy_cache_files()

    def _import_legacy_processed_movies(self) -> None:
        if not os.path.exists(LEGACY_PROCESSED_MOVIES):
            return

        try:
            with open(LEGACY_PROCESSED_MOVIES, 'r') as f:
                movie_ids = json.load(f)
        except (json.JSONDecodeError, IOError, OSError) as e:
            self.logger.error(f"Error reading {LEGACY_PROCESSED_MOVIES}, not importing: {e}")
            return

        try:
            with self.lock, self.connection:
                # added_at stays null: when these were added is not recorded
                self.connection.executemany(
                    """INSERT INTO added_movies (movie_id, title, year)
                       VALUES (?, ?, ?) ON CONFLICT(movie_id) DO NOTHING""",
                    [(movie_id, *self._split_movie_id(movie_id)) for movie_id in movie_ids]
                )
        except sqlite3.Error as e:
            self.logger.error(f"Error importing {LEGACY_PROCESSED_MOVIES}: {e}")
            return

        migrated_path = f"{LEGACY_PROCESSED_MOVIES}.migrated"
        try:
            os.replace(LEGACY_PROCESSED_MOVIES, migrated_path)
        except OSError as e:
            self.logger.error(f"Imported {LEGACY_PROCESSED_MOVIES} but could not rename it: {e}")
            return

        self.logger.info(
            f"Imported {len(movie_ids)} added movies from {LEGACY_PROCESSED_MOVIES} "
            f"into {self.db_path} (kept as {migrated_path})"
        )

    def _remove_legacy_cache_files(self) -> None:
        if not os.path.isdir(LEGACY_CACHE_DIR):
            return

        cache_files = glob(os.path.join(LEGACY_CACHE_DIR, 'movies_*.json'))
        for cache_file in cache_files:
            try:
                os.remove(cache_file)
            except OSError as e:
                self.logger.warning(f"Could not remove stale cache file {cache_file}: {e}")

        try:
            os.rmdir(LEGACY_CACHE_DIR)
        except OSError:
            # Something else is in there, leave it alone
            pass

        if cache_files:
            self.logger.info(f"Removed {len(cache_files)} cache files superseded by {self.db_path}")

    @staticmethod
    def _split_movie_id(movie_id: str) -> Tuple[str, Optional[int]]:
        """Recover the title and year a "<title>_<year>" id was built from"""
        title, _, year = movie_id.rpartition('_')
        if title and len(year) == 4 and year.isdigit():
            return title, int(year)
        return movie_id, None


_database: Optional[Database] = None


def get_database(logger) -> Database:
    """The database shared by the whole process

    Reloading the configuration rebuilds the sync instance, so the connection
    is kept here rather than owned by it: one file, one connection, opened once.
    """
    global _database
    if _database is None:
        _database = Database(logger)
    return _database
