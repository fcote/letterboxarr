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

from lib_config import ConfigLoader, Config, WatchListItem
from lib_letterboxd import LetterboxdScraper
from lib_sync import LetterboxdRadarrSync

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Paths
CONFIG_PATH = "config.yml"

# Security
SECRET_KEY = os.getenv("SECRET_KEY", "your-secret-key-change-this-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30

# Default admin credentials (should be changed in production)
DEFAULT_USERNAME = os.getenv("ADMIN_USERNAME", "admin")
DEFAULT_PASSWORD = os.getenv("ADMIN_PASSWORD", "admin")

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
security = HTTPBearer()

app = FastAPI(title="Letterboxarr", version="1.0.0")

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global variables
current_config: Optional[Config] = None
sync_instance: Optional[LetterboxdRadarrSync] = None

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
    filters: Optional[Dict] = None

class WatchItemUpdate(BaseModel):
    path: Optional[str] = None
    tags: Optional[List[str]] = None
    filters: Optional[Dict] = None

# Authentication functions
def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password):
    return pwd_context.hash(password)

def authenticate_user(username: str, password: str):
    if username == DEFAULT_USERNAME and password == DEFAULT_PASSWORD:
        return {"username": username}
    return False

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=15)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

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

# Load configuration on startup
def load_config():
    global current_config, sync_instance
    try:
        if Path(CONFIG_PATH).exists():
            current_config = ConfigLoader.load_config(CONFIG_PATH)
            sync_instance = LetterboxdRadarrSync(logger, current_config)
            logger.info("Configuration loaded successfully")
        else:
            logger.warning("config.yml not found")
    except Exception as e:
        logger.error(f"Error loading configuration: {e}")

# Routes
@app.post("/api/auth/login", response_model=Token)
async def login(login_request: LoginRequest):
    user = authenticate_user(login_request.username, login_request.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user["username"]}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer"}

@app.get("/api/config")
async def get_config(current_user: dict = Depends(get_current_user)):
    if not current_config:
        raise HTTPException(status_code=404, detail="Configuration not found")

    # Convert config to dict for JSON response
    return current_config.to_dict()

@app.put("/api/config")
async def update_config(config_update: Config, current_user: dict = Depends(get_current_user)):
    global current_config, sync_instance

    if not current_config:
        raise HTTPException(status_code=404, detail="Configuration not found")

    try:
        # Save updated config
        with open(CONFIG_PATH, 'w') as f:
            yaml.dump(config_update.to_dict(), f, default_flow_style=False)

        # Reload configuration
        current_config = ConfigLoader.load_config(CONFIG_PATH)
        sync_instance = LetterboxdRadarrSync(logger, current_config)

        return {"message": "Configuration updated successfully"}

    except Exception as e:
        logger.error(f"Error updating configuration: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to update configuration: {str(e)}")

@app.get("/api/watch-items")
async def get_watch_items(current_user: dict = Depends(get_current_user)):
    if not current_config:
        raise HTTPException(status_code=404, detail="Configuration not found")

    return [
        {
            "id": i,
            **item.to_dict()
        }
        for i, item in enumerate(current_config.letterboxd.watch)
    ]

@app.post("/api/watch-items")
async def create_watch_item(item: WatchItemCreate, current_user: dict = Depends(get_current_user)):
    global current_config, sync_instance

    if not current_config:
        raise HTTPException(status_code=404, detail="Configuration not found")

    try:
        current_config.letterboxd.watch.append(WatchListItem(
            path=item.path,
            tags=item.tags,
            filters=item.filters
        ))

        # Save updated config
        with open(CONFIG_PATH, 'w') as f:
            yaml.dump(current_config.to_dict(), f, default_flow_style=False)

        # Reload configuration
        current_config = ConfigLoader.load_config(CONFIG_PATH)
        sync_instance = LetterboxdRadarrSync(logger, current_config)

        return {"message": "Watch item created successfully"}

    except Exception as e:
        logger.error(f"Error creating watch item: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to create watch item: {str(e)}")

