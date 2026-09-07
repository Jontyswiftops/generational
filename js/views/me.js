// Me: sign in, account, membership, and host tools.
import * as cloud from '../cloud.js';
import * as state from '../state.js';
import { esc, initials, toast, timeAgo } from '../util.js';
import { joinCard, bindJoin, DISCLAIMER } from './shared.js';

export const title = 'Me';

let unsubs = [];
let el = null;

function signInHtml() {
  return '<div class="card gold"><h3>Sign in</h3>' +
    '<p class="hint" style="margin-top:0">Same email and password on every device. Your mates only ever see your display name.</p>' +
    '<input type="email" id="authEmail" placeholder="you@email.com" autocomplete="email">' +
    '<div class="mt"><input type="password" id="authPw" placeholder="Password" autocomplete="current-password"></div>' +
    '<div class="row mt"><button class="btn primary grow" id="pwSignIn">Sign in</button>' +
    '<button class="btn grow" id="pwSignUp">Create account</button></div>' +
    '<div class="hint" id="authStatus"></div>' +
    '<button class="linkbtn" id="emailToggle">Email me a sign-in code instead</button>' +
    '<div id="emailBox" hidden>' +
    '<button class="btn" id="magicBtn">Email me a sign-in code</button>' +
    '<div id="otpBox" hidden class="mt">' +
    '<label for="otpInput">6-digit code from the email</label>' +
    '<div class="row"><input type="text" id="otpInput" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456">' +
    '<button class="btn sm" id="otpBtn">Verify</button></div>' +
    '</div>' +
    '<div class="hint">If the email only contains a link, it opens in your browser rather than this app. Signing in with a password avoids that.</div>' +
    '</div></div>' + DISCLAIMER;
}

function bindSignIn() {
  el.querySelector('#magicBtn').addEventListener('click', async e => {
    const email = el.querySelector('#authEmail').value.trim();
    const status = el.querySelector('#authStatus');
    if (!email || !email.includes('@')) { status.textContent = 'Enter your email address first.'; return; }
    e.target.disabled = true;
    const { error } = await cloud.sendMagicLink(email);
    e.target.disabled = false;
    if (error) status.textContent = 'Could not send the email: ' + error.message;
    else {
      status.textContent = 'Check your email, then type the 6-digit code below. It can take a minute to arrive.';
      el.querySelector('#otpBox').hidden = false;
      el.querySelector('#otpInput').focus();
    }
  });
  el.querySelector('#otpBtn').addEventListener('click', async e => {
    const email = el.querySelector('#authEmail').value.trim();
    const token = el.querySelector('#otpInput').value.trim();
    const status = el.querySelector('#authStatus');
    if (token.length < 6) { status.textContent = 'Enter the 6-digit code from the email.'; return; }
    e.target.disabled = true;
    const { error } = await cloud.verifyEmailCode(email, token);
    e.target.disabled = false;
    if (error) status.textContent = 'That code did not work: ' + error.message + ' Codes expire after a while; you can request a new one.';
  });
  el.querySelector('#emailToggle').addEventListener('click', () => {
    const box = el.querySelector('#emailBox');
    box.hidden = !box.hidden;
  });
  const pwAuth = async signUp => {
    const email = el.querySelector('#authEmail').value.trim();
    const pw = el.querySelector('#authPw').value;
    const status = el.querySelector('#authStatus');
    if (!email || !pw) { status.textContent = 'Enter your email and a password.'; return; }
    if (signUp && pw.length < 6) { status.textContent = 'Use at least 6 characters for the password.'; return; }
    status.textContent = signUp ? 'Creating your account…' : 'Signing in…';
    const { error } = signUp
      ? await cloud.signUpPassword(email, pw)
      : await cloud.signInPassword(email, pw);
    if (error) {
      status.textContent = /invalid login credentials/i.test(error.message)
        ? 'That email and password do not match. If you normally sign in with an emailed code, your account has no password yet: sign in with a code, then set a password here.'
        : error.message;
    } else if (signUp) {
      status.textContent = 'Account created. If your email needs confirming, check your inbox, then sign in.';
    }
  };
  el.querySelector('#pwSignIn').addEventListener('click', () => pwAuth(false));
  el.querySelector('#pwSignUp').addEventListener('click', () => pwAuth(true));
  el.querySelector('#authPw').addEventListener('keydown', e => { if (e.key === 'Enter') pwAuth(false); });
}

