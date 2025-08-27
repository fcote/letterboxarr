import React, { useState, useEffect } from 'react';
import { watchItemsAPI, letterboxdAPI } from '../utils/api';
import { WatchItem, LetterboxdTestResult } from '../types';
import toast from 'react-hot-toast';
import Layout from '../components/Layout';
import { 
  PlusIcon, 
  TrashIcon, 
  CheckCircleIcon, 
  ExclamationCircleIcon,
  FilmIcon 
} from '@heroicons/react/24/outline';

const WatchItemsPage: React.FC = () => {
  const [watchItems, setWatchItems] = useState<WatchItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newItem, setNewItem] = useState<Omit<WatchItem, 'id'>>({
    path: '',
    tags: [],
    filters: null,
  });
  const [tagInput, setTagInput] = useState('');
  const [testResult, setTestResult] = useState<LetterboxdTestResult | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    loadWatchItems();
  }, []);

  const loadWatchItems = async () => {
    try {
      const items = await watchItemsAPI.getAll();
      setWatchItems(items);
    } catch (error: any) {
      toast.error('Failed to load watch items');
    } finally {
      setLoading(false);
    }
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await watchItemsAPI.create(newItem);
      toast.success('Watch item added successfully!');
      setShowAddForm(false);
      setNewItem({ path: '', tags: [], filters: null });
      setTestResult(null);
      loadWatchItems();
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Failed to add watch item');
    }
  };

  const handleDelete = async (id: number) => {
    if (window.confirm('Are you sure you want to delete this watch item?')) {
      try {
        await watchItemsAPI.delete(id);
        toast.success('Watch item deleted successfully!');
        loadWatchItems();
      } catch (error: any) {
        toast.error(error.response?.data?.detail || 'Failed to delete watch item');
      }
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

  return (
    <Layout>
      <div className="px-4 py-6 sm:px-0">
        <div className="border-b border-gray-200 pb-5 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold leading-6 text-gray-900">Watch Items</h1>
            <p className="mt-2 max-w-4xl text-sm text-gray-500">
              Manage your Letterboxd lists to sync with Radarr.
            </p>
          </div>
          <button
            onClick={() => setShowAddForm(true)}
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            <PlusIcon className="h-4 w-4 mr-2" />
            Add Watch Item
          </button>
        </div>

        {/* Add Form Modal */}
        {showAddForm && (
          <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
            <div className="relative top-20 mx-auto p-5 border w-11/12 md:w-3/4 lg:w-1/2 shadow-lg rounded-md bg-white">
              <div className="mt-3">
                <h3 className="text-lg font-medium text-gray-900 mb-4">Add New Watch Item</h3>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">
                      Letterboxd Path
                    </label>
                    <div className="mt-1 flex rounded-md shadow-sm">
                      <span className="inline-flex items-center px-3 rounded-l-md border border-r-0 border-gray-300 bg-gray-50 text-gray-500 text-sm">
                        letterboxd.com/
                      </span>
                      <input
                        type="text"
                        value={newItem.path}
                        onChange={(e) => setNewItem({ ...newItem, path: e.target.value })}
                        className="flex-1 min-w-0 block w-full px-3 py-2 rounded-none rounded-r-md border-gray-300 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                        placeholder="username/watchlist"
                        required
                      />
                    </div>
                    <p className="mt-2 text-sm text-gray-500">
                      Examples: username/watchlist, films/popular, actor/daniel-day-lewis
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700">
                      Tags (optional)
                    </label>
                    <div className="mt-1 flex rounded-md shadow-sm">
                      <input
                        type="text"
                        value={tagInput}
                        onChange={(e) => setTagInput(e.target.value)}
                        onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddTags())}
                        className="flex-1 min-w-0 block w-full px-3 py-2 rounded-l-md border-gray-300 focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                        placeholder="Add tags separated by commas"
                      />
                      <button
                        type="button"
                        onClick={handleAddTags}
                        className="inline-flex items-center px-3 py-2 border border-l-0 border-gray-300 rounded-r-md bg-gray-50 text-gray-500 text-sm hover:bg-gray-100"
                      >
                        Add
                      </button>
                    </div>
                    {newItem.tags.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {newItem.tags.map((tag, index) => (
                          <span
                            key={index}
                            className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800"
                          >
                            {tag}
                            <button
                              type="button"
                              onClick={() => removeTag(index)}
                              className="flex-shrink-0 ml-1.5 h-4 w-4 rounded-full inline-flex items-center justify-center text-blue-400 hover:bg-blue-200 hover:text-blue-500 focus:outline-none focus:bg-blue-500 focus:text-white"
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex justify-between">
                    <button
                      type="button"
                      onClick={testLetterboxdUrl}
                      disabled={!newItem.path || testing}
                      className="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm leading-4 font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
                    >
                      {testing ? 'Testing...' : 'Test URL'}
                    </button>
                    
                    {testResult && (
                      <div className="flex items-center">
                        {testResult.valid ? (
                          <div className="flex items-center text-green-600">
                            <CheckCircleIcon className="h-5 w-5 mr-2" />
                            <span className="text-sm">
                              Valid ({testResult.movie_count} movies found)
                            </span>
                          </div>
                        ) : (
                          <div className="flex items-center text-red-600">
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
                        setNewItem({ path: '', tags: [], filters: null });
                        setTestResult(null);
                      }}
                      className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                    >
                      Add Watch Item
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        )}

        {/* Watch Items List */}
        <div className="mt-6">
          {watchItems.length === 0 ? (
            <div className="text-center py-12">
              <FilmIcon className="mx-auto h-12 w-12 text-gray-400" />
              <h3 className="mt-2 text-sm font-medium text-gray-900">No watch items</h3>
              <p className="mt-1 text-sm text-gray-500">
                Get started by adding a Letterboxd list to sync.
              </p>
            </div>
          ) : (
            <div className="bg-white shadow overflow-hidden sm:rounded-md">
              <ul className="divide-y divide-gray-200">
                {watchItems.map((item) => (
                  <li key={item.id} className="px-6 py-4">
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center">
                          <FilmIcon className="h-5 w-5 text-gray-400 mr-3" />
                          <div>
                            <p className="text-sm font-medium text-gray-900 truncate">
                              letterboxd.com/{item.path}
                            </p>
                            {item.tags && item.tags.length > 0 && (
                              <div className="mt-1 flex flex-wrap gap-1">
                                {item.tags.map((tag, index) => (
                                  <span
                                    key={index}
                                    className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800"
                                  >
                                    {tag}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        <a
                          href={`/movies/${item.id}`}
                          className="text-blue-600 hover:text-blue-900 text-sm font-medium"
                        >
                          View Movies
                        </a>
                        <button
                          onClick={() => handleDelete(item.id!)}
                          className="inline-flex items-center p-1 border border-transparent rounded-full shadow-sm text-red-600 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
};

export default WatchItemsPage;