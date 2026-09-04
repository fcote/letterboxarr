import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import Layout from '../components/Layout';
import TagFilter, { TagOption } from '../components/TagFilter';
import Tooltip from '../components/Tooltip';
import { moviesAPI, upcomingAPI } from '../utils/api';
import { UpcomingRelease, UpcomingReleases } from '../types';
import { relativeTime, releaseDay, releaseMonth, timeUntil } from '../utils/time';
import {
  ArrowPathIcon,
  BookmarkIcon,
  CalendarIcon,
  CheckCircleIcon,
  ClockIcon,
  ExclamationCircleIcon,
  FilmIcon,
  GlobeAltIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  QueueListIcon
} from '@heroicons/react/24/outline';
import { categoryDescriptor } from '../utils/categories';

type Icon = React.ComponentType<{ className?: string }>;

// Watch items are any Letterboxd path, and the shape of the path is what says
// what kind of list it is: somebody's watchlist, a list they wrote, or one of
// Letterboxd's own listings — the films of a year, a genre, an actor.
const listIcon = (path: string): Icon => {
  const section = path.split('/')[1];
  if (section === 'watchlist') return BookmarkIcon;
  if (section === 'list') return QueueListIcon;
  return FilmIcon;
};

// Letterboxd names its own listings after what gathers them — "Films directed
// by Denis Villeneuve", "Films starring Isabelle Huppert" — so a row with room
// for a few words shows a dozen lists all reading "Films directed b…". The name
// at the end is the only part that tells them apart, and the icon in front
// already says it was a listing of somebody's films. The whole name is on the
// hover, for the lists this leaves nothing of.
const listLabel = (name: string): string =>
  name.replace(/^Films\s+(?:.*?\bby|starring|from)\s+/i, '') || name;

type SortKey = 'soonest' | 'furthest';

const SORTS: [SortKey, string][] = [
  ['soonest', 'Soonest first'],
  ['furthest', 'Furthest first']
];

type RadarrFilter = 'all' | 'in' | 'out';

const RADARR_FILTERS: [RadarrFilter, string][] = [
  ['all', 'All'],
  ['in', 'In Radarr'],
  ['out', 'Not in Radarr']
];

// One card per month, in the order the releases were sorted into. Grouping is
// done on the ISO date rather than the formatted heading, so two months that
// happen to read alike a year apart stay apart.
interface Month {
  key: string;
  heading: string;
  releases: UpcomingRelease[];
}

const groupByMonth = (releases: UpcomingRelease[]): Month[] => {
  const months: Month[] = [];

  for (const release of releases) {
    const key = release.date.slice(0, 7);
    if (months[months.length - 1]?.key !== key) {
      months.push({ key, heading: releaseMonth(release.date), releases: [] });
    }
    months[months.length - 1].releases.push(release);
  }

  return months;
};

