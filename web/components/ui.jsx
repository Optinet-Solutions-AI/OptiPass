'use client';

const ICONS = {
  fill: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  key: '<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>',
  pen: '<path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>',
  moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
  sun: '<circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>',
  back: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
  refresh:
    '<path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.64A9 9 0 0 0 20.49 15"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  trash:
    '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6M14 11v6"/>',
};

export function Icon({ name }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: ICONS[name] || '' }}
    />
  );
}

export function timeAgo(iso) {
  if (!iso) return 'never checked';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function monitorHost(url) {
  try {
    return new URL(url.includes('://') ? url : `https://${url}`).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

export function formatMonitorValue(mon) {
  if (mon.last_numeric === null || mon.last_numeric === undefined) {
    return mon.last_value || 'not read yet';
  }
  const n = Number(mon.last_numeric).toLocaleString();
  return mon.unit ? `${n} ${mon.unit}` : n;
}

export function monitorIsLow(mon) {
  return (
    mon.threshold !== null &&
    mon.threshold !== undefined &&
    mon.last_numeric !== null &&
    mon.last_numeric !== undefined &&
    Number(mon.last_numeric) < Number(mon.threshold)
  );
}

// "a.b.0.c" -> obj.a.b[0].c
export function pluck(obj, path) {
  if (!path) return obj;
  let cur = obj;
  for (const part of path.split('.')) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[part.trim()];
  }
  return cur;
}

export function entryHost(entry) {
  if (!entry.data.url) return null;
  try {
    const raw = entry.data.url.includes('://') ? entry.data.url : `https://${entry.data.url}`;
    return new URL(raw).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}
