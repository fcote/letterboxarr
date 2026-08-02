import logging
import os
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Dict, Optional

import yaml
from fastapi import FastAPI, HTTPException, Depends, status, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.staticfiles import StaticFiles
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel

from lib_config import ConfigLoader, Config, WatchListItem, LetterboxdFilters
from lib_letterboxd import (
    LetterboxdScraper,
    CATEGORY_FILM,
    CATEGORY_SHORT_FILM,
    CATEGORY_DOCUMENTARY,
    CATEGORY_TV_SHOW,
    CATEGORY_UNRELEASED,
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
        except JWTError:
            raise credentials_exception

        if username != DEFAULT_USERNAME:
            raise credentials_exception

        return {"username": username}

    def restart_sync_thread(self):
        if self.sync_thread:
            self.sync_thread.stop()
        self.sync_thread = LetterboxarrThread(self.sync_instance)
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
    return {"access_token": access_token, "token_type": "bearer"}

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
        raise HTTPException(status_code=500, detail=f"Failed to update configuration: {str(e)}")

@context.app.get("/api/watch-items")
async def get_watch_items(current_user: dict = Depends(context.get_current_user)):
    if not context.current_config:
        raise HTTPException(status_code=404, detail="Configuration not found")

    return [
        {
            "id": i,
            **item.to_dict()
        }
        for i, item in enumerate(context.current_config.letterboxd.watch)
    ]

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
        raise HTTPException(status_code=500, detail=f"Failed to create watch item: {str(e)}")

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
        raise HTTPException(status_code=500, detail=f"Failed to update watch item: {str(e)}")

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
        raise HTTPException(status_code=500, detail=f"Failed to delete watch item: {str(e)}")

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
        raise HTTPException(status_code=502, detail=f"Could not reach Radarr: {e}")

    return {
        "profiles": [
            {"id": profile["id"], "name": profile["name"]}
            for profile in profiles
        ]
    }

@context.app.post("/api/test-watch-item")
def test_letterboxd_url(request: WatchItemCreate, current_user: dict = Depends(context.get_current_user)):
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
        raise HTTPException(status_code=500, detail=f"Failed to get processed movies: {str(e)}")

def get_categorised_movies(item_id: int) -> List[Dict]:
    """Movies of a watch item, each with its category and Radarr status"""
    watch_item = context.current_config.letterboxd.watch[item_id]
    movies = context.sync_instance.letterboxd.get_movies_from_path_by_category(
        watch_item=watch_item,
        global_filters=context.current_config.letterboxd.filters
    )

    processed_ids, processed_slugs = context.sync_instance.db.get_added_keys()

    return [
        {
            "title": movie["title"],
            "year": movie["year"],
            "letterboxd_url": f"https://letterboxd.com/film/{movie['letterboxd_slug']}/",
            "letterboxd_slug": movie["letterboxd_slug"],
            "processed": movie_key(movie) in processed_ids or movie["letterboxd_slug"] in processed_slugs,
            "tmdb_id": movie.get("tmdb_id"),
            "category": movie.get("category", CATEGORY_FILM)
        }
        for movie in movies
    ]


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

        category_counts = {category: 0 for category in MOVIE_CATEGORIES}
        for movie in movies:
            category_counts[movie["category"]] = category_counts.get(movie["category"], 0) + 1
            movie["watched"] = None if watched_slugs is None else movie["letterboxd_slug"] in watched_slugs

        return {
            "watch_item": {
                "path": watch_item.path,
                "tags": watch_item.tags
            },
            "movies": movies,
            "total_count": len(movies),
            "category_counts": category_counts,
            "watched_count": None if watched_slugs is None else sum(1 for m in movies if m["watched"])
        }

    except Exception as e:
        logger.error(f"Error getting movies for watch item: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get movies: {str(e)}")

@context.app.post("/api/watch-items/{item_id}/refresh")
def refresh_watch_item(item_id: int, current_user: dict = Depends(context.get_current_user)):
    """Drop what is cached for a watch item so the next read re-crawls Letterboxd

    Only the list is dropped. Watched films are shared by every watch item and
    refresh on their own hourly, so a per-item button does not re-read them.
    """
    if not context.current_config or item_id >= len(context.current_config.letterboxd.watch):
        raise HTTPException(status_code=404, detail="Watch item not found")

    if not context.sync_instance:
        raise HTTPException(status_code=404, detail="Sync instance not available")

    try:
        watch_item = context.current_config.letterboxd.watch[item_id]
        cleared = context.sync_instance.db.clear_crawls(watch_item.path)
        logger.info(f"Refreshing {watch_item.path}, dropped {cleared} cached crawls")
        return {"item_id": item_id, "path": watch_item.path, "cleared": cleared}

    except Exception as e:
        logger.error(f"Error refreshing watch item: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to refresh watch item: {str(e)}")

@context.app.get("/api/watch-items/{item_id}/progress")
def get_watch_item_progress(item_id: int, current_user: dict = Depends(context.get_current_user)):
    """Per-category count of movies already watched for a watch item

    Counts are None when no Letterboxd profile is configured, since watched
    status is what the profile provides.
    """
    if not context.current_config or item_id >= len(context.current_config.letterboxd.watch):
        raise HTTPException(status_code=404, detail="Watch item not found")

    try:
        movies = get_categorised_movies(item_id)
        watched_slugs = get_watched_slugs()

        def watched_in(selection: List[Dict]) -> Optional[int]:
            if watched_slugs is None:
                return None
            return sum(1 for movie in selection if movie["letterboxd_slug"] in watched_slugs)

        categories = []
        for category in MOVIE_CATEGORIES:
            in_category = [movie for movie in movies if movie["category"] == category]
            categories.append({
                "category": category,
                "total": len(in_category),
                "watched": watched_in(in_category)
            })

        return {
            "item_id": item_id,
            "total": len(movies),
            "watched": watched_in(movies),
            "categories": categories
        }

    except Exception as e:
        logger.error(f"Error getting progress for watch item: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get progress: {str(e)}")

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
            context.sync_instance.sync_once()
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
        raise HTTPException(status_code=500, detail=f"Failed to add movie: {str(e)}")

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