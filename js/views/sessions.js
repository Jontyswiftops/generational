// Sessions: scheduling round tables, RSVPs, and the live room (chat,
// agenda, shared notes, action items).
import * as cloud from '../cloud.js';
import * as state from '../state.js';
import { esc, initials, fmtDateTime, fmtTime, fmtDate, untilText, timeAgo, toast, linkify, safeUrl, toLocalInput, debounce } from '../util.js';
import { gate, handleKick, DISCLAIMER } from './shared.js';

export const title = 'Sessions';

let unsubs = [];
let el = null;
let sessions = [];
let detail = null;
let section = 'chat';
let roomId = null;
let roomPresence = {};
let notesDirty = false;
let notesSavedAt = null;

const STATUS = {
  scheduled: { label: 'Scheduled', cls: 'gold' },
  live: { label: 'Live now', cls: 'green live' },
  done: { label: 'Done', cls: '' }
};

const statusPill = s => '<span class="pill ' + STATUS[s].cls + '">' + STATUS[s].label + '</span>';

// ---------- list ----------

function sessionItem(s) {
  return '<a class="item" href="#/sessions/' + s.id + '">' +
    '<div class="pills">' + statusPill(s.status) + (s.my_rsvp ? '<span class="pill">You: ' + esc(s.my_rsvp) + '</span>' : '') + '</div>' +
    '<div class="title">' + esc(s.title) + '</div>' +
    '<div class="meta"><span class="when" style="font-size:.9rem">' + fmtDateTime(s.starts_at) + '</span><span>' + untilText(s.starts_at) + '</span></div>' +
    '<div class="counts"><span><b>' + s.yes_count + '</b> in</span><span><b>' + s.agenda_count + '</b> agenda items</span>' +
    (s.status === 'done' ? '<span><b>' + s.attended_count + '</b> attended</span>' : '') +
    (s.open_actions ? '<span><b>' + s.open_actions + '</b> open actions</span>' : '') + '</div></a>';
}

function paintList() {
  const box = el?.querySelector('#sessionList');
  if (!box) return;
  const cutoff = Date.now() - 4 * 3600000;
  const upcoming = sessions.filter(s => s.status === 'live' || (s.status === 'scheduled' && new Date(s.starts_at).getTime() > cutoff))
    .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
  const past = sessions.filter(s => !upcoming.includes(s));
  box.innerHTML =
    '<h3>Coming up</h3>' + (upcoming.length ? upcoming.map(sessionItem).join('') :
      '<div class="empty">Nothing scheduled.' + (state.isHost() ? ' Pick a night and get the crew together.' : ' The host will post the next one.') + '</div>') +
    (past.length ? '<h3>Past</h3>' + past.map(sessionItem).join('') : '');
}

async function loadList() {
  try {
    sessions = await cloud.listSessions();
    state.jset('sessions', sessions);
  } catch (err) { if (!handleKick(err)) toast('Could not load sessions: ' + err.message); }
  paintList();
}

function renderList() {
  sessions = state.jget('sessions', []);
  el.innerHTML = (state.isHost() ? '<a class="btn primary big" href="#/sessions/new">Schedule a round table</a>' : '') +
    '<div id="sessionList"></div>' + DISCLAIMER;
  paintList();
  loadList();
  unsubs.push(cloud.on('rt-table', 'sessions', loadList));
}

// ---------- new / edit ----------

