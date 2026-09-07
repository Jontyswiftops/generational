// App-wide membership state: who I am, whether I am at the table, who else
// is, and who is online right now. Cached on-device so a failed fetch never
// paints an empty screen that looks like being kicked out.
import * as cloud from './cloud.js';

export const S = {
  status: null,     // table_status() result
  profile: null,    // my profiles row
  members: [],      // table_members() rows
  presence: {},     // presenceState() of rt-table: uid -> [{...meta}]
  unread: 0,        // unread direct messages
  error: null
};

const cbs = new Set();
export function onChange(cb) {
  cbs.add(cb);
  return () => cbs.delete(cb);
}
let emitting = false;
let emitAgain = false;
function emit() {
  if (emitting) { emitAgain = true; return; }
  emitting = true;
  try {
    [...cbs].forEach(cb => { try { cb(); } catch (e) { console.error(e); } });
  } finally {
    emitting = false;
  }
  if (emitAgain) { emitAgain = false; queueMicrotask(emit); }
}

const key = k => 'gen:' + (cloud.user()?.id || 'none') + ':' + k;
export function jget(k, fallback) {
  try { return JSON.parse(localStorage.getItem(key(k))) ?? fallback; } catch { return fallback; }
}
export function jset(k, v) {
  try { localStorage.setItem(key(k), JSON.stringify(v)); } catch {}
}

export function loadCache() {
  S.status = jget('status', null);
  S.profile = jget('profile', null);
  S.members = jget('members', []);
  if (S.status?.is_member) joinTableChannel();
}

export function reset() {
  S.status = null;
  S.profile = null;
  S.members = [];
  S.presence = {};
  S.unread = 0;
  S.error = null;
  tableJoined = false;
  emit();
}

let lastFetch = 0;
let inflight = null;

export function refresh({ throttle = false } = {}) {
  if (!cloud.user()) return Promise.resolve();
  if (throttle && Date.now() - lastFetch < 15000) return Promise.resolve();
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const [status, profile] = await Promise.all([cloud.tableStatus(), cloud.myProfile()]);
      S.status = status;
      S.profile = profile;
      jset('status', status);
      jset('profile', profile);
      if (status.is_member) {
        [S.members, S.unread] = await Promise.all([cloud.tableMembers(), cloud.dmUnread().catch(() => 0)]);
        jset('members', S.members);
        joinTableChannel();
      } else {
        S.members = [];
        S.unread = 0;
      }
      S.error = null;
      lastFetch = Date.now();
    } catch (err) {
      S.error = err.message || 'Could not reach the table';
    } finally {
      inflight = null;
    }
    emit();
  })();
  return inflight;
}

export const isMember = () => !!S.status?.is_member;
export const isHost = () => !!S.status?.is_host;
export const myName = () => S.profile?.display_name || '';
export const tableName = () => S.status?.name || 'Generational';

// ---- presence on the table channel ----

let tableJoined = false;
let currentView = '#/';

function joinTableChannel() {
  if (tableJoined || !cloud.user()) return;
  tableJoined = true;
  cloud.onPresence('rt-table', state => {
    S.presence = state;
    emit();
  });
  cloud.on('rt-table', 'dm', p => { if (!p.to || p.to === cloud.user()?.id) refreshUnread(); });
  trackSelf();
}

function trackSelf() {
  if (!tableJoined) return;
  cloud.track('rt-table', {
    uid: cloud.user().id,
    name: myName(),
    view: currentView,
    at: Date.now()
  });
}

export function setView(hash) {
  currentView = hash;
  trackSelf();
}

export function onlineIds() {
  return new Set(Object.keys(S.presence || {}));
}

function presenceMeta(uid) {
  const arr = S.presence?.[uid];
  return Array.isArray(arr) && arr.length ? arr[arr.length - 1] : null;
}

// Members merged with presence, for the 3D table and the seat list.
export function seats() {
  const online = onlineIds();
  const tenMin = Date.now() - 10 * 60000;
  return S.members.map(m => {
    const meta = presenceMeta(m.user_id);
    const isOnline = online.has(m.user_id);
    const inRoom = !!meta && /\/live$/.test(meta.view || '');
    const recent = m.last_active_at && new Date(m.last_active_at).getTime() > tenMin;
    return {
      id: m.user_id,
      name: m.display_name,
      isHost: m.role === 'host',
      isSelf: m.is_self,
      points: m.points,
      streak: m.streak,
      lastActiveAt: m.last_active_at,
      online: isOnline,
      active: isOnline && (inRoom || recent),
      view: meta?.view || null
    };
  });
}

export async function refreshUnread() {
  if (!cloud.user() || !isMember()) return;
  try { S.unread = await cloud.dmUnread(); emit(); } catch {}
}

export const me = () => S.members.find(m => m.is_self) || null;
export const member = uid => S.members.find(m => m.user_id === uid) || null;

// Fire a table-wide ping and refresh our own copy.
export function announce(event, payload = {}) {
  cloud.ping('rt-table', event, payload);
}
