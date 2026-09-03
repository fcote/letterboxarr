import React from 'react';
import { ArrowPathIcon } from '@heroicons/react/24/outline';
import { SyncProgress } from '../types';
import { ProgressTrack } from './CategoryProgress';

interface SyncStatusBannerProps {
  progress: SyncProgress;
}

// A round is four phases long and the slow ones are a page a second, so a sync
// started now can still be going a quarter of an hour later. The banner is what
// says which of the four it is on and how far through, rather than the single
// unchanging line the page used to show for all of it.
//
// It is only rendered while a round runs, so there is no idle state to design:
// it appears when one starts, whether or not this browser was what started it,
// and goes when it ends.
const SyncStatusBanner: React.FC<SyncStatusBannerProps> = ({ progress }) => {
  const { label, item, done, total, step, steps, added } = progress;

  // A phase with nothing due — release dates already current, say — is still a
  // step of the round, and reads better as done than as a bar stuck at zero
  const share = total > 0 ? done / total : 1;

  return (
    <div className="card mt-6 p-4" role="status" aria-live="polite">
      <div className="flex items-baseline gap-3">
        {/* Self-evident from the moving bar below, so kept out of the reading */}
        <ArrowPathIcon className="h-4 w-4 flex-shrink-0 animate-spin text-brand-blue self-center" aria-hidden="true" />

        <p className="text-sm font-medium text-dark-text-primary">
          {label ?? 'Starting'}
        </p>

        {/* The name of what is being read now. Truncated rather than wrapped:
            it changes every second or so, and a line that reflows as it goes
            would move the counts beside it. */}
        {item && (
          <p className="min-w-0 flex-1 truncate text-sm text-dark-text-muted" title={item}>
            · {item}
          </p>
        )}

        {total > 0 && (
          <p className={`text-sm tabular-nums text-dark-text-secondary flex-shrink-0 ${item ? '' : 'ml-auto'}`}>
            {done} / {total}
          </p>
        )}
      </div>

      <ProgressTrack watched={share * 100} total={100} className="mt-3" />

      <div className="mt-2 flex items-baseline justify-between gap-3 text-xs text-dark-text-muted">
        <span>Step {step || 1} of {steps || 1}</span>
        {added > 0 && (
          <span>
            {added} movie{added === 1 ? '' : 's'} added to Radarr so far
          </span>
        )}
      </div>
    </div>
  );
};

export default SyncStatusBanner;
