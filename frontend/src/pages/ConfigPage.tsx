import React, { useState, useEffect, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { configAPI, radarrAPI } from '../utils/api';
import { Config, QualityProfile } from '../types';
import toast from 'react-hot-toast';
import Layout from '../components/Layout';
import { RELEASE_COUNTRIES } from '../utils/countries';

const ConfigPage: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [profiles, setProfiles] = useState<QualityProfile[] | null>(null);
  const [profilesError, setProfilesError] = useState<string | null>(null);
  const { register, handleSubmit, reset, watch, formState: { errors } } = useForm<Config>();

  const loadConfig = useCallback(async () => {
    try {
      const config = await configAPI.get();
      reset(config);
    } catch {
      toast.error('Failed to load configuration');
    } finally {
      setLoading(false);
    }
  }, [reset]);

  // Fetched apart from the config so a Radarr that is down or misconfigured
  // still leaves this page usable — it is where that gets fixed
  const loadProfiles = useCallback(async () => {
    try {
      const { profiles: fetched } = await radarrAPI.getQualityProfiles();
      setProfiles(fetched);
    } catch (error: any) {
      setProfilesError(error.response?.data?.detail || 'Could not reach Radarr');
    }
  }, []);

  useEffect(() => {
    loadConfig();
    loadProfiles();
  }, [loadConfig, loadProfiles]);

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
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-blue"></div>
        </div>
      </Layout>
    );
  }

  const selectedProfile = watch('radarr.quality_profile');
  const selectedCountry = watch('letterboxd.country');

  return (
    <Layout>
      <div className="px-4 py-6 sm:px-0">
        <div className="border-b border-dark-border pb-5">
          <h1 className="text-2xl font-bold leading-6 text-dark-text-primary">Configuration</h1>
          <p className="mt-2 max-w-4xl text-sm text-dark-text-muted">
            Configure your Radarr connection, sync settings, and Letterboxd filters.
          </p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-8">
          {/* Sync Configuration */}
          <div className="card px-4 py-5 sm:p-6">
            <div className="md:grid md:grid-cols-3 md:gap-6">
              <div className="md:col-span-1">
                <h3 className="text-lg font-medium leading-6 text-dark-text-primary">Sync Settings</h3>
                <p className="mt-1 text-sm text-dark-text-muted">
                  Configure how often the sync runs.
                </p>
              </div>
              <div className="mt-5 md:mt-0 md:col-span-2">
                <div className="grid grid-cols-3 gap-6">
                  <div className="col-span-3 sm:col-span-2">
                    <label htmlFor="sync.interval_minutes" className="block text-sm font-medium text-dark-text-secondary">
                      Sync Interval (minutes)
                    </label>
                    <input
                      type="number"
                      {...register('sync.interval_minutes', { required: true, min: 1, valueAsNumber: true })}
                      className="input-field"
                      placeholder="60"
                    />
                    <p className="mt-2 text-sm text-dark-text-muted">
                      How often your watch lists are read again from Letterboxd in the background,
                      and the movies they hold handed to Radarr. Everything the interface shows
                      comes from what was last read.
                    </p>
                    {errors.sync?.interval_minutes && (
                      <p className="mt-2 text-sm text-brand-orange">Interval must be at least 1 minute</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Radarr Configuration */}
          <div className="card px-4 py-5 sm:p-6">
            <div className="md:grid md:grid-cols-3 md:gap-6">
              <div className="md:col-span-1">
                <h3 className="text-lg font-medium leading-6 text-dark-text-primary">Radarr Settings</h3>
                <p className="mt-1 text-sm text-dark-text-muted">
                  Configure your Radarr instance connection and defaults.
                </p>
              </div>
              <div className="mt-5 md:mt-0 md:col-span-2">
                <div className="grid grid-cols-6 gap-6">
                  <div className="col-span-6">
                    <label htmlFor="radarr.url" className="block text-sm font-medium text-dark-text-secondary">
                      Radarr URL
                    </label>
                    <input
                      type="url"
                      {...register('radarr.url', { required: true })}
                      className="input-field"
                      placeholder="https://radarr.example.com"
                    />
                    {errors.radarr?.url && (
                      <p className="mt-2 text-sm text-brand-orange">Valid Radarr URL is required</p>
                    )}
                  </div>

                  <div className="col-span-6">
                    <label htmlFor="radarr.api_key" className="block text-sm font-medium text-dark-text-secondary">
                      API Key
                    </label>
                    <input
                      type="password"
                      {...register('radarr.api_key', { required: true })}
                      className="input-field"
                      placeholder="Enter your Radarr API key"
                    />
                    {errors.radarr?.api_key && (
                      <p className="mt-2 text-sm text-brand-orange">API key is required</p>
                    )}
                  </div>

                  <div className="col-span-3">
                    <label htmlFor="radarr.quality_profile" className="block text-sm font-medium text-dark-text-secondary">
                      Quality Profile
                    </label>
                    {profilesError ? (
                      <>
                        <input
                          type="number"
                          {...register('radarr.quality_profile', { required: true, min: 1, valueAsNumber: true })}
                          className="input-field"
                          placeholder="1"
                        />
                        <p className="mt-2 text-sm text-dark-text-muted">
                          {profilesError}. Enter the profile ID by hand, or correct the URL and API
                          key above, save, and reload to pick from a list.
                        </p>
                      </>
                    ) : profiles === null ? (
                      <div className="input-field flex items-center text-dark-text-muted">
                        <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-dark-text-muted mr-2"></div>
                        Loading profiles from Radarr...
                      </div>
                    ) : (
                      <select
                        {...register('radarr.quality_profile', { required: true, valueAsNumber: true })}
                        className="input-field"
                      >
                        {/* A profile deleted in Radarr would otherwise silently
                            become whichever one happens to be listed first */}
                        {!profiles.some(profile => profile.id === selectedProfile) && (
                          <option value={selectedProfile}>
                            Profile {selectedProfile} (no longer in Radarr)
                          </option>
                        )}
                        {profiles.map(profile => (
                          <option key={profile.id} value={profile.id}>
                            {profile.name}
                          </option>
                        ))}
                      </select>
                    )}
                    {errors.radarr?.quality_profile && (
                      <p className="mt-2 text-sm text-brand-orange">A quality profile is required</p>
                    )}
                  </div>

                  <div className="col-span-3">
                    <label htmlFor="radarr.root_folder" className="block text-sm font-medium text-dark-text-secondary">
                      Root Folder Path
                    </label>
                    <input
                      type="text"
                      {...register('radarr.root_folder', { required: true })}
                      className="input-field"
                      placeholder="/media/movies"
                    />
                    {errors.radarr?.root_folder && (
                      <p className="mt-2 text-sm text-brand-orange">Root folder path is required</p>
                    )}
                  </div>

                  <div className="col-span-6">
                    <div className="flex items-center space-x-6">
                      <div className="flex items-center">
                        <input
                          id="monitor_added"
                          type="checkbox"
                          {...register('radarr.monitor_added')}
                          className="h-4 w-4 text-brand-blue focus:ring-brand-blue border-dark-border bg-dark-bg-tertiary rounded"
                        />
                        <label htmlFor="monitor_added" className="ml-2 block text-sm text-dark-text-primary">
                          Monitor added movies
                        </label>
                      </div>
                      <div className="flex items-center">
                        <input
                          id="search_added"
                          type="checkbox"
                          {...register('radarr.search_added')}
                          className="h-4 w-4 text-brand-blue focus:ring-brand-blue border-dark-border bg-dark-bg-tertiary rounded"
                        />
                        <label htmlFor="search_added" className="ml-2 block text-sm text-dark-text-primary">
                          Search for added movies
                        </label>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Letterboxd Profile */}
          <div className="card px-4 py-5 sm:p-6">
            <div className="md:grid md:grid-cols-3 md:gap-6">
              <div className="md:col-span-1">
                <h3 className="text-lg font-medium leading-6 text-dark-text-primary">Letterboxd Profile</h3>
                <p className="mt-1 text-sm text-dark-text-muted">
                  Your Letterboxd username, used to flag films you have already watched.
                </p>
              </div>
              <div className="mt-5 md:mt-0 md:col-span-2">
                <div className="grid grid-cols-3 gap-6">
                  <div className="col-span-3 sm:col-span-2">
                    <label htmlFor="letterboxd.username" className="block text-sm font-medium text-dark-text-secondary">
                      Username (optional)
                    </label>
                    <div className="mt-1 flex rounded-md shadow-sm">
                      <span className="inline-flex items-center px-3 rounded-l-md border border-r-0 border-dark-border bg-dark-bg-tertiary text-dark-text-muted text-sm">
                        letterboxd.com/
                      </span>
                      <input
                        type="text"
                        {...register('letterboxd.username')}
                        className="input-field rounded-none rounded-r-md w-full"
                        placeholder="your-username"
                      />
                    </div>
                    <p className="mt-2 text-sm text-dark-text-muted">
                      Leave empty to hide the watched indicator on the movies pages. The profile must be public.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Release country */}
          <div className="card px-4 py-5 sm:p-6">
            <div className="md:grid md:grid-cols-3 md:gap-6">
              <div className="md:col-span-1">
                <h3 className="text-lg font-medium leading-6 text-dark-text-primary">Release Country</h3>
                <p className="mt-1 text-sm text-dark-text-muted">
                  Which country's release date the Upcoming page shows.
                </p>
              </div>
              <div className="mt-5 md:mt-0 md:col-span-2">
                <div className="grid grid-cols-3 gap-6">
                  <div className="col-span-3 sm:col-span-2">
                    <label htmlFor="letterboxd.country" className="block text-sm font-medium text-dark-text-secondary">
                      Country (optional)
                    </label>
                    <select {...register('letterboxd.country')} className="input-field">
                      <option value="">No preference — earliest date anywhere</option>
                      {/* A country set by hand in config.yml that Letterboxd has
                          never been seen to name would otherwise be replaced by
                          whichever one happens to be listed first */}
                      {selectedCountry && !RELEASE_COUNTRIES.includes(selectedCountry) && (
                        <option value={selectedCountry}>{selectedCountry} (from config.yml)</option>
                      )}
                      {RELEASE_COUNTRIES.map(country => (
                        <option key={country} value={country}>{country}</option>
                      ))}
                    </select>
                    <p className="mt-2 text-sm text-dark-text-muted">
                      A film with no date announced here yet is dated by its earliest release
                      anywhere instead, and the Upcoming page says which country that was.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Letterboxd Configuration */}
          <div className="card px-4 py-5 sm:p-6">
            <div className="md:grid md:grid-cols-3 md:gap-6">
              <div className="md:col-span-1">
                <h3 className="text-lg font-medium leading-6 text-dark-text-primary">Letterboxd Filters</h3>
                <p className="mt-1 text-sm text-dark-text-muted">
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
                    <label htmlFor="skip_documentaries" className="ml-3 block text-sm text-dark-text-primary">
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
                    <label htmlFor="skip_short_films" className="ml-3 block text-sm text-dark-text-primary">
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
                    <label htmlFor="skip_unreleased" className="ml-3 block text-sm text-dark-text-primary">
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
                    <label htmlFor="skip_tv_shows" className="ml-3 block text-sm text-dark-text-primary">
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
              className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
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