async function renderForm(id) {
  let s = null;
  if (id) {
    try { s = await cloud.sessionDetail(id); } catch (err) { el.innerHTML = '<div class="card"><p>' + esc(err.message) + '</p></div>'; return; }
  }
  if (!state.isHost()) { el.innerHTML = '<div class="card"><p>Only the host can schedule sessions.</p><a class="btn mt" href="#/sessions">Back</a></div>'; return; }
  el.innerHTML = '<div class="card"><h3>' + (s ? 'Edit session' : 'Schedule a round table') + '</h3>' +
    '<label>Title<input type="text" id="fTitle" maxlength="120" placeholder="e.g. Q4 property play, or Monthly round table" value="' + esc(s?.title || '') + '"></label>' +
    '<label>When<input type="datetime-local" id="fWhen" value="' + toLocalInput(s?.starts_at) + '"></label>' +
    '<label>Meeting link (optional)<input type="url" id="fLink" maxlength="500" placeholder="Google Meet or Zoom link" value="' + esc(s?.meet_link || '') + '"></label>' +
    '<label>Agenda (one item per line)<textarea id="fAgenda" style="min-height:120px" placeholder="Wins since last time&#10;Market check-in&#10;Ideas on the table&#10;Actions for next month">' +
    esc((s?.agenda || []).map(a => a.text).join('\n')) + '</textarea></label>' +
    '<button class="btn primary big" id="fSubmit" style="margin-bottom:0">' + (s ? 'Save changes' : 'Schedule it') + '</button>' +
    '<div class="hint" id="fStatus"></div></div>';
  el.querySelector('#fSubmit').addEventListener('click', async e => {
    const titleV = el.querySelector('#fTitle').value.trim();
    const when = el.querySelector('#fWhen').value;
    const link = safeUrl(el.querySelector('#fLink').value);
    const agenda = el.querySelector('#fAgenda').value.split('\n').map(x => x.trim()).filter(Boolean);
    const status = el.querySelector('#fStatus');
    if (!titleV || !when) { status.textContent = 'A title and a time are needed.'; return; }
    const iso = new Date(when).toISOString();
    e.target.disabled = true;
    try {
      let sid = id;
      if (s) await cloud.updateSession(id, titleV, iso, link, agenda);
      else sid = await cloud.createSession(titleV, iso, link, agenda);
      state.announce('sessions');
      toast(s ? 'Session updated' : 'Round table scheduled');
      location.hash = '#/sessions/' + sid;
    } catch (err) { status.textContent = err.message; e.target.disabled = false; }
  });
}

// ---------- detail ----------

function groupRsvps(rsvps) {
  const g = { yes: [], maybe: [], no: [] };
  rsvps.forEach(r => (g[r.status] ||= []).push(r.display_name));
  return g;
}

