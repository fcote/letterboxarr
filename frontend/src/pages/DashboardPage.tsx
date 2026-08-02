import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { configAPI, dashboardAPI, radarrAPI, syncAPI } from '../utils/api';
import { Config, DashboardSummary, QualityProfile, SyncRun } from '../types';
import toast from 'react-hot-toast';
import Layout from '../components/Layout';
import { relativeTime, duration } from '../utils/time';
import {
  CheckCircleIcon,
  ClockIcon,
  ExclamationCircleIcon,
  EyeIcon,
  FilmIcon,
  PlayIcon
} from '@heroicons/react/24/outline';

// How often to ask whether a running sync has finished
const SYNC_POLL_MS = 3000;

const DashboardPage: React.FC = () => {
  const [config, setConfig] = useState<Config | null>(null);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [profiles, setProfiles] = useState<QualityProfile[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const lastRunId = useRef<number | null>(null);

  const load = useCallback(async () => {
    const [configData, summaryData] = await Promise.all([
      configAPI.get().catch(() => null),
      dashboardAPI.get().catch(() => null)
    ]);

    setConfig(configData);
    setSummary(summaryData);

    if (summaryData) {
      setSyncing(summaryData.sync.running);
      lastRunId.current = summaryData.sync.last?.id ?? null;
    }
    return summaryData;
  }, []);

  useEffect(() => {
    load()
      .catch(() => toast.error('Failed to load dashboard data'))
      .finally(() => setLoading(false));
    // Only for the quality profile name; a Radarr that is down just leaves the id
    radarrAPI.getQualityProfiles()
      .then(({ profiles: fetched }) => setProfiles(fetched))
      .catch(() => setProfiles(null));
  }, [load]);

  // While a sync runs, watch for it to finish and report what it did. This also
  // picks up syncs started by the scheduler, not just from this page.
  useEffect(() => {
    if (!syncing) return;

    const timer = setInterval(async () => {
      let status;
      try {
        status = await syncAPI.getStatus();
      } catch {
        return; // transient; try again on the next tick
      }
      if (status.running) return;

      setSyncing(false);
      const finished = status.last;
      if (finished && finished.id !== lastRunId.current) {
        if (finished.error) {
          toast.error(`Sync failed: ${finished.error}`);
        } else {
          toast.success(
            finished.added > 0
              ? `Sync finished, added ${finished.added} movie${finished.added === 1 ? '' : 's'}`
              : 'Sync finished, nothing new to add'
          );
        }
      }
      load();
    }, SYNC_POLL_MS);

    return () => clearInterval(timer);
  }, [syncing, load]);

  const runSync = async () => {
    try {
      await syncAPI.run();
      setSyncing(true);
      toast.success('Sync started');
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Failed to start sync');
      // A 409 means one is already going, so follow that one instead
      if (error.response?.status === 409) setSyncing(true);
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

  const lastSync: SyncRun | null = summary?.sync.last ?? null;
  const qualityProfile = profiles?.find(profile => profile.id === config?.radarr.quality_profile);

  const syncSummary = () => {
    if (syncing) return 'Running now';
    if (!lastSync) return 'Never';
    return relativeTime(lastSync.finished_at ?? lastSync.started_at);
  };

  const syncDetail = () => {
    if (syncing) return 'Reading your lists from Letterboxd';
    if (!lastSync) return 'No sync has run yet';
    if (lastSync.error) return lastSync.error;

    const took = lastSync.finished_at ? duration(lastSync.finished_at - lastSync.started_at) : null;
    const added = `${lastSync.added} added of ${lastSync.considered} found`;
    return took ? `${added}, took ${took}` : added;
  };

  const statCard = (
    key: string,
    label: string,
    value: React.ReactNode,
    detail: React.ReactNode,
    icon: React.ReactNode
  ) => (
    <div key={key} className="card overflow-hidden">
      <div className="p-5">
        <div className="flex items-center">
          <div className="flex-shrink-0">{icon}</div>
          <div className="ml-5 w-0 flex-1">
            <dl>
              <dt className="text-sm font-medium text-dark-text-muted truncate">{label}</dt>
              <dd className="text-lg font-medium text-dark-text-primary">{value}</dd>
            </dl>
          </div>
        </div>
        <p className="mt-2 text-xs text-dark-text-muted truncate" title={typeof detail === 'string' ? detail : undefined}>
          {detail}
        </p>
      </div>
    </div>
  );

  return (
    <Layout>
      <div className="px-4 py-6 sm:px-0">
        <div className="border-b border-dark-border pb-5 flex justify-between items-start gap-4">
          <div>
            <h1 className="text-2xl font-bold leading-6 text-dark-text-primary">Dashboard</h1>
            <p className="mt-2 max-w-4xl text-sm text-dark-text-muted">
              Overview of your Letterboxarr sync status and configuration.
            </p>
          </div>
          <button
            onClick={runSync}
            disabled={syncing || !summary}
            className="btn-primary flex flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {syncing ? (
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
            ) : (
              <PlayIcon className="w-4 mr-2" />
            )}
            {syncing ? 'Syncing...' : 'Run Sync Now'}
          </button>
        </div>

        {/* Status Cards */}
        <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {statCard(
            'sync',
            'Last Sync',
            syncSummary(),
            syncDetail(),
            lastSync?.error && !syncing
              ? <ExclamationCircleIcon className="h-6 w-6 text-brand-orange" />
              : <ClockIcon className="h-6 w-6 text-brand-blue" />
          )}
          {statCard(
            'items',
            'Watch Items',
            summary?.watch_items ?? 0,
            <Link to="/watch-items" className="text-brand-blue hover:text-brand-blue/80">
              Manage lists
            </Link>,
            <FilmIcon className="h-6 w-6 text-dark-text-muted" />
          )}
          {statCard(
            'added',
            'Added to Radarr',
            summary?.added_to_radarr ?? 0,
            summary && summary.added_last_week > 0
              ? `${summary.added_last_week} in the last 7 days`
              : 'None in the last 7 days',
            <CheckCircleIcon className="h-6 w-6 text-brand-green" />
          )}
          {statCard(
            'watched',
            'Films Watched',
            summary?.watched ?? '—',
            summary?.watched == null
              ? 'Set a Letterboxd username to track this'
              : `On letterboxd.com/${config?.letterboxd.username}`,
            <EyeIcon className="h-6 w-6 text-brand-blue" />
          )}
        </div>

        {/* Recently added to Radarr */}
        {summary && summary.recently_added.length > 0 && (
          <div className="mt-6 card overflow-hidden">
            <div className="px-4 py-5 sm:px-6">
              <h3 className="text-lg leading-6 font-medium text-dark-text-primary">
                Recently Added to Radarr
              </h3>
              <p className="mt-1 max-w-2xl text-sm text-dark-text-muted">
                The most recent movies this sync handed to Radarr.
              </p>
            </div>
            <ul className="border-t border-dark-border divide-y divide-dark-border">
              {summary.recently_added.map(movie => (
                <li key={movie.movie_id} className="px-4 py-3 sm:px-6">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center min-w-0">
                      <FilmIcon className="h-5 w-5 text-dark-text-muted mr-3 flex-shrink-0" />
                      <p className="text-sm font-medium text-dark-text-primary truncate">
                        {movie.letterboxd_slug ? (
                          <a
                            href={`https://letterboxd.com/film/${movie.letterboxd_slug}/`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:text-brand-blue"
                          >
                            {movie.title}{movie.year ? ` (${movie.year})` : ''}
                          </a>
                        ) : (
                          <>{movie.title}{movie.year ? ` (${movie.year})` : ''}</>
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {movie.tags.map((tag, index) => (
                        <span
                          key={index}
                          className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-brand-blue/20 text-brand-blue border border-brand-blue/30"
                        >
                          {tag}
                        </span>
                      ))}
                      <span className="text-xs text-dark-text-muted whitespace-nowrap">
                        {relativeTime(movie.added_at)}
                      </span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Current Configuration Summary */}
        {config && (
          <div className="mt-6 card overflow-hidden">
            <div className="px-4 py-5 sm:px-6 flex items-center justify-between gap-4">
              <div>
                <h3 className="text-lg leading-6 font-medium text-dark-text-primary">Current Configuration</h3>
                <p className="mt-1 max-w-2xl text-sm text-dark-text-muted">
                  Summary of your current sync configuration.
                </p>
              </div>
              <Link to="/config" className="btn-secondary text-sm flex-shrink-0">
                Edit
              </Link>
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
                    {qualityProfile ? qualityProfile.name : `Profile ${config.radarr.quality_profile}`}
                  </dd>
                </div>
                <div className="py-4 sm:py-5 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                  <dt className="text-sm font-medium text-dark-text-muted">Root Folder</dt>
                  <dd className="mt-1 text-sm text-dark-text-primary sm:mt-0 sm:col-span-2">
                    {config.radarr.root_folder}
                  </dd>
                </div>
                <div className="py-4 sm:py-5 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                  <dt className="text-sm font-medium text-dark-text-muted">Sync Interval</dt>
                  <dd className="mt-1 text-sm text-dark-text-primary sm:mt-0 sm:col-span-2">
                    Every {config.sync.interval_minutes} minutes
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
                      {!config.letterboxd.filters.skip_documentaries &&
                        !config.letterboxd.filters.skip_short_films &&
                        !config.letterboxd.filters.skip_unreleased &&
                        !config.letterboxd.filters.skip_tv_shows && (
                          <span className="text-sm text-dark-text-muted">None, everything is synced</span>
                        )}
                    </div>
                  </dd>
                </div>
              </dl>
            </div>
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
                  <Link to="/config" className="btn-secondary text-sm">
                    Configure Now
                  </Link>
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
