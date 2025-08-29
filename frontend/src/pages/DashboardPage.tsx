import React, { useState, useEffect } from 'react';
import { configAPI, watchItemsAPI, moviesAPI, syncAPI, statusAPI } from '../utils/api';
import { Config, WatchItem } from '../types';
import toast from 'react-hot-toast';
import Layout from '../components/Layout';
import { 
  FilmIcon, 
  PlayIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
  ClockIcon
} from '@heroicons/react/24/outline';

const DashboardPage: React.FC = () => {
  const [config, setConfig] = useState<Config | null>(null);
  const [watchItems, setWatchItems] = useState<WatchItem[]>([]);
  const [processedMovies, setProcessedMovies] = useState<{ movies: string[]; count: number } | null>(null);
  const [status, setStatus] = useState<{ status: string; config_loaded: boolean; sync_available: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    try {
      const [configData, itemsData, moviesData, statusData] = await Promise.all([
        configAPI.get().catch(() => null),
        watchItemsAPI.getAll().catch(() => []),
        moviesAPI.getProcessed().catch(() => null),
        statusAPI.get().catch(() => null),
      ]);

      setConfig(configData);
      setWatchItems(itemsData);
      setProcessedMovies(moviesData);
      setStatus(statusData);
    } catch (error: any) {
      toast.error('Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  };

  const runSync = async () => {
    setSyncing(true);
    try {
      await syncAPI.run();
      toast.success('Sync started in background!');
      // Refresh processed movies after a delay
      setTimeout(() => {
        moviesAPI.getProcessed().then(setProcessedMovies);
      }, 2000);
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Failed to start sync');
    } finally {
      setSyncing(false);
    }
  };

  if (loading) {
    return (
      <Layout>
        <div className="flex justify-center items-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-blue"></div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="px-4 py-6 sm:px-0">
        <div className="border-b border-dark-border pb-5 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold leading-6 text-dark-text-primary">Dashboard</h1>
            <p className="mt-2 max-w-4xl text-sm text-dark-text-muted">
              Overview of your Letterboxarr sync status and configuration.
            </p>
          </div>
          <button
            onClick={runSync}
            disabled={syncing || !status?.sync_available}
            className="btn-primary flex disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <PlayIcon className="w-4 mr-2" />
            {syncing ? 'Running Sync...' : 'Run Sync Now'}
          </button>
        </div>

        {/* Status Cards */}
        <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <div className="card overflow-hidden">
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <div className={`h-3 w-3 rounded-full ${status?.status === 'running' ? 'bg-green-400' : 'bg-red-400'}`} />
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-dark-text-muted truncate">Server Status</dt>
                    <dd className="text-lg font-medium text-dark-text-primary capitalize">
                      {status?.status || 'Unknown'}
                    </dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>

          <div className="card overflow-hidden">
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <FilmIcon className="h-6 w-6 text-dark-text-muted" />
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-dark-text-muted truncate">Watch Items</dt>
                    <dd className="text-lg font-medium text-dark-text-primary">{watchItems.length}</dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>

          <div className="card overflow-hidden">
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <CheckCircleIcon className="h-6 w-6 text-brand-green" />
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-dark-text-muted truncate">Processed Movies</dt>
                    <dd className="text-lg font-medium text-dark-text-primary">
                      {processedMovies?.count || 0}
                    </dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>

          <div className="card overflow-hidden">
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <ClockIcon className="h-6 w-6 text-brand-blue" />
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-dark-text-muted truncate">Sync Interval</dt>
                    <dd className="text-lg font-medium text-dark-text-primary">
                      {config?.sync.interval_minutes || 0} min
                    </dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Configuration Status */}
        <div className="mt-6">
          <div className="card">
            <div className="px-4 py-5 sm:p-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg leading-6 font-medium text-dark-text-primary">Configuration Status</h3>
                  <div className="mt-2 max-w-xl text-sm text-dark-text-muted">
                    <p>Current configuration status and quick actions.</p>
                  </div>
                </div>
                <div className="flex items-center space-x-4">
                  {status?.config_loaded ? (
                    <div className="flex items-center text-brand-green">
                      <CheckCircleIcon className="h-5 w-5 mr-2" />
                      <span className="text-sm">Configuration Loaded</span>
                    </div>
                  ) : (
                    <div className="flex items-center text-brand-orange">
                      <ExclamationCircleIcon className="h-5 w-5 mr-2" />
                      <span className="text-sm">Configuration Missing</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Current Configuration Summary */}
        {config && (
          <div className="mt-6 card overflow-hidden">
            <div className="px-4 py-5 sm:px-6">
              <h3 className="text-lg leading-6 font-medium text-dark-text-primary">Current Configuration</h3>
              <p className="mt-1 max-w-2xl text-sm text-dark-text-muted">
                Summary of your current sync configuration.
              </p>
            </div>
            <div className="border-t border-dark-border px-4 py-5 sm:p-0">
              <dl className="sm:divide-y sm:divide-dark-border">
                <div className="py-4 sm:py-5 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                  <dt className="text-sm font-medium text-dark-text-muted">Radarr URL</dt>
                  <dd className="mt-1 text-sm text-dark-text-primary sm:mt-0 sm:col-span-2">
                    {config.radarr.url}
                  </dd>
                </div>
                <div className="py-4 sm:py-5 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                  <dt className="text-sm font-medium text-dark-text-muted">Quality Profile</dt>
                  <dd className="mt-1 text-sm text-dark-text-primary sm:mt-0 sm:col-span-2">
                    {config.radarr.quality_profile}
                  </dd>
                </div>
                <div className="py-4 sm:py-5 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                  <dt className="text-sm font-medium text-dark-text-muted">Root Folder</dt>
                  <dd className="mt-1 text-sm text-dark-text-primary sm:mt-0 sm:col-span-2">
                    {config.radarr.root_folder}
                  </dd>
                </div>
                <div className="py-4 sm:py-5 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                  <dt className="text-sm font-medium text-dark-text-muted">Global Filters</dt>
                  <dd className="mt-1 text-sm text-dark-text-primary sm:mt-0 sm:col-span-2">
                    <div className="flex flex-wrap gap-2">
                      {config.letterboxd.filters.skip_documentaries && (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-dark-bg-tertiary text-dark-text-primary border border-dark-border">
                          Skip Documentaries
                        </span>
                      )}
                      {config.letterboxd.filters.skip_short_films && (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-dark-bg-tertiary text-dark-text-primary border border-dark-border">
                          Skip Short Films
                        </span>
                      )}
                      {config.letterboxd.filters.skip_unreleased && (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-dark-bg-tertiary text-dark-text-primary border border-dark-border">
                          Skip Unreleased
                        </span>
                      )}
                      {config.letterboxd.filters.skip_tv_shows && (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-dark-bg-tertiary text-dark-text-primary border border-dark-border">
                          Skip TV Shows
                        </span>
                      )}
                    </div>
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        )}

        {/* Watch Items Summary */}
        {watchItems.length > 0 && (
          <div className="mt-6 card overflow-hidden">
            <div className="px-4 py-5 sm:px-6">
              <h3 className="text-lg leading-6 font-medium text-dark-text-primary">Watch Items</h3>
              <p className="mt-1 max-w-2xl text-sm text-dark-text-muted">
                Your configured Letterboxd lists for syncing.
              </p>
            </div>
            <ul className="border-t border-dark-border divide-y divide-dark-border">
              {watchItems.slice(0, 5).map((item) => (
                <li key={item.id} className="px-4 py-4 sm:px-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center">
                      <FilmIcon className="h-5 w-5 text-dark-text-muted mr-3" />
                      <p className="text-sm font-medium text-dark-text-primary">
                        letterboxd.com/{item.path}
                      </p>
                    </div>
                    <div className="flex items-center space-x-2">
                      {item.tags && item.tags.length > 0 && (
                        <span className="text-xs text-dark-text-muted">
                          {item.tags.length} tag{item.tags.length !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            {watchItems.length > 5 && (
              <div className="px-4 py-3 bg-dark-bg-tertiary text-center">
                <p className="text-sm text-dark-text-muted">
                  And {watchItems.length - 5} more watch items...
                </p>
              </div>
            )}
          </div>
        )}

        {/* No Configuration Warning */}
        {!config && (
          <div className="mt-6 bg-brand-orange/10 border border-brand-orange/20 rounded-md p-4">
            <div className="flex">
              <div className="flex-shrink-0">
                <ExclamationCircleIcon className="h-5 w-5 text-brand-orange" />
              </div>
              <div className="ml-3">
                <h3 className="text-sm font-medium text-brand-orange">Configuration Required</h3>
                <div className="mt-2 text-sm text-dark-text-secondary">
                  <p>
                    No configuration found. Please set up your Radarr connection and Letterboxd settings
                    in the configuration page to get started.
                  </p>
                </div>
                <div className="mt-4">
                  <div className="-mx-2 -my-1.5 flex">
                    <a
                      href="/config"
                      className="btn-secondary text-sm"
                    >
                      Configure Now
                    </a>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
};

export default DashboardPage;