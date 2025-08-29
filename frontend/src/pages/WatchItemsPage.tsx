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
  FilmIcon,
  PencilIcon
} from '@heroicons/react/24/outline';

const WatchItemsPage: React.FC = () => {
  const [watchItems, setWatchItems] = useState<WatchItem[]>([]);
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
                      <span className="inline-flex items-center px-3 rounded-l-md border border-r-0 border-dark-border bg-dark-bg-tertiary text-dark-text-muted text-sm">
                        letterboxd.com/
                      </span>
                      <input
                        type="text"
                        value={newItem.path}
                        onChange={(e) => setNewItem({ ...newItem, path: e.target.value })}
                        disabled={submitting}
                        className="input-field rounded-none rounded-r-md w-full disabled:opacity-50"
                        placeholder="username/watchlist"
                        required
                      />
                    </div>
                    <p className="mt-2 text-sm text-dark-text-muted">
                      Examples: username/watchlist, films/popular, actor/daniel-day-lewis
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
                      <span className="inline-flex items-center px-3 rounded-l-md border border-r-0 border-dark-border bg-dark-bg-tertiary text-dark-text-muted text-sm">
                        letterboxd.com/
                      </span>
                      <input
                        type="text"
                        value={editItem.path}
                        onChange={(e) => setEditItem({ ...editItem, path: e.target.value })}
                        disabled={editing}
                        className="input-field rounded-none rounded-r-md w-full disabled:opacity-50"
                        placeholder="username/watchlist"
                        required
                      />
                    </div>
                    <p className="mt-2 text-sm text-dark-text-muted">
                      Examples: username/watchlist, films/popular, actor/daniel-day-lewis
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
          ) : (
            <div className="card overflow-hidden">
              <ul className="divide-y divide-dark-border">
                {watchItems.map((item) => (
                  <li key={item.id} className="px-6 py-4">
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center">
                          <FilmIcon className="h-5 w-5 text-dark-text-muted mr-3" />
                          <div>
                            <p className="text-sm font-medium text-dark-text-primary truncate">
                              letterboxd.com/{item.path}
                            </p>
                            <div className="mt-1 flex items-center gap-2">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                                item.auto_add !== false ? 'bg-brand-green/20 text-brand-green border border-brand-green/30' : 'bg-dark-bg-tertiary text-dark-text-muted border border-dark-border'
                              }`}>
                                {item.auto_add !== false ? 'Auto-add enabled' : 'Auto-add disabled'}
                              </span>
                              {item.tags && item.tags.length > 0 && item.tags.map((tag, index) => (
                                <span
                                  key={index}
                                  className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-brand-blue/20 text-brand-blue border border-brand-blue/30"
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        <a
                          href={`/movies/${item.id}`}
                          className="text-brand-blue hover:text-brand-blue/80 text-sm font-medium"
                        >
                          View Movies
                        </a>
                        <button
                          onClick={() => handleEditClick(item)}
                          className="inline-flex items-center p-1 border border-transparent rounded-full shadow-sm text-dark-text-muted hover:bg-dark-bg-tertiary focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-blue"
                        >
                          <PencilIcon className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(item.id!)}
                          disabled={deleting === item.id}
                          className="inline-flex items-center p-1 border border-transparent rounded-full shadow-sm text-red-500 hover:bg-brand-orange/10 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-orange disabled:opacity-50 disabled:cursor-not-allowed"
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
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
};

export default WatchItemsPage;