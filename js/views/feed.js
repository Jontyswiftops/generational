// Wins: the hype feed, reactions, comments, and the table form strip.
import * as cloud from '../cloud.js';
import * as state from '../state.js';
import { esc, initials, timeAgo, toast, linkify, EMOJI } from '../util.js';
import { gate, handleKick, DISCLAIMER } from './shared.js';

export const title = 'Wins';

let unsubs = [];
let el = null;
let posts = [];
let kind = 'win';
let openComments = new Set();

const KINDS = { win: { label: 'Win', icon: '🏆' }, milestone: { label: 'Milestone', icon: '🎯' }, goal: { label: 'Goal', icon: '🧭' } };

function formStrip() {
  const seats = state.seats().slice().sort((a, b) => b.points - a.points).slice(0, 3);
  if (!seats.length) return '';
  return '<div class="card tight"><h3 style="margin-bottom:8px">Table form</h3><div class="row wrap">' +
    seats.map((s, i) => '<div class="row" style="gap:6px"><span class="avatar sm' + (s.online ? ' on' : '') + '">' + esc(initials(s.name)) + '</span>' +
      '<div><b style="font-size:.85rem">' + esc(s.name) + '</b><div class="hint" style="margin:0">' + s.points + ' pts' + (s.streak ? ' &middot; ' + s.streak + ' streak' : '') + '</div></div></div>').join('') +
    '</div></div>';
}

function postHtml(p) {
  const uid = cloud.user()?.id;
  const k = KINDS[p.kind] || KINDS.win;
  const mine = p.author_id === uid;
  const showC = openComments.has(p.id);
  return '<div class="post" data-pid="' + p.id + '">' +
    '<div class="head"><span class="avatar">' + esc(initials(p.author)) + '</span>' +
    '<div class="who"><b>' + esc(p.author) + '</b><small>' + k.icon + ' ' + k.label + ' &middot; ' + timeAgo(p.created_at) + '</small></div>' +
    (mine || state.isHost() ? '<button class="btn sm subtle" style="width:auto" data-delpost="' + p.id + '">Delete</button>' : '') + '</div>' +
    '<div class="body">' + linkify(esc(p.body)) + '</div>' +
    '<div class="reacts">' + Object.entries(EMOJI).map(([key, ch]) => {
      const n = p.reactions?.[key] || 0;
      const on = (p.my_reactions || []).includes(key);
      return '<button data-react="' + key + '"' + (on ? ' class="on"' : '') + '>' + ch + (n ? '<small>' + n + '</small>' : '') + '</button>';
    }).join('') +
    '<button class="more" data-toggle="' + p.id + '">💬 ' + (p.comments.length || '') + '</button></div>' +
    (showC ? '<div class="comments">' + p.comments.map(c =>
      '<div class="comment"><div class="head"><b>' + esc(c.author) + '</b><small>' + timeAgo(c.created_at) + '</small></div><p>' + linkify(esc(c.body)) + '</p>' +
      (c.author_id === uid || state.isHost() ? '<div class="actions"><button data-delc="' + c.id + '">Delete</button></div>' : '') + '</div>').join('') +
      '<div class="composer"><input type="text" maxlength="2000" placeholder="Hype them up" data-cinput="' + p.id + '"><button class="btn sm primary" data-csend="' + p.id + '">Send</button></div></div>' : '') +
    '</div>';
}

function paintStrip() {
  const strip = el?.querySelector('#formStrip');
  if (strip) strip.innerHTML = formStrip();
}

