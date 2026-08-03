import React from 'react';
import { CategoryProgress, MovieCategory } from '../types';
import { categoryDescriptor } from '../utils/categories';
import Tooltip from './Tooltip';

interface ProgressTrackProps {
  watched: number;
  total: number;
  className?: string;
}

// A plain bar, used where there is room for one: the movies page puts it beside a
// section title that already names the category.
export const ProgressTrack: React.FC<ProgressTrackProps> = ({ watched, total, className }) => (
  <div className={`h-1.5 rounded-full bg-dark-bg-tertiary overflow-hidden ${className ?? ''}`}>
    <div
      className="h-full rounded-full bg-brand-blue"
      style={{ width: `${total ? Math.round((watched / total) * 100) : 0}%` }}
    />
  </div>
);

interface ProgressRingProps {
  watched: number;
  total: number;
  // Sits in the middle of the ring, and is what says what is being counted
  icon: React.ComponentType<React.ComponentProps<'svg'>>;
  label: string;
  size?: number;
}

const STROKE = 3;

// A ring says how much is watched and the icon inside says what of, in about the
// space a label alone would have taken. The arc is decorative: the label carries
// the numbers, for a tooltip and for anything not reading the picture.
export const ProgressRing: React.FC<ProgressRingProps> = ({
  watched, total, icon: Icon, label, size = 26
}) => {
  const radius = (size - STROKE) / 2;
  const circumference = 2 * Math.PI * radius;
  const share = total > 0 ? Math.min(1, watched / total) : 0;

  return (
    // inline-flex on the trigger: a plain inline wrapper would sit the ring on the
    // text baseline and pad the line out with descender space.
    // Not focusable: a watch list of sixty holds hundreds of these, and a tab stop
    // each would bury the buttons on every row.
    <Tooltip lines={[label]} focusable={false} className="inline-flex">
      <span
        className="relative inline-flex flex-shrink-0 items-center justify-center"
        style={{ width: size, height: size }}
        aria-label={label}
        role="img"
      >
        {/* Turned a quarter back so the arc starts at the top rather than the right */}
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
          <circle
            cx={size / 2} cy={size / 2} r={radius}
            fill="none" stroke="currentColor" strokeWidth={STROKE}
            className="text-dark-bg-tertiary"
          />
          {share > 0 && (
            <circle
              cx={size / 2} cy={size / 2} r={radius}
              fill="none" stroke="currentColor" strokeWidth={STROKE} strokeLinecap="round"
              className="text-brand-blue"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - share)}
            />
          )}
        </svg>
        <Icon className="absolute h-3.5 w-3.5 text-dark-text-secondary" aria-hidden="true" />
      </span>
    </Tooltip>
  );
};

interface CategoryRingProps {
  category: MovieCategory;
  watched: number;
  total: number;
}

export const CategoryRing: React.FC<CategoryRingProps> = ({ category, watched, total }) => {
  const { title, icon } = categoryDescriptor(category);

  return (
    <ProgressRing
      watched={watched}
      total={total}
      icon={icon}
      label={`${title}: ${watched} of ${total} watched`}
    />
  );
};

interface CategoryRingsProps {
  categories: CategoryProgress[];
  className?: string;
}

// One ring per category on a single line, so a row of the watch items list stays
// the same height however many categories the list turns out to hold.
const CategoryRings: React.FC<CategoryRingsProps> = ({ categories, className }) => (
  <span className={`inline-flex items-center gap-1.5 ${className ?? ''}`}>
    {categories.map(({ category, watched, total }) => (
      <CategoryRing key={category} category={category} watched={watched ?? 0} total={total} />
    ))}
  </span>
);

export default CategoryRings;