function paintDetail() {
  const d = detail;
  if (!d || !el) return;
  const host = state.isHost();
  const g = groupRsvps(d.rsvps);
  el.innerHTML =
    '<div class="card">' +
    '<div class="pills">' + statusPill(d.status) + '</div>' +
    '<h2 class="mt">' + esc(d.title) + '</h2>' +
    '<div class="when">' + fmtDateTime(d.starts_at) + '</div>' +
    '<div class="hint" style="margin:2px 0 0">' + untilText(d.starts_at) + ' &middot; hosted by ' + esc(d.host) + '</div>' +
    (d.meet_link ? '<a class="btn mt" href="' + esc(safeUrl(d.meet_link)) + '" target="_blank" rel="noopener" style="width:100%">Open meeting link</a>' : '') +
    '<a class="btn primary big mt" href="#/sessions/' + d.id + '/live" style="margin-bottom:0">' + (d.status === 'done' ? 'Open the recap' : 'Enter the room') + '</a>' +
    '</div>' +
    (d.status !== 'done' ? '<div class="card"><h3>Are you in?</h3><div class="rsvp-row">' +
      ['yes', 'maybe', 'no'].map(k => '<button class="btn' + (k === 'yes' ? ' green' : k === 'no' ? ' red' : '') + (d.my_rsvp === k ? ' on' : '') + '" data-rsvp="' + k + '">' +
        (k === 'yes' ? "I'm in" : k === 'maybe' ? 'Maybe' : "Can't make it") + '</button>').join('') + '</div>' +
      (d.rsvps.length ? '<div class="hint mt">' + (g.yes.length ? '<b>In:</b> ' + esc(g.yes.join(', ')) + '<br>' : '') +
        (g.maybe.length ? '<b>Maybe:</b> ' + esc(g.maybe.join(', ')) + '<br>' : '') + (g.no.length ? '<b>Out:</b> ' + esc(g.no.join(', ')) : '') + '</div>' : '') +
      '</div>' : '') +
    '<div class="card"><h3>Agenda</h3>' + (d.agenda.length ? '<ul class="agenda">' + d.agenda.map(a =>
      '<li><span class="' + (a.done ? 'done' : '') + '">' + esc(a.text) + '</span></li>').join('') + '</ul>' : '<p class="hint" style="margin:0">No agenda yet. Open floor.</p>') + '</div>' +
    (d.status === 'done' ? '<div class="card"><h3>Recap</h3>' +
      '<p class="hint" style="margin-top:0"><b>Attended:</b> ' + (d.attendance.length ? esc(d.attendance.map(a => a.display_name).join(', ')) : 'nobody marked in') + '</p>' +
      (d.notes ? '<div class="pitch" style="font-size:.9rem">' + linkify(esc(d.notes)) + '</div>' : '') +
      (d.action_items.length ? '<ul class="actions-list">' + d.action_items.map(a =>
        '<li><span class="' + (a.done ? 'done' : '') + '">' + esc(a.text) + '<small>' + (a.assignee ? esc(a.assignee) : 'Unassigned') + (a.due_on ? ' &middot; due ' + fmtDate(a.due_on) : '') + '</small></span></li>').join('') + '</ul>' : '') +
      '</div>' : '') +
    (host ? '<div class="card"><h3>Host tools</h3><div class="row wrap">' +
      (d.status === 'scheduled' ? '<button class="btn primary" id="goLive">Go live</button>' : '') +
      (d.status === 'live' ? '<button class="btn primary" id="wrapUp">Wrap up</button>' : '') +
      (d.status === 'done' ? '<button class="btn" id="reopen">Reopen</button>' : '') +
      '<a class="btn" href="#/sessions/' + d.id + '/edit">Edit</a>' +
      '<button class="btn danger" id="delSession">Delete</button></div></div>' : '') +
    DISCLAIMER;

  el.querySelectorAll('[data-rsvp]').forEach(b => b.addEventListener('click', async () => {
    try { await cloud.rsvp(d.id, b.dataset.rsvp); state.announce('sessions'); await loadDetail(d.id); }
    catch (err) { toast(err.message); }
  }));
  const setStatus = async st => {
    try { await cloud.setSessionStatus(d.id, st); state.announce('sessions'); cloud.ping('rt-session-' + d.id, 'status'); await loadDetail(d.id); state.refresh(); }
    catch (err) { toast(err.message); }
  };
  el.querySelector('#goLive')?.addEventListener('click', () => setStatus('live'));
  el.querySelector('#wrapUp')?.addEventListener('click', () => setStatus('done'));
  el.querySelector('#reopen')?.addEventListener('click', () => setStatus('live'));
  el.querySelector('#delSession')?.addEventListener('click', async () => {
    if (!confirm('Delete this session, its chat, notes and actions?')) return;
    try { await cloud.deleteSession(d.id); state.announce('sessions'); location.hash = '#/sessions'; }
    catch (err) { toast(err.message); }
  });
}

async function loadDetail(id) {
  try {
    detail = await cloud.sessionDetail(id);
    if (roomId === id) paintRoom(); else paintDetail();
  } catch (err) {
    if (handleKick(err)) return;
    el.innerHTML = '<div class="card"><p>' + esc(err.message) + '</p><a class="btn mt" href="#/sessions">Back to sessions</a></div>';
  }
}

function renderDetail(id) {
  detail = null;
  el.innerHTML = '<div class="empty">Loading&hellip;</div>';
  loadDetail(id);
  unsubs.push(cloud.on('rt-table', 'sessions', () => loadDetail(id)));
}

// ---------- live room ----------

