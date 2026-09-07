// Supabase client, auth, every remote call, and realtime channels.
// window.supabase comes from vendor/supabase.js.
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

export const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let session = null;
const authCbs = new Set();

export const ready = sb.auth.getSession().then(({ data }) => { session = data.session; });

sb.auth.onAuthStateChange((event, s) => {
  session = s;
  authCbs.forEach(cb => cb(event, s));
});

export const user = () => session?.user ?? null;

// cb(event, session); returns unsubscribe.
export function onAuth(cb) {
  authCbs.add(cb);
  return () => authCbs.delete(cb);
}

const appUrl = () => location.origin + location.pathname;

export const signInPassword = (email, password) =>
  sb.auth.signInWithPassword({ email, password });

export const setPassword = password => sb.auth.updateUser({ password });

export const signUpPassword = (email, password) =>
  sb.auth.signUp({ email, password, options: { emailRedirectTo: appUrl() } });

export const signOut = () => sb.auth.signOut();

async function rpc(name, args) {
  const { data, error } = await sb.rpc(name, args);
  if (error) throw error;
  return data;
}

async function run(q) {
  const { data, error } = await q;
  if (error) throw error;
  return data;
}

// ---- profile ----

export async function myProfile() {
  const u = user();
  if (!u) return null;
  return run(sb.from('profiles').select('*').eq('id', u.id).maybeSingle());
}

export const saveDisplayName = name =>
  run(sb.from('profiles').update({ display_name: name }).eq('id', user().id));

// patch: { display_name?, goals?, focus? }
export const saveProfile = patch =>
  run(sb.from('profiles').update(patch).eq('id', user().id));

// ---- membership ----

export const tableStatus = () => rpc('table_status');
export const claimHost = () => rpc('claim_host');
export const joinTable = code => rpc('join_table', { code });
export const rotateInviteCode = () => rpc('rotate_invite_code');
export const removeMember = uid => rpc('remove_member', { uid });
export const leaveTable = () => rpc('leave_table');
export const renameTable = name => rpc('rename_table', { p_name: name });
export const tableMembers = () => rpc('table_members');
export const setMembersCanInvite = on => rpc('set_members_can_invite', { p_on: on });

// ---- direct messages ----

export const dmThreads = () => rpc('dm_threads');
export const dmThread = (other, lim = 100) => rpc('dm_thread', { other, lim });
export const dmMarkRead = other => rpc('dm_mark_read', { other });
export const dmUnread = () => rpc('dm_unread');
export const dmSend = (recipientId, body) =>
  run(sb.from('dms').insert({ sender_id: user().id, recipient_id: recipientId, body }));
export const dmDelete = id => run(sb.from('dms').delete().eq('id', id));

// ---- ideas ----

export const listIdeas = status => rpc('list_ideas', { p_status: status || null });
export const ideaDetail = id => rpc('idea_detail', { p_id: id });

export const createIdea = fields =>
  run(sb.from('ideas').insert({ ...fields, author_id: user().id }).select('id').single());

export const updateIdea = (id, patch) => run(sb.from('ideas').update(patch).eq('id', id));
export const deleteIdea = id => run(sb.from('ideas').delete().eq('id', id));

export function setStance(ideaId, stance) {
  const uid = user().id;
  if (!stance) {
    return run(sb.from('idea_stances').delete().eq('idea_id', ideaId).eq('user_id', uid));
  }
  return run(sb.from('idea_stances').upsert({ idea_id: ideaId, user_id: uid, stance }));
}

// ---- comments (ideas + posts) ----

export const addComment = (targetType, targetId, body, parentId = null) =>
  run(sb.from('comments').insert({
    target_type: targetType, target_id: targetId, body, parent_id: parentId, author_id: user().id
  }));

export const deleteComment = id => run(sb.from('comments').delete().eq('id', id));

// ---- sessions ----

export const listSessions = () => rpc('list_sessions');
export const sessionDetail = id => rpc('session_detail', { p_id: id });

export const createSession = (title, startsAt, meetLink, agenda) =>
  rpc('create_session', { p_title: title, p_starts_at: startsAt, p_meet_link: meetLink || null, p_agenda: agenda });

export const updateSession = (id, title, startsAt, meetLink, agenda) =>
  rpc('update_session', { p_id: id, p_title: title, p_starts_at: startsAt, p_meet_link: meetLink || null, p_agenda: agenda });

export const setSessionStatus = (id, status) => rpc('set_session_status', { p_id: id, p_status: status });
export const deleteSession = id => rpc('delete_session', { p_id: id });
export const saveNotes = (id, notes) => rpc('save_session_notes', { p_id: id, p_notes: notes });
export const markAttendance = id => rpc('mark_attendance', { p_id: id });