function paint() {
  if (!el) return;
  paintStrip();
  const list = el.querySelector('#postList');
  if (!list) return;
  list.innerHTML = posts.length ? posts.map(postHtml).join('') :
    '<div class="empty">No wins posted yet. Small wins count. Post the first one.</div>';

  list.querySelectorAll('[data-react]').forEach(b => b.addEventListener('click', async () => {
    const pid = b.closest('.post').dataset.pid;
    const p = posts.find(x => x.id === pid);
    const key = b.dataset.react;
    const on = !(p.my_reactions || []).includes(key);
    try {
      await cloud.toggleReaction(pid, key, on);
      state.announce('feed');
      await load();
    } catch (err) { toast(err.message); }
  }));
  list.querySelectorAll('[data-toggle]').forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.toggle;
    if (openComments.has(id)) openComments.delete(id); else openComments.add(id);
    paint();
    if (openComments.has(id)) list.querySelector('[data-cinput="' + id + '"]')?.focus();
  }));
  list.querySelectorAll('[data-csend]').forEach(b => b.addEventListener('click', async () => {
    const id = b.dataset.csend;
    const input = list.querySelector('[data-cinput="' + id + '"]');
    const body = input.value.trim();
    if (!body) return;
    b.disabled = true;
    try { await cloud.addComment('post', id, body); state.announce('feed'); await load(); }
    catch (err) { toast(err.message); b.disabled = false; }
  }));
  list.querySelectorAll('[data-cinput]').forEach(i => i.addEventListener('keydown', e => {
    if (e.key === 'Enter') list.querySelector('[data-csend="' + i.dataset.cinput + '"]')?.click();
  }));
  list.querySelectorAll('[data-delc]').forEach(b => b.addEventListener('click', async () => {
    try { await cloud.deleteComment(b.dataset.delc); state.announce('feed'); await load(); }
    catch (err) { toast(err.message); }
  }));
  list.querySelectorAll('[data-delpost]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Delete this post?')) return;
    try { await cloud.deletePost(b.dataset.delpost); state.announce('feed'); await load(); }
    catch (err) { toast(err.message); }
  }));
}

async function load() {
  try {
    posts = await cloud.feed(60);
    state.jset('feed', posts);
  } catch (err) { if (!handleKick(err)) toast('Could not load the feed: ' + err.message); }
  paint();
}

export async function render(root) {
  el = root;
  unsubs.forEach(fn => fn());
  unsubs = [];
  const gateKey = () => JSON.stringify([!!cloud.user(), !!state.S.status, state.isMember(), state.S.status?.host_claimed]);
  const startKey = gateKey();
  unsubs.push(state.onChange(() => { if (gateKey() !== startKey) render(root); else if (state.isMember()) paintStrip(); }));
  if (!gate(el)) return;
  el.dataset.ready = '1';
  posts = state.jget('feed', []);
  el.innerHTML =
    '<div class="card"><div class="kind-row">' + Object.entries(KINDS).map(([k, v]) =>
      '<button class="btn' + (kind === k ? ' on' : '') + '" data-kind="' + k + '">' + v.icon + ' ' + v.label + '</button>').join('') + '</div>' +
    '<textarea id="postBody" maxlength="2000" placeholder="What happened? Closed a deal, hit a savings target, launched something, took a step."></textarea>' +
    '<button class="btn primary big mt" id="postBtn" style="margin-bottom:0">Post it</button></div>' +
    '<div id="formStrip"></div>' +
    '<div class="card"><div id="postList"></div></div>' + DISCLAIMER;
  el.querySelectorAll('[data-kind]').forEach(b => b.addEventListener('click', () => {
    kind = b.dataset.kind;
    el.querySelectorAll('[data-kind]').forEach(x => x.classList.toggle('on', x === b));
  }));
  el.querySelector('#postBtn').addEventListener('click', async e => {
    const ta = el.querySelector('#postBody');
    const body = ta.value.trim();
    if (!body) return;
    e.target.disabled = true;
    try {
      await cloud.createPost(kind, body);
      ta.value = '';
      state.announce('feed');
      toast('Posted');
      await load();
      state.refresh();
    } catch (err) { toast(err.message); }
    e.target.disabled = false;
  });
  paint();
  load();
  unsubs.push(cloud.on('rt-table', 'feed', load));
  state.refresh({ throttle: true });
}

export function destroy() {
  unsubs.forEach(f => f());
  unsubs = [];
  if (el) delete el.dataset.ready;
  el = null;
}
