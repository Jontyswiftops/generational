// Tables: every table you sit at, switch between them, join another with a
// code, and (owner only) open a new one.
import * as cloud from '../cloud.js';
import * as state from '../state.js';
import { esc, toast } from '../util.js';
import { signInCard, bindJoin, DISCLAIMER, gateKey } from './shared.js';

export const title = 'Tables';

let unsubs = [];
let el = null;

function tableRow(t) {
  const on = t.id === state.S.tableId;
  return '<button class="thread" data-table="' + t.id + '" style="width:100%;text-align:left;font:inherit;cursor:pointer' + (on ? ';border-color:rgba(212,168,75,.5);background:var(--accent-dim)' : '') + '">' +
    '<span class="avatar' + (on ? ' on' : '') + '">' + esc(t.name.slice(0, 2).toUpperCase()) + '</span>' +
    '<div class="grow"><b>' + esc(t.name) + (on ? ' <span class="pill gold">Open</span>' : '') + (t.role === 'host' ? ' <span class="pill">Host</span>' : '') + '</b>' +
    '<div class="last">' + t.member_count + ' member' + (t.member_count === 1 ? '' : 's') + '</div></div>' +
    (t.unread ? '<span class="unread">' + t.unread + '</span>' : '') + '</button>';
}

function paint() {
  const tables = state.S.tables;
  el.innerHTML =
    '<h3>Your tables</h3>' +
    (tables.length ? tables.map(tableRow).join('') : '<div class="empty">You are not at a table yet.</div>') +
    '<div class="card mt"><h3>Join another table</h3>' +
    '<div class="row"><input type="text" id="joinCode" placeholder="Invite code" maxlength="8" autocapitalize="characters" autocomplete="off" spellcheck="false">' +
    '<button class="btn primary" id="joinBtn">Join</button></div><div class="hint" id="joinStatus"></div></div>' +
    (state.isOwner() ? '<div class="card"><h3>Open a new table</h3>' +
      '<p class="hint" style="margin-top:0">A separate space with its own members, invite code, ideas, sessions and chat. Only you can open tables.</p>' +
      '<div class="row"><input type="text" id="newTableName" placeholder="Table name" maxlength="60">' +
      '<button class="btn" id="createTableBtn">Open</button></div><div class="hint" id="createStatus"></div></div>' : '') +
    DISCLAIMER;
  el.querySelectorAll('[data-table]').forEach(b => b.addEventListener('click', async () => {
    await state.switchTable(b.dataset.table);
    location.hash = '#/';
  }));
  bindJoin(el);
}

export async function render(root) {
  el = root;
  unsubs.forEach(fn => fn());
  unsubs = [];
  if (!cloud.user()) { el.innerHTML = signInCard(); return; }
  const startKey = gateKey();
  unsubs.push(state.onChange(() => { if (gateKey() !== startKey || !el.querySelector('#joinBtn')) paint(); }));
  paint();
  state.refresh({ throttle: true });
}

export function destroy() {
  unsubs.forEach(f => f());
  unsubs = [];
  el = null;
}
