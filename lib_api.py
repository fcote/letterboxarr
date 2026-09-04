import asyncio
import logging
import math
import os
import re
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Dict, List, NamedTuple, Optional

import yaml
from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.staticfiles import StaticFiles
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel

from lib_config import Config, ConfigLoader, LetterboxdFilters, WatchListItem
from lib_letterboxd import (
    CATEGORY_DOCUMENTARY,
    CATEGORY_FILM,
    CATEGORY_SHORT_FILM,
    CATEGORY_TV_SHOW,
    CATEGORY_UNRELEASED,
    ListingUnavailable,
)
from lib_sync import LetterboxarrSync, LetterboxarrThread, movie_key

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Paths
CONFIG_PATH = "config.yml"

# Categories reported for each movie, in display order
MOVIE_CATEGORIES = [
    CATEGORY_FILM,
    CATEGORY_SHORT_FILM,
    CATEGORY_DOCUMENTARY,
    CATEGORY_TV_SHOW,
    CATEGORY_UNRELEASED
]

# Security
SECRET_KEY = os.getenv("SECRET_KEY", "your-secret-key-change-this-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_DAYS = 15

# Default admin credentials (should be changed in production)
DEFAULT_USERNAME = os.getenv("ADMIN_USERNAME", "admin")
DEFAULT_PASSWORD = os.getenv("ADMIN_PASSWORD", "admin")

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
security = HTTPBearer()

# Pydantic models
class Token(BaseModel):
    access_token: str
    token_type: str

class LoginRequest(BaseModel):
    username: str
    password: str

class WatchItemCreate(BaseModel):
    path: str
    tags: List[str] = []
    filters: Optional[Dict] = {}
    auto_add: bool = True

class WatchItemUpdate(BaseModel):
    path: Optional[str] = None
    tags: Optional[List[str]] = None
    filters: Optional[Dict] = None
    auto_add: Optional[bool] = None

class MovieAddRequest(BaseModel):
    title: str
    year: int
    letterboxd_slug: str
    tags: List[str] = []

class LetterboxarrAPIContext:
    def __init__(self):
        self.app = FastAPI(title="Letterboxarr", version="1.0.0")
        self.current_config: Optional[Config] = None
        self.sync_instance: Optional[LetterboxarrSync] = None
        self.sync_thread: Optional[LetterboxarrThread] = None

        # Add CORS middleware
        self.app.add_middleware(
            CORSMiddleware,
            allow_origins=["*"],
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

        # Load configuration on startup
        try:
            if Path(CONFIG_PATH).exists():
                self.load_config()
            else:
                logger.warning("config.yml not found")
        except Exception as e:
            logger.error(f"Error loading configuration: {e}")

    # Authentication functions
    @staticmethod
    def verify_password(plain_password: str, hashed_password: str):
        return pwd_context.verify(plain_password, hashed_password)

    @staticmethod
    def get_password_hash(password: str):
        return pwd_context.hash(password)

    @staticmethod
    def authenticate_user(username: str, password: str):
        if username == DEFAULT_USERNAME and password == DEFAULT_PASSWORD:
            return {"username": username}
        return False

    @staticmethod
    def create_access_token(data: dict, expires_delta: timedelta):
        to_encode = data.copy()
        expire = datetime.utcnow() + expires_delta
        to_encode.update({"exp": expire})
        encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
        return encoded_jwt

    @staticmethod
    async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
        credentials_exception = HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
        try:
            payload = jwt.decode(credentials.credentials, SECRET_KEY, algorithms=[ALGORITHM])
            username: str = payload.get("sub")
            if username is None:
                raise credentials_exception
        except JWTError as e:
            raise credentials_exception from e

        if username != DEFAULT_USERNAME:
            raise credentials_exception

        return {"username": username}

    def restart_sync_thread(self):
        """Point the sync round at the configuration just loaded

        It carries the interval from it, and the refresher it runs holds the
        watch list it walks, so saving the configuration replaces the thread
        rather than telling the running one about the change.
        """
        if self.sync_thread:
            self.sync_thread.stop()
        self.sync_thread = LetterboxarrThread(logger, self.sync_instance)
        self.sync_thread.start()

    def load_config(self):
        self.current_config = ConfigLoader.load_config(CONFIG_PATH)
        self.sync_instance = LetterboxarrSync(logger, self.current_config)
        self.restart_sync_thread()
        logger.info("Configuration loaded successfully")

# Global variables
context: LetterboxarrAPIContext = LetterboxarrAPIContext()

# Routes
@context.app.post("/api/auth/login", response_model=Token)
async def login(login_request: LoginRequest):
    user = context.authenticate_user(login_request.username, login_request.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token_expires = timedelta(days=ACCESS_TOKEN_EXPIRE_DAYS)
    access_token = context.create_access_token(
        data={"sub": user["username"]},
        expires_delta=access_token_expires
    )
    # "bearer" names the OAuth token type; it is not a hard-coded credential.
    return {"access_token": access_token, "token_type": "bearer"}  # nosec B105

@context.app.get("/api/config")
async def get_config(current_user: dict = Depends(context.get_current_user)):
    if not context.current_config:
        raise HTTPException(status_code=404, detail="Configuration not found")

    # Convert config to dict for JSON response
    return context.current_config.to_dict()

@context.app.put("/api/config")
async def update_config(config_update: Config, current_user: dict = Depends(context.get_current_user)):
    if not context.current_config:
        raise HTTPException(status_code=404, detail="Configuration not found")

    try:
        # Save updated config
        with open(CONFIG_PATH, 'w') as f:
            yaml.dump(config_update.to_dict(), f, default_flow_style=False)

        # Reload configuration
        context.load_config()

        return {"message": "Configuration updated successfully"}

    except Exception as e:
        logger.error(f"Error updating configuration: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to update configuration: {str(e)}") from e

# How many watch items one page of the watch items tab holds. The page appends
# as it scrolls, so this is how much arrives at a time rather than a limit on
# anything, and it is capped below so a caller cannot ask for the whole set back
# by way of a very large number.
WATCH_ITEMS_PAGE_SIZE = 100
WATCH_ITEMS_MAX_PAGE_SIZE = 500

# Sorts that read a list's stored listing — how much of it is watched, how big
# it is, how Letterboxd rates it. Naming them is what lets every other sort skip
# reading two hundred listings to answer with a hundred: the filters never need
# a listing, and neither do the sorts left out of this set, so those can be
# ordered and cut down to a page before any listing is read at all.
PROGRESS_SORTS = {'least-watched', 'most-watched', 'largest',
                  'best-rated', 'best-weighted', 'most-popular'}

# The scheme and any trailing slashes come off an address, and the /share/
# <secret> a share link lands on comes off after them: it is how the page was
# reached rather than which list it is, and ordering by it would file a list
# under a secret nobody can read. Kept in step with watchItemAddress in
# frontend/src/utils/letterboxd.ts, which is what the row itself shows.
ADDRESS_LINK = re.compile(r'^(?:https?://)?(?:www\.)?(?:letterboxd\.com|boxd\.it)(/|$)', re.I)
ADDRESS_SHARE = re.compile(r'(/list/[^/]+)/share/[^/]+$', re.I)


def watch_item_address(path: str, url: Optional[str]) -> str:
    """How a watch item is addressed, host and all, as the row shows it

    Falls back to the path as configured until a crawl has said where it leads,
    which for a share link means the boxd.it code itself.
    """
    address = url or (path if ADDRESS_LINK.match(path.strip()) else f"letterboxd.com/{path}")
    address = re.sub(r'^https?://', '', address, flags=re.I).rstrip('/')
    return ADDRESS_SHARE.sub(r'\1', address)


def unknown_last(value: Optional[float], descending: bool) -> tuple:
    """Sort key putting the lists a column says nothing about at the end

    Whichever way the column runs. Paired with a reversed sort the sign on the
    value flips with the direction while the flag marking it unknown does not,
    which is what keeps those rows last rather than sending them to the front
    the moment the order is turned round. The Python twin of
    compareWithUnknownLast in frontend/src/pages/WatchItemsPage.tsx.
    """
    if value is None:
        return (1, 0.0)
    return (0, -value if descending else value)



def sort_watch_items(rows: List[Dict], sort: str) -> List[Dict]:
    """The watch items in the order the page asked for

    The six sorts reading a listing expect one attached to every row already;
    the three that do not are answered before any listing has been read. An
    order nobody recognises leaves the rows configured, which is what the page
    opens on.

    Every one of these is stable, so lists that tie stay in configured order
    rather than shuffling between two requests for the same page.
    """
    def progress_of(row: Dict) -> Dict:
        return row.get("progress") or {}

    def watched_share(row: Dict) -> Optional[float]:
        """How much of a list is watched, None when that is not known

        Not read yet, no Letterboxd profile configured, or nothing in the list
        to watch — the same three the row itself greys out for.
        """
        state = progress_of(row)
        if not state.get("read") or state.get("watched") is None or not state.get("total"):
            return None
        return state["watched"] / state["total"]

    def rating(row: Dict, field: str) -> Optional[float]:
        """One of the rating figures, None until some film of the list is rated"""
        ratings = progress_of(row).get("ratings") or {}
        return ratings.get(field) if ratings.get("rating") is not None else None

    if sort == 'path':
        # On the address shown rather than the path configured: ordering a share
        # link by its boxd.it code puts it nowhere anyone would look
        return sorted(rows, key=lambda row: watch_item_address(row["path"], row.get("url")).lower())
    if sort == 'stalest':
        # Never read is as out of date as a list gets, so those lead
        return sorted(rows, key=lambda row: row.get("last_refreshed") or 0)
    if sort == 'least-watched':
        return sorted(rows, key=lambda row: unknown_last(watched_share(row), descending=False))
    if sort == 'most-watched':
        return sorted(rows, key=lambda row: unknown_last(watched_share(row), descending=True))
    if sort == 'largest':
        return sorted(rows, key=lambda row: unknown_last(progress_of(row).get("total"), descending=True))
    if sort == 'best-rated':
        return sorted(rows, key=lambda row: unknown_last(rating(row, "rating"), descending=True))
    if sort == 'best-weighted':
        return sorted(rows, key=lambda row: unknown_last(rating(row, "weighted_rating"), descending=True))
    if sort == 'most-popular':
        return sorted(rows, key=lambda row: unknown_last(rating(row, "popularity"), descending=True))

    return rows


# Declared sync: it reads the stored name and refresh date of every watch item,
# and on the sorts that need one, the stored listing too — which on a long watch
# list is a lot of small queries to run on the event loop.
@context.app.get("/api/watch-items")
def get_watch_items(
    offset: int = Query(0, ge=0),
    limit: int = Query(WATCH_ITEMS_PAGE_SIZE, ge=1, le=WATCH_ITEMS_MAX_PAGE_SIZE),
    search: str = "",
    auto_add: str = "all",
    tags: str = "",
    sort: str = "config",
    current_user: dict = Depends(context.get_current_user)
):
    """One page of the watch items, searched, filtered and ordered here

    The page appends as it scrolls, so it asks for a hundred at a time and the
    work of deciding which hundred is done here rather than in the browser. It
    has to be: six of the sorts read how much of a list is watched, how big it
    is, or how Letterboxd rates it, and a page ordered in the browser could only
    order the rows it already had — the first hundred by configured order, which
    is not the first hundred by rating.

    Each row carries its own progress for the same reason. Sending the page and
    its numbers separately would mean either shipping every list's numbers with
    every page or ordering a page against numbers it does not hold.

    Filters never need a listing and three of the sorts do not either, so those
    are cut down to a page before a single listing is read: the configured order
    the page opens on reads a hundred rather than every one of them. Only a sort
    that asks about the listings pays for all of them.
    """
    if not context.current_config:
        raise HTTPException(status_code=404, detail="Configuration not found")

    try:
        db = context.sync_instance.db if context.sync_instance else None
        configured = context.current_config.letterboxd.watch

        rows = [
            {
                "id": i,
                **item.to_dict(),
                # What Letterboxd calls the list and when it was last read: the
                # watch items page searches on the one and sorts on the other
                "name": db.get_path_name(item.path) if db else None,
                "last_refreshed": db.get_path_fetched_at(item.path) if db else None,
                # Where the path actually leads, so a row configured with a share
                # link shows the list it stands for rather than the boxd.it code
                "url": db.get_path_url(item.path) if db else None,
            }
            for i, item in enumerate(configured)
        ]

        # Counted over every item rather than the matched ones, so the choices on
        # the tag filter do not shift about as the filters change. The browser
        # worked these out itself until it stopped holding every item.
        tag_counts: Dict[str, int] = {}
        for row in rows:
            for tag in row.get("tags") or []:
                tag_counts[tag] = tag_counts.get(tag, 0) + 1
        tag_options = sorted(
            ({"tag": tag, "count": count} for tag, count in tag_counts.items() if count > 1),
            key=lambda option: (-option["count"], option["tag"])
        )

        query = search.strip().lower()
        wanted_tags = {tag for tag in (tag.strip() for tag in tags.split(',')) if tag}

        def matches(row: Dict) -> bool:
            if auto_add == 'on' and row.get("auto_add") is False:
                return False
            if auto_add == 'off' and row.get("auto_add") is not False:
                return False

            # Any one of the picked tags is enough, so picking more widens the result
            if wanted_tags and not wanted_tags.intersection(row.get("tags") or []):
                return False

            if not query:
                return True
            return (
                query in row["path"].lower()
                or query in watch_item_address(row["path"], row.get("url")).lower()
                or query in (row.get("name") or "").lower()
                or any(query in tag.lower() for tag in row.get("tags") or [])
            )

        matched = [row for row in rows if matches(row)]

        # A listing per row, and only for the rows that end up needing one
        def attach_progress(selection: List[Dict], watched_slugs, ratings) -> None:
            for row in selection:
                row["progress"] = watch_item_progress(
                    row["id"], get_stored_categorised_movies(row["id"]), watched_slugs, ratings
                )

        if sort in PROGRESS_SORTS:
            watched_slugs = get_watched_slugs()
            film_ratings = get_film_ratings()
            attach_progress(matched, watched_slugs, film_ratings)
            page = sort_watch_items(matched, sort)[offset:offset + limit]
        else:
            page = sort_watch_items(matched, sort)[offset:offset + limit]
            attach_progress(page, get_watched_slugs(), get_film_ratings())

        return {
            "items": page,
            "offset": offset,
            "limit": limit,
            # After the filters, and configured in total: the row above the list
            # reads "137 of 216" from these
            "matched": len(matched),
            "total": len(rows),
            "tag_options": tag_options,
        }

    except Exception as e:
        logger.error(f"Error getting the watch items: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get watch items: {str(e)}") from e

@context.app.post("/api/watch-items")
async def create_watch_item(item: WatchItemCreate, current_user: dict = Depends(context.get_current_user)):
    if not context.current_config:
        raise HTTPException(status_code=404, detail="Configuration not found")

    try:
        watch_item = WatchListItem(
            path=item.path,
            tags=item.tags,
            auto_add=item.auto_add
        )

        if item.filters:
            watch_item.filters = LetterboxdFilters(**item.filters)

        context.current_config.letterboxd.watch.append(watch_item)

        # Save updated config
        with open(CONFIG_PATH, 'w') as f:
            yaml.dump(context.current_config.to_dict(), f, default_flow_style=False)

        # Reload configuration
        context.load_config()

        return {"message": "Watch item created successfully"}

    except Exception as e:
        logger.error(f"Error creating watch item: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to create watch item: {str(e)}") from e

@context.app.put("/api/watch-items/{item_id}")
async def update_watch_item(item_id: int, item: WatchItemUpdate, current_user: dict = Depends(context.get_current_user)):
    if not context.current_config or item_id >= len(context.current_config.letterboxd.watch):
        raise HTTPException(status_code=404, detail="Watch item not found")

    try:
        # Get the existing watch item
        existing_item = context.current_config.letterboxd.watch[item_id]
        
        # Update only the fields that were provided
        if item.path is not None:
            existing_item.path = item.path
        if item.tags is not None:
            existing_item.tags = item.tags
        if item.filters is not None:
            existing_item.filters = LetterboxdFilters(**item.filters)
        if item.auto_add is not None:
            existing_item.auto_add = item.auto_add

        # Save updated config
        with open(CONFIG_PATH, 'w') as f:
            yaml.dump(context.current_config.to_dict(), f, default_flow_style=False)

        # Reload configuration
        context.load_config()

        return {"message": "Watch item updated successfully"}

    except Exception as e:
        logger.error(f"Error updating watch item: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to update watch item: {str(e)}") from e

@context.app.delete("/api/watch-items/{item_id}")
async def delete_watch_item(item_id: int, current_user: dict = Depends(context.get_current_user)):
    if not context.current_config or item_id >= len(context.current_config.letterboxd.watch):
        raise HTTPException(status_code=404, detail="Watch item not found")

    try:
        # Load current config from the file
        context.current_config.letterboxd.watch.pop(item_id)

        # Save updated config
        with open(CONFIG_PATH, 'w') as f:
            yaml.dump(context.current_config.to_dict(), f, default_flow_style=False)

        # Reload configuration
        context.load_config()

        return {"message": "Watch item deleted successfully"}

    except Exception as e:
        logger.error(f"Error deleting watch item: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to delete watch item: {str(e)}") from e

@context.app.get("/api/radarr/quality-profiles")
def get_radarr_quality_profiles(current_user: dict = Depends(context.get_current_user)):
    """The quality profiles Radarr offers, to pick from on the configuration screen

    Declared sync: it waits on Radarr, which may be slow or down.
    """
    if not context.sync_instance:
        raise HTTPException(status_code=404, detail="Sync instance not available")

    try:
        profiles = context.sync_instance.radarr.get_quality_profiles()
    except Exception as e:
        logger.error(f"Error fetching quality profiles from Radarr: {e}")
        raise HTTPException(status_code=502, detail=f"Could not reach Radarr: {e}") from e

    return {
        "profiles": [
            {"id": profile["id"], "name": profile["name"]}
            for profile in profiles
        ]
    }

@context.app.post("/api/test-watch-item")
def test_letterboxd_url(request: WatchItemCreate, current_user: dict = Depends(context.get_current_user)):
    """Whether Letterboxd will give up the films of a path, and how many

    A path Letterboxd will not read comes back invalid, with what it answered:
    it used to come back valid with no films, which reads on the screen as a
    perfectly good empty list and leaves nothing to go on but the server log.
    """
    try:
        # Test URL by attempting to scrape first few movies
        item = WatchListItem(
            path=request.path,
            filters=request.filters,
            tags=request.tags,
            auto_add=request.auto_add
        )
        movies = context.sync_instance.letterboxd.get_movies_from_path(
            watch_item=item,
            global_filters=context.current_config.letterboxd.filters
        )
        return {
            "valid": True,
            "movie_count": len(movies),
            "sample_movies": [{"title": movie["title"], "year": movie["year"]} for movie in movies[:3]]
        }
    except ListingUnavailable as e:
        logger.info(f"Letterboxd would not give up {request.path}: {e}")
        return {"valid": False, "error": str(e)}
    except Exception as e:
        logger.error(f"Error testing Letterboxd URL: {e}")
        return {"valid": False, "error": str(e)}

@context.app.get("/api/movies/processed")
async def get_processed_movies(current_user: dict = Depends(context.get_current_user)):
    if not context.sync_instance:
        raise HTTPException(status_code=404, detail="Sync instance not available")

    try:
        processed_movies = list(context.sync_instance.processed_movies)
        return {"movies": processed_movies, "count": len(processed_movies)}
    except Exception as e:
        logger.error(f"Error getting processed movies: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get processed movies: {str(e)}") from e

def get_categorised_movies(item_id: int) -> List[Dict]:
    """Movies of a watch item, each with its category, Radarr status and rating

    The ratings are the stored ones, read once for the whole listing rather than
    a film at a time: they come from the database the background rounds fill in,
    so a film whose turn has not come round yet carries none rather than holding
    the page up while Letterboxd is asked for it.
    """
    watch_item = context.current_config.letterboxd.watch[item_id]
    movies = context.sync_instance.letterboxd.get_movies_from_path_by_category(
        watch_item=watch_item,
        global_filters=context.current_config.letterboxd.filters
    )

    processed_ids, processed_slugs = context.sync_instance.db.get_added_keys()
    ratings = get_film_ratings().by_slug

    return [
        {
            "title": movie["title"],
            "year": movie["year"],
            "letterboxd_url": f"https://letterboxd.com/film/{movie['letterboxd_slug']}/",
            "letterboxd_slug": movie["letterboxd_slug"],
            "processed": movie_key(movie) in processed_ids or movie["letterboxd_slug"] in processed_slugs,
            "tmdb_id": movie.get("tmdb_id"),
            "category": movie.get("category", CATEGORY_FILM),
            "rating": ratings.get(movie["letterboxd_slug"], {}).get("rating"),
            "rating_count": ratings.get(movie["letterboxd_slug"], {}).get("rating_count")
        }
        for movie in movies
    ]


def get_stored_categorised_movies(item_id: int) -> Optional[List[Dict]]:
    """Categorised movies of a watch item from storage, None if never read

    Never crawls, and unlike get_categorised_movies does not look up what Radarr
    already has: progress only needs each movie's slug and category, and reading
    the whole added-movies table once per watch item is a lot of nothing.
    """
    watch_item = context.current_config.letterboxd.watch[item_id]
    return context.sync_instance.letterboxd.get_stored_movies_by_category(
        watch_item=watch_item,
        global_filters=context.current_config.letterboxd.filters
    )


def watch_item_progress(item_id: int, movies: Optional[List[Dict]],
                        watched_slugs: Optional[set], ratings: 'FilmRatings') -> Dict:
    """Per-category count of movies already watched for one watch item

    read is False when the listing has never been read from Letterboxd; the
    counts are all zero in that case and the page says so rather than reporting
    an empty list. watched counts are None when no Letterboxd profile is
    configured, since watched status is what the profile provides.

    How Letterboxd rates the list comes back with it: the page sorts on both,
    and working them out means walking the same listing twice otherwise.
    """
    listing = movies if movies is not None else []

    def watched_in(selection: List[Dict]) -> Optional[int]:
        if watched_slugs is None:
            return None
        return sum(1 for movie in selection if movie["letterboxd_slug"] in watched_slugs)

    categories = []
    for category in MOVIE_CATEGORIES:
        in_category = [movie for movie in listing if movie["category"] == category]
        categories.append({
            "category": category,
            "total": len(in_category),
            "watched": watched_in(in_category)
        })

    return {
        "item_id": item_id,
        "read": movies is not None,
        "total": len(listing),
        "watched": watched_in(listing),
        "categories": categories,
        "ratings": watch_item_ratings(movies, ratings)
    }


# How many films' worth of the average across every watch item a list's own
# average is weighed against. Three films rated 4.6 between them say much less
# about a list than eighty films averaging 4.6 do, and this is what "much less"
# comes to: against ten, three films carry under a quarter of their own weight
# and eighty carry nearly all of it.
RATING_PRIOR_FILMS = 10

# What a large body of work is worth on top of that, in rating points, and how
# many rated films earn half of it. Weighing a short list towards the middle
# only stops it running away with a high average; on its own it leaves a
# director of five good films above a director of sixty nearly as good ones,
# which is not how a watch list is worth ranking. So size is paid for outright,
# on a curve that flattens: the fortieth film a director made counts for far
# less than the fifth, and no filmography can buy more than the premium.
#
# Counted over the films whose ratings have been read, not the whole list. They
# are the same thing once the background rounds are through, and until they are,
# crediting a director for films nothing is known about would put a list of
# eighty with one rating among the best on the strength of that one.
RATING_SIZE_PREMIUM = 0.30
RATING_SIZE_MIDPOINT = 25


class FilmRatings(NamedTuple):
    """The stored ratings, and the average across all of them to weigh against

    The average is worked out once for a request rather than once per watch
    item: every list is weighed against the same one, and it is a pass over
    every film watched.
    """
    by_slug: Dict[str, Dict]
    mean: Optional[float]


def get_film_ratings() -> FilmRatings:
    """Every stored film rating, with the average across them

    The average is over every film whose rating has been read rather than over
    the watch items as they stand: ratings are only ever read for the films the
    watch items hold, and a film that has since left one is a film Letterboxd
    rated like any other for the purpose of having something to weigh against.

    Empty when no sync instance holds a database yet, which the page reports as
    a list nothing is known about rather than as an error.
    """
    if not context.sync_instance:
        return FilmRatings({}, None)

    try:
        by_slug = context.sync_instance.db.get_film_stats()
    except Exception as e:
        logger.error(f"Error reading the stored film ratings: {e}")
        return FilmRatings({}, None)

    rated = [film["rating"] for film in by_slug.values() if film["rating"] is not None]
    return FilmRatings(by_slug, sum(rated) / len(rated) if rated else None)


def watch_item_ratings(movies: Optional[List[Dict]], ratings: FilmRatings) -> Dict:
    """How Letterboxd's members rate what a watch item holds

    rating is the plain average over the films of the list that have one.

    weighted_rating is that average pulled towards the average across every
    watch item by the films the list does not have, and then paid for the films
    it does: a long filmography is worth ranking above a short one that merely
    averages a little higher, so both a thin sample and a small body of work
    cost a list its place. It is no longer a rating but a score, and it can sit
    above the plain average — a director of sixty is meant to gain by it.

    popularity is how many ratings its films have drawn between them.

    All three are None until some film of the list has been rated, which covers
    a list never read, a list of nothing but unreleased films, and a list whose
    ratings the refresher has not worked through yet. Films with no rating are
    left out rather than counted as zero: an unreleased film nobody has rated
    says nothing about the list it is on.
    """
    rated = [
        ratings.by_slug[movie["letterboxd_slug"]]
        for movie in (movies or [])
        if ratings.by_slug.get(movie["letterboxd_slug"], {}).get("rating") is not None
    ]

    if not rated:
        return {"rating": None, "weighted_rating": None, "popularity": None, "rated": 0}

    count = len(rated)
    rating = sum(film["rating"] for film in rated) / count

    weighted = rating
    if ratings.mean is not None:
        weighted = ((count * rating + RATING_PRIOR_FILMS * ratings.mean)
                    / (count + RATING_PRIOR_FILMS))
    weighted += RATING_SIZE_PREMIUM * count / (count + RATING_SIZE_MIDPOINT)

    # The geometric mean, not the plain one: rating counts run from a few
    # hundred to a few million, so an average of them is decided by whichever
    # one film everyone has seen and says nothing about the rest of the list.
    counts = [film["rating_count"] for film in rated if film["rating_count"] > 0]
    popularity = (
        10 ** (sum(math.log10(count) for count in counts) / len(counts))
        if counts else None
    )

    return {
        "rating": round(rating, 2),
        "weighted_rating": round(weighted, 2),
        "popularity": round(popularity) if popularity is not None else None,
        "rated": count
    }


def get_watched_slugs() -> Optional[set]:
    """Slugs already watched on the configured Letterboxd profile, None if unset"""
    username = context.current_config.letterboxd.username
    if not username:
        return None

    try:
        return context.sync_instance.letterboxd.get_watched_slugs(username)
    except Exception as e:
        logger.error(f"Error getting watched films for {username}: {e}")
        return None


# Endpoints below crawl Letterboxd, which takes minutes on a large list. They are
# declared sync so FastAPI runs them off the event loop and the UI stays usable.
@context.app.get("/api/movies/by-watch-item/{item_id}")
def get_movies_by_watch_item(item_id: int, current_user: dict = Depends(context.get_current_user)):
    if not context.current_config or item_id >= len(context.current_config.letterboxd.watch):
        raise HTTPException(status_code=404, detail="Watch item not found")

    try:
        watch_item = context.current_config.letterboxd.watch[item_id]
        movies = get_categorised_movies(item_id)
        watched_slugs = get_watched_slugs()

        category_counts = dict.fromkeys(MOVIE_CATEGORIES, 0)
        for movie in movies:
            category_counts[movie["category"]] = category_counts.get(movie["category"], 0) + 1
            movie["watched"] = None if watched_slugs is None else movie["letterboxd_slug"] in watched_slugs

        return {
            "watch_item": {
                "path": watch_item.path,
                # What Letterboxd calls the list, null until a crawl has read it
                "name": context.sync_instance.db.get_path_name(watch_item.path),
                # Where the path leads, which is the only readable address a
                # list configured with a boxd.it share link has
                "url": context.sync_instance.db.get_path_url(watch_item.path),
                "tags": watch_item.tags
            },
            "movies": movies,
            "last_refreshed": context.sync_instance.db.get_path_fetched_at(watch_item.path),
            "total_count": len(movies),
            "category_counts": category_counts,
            "watched_count": None if watched_slugs is None else sum(1 for m in movies if m["watched"])
        }

    except ListingUnavailable as e:
        # Nothing has ever been read for this path and Letterboxd will not give
        # it up now: say why instead of showing the list as empty
        logger.warning(f"Could not read the listing of watch item {item_id}: {e}")
        raise HTTPException(status_code=502, detail=str(e)) from e
    except Exception as e:
        logger.error(f"Error getting movies for watch item: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get movies: {str(e)}") from e

@context.app.post("/api/watch-items/{item_id}/refresh")
def refresh_watch_item(item_id: int, current_user: dict = Depends(context.get_current_user)):
    """Re-read a watch item from Letterboxd now, ahead of its next scheduled refresh

    Answers once the whole list is stored, which on a large one is a matter of
    minutes: the caller wants to see the new listing, and returning before it is
    there would only have it read the old one. Watched films are shared by every
    watch item and refresh on their own, so a per-item button leaves them alone.
    """
    if not context.current_config or item_id >= len(context.current_config.letterboxd.watch):
        raise HTTPException(status_code=404, detail="Watch item not found")

    if not context.sync_instance:
        raise HTTPException(status_code=404, detail="Sync instance not available")

    try:
        watch_item = context.current_config.letterboxd.watch[item_id]
        logger.info(f"Refreshing {watch_item.path} on request")
        refreshed = context.sync_instance.refresher.refresh_watch_item(watch_item)
        return {"item_id": item_id, "path": watch_item.path, "refreshed": refreshed}

    except ListingUnavailable as e:
        logger.warning(f"Could not re-read watch item {item_id}: {e}")
        raise HTTPException(status_code=502, detail=str(e)) from e
    except Exception as e:
        logger.error(f"Error refreshing watch item: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to refresh watch item: {str(e)}") from e

# Progress is reported from the stored listings alone, so this never crawls: a
# request that stopped to read a list from Letterboxd would hold up the row
# waiting on it for as long as that crawl took. Every list's progress arrives
# with the page it is on, so what is left here is the one row a refresh redraws.
@context.app.get("/api/watch-items/{item_id}/progress")
def get_watch_item_progress(item_id: int, current_user: dict = Depends(context.get_current_user)):
    """Per-category count of movies already watched for one watch item

    Answers the page after that item has been refreshed on its own, which is why
    it is worth having next to the endpoint that reports on all of them.
    """
    if not context.current_config or item_id >= len(context.current_config.letterboxd.watch):
        raise HTTPException(status_code=404, detail="Watch item not found")

    try:
        return watch_item_progress(
            item_id, get_stored_categorised_movies(item_id), get_watched_slugs(),
            get_film_ratings()
        )

    except Exception as e:
        logger.error(f"Error getting progress for watch item: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get progress: {str(e)}") from e

# Release types the page has no use for, whatever country they are in. A
# premiere is a festival screening or a red carpet nobody can buy a ticket to,
# and a disc pressing lands months after the film has already been in cinemas
# and online: dating a film by either would announce a release that tells you
# nothing about when you can actually watch it.
IGNORED_RELEASE_TYPES = {'Premiere', 'Physical'}


def upcoming_release(releases: List[Dict], country: Optional[str],
                     today: str) -> Optional[Dict]:
    """The release a film is dated by, None when it has none still to come

    Premieres and physical releases are dropped before anything else is
    decided, so they neither date a film nor stand in the way of the release
    that should: a country that has announced nothing but a premiere or a disc
    pressing counts as having announced nothing at all, and the film falls back
    to the earliest date elsewhere like any other.

    The soonest release still ahead in the configured country is what the page
    promises. Whether that country has anything to say at all is what decides
    the rest, and the two ways it can say nothing are not the same thing:

    A country that has announced no date whatsoever has not made up its mind
    yet, so the soonest date anywhere stands in, flagged as somebody else's. A
    date from another country is a far better answer than no date at all.

    A country with any date already behind it has made up its mind: the film is
    out where you are, and it does not become upcoming again. Every date after
    the first is the same film reaching somewhere new — a cinema run going
    digital, a digital release reaching television — never a first chance to
    watch it, so dating a film by one would have you waiting until November for
    something you could have seen in July. The Odyssey, in French cinemas since
    the summer and digital in the autumn, is the shape of this.

    Only releases still ahead are ever picked from, which is what leaves the
    date standing in from elsewhere anything to say: a film always opens
    somewhere before it opens everywhere, so reading its first release anywhere
    as "out" would answer with nothing for every film the configured country
    has yet to speak about, and bury a wide opening under the limited run that
    came months before it.

    Several countries commonly share the soonest date, so the type and the
    country break the tie: which of them a row names would otherwise depend on
    the order the release table happened to be read in, and would change under
    the reader for no reason on the next refresh.
    """
    def soonest(candidates: List[Dict]) -> Optional[Dict]:
        ahead = [release for release in candidates if release['date'] >= today]
        if not ahead:
            return None
        return min(ahead, key=lambda release: (release['date'], release['type'],
                                               release['country']))

    releases = [release for release in releases
                if release['type'] not in IGNORED_RELEASE_TYPES]

    local = [release for release in releases if release['country'] == country]
    if local:
        # Out where you are, and out for good. With nothing behind it every
        # local date is still ahead, so there is always one left to pick.
        if any(release['date'] < today for release in local):
            return None
        return {**soonest(local), 'in_preferred_country': True}

    chosen = soonest(releases)
    return {**chosen, 'in_preferred_country': False} if chosen else None


# Reads only what is stored, like the progress endpoints above: release tables
# are read in the background, so opening the upcoming page never waits on a
# crawl. Declared sync all the same, since it walks every stored listing.
@context.app.get("/api/upcoming")
def get_upcoming(current_user: dict = Depends(context.get_current_user)):
    """The films the watch items are waiting on, in release order

    Only the films of this year and later are considered, and of those only the
    ones there is still something to wait for: a film already out in the
    configured country is out for good, whatever it has left to announce there,
    and one whose every announced release has come and gone has nothing
    upcoming about it wherever it came out. Films left with nothing but a
    premiere or a disc pressing have nothing to wait for either. All of them
    are counted rather than listed, so a page showing three releases out of
    forty says why.
    """
    if not context.current_config or not context.sync_instance:
        raise HTTPException(status_code=404, detail="Configuration not found")

    try:
        db = context.sync_instance.db
        country = context.current_config.letterboxd.country
        candidates, read_lists = context.sync_instance.refresher.upcoming_candidates()
        stored = db.get_film_releases()
        read_at = db.get_release_reads()
        processed_ids, processed_slugs = db.get_added_keys()
        names = {
            item.path: db.get_path_name(item.path)
            for item in context.current_config.letterboxd.watch
        }
        today = date.today().isoformat()

        releases = []
        undated = 0
        unread = 0
        for candidate in candidates:
            slug = candidate['letterboxd_slug']
            if slug not in read_at:
                unread += 1
                continue

            release = upcoming_release(stored.get(slug, []), country, today)
            if release is None:
                undated += 1
                continue

            releases.append({
                "title": candidate["title"],
                "year": candidate["year"],
                "letterboxd_url": f"https://letterboxd.com/film/{slug}/",
                "letterboxd_slug": slug,
                # What kind of entry it is, never "unreleased": everything here
                # is that, and the page is asking what the film itself is
                "category": candidate["category"],
                "date": release["date"],
                "release_type": release["type"],
                "release_country": release["country"],
                # False when the date comes from another country than the
                # configured one, which is what the page footnotes
                "in_preferred_country": release["in_preferred_country"],
                "processed": movie_key(candidate) in processed_ids or slug in processed_slugs,
                "tags": candidate["tags"],
                "watch_items": [
                    {**watch_item, "name": names.get(watch_item["path"])}
                    for watch_item in candidate["watch_items"]
                ]
            })

        releases.sort(key=lambda release: (release["date"], release["title"]))
        read_times = [read_at[c["letterboxd_slug"]] for c in candidates
                      if c["letterboxd_slug"] in read_at]

        return {
            # Null when none is configured, in which case every date below is
            # the earliest anywhere and the page says so once rather than per row
            "country": country,
            "releases": releases,
            "total_count": len(releases),
            # Films with nothing left to come — some have no date announced at
            # all, some have had every one of theirs, some have only a premiere
            # or a disc pressing left — against those whose release table has
            # not been read: the difference between a film with nothing ahead
            # and one nothing is known about
            "undated_count": undated,
            "unread_count": unread,
            "candidate_count": len(candidates),
            # Watch items configured, and how many of them have a listing to
            # take candidates from: without these, a page with nothing on it
            # cannot tell "nothing recent in your lists" from "nothing read yet"
            "list_count": len(context.current_config.letterboxd.watch),
            "read_list_count": read_lists,
            # The set is only as current as its oldest read, as on the dashboard
            "last_read": min(read_times) if read_times else None
        }

    except Exception as e:
        logger.error(f"Error getting the upcoming releases: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get upcoming releases: {str(e)}") from e


@context.app.post("/api/upcoming/refresh")
def refresh_upcoming(current_user: dict = Depends(context.get_current_user)):
    """Read the release tables again now, ahead of their next scheduled read

    Answers once they are stored, which is a page per recent film: the caller
    wants to see the new dates, and returning before they are there would only
    have it read the old ones.
    """
    if not context.sync_instance:
        raise HTTPException(status_code=404, detail="Sync instance not available")

    try:
        logger.info("Refreshing the release dates on request")
        return context.sync_instance.refresher.refresh_releases(max_age=0)

    except Exception as e:
        logger.error(f"Error refreshing the release dates: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to refresh release dates: {str(e)}") from e


@context.app.post("/api/sync/run")
async def run_sync(background_tasks: BackgroundTasks, current_user: dict = Depends(context.get_current_user)):
    if not context.sync_instance:
        raise HTTPException(status_code=404, detail="Sync instance not available")

    # The scheduled sync may already be under way; starting a second one would
    # just be skipped, so say so rather than reporting a sync that never ran
    if context.sync_instance.db.get_running_sync_run():
        raise HTTPException(status_code=409, detail="A sync is already running")

    def run_sync_task():
        try:
            # A whole round, lists included: asking for a sync now is asking for
            # what the lists hold now, not for what they held at the last read
            context.sync_instance.sync_once(refresh=True)
        except Exception as e:
            logger.error(f"Error during sync: {e}")

    background_tasks.add_task(run_sync_task)
    return {"message": "Sync started in background"}

@context.app.get("/api/sync/status")
async def get_sync_status(current_user: dict = Depends(context.get_current_user)):
    """Whether a sync is running, and how the last finished one went"""
    if not context.sync_instance:
        raise HTTPException(status_code=404, detail="Sync instance not available")

    running = context.sync_instance.db.get_running_sync_run()
    return {
        "running": running is not None,
        "started_at": running["started_at"] if running else None,
        "last": context.sync_instance.db.get_last_sync_run()
    }

# How often the long poll below looks at the progress record, and how long it
# will hold a request that has nothing to report.
PROGRESS_POLL_SECONDS = 0.25
PROGRESS_HOLD_SECONDS = 25


@context.app.get("/api/sync/progress")
async def get_sync_progress(version: int = -1,
                            current_user: dict = Depends(context.get_current_user)):
    """Where the running round has got to, held open until that changes

    Long polled rather than polled on a timer: a round moves a film a second
    through phases that are minutes long, and a timer fast enough to follow
    that would be a request every second of a quarter-hour round, nearly all of
    them answering nothing new. The caller says which version it has already
    seen and this holds its request until there is a newer one.

    A caller that has fallen behind is answered at once, since the version it
    asks about is not the current one — which is also what makes the first call,
    with no version at all, answer immediately rather than waiting for a round
    that may not be running.

    Declared async on purpose. FastAPI runs the plain `def` endpoints in a
    worker pool of a few dozen threads, and a handler that blocks for the whole
    hold would take one of them per open browser tab; this one gives the loop
    back between looks.

    It looks at an integer every quarter-second rather than waiting on an event
    the sync thread sets. The record is written from a plain thread, and waking
    an asyncio waiter from one means holding the right event loop and calling
    into it threadsafely; comparing a counter costs nothing and cannot go wrong
    across that boundary.

    Answers after twenty-five seconds even with nothing to say, so the proxy in
    front of the application never cuts a connection it thinks has died. The
    caller asks again with the version it just got, and nothing is missed in
    between: the version it holds is the one it is asking about.
    """
    if not context.sync_instance:
        raise HTTPException(status_code=404, detail="Sync instance not available")

    progress = context.sync_instance.progress
    deadline = time.monotonic() + PROGRESS_HOLD_SECONDS

    snapshot = progress.snapshot()
    while snapshot['version'] == version and time.monotonic() < deadline:
        await asyncio.sleep(PROGRESS_POLL_SECONDS)
        snapshot = progress.snapshot()

    # The finished run travels with the round ending, so a caller watching a
    # sync has what it needs to report how the sync went without asking again
    return {**snapshot, "last": context.sync_instance.db.get_last_sync_run()}


@context.app.get("/api/dashboard")
async def get_dashboard(current_user: dict = Depends(context.get_current_user)):
    """Everything the dashboard shows, in one request

    Reads only what is stored: nothing here crawls Letterboxd or calls Radarr,
    so opening the dashboard stays instant.
    """
    if not context.sync_instance:
        raise HTTPException(status_code=404, detail="Sync instance not available")

    db = context.sync_instance.db
    username = context.current_config.letterboxd.username if context.current_config else None

    return {
        "watch_items": len(context.current_config.letterboxd.watch) if context.current_config else 0,
        "added_to_radarr": db.count_added(),
        "added_last_week": db.count_added(since=datetime.now().timestamp() - 7 * 86400),
        "watched": db.count_watched(username) if username else None,
        "recently_added": db.get_recently_added(),
        "lists_refreshed_at": db.last_list_refresh(),
        "sync": {
            "running": db.get_running_sync_run() is not None,
            "last": db.get_last_sync_run()
        }
    }

@context.app.post("/api/movies/add")
def add_movie_to_radarr(request: MovieAddRequest, current_user: dict = Depends(context.get_current_user)):
    if not context.sync_instance:
        raise HTTPException(status_code=404, detail="Sync instance not available")

    try:
        from lib_radarr import MultipleMatchesError
        
        # Search for movie in Radarr/TMDB
        radarr_movie = None
        try:
            radarr_movie = context.sync_instance.radarr.search_movie(request.title, request.year)
        except MultipleMatchesError:
            # Try to get TMDB ID from Letterboxd
            tmdb_id = context.sync_instance.letterboxd.get_movie_tmdb_id(request.letterboxd_slug)
            if tmdb_id:
                radarr_movie = context.sync_instance.radarr.search_movie(request.title, request.year, tmdb_id)

        if not radarr_movie:
            raise HTTPException(status_code=404, detail=f"Movie '{request.title}' not found in TMDB")

        # Add to Radarr with tags
        if context.sync_instance.radarr.add_movie(radarr_movie, request.tags):
            # Mark as processed
            context.sync_instance.mark_processed(
                f"{request.title}_{request.year}",
                slug=request.letterboxd_slug,
                title=request.title,
                year=request.year,
                tags=request.tags
            )

            return {"message": f"Movie '{request.title}' added to Radarr successfully", "success": True}
        else:
            raise HTTPException(status_code=500, detail="Failed to add movie to Radarr")

    except Exception as e:
        logger.error(f"Error adding movie to Radarr: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to add movie: {str(e)}") from e

@context.app.get("/api/status")
async def get_status():
    return {
        "status": "running",
        "config_loaded": context.current_config is not None,
        "sync_available": context.sync_instance is not None
    }

# Serve static files for frontend (only if built)
if Path("frontend/build").exists() and Path("frontend/build/static").exists():
    context.app.mount("/static", StaticFiles(directory="frontend/build/static"), name="static")
    context.app.mount("/assets", StaticFiles(directory="frontend/build/assets"), name="assets")

    @context.app.get("/{path:path}")
    async def serve_frontend(path: str):
        # Serve React app for all non-API routes
        if not path.startswith("api/") and not path.startswith("assets/") and Path("frontend/build/index.html").exists():
            return FileResponse("frontend/build/index.html")
        return None
