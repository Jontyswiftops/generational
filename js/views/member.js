// A member's profile: goals, focus areas, form, and a button to message them.
import * as cloud from '../cloud.js';
import * as state from '../state.js';
import { esc, initials, timeAgo, linkify, FOCUS } from '../util.js';
import { gate, DISCLAIMER , gateKey } from './shared.js';

export const title = 'Member';

let unsubs = [];
let el = null;

function paint(uid) {
  const m = state.member(uid);
  if (!m) {
    el.innerHTML = '<div class="empty">That seat is empty.</div><a class="btn" href="#/">Back to the table</a>';
    return;
  }
  const seat = state.seats().find(s => s.id === uid);
  const status = seat?.active ? 'Active now' : seat?.online ? 'Online' :
    (m.last_active_at ? 'Active ' + timeAgo(m.last_active_at) : 'Not active yet');
  el.innerHTML =
    '<div class="card gold">' +
    '<div class="row"><span class="avatar' + (seat?.online ? ' on' : '') + '" style="width:52px;height:52px;font-size:1rem">' + esc(initials(m.display_name)) + '</span>' +
    '<div class="grow"><h2 style="margin:0">' + esc(m.display_name) + (m.role === 'host' ? ' <span class="pill gold">Host</span>' : '') + (m.is_self ? ' <span class="pill">You</span>' : '') + '</h2>' +
    '<div class="hint" style="margin:2px 0 0">' + status + ' &middot; joined ' + timeAgo(m.joined_at) + '</div></div></div>' +
    (m.is_self ? '<a class="btn mt" href="#/me" style="width:100%">Edit your profile</a>' :
      '<a class="btn primary mt" href="#/dm/' + m.user_id + '" style="width:100%">Message ' + esc(m.display_name.split(' ')[0]) + '</a>') +
    '</div>' +
    '<div class="statgrid">' +
    '<div class="stat"><span class="lbl">Points</span><b>' + m.points + '</b></div>' +
    '<div class="stat"><span class="lbl">Streak</span><b>' + m.streak + '</b></div>' +
    '<div class="stat"><span class="lbl">Sessions</span><b>' + (m.attended_count ?? 0) + '</b></div>' +
    '</div>' +
    '<div class="card"><h3>What ' + (m.is_self ? 'you are' : esc(m.display_name.split(' ')[0]) + ' is') + ' chasing</h3>' +
    (m.goals ? '<div class="goals">' + linkify(esc(m.goals)) + '</div>' :
      '<p class="hint" style="margin:0">' + (m.is_self ? 'You have not written your goals yet. <a href="#/me">Add them</a> so the table knows what to back you on.' : 'Nothing written yet.') + '</p>') +
    ((m.focus || []).length ? '<div class="focus-chips mt">' + m.focus.map(f => '<button class="on" disabled>' + esc(FOCUS[f] || f) + '</button>').join('') + '</div>' : '') +
    '</div>' +
    '<div class="card tight"><div class="counts" style="margin:0"><span><b>' + (m.ideas_count ?? 0) + '</b> ideas pitched</span><span><b>' + (m.posts_count ?? 0) + '</b> wins posted</span></div></div>' +
    DISCLAIMER;
}

export async function render(root, uid) {
  el = root;
  unsubs.forEach(fn => fn());
  unsubs = [];
  const startKey = gateKey();
  unsubs.push(state.onChange(() => { if (gateKey() !== startKey) render(root, uid); else if (state.isMember()) paint(uid); }));
  if (!gate(el)) return;
  paint(uid);
  state.refresh({ throttle: true });
}

export function destroy() {
  unsubs.forEach(f => f());
  unsubs = [];
  el = null;
}
