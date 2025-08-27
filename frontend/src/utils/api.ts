import axios, { AxiosResponse } from 'axios';
import { Config, LoginCredentials, Token, WatchItem, WatchItemMovies, LetterboxdTestResult } from '../types';

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
  delete: async (id: number): Promise<{ message: string }> => {
    const response = await api.delete(`/watch-items/${id}`);
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
};

export const statusAPI = {
  get: async (): Promise<{ status: string; config_loaded: boolean; sync_available: boolean }> => {
    const response = await api.get('/status');
    return response.data;
  },
};