const inviteLink = code => location.origin + location.pathname + '#join=' + code;

function accountHtml() {
  const u = cloud.user();
  const s = state.S.status;
  let html =
    '<div class="card"><h3>Account</h3>' +
    '<div class="row mb"><span class="avatar on">' + esc(initials(state.myName() || u.email)) + '</span>' +
    '<div class="grow"><b>' + esc(state.myName() || 'Set your name') + '</b><div class="hint" style="margin:0">' + esc(u.email || '') + '</div></div></div>' +
    '<label for="nameInput">Display name (what the table sees)</label>' +
    '<div class="row"><input type="text" id="nameInput" maxlength="40" value="' + esc(state.myName()) + '">' +
    '<button class="btn sm" id="nameBtn">Save</button></div>' +
    '<label for="setPwInput" class="mt">Set or change your password</label>' +
    '<div class="row"><input type="password" id="setPwInput" autocomplete="new-password" placeholder="New password">' +
    '<button class="btn sm" id="setPwBtn">Set</button></div>' +
    '<div class="hint" id="setPwStatus"></div>' +
    '<button class="linkbtn" id="signOutBtn">Sign out</button></div>';

  if (!s) {
    html += '<div class="empty">Checking your seat&hellip;</div>';
  } else if (!s.is_member) {
    html += joinCard();
  } else {
    html += '<div class="card"><h3>' + esc(s.name) + '</h3>' +
      '<p class="hint" style="margin-top:0">' + (s.is_host ? 'You host this table.' : 'You have a seat at this table.') +
      ' ' + s.member_count + ' member' + (s.member_count === 1 ? '' : 's') + '.</p>';
    if (s.is_host) {
      html += '<div class="row invite"><span>Invite code</span><span class="code" id="codeText">' + esc(s.invite_code || '') + '</span></div>' +
        '<div class="row"><button class="btn primary grow" id="shareBtn">Share invite link</button>' +
        '<button class="btn" id="rotateBtn" title="New code">New code</button></div>' +
        '<p class="hint">Anyone with the code can join. Make a new code if it gets around.</p>' +
        '<label for="tableName" class="mt">Table name</label>' +
        '<div class="row"><input type="text" id="tableName" maxlength="60" value="' + esc(s.name) + '">' +
        '<button class="btn sm" id="tableNameBtn">Save</button></div>';
    } else {
      html += '<button class="btn subtle danger" id="leaveBtn">Leave the table</button>';
    }
    html += '</div>';

    html += '<div class="card"><h3>Members</h3><div id="memberList">' +
      state.S.members.map(m =>
        '<div class="member-row" data-uid="' + m.user_id + '">' +
        '<span class="avatar">' + esc(initials(m.display_name)) + '</span>' +
        '<div class="grow"><b>' + esc(m.display_name) + '</b>' + (m.role === 'host' ? ' <span class="pill gold">Host</span>' : '') +
        '<small>Joined ' + timeAgo(m.joined_at) + ' &middot; ' + m.points + ' pts</small></div>' +
        (s.is_host && m.role !== 'host' ? '<button class="btn sm danger" data-remove="' + m.user_id + '">Remove</button>' : '') +
        '</div>').join('') + '</div></div>';
  }
  html += '<div class="card"><h3>House rules</h3>' +
    '<p class="hint" style="margin:0">Positive mindset only. Hype each other up, challenge ideas with respect, and keep what is shared here at the table. ' +
    'Nothing posted is financial advice. Do your own research, and if you go in on something together, sort the details outside the app.</p></div>' +
    DISCLAIMER;
  return html;
}