function roomNames() {
  const ids = Object.keys(roomPresence || {});
  const names = ids.map(uid => {
    const arr = roomPresence[uid];
    const meta = Array.isArray(arr) && arr.length ? arr[arr.length - 1] : null;
    return meta?.name || state.S.members.find(m => m.user_id === uid)?.display_name || 'Someone';
  });
  return names;
}

function chatHtml(m) {
  const mine = m.author_id === cloud.user()?.id;
  return '<div class="msg' + (mine ? ' me' : '') + '">' + (mine ? '' : '<span class="who">' + esc(m.author) + '</span>') +
    '<div class="bubble">' + linkify(esc(m.body)) + '</div><small class="t">' + fmtTime(m.created_at) + '</small></div>';
}

function sectionHtml() {
  const d = detail;
  const uid = cloud.user()?.id;
  if (section === 'chat') {
    return '<div class="chat" id="chatList">' + (d.messages.length ? d.messages.map(chatHtml).join('') : '<div class="empty">Say g\'day. Chat lives here during the session.</div>') + '</div>' +
      '<div class="chatbar"><input type="text" id="chatInput" maxlength="2000" placeholder="Message the room" autocomplete="off"><button class="btn primary" id="chatSend">Send</button></div>';
  }
  if (section === 'agenda') {
    return '<div class="card">' + (d.agenda.length ? '<ul class="agenda">' + d.agenda.map(a =>
      '<li><input type="checkbox" data-agenda="' + a.id + '"' + (a.done ? ' checked' : '') + '><span class="' + (a.done ? 'done' : '') + '">' + esc(a.text) +
      (a.done && a.done_by ? '<small>Ticked by ' + esc(a.done_by) + '</small>' : '') + '</span></li>').join('') + '</ul>' :
      '<p class="hint" style="margin:0">No agenda for this one. Open floor.</p>') + '</div>';
  }
  if (section === 'notes') {
    return '<div class="card"><h3>Shared notes <small>(everyone can edit)</small></h3>' +
      '<textarea id="notesBox" maxlength="20000" style="min-height:260px" placeholder="The whiteboard. Numbers, decisions, links, who is doing what.">' + esc(d.notes || '') + '</textarea>' +
      '<div class="notes-meta"><span id="notesMeta">' + (d.notes_at ? 'Last edited by ' + esc(d.notes_by || 'someone') + ' ' + timeAgo(d.notes_at) : 'Nothing written yet') + '</span><span id="notesState"></span></div></div>';
  }
  // actions
  return '<div class="card"><h3>Action items</h3>' +
    (d.action_items.length ? '<ul class="actions-list">' + d.action_items.map(a =>
      '<li><input type="checkbox" data-action="' + a.id + '"' + (a.done ? ' checked' : '') + '><span class="grow ' + (a.done ? 'done' : '') + '">' + esc(a.text) +
      '<small>' + (a.assignee ? esc(a.assignee) : 'Unassigned') + (a.due_on ? ' &middot; due ' + fmtDate(a.due_on) : '') + '</small></span>' +
      (a.created_by === uid || state.isHost() ? '<button class="linkbtn danger" style="padding:0" data-delaction="' + a.id + '">Delete</button>' : '') + '</li>').join('') + '</ul>' :
      '<p class="hint" style="margin-top:0">Nothing assigned yet. Who is doing what before next time?</p>') +
    '<div class="stack"><input type="text" id="aText" maxlength="300" placeholder="What needs doing">' +
    '<div class="row"><select id="aWho" class="grow"><option value="">Unassigned</option>' + state.S.members.map(m =>
      '<option value="' + m.user_id + '"' + (m.user_id === uid ? ' selected' : '') + '>' + esc(m.display_name) + '</option>').join('') + '</select>' +
    '<input type="date" id="aDue" style="width:46%"></div>' +
    '<button class="btn primary" id="aAdd">Add action</button></div></div>';
}

function paintRoom() {
  const d = detail;
  if (!d || !el) return;
  const host = state.isHost();
  let header = el.querySelector('#roomHead');
  if (!header) {
    el.innerHTML = '<div id="roomHead"></div>' +
      '<div class="section-tabs" id="roomTabs">' + ['chat', 'agenda', 'notes', 'actions'].map(s =>
        '<button data-sec="' + s + '"' + (section === s ? ' class="on"' : '') + '>' + s[0].toUpperCase() + s.slice(1) + '</button>').join('') + '</div>' +
      '<div id="roomBody"></div>' + DISCLAIMER;
    el.querySelectorAll('[data-sec]').forEach(b => b.addEventListener('click', () => {
      section = b.dataset.sec;
      el.querySelectorAll('[data-sec]').forEach(x => x.classList.toggle('on', x === b));
      paintSection();
    }));
    header = el.querySelector('#roomHead');
  }
  const names = roomNames();
  header.innerHTML = '<div class="card gold tight">' +
    '<div class="spread"><div><div class="pills">' + statusPill(d.status) + '</div><b style="font-size:1.05rem">' + esc(d.title) + '</b>' +
    '<div class="hint" style="margin:2px 0 0">' + fmtDateTime(d.starts_at) + '</div></div>' +
    (host && d.status !== 'done' ? '<button class="btn sm" id="wrapUp">Wrap up</button>' : '') + '</div>' +
    (d.meet_link ? '<a class="btn primary mt" href="' + esc(safeUrl(d.meet_link)) + '" target="_blank" rel="noopener" style="width:100%">Join the call</a>' : '') +
    '<div class="hint" style="margin:8px 0 0"><b>In the room:</b> ' + (names.length ? esc(names.join(', ')) : 'just you') + '</div></div>';
  header.querySelector('#wrapUp')?.addEventListener('click', async () => {
    if (!confirm('Wrap up the session? It moves to Done and attendance is locked in.')) return;
    try {
      await cloud.setSessionStatus(d.id, 'done');
      state.announce('sessions');
      cloud.ping('rt-session-' + d.id, 'status');
      toast('Session wrapped. Nice one.');
      await loadDetail(d.id);
      state.refresh();
    } catch (err) { toast(err.message); }
  });
  paintSection();
}

function paintSection() {
  const d = detail;
  const body = el?.querySelector('#roomBody');
  if (!d || !body) return;

  // Chat: keep the input, only refresh the list.
  if (section === 'chat' && body.querySelector('#chatList')) {
    body.querySelector('#chatList').innerHTML = d.messages.length ? d.messages.map(chatHtml).join('') : '<div class="empty">Say g\'day. Chat lives here during the session.</div>';
    window.scrollTo(0, document.body.scrollHeight);
    return;
  }
  // Notes: never clobber what someone is typing.
  if (section === 'notes' && body.querySelector('#notesBox')) {
    const box = body.querySelector('#notesBox');
    const serverNewer = d.notes_at && (!notesSavedAt || new Date(d.notes_at) > new Date(notesSavedAt));
    if (!notesDirty && serverNewer && box.value !== d.notes) box.value = d.notes || '';
    body.querySelector('#notesMeta').textContent = d.notes_at ? 'Last edited by ' + (d.notes_by || 'someone') + ' ' + timeAgo(d.notes_at) : 'Nothing written yet';
    return;
  }

  body.innerHTML = sectionHtml();

  if (section === 'chat') {
    const send = async () => {
      const input = body.querySelector('#chatInput');
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      try { await cloud.sendSessionMessage(d.id, text); cloud.ping('rt-session-' + d.id, 'chat'); await loadDetail(d.id); }
      catch (err) { toast(err.message); input.value = text; }
    };
    body.querySelector('#chatSend').addEventListener('click', send);
    body.querySelector('#chatInput').addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
    window.scrollTo(0, document.body.scrollHeight);
  } else if (section === 'agenda') {
    body.querySelectorAll('[data-agenda]').forEach(cb => cb.addEventListener('change', async () => {
      try { await cloud.tickAgenda(cb.dataset.agenda, cb.checked); cloud.ping('rt-session-' + d.id, 'agenda'); await loadDetail(d.id); }
      catch (err) { toast(err.message); cb.checked = !cb.checked; }
    }));
  } else if (section === 'notes') {
    const box = body.querySelector('#notesBox');
    const stateEl = body.querySelector('#notesState');
    const save = debounce(async () => {
      try {
        const ts = await cloud.saveNotes(d.id, box.value);
        notesSavedAt = ts;
        notesDirty = false;
        stateEl.textContent = 'Saved';
        body.querySelector('#notesMeta').textContent = 'Last edited by you just now';
        cloud.ping('rt-session-' + d.id, 'notes');
      } catch (err) { stateEl.textContent = 'Not saved: ' + err.message; }
    }, 800);
    box.addEventListener('input', () => { notesDirty = true; stateEl.textContent = 'Saving…'; save(); });
  } else {
    body.querySelectorAll('[data-action]').forEach(cb => cb.addEventListener('change', async () => {
      try { await cloud.updateActionItem(cb.dataset.action, { done: cb.checked }); cloud.ping('rt-session-' + d.id, 'actions'); state.announce('sessions'); await loadDetail(d.id); }
      catch (err) { toast(err.message); cb.checked = !cb.checked; }
    }));
    body.querySelectorAll('[data-delaction]').forEach(b => b.addEventListener('click', async () => {
      try { await cloud.deleteActionItem(b.dataset.delaction); cloud.ping('rt-session-' + d.id, 'actions'); await loadDetail(d.id); }
      catch (err) { toast(err.message); }
    }));
    body.querySelector('#aAdd').addEventListener('click', async e => {
      const text = body.querySelector('#aText').value.trim();
      if (!text) return;
      e.target.disabled = true;
      try {
        await cloud.addActionItem(d.id, text, body.querySelector('#aWho').value, body.querySelector('#aDue').value || null);
        cloud.ping('rt-session-' + d.id, 'actions');
        state.announce('sessions');
        await loadDetail(d.id);
      } catch (err) { toast(err.message); e.target.disabled = false; }
    });
  }
}

async function renderRoom(id) {
  detail = null;
  roomId = id;
  notesDirty = false;
  notesSavedAt = null;
  section = 'chat';
  el.innerHTML = '<div class="empty">Opening the room&hellip;</div>';
  cloud.markAttendance(id).catch(() => {});
  const ch = 'rt-session-' + id;
  ['chat', 'agenda', 'notes', 'actions', 'status', 'rsvp'].forEach(ev => unsubs.push(cloud.on(ch, ev, () => loadDetail(id))));
  unsubs.push(cloud.onPresence(ch, st => { roomPresence = st; if (detail) paintRoom(); }));
  cloud.track(ch, { uid: cloud.user().id, name: state.myName(), at: Date.now() });
  unsubs.push(() => { cloud.leave(ch); roomId = null; roomPresence = {}; });
  await loadDetail(id);
}

// ---------- entry ----------

export async function render(root, id, mode) {
  el = root;
  unsubs.forEach(fn => fn());
  unsubs = [];
  const gateKey = () => JSON.stringify([!!cloud.user(), !!state.S.status, state.isMember(), state.S.status?.host_claimed]);
  const startKey = gateKey();
  unsubs.push(state.onChange(() => { if (gateKey() !== startKey) render(root, id, mode); }));
  if (!gate(el)) return;
  el.dataset.ready = '1';
  const hash = location.hash;
  if (/\/new$/.test(hash)) renderForm(null);
  else if (id && mode === 'edit') renderForm(id);
  else if (id && mode === 'live') renderRoom(id);
  else if (id) renderDetail(id);
  else renderList();
}

export function destroy() {
  unsubs.forEach(f => f());
  unsubs = [];
  if (el) delete el.dataset.ready;
  el = null;
  detail = null;
}
