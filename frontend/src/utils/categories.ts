import React from 'react';
import {
  CalendarIcon,
  ClockIcon,
  FilmIcon,
  TvIcon,
  VideoCameraIcon
} from '@heroicons/react/24/outline';
import { MovieCategory } from '../types';

export interface CategoryDescriptor {
  category: MovieCategory;
  title: string;
  description: string;
  icon: React.ComponentType<React.ComponentProps<'svg'>>;
}

// Display order of the categories, shared by the movies and watch items pages
export const MOVIE_CATEGORIES: CategoryDescriptor[] = [
  {
    category: 'film',
    title: 'Films',
    description: 'Feature films from this Letterboxd list and their sync status.',
    icon: FilmIcon
  },
  {
    category: 'short_film',
    title: 'Short Films',
    description: 'Entries Letterboxd classifies as short films.',
    icon: ClockIcon
  },
  {
    category: 'documentary',
    title: 'Documentaries',
    description: 'Entries Letterboxd classifies as documentaries.',
    icon: VideoCameraIcon
  },
  {
    category: 'tv_show',
    title: 'TV Shows',
    description: 'Entries Letterboxd classifies as TV shows. Radarr cannot manage these.',
    icon: TvIcon
  },
  {
    category: 'unreleased',
    title: 'Unreleased',
    description: 'Not released yet, whatever their type. Radarr can track them but has nothing to grab.',
    icon: CalendarIcon
  }
];

export const categoryDescriptor = (category: MovieCategory): CategoryDescriptor =>
  MOVIE_CATEGORIES.find(descriptor => descriptor.category === category) ?? MOVIE_CATEGORIES[0];
