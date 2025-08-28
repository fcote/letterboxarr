"""Configuration handling for letterboxarr"""

import os
import sys
import yaml

from dataclasses import dataclass
from typing import List, Optional


@dataclass
class SyncConfig:
    """Sync configuration"""
    interval_minutes: int = 60

    def to_dict(self) -> dict:
        """Serialize sync config to dictionary"""
        return {
            "interval_minutes": self.interval_minutes
        }


@dataclass
class RadarrConfig:
    """Radarr configuration"""
    url: str
    api_key: str
    quality_profile: int
    root_folder: str
    monitor_added: bool = True
    search_added: bool = True

    def to_dict(self) -> dict:
        """Serialize Radarr config to dictionary"""
        return {
            "url": self.url,
            "api_key": self.api_key,
            "quality_profile": self.quality_profile,
            "root_folder": self.root_folder,
            "monitor_added": self.monitor_added,
            "search_added": self.search_added
        }


@dataclass
class LetterboxdFilters:
    """Letterboxd filter configuration"""
    skip_documentaries: bool = False
    skip_short_films: bool = False
    skip_unreleased: bool = False
    skip_tv_shows: bool = True

    def __init__(self, **kwargs):
        for key, value in kwargs.items():
            setattr(self, key, value)

    def to_dict(self) -> dict:
        """Serialize filters to dictionary"""
        return {
            "skip_documentaries": self.skip_documentaries,
            "skip_short_films": self.skip_short_films,
            "skip_unreleased": self.skip_unreleased,
            "skip_tv_shows": self.skip_tv_shows
        }


@dataclass
class WatchListItem:
    """Individual watch list item configuration"""
    path: str
    filters: Optional[LetterboxdFilters] = None
    tags: List[str] = None
    auto_add: bool = True
    
    def __post_init__(self):
        if self.tags is None:
            self.tags = []

    def to_dict(self) -> dict:
        """Serialize watch list item to dictionary"""
        result = {
            "path": self.path,
            "auto_add": self.auto_add,
        }
        if self.tags:
            result["tags"] = self.tags
        if self.filters:
            result["filters"] = self.filters.to_dict()
        return result


@dataclass
class LetterboxdConfig:
    """Letterboxd configuration"""
    filters: LetterboxdFilters
    watch: List[WatchListItem]

    def to_dict(self) -> dict:
        """Serialize Letterboxd config to dictionary"""
        return {
            "filters": self.filters.to_dict(),
            "watch": [item.to_dict() for item in self.watch]
        }


@dataclass
class Config:
    """Main configuration object"""
    sync: SyncConfig
    radarr: RadarrConfig
    letterboxd: LetterboxdConfig

    def to_dict(self) -> dict:
        """Serialize configuration to dictionary"""
        return {
            "sync": self.sync.to_dict(),
            "radarr": self.radarr.to_dict(),
            "letterboxd": self.letterboxd.to_dict()
        }


