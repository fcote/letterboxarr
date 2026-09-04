import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { moviesAPI, watchItemsAPI } from '../utils/api';
import { WatchItemMovies, Movie } from '../types';
import toast from 'react-hot-toast';
import Layout from '../components/Layout';
import Tooltip from '../components/Tooltip';
import { ProgressTrack } from '../components/CategoryProgress';
import { MOVIE_CATEGORIES } from '../utils/categories';
import { relativeTime } from '../utils/time';
import { watchItemPath } from '../utils/letterboxd';
import {
  ArrowPathIcon,
  CheckCircleIcon,
  ExclamationCircleIcon,
  EyeIcon,
  EyeSlashIcon,
  FilmIcon,
  PlusIcon
} from '@heroicons/react/24/outline';

const APP_TITLE = 'Letterboxarr';

const MoviesPage: React.FC = () => {
  const { itemId } = useParams<{ itemId: string }>();
  const [movieData, setMovieData] = useState<WatchItemMovies | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [addingMovie, setAddingMovie] = useState<string | null>(null);

  useEffect(() => {
    if (itemId) {
      loadMovies(parseInt(itemId));
    }
  }, [itemId]);

  // Name the list in the tab and in the history entry by its Letterboxd path,
  // which is how the watch items page labels it too. The plain app name goes back
  // on the way out so another page is not left under this list's title. Where the
  // list was read from rather than what was configured, so one watched through a
  // share link is named by the list it stands for and not by its boxd.it code.
  const address = movieData ? watchItemPath(movieData.watch_item) : undefined;

  useEffect(() => {
    document.title = address ? `${address} · ${APP_TITLE}` : APP_TITLE;
    return () => {
      document.title = APP_TITLE;
    };
  }, [address]);

  const loadMovies = async (id: number) => {
    try {
      const data = await moviesAPI.getByWatchItem(id);
      setMovieData(data);
    } catch (error: any) {
      // A list Letterboxd would not give up comes back with why, which is the
      // difference between "check the path" and "try again later"
      toast.error(error.response?.data?.detail || 'Failed to load movies');
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    if (!itemId) return;

    const id = parseInt(itemId);
    setRefreshing(true);
    try {
      // Answers once the list is stored, so what follows reads the new one
      await watchItemsAPI.refresh(id);
      await loadMovies(id);
      toast.success('List re-read from Letterboxd');
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Failed to refresh this list');
    } finally {
      setRefreshing(false);
    }
  };

  const handleAddMovie = async (movie: Movie) => {
    if (!movieData) return;
    
    const movieKey = `${movie.title}_${movie.year}`;
    setAddingMovie(movieKey);
    
    try {
      await moviesAPI.addToRadarr({
        title: movie.title,
        year: movie.year,
        letterboxd_slug: movie.letterboxd_slug,
        tags: movieData.watch_item.tags
      });
      
      toast.success(`${movie.title} added to Radarr successfully!`);
      
      // Refresh the movie data to show updated status
      if (itemId) {
        await loadMovies(parseInt(itemId));
      }
    } catch (error: any) {
      toast.error(error.response?.data?.detail || `Failed to add ${movie.title} to Radarr`);
    } finally {
      setAddingMovie(null);
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

  if (!movieData) {
    return (
      <Layout>
        <div className="text-center py-12">
          <ExclamationCircleIcon className="mx-auto h-12 w-12 text-dark-text-muted" />
          <h3 className="mt-2 text-sm font-medium text-dark-text-primary">Movie data not found</h3>
          <p className="mt-1 text-sm text-dark-text-muted">
            Unable to load movies for this watch item.
          </p>
        </div>
      </Layout>
    );
  }

  const processedCount = movieData.movies.filter(movie => movie.processed).length;
  const unprocessedCount = movieData.movies.length - processedCount;
  const watchedCount = movieData.watched_count;

  // The movies already carry their category and watched flag, so each section
  // counts its own progress. Null means there is none to show, and the section
  // keeps a plain count: unreleased entries cannot have been watched, and
  // without a Letterboxd profile nothing is known to have been.
  const sections = MOVIE_CATEGORIES
    .map(section => {
      const movies = movieData.movies.filter(movie => (movie.category ?? 'film') === section.category);
      return {
        ...section,
        movies,
        watched: watchedCount == null || section.category === 'unreleased'
          ? null
          : movies.filter(movie => movie.watched).length
      };
    })
    .filter(section => section.movies.length > 0);

  // What Letterboxd's members make of the film, next to its title. Nothing at
  // all when there is no rating: that is every unreleased film and every film
  // the background rounds have not reached yet, and a placeholder on those
  // rows would say "unrated" about films that are merely unread.
  const renderRating = (movie: Movie) => {
    if (movie.rating == null) {
      return null;
    }

    return (
      <Tooltip
        lines={[
          `${movie.rating.toFixed(2)} average on Letterboxd`,
          movie.rating_count
            ? `From ${movie.rating_count.toLocaleString()} member ratings.`
            : null
        ]}
        focusable={false}
        className="inline-flex"
      >
        <span className="whitespace-nowrap text-xs font-normal text-dark-text-muted">
          ★ {movie.rating.toFixed(1)}
        </span>
      </Tooltip>
    );
  };

  const renderMovie = (movie: Movie, key: React.Key, Icon: React.ComponentType<React.ComponentProps<'svg'>>) => {
    const movieKey = `${movie.title}_${movie.year}`;

    return (
      <li key={key} className="px-4 py-4 sm:px-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <Icon className="h-5 w-5 text-dark-text-muted mr-3" />
            <div>
              <p className="flex items-baseline gap-2 text-sm font-medium text-dark-text-primary">
                <span>{movie.title}{movie.year ? ` (${movie.year})` : ''}</span>
                {renderRating(movie)}
              </p>
              {movie.letterboxd_url && (
                <p className="text-sm text-dark-text-muted">
                  <a
                    href={movie.letterboxd_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-brand-blue hover:text-brand-blue/80"
                  >
                    View on Letterboxd
                  </a>
                </p>
              )}
              {movie.tmdb_id && (
                <p className="text-xs text-dark-text-muted">TMDB ID: {movie.tmdb_id}</p>
              )}
            </div>
          </div>
          <div className="flex items-center space-x-3">
            {movie.watched === true && (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-brand-blue/20 text-brand-blue border border-brand-blue/30">
                <EyeIcon className="h-3 w-3 mr-1" />
                Watched
              </span>
            )}
            {movie.watched === false && (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-dark-bg-tertiary text-dark-text-muted border border-dark-border">
                <EyeSlashIcon className="h-3 w-3 mr-1" />
                Not watched
              </span>
            )}
            {movie.processed ? (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-brand-green/20 text-brand-green border border-brand-green/30">
                <CheckCircleIcon className="h-3 w-3 mr-1" />
                Added to Radarr
              </span>
            ) : (
              <>
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-brand-orange/20 text-brand-orange border border-brand-orange/30">
                  <ExclamationCircleIcon className="h-3 w-3 mr-1" />
                  Pending
                </span>
                <button
                  onClick={() => handleAddMovie(movie)}
                  disabled={addingMovie === movieKey}
                  className="btn-primary flex text-xs px-3 py-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {addingMovie === movieKey ? (
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
              </>
            )}
          </div>
        </div>
      </li>
    );
  };

  return (
    <Layout>
      <div className="py-6 lg:py-8">
        <div className="border-b border-dark-border pb-5 flex justify-between items-start gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold leading-6 text-dark-text-primary">
              Movies from {address}
            </h1>
            <p className="mt-2 max-w-4xl text-sm text-dark-text-muted">
              Viewing {movieData.total_count} movies from this Letterboxd list
              {movieData.last_refreshed != null && `, read ${relativeTime(movieData.last_refreshed)}`}.
            </p>
            {movieData.watch_item.tags && movieData.watch_item.tags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {movieData.watch_item.tags.map((tag, index) => (
                  <span
                    key={index}
                    className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-brand-blue/20 text-brand-blue border border-brand-blue/30"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="btn-secondary flex items-center text-sm flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
            title="Read this list from Letterboxd again, ahead of its next scheduled refresh"
          >
            <ArrowPathIcon className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        {/* Statistics */}
        <div className={`mt-6 grid grid-cols-1 gap-5 ${watchedCount == null ? 'sm:grid-cols-3' : 'sm:grid-cols-4'}`}>
          <div className="card overflow-hidden">
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <FilmIcon className="h-6 w-6 text-dark-text-muted" />
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-dark-text-muted truncate">Total Movies</dt>
                    <dd className="text-lg font-medium text-dark-text-primary">{movieData.total_count}</dd>
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
                    <dt className="text-sm font-medium text-dark-text-muted truncate">Added to Radarr</dt>
                    <dd className="text-lg font-medium text-dark-text-primary">{processedCount}</dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>

          <div className="card overflow-hidden">
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <ExclamationCircleIcon className="h-6 w-6 text-brand-orange" />
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-dark-text-muted truncate">Pending</dt>
                    <dd className="text-lg font-medium text-dark-text-primary">{unprocessedCount}</dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>

          {watchedCount != null && (
            <div className="card overflow-hidden">
              <div className="p-5">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <EyeIcon className="h-6 w-6 text-brand-blue" />
                  </div>
                  <div className="ml-5 w-0 flex-1">
                    <dl>
                      <dt className="text-sm font-medium text-dark-text-muted truncate">Already Watched</dt>
                      <dd className="text-lg font-medium text-dark-text-primary">{watchedCount}</dd>
                    </dl>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Movies, split by category */}
        {sections.map(section => (
          <div key={section.category} className="mt-6">
            <div className="card overflow-hidden">
              <div className="px-4 py-5 sm:px-6">
                <div className="flex items-center">
                  <section.icon className="h-5 w-5 text-dark-text-muted mr-3" />
                  <h3 className="text-lg leading-6 font-medium text-dark-text-primary">
                    {section.title}
                  </h3>
                  {section.watched === null ? (
                    <span className="ml-3 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-dark-border text-dark-text-muted">
                      {section.movies.length}
                    </span>
                  ) : (
                    <div className="ml-4 flex items-center gap-2">
                      <ProgressTrack
                        watched={section.watched}
                        total={section.movies.length}
                        className="w-48"
                      />
                      <span className="text-xs text-dark-text-muted whitespace-nowrap">
                        {section.watched}/{section.movies.length} watched
                      </span>
                    </div>
                  )}
                </div>
                <p className="mt-1 max-w-2xl text-sm text-dark-text-muted">
                  {section.description}
                </p>
              </div>
              <ul className="divide-y divide-dark-border">
                {section.movies.map((movie, index) => renderMovie(movie, movie.letterboxd_slug || index, section.icon))}
              </ul>
            </div>
          </div>
        ))}

        {movieData.movies.length === 0 && (
          <div className="text-center py-12">
            <FilmIcon className="mx-auto h-12 w-12 text-dark-text-muted" />
            <h3 className="mt-2 text-sm font-medium text-dark-text-primary">No movies found</h3>
            <p className="mt-1 text-sm text-dark-text-muted">
              No movies were found for this watch item.
            </p>
          </div>
        )}
      </div>
    </Layout>
  );
};

export default MoviesPage;