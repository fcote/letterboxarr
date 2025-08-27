import React, { useState, useEffect, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { configAPI } from '../utils/api';
import { Config } from '../types';
import toast from 'react-hot-toast';
import Layout from '../components/Layout';

const ConfigPage: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { register, handleSubmit, reset, formState: { errors } } = useForm<Config>();

  const loadConfig = useCallback(async () => {
    try {
      const config = await configAPI.get();
      reset(config);
    } catch (error: any) {
      toast.error('Failed to load configuration');
    } finally {
      setLoading(false);
    }
  }, [reset]);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const onSubmit = async (data: Config) => {
    setSaving(true);
    try {
      await configAPI.update(data);
      toast.success('Configuration saved successfully!');
    } catch (error: any) {
      toast.error(error.response?.data?.detail || 'Failed to save configuration');
    } finally {
      setSaving(false);
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
        <div className="border-b border-gray-200 pb-5">
          <h1 className="text-2xl font-bold leading-6 text-gray-900">Configuration</h1>
          <p className="mt-2 max-w-4xl text-sm text-gray-500">
            Configure your Radarr connection, sync settings, and Letterboxd filters.
          </p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-8">
          {/* Sync Configuration */}
          <div className="bg-white shadow px-4 py-5 sm:rounded-lg sm:p-6">
            <div className="md:grid md:grid-cols-3 md:gap-6">
              <div className="md:col-span-1">
                <h3 className="text-lg font-medium leading-6 text-gray-900">Sync Settings</h3>
                <p className="mt-1 text-sm text-gray-500">
                  Configure how often the sync runs.
                </p>
              </div>
              <div className="mt-5 md:mt-0 md:col-span-2">
                <div className="grid grid-cols-3 gap-6">
                  <div className="col-span-3 sm:col-span-2">
                    <label htmlFor="sync.interval_minutes" className="block text-sm font-medium text-gray-700">
                      Sync Interval (minutes)
                    </label>
                    <input
                      type="number"
                      {...register('sync.interval_minutes', { required: true, min: 1 })}
                      className="mt-1 focus:ring-blue-500 focus:border-blue-500 block w-full shadow-sm sm:text-sm border-gray-300 rounded-md"
                      placeholder="60"
                    />
                    {errors.sync?.interval_minutes && (
                      <p className="mt-2 text-sm text-red-600">Interval must be at least 1 minute</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Radarr Configuration */}
          <div className="bg-white shadow px-4 py-5 sm:rounded-lg sm:p-6">
            <div className="md:grid md:grid-cols-3 md:gap-6">
              <div className="md:col-span-1">
                <h3 className="text-lg font-medium leading-6 text-gray-900">Radarr Settings</h3>
                <p className="mt-1 text-sm text-gray-500">
                  Configure your Radarr instance connection and defaults.
                </p>
              </div>
              <div className="mt-5 md:mt-0 md:col-span-2">
                <div className="grid grid-cols-6 gap-6">
                  <div className="col-span-6">
                    <label htmlFor="radarr.url" className="block text-sm font-medium text-gray-700">
                      Radarr URL
                    </label>
                    <input
                      type="url"
                      {...register('radarr.url', { required: true })}
                      className="mt-1 focus:ring-blue-500 focus:border-blue-500 block w-full shadow-sm sm:text-sm border-gray-300 rounded-md"
                      placeholder="https://radarr.example.com"
                    />
                    {errors.radarr?.url && (
                      <p className="mt-2 text-sm text-red-600">Valid Radarr URL is required</p>
                    )}
                  </div>

                  <div className="col-span-6">
                    <label htmlFor="radarr.api_key" className="block text-sm font-medium text-gray-700">
                      API Key
                    </label>
                    <input
                      type="password"
                      {...register('radarr.api_key', { required: true })}
                      className="mt-1 focus:ring-blue-500 focus:border-blue-500 block w-full shadow-sm sm:text-sm border-gray-300 rounded-md"
                      placeholder="Enter your Radarr API key"
                    />
                    {errors.radarr?.api_key && (
                      <p className="mt-2 text-sm text-red-600">API key is required</p>
                    )}
                  </div>

                  <div className="col-span-3">
                    <label htmlFor="radarr.quality_profile" className="block text-sm font-medium text-gray-700">
                      Quality Profile ID
                    </label>
                    <input
                      type="number"
                      {...register('radarr.quality_profile', { required: true, min: 1 })}
                      className="mt-1 focus:ring-blue-500 focus:border-blue-500 block w-full shadow-sm sm:text-sm border-gray-300 rounded-md"
                      placeholder="1"
                    />
                    {errors.radarr?.quality_profile && (
                      <p className="mt-2 text-sm text-red-600">Quality profile ID is required</p>
                    )}
                  </div>

                  <div className="col-span-3">
                    <label htmlFor="radarr.root_folder" className="block text-sm font-medium text-gray-700">
                      Root Folder Path
                    </label>
                    <input
                      type="text"
                      {...register('radarr.root_folder', { required: true })}
                      className="mt-1 focus:ring-blue-500 focus:border-blue-500 block w-full shadow-sm sm:text-sm border-gray-300 rounded-md"
                      placeholder="/media/movies"
                    />
                    {errors.radarr?.root_folder && (
                      <p className="mt-2 text-sm text-red-600">Root folder path is required</p>
                    )}
                  </div>

                  <div className="col-span-6">
                    <div className="flex items-center space-x-6">
                      <div className="flex items-center">
                        <input
                          id="monitor_added"
                          type="checkbox"
                          {...register('radarr.monitor_added')}
                          className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                        />
                        <label htmlFor="monitor_added" className="ml-2 block text-sm text-gray-900">
                          Monitor added movies
                        </label>
                      </div>
                      <div className="flex items-center">
                        <input
                          id="search_added"
                          type="checkbox"
                          {...register('radarr.search_added')}
                          className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                        />
                        <label htmlFor="search_added" className="ml-2 block text-sm text-gray-900">
                          Search for added movies
                        </label>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Letterboxd Configuration */}
          <div className="bg-white shadow px-4 py-5 sm:rounded-lg sm:p-6">
            <div className="md:grid md:grid-cols-3 md:gap-6">
              <div className="md:col-span-1">
                <h3 className="text-lg font-medium leading-6 text-gray-900">Letterboxd Filters</h3>
                <p className="mt-1 text-sm text-gray-500">
                  Global filters applied to all watch lists (can be overridden per list).
                </p>
              </div>
              <div className="mt-5 md:mt-0 md:col-span-2">
                <div className="space-y-4">
                  <div className="flex items-center">
                    <input
                      id="skip_documentaries"
                      type="checkbox"
                      {...register('letterboxd.filters.skip_documentaries')}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                    <label htmlFor="skip_documentaries" className="ml-3 block text-sm text-gray-900">
                      Skip documentaries
                    </label>
                  </div>
                  <div className="flex items-center">
                    <input
                      id="skip_short_films"
                      type="checkbox"
                      {...register('letterboxd.filters.skip_short_films')}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                    <label htmlFor="skip_short_films" className="ml-3 block text-sm text-gray-900">
                      Skip short films
                    </label>
                  </div>
                  <div className="flex items-center">
                    <input
                      id="skip_unreleased"
                      type="checkbox"
                      {...register('letterboxd.filters.skip_unreleased')}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                    <label htmlFor="skip_unreleased" className="ml-3 block text-sm text-gray-900">
                      Skip unreleased films
                    </label>
                  </div>
                  <div className="flex items-center">
                    <input
                      id="skip_tv_shows"
                      type="checkbox"
                      {...register('letterboxd.filters.skip_tv_shows')}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                    <label htmlFor="skip_tv_shows" className="ml-3 block text-sm text-gray-900">
                      Skip TV shows
                    </label>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="ml-3 inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Configuration'}
            </button>
          </div>
        </form>
      </div>
    </Layout>
  );
};

export default ConfigPage;