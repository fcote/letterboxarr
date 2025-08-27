import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { moviesAPI } from '../utils/api';
import { WatchItemMovies } from '../types';
import toast from 'react-hot-toast';
import Layout from '../components/Layout';
import { 
  CheckCircleIcon, 
  ExclamationCircleIcon,
  FilmIcon 
} from '@heroicons/react/24/outline';

const MoviesPage: React.FC = () => {
  const { itemId } = useParams<{ itemId: string }>();
  const [movieData, setMovieData] = useState<WatchItemMovies | null>(null);
  const [loading, setLoading] = useState(true);

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

  if (loading) {
    return (
      <Layout>
        <div className="flex justify-center items-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      </Layout>
    );
  }

  if (!movieData) {
    return (
      <Layout>
        <div className="text-center py-12">
          <ExclamationCircleIcon className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-2 text-sm font-medium text-gray-900">Movie data not found</h3>
          <p className="mt-1 text-sm text-gray-500">
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
        <div className="border-b border-gray-200 pb-5">
          <h1 className="text-2xl font-bold leading-6 text-gray-900">
            Movies from {movieData.watch_item.path}
          </h1>
          <p className="mt-2 max-w-4xl text-sm text-gray-500">
            Viewing {movieData.total_count} movies from this Letterboxd list.
          </p>
          {movieData.watch_item.tags && movieData.watch_item.tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {movieData.watch_item.tags.map((tag, index) => (
                <span
                  key={index}
                  className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Statistics */}
        <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-3">
          <div className="bg-white overflow-hidden shadow rounded-lg">
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <FilmIcon className="h-6 w-6 text-gray-400" />
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-gray-500 truncate">Total Movies</dt>
                    <dd className="text-lg font-medium text-gray-900">{movieData.total_count}</dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white overflow-hidden shadow rounded-lg">
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <CheckCircleIcon className="h-6 w-6 text-green-400" />
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-gray-500 truncate">Added to Radarr</dt>
                    <dd className="text-lg font-medium text-gray-900">{processedCount}</dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white overflow-hidden shadow rounded-lg">
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <ExclamationCircleIcon className="h-6 w-6 text-yellow-400" />
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-gray-500 truncate">Pending</dt>
                    <dd className="text-lg font-medium text-gray-900">{unprocessedCount}</dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Movies List */}
        <div className="mt-6">
          <div className="bg-white shadow overflow-hidden sm:rounded-md">
            <div className="px-4 py-5 sm:px-6">
              <h3 className="text-lg leading-6 font-medium text-gray-900">Movies</h3>
              <p className="mt-1 max-w-2xl text-sm text-gray-500">
                List of all movies from this Letterboxd list and their sync status.
              </p>
            </div>
            <ul className="divide-y divide-gray-200">
              {movieData.movies.map((movie, index) => (
                <li key={index} className="px-4 py-4 sm:px-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center">
                      <FilmIcon className="h-5 w-5 text-gray-400 mr-3" />
                      <div>
                        <p className="text-sm font-medium text-gray-900">
                          {movie.title} ({movie.year})
                        </p>
                        {movie.letterboxd_url && (
                          <p className="text-sm text-gray-500">
                            <a
                              href={movie.letterboxd_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 hover:text-blue-800"
                            >
                              View on Letterboxd
                            </a>
                          </p>
                        )}
                        {movie.tmdb_id && (
                          <p className="text-xs text-gray-400">TMDB ID: {movie.tmdb_id}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center">
                      {movie.processed ? (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                          <CheckCircleIcon className="h-3 w-3 mr-1" />
                          Added to Radarr
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                          <ExclamationCircleIcon className="h-3 w-3 mr-1" />
                          Pending
                        </span>
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
            <FilmIcon className="mx-auto h-12 w-12 text-gray-400" />
            <h3 className="mt-2 text-sm font-medium text-gray-900">No movies found</h3>
            <p className="mt-1 text-sm text-gray-500">
              No movies were found for this watch item.
            </p>
          </div>
        )}
      </div>
    </Layout>
  );
};

export default MoviesPage;