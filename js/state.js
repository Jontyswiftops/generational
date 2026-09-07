// App-wide state: which tables I sit at, which one is open, who else is
// there, and who is online right now. Cached on-device so a failed fetch
// never paints an empty screen that looks like being kicked out.
import * as cloud from './cloud.js';

export const S = {
  tables: [],       // my_tables().tables
  isOwner: false,   // may open new tables
  tableId: null,    // the table currently open
  status: null,     // table_status(tableId)
  profile: null,    // my profiles row
  members: [],      // table_members(tableId)
  presence: {},     // presenceState() of the table channel: uid -> [{...meta}]
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
  S.tables = jget('tables', []);
  S.isOwner = jget('isOwner', false);
  S.tableId = jget('tableId', null);
  S.status = jget('status:' + S.tableId, null);
  S.profile = jget('profile', null);
  S.members = jget('members:' + S.tableId, []);
  if (S.status?.is_member) joinChannels();
}

export function reset() {
  S.tables = [];
  S.isOwner = false;
  S.tableId = null;
  S.status = null;
  S.profile = null;
  S.members = [];
  S.presence = {};
  S.unread = 0;
  S.error = null;
  joinedTable = null;
  userJoined = false;
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
      const [mine, profile] = await Promise.all([cloud.myTables(), cloud.myProfile()]);
      S.tables = mine.tables || [];
      S.isOwner = !!mine.is_owner;
      S.profile = profile;
      jset('tables', S.tables);
      jset('isOwner', S.isOwner);
      jset('profile', profile);
      if (!S.tables.some(t => t.id === S.tableId)) {
        S.tableId = S.tables[0]?.id || null;
        jset('tableId', S.tableId);
      }
      if (S.tableId) {
        const [status, members, unread] = await Promise.all([
          cloud.tableStatus(S.tableId), cloud.tableMembers(S.tableId), cloud.dmUnread().catch(() => 0)
        ]);
        S.status = status;
        S.members = members;
        S.unread = unread;
        jset('status:' + S.tableId, status);
        jset('members:' + S.tableId, members);
        joinChannels();
      } else {
        S.status = null;
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

// Open a different table. Everything table-scoped reloads.
export async function switchTable(id) {
  if (!id || id === S.tableId) return;
  if (joinedTable) { cloud.leave(tableChannelFor(joinedTable)); joinedTable = null; }
  S.tableId = id;
  jset('tableId', id);
  S.status = jget('status:' + id, null);
  S.members = jget('members:' + id, []);
  S.presence = {};
  lastFetch = 0;
  emit();
  await refresh();
}

export const tid = () => S.tableId;
export const isMember = () => !!S.status?.is_member;
export const isHost = () => !!S.status?.is_host;
export const isOwner = () => !!S.isOwner;
export const myName = () => S.profile?.display_name || '';
export const tableName = () => S.status?.name || S.tables.find(t => t.id === S.tableId)?.name || 'Generational';

// ---- realtime channels ----

const tableChannelFor = id => 'rt-table-' + id;
export const tableChannel = () => tableChannelFor(S.tableId);
export const userChannel = uid => 'rt-user-' + uid;

let joinedTable = null;
let userJoined = false;
let currentView = '#/';

function joinChannels() {
  if (!cloud.user() || !S.tableId) return;
  if (joinedTable !== S.tableId) {
    if (joinedTable) cloud.leave(tableChannelFor(joinedTable));
    joinedTable = S.tableId;
    cloud.onPresence(tableChannel(), state => {
      S.presence = state;
      emit();
    });
    trackSelf();
  }
  if (!userJoined) {
    userJoined = true;
    cloud.on(userChannel(cloud.user().id), 'dm', () => refreshUnread());
  }
}

function trackSelf() {
  if (!joinedTable) return;
  cloud.track(tableChannel(), {
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
  if (!cloud.user()) return;
  try { S.unread = await cloud.dmUnread(); emit(); } catch {}
}

export const me = () => S.members.find(m => m.is_self) || null;
export const member = uid => S.members.find(m => m.user_id === uid) || null;

// Fire a table-wide ping so other members refetch.
export function announce(event, payload = {}) {
  if (S.tableId) cloud.ping(tableChannel(), event, payload);
}
