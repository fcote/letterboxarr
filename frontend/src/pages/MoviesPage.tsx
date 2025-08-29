import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { moviesAPI } from '../utils/api';
import { WatchItemMovies, Movie } from '../types';
import toast from 'react-hot-toast';
import Layout from '../components/Layout';
import { 
  CheckCircleIcon, 
  ExclamationCircleIcon,
  FilmIcon,
  PlusIcon
} from '@heroicons/react/24/outline';

const MoviesPage: React.FC = () => {
  const { itemId } = useParams<{ itemId: string }>();
  const [movieData, setMovieData] = useState<WatchItemMovies | null>(null);
  const [loading, setLoading] = useState(true);
  const [addingMovie, setAddingMovie] = useState<string | null>(null);

  useEffect(() => {
    if (itemId) {
      loadMovies(parseInt(itemId));
    }
  }, [itemId]);

  const loadMovies = async (id: number) => {
    try {
      const data = await moviesAPI.getByWatchItem(id);
      setMovieData(data);
    } catch (error: any) {
      toast.error('Failed to load movies');
    } finally {
      setLoading(false);
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

  return (
    <Layout>
      <div className="px-4 py-6 sm:px-0">
        <div className="border-b border-dark-border pb-5">
          <h1 className="text-2xl font-bold leading-6 text-dark-text-primary">
            Movies from {movieData.watch_item.path}
          </h1>
          <p className="mt-2 max-w-4xl text-sm text-dark-text-muted">
            Viewing {movieData.total_count} movies from this Letterboxd list.
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

        {/* Statistics */}
        <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-3">
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
        </div>

        {/* Movies List */}
        <div className="mt-6">
          <div className="card overflow-hidden">
            <div className="px-4 py-5 sm:px-6">
              <h3 className="text-lg leading-6 font-medium text-dark-text-primary">Movies</h3>
              <p className="mt-1 max-w-2xl text-sm text-dark-text-muted">
                List of all movies from this Letterboxd list and their sync status.
              </p>
            </div>
            <ul className="divide-y divide-dark-border">
              {movieData.movies.map((movie, index) => (
                <li key={index} className="px-4 py-4 sm:px-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center">
                      <FilmIcon className="h-5 w-5 text-dark-text-muted mr-3" />
                      <div>
                        <p className="text-sm font-medium text-dark-text-primary">
                          {movie.title} ({movie.year})
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
                            disabled={addingMovie === `${movie.title}_${movie.year}`}
                            className="btn-primary flex text-xs px-3 py-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {addingMovie === `${movie.title}_${movie.year}` ? (
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
              ))}
            </ul>
          </div>
        </div>

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