class ConfigLoader:
    """Configuration loader and validator"""
    
    @staticmethod
    def load_config(config_path: str = "config.yml") -> Config:
        """Load configuration from YAML file"""
        if not os.path.exists(config_path):
            raise FileNotFoundError(f"Configuration file not found: {config_path}")
        
        with open(config_path, 'r') as f:
            config_data = yaml.safe_load(f)
        
        # Validate required sections
        required_sections = ['sync', 'radarr', 'letterboxd']
        for section in required_sections:
            if section not in config_data:
                raise ValueError(f"Required configuration section missing: {section}")
        
        # Parse sync config
        sync_data = config_data['sync']
        sync_config = SyncConfig(
            interval_minutes=sync_data.get('interval_minutes', 60)
        )
        
        # Parse radarr config
        radarr_data = config_data['radarr']
        radarr_config = RadarrConfig(
            url=radarr_data['url'],
            api_key=radarr_data['api_key'],
            quality_profile=radarr_data['quality_profile'],
            root_folder=radarr_data['root_folder'],
            monitor_added=radarr_data.get('monitor_added', True),
            search_added=radarr_data.get('search_added', True)
        )
        
        # Parse letterboxd config
        letterboxd_data = config_data['letterboxd']
        
        # Parse global filters
        filters_data = letterboxd_data.get('filters', {})
        global_filters = LetterboxdFilters(
            skip_documentaries=filters_data.get('skip_documentaries', False),
            skip_short_films=filters_data.get('skip_short_films', False),
            skip_unreleased=filters_data.get('skip_unreleased', False),
            skip_tv_shows=filters_data.get('skip_tv_shows', True)
        )
        
        # Parse watch list
        watch_list = []
        for watch_item in letterboxd_data.get('watch', []):
            # Dictionary format with filters/tags
            item_filters = None
            if 'filters' in watch_item:
                filter_data = watch_item.get('filters')
                item_filters = LetterboxdFilters(
                    skip_documentaries=filter_data.get('skip_documentaries', global_filters.skip_documentaries),
                    skip_short_films=filter_data.get('skip_short_films', global_filters.skip_short_films),
                    skip_unreleased=filter_data.get('skip_unreleased', global_filters.skip_unreleased),
                    skip_tv_shows=filter_data.get('skip_tv_shows', global_filters.skip_tv_shows)
                )

            tags = watch_item.get('tags', [])
            auto_add = watch_item.get('auto_add', True)
            watch_list.append(WatchListItem(
                path=watch_item.get('path'),
                filters=item_filters,
                tags=tags,
                auto_add=auto_add
            ))
        
        letterboxd_config = LetterboxdConfig(
            filters=global_filters,
            watch=watch_list
        )
        
        return Config(
            sync=sync_config,
            radarr=radarr_config,
            letterboxd=letterboxd_config
        )
    
    @staticmethod
    def validate_config(config: Config) -> List[str]:
        """Validate configuration and return list of errors"""
        errors = []
        
        # Validate radarr config
        if not config.radarr.url:
            errors.append("Radarr URL is required")
        if not config.radarr.api_key:
            errors.append("Radarr API key is required")
        if not config.radarr.root_folder:
            errors.append("Radarr root folder is required")
        
        # Validate letterboxd config
        if not config.letterboxd.watch:
            errors.append("At least one Letterboxd watch item is required")
        
        # Validate sync config
        if config.sync.interval_minutes <= 0:
            errors.append("Sync interval must be greater than 0")
        
        return errors


def load_config_from_env(logger):
    """Load configuration from environment variables (legacy support)"""
    logger.info("Loading configuration from environment variables (legacy mode)")

    # Required environment variables
    radarr_api_key = os.getenv('RADARR_API_KEY')
    radarr_url = os.getenv('RADARR_URL')
    quality_profile = os.getenv('RADARR_QUALITY_PROFILE')
    letterboxd_user = os.getenv('LETTERBOXD_USERNAME')

    # Check required variables
    missing_vars = []
    if not radarr_api_key:
        missing_vars.append('RADARR_API_KEY')
    if not radarr_url:
        missing_vars.append('RADARR_URL')
    if not quality_profile:
        missing_vars.append('RADARR_QUALITY_PROFILE')
    if not letterboxd_user:
        missing_vars.append('LETTERBOXD_USERNAME')

    if missing_vars:
        logger.error("Missing required environment variables:")
        for var in missing_vars:
            logger.error(f"  - {var}")
        sys.exit(1)

    # Create config from environment variables
    sync_config = SyncConfig(
        interval_minutes=int(os.getenv('SYNC_INTERVAL_MINUTES', '60'))
    )

    radarr_config = RadarrConfig(
        url=radarr_url,
        api_key=radarr_api_key,
        quality_profile=int(quality_profile),
        root_folder=os.getenv('RADARR_ROOT_FOLDER', '/movies'),
        monitor_added=os.getenv('RADARR_MONITOR_ADDED_MOVIES', 'true').lower() == 'true',
        search_added=os.getenv('RADARR_START_SEARCHING_ADDED_MOVIES', 'true').lower() == 'true'
    )

    letterboxd_filters = LetterboxdFilters(
        skip_documentaries=False,
        skip_short_films=False,
        skip_unreleased=False,
        skip_tv_shows=True
    )

    # Create simple watchlist from username
    watch_items = [WatchListItem(path=f"{letterboxd_user}/watchlist", auto_add=True)]

    letterboxd_config = LetterboxdConfig(
        filters=letterboxd_filters,
        watch=watch_items
    )

    return Config(
        sync=sync_config,
        radarr=radarr_config,
        letterboxd=letterboxd_config
    )


def create_letterboxd_cookie_filters(filters: LetterboxdFilters) -> str:
    """Convert filter configuration to Letterboxd cookie format"""
    cookie_parts = []
    
    if filters.skip_short_films:
        cookie_parts.append("hide-shorts")
    if filters.skip_tv_shows:
        cookie_parts.append("hide-tv")
    if filters.skip_documentaries:
        cookie_parts.append("hide-docs")
    if filters.skip_unreleased:
        cookie_parts.append("hide-unreleased")
    
    return "%20".join(cookie_parts)