export const rsvp = (sessionId, status) =>
  run(sb.from('rsvps').upsert({ session_id: sessionId, user_id: user().id, status }));

export const tickAgenda = (id, done) =>
  run(sb.from('agenda_items').update({ done, done_by: done ? user().id : null }).eq('id', id));

export const sendSessionMessage = (sessionId, body) =>
  run(sb.from('session_messages').insert({ session_id: sessionId, body, author_id: user().id }));

export const addActionItem = (sessionId, text, assigneeId, dueOn) =>
  run(sb.from('action_items').insert({
    session_id: sessionId, text, assignee_id: assigneeId || null, due_on: dueOn || null, created_by: user().id
  }));

export const updateActionItem = (id, patch) => run(sb.from('action_items').update(patch).eq('id', id));
export const deleteActionItem = id => run(sb.from('action_items').delete().eq('id', id));

// ---- feed ----

export const feed = (lim = 40) => rpc('feed', { lim });

export const createPost = (kind, body) =>
  run(sb.from('posts').insert({ kind, body, author_id: user().id }));

export const deletePost = id => run(sb.from('posts').delete().eq('id', id));

export function toggleReaction(postId, emoji, on) {
  const uid = user().id;
  if (on) return run(sb.from('reactions').upsert({ post_id: postId, user_id: uid, emoji }));
  return run(sb.from('reactions').delete().eq('post_id', postId).eq('user_id', uid).eq('emoji', emoji));
}

// ---- talk + resources ----

export const channelFeed = (channel, before = null, lim = 60) =>
  rpc('channel_feed', { p_channel: channel, before, lim });

export const sendChannelMessage = (channel, body) =>
  run(sb.from('channel_messages').insert({ channel, body, author_id: user().id }));

export const deleteChannelMessage = id => run(sb.from('channel_messages').delete().eq('id', id));

export const listResources = () => rpc('list_resources');

export const addResource = fields =>
  run(sb.from('resources').insert({ ...fields, shared_by: user().id }));

export const deleteResource = id => run(sb.from('resources').delete().eq('id', id));

// ---- realtime: broadcast pings + presence ----
// Pings carry no meaningful data; receivers refetch through the RPCs, which
// enforce access. Presence tracks who has the app open.

const channels = new Map(); // name -> { ch, events: Map, presCbs: Set, tracked }

function ensure(name) {
  let c = channels.get(name);
  if (c) return c;
  const key = user()?.id || ('anon-' + Math.random().toString(36).slice(2));
  const ch = sb.channel(name, { config: { presence: { key }, broadcast: { self: false } } });
  c = { ch, events: new Map(), presCbs: new Set(), tracked: null, joined: false };
  ch.on('broadcast', { event: '*' }, msg => {
    const set = c.events.get(msg.event);
    if (set) set.forEach(f => { try { f(msg.payload || {}); } catch (e) { console.error(e); } });
  });
  ch.on('presence', { event: 'sync' }, () => {
    const state = ch.presenceState();
    c.presCbs.forEach(f => { try { f(state); } catch (e) { console.error(e); } });
  });
  ch.subscribe(status => {
    if (status === 'SUBSCRIBED') {
      c.joined = true;
      if (c.tracked) ch.track(c.tracked).catch(() => {});
    } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      c.joined = false;
    }
  });
  channels.set(name, c);
  return c;
}

export function on(name, event, cb) {
  const c = ensure(name);
  let set = c.events.get(event);
  if (!set) { set = new Set(); c.events.set(event, set); }
  set.add(cb);
  return () => set.delete(cb);
}

export function ping(name, event, payload = {}) {
  const c = channels.get(name);
  if (!c) return;
  try { c.ch.send({ type: 'broadcast', event, payload }); } catch {}
}

export function onPresence(name, cb) {
  const c = ensure(name);
  c.presCbs.add(cb);
  try { cb(c.ch.presenceState()); } catch {}
  return () => c.presCbs.delete(cb);
}

export function track(name, payload) {
  const c = ensure(name);
  c.tracked = payload;
  if (c.joined) c.ch.track(payload).catch(() => {});
}

export function presenceState(name) {
  const c = channels.get(name);
  return c ? c.ch.presenceState() : {};
}

export function leave(name) {
  const c = channels.get(name);
  if (!c) return;
  try { sb.removeChannel(c.ch); } catch {}
  channels.delete(name);
}

export function teardownChannels() {
  channels.forEach(c => { try { sb.removeChannel(c.ch); } catch {} });
  channels.clear();
}
