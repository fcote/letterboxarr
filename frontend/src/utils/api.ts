import axios, { AxiosResponse } from 'axios';
import { Config, DashboardSummary, LoginCredentials, QualityProfile, SyncStatus, Token, UpcomingRefreshResult, UpcomingReleases, WatchItem, WatchItemMovies, WatchItemProgress, LetterboxdTestResult } from '../types';

const api = axios.create({
  baseURL: '/api',
});

// Request interceptor to add auth token
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor to handle auth errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export const authAPI = {
  login: async (credentials: LoginCredentials): Promise<Token> => {
    const response: AxiosResponse<Token> = await api.post('/auth/login', credentials);
    return response.data;
  },
};

export const configAPI = {
  get: async (): Promise<Config> => {
    const response: AxiosResponse<Config> = await api.get('/config');
    return response.data;
  },
  update: async (config: Partial<Config>): Promise<{ message: string }> => {
    const response = await api.put('/config', config);
    return response.data;
  },
};

export const watchItemsAPI = {
  getAll: async (): Promise<WatchItem[]> => {
    const response: AxiosResponse<WatchItem[]> = await api.get('/watch-items');
    return response.data;
  },
  create: async (item: Omit<WatchItem, 'id'>): Promise<{ message: string }> => {
    const response = await api.post('/watch-items', item);
    return response.data;
  },
  update: async (id: number, item: Partial<Omit<WatchItem, 'id'>>): Promise<{ message: string }> => {
    const response = await api.put(`/watch-items/${id}`, item);
    return response.data;
  },
  delete: async (id: number): Promise<{ message: string }> => {
    const response = await api.delete(`/watch-items/${id}`);
    return response.data;
  },
  getProgress: async (id: number): Promise<WatchItemProgress> => {
    const response: AxiosResponse<WatchItemProgress> = await api.get(`/watch-items/${id}/progress`);
    return response.data;
  },
  // Every list in one request: the page needs the whole set to sort and filter on
  getAllProgress: async (): Promise<WatchItemProgress[]> => {
    const response: AxiosResponse<{ items: WatchItemProgress[] }> =
      await api.get('/watch-items/progress');
    return response.data.items;
  },
  refresh: async (id: number): Promise<{ item_id: number; path: string; refreshed: number }> => {
    const response = await api.post(`/watch-items/${id}/refresh`);
    return response.data;
  },
};

export const moviesAPI = {
  getProcessed: async (): Promise<{ movies: string[]; count: number }> => {
    const response = await api.get('/movies/processed');
    return response.data;
  },
  getByWatchItem: async (itemId: number): Promise<WatchItemMovies> => {
    const response: AxiosResponse<WatchItemMovies> = await api.get(`/movies/by-watch-item/${itemId}`);
    return response.data;
  },
  addToRadarr: async (movie: { title: string; year: number; letterboxd_slug: string; tags: string[] }): Promise<{ message: string; success: boolean }> => {
    const response = await api.post('/movies/add', movie);
    return response.data;
  },
};

export const upcomingAPI = {
  get: async (): Promise<UpcomingReleases> => {
    const response: AxiosResponse<UpcomingReleases> = await api.get('/upcoming');
    return response.data;
  },
  // Reads a Letterboxd page per recent film, so this answers in minutes on a
  // large watch list rather than at once
  refresh: async (): Promise<UpcomingRefreshResult> => {
    const response: AxiosResponse<UpcomingRefreshResult> = await api.post('/upcoming/refresh');
    return response.data;
  },
};

export const radarrAPI = {
  getQualityProfiles: async (): Promise<{ profiles: QualityProfile[] }> => {
    const response = await api.get('/radarr/quality-profiles');
    return response.data;
  },
};

export const letterboxdAPI = {
  testWatchItem: async (item: Omit<WatchItem, 'id'>): Promise<LetterboxdTestResult> => {
    const response: AxiosResponse<LetterboxdTestResult> = await api.post('/test-watch-item', item);
    return response.data;
  },
};

export const syncAPI = {
  run: async (): Promise<{ message: string }> => {
    const response = await api.post('/sync/run');
    return response.data;
  },
  getStatus: async (): Promise<SyncStatus> => {
    const response: AxiosResponse<SyncStatus> = await api.get('/sync/status');
    return response.data;
  },
};

export const dashboardAPI = {
  get: async (): Promise<DashboardSummary> => {
    const response: AxiosResponse<DashboardSummary> = await api.get('/dashboard');
    return response.data;
  },
};

export const statusAPI = {
  get: async (): Promise<{ status: string; config_loaded: boolean; sync_available: boolean }> => {
    const response = await api.get('/status');
    return response.data;
  },
};