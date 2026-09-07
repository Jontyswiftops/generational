// App bootstrap: hash router, auth lifecycle, invite links, service worker.
import * as cloud from './cloud.js';
import * as state from './state.js';
import { toast, initials } from './util.js';
import * as home from './views/home.js';
import * as ideas from './views/ideas.js';
import * as sessions from './views/sessions.js';
import * as feed from './views/feed.js';
import * as talk from './views/talk.js';
import * as me from './views/me.js';
import * as member from './views/member.js';
import * as tables from './views/tables.js';

const PENDING_JOIN = 'gen:pendingJoin';

const routes = [
  { re: /^#\/?$/, view: home, tab: 'home' },
  { re: /^#\/ideas$/, view: ideas, tab: 'ideas' },
  { re: /^#\/ideas\/new$/, view: ideas, tab: 'ideas', back: true },
  { re: /^#\/ideas\/([0-9a-f-]{36})$/, view: ideas, tab: 'ideas', back: true },
  { re: /^#\/sessions$/, view: sessions, tab: 'sessions' },
  { re: /^#\/sessions\/new$/, view: sessions, tab: 'sessions', back: true },
  { re: /^#\/sessions\/([0-9a-f-]{36})$/, view: sessions, tab: 'sessions', back: true },
  { re: /^#\/sessions\/([0-9a-f-]{36})\/(live|edit)$/, view: sessions, tab: 'sessions', back: true },
  { re: /^#\/feed$/, view: feed, tab: 'feed' },
  { re: /^#\/talk$/, view: talk, tab: 'talk' },
  { re: /^#\/talk\/([a-z_]+)$/, view: talk, tab: 'talk' },
  { re: /^#\/resources$/, view: talk, tab: 'talk', back: true },
  { re: /^#\/dm$/, view: talk, tab: 'talk', back: true },
  { re: /^#\/dm\/([0-9a-f-]{36})$/, view: talk, tab: 'talk', back: true },
  { re: /^#\/member\/([0-9a-f-]{36})$/, view: member, tab: 'home', back: true },
  { re: /^#\/tables$/, view: tables, tab: null, back: true },
  { re: /^#\/me$/, view: me, tab: null, back: true }
];

const viewEl = document.getElementById('view');
const titleEl = document.getElementById('pageTitle');
const backBtn = document.getElementById('backBtn');
const meBtn = document.getElementById('meBtn');
const meInitials = document.getElementById('meInitials');
let currentView = null;
let lastUid = null;

// ---- invite links (#join=CODE) ----

function captureJoinHash() {
  const m = (location.hash || '').match(/join=([A-Za-z0-9]{4,12})/i);
  if (!m) return false;
  localStorage.setItem(PENDING_JOIN, m[1].toUpperCase());
  try { window.history.replaceState(null, '', location.pathname + location.search + '#/'); } catch {}
  return true;
}

async function processPendingJoin() {
  const code = localStorage.getItem(PENDING_JOIN);
  if (!code) return;
  if (!cloud.user()) {
    if (location.hash !== '#/me') location.hash = '#/me';
    toast('Sign in to take your seat at the table');
    return;
  }
  localStorage.removeItem(PENDING_JOIN);
  try {
    const t = await cloud.joinTable(code);
    await state.refresh();
    await state.switchTable(t.id);
    toast('Welcome to ' + t.name);
    location.hash = '#/';
  } catch (err) {
    toast(err.message || 'That invite code did not work');
  }
}

// ---- router ----

async function route() {
  const hash = location.hash || '#/';
  if (captureJoinHash()) { processPendingJoin(); return; }
  // Magic-link landing: supabase-js consumes these tokens; not a route.
  if (/access_token=|error_description=/.test(hash)) return;
  const r = routes.find(x => x.re.test(hash)) || routes[0];
  const params = (hash.match(r.re) || []).slice(1);
  try { currentView?.destroy?.(); } catch {}
  currentView = r.view;
  titleEl.textContent = state.tableName();
  backBtn.hidden = !r.back;
  document.querySelectorAll('#tabbar a').forEach(a =>
    a.classList.toggle('on', a.dataset.tab === r.tab));
  viewEl.innerHTML = '';
  window.scrollTo(0, 0);
  state.setView(hash);
  try {
    await r.view.render(viewEl, ...params);
  } catch (err) {
    console.error(err);
    viewEl.innerHTML = '<div class="card"><p>Something went wrong: ' + (err.message || err) +
      '</p><a class="btn mt" href="#/">Back to the table</a></div>';
  }
}

titleEl.addEventListener('click', () => { if (cloud.user()) location.hash = '#/tables'; });
backBtn.addEventListener('click', () => {
  if (window.history.length > 1) window.history.back();
  else location.hash = '#/';
});
window.addEventListener('hashchange', route);

// ---- header ----

const talkBadge = document.getElementById('talkBadge');

function paintHeader() {
  titleEl.textContent = state.tableName();
  titleEl.classList.toggle('switchable', state.S.tables.length > 1 || state.isOwner());
  if (talkBadge) {
    talkBadge.hidden = !(state.S.unread > 0);
    talkBadge.textContent = state.S.unread > 9 ? '9+' : String(state.S.unread || '');
  }
  const u = cloud.user();
  if (u) {
    meInitials.textContent = initials(state.myName() || u.email);
    meBtn.classList.remove('off');
  } else {
    meInitials.textContent = '?';
    meBtn.classList.add('off');
  }
}
state.onChange(paintHeader);

// ---- auth lifecycle ----

function onSignedIn(uid) {
  if (uid === lastUid) return;
  lastUid = uid;
  state.loadCache();
  paintHeader();
  state.refresh().then(() => {
    processPendingJoin();
    route();
  });
}

function resync() {
  if (!cloud.user()) return;
  state.refresh({ throttle: true });
}

function onSignedOut() {
  lastUid = null;
  cloud.teardownChannels();
  state.reset();
  paintHeader();
  route();
}

// ---- boot ----

async function boot() {
  await cloud.ready;
  cloud.onAuth(event => {
    if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'USER_UPDATED') {
      const u = cloud.user();
      if (u) onSignedIn(u.id);
    } else if (event === 'TOKEN_REFRESHED') {
      resync();
    } else if (event === 'SIGNED_OUT') {
      onSignedOut();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) resync();
  });

  const u = cloud.user();
  if (u) onSignedIn(u.id);
  paintHeader();
  route();
  if (!u && localStorage.getItem(PENDING_JOIN)) processPendingJoin();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').then(reg => {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
    }).catch(() => {});

    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloaded) return;
      reloaded = true;
      if (/\/live$/.test(location.hash)) {
        toast('Update ready. It applies next time you open the app', 5000);
      } else {
        location.reload();
      }
    });
  }
}

boot();
