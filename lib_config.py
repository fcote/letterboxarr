"""Configuration handling for letterboxarr"""

import os
import yaml
from typing import Dict, List, Optional, Any
from dataclasses import dataclass


@dataclass
class SyncConfig:
    """Sync configuration"""
    interval_minutes: int = 60


@dataclass
class RadarrConfig:
    """Radarr configuration"""
    url: str
    api_key: str
    quality_profile: int
    root_folder: str
    monitor_added: bool = True
    search_added: bool = True


@dataclass
class LetterboxdFilters:
    """Letterboxd filter configuration"""
    skip_documentaries: bool = False
    skip_short_films: bool = False
    skip_unreleased: bool = False
    skip_tv_shows: bool = True


@dataclass
class WatchListItem:
    """Individual watch list item configuration"""
    path: str
    filters: Optional[LetterboxdFilters] = None
    tags: List[str] = None
    
    def __post_init__(self):
        if self.tags is None:
            self.tags = []


@dataclass
class LetterboxdConfig:
    """Letterboxd configuration"""
    filters: LetterboxdFilters
    watch: List[WatchListItem]


@dataclass
class Config:
    """Main configuration object"""
    sync: SyncConfig
    radarr: RadarrConfig
    letterboxd: LetterboxdConfig


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
            interval_minutes=sync_data.get('schedule', {}).get('interval_minutes', 60)
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
            if isinstance(watch_item, str):
                # Simple string format
                watch_list.append(WatchListItem(path=watch_item))
            elif isinstance(watch_item, dict):
                # Dictionary format with filters/tags
                for path, config in watch_item.items():
                    item_filters = None
                    if 'filters' in config:
                        filter_data = config['filters']
                        item_filters = LetterboxdFilters(
                            skip_documentaries=filter_data.get('skip_documentaries', global_filters.skip_documentaries),
                            skip_short_films=filter_data.get('skip_short_films', global_filters.skip_short_films),
                            skip_unreleased=filter_data.get('skip_unreleased', global_filters.skip_unreleased),
                            skip_tv_shows=filter_data.get('skip_tv_shows', global_filters.skip_tv_shows)
                        )
                    
                    tags = config.get('tags', [])
                    watch_list.append(WatchListItem(
                        path=path,
                        filters=item_filters,
                        tags=tags
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