function bindAccount() {
  const s = state.S.status;
  el.querySelector('#nameBtn').addEventListener('click', async () => {
    const name = el.querySelector('#nameInput').value.trim();
    if (!name) return;
    try {
      await cloud.saveDisplayName(name);
      toast('Name saved');
      await state.refresh();
    } catch (err) { toast('Could not save your name: ' + err.message); }
  });
  el.querySelector('#setPwBtn').addEventListener('click', async e => {
    const pw = el.querySelector('#setPwInput').value;
    const status = el.querySelector('#setPwStatus');
    if (pw.length < 6) { status.textContent = 'Use at least 6 characters.'; return; }
    e.target.disabled = true;
    const { error } = await cloud.setPassword(pw);
    e.target.disabled = false;
    if (error) status.textContent = 'Could not set the password: ' + error.message;
    else { el.querySelector('#setPwInput').value = ''; status.textContent = 'Password set. You can now sign in with it on any device.'; }
  });
  el.querySelector('#signOutBtn').addEventListener('click', () => cloud.signOut());

  if (!s) return;
  if (!s.is_member) { bindJoin(el); return; }

  if (s.is_host) {
    el.querySelector('#shareBtn').addEventListener('click', async () => {
      const url = inviteLink(s.invite_code);
      const text = 'You have a seat at ' + s.name + ' on Generational. Code: ' + s.invite_code;
      if (navigator.share) {
        try { await navigator.share({ title: 'Generational', text, url }); } catch {}
      } else {
        try { await navigator.clipboard.writeText(url + '\n' + text); toast('Invite link copied'); }
        catch { toast('Invite code: ' + s.invite_code); }
      }
    });
    el.querySelector('#rotateBtn').addEventListener('click', async e => {
      e.target.disabled = true;
      try {
        const code = await cloud.rotateInviteCode();
        el.querySelector('#codeText').textContent = code;
        toast('New invite code ready');
        state.refresh();
      } catch (err) { toast(err.message); e.target.disabled = false; }
    });
    el.querySelector('#tableNameBtn').addEventListener('click', async () => {
      const name = el.querySelector('#tableName').value.trim();
      if (!name) return;
      try { await cloud.renameTable(name); toast('Table renamed'); await state.refresh(); }
      catch (err) { toast(err.message); }
    });
    el.querySelectorAll('[data-remove]').forEach(b => b.addEventListener('click', async () => {
      const row = b.closest('.member-row');
      const name = row.querySelector('b').textContent;
      if (!confirm('Remove ' + name + ' from the table?')) return;
      try { await cloud.removeMember(b.dataset.remove); toast(name + ' removed'); await state.refresh(); }
      catch (err) { toast(err.message); }
    }));
  } else {
    el.querySelector('#leaveBtn').addEventListener('click', async () => {
      if (!confirm('Leave the table? You will need a new invite to come back.')) return;
      try { await cloud.leaveTable(); await state.refresh(); location.hash = '#/'; }
      catch (err) { toast(err.message); }
    });
  }
}

export async function render(root) {
  el = root;
  unsubs.push(state.onChange(() => {
    // Avoid wiping inputs mid-typing: only re-render on membership changes.
    const key = JSON.stringify([!!cloud.user(), state.S.status?.is_member, state.S.status?.is_host, state.S.status?.invite_code, state.S.members.length]);
    if (key !== el.dataset.key) render(root);
  }));
  el.dataset.key = JSON.stringify([!!cloud.user(), state.S.status?.is_member, state.S.status?.is_host, state.S.status?.invite_code, state.S.members.length]);
  if (!cloud.user()) {
    el.innerHTML = signInHtml();
    bindSignIn();
    return;
  }
  el.innerHTML = accountHtml();
  bindAccount();
  state.refresh({ throttle: true });
}

export function destroy() {
  unsubs.forEach(f => f());
  unsubs = [];
  el = null;
}
