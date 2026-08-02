import React from 'react';
import { CategoryProgress } from '../types';
import { categoryDescriptor } from '../utils/categories';

interface ProgressTrackProps {
  watched: number;
  total: number;
  className?: string;
}

// The bar itself. Callers lay out their own label around it: the watch items
// page names the category, the movies page already has it in the section title.
export const ProgressTrack: React.FC<ProgressTrackProps> = ({ watched, total, className }) => (
  <div className={`h-1.5 rounded-full bg-dark-bg-tertiary overflow-hidden ${className ?? ''}`}>
    <div
      className="h-full rounded-full bg-brand-blue"
      style={{ width: `${total ? Math.round((watched / total) * 100) : 0}%` }}
    />
  </div>
);

interface CategoryProgressBarsProps {
  categories: CategoryProgress[];
  className?: string;
}

// Categories share one row, each sized to the space left over. The basis is
// small enough that all four fit at the container's full width.
const CategoryProgressBars: React.FC<CategoryProgressBarsProps> = ({ categories, className }) => (
  <div className={`flex flex-wrap gap-x-6 gap-y-2 ${className ?? ''}`}>
    {categories.map(({ category, watched, total }) => {
      const { title, icon: Icon } = categoryDescriptor(category);
      const seen = watched ?? 0;

      return (
        <div key={category} className="grow basis-48 max-w-sm">
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center text-dark-text-secondary">
              <Icon className="h-3.5 w-3.5 mr-1.5 text-dark-text-muted" />
              {title}
            </span>
            <span className="text-dark-text-muted">
              {seen}/{total} watched
            </span>
          </div>
          <ProgressTrack watched={seen} total={total} className="mt-1 w-full" />
        </div>
      );
    })}
  </div>
);

export default CategoryProgressBars;
