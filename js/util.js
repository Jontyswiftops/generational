// Shared formatting and DOM helpers.

export const G = id => document.getElementById(id);

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}

export function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }) +
    ', ' + d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });
}

export function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function fmtTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });
}

export function timeAgo(iso) {
  if (!iso) return 'never';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return Math.round(s / 60) + 'm ago';
  if (s < 86400) return Math.round(s / 3600) + 'h ago';
  if (s < 86400 * 7) return Math.round(s / 86400) + 'd ago';
  return fmtDate(iso);
}

// "in 2h", "in 3d", "started 10m ago"
export function untilText(iso) {
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  let t;
  if (abs < 3600) t = Math.max(1, Math.round(abs / 60)) + 'm';
  else if (abs < 86400) t = Math.round(abs / 3600) + 'h';
  else t = Math.round(abs / 86400) + 'd';
  return diff >= 0 ? 'in ' + t : t + ' ago';
}

// datetime-local input value <-> ISO
export function toLocalInput(iso) {
  const d = iso ? new Date(iso) : new Date(Date.now() + 86400000);
  const pad = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
    'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

export function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// Turn bare URLs into links (after escaping).
export function linkify(escaped) {
  return escaped.replace(/(https?:\/\/[^\s<]+)/g, u =>
    '<a href="' + u + '" target="_blank" rel="noopener">' + u + '</a>');
}

export function safeUrl(u) {
  const s = String(u || '').trim();
  if (!s) return '';
  return /^https?:\/\//i.test(s) ? s : 'https://' + s;
}

let toastTimer = null;
export function toast(msg, ms = 2600) {
  const t = G('toast');
  if (!t) return;
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

export const CATEGORIES = {
  business: 'Business',
  property: 'Property',
  shares: 'Shares',
  crypto: 'Crypto',
  side_hustle: 'Side hustle'
};

export const IDEA_STATUS = {
  open: { label: 'Open', cls: 'gold' },
  in_motion: { label: 'In motion', cls: 'green' },
  parked: { label: 'Parked', cls: '' }
};

export const CHANNELS = {
  table: 'The table',
  economy: 'Economy',
  property: 'Property',
  shares: 'Shares',
  crypto: 'Crypto',
  business: 'Business'
};

export const FOCUS = {
  business: 'Business',
  property: 'Property',
  shares: 'Shares',
  crypto: 'Crypto',
  side_hustle: 'Side hustle',
  mindset: 'Mindset',
  family: 'Family wealth'
};

export const RESOURCE_TYPES = {
  book: 'Book',
  podcast: 'Podcast',
  article: 'Article',
  video: 'Video'
};

export const EMOJI = { fire: '🔥', clap: '👏', rocket: '🚀', hundred: '💯' };