@app.delete("/api/watch-items/{item_id}")
async def delete_watch_item(item_id: int, current_user: dict = Depends(get_current_user)):
    global current_config, sync_instance

    if not current_config or item_id >= len(current_config.letterboxd.watch):
        raise HTTPException(status_code=404, detail="Watch item not found")

    try:
        # Load current config from the file
        current_config.letterboxd.watch.pop(item_id)

        # Save updated config
        with open(CONFIG_PATH, 'w') as f:
            yaml.dump(current_config.to_dict(), f, default_flow_style=False)

        # Reload configuration
        current_config = ConfigLoader.load_config(CONFIG_PATH)
        sync_instance = LetterboxdRadarrSync(logger, current_config)

        return {"message": "Watch item deleted successfully"}

    except Exception as e:
        logger.error(f"Error deleting watch item: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to delete watch item: {str(e)}")

@app.post("/api/test-watch-item")
async def test_letterboxd_url(request: WatchItemCreate, current_user: dict = Depends(get_current_user)):
    try:
        scraper = LetterboxdScraper(logger)
        # Test URL by attempting to scrape first few movies
        movies = scraper.get_movies_from_path(WatchListItem(
            path=request.path,
            filters=request.filters,
            tags=request.tags,
        ), limit=5)
        return {
            "valid": True,
            "movie_count": len(movies),
            "sample_movies": [{"title": movie["title"], "year": movie["year"]} for movie in movies[:3]]
        }
    except Exception as e:
        logger.error(f"Error testing Letterboxd URL: {e}")
        return {"valid": False, "error": str(e)}

@app.get("/api/movies/processed")
async def get_processed_movies(current_user: dict = Depends(get_current_user)):
    if not sync_instance:
        raise HTTPException(status_code=404, detail="Sync instance not available")

    try:
        processed_movies = list(sync_instance.processed_movies)
        return {"movies": processed_movies, "count": len(processed_movies)}
    except Exception as e:
        logger.error(f"Error getting processed movies: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get processed movies: {str(e)}")

@app.get("/api/movies/by-watch-item/{item_id}")
async def get_movies_by_watch_item(item_id: int, current_user: dict = Depends(get_current_user)):
    if not current_config or item_id >= len(current_config.letterboxd.watch):
        raise HTTPException(status_code=404, detail="Watch item not found")

    try:
        watch_item = current_config.letterboxd.watch[item_id]
        scraper = LetterboxdScraper(logger)
        movies = scraper.get_movies_from_path(watch_item, limit=50)  # Limit for performance

        # Check which movies have been processed
        processed_movies = sync_instance.processed_movies if sync_instance else set()

        movies_with_status = []
        for movie in movies:
            movie_key = f"{movie['title']}_{movie['year']}"
            movies_with_status.append({
                "title": movie["title"],
                "year": movie["year"],
                "letterboxd_url": movie.get("letterboxd_url", ""),
                "processed": movie_key in processed_movies,
                "tmdb_id": movie.get("tmdb_id")
            })

        return {
            "watch_item": {
                "path": watch_item.path,
                "tags": watch_item.tags
            },
            "movies": movies_with_status,
            "total_count": len(movies_with_status)
        }

    except Exception as e:
        logger.error(f"Error getting movies for watch item: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get movies: {str(e)}")

@app.post("/api/sync/run")
async def run_sync(background_tasks: BackgroundTasks, current_user: dict = Depends(get_current_user)):
    if not sync_instance:
        raise HTTPException(status_code=404, detail="Sync instance not available")

    def run_sync_task():
        try:
            sync_instance.sync_once()
        except Exception as e:
            logger.error(f"Error during sync: {e}")

    background_tasks.add_task(run_sync_task)
    return {"message": "Sync started in background"}

@app.get("/api/status")
async def get_status():
    return {
        "status": "running",
        "config_loaded": current_config is not None,
        "sync_available": sync_instance is not None
    }

# Serve static files for frontend (only if built)
if Path("frontend/build").exists() and Path("frontend/build/static").exists():
    app.mount("/static", StaticFiles(directory="frontend/build/static"), name="static")

    @app.get("/{path:path}")
    async def serve_frontend(path: str):
        # Serve React app for all non-API routes
        if not path.startswith("api/") and Path("frontend/build/index.html").exists():
            return FileResponse("frontend/build/index.html")
        return None