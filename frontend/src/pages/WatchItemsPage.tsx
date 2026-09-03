import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { watchItemsAPI, letterboxdAPI } from '../utils/api';
import { WatchItem, WatchItemProgress, WatchItemRatings, LetterboxdTestResult } from '../types';
import toast from 'react-hot-toast';
import Layout from '../components/Layout';
import CategoryRings from '../components/CategoryProgress';
import TagFilter, { TagOption } from '../components/TagFilter';
import Tooltip from '../components/Tooltip';
import { progressCategories } from '../utils/categories';
import { relativeTime } from '../utils/time';
import { isLink, watchItemAddress } from '../utils/letterboxd';
import {
  ArrowPathIcon,
  PlusIcon,
  TrashIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
  FilmIcon,
  InformationCircleIcon,
  MagnifyingGlassIcon,
  PencilIcon
} from '@heroicons/react/24/outline';

// Progress arrives on the row it belongs to. Only a row being refreshed on its
// own leaves that state, which is what this holds: everything else reads the
// progress the server sent with the page.
type RowState = 'loading' | 'error';

// How many rows a page holds, matching the server's own page size. The list
// appends as it scrolls rather than paging, so this is how much arrives at a
// time and not a limit on how much can be shown.
const PAGE_SIZE = 100;

// Typing runs ahead of the network, and every keystroke is now a request that
// searches two hundred lists rather than a filter over an array already in hand
const SEARCH_DEBOUNCE_MS = 300;

// The field drops its 'letterboxd.com/' prefix once a whole link is typed,
// since the address would read as nonsense underneath it
const PATH_EXAMPLES = 'Examples: username/watchlist, films/popular, '
  + 'actor/daniel-day-lewis. A private list works from the boxd.it link '
  + 'its share menu gives you.';

type SortKey = 'config' | 'path' | 'least-watched' | 'most-watched' | 'largest' | 'stalest'
  | 'best-rated' | 'best-weighted' | 'most-popular';

const SORTS: [SortKey, string][] = [
  ['config', 'Configured order'],
  ['path', 'Path (A–Z)'],
  ['least-watched', 'Least watched'],
  ['most-watched', 'Most watched'],
  ['largest', 'Most movies'],
  ['best-rated', 'Best rated'],
  ['best-weighted', 'Best rated (weighted)'],
  ['most-popular', 'Most popular'],
  ['stalest', 'Least recently read']
];

type AutoAddFilter = 'all' | 'on' | 'off';