const UpcomingPage: React.FC = () => {
  const [data, setData] = useState<UpcomingReleases | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // The slugs being handed to Radarr, not just the last one: adding a second
  // film while the first is still going would otherwise clear its button and
  // let it be pressed again on top of a request already in flight
  const [adding, setAdding] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('soonest');
  const [radarrFilter, setRadarrFilter] = useState<RadarrFilter>('all');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  const load = useCallback(async () => {
    try {
      setData(await upcomingAPI.get());
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Failed to load the upcoming releases');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      // Answers once the release tables are stored, so what follows reads the
      // new dates rather than the ones already on screen
      const result = await upcomingAPI.refresh();
      await load();
      toast.success(
        `Read ${result.read} film${result.read === 1 ? '' : 's'} from Letterboxd`
        + (result.left ? `, ${result.left} left for the next round` : '')
      );
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Failed to refresh the release dates');
    } finally {
      setRefreshing(false);
    }
  };

  const handleAdd = async (release: UpcomingRelease) => {
    setAdding(previous => [...previous, release.letterboxd_slug]);
    try {
      await moviesAPI.addToRadarr({
        title: release.title,
        year: release.year,
        letterboxd_slug: release.letterboxd_slug,
        tags: release.tags
      });
      toast.success(`${release.title} added to Radarr successfully!`);
      await load();
    } catch (error: any) {
      toast.error(error.response?.data?.detail || `Failed to add ${release.title} to Radarr`);
    } finally {
      setAdding(previous => previous.filter(slug => slug !== release.letterboxd_slug));
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

  if (!data) {
    return (
      <Layout>
        <div className="text-center py-12">
          <ExclamationCircleIcon className="mx-auto h-12 w-12 text-dark-text-muted" />
          <h3 className="mt-2 text-sm font-medium text-dark-text-primary">Upcoming releases not found</h3>
          <p className="mt-1 text-sm text-dark-text-muted">
            Unable to load the releases your watch lists are waiting on.
          </p>
        </div>
      </Layout>
    );
  }

  const query = search.trim().toLowerCase();
  const filtersActive = query !== '' || radarrFilter !== 'all' || selectedTags.length > 0;
  const clearFilters = () => {
    setSearch('');
    setRadarrFilter('all');
    setSelectedTags([]);
  };

  // Only tags on more than one release are worth filtering by: a tag used once
  // picks out the single release that carries it, which searching already does.
  // Counted over every release rather than the visible ones, so the choices do
  // not shift about as the filters change.
  const tagOptions = ((): TagOption[] => {
    const counts = new Map<string, number>();
    for (const release of data.releases) {
      for (const tag of release.tags) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }

    // Array.from rather than a spread: the build targets a version that cannot
    // iterate a Map directly
    return Array.from(counts.entries())
      .filter(([, count]) => count > 1)
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  })();

  const matches = (release: UpcomingRelease) => {
    if (query
      && !release.title.toLowerCase().includes(query)
      && !release.tags.some(tag => tag.toLowerCase().includes(query))
      && !release.watch_items.some(item =>
        item.path.toLowerCase().includes(query)
        || (item.name ?? '').toLowerCase().includes(query))) {
      return false;
    }

    if (radarrFilter === 'in' && !release.processed) return false;
    if (radarrFilter === 'out' && release.processed) return false;

    // Any one of the picked tags is enough, so picking more widens the result
    if (selectedTags.length > 0 && !selectedTags.some(tag => release.tags.includes(tag))) {
      return false;
    }

    return true;
  };

  // The API already sorts by date; only the reversal has to be done here
  const visible = data.releases.filter(matches);
  const ordered = sort === 'furthest' ? [...visible].reverse() : visible;
  const months = groupByMonth(ordered);

  // A date from somewhere other than the country that was asked for is worth
  // pointing out; the earliest date anywhere is not, when that is all the page
  // ever promised. Without a configured country every row would otherwise be
  // marked as a fallback from nothing.
  const fellBack = (release: UpcomingRelease) =>
    Boolean(data.country) && !release.in_preferred_country;

  // What the icon at the head of the row cannot show on its own: what kind of
  // entry it is in words, and how far off the release is
  const releaseSummary = (release: UpcomingRelease): string[] => [
    `${release.title} (${release.year})`,
    categoryDescriptor(release.category).label,
    `${releaseDay(release.date)} — ${timeUntil(release.date)}`,
    fellBack(release)
      ? `No date announced in ${data.country} yet — this is the earliest anywhere: `
        + `${release.release_type} in ${release.release_country}`
      : `${release.release_type} release in ${release.release_country}`
  ];

  // What the list icons cannot: which lists exactly, and what they tag the film
  // with. Every one of them is named rather than only the ones whose name fits
  // on the row, and the paths come along since two lists can read alike.
  const originSummary = (release: UpcomingRelease): string[] => [
    release.watch_items.length === 1 ? 'From your watch list' : 'From your watch lists',
    ...release.watch_items.map(item =>
      item.name ? `${item.name} — letterboxd.com/${item.path}` : `letterboxd.com/${item.path}`),
    release.tags.length > 0 ? `Tags: ${release.tags.join(', ')}` : 'No tags'
  ];

  const renderRelease = (release: UpcomingRelease) => {
    const kind = categoryDescriptor(release.category);
    const KindIcon = kind.icon;

    return (
      <li key={release.letterboxd_slug} className="px-4 py-2">
        {/* One line per release: the title takes what room is left, what kind of
            entry it is and the lists it came from are pictures rather than
            words, and what neither can say hangs off them on hover */}
        <div className="flex items-center gap-3">
          <span className="w-24 flex-shrink-0 whitespace-nowrap text-sm font-medium text-dark-text-secondary">
            {releaseDay(release.date)}
          </span>

          <Tooltip
            lines={releaseSummary(release)}
            focusable={false}
            className="inline-flex flex-shrink-0 rounded p-1 text-dark-text-muted hover:text-brand-blue"
          >
            {/* The same picture the movies and watch items pages count this
                kind of entry under, so a film strip means there what it means
                here. A picture reads as nothing to anything not looking. */}
            <KindIcon className="h-4 w-4" />
            <span className="sr-only">{kind.label}</span>
          </Tooltip>

          <div className="min-w-0 flex-1">
            <a
              href={release.letterboxd_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-dark-text-primary hover:text-brand-blue"
            >
              {release.title}
            </a>
            <span className="ml-2 text-sm text-dark-text-muted">{release.year}</span>
          </div>

          {/* One chip per list the film came from. The name is only there once
              the row is wide enough to spare it: below that the picture says
              what kind of list it was and the hover says which. */}
          <Tooltip
            lines={originSummary(release)}
            focusable={false}
            className="flex flex-shrink-0 items-center gap-1"
          >
            {release.watch_items.map(item => {
              const ListIcon = listIcon(item.path);
              const name = item.name ? listLabel(item.name) : item.path;
              return (
                <span
                  key={item.id}
                  className="inline-flex items-center rounded-full border border-dark-border bg-dark-bg-tertiary px-2 py-0.5 text-xs font-medium text-dark-text-muted"
                >
                  <ListIcon className="h-3 w-3 flex-shrink-0" />
                  <span className="ml-1 hidden max-w-32 truncate lg:block">{name}</span>
                  {/* The same name, for where the row is too narrow to show it
                      and for anything not reading the picture. Taken out of the
                      tree above that width rather than hidden, so it is not read
                      twice over once the visible one is there. */}
                  <span className="sr-only lg:hidden">{name}</span>
                </span>
              );
            })}
          </Tooltip>

          {/* Which release the date is, and the country unless it is the
              configured one, which the page has already named once and every
              row would only repeat back */}
          <span
            className={`hidden whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium sm:inline-flex sm:items-center ${
              fellBack(release)
                ? 'border-brand-orange/30 bg-brand-orange/20 text-brand-orange'
                : 'border-dark-border bg-dark-bg-tertiary text-dark-text-muted'
            }`}
          >
            {fellBack(release) && <GlobeAltIcon className="mr-1 h-3 w-3" />}
            {release.release_type}
            {!release.in_preferred_country && ` · ${release.release_country}`}
          </span>

          {release.processed ? (
            <span className="inline-flex items-center whitespace-nowrap rounded-full border border-brand-green/30 bg-brand-green/20 px-2.5 py-0.5 text-xs font-medium text-brand-green">
              <CheckCircleIcon className="mr-1 h-3 w-3" />
              In Radarr
            </span>
          ) : (
            <button
              onClick={() => handleAdd(release)}
              disabled={adding.indexOf(release.letterboxd_slug) !== -1}
              className="btn-primary flex flex-shrink-0 items-center px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
              title="Hand it to Radarr now, so it is picked up as soon as it comes out"
            >
              {adding.indexOf(release.letterboxd_slug) !== -1 ? (
                <>
                  <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white mr-1"></div>
                  Adding...
                </>
              ) : (
                <>
                  <PlusIcon className="w-3 mr-1" />
                  Add
                </>
              )}
            </button>
          )}
        </div>
      </li>
    );
  };

  return (
    <Layout>
      <div className="py-6 lg:py-8">
        <div className="border-b border-dark-border pb-5 flex justify-between items-start gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold leading-6 text-dark-text-primary">Upcoming</h1>
            <p className="mt-2 max-w-4xl text-sm text-dark-text-muted">
              {data.country
                ? <>Release dates in <span className="text-dark-text-secondary">{data.country}</span> for
                   the films your watch lists are waiting on, falling back to the earliest date
                   elsewhere when nothing has been announced there yet. A film already out there
                   drops off, whatever it has left to announce.</>
                : <>The earliest release date anywhere for the films your watch lists are waiting on.
                   Pick a country on the configuration page to be told when they come out where
                   you are.</>}
              {' '}Festival premieres and physical releases are left out.
              {data.last_read != null && ` Read from Letterboxd ${relativeTime(data.last_read)}.`}
            </p>
          </div>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="btn-secondary flex items-center text-sm flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
            title="Read the release dates from Letterboxd again, ahead of their next scheduled read"
          >
            <ArrowPathIcon className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        {/* Statistics */}
        <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-3">
          <div className="card overflow-hidden">
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <CalendarIcon className="h-6 w-6 text-brand-blue" />
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-dark-text-muted truncate">Coming up</dt>
                    <dd className="text-lg font-medium text-dark-text-primary">{data.total_count}</dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>

          <div className="card overflow-hidden">
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <ClockIcon className="h-6 w-6 text-dark-text-muted" />
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    {/* Some have nothing announced anywhere, some have had
                        every date they were given, some are out where you are
                        already and only their digital date is left, some have
                        only a premiere or a disc pressing: none is worth
                        waiting on, whatever its release table still holds */}
                    <dt className="text-sm font-medium text-dark-text-muted truncate">Nothing to wait for</dt>
                    <dd className="text-lg font-medium text-dark-text-primary">{data.undated_count}</dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>

          <div className="card overflow-hidden">
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <ExclamationCircleIcon
                    className={`h-6 w-6 ${data.unread_count ? 'text-brand-orange' : 'text-dark-text-muted'}`}
                  />
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-dark-text-muted truncate">Not read yet</dt>
                    <dd className="text-lg font-medium text-dark-text-primary">{data.unread_count}</dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Search, sort and filters on one row, kept in reach while scrolling */}
        {data.releases.length > 0 && (
          <div className="sticky top-0 z-10 mt-6 flex flex-wrap items-center gap-2 bg-dark-bg-primary py-3">
            <div className="relative min-w-64 max-w-sm flex-1">
              <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-dark-text-muted" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="input-field h-9 w-full py-0 pl-9 text-sm"
                placeholder="Search by title, list or tag"
                aria-label="Search upcoming releases by title, list or tag"
              />
            </div>

            {tagOptions.length > 0 && (
              <TagFilter
                options={tagOptions}
                selected={selectedTags}
                onChange={setSelectedTags}
                label="Releases with any of"
              />
            )}

            <div className="flex h-9 items-stretch overflow-hidden rounded-md border border-dark-border">
              {RADARR_FILTERS.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setRadarrFilter(value)}
                  aria-pressed={radarrFilter === value}
                  className={`whitespace-nowrap px-3 text-xs font-medium ${
                    radarrFilter === value
                      ? 'bg-brand-blue/20 text-brand-blue'
                      : 'text-dark-text-muted hover:bg-dark-bg-tertiary'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {filtersActive && (
              <button
                type="button"
                onClick={clearFilters}
                className="h-9 whitespace-nowrap rounded-md px-3 text-xs font-medium text-dark-text-muted hover:bg-dark-bg-tertiary hover:text-dark-text-secondary"
              >
                Clear
              </button>
            )}

            {/* Filters on the left, what came back and how it is ordered on the right */}
            <span className="ml-auto whitespace-nowrap text-xs text-dark-text-muted">
              {visible.length === data.releases.length
                ? `${data.releases.length} release${data.releases.length === 1 ? '' : 's'}`
                : `${visible.length} of ${data.releases.length}`}
            </span>

            <label className="ml-2 flex items-center gap-2 whitespace-nowrap text-xs text-dark-text-muted">
              Sort
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
                className="input-field h-9 py-0 text-sm"
                aria-label="Sort upcoming releases"
              >
                {SORTS.map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </label>
          </div>
        )}

        {data.releases.length === 0 ? (
          <div className="text-center py-12">
            <CalendarIcon className="mx-auto h-12 w-12 text-dark-text-muted" />
            <h3 className="mt-2 text-sm font-medium text-dark-text-primary">Nothing coming up</h3>
            {/* Four different reasons for an empty page, and only the last of
                them is "there is genuinely nothing". Saying the wrong one sends
                someone looking for a fault that is not there. */}
            <p className="mt-1 text-sm text-dark-text-muted">
              {data.list_count === 0
                ? 'No watch lists are configured yet. Add one to see what it is waiting on.'
                : data.read_list_count === 0
                  ? 'None of your watch lists has been read from Letterboxd yet. They are read in '
                    + 'the background, or refresh one from the watch items page.'
                  : data.candidate_count === 0
                    ? 'None of your watch lists holds a film from this year or later, so there is '
                      + 'nothing left for them to release.'
                    : data.unread_count > 0
                      ? `${data.unread_count} of the ${data.candidate_count} recent films in your `
                        + `lists ${data.unread_count === 1 ? 'has' : 'have'} not been read from `
                        + 'Letterboxd yet. They are read in the background, or refresh now.'
                      : `None of the ${data.candidate_count} recent films in your lists has `
                        + 'anything left to wait for.'}
            </p>
          </div>
        ) : visible.length === 0 ? (
          <div className="text-center py-12">
            <MagnifyingGlassIcon className="mx-auto h-12 w-12 text-dark-text-muted" />
            <h3 className="mt-2 text-sm font-medium text-dark-text-primary">No matching releases</h3>
            <p className="mt-1 text-sm text-dark-text-muted">
              {query
                ? `No title, list or tag matches "${search.trim()}".`
                : 'None of the upcoming releases matches the filters you have set.'}
            </p>
            <button type="button" onClick={clearFilters} className="btn-secondary text-sm mt-4">
              Clear filters
            </button>
          </div>
        ) : (
          months.map(month => (
            <div key={month.key} className="mt-6">
              <div className="card overflow-hidden">
                <div className="flex items-center px-4 py-3 sm:px-6">
                  <h3 className="text-lg leading-6 font-medium text-dark-text-primary">
                    {month.heading}
                  </h3>
                  <span className="ml-3 inline-flex items-center rounded-full bg-dark-border px-2.5 py-0.5 text-xs font-medium text-dark-text-muted">
                    {month.releases.length}
                  </span>
                </div>
                <ul className="divide-y divide-dark-border border-t border-dark-border">
                  {month.releases.map(renderRelease)}
                </ul>
              </div>
            </div>
          ))
        )}
      </div>
    </Layout>
  );
};

export default UpcomingPage;
