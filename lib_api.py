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
from lib_sync import LetterboxarrSync, LetterboxarrThread

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

    processed_movies = context.sync_instance.processed_movies if context.sync_instance else set()

    return [
        {
            "title": movie["title"],
            "year": movie["year"],
            "letterboxd_url": f"https://letterboxd.com/film/{movie['letterboxd_slug']}/",
            "letterboxd_slug": movie["letterboxd_slug"],
            "processed": f"{movie['title']}_{movie['year']}" in processed_movies,
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

    def run_sync_task():
        try:
            context.sync_instance.sync_once()
        except Exception as e:
            logger.error(f"Error during sync: {e}")

    background_tasks.add_task(run_sync_task)
    return {"message": "Sync started in background"}

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
            movie_id = f"{request.title}_{request.year}"
            context.sync_instance.processed_movies.add(movie_id)
            context.sync_instance._save_processed_movies()
            
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