// Home: the round table (3D or flat), the next session, and who is here.
import * as cloud from '../cloud.js';
import * as state from '../state.js';
import { esc, initials, timeAgo, fmtDateTime, untilText, toast } from '../util.js';
import { gate, DISCLAIMER } from './shared.js';

export const title = 'Generational';

let unsubs = [];
let table = null;       // table3d module once loaded
let tableFailed = false;
let el = null;
let nextSession = null;
let tipTimer = null;

function webglOk() {
  if (/[?&]no3d=1/.test(location.search)) return false;
  if (navigator.deviceMemory && navigator.deviceMemory < 2) return false;
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch { return false; }
}

function seatRow(s) {
  const dot = s.active ? 'active' : (s.online ? 'on' : '');
  const sub = s.active ? (s.view && /\/live$/.test(s.view) ? 'In the room' : 'Active now')
    : s.online ? 'Online' : (s.lastActiveAt ? 'Active ' + timeAgo(s.lastActiveAt) : 'Not active yet');
  return '<a class="seat" href="#/member/' + s.id + '">' +
    '<span class="avatar' + (s.online ? ' on' : '') + '">' + esc(initials(s.name)) + '</span>' +
    '<div class="grow"><div class="name"><span class="dot ' + dot + '"></span>' + esc(s.name) +
    (s.isHost ? ' <span class="pill gold">Host</span>' : '') + (s.isSelf ? ' <span class="pill">You</span>' : '') + '</div>' +
    '<div class="sub">' + sub + '</div></div>' +
    '<div class="pts">' + s.points + '<small>' + (s.streak ? s.streak + ' session streak' : 'points') + '</small></div>' +
    '</a>';
}

function goalsNudge() {
  const p = state.S.profile;
  if (!p || p.goals) return '';
  return '<a class="card gold" href="#/me" style="display:block;text-decoration:none;color:inherit"><h3>Tell the table what you are chasing</h3>' +
    '<p class="hint" style="margin:0">Add your goals and focus areas so your mates know what to back you on. Takes a minute.</p></a>';
}

function nextSessionCard() {
  if (!nextSession) {
    return '<div class="card"><h3>Next round table</h3><p class="hint" style="margin:0">Nothing scheduled yet.' +
      (state.isHost() ? ' <a href="#/sessions/new">Schedule one</a>.' : ' The host will post the next one here.') + '</p></div>';
  }
  const s = nextSession;
  const live = s.status === 'live';
  return '<a class="card gold" href="#/sessions/' + s.id + '" style="display:block;text-decoration:none;color:inherit">' +
    '<h3>' + (live ? '<span class="pill green live">Live now</span>' : 'Next round table') + '</h3>' +
    '<div class="when">' + esc(s.title) + '</div>' +
    '<div class="hint" style="margin:4px 0 0">' + fmtDateTime(s.starts_at) + ' (' + untilText(s.starts_at) + ')' +
    (s.yes_count ? ' &middot; ' + s.yes_count + ' in' : '') +
    (s.my_rsvp ? ' &middot; you said ' + esc(s.my_rsvp) : ' &middot; RSVP') + '</div></a>';
}

function paint() {
  if (!el) return;
  const seats = state.seats();
  const online = seats.filter(s => s.online).length;
  const stats = el.querySelector('#homeStats');
  if (stats) {
    stats.innerHTML =
      '<div class="stat"><span class="lbl">At the table</span><b>' + seats.length + '</b></div>' +
      '<div class="stat"><span class="lbl">Here now</span><b>' + online + '</b></div>' +
      '<div class="stat"><span class="lbl">Your points</span><b>' + (seats.find(s => s.isSelf)?.points ?? 0) + '</b></div>';
  }
  const list = el.querySelector('#seatList');
  if (list) list.innerHTML = seats.length ? seats.map(seatRow).join('') :
    '<div class="empty">Just you so far. Share your invite code from the Me screen.</div>';
  const next = el.querySelector('#nextSession');
  if (next) next.innerHTML = goalsNudge() + nextSessionCard();
  if (table) {
    table.setMembers(seats.map(s => ({ ...s, initials: initials(s.name) })));
    table.setSessionTitle(nextSession ? nextSession.title : '');
  }
}

async function loadNext() {
  try {
    const list = await cloud.listSessions();
    const cutoff = Date.now() - 4 * 3600000;
    const upcoming = list.filter(s => s.status === 'live' || (s.status === 'scheduled' && new Date(s.starts_at).getTime() > cutoff))
      .sort((a, b) => (a.status === 'live' ? -1 : 1) - (b.status === 'live' ? -1 : 1) || new Date(a.starts_at) - new Date(b.starts_at));
    nextSession = upcoming[0] || null;
  } catch { nextSession = null; }
  paint();
}

async function mount3d(hero) {
  const canvas = hero.querySelector('canvas');
  const loading = hero.querySelector('.loading');
  try {
    table = await import('../table3d.js');
    await table.init(canvas, { glbUrl: new URL('../../assets/models/table.glb', import.meta.url).href });
    loading?.remove();
    table.onSeatTap((seat, pos) => {
      const tip = document.createElement('div');
      tip.className = 'seat-tip';
      tip.style.left = pos.x + 'px';
      tip.style.top = pos.y + 'px';
      const sub = seat.active ? 'Active now' : seat.online ? 'Online' :
        (seat.lastActiveAt ? 'Active ' + timeAgo(seat.lastActiveAt) : 'Not active yet');
      tip.innerHTML = '<b>' + esc(seat.name) + '</b>' + (seat.isHost ? ' <span class="pill gold">Host</span>' : '') +
        '<small>' + sub + ' &middot; ' + seat.points + ' pts</small>';
      const prev = hero.querySelector('.seat-tip');
      if (prev && prev.dataset.uid === seat.id) { location.hash = '#/member/' + seat.id; return; }
      hero.querySelectorAll('.seat-tip').forEach(t => t.remove());
      tip.dataset.uid = seat.id;
      tip.innerHTML += '<small>Tap again for profile</small>';
      hero.appendChild(tip);
      clearTimeout(tipTimer);
      tipTimer = setTimeout(() => tip.remove(), 2600);
    });
    paint();
  } catch (err) {
    console.warn('3D table unavailable', err);
    tableFailed = true;
    table = null;
    hero.remove();
  }
}

export async function render(root) {
  el = root;
  unsubs.forEach(fn => fn());
  unsubs = [];
  const gateKey = () => JSON.stringify([!!cloud.user(), !!state.S.status, state.isMember(), state.S.status?.host_claimed]);
  const startKey = gateKey();
  unsubs.push(state.onChange(() => {
    if (gateKey() !== startKey || (state.isMember() && !el.querySelector('#seatList'))) render(root);
    else if (state.isMember()) paint();
  }));
  if (!gate(el)) return;

  const use3d = !tableFailed && webglOk();
  el.innerHTML =
    (use3d ? '<div class="hero3d" id="hero"><canvas></canvas><div class="loading">Setting the table&hellip;</div>' +
      '<div class="hero-title"><h2>' + esc(state.tableName()) + '</h2><p>Drag to look around. Tap a seat.</p></div></div>' : '') +
    '<div class="statgrid" id="homeStats"></div>' +
    '<div id="nextSession"></div>' +
    '<h3>Seats</h3><div class="seats" id="seatList"></div>' +
    DISCLAIMER;

  paint();
  loadNext();
  unsubs.push(cloud.on('rt-table', 'sessions', loadNext));
  if (use3d) mount3d(el.querySelector('#hero'));
  state.refresh({ throttle: true });
}

export function destroy() {
  unsubs.forEach(f => f());
  unsubs = [];
  if (table) { try { table.dispose(); } catch {} table = null; }
  clearTimeout(tipTimer);
  el = null;
}
