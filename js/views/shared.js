// Bits every view needs: the signed-out and not-yet-a-member gates, the
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
  const s = state.S.status;
  let html = '<div class="card gold"><h3>Take your seat</h3>' +
    '<p class="hint" style="margin-top:0">Generational is invite only. Enter the code your mate sent you, or open their invite link.</p>' +
    '<div class="row"><input type="text" id="joinCode" placeholder="Invite code" maxlength="8" autocapitalize="characters" autocomplete="off" spellcheck="false">' +
    '<button class="btn primary" id="joinBtn">Join</button></div>' +
    '<div class="hint" id="joinStatus"></div></div>';
  if (s && !s.host_claimed) {
    html += '<div class="card"><h3>Starting a new table?</h3>' +
      '<p class="hint" style="margin-top:0">Nobody has claimed the host seat yet. The host runs the table: invites, sessions, and the house rules.</p>' +
      '<button class="btn" id="claimBtn">Claim the host seat</button></div>';
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
      await cloud.joinTable(code);
      await state.refresh();
      toast('Welcome to ' + state.tableName());
      location.hash = '#/';
    } catch (err) {
      status.textContent = err.message || 'That code did not work.';
      btn.disabled = false;
    }
  });
  const claim = el.querySelector('#claimBtn');
  if (claim) claim.addEventListener('click', async () => {
    claim.disabled = true;
    try {
      await cloud.claimHost();
      await state.refresh();
      toast('You are the host. Share your invite code from the Me screen.');
      location.hash = '#/me';
    } catch (err) {
      toast(err.message || 'Could not claim the host seat');
      claim.disabled = false;
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
  if (!state.S.status) {
    el.innerHTML = '<div class="empty">Setting the table&hellip;</div>';
    // status arrives via state.refresh(); the caller re-renders on change
    return false;
  }
  if (!state.isMember()) {
    el.innerHTML = joinCard() + DISCLAIMER;
    bindJoin(el);
    return false;
  }
  return true;
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
