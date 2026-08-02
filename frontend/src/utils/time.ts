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

export const duration = (seconds: number): string => {
  if (seconds < 60) {
    return `${Math.max(1, Math.round(seconds))}s`;
  }
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${Math.round(seconds % 60)}s`;
};
