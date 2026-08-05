// Epoch seconds, as the API sends them
const UNITS: [seconds: number, name: string][] = [
  [86400, 'day'],
  [3600, 'hour'],
  [60, 'minute']
];

export const relativeTime = (epochSeconds: number): string => {
  const elapsed = Math.max(0, Date.now() / 1000 - epochSeconds);

  for (const [seconds, name] of UNITS) {
    const count = Math.floor(elapsed / seconds);
    if (count >= 1) {
      return `${count} ${name}${count === 1 ? '' : 's'} ago`;
    }
  }

  return 'just now';
};

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// A release date is a day rather than an instant, so it is read off its own
// parts. Handing the ISO string to Date would read it as midnight UTC, which
// puts every release a day earlier for anyone west of it — a film out on the
// 1st would read as the 31st of the month before, under the wrong heading.
const partsOf = (iso: string): [year: number, month: number, day: number] => {
  const [year, month, day] = iso.split('-').map(Number);
  return [year, month, day];
};

// "Thu 5 Feb" — the year is on the month heading the row sits under
export const releaseDay = (iso: string): string => {
  const [year, month, day] = partsOf(iso);
  return `${WEEKDAYS[new Date(year, month - 1, day).getDay()]} ${day} ${MONTHS[month - 1].slice(0, 3)}`;
};

export const releaseMonth = (iso: string): string => {
  const [year, month] = partsOf(iso);
  return `${MONTHS[month - 1]} ${year}`;
};

// How far off a release is, counted in whole days from today rather than from
// now: a film out tomorrow morning is still out tomorrow, whatever the hour
export const timeUntil = (iso: string): string => {
  const [year, month, day] = partsOf(iso);
  const today = new Date();
  const days = Math.round(
    (new Date(year, month - 1, day).getTime()
      - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime())
    / 86400000
  );

  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days < 31) return `in ${days} days`;

  // Whole days decide when years take over, not the rounded month count: at
  // 30.44 days to the month that reaches twelve a fortnight before the year is
  // up, and a release 355 days off would read as being over a year away
  if (days < 365) {
    const months = Math.round(days / 30.44);
    return `in ${months} month${months === 1 ? '' : 's'}`;
  }

  const years = Math.floor(days / 365);
  return `in over ${years} year${years === 1 ? '' : 's'}`;
};

export const duration = (seconds: number): string => {
  if (seconds < 60) {
    return `${Math.max(1, Math.round(seconds))}s`;
  }
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${Math.round(seconds % 60)}s`;
};
