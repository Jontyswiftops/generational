// Bits every view needs: the signed-out and no-table gates, the
// join-with-code card, and small HTML helpers.
import * as cloud from '../cloud.js';
import * as state from '../state.js';
import { esc, initials, toast } from '../util.js';

export const DISCLAIMER = '<p class="disclaimer">A discussion space between mates. Nothing here is financial advice.</p>';

export function signInCard() {
  return '<div class="card center gold"><h2>Generational</h2>' +
    '<p>A private round table for mates building wealth together. Sign in to take your seat.</p>' +
    '<a class="btn primary" href="#/me">Sign in</a></div>' + DISCLAIMER;
}

export function joinCard() {
  let html = '<div class="card gold"><h3>Take your seat</h3>' +
    '<p class="hint" style="margin-top:0">Generational is invite only. Enter the code your mate sent you, or open their invite link.</p>' +
    '<div class="row"><input type="text" id="joinCode" placeholder="Invite code" maxlength="8" autocapitalize="characters" autocomplete="off" spellcheck="false">' +
    '<button class="btn primary" id="joinBtn">Join</button></div>' +
    '<div class="hint" id="joinStatus"></div></div>';
  if (state.isOwner()) {
    html += '<div class="card"><h3>Open a new table</h3>' +
      '<p class="hint" style="margin-top:0">You can run more than one table. Each has its own members, invite code, ideas, sessions and chat.</p>' +
      '<div class="row"><input type="text" id="newTableName" placeholder="Table name" maxlength="60">' +
      '<button class="btn" id="createTableBtn">Open</button></div><div class="hint" id="createStatus"></div></div>';
  }
  return html;
}

export function bindJoin(el) {
  const btn = el.querySelector('#joinBtn');
  if (btn) btn.addEventListener('click', async () => {
    const code = (el.querySelector('#joinCode').value || '').trim().toUpperCase();
    const status = el.querySelector('#joinStatus');
    if (!code) { status.textContent = 'Enter the invite code first.'; return; }
    btn.disabled = true;
    try {
      const t = await cloud.joinTable(code);
      await state.refresh();
      await state.switchTable(t.id);
      toast('Welcome to ' + t.name);
      location.hash = '#/';
    } catch (err) {
      status.textContent = err.message || 'That code did not work.';
      btn.disabled = false;
    }
  });
  const create = el.querySelector('#createTableBtn');
  if (create) create.addEventListener('click', async () => {
    const name = (el.querySelector('#newTableName').value || '').trim();
    const status = el.querySelector('#createStatus');
    if (!name) { status.textContent = 'Give the table a name.'; return; }
    create.disabled = true;
    try {
      const id = await cloud.createTable(name);
      await state.refresh();
      await state.switchTable(id);
      toast(name + ' is open. Share the invite code from the Me screen.');
      location.hash = '#/me';
    } catch (err) {
      status.textContent = err.message || 'Could not open the table.';
      create.disabled = false;
    }
  });
}

// Returns true when the view may render member content. Otherwise paints the
// right gate into el and returns false.
export function gate(el) {
  if (!cloud.user()) {
    el.innerHTML = signInCard();
    return false;
  }
  if (!state.S.tableId) {
    if (!state.S.tables.length && state.S.error === null && !state.S.profile) {
      el.innerHTML = '<div class="empty">Setting the table&hellip;</div>';
      return false;
    }
    el.innerHTML = joinCard() + DISCLAIMER;
    bindJoin(el);
    return false;
  }
  if (!state.S.status) {
    el.innerHTML = '<div class="empty">Setting the table&hellip;</div>';
    return false;
  }
  if (!state.isMember()) {
    el.innerHTML = joinCard() + DISCLAIMER;
    bindJoin(el);
    return false;
  }
  return true;
}

// Views re-render only when this changes, never on a presence tick.
export function gateKey() {
  return JSON.stringify([!!cloud.user(), state.S.tableId, !!state.S.status, state.isMember(), state.S.tables.length]);
}

export function avatar(name, cls = '') {
  return '<span class="avatar ' + cls + '">' + esc(initials(name)) + '</span>';
}

export function notMember(err) {
  return /not a member/i.test(err?.message || '');
}

// When an RPC says we are no longer a member, refresh so the gate shows.
export function handleKick(err) {
  if (notMember(err)) { state.refresh(); return true; }
  return false;
}