const WatchItemsPage: React.FC = () => {
  const [watchItems, setWatchItems] = useState<WatchItem[]>([]);
  // What the server answered about the whole set, not the page: how many matched
  // the filters, how many are configured, and every tag worth filtering by
  const [matched, setMatched] = useState(0);
  const [total, setTotal] = useState(0);
  const [tagOptions, setTagOptions] = useState<TagOption[]>([]);
  const [search, setSearch] = useState('');
  // What the requests actually carry. Held apart from `search` so the field
  // stays responsive while the query it sends settles.
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('config');
  const [autoAddFilter, setAutoAddFilter] = useState<AutoAddFilter>('all');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  // Only the rows being refreshed one at a time; the rest carry their own
  const [rowState, setRowState] = useState<Record<number, RowState>>({});
  const [loadingMore, setLoadingMore] = useState(false);
  // Abandons a run as soon as a newer one starts, so a slow answer to an old
  // query cannot land on top of a fresher one — the filters change faster than
  // two hundred listings can be read
  const pageRun = useRef(0);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showEditForm, setShowEditForm] = useState(false);
  const [editingItem, setEditingItem] = useState<WatchItem | null>(null);
  const [newItem, setNewItem] = useState<Omit<WatchItem, 'id'>>({
    path: '',
    tags: [],
    filters: null,
    auto_add: true,
  });
  const [editItem, setEditItem] = useState<Omit<WatchItem, 'id'>>({
    path: '',
    tags: [],
    filters: null,
    auto_add: true,
  });
  const [tagInput, setTagInput] = useState('');
  const [editTagInput, setEditTagInput] = useState('');
  const [testResult, setTestResult] = useState<LetterboxdTestResult | null>(null);
  const [editTestResult, setEditTestResult] = useState<LetterboxdTestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [editTesting, setEditTesting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState<number | null>(null);

  // Names the query the rows on screen were fetched for. The observer watching
  // the bottom of the list re-arms on every filter change, and it would
  // otherwise be free to fire in the gap before the new first page lands —
  // asking for "the next hundred" at an offset counted from the rows of the
  // query just abandoned, and appending them under a heading they do not
  // belong to. Nothing is fetched until what is on screen matches what is asked.
  const queryKey = JSON.stringify([
    debouncedSearch.trim(), autoAddFilter, [...selectedTags].sort(), sort
  ]);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);

  // What every request carries. Gathered in one place so the effect that loads
  // the first page and the observer that loads the rest cannot drift apart.
  const query = useCallback((offset: number) => ({
    offset,
    limit: PAGE_SIZE,
    search: debouncedSearch.trim(),
    auto_add: autoAddFilter,
    tags: selectedTags,
    sort
  }), [debouncedSearch, autoAddFilter, selectedTags, sort]);

  // Refreshing one list re-reads only that one, leaving the rest of the page
  // alone. Its name and last-read date come back with its progress, so a
  // refreshed row is replaced whole rather than left showing the date it had.
  const reloadItem = useCallback(async (id: number) => {
    setRowState(previous => ({ ...previous, [id]: 'loading' }));
    try {
      const itemProgress = await watchItemsAPI.getProgress(id);
      setWatchItems(previous => previous.map(item =>
        item.id === id ? { ...item, progress: itemProgress } : item
      ));
      setRowState(previous => {
        const { [id]: _removed, ...rest } = previous;
        return rest;
      });
    } catch (error: any) {
      setRowState(previous => ({ ...previous, [id]: 'error' }));
    }
  }, []);

  // The first page of a query, replacing whatever was on screen. Every change of
  // search, filter or sort comes through here: the order is the server's, so a
  // page appended onto rows ordered by something else would interleave two
  // different orderings.
  const loadFirstPage = useCallback(async () => {
    pageRun.current += 1;
    const run = pageRun.current;
    setLoading(true);

    try {
      const page = await watchItemsAPI.getPage(query(0));
      if (run !== pageRun.current) return;
      setWatchItems(page.items);
      setMatched(page.matched);
      setTotal(page.total);
      setTagOptions(page.tag_options);
      setRowState({});
      setLoadedKey(queryKey);
    } catch (error: any) {
      if (run !== pageRun.current) return;
      toast.error('Failed to load watch items');
    } finally {
      if (run === pageRun.current) setLoading(false);
    }
  }, [query, queryKey]);

  // The next page, appended. Guarded on the run as well, so a page answered
  // after the filters moved on is dropped rather than appended to a list it
  // does not belong to.
  const loadNextPage = useCallback(async () => {
    pageRun.current += 1;
    const run = pageRun.current;
    setLoadingMore(true);

    try {
      const page = await watchItemsAPI.getPage(query(watchItems.length));
      if (run !== pageRun.current) return;
      setWatchItems(previous => [...previous, ...page.items]);
      setMatched(page.matched);
      setTotal(page.total);
    } catch (error: any) {
      if (run !== pageRun.current) return;
      toast.error('Failed to load more watch items');
    } finally {
      if (run === pageRun.current) setLoadingMore(false);
    }
  }, [query, watchItems.length]);

  // Everything a mutation has to do. The ids are positions in the configured
  // list and deleting one shifts every id after it, so an appended list built
  // on the old ids would be wrong: the only safe answer is to start again from
  // the first page, at the cost of where the page was scrolled to.
  const loadWatchItems = loadFirstPage;

  // Whether the list on screen is all of what matched, which is what says
  // there is another page to fetch when the bottom comes into view
  const hasMore = watchItems.length < matched;

  // The field stays responsive while the query it sends settles
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  // The bottom of the list coming into view is what asks for the next page. An
  // observer rather than a scroll handler: it fires when the sentinel is
  // actually visible, which is the question being asked, and it costs nothing
  // on the scrolls where it is not.
  //
  // The margin starts the fetch a screen early, so the rows are usually there
  // by the time the last of the current ones is reached.
  const sentinel = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = sentinel.current;
    // No node while the first page is loading or the list is empty, nothing to
    // fetch once every matching list is in hand, and nothing to append while
    // the rows on screen still belong to the query before this one
    if (!node || !hasMore || loading || loadingMore || loadedKey !== queryKey) return;

    const observer = new IntersectionObserver(
      entries => { if (entries[0].isIntersecting) loadNextPage(); },
      { rootMargin: '600px' }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, loading, loadingMore, loadNextPage, loadedKey, queryKey]);

  // Reloads on every change of query, since all of it is decided on the server
  useEffect(() => {
    loadFirstPage();
  }, [loadFirstPage]);

  // The progress of a list, or null while a refresh of that row is in flight or
  // has failed. It arrives on the row, so there is no waiting on a second
  // request for it any more.
  const progressOf = (item: WatchItem): WatchItemProgress | null => {
    if (item.id !== undefined && rowState[item.id]) return null;
    return item.progress ?? null;
  };

  // How Letterboxd rates a list, null until some film of it has been rated. The
  // ratings are read a film at a time in the background, so a list that has
  // just been added has none for a while after its listing is in.
  const ratingsOf = (item: WatchItem): WatchItemRatings | null => {
    const state = progressOf(item);
    return state?.ratings?.rating != null ? state.ratings : null;
  };

  // What a row cannot show on one line: the Letterboxd name, whether it auto-adds,
  // its tags, and when it was last read. Searching matches the name and the tags
  // and one sort goes by the read date, so all of them belong here to explain a row
  // that matched or ordered on something not on screen.
  const itemSummary = (item: WatchItem): string[] => [
    watchItemAddress(item),
    item.name ?? '',
    item.auto_add === false
      ? 'Auto-add off — movies are tracked but not sent to Radarr'
      : 'Auto-add on — new movies go to Radarr',
    item.tags && item.tags.length > 0 ? `Tags: ${item.tags.join(', ')}` : 'No tags',
    item.last_refreshed != null
      ? `Read from Letterboxd ${relativeTime(item.last_refreshed)}`
      : 'Never read from Letterboxd'
  ];

  // Carries no outer spacing of its own: the row sits it on its one line
  const renderProgress = (item: WatchItem) => {
    const state = (item.id !== undefined && rowState[item.id]) || item.progress;

    if (!state) {
      return null;
    }

    // Terse on the row, with the whole of it on the hover, since a row is one
    // line and a sentence in the middle of it would push the buttons off the end
    const note = (text: string, explanation: string, className = 'text-dark-text-muted') => (
      <Tooltip lines={[text, explanation]} focusable={false} className="inline-flex">
        <span className={`whitespace-nowrap ${className}`}>{text}</span>
      </Tooltip>
    );

    if (state === 'loading') {
      return (
        <span className="flex items-center whitespace-nowrap text-dark-text-muted">
          <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-dark-text-muted mr-2"></div>
          Reading
        </span>
      );
    }

    if (state === 'error') {
      return note('Progress unavailable', "Could not read this list's progress.",
                  'text-brand-orange');
    }

    if (!state.read) {
      return note('Not read yet',
                  'This list has not been read from Letterboxd yet. It is read in the '
                  + 'background, or refresh it now.');
    }

    if (state.total === 0) {
      return note('No movies', 'No movies were found in this list.');
    }

    if (state.watched === null) {
      return note(`${state.total} movies`,
                  'Set your Letterboxd username in Configuration to see how much of this '
                  + 'list you have watched.');
    }

    const categories = progressCategories(state.categories);

    if (categories.length === 0) {
      return note(`${state.total} unreleased`,
                  'Everything in this list is still unreleased, so none of it can have '
                  + 'been watched.');
    }

    return (
      <span className="flex items-center gap-2">
        <CategoryRings categories={categories} />
        <span className="text-dark-text-muted whitespace-nowrap">
          {state.watched}/{state.total} watched
        </span>
      </span>
    );
  };

  // The list's average on the row, with what it is over and what it weighs
  // against on the hover: the row has space for one number, and the average on
  // its own would be read as a verdict on a three-film list as much as on an
  // eighty-film one. Nothing is shown at all until some film has been rated,
  // rather than a placeholder on every row of a database still filling up.
  const renderRating = (item: WatchItem) => {
    const ratings = ratingsOf(item);

    if (!ratings || ratings.rating === null) {
      return null;
    }

    // Said in this order, and with the popularity line marked off as its own
    // thing, because four numbers in one bubble read as four inputs to the last
    // of them: neither figure below is worked out from how many ratings a film
    // has drawn, and an unrated film is left out rather than counted as a zero.
    const total = progressOf(item)?.total;
    const unrated = total === undefined ? 0 : total - ratings.rated;

    const lines = [
      `${ratings.rating.toFixed(2)} average on Letterboxd`,
      ratings.rated === 1
        ? 'Over the one film of this list that members have rated.'
        : `Over the ${ratings.rated} films of this list that members have rated.`,
      unrated > 0
        ? `The other ${unrated} carry no rating yet and are left out, not counted as zero.`
        : null
    ];

    if (ratings.weighted_rating !== null) {
      lines.push(`${ratings.weighted_rating.toFixed(2)} weighted — that average and how `
        + 'many films it is over, and nothing else: short lists are pulled towards the '
        + 'average across all your lists, long filmographies are credited for their size.');
    }

    if (ratings.popularity !== null) {
      lines.push(`Separately: its rated films have drawn ${ratings.popularity.toLocaleString()} `
        + 'ratings each, typically. That orders the popularity sort alone and has no part '
        + 'in either figure above.');
    }

    return (
      <Tooltip lines={lines} focusable={false} className="inline-flex">
        <span className="whitespace-nowrap text-dark-text-muted">
          ★ {ratings.rating.toFixed(1)}
        </span>
      </Tooltip>
    );
  };

  const clearFilters = () => {
    setSearch('');
    setAutoAddFilter('all');
    setSelectedTags([]);
  };

  const handleAddTags = () => {
    if (tagInput.trim()) {
      const tags = tagInput.split(',').map(tag => tag.trim()).filter(tag => tag);
      setNewItem({ ...newItem, tags: [...newItem.tags, ...tags] });
      setTagInput('');
    }
  };

  const removeTag = (index: number) => {
    setNewItem({
      ...newItem,
      tags: newItem.tags.filter((_, i) => i !== index),
    });
  };

  const removeEditTag = (index: number) => {
    setEditItem({
      ...editItem,
      tags: editItem.tags.filter((_, i) => i !== index),
    });
  };

  const handleAddEditTags = () => {
    if (editTagInput.trim()) {
      const tags = editTagInput.split(',').map(tag => tag.trim()).filter(tag => tag);
      setEditItem({ ...editItem, tags: [...editItem.tags, ...tags] });
      setEditTagInput('');
    }
  };

  const handleEditClick = (item: WatchItem) => {
    setEditingItem(item);
    setEditItem({
      path: item.path,
      tags: [...(item.tags ?? [])],
      filters: item.filters,
      auto_add: item.auto_add ?? true,
    });
    setShowEditForm(true);
  };

  const testLetterboxdUrl = async () => {
    if (!newItem.path) return;
    
    setTesting(true);
    try {
      const result = await letterboxdAPI.testWatchItem(newItem);
      setTestResult(result);
    } catch (error: any) {
      setTestResult({ valid: false, error: error.message });
    } finally {
      setTesting(false);
    }
  };

  const testEditLetterboxdUrl = async () => {
    if (!editItem.path) return;
    
    setEditTesting(true);
    try {
      const result = await letterboxdAPI.testWatchItem(editItem);
      setEditTestResult(result);
    } catch (error: any) {
      setEditTestResult({ valid: false, error: error.message });
    } finally {
      setEditTesting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await watchItemsAPI.create(newItem);
      toast.success('Watch item added successfully!');
      setShowAddForm(false);
      setNewItem({ path: '', tags: [], filters: null, auto_add: true });
      setTestResult(null);
      loadWatchItems();
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Failed to add watch item');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem) return;
    
    setEditing(true);
    try {
      await watchItemsAPI.update(editingItem.id!, editItem);
      toast.success('Watch item updated successfully!');
      setShowEditForm(false);
      setEditingItem(null);
      setEditItem({ path: '', tags: [], filters: null, auto_add: true });
      setEditTestResult(null);
      loadWatchItems();
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Failed to update watch item');
    } finally {
      setEditing(false);
    }
  };

  const handleRefresh = async (item: WatchItem) => {
    if (item.id === undefined) return;

    setRefreshing(item.id);
    try {
      // Answers once the list is stored, so both of these read off the new one
      await watchItemsAPI.refresh(item.id);
      await reloadItem(item.id);
      toast.success(`${watchItemAddress(item)} re-read from Letterboxd`);
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Failed to refresh this watch item');
    } finally {
      setRefreshing(null);
    }
  };

  const handleDelete = async (id: number) => {
    if (window.confirm('Are you sure you want to delete this watch item?')) {
      setDeleting(id);
      try {
        await watchItemsAPI.delete(id);
        toast.success('Watch item deleted successfully!');
        loadWatchItems();
      } catch (error: any) {
        toast.error(error.response?.data?.detail || 'Failed to delete watch item');
      } finally {
        setDeleting(null);
      }
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

  const filtersActive =
    search.trim() !== '' || autoAddFilter !== 'all' || selectedTags.length > 0;

  // Ordered on ratings none of the lists in hand have yet, so the order on
  // screen is the one the server could give and nothing says why
  const ratingSortPending =
    (sort === 'best-rated' || sort === 'best-weighted' || sort === 'most-popular')
    && watchItems.length > 0
    && watchItems.every(item => ratingsOf(item) === null);

  return (
    <Layout>
      <div className="px-4 py-6 sm:px-0">
        <div className="border-b border-dark-border pb-5 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold leading-6 text-dark-text-primary">Watch Items</h1>
            <p className="mt-2 max-w-4xl text-sm text-dark-text-muted">
              Manage your Letterboxd lists to sync with Radarr.
            </p>
          </div>
          <button
            onClick={() => setShowAddForm(true)}
            className="btn-primary flex"
          >
            <PlusIcon className="w-4 mr-2" />
            Add Watch Item
          </button>
        </div>

        {/* Add Form Modal */}
        {showAddForm && (
          <div className="fixed inset-0 bg-black bg-opacity-50 overflow-y-auto h-full w-full z-50">
            <div className="relative top-20 mx-auto p-5 w-11/12 md:w-3/4 lg:w-1/2 shadow-lg rounded-md card">
              <div className="mt-3">
                <h3 className="text-lg font-medium text-dark-text-primary mb-4">Add New Watch Item</h3>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-dark-text-secondary">
                      Letterboxd Path
                    </label>
                    <div className="mt-1 flex rounded-md shadow-sm">
                      {!isLink(newItem.path) && (
                        <span className="inline-flex items-center px-3 rounded-l-md border border-r-0 border-dark-border bg-dark-bg-tertiary text-dark-text-muted text-sm">
                          letterboxd.com/
                        </span>
                      )}
                      <input
                        type="text"
                        value={newItem.path}
                        onChange={(e) => setNewItem({ ...newItem, path: e.target.value })}
                        disabled={submitting}
                        className={`input-field w-full disabled:opacity-50 ${
                          isLink(newItem.path) ? 'rounded-md' : 'rounded-none rounded-r-md'
                        }`}
                        placeholder="username/watchlist"
                        required
                      />
                    </div>
                    <p className="mt-2 text-sm text-dark-text-muted">
                      {PATH_EXAMPLES}
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-dark-text-secondary">
                      Tags (optional)
                    </label>
                    <div className="mt-1 flex rounded-md shadow-sm">
                      <input
                        type="text"
                        value={tagInput}
                        onChange={(e) => setTagInput(e.target.value)}
                        onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddTags())}
                        className="input-field rounded-l-md rounded-r-none w-full"
                        placeholder="Add tags separated by commas"
                      />
                      <button
                        type="button"
                        onClick={handleAddTags}
                        className="btn-secondary border-l-0 rounded-l-none"
                      >
                        Add
                      </button>
                    </div>
                    {newItem.tags.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {newItem.tags.map((tag, index) => (
                          <span
                            key={index}
                            className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-brand-blue/20 text-brand-blue border border-brand-blue/30"
                          >
                            {tag}
                            <button
                              type="button"
                              onClick={() => removeTag(index)}
                              className="flex-shrink-0 ml-1.5 h-4 w-4 rounded-full inline-flex items-center justify-center text-brand-blue/70 hover:bg-brand-blue/20 hover:text-brand-blue focus:outline-none focus:bg-brand-blue focus:text-white"
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <div className="flex items-center">
                      <input
                        id="auto-add"
                        type="checkbox"
                        checked={newItem.auto_add}
                        onChange={(e) => setNewItem({ ...newItem, auto_add: e.target.checked })}
                        disabled={submitting}
                        className="h-4 w-4 text-brand-blue focus:ring-brand-blue border-dark-border bg-dark-bg-tertiary rounded disabled:opacity-50"
                      />
                      <label htmlFor="auto-add" className="ml-2 block text-sm text-white">
                        Automatically add movies to Radarr
                      </label>
                    </div>
                    <p className="mt-1 text-sm text-gray-500">
                      When disabled, movies will only be tracked but not automatically added to Radarr
                    </p>
                  </div>

                  <div className="flex justify-between">
                    <button
                      type="button"
                      onClick={testLetterboxdUrl}
                      disabled={!newItem.path || testing || submitting}
                      className="btn-secondary text-sm disabled:opacity-50"
                    >
                      {testing ? 'Testing...' : 'Test URL'}
                    </button>
                    
                    {testResult && (
                      <div className="flex items-center">
                        {testResult.valid ? (
                          <div className="flex items-center text-brand-green">
                            <CheckCircleIcon className="h-5 w-5 mr-2" />
                            <span className="text-sm">
                              Valid ({testResult.movie_count} movies found)
                            </span>
                          </div>
                        ) : (
                          <div className="flex items-center text-brand-orange">
                            <ExclamationCircleIcon className="h-5 w-5 mr-2" />
                            <span className="text-sm">
                              Invalid: {testResult.error}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex justify-end space-x-3">
                    <button
                      type="button"
                      onClick={() => {
                        setShowAddForm(false);
                        setNewItem({ path: '', tags: [], filters: null, auto_add: true });
                        setTestResult(null);
                      }}
                      className="btn-secondary text-sm"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={submitting}
                      className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {submitting && (
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                      )}
                      {submitting ? 'Adding...' : 'Add Watch Item'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        )}

        {/* Edit Form Modal */}
        {showEditForm && (
          <div className="fixed inset-0 bg-black bg-opacity-50 overflow-y-auto h-full w-full z-50">
            <div className="relative top-20 mx-auto p-5 w-11/12 md:w-3/4 lg:w-1/2 shadow-lg rounded-md card">
              <div className="mt-3">
                <h3 className="text-lg font-medium text-dark-text-primary mb-4">Edit Watch Item</h3>
                <form onSubmit={handleEditSubmit} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-dark-text-secondary">
                      Letterboxd Path
                    </label>
                    <div className="mt-1 flex rounded-md shadow-sm">
                      {!isLink(editItem.path) && (
                        <span className="inline-flex items-center px-3 rounded-l-md border border-r-0 border-dark-border bg-dark-bg-tertiary text-dark-text-muted text-sm">
                          letterboxd.com/
                        </span>
                      )}
                      <input
                        type="text"
                        value={editItem.path}
                        onChange={(e) => setEditItem({ ...editItem, path: e.target.value })}
                        disabled={editing}
                        className={`input-field w-full disabled:opacity-50 ${
                          isLink(editItem.path) ? 'rounded-md' : 'rounded-none rounded-r-md'
                        }`}
                        placeholder="username/watchlist"
                        required
                      />
                    </div>
                    <p className="mt-2 text-sm text-dark-text-muted">
                      {PATH_EXAMPLES}
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-dark-text-secondary">
                      Tags (optional)
                    </label>
                    <div className="mt-1 flex rounded-md shadow-sm">
                      <input
                        type="text"
                        value={editTagInput}
                        onChange={(e) => setEditTagInput(e.target.value)}
                        onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddEditTags())}
                        className="input-field rounded-l-md rounded-r-none w-full"
                        placeholder="Add tags separated by commas"
                      />
                      <button
                        type="button"
                        onClick={handleAddEditTags}
                        className="btn-secondary border-l-0 rounded-l-none"
                      >
                        Add
                      </button>
                    </div>
                    {editItem.tags.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {editItem.tags.map((tag, index) => (
                          <span
                            key={index}
                            className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-brand-blue/20 text-brand-blue border border-brand-blue/30"
                          >
                            {tag}
                            <button
                              type="button"
                              onClick={() => removeEditTag(index)}
                              className="flex-shrink-0 ml-1.5 h-4 w-4 rounded-full inline-flex items-center justify-center text-brand-blue/70 hover:bg-brand-blue/20 hover:text-brand-blue focus:outline-none focus:bg-brand-blue focus:text-white"
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <div className="flex items-center">
                      <input
                        id="edit-auto-add"
                        type="checkbox"
                        checked={editItem.auto_add}
                        onChange={(e) => setEditItem({ ...editItem, auto_add: e.target.checked })}
                        disabled={editing}
                        className="h-4 w-4 text-brand-blue focus:ring-brand-blue border-dark-border bg-dark-bg-tertiary rounded disabled:opacity-50"
                      />
                      <label htmlFor="edit-auto-add" className="ml-2 block text-sm text-white">
                        Automatically add movies to Radarr
                      </label>
                    </div>
                    <p className="mt-1 text-sm text-gray-500">
                      When disabled, movies will only be tracked but not automatically added to Radarr
                    </p>
                  </div>

                  <div className="flex justify-between">
                    <button
                      type="button"
                      onClick={testEditLetterboxdUrl}
                      disabled={!editItem.path || editTesting || editing}
                      className="btn-secondary text-sm disabled:opacity-50"
                    >
                      {editTesting ? 'Testing...' : 'Test URL'}
                    </button>
                    
                    {editTestResult && (
                      <div className="flex items-center">
                        {editTestResult.valid ? (
                          <div className="flex items-center text-brand-green">
                            <CheckCircleIcon className="h-5 w-5 mr-2" />
                            <span className="text-sm">
                              Valid ({editTestResult.movie_count} movies found)
                            </span>
                          </div>
                        ) : (
                          <div className="flex items-center text-brand-orange">
                            <ExclamationCircleIcon className="h-5 w-5 mr-2" />
                            <span className="text-sm">
                              Invalid: {editTestResult.error}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex justify-end space-x-3">
                    <button
                      type="button"
                      onClick={() => {
                        setShowEditForm(false);
                        setEditingItem(null);
                        setEditItem({ path: '', tags: [], filters: null, auto_add: true });
                        setEditTestResult(null);
                      }}
                      className="btn-secondary text-sm"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={editing}
                      className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {editing && (
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                      )}
                      {editing ? 'Updating...' : 'Update Watch Item'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        )}

        {/* Search, sort and filters on one row, kept in reach while scrolling */}
        {watchItems.length > 0 && (
          <div className="sticky top-0 z-10 mt-6 flex flex-wrap items-center gap-2 bg-dark-bg-primary py-3">
            <div className="relative min-w-64 max-w-sm flex-1">
              <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-dark-text-muted" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="input-field h-9 w-full py-0 pl-9 text-sm"
                placeholder="Search by path, name or tag"
                aria-label="Search watch items by path, name or tag"
              />
            </div>

            {/* Hidden when no tag is on more than one list: there would be
                nothing in it to pick */}
            {tagOptions.length > 0 && (
              <TagFilter
                options={tagOptions}
                selected={selectedTags}
                onChange={setSelectedTags}
              />
            )}

            <div className="flex h-9 items-stretch overflow-hidden rounded-md border border-dark-border">
              {([['all', 'All'], ['on', 'Auto-add on'], ['off', 'Auto-add off']] as [AutoAddFilter, string][])
                .map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setAutoAddFilter(value)}
                    aria-pressed={autoAddFilter === value}
                    className={`whitespace-nowrap px-3 text-xs font-medium ${
                      autoAddFilter === value
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
              {matched === total
                ? `${total} list${total === 1 ? '' : 's'}`
                : `${matched} of ${total}`}
            </span>

            <label className="ml-2 flex items-center gap-2 whitespace-nowrap text-xs text-dark-text-muted">
              Sort
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
                className="input-field h-9 py-0 text-sm"
                aria-label="Sort watch items"
              >
                {SORTS.map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </label>
          </div>
        )}

        {/* Ratings are read a film at a time in the background, so the three
            sorts that go by them do nothing at all on a database that has not
            got to any of the lists on screen yet. Without this that reads as a
            sort that does not work rather than as one waiting on a read. */}
        {ratingSortPending && (
          <p className="mt-2 text-xs text-dark-text-muted">
            None of these lists have their Letterboxd ratings yet. They are read in the
            background, a few hundred films at a time, and this order fills in as they arrive.
          </p>
        )}

        {/* Watch Items List */}
        <div className="mt-6">
          {watchItems.length === 0 ? (
            <div className="text-center py-12">
              <FilmIcon className="mx-auto h-12 w-12 text-dark-text-muted" />
              <h3 className="mt-2 text-sm font-medium text-dark-text-primary">No watch items</h3>
              <p className="mt-1 text-sm text-dark-text-muted">
                Get started by adding a Letterboxd list to sync.
              </p>
            </div>
          ) : watchItems.length === 0 ? (
            <div className="text-center py-12">
              <MagnifyingGlassIcon className="mx-auto h-12 w-12 text-dark-text-muted" />
              <h3 className="mt-2 text-sm font-medium text-dark-text-primary">No matching watch items</h3>
              <p className="mt-1 text-sm text-dark-text-muted">
                {search.trim()
                  ? `No path, name or tag matches "${search.trim()}".`
                  : 'None of your lists match the filters you have set.'}
              </p>
              <button type="button" onClick={clearFilters} className="btn-secondary text-sm mt-4">
                Clear filters
              </button>
            </div>
          ) : (
            <div className="card overflow-hidden">
              <ul className="divide-y divide-dark-border">
                {watchItems.map((item) => (
                  <li key={item.id} className="px-4 py-2">
                    {/* One line per list: the path takes what room is left, and
                        everything that is not needed at a glance is on the hover
                        summary rather than on a line of its own */}
                    <div className="flex items-center gap-4">
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        {/* The summary hangs off this one icon rather than the whole
                            row, so passing over a path does not raise a bubble.
                            An information mark rather than a film strip: it is here
                            to be hovered, and the film strip already means "Films"
                            on the category rings to the right. */}
                        <Tooltip
                          lines={itemSummary(item)}
                          className="inline-flex flex-shrink-0 rounded p-1 text-dark-text-muted hover:text-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue"
                        >
                          <InformationCircleIcon className="h-4 w-4" />
                        </Tooltip>
                        <p className="truncate text-sm font-medium text-dark-text-primary">
                          {watchItemAddress(item)}
                        </p>
                      </div>
                      <div className="flex flex-shrink-0 items-center gap-3 text-xs">
                        {renderRating(item)}
                        {renderProgress(item)}
                      </div>
                      <div className="flex flex-shrink-0 items-center space-x-2">
                        <Link
                          to={`/movies/${item.id}`}
                          className="text-brand-blue hover:text-brand-blue/80 text-sm font-medium"
                        >
                          View Movies
                        </Link>
                        {/* No tooltips on these: aria-label still names each one
                            for anything not reading the picture */}
                        <button
                          onClick={() => handleEditClick(item)}
                          className="inline-flex items-center p-1 border border-transparent rounded-full shadow-sm text-dark-text-muted hover:bg-dark-bg-tertiary focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-blue"
                          aria-label={`Edit ${watchItemAddress(item)}`}
                        >
                          <PencilIcon className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleRefresh(item)}
                          disabled={refreshing === item.id}
                          className="inline-flex items-center p-1 border border-transparent rounded-full shadow-sm text-dark-text-muted hover:bg-dark-bg-tertiary focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-blue disabled:opacity-50 disabled:cursor-not-allowed"
                          aria-label={`Refresh ${watchItemAddress(item)}`}
                        >
                          <ArrowPathIcon className={`h-4 w-4 ${refreshing === item.id ? 'animate-spin' : ''}`} />
                        </button>
                        <button
                          onClick={() => handleDelete(item.id!)}
                          disabled={deleting === item.id}
                          className="inline-flex items-center p-1 border border-transparent rounded-full shadow-sm text-red-500 hover:bg-brand-orange/10 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-orange disabled:opacity-50 disabled:cursor-not-allowed"
                          aria-label={`Delete ${watchItemAddress(item)}`}
                        >
                          {deleting === item.id ? (
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-red-500"></div>
                          ) : (
                            <TrashIcon className="h-4 w-4" />
                          )}
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>

              {/* Sits below the last row and is watched rather than clicked.
                  Rendered only while there is a page left, so reaching the end
                  of the list is the end of it rather than a spinner that never
                  resolves. */}
              {hasMore && (
                <div ref={sentinel} className="flex items-center justify-center gap-2 py-4">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-brand-blue"></div>
                  <span className="text-xs text-dark-text-muted">
                    Loading {Math.min(PAGE_SIZE, matched - watchItems.length)} more
                    {' '}of {matched}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
};

export default WatchItemsPage;