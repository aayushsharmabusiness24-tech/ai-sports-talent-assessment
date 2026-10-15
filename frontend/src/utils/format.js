// Small helpers shared by several components and pages.

export function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function formatDuration(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '—';
  return `${(ms / 1000).toFixed(1)} s`;
}

// CSS class for a 0-100 score: green, amber or red.
export function scoreClass(score) {
  if (typeof score !== 'number' || !Number.isFinite(score)) return 'muted';
  if (score >= 75) return 'score-high';
  if (score >= 50) return 'score-mid';
  return 'score-low';
}

// Label and badge class for an assessment status.
export function statusInfo(status) {
  switch (status) {
    case 'completed':
      return { label: 'Completed', className: 'badge badge-success' };
    case 'insufficient_data':
      return { label: 'Not enough data', className: 'badge badge-warning' };
    case 'failed':
      return { label: 'Failed', className: 'badge badge-danger' };
    case 'processing':
      return { label: 'Processing', className: 'badge badge-info' };
    default:
      return { label: String(status || 'Unknown'), className: 'badge badge-neutral' };
  }
}

// "averageLowestElbowAngleDeg" -> "Average lowest elbow angle (°)"
export function humanizeKey(key) {
  let s = String(key).replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  s = s
    .replace(/ deg$/, ' (°)')
    .replace(/ percent$/, ' (%)')
    .replace(/ seconds$/, ' (s)')
    .replace(/ torso lengths$/, ' (torso lengths)');
  return s.charAt(0).toUpperCase() + s.slice(1);
}