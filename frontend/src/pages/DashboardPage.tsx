import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { configAPI, dashboardAPI, radarrAPI, syncAPI, watchItemsAPI } from '../utils/api';
import { Config, DashboardSummary, QualityProfile, SyncProgress, SyncRun, WatchItemsPage } from '../types';
import toast from 'react-hot-toast';
import { isAxiosError } from 'axios';
import Layout from '../components/Layout';
import SyncStatusBanner from '../components/SyncStatusBanner';
import { relativeTime, duration } from '../utils/time';
import { watchItemPath } from '../utils/letterboxd';
import {
  CheckCircleIcon,
  ClockIcon,
  ExclamationCircleIcon,
  FilmIcon,
  ArrowPathIcon,
  ArrowRightIcon
} from '@heroicons/react/24/outline';

// How long to wait before asking again after a failed request. The progress
// request is held open by the server until there is something to say, so a
// failure is the connection going rather than a round with nothing to report:
// asking straight back would be a hot loop against a backend that is restarting.
const SYNC_RETRY_MS = 2000;

const DashboardPage: React.FC = () => {
  const [config, setConfig] = useState<Config | null>(null);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [profiles, setProfiles] = useState<QualityProfile[] | null>(null);
  const [lists, setLists] = useState<WatchItemsPage | null>(null);
  const [configMissing, setConfigMissing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const lastRunId = useRef<number | null>(null);

  const load = useCallback(async () => {
    const [configData, summaryData, listData] = await Promise.all([
      configAPI.get().then(data => {
        setConfigMissing(false);
        return data;
      }).catch(error => {
        setConfigMissing(isAxiosError(error) && error.response?.status === 404);
        return null;
      }),
      dashboardAPI.get().catch(() => null),
      watchItemsAPI.getPage({
        offset: 0, limit: 4, search: '', auto_add: 'all', tags: [], sort: 'config'
      }).catch(() => null)
    ]);

    setConfig(configData);
    setSummary(summaryData);
    setLists(listData);

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

  // While a sync runs, follow it and report what it did at the end. This also
  // picks up syncs started by the scheduler, not just from this page.
  //
  // Long polled rather than asked on a timer: each request is held open by the
  // server until the round moves, so the banner follows it film by film without
  // a request per second, and a quiet round costs one request every twenty-five.
  useEffect(() => {
    if (!syncing) return;

    const controller = new AbortController();
    // Checked before every state change as well as at the top of the loop: an
    // unmount during a request in flight must not set state on the way out
    let stopped = false;

    const follow = async () => {
      // -1 is a version no round has, so the first request answers at once
      // rather than holding for a round that may have finished already
      let version = -1;

      while (!stopped) {
        let next: SyncProgress;
        try {
          next = await syncAPI.getProgress(version, controller.signal);
        } catch {
          if (stopped) return;
          await new Promise(resolve => setTimeout(resolve, SYNC_RETRY_MS));
          continue;
        }
        if (stopped) return;

        version = next.version;
        setProgress(next);
        if (next.running) continue;

        setSyncing(false);
        const finished = next.last;
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
        return;
      }
    };

    follow();

    return () => {
      stopped = true;
      controller.abort();
    };
  }, [syncing, load]);

  const runSync = async () => {
    setStarting(true);
    setProgress(null);
    try {
      await syncAPI.run();
      setSyncing(true);
      toast.success('Sync started');
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Failed to start sync');
      // A 409 means one is already going, so follow that one instead
      if (error.response?.status === 409) setSyncing(true);
    } finally {
      setStarting(false);
    }
  };

  if (loading) {
    return (
      <Layout>
        <div className="flex h-64 items-center justify-center gap-3 text-sm text-dark-text-muted" role="status">
          <ArrowPathIcon className="h-5 w-5 animate-spin text-brand-blue" aria-hidden="true" />
          Loading your overview…
        </div>
      </Layout>
    );
  }

  const lastSync: SyncRun | null = summary?.sync.last ?? null;
  const qualityProfile = profiles?.find(profile => profile.id === config?.radarr.quality_profile);
  const busy = syncing || starting;
  const failed = Boolean(lastSync && (lastSync.error || !lastSync.finished_at));
  const StatusIcon = !summary || failed ? ExclamationCircleIcon : lastSync ? CheckCircleIcon : ClockIcon;
  const statusTitle = !summary
    ? 'Sync status unavailable'
    : busy ? 'Sync in progress'
      : lastSync?.error ? 'Last sync needs attention'
        : lastSync?.finished_at ? 'Last sync completed'
          : lastSync ? 'Previous sync interrupted' : 'Ready for your first sync';

  const syncDetail = () => {
    if (!summary) return 'Could not load sync status. Try again to check your latest run.';
    if (busy) return 'Following your lists, films, release dates and ratings.';
    if (!lastSync) return 'Run a sync to read your watch lists and send new films to Radarr.';
    if (lastSync.error) return lastSync.error;
    if (!lastSync.finished_at) return 'The previous sync did not finish. Run a sync to try again.';
    return `${lastSync.added} added of ${lastSync.considered} found · ${relativeTime(lastSync.finished_at)} · Took ${duration(lastSync.finished_at - lastSync.started_at)}`;
  };

  const filters = config ? [
    config.letterboxd.filters.skip_documentaries && 'Documentaries',
    config.letterboxd.filters.skip_short_films && 'Short films',
    config.letterboxd.filters.skip_unreleased && 'Unreleased films',
    config.letterboxd.filters.skip_tv_shows && 'TV shows'
  ].filter(Boolean) : [];

  return (
    <Layout>
      <div className="py-6 lg:py-8">
        <header className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Your film pipeline.</h1>
            <p className="mt-3 text-sm text-dark-text-muted">A little less managing. A little more cinema.</p>
          </div>
          <button onClick={runSync} disabled={busy || !summary} className="btn-primary inline-flex items-center gap-2 text-sm">
            <ArrowPathIcon className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} aria-hidden="true" />
            {busy ? 'Syncing…' : 'Sync now'}
          </button>
        </header>

        {!config && (
          <section className="mt-7 rounded-lg border border-brand-orange/30 bg-brand-orange/10 p-5" aria-label="Configuration notice">
            <h2 className="text-sm font-semibold text-brand-orange">{configMissing ? 'Set up your film pipeline' : 'Settings unavailable'}</h2>
            <p className="mt-2 text-sm text-dark-text-secondary">
              {configMissing
                ? 'Configure Radarr and your Letterboxd watch lists to get started.'
                : 'Could not load your settings. Open settings to try again.'}
            </p>
            <Link to="/config" className="mt-3 inline-flex items-center gap-2 text-sm text-brand-blue">
              Open settings <ArrowRightIcon className="h-4 w-4" aria-hidden="true" />
            </Link>
          </section>
        )}

        <section className="card mt-7 p-5 sm:p-6" aria-label="Sync status">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 basis-full sm:flex-1" role="status">
              <div className="flex items-center gap-2.5">
                {busy
                  ? <ArrowPathIcon className="h-5 w-5 flex-shrink-0 animate-spin text-brand-blue" aria-hidden="true" />
                  : <StatusIcon className={`h-5 w-5 flex-shrink-0 ${!summary || failed ? 'text-brand-orange' : lastSync?.finished_at ? 'text-brand-green' : 'text-brand-blue'}`} aria-hidden="true" />}
                <h2 className="text-base font-semibold">{statusTitle}</h2>
              </div>
              <p className="mt-2 break-words text-xs leading-relaxed text-dark-text-muted sm:ml-7">{syncDetail()}</p>
              {!summary && <button onClick={() => { setLoading(true); load().finally(() => setLoading(false)); }} className="btn-secondary mt-3 text-xs">Try again</button>}
            </div>
            {config && <div className="text-xs sm:text-right"><p className="text-dark-text-muted">Sync interval</p><p className="mt-1 text-dark-text-secondary">Every {config.sync.interval_minutes} minutes</p></div>}
          </div>
          {syncing && progress?.running && <SyncStatusBanner progress={progress} embedded />}
        </section>

        <dl className="my-8 grid grid-cols-3 divide-x divide-dark-border/50 sm:my-10">
          <div className="min-w-0 pr-3 sm:pr-6">
            <dt className="text-xs text-dark-text-muted sm:text-sm">Added to Radarr</dt>
            <dd className="mt-2 text-2xl font-semibold tracking-tight sm:text-4xl">{summary?.added_to_radarr.toLocaleString() ?? '—'}</dd>
            <dd className="mt-2 text-xs text-brand-green">{summary ? `${summary.added_last_week.toLocaleString()} in the last 7 days` : 'Count unavailable'}</dd>
          </div>
          <div className="min-w-0 px-3 sm:px-6">
            <dt className="text-xs text-dark-text-muted sm:text-sm">Watch lists</dt>
            <dd className="mt-2 text-2xl font-semibold tracking-tight sm:text-4xl">{summary?.watch_items.toLocaleString() ?? '—'}</dd>
            <dd className="mt-2 text-xs"><Link to="/watch-items" className="text-brand-blue hover:underline">Manage lists</Link></dd>
          </div>
          <div className="min-w-0 pl-3 sm:pl-6">
            <dt className="text-xs text-dark-text-muted sm:text-sm">Films watched</dt>
            <dd className="mt-2 text-2xl font-semibold tracking-tight sm:text-4xl">{summary?.watched?.toLocaleString() ?? '—'}</dd>
            <dd className="mt-2 break-words text-xs text-dark-text-muted">
              {!summary ? 'Count unavailable' : summary.watched == null
                ? <Link to="/config" className="text-brand-blue hover:underline">Set your Letterboxd username</Link>
                : 'On Letterboxd'}
            </dd>
          </div>
        </dl>

        <div className="grid items-start gap-8 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <section aria-labelledby="recent-heading" className="min-w-0">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 id="recent-heading" className="text-lg font-semibold tracking-tight">Recently added</h2>
              <span className="text-xs text-dark-text-muted">Sent to Radarr</span>
            </div>
            {summary && summary.recently_added.length > 0 ? (
              <ul className="divide-y divide-dark-border/40">
                {summary.recently_added.map(movie => (
                  <li key={movie.movie_id} className="flex items-center gap-3 py-4">
                    <div className="flex h-14 w-10 flex-shrink-0 items-center justify-center rounded border border-dark-border/50 bg-dark-bg-secondary">
                      <FilmIcon className="h-5 w-5 text-brand-blue" aria-hidden="true" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="break-words text-sm font-medium">
                        {movie.letterboxd_slug ? <a href={`https://letterboxd.com/film/${movie.letterboxd_slug}/`} target="_blank" rel="noopener noreferrer" className="hover:text-brand-blue">{movie.title}</a> : movie.title}
                      </h3>
                      <p className="mt-1 text-xs text-dark-text-muted">{movie.year ? `${movie.year} · ` : ''}Added {relativeTime(movie.added_at)}</p>
                      {movie.tags.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{movie.tags.map(tag => <span key={tag} className="max-w-full break-words rounded border border-brand-blue/20 bg-brand-blue/5 px-2 py-0.5 text-xs text-brand-blue">{tag}</span>)}</div>}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="rounded-lg border border-dashed border-dark-border/60 px-5 py-10">
                <FilmIcon className="mb-3 h-7 w-7 text-dark-text-muted" aria-hidden="true" />
                <h3 className="text-sm font-medium">{summary ? 'No films added yet' : 'Recent additions unavailable'}</h3>
                <p className="mt-2 text-sm text-dark-text-muted">{!summary ? 'Try loading the sync status again to see recent films.' : summary.watch_items === 0 ? 'Add a watch list to start sending films to Radarr.' : 'Films will appear here after a sync sends them to Radarr.'}</p>
              </div>
            )}
          </section>

          <aside className="card min-w-0 p-5 sm:p-6" aria-labelledby="lists-heading">
            <div className="flex items-center justify-between gap-3">
              <h2 id="lists-heading" className="text-lg font-semibold tracking-tight">Your lists</h2>
              <Link to="/watch-items" className="text-xs text-brand-blue hover:underline">View all{lists ? ` (${lists.total})` : ''}</Link>
            </div>
            {lists && lists.items.length > 0 ? (
              <ul className="mt-2 divide-y divide-dark-border/40">
                {lists.items.map(item => (
                  <li key={item.id ?? item.path} className="py-4 last:pb-0">
                    <Link to={item.id != null ? `/movies/${item.id}` : '/watch-items'} className="block break-words text-sm font-medium hover:text-brand-blue">{item.name || watchItemPath(item)}</Link>
                    <p className="mt-1.5 text-xs text-dark-text-muted">
                      {item.progress?.read ? `${item.progress.total.toLocaleString()} films · ` : ''}
                      {item.last_refreshed != null ? `Read ${relativeTime(item.last_refreshed)}` : 'Not read from Letterboxd yet'}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="mt-4 text-sm text-dark-text-muted">
                <p>{lists ? 'Add a Letterboxd list, watchlist or film collection to start following its films.' : 'Could not load your watch lists. Open watch lists to try again.'}</p>
                <Link to="/watch-items" className="mt-4 inline-flex items-center gap-2 text-brand-blue">{lists ? 'Add a watch list' : 'Open watch lists'}<ArrowRightIcon className="h-4 w-4" aria-hidden="true" /></Link>
              </div>
            )}
          </aside>
        </div>

        {config && (
          <details className="mt-9 border-t border-dark-border/50 pt-5">
            <summary className="cursor-pointer text-sm font-medium text-dark-text-secondary">Sync settings <span className="ml-2 text-xs font-normal text-dark-text-muted">{qualityProfile?.name ?? `Profile ${config.radarr.quality_profile}`} · Every {config.sync.interval_minutes} minutes</span></summary>
            <dl className="mt-5 grid gap-5 text-sm sm:grid-cols-2">
              <div><dt className="text-xs text-dark-text-muted">Radarr URL</dt><dd className="mt-1 break-all">{config.radarr.url}</dd></div>
              <div><dt className="text-xs text-dark-text-muted">Root folder</dt><dd className="mt-1 break-all">{config.radarr.root_folder}</dd></div>
              <div><dt className="text-xs text-dark-text-muted">Lists last read</dt><dd className="mt-1">{summary ? summary.lists_refreshed_at != null ? relativeTime(summary.lists_refreshed_at) : 'Not read from Letterboxd yet' : 'Read time unavailable'}</dd></div>
              <div><dt className="text-xs text-dark-text-muted">Skipped categories</dt><dd className="mt-1">{filters.length ? filters.join(', ') : 'None, all categories are synced'}</dd></div>
            </dl>
            <Link to="/config" className="mt-5 inline-flex items-center gap-2 text-sm text-brand-blue">Edit settings <ArrowRightIcon className="h-4 w-4" aria-hidden="true" /></Link>
          </details>
        )}
        <footer className="mt-7 flex flex-wrap items-center justify-between gap-3 text-xs text-dark-text-muted">
          <span>Letterboxd → Letterboxarr → Radarr</span>
          <Link to="/upcoming" className="inline-flex items-center gap-2 hover:text-brand-blue">Explore upcoming releases <ArrowRightIcon className="h-3 w-3" aria-hidden="true" /></Link>
        </footer>
      </div>
    </Layout>
  );
};

export default DashboardPage;
