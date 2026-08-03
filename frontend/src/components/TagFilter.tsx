import React, { useEffect, useRef, useState } from 'react';
import { ChevronDownIcon, TagIcon } from '@heroicons/react/24/outline';

export interface TagOption {
  tag: string;
  // How many watch items carry it, shown so a tag's reach is obvious before picking
  count: number;
}

interface TagFilterProps {
  options: TagOption[];
  selected: string[];
  onChange: (tags: string[]) => void;
}

// Picking several tags widens the result rather than narrowing it: a list matches
// when it carries any one of them, which is what a set of checkboxes reads as.
const TagFilter: React.FC<TagFilterProps> = ({ options, selected, onChange }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const closeOnOutside = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  const needle = query.trim().toLowerCase();
  const narrowed = needle
    ? options.filter(option => option.tag.toLowerCase().includes(needle))
    : options;

  const toggle = (tag: string) => {
    onChange(selected.includes(tag)
      ? selected.filter(candidate => candidate !== tag)
      : [...selected, tag]);
  };

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen(previous => !previous)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={`flex h-9 items-center gap-1.5 whitespace-nowrap rounded-md border px-3 text-xs font-medium ${
          selected.length > 0
            ? 'border-brand-blue/30 bg-brand-blue/20 text-brand-blue'
            : 'border-dark-border bg-dark-bg-tertiary text-dark-text-muted hover:text-dark-text-secondary'
        }`}
      >
        <TagIcon className="h-3.5 w-3.5" />
        {selected.length > 0 ? `Tags · ${selected.length}` : 'Tags'}
        <ChevronDownIcon className="h-3 w-3" />
      </button>

      {open && (
        <div
          role="listbox"
          aria-multiselectable="true"
          aria-label="Filter by tag"
          className="absolute left-0 z-30 mt-2 w-72 rounded-md border border-dark-border bg-dark-bg-secondary p-2 shadow-xl"
        >
          <div className="flex items-center justify-between px-1 pb-2">
            <span className="text-xs text-dark-text-muted">Lists with any of</span>
            {selected.length > 0 && (
              <button
                type="button"
                onClick={() => onChange([])}
                className="text-xs text-brand-blue hover:text-brand-blue/80"
              >
                Clear
              </button>
            )}
          </div>

          {options.length > 8 && (
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="input-field mb-2 h-8 w-full py-0 text-sm"
              placeholder="Find a tag"
              aria-label="Find a tag"
            />
          )}

          {/* The list is capped at roughly a dozen of the larger rows before it
              scrolls, so a normal set of tags is all in view at once */}
          {narrowed.length === 0 ? (
            <p className="px-2 py-2 text-sm text-dark-text-muted">No tag matches "{query.trim()}".</p>
          ) : (
            <ul className="max-h-96 overflow-y-auto">
              {narrowed.map(({ tag, count }) => (
                <li key={tag}>
                  <label
                    className="flex cursor-pointer items-center gap-2.5 rounded px-2 py-1.5 text-sm hover:bg-dark-bg-tertiary"
                    role="option"
                    aria-selected={selected.includes(tag)}
                  >
                    <input
                      type="checkbox"
                      checked={selected.includes(tag)}
                      onChange={() => toggle(tag)}
                      className="h-4 w-4 flex-shrink-0 rounded border-dark-border bg-dark-bg-tertiary text-brand-blue focus:ring-brand-blue"
                    />
                    <span className="min-w-0 flex-1 truncate text-dark-text-secondary">{tag}</span>
                    <span className="text-xs text-dark-text-muted">{count}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

export default TagFilter;
