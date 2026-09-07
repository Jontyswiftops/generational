// Talk: market channels (realtime chat) and the resource library.
import * as cloud from '../cloud.js';
import * as state from '../state.js';
import { esc, fmtTime, timeAgo, toast, linkify, safeUrl, CHANNELS, RESOURCE_TYPES } from '../util.js';
import { gate, handleKick, DISCLAIMER } from './shared.js';

export const title = 'Talk';

let unsubs = [];
let el = null;
let channel = 'economy';
let messages = [];
let resources = [];

// ---------- channel chat ----------

function msgHtml(m) {
  const mine = m.author_id === cloud.user()?.id;
  return '<div class="msg' + (mine ? ' me' : '') + '" data-mid="' + m.id + '">' +
    (mine ? '' : '<span class="who">' + esc(m.author) + '</span>') +
    '<div class="bubble">' + linkify(esc(m.body)) + '</div>' +
    '<small class="t">' + fmtTime(m.created_at) + (mine || state.isHost() ? ' &middot; <button class="linkbtn" style="display:inline;padding:0;font-size:.66rem" data-delmsg="' + m.id + '">delete</button>' : '') + '</small></div>';
}

function paintChat() {
  const box = el?.querySelector('#chat');
  if (!box) return;
  box.innerHTML = messages.length ? messages.map(msgHtml).join('') :
    '<div class="empty">Quiet in here. Start the conversation about ' + esc(CHANNELS[channel]) + '.</div>';
  box.querySelectorAll('[data-delmsg]').forEach(b => b.addEventListener('click', async () => {
    try { await cloud.deleteChannelMessage(b.dataset.delmsg); state.announce('talk', { channel }); await loadChat(); }
    catch (err) { toast(err.message); }
  }));
  window.scrollTo(0, document.body.scrollHeight);
}

async function loadChat() {
  try {
    messages = await cloud.channelFeed(channel);
    state.jset('talk:' + channel, messages);
  } catch (err) { if (!handleKick(err)) toast('Could not load the channel: ' + err.message); }
  paintChat();
}

function renderChannel() {
  messages = state.jget('talk:' + channel, []);
  el.innerHTML =
    '<div class="chips">' + Object.entries(CHANNELS).map(([k, v]) =>
      '<button data-ch="' + k + '"' + (channel === k ? ' class="on"' : '') + '>' + v + '</button>').join('') +
    '<button data-res="1">📚 Resources</button></div>' +
    '<div class="chat" id="chat"></div>' +
    '<div class="chatbar"><input type="text" id="chatInput" maxlength="2000" placeholder="Say something about ' + esc(CHANNELS[channel].toLowerCase()) + '" autocomplete="off">' +
    '<button class="btn primary" id="chatSend">Send</button></div>' + DISCLAIMER;
  el.querySelectorAll('[data-ch]').forEach(b => b.addEventListener('click', () => { location.hash = '#/talk/' + b.dataset.ch; }));
  el.querySelector('[data-res]').addEventListener('click', () => { location.hash = '#/resources'; });
  const send = async () => {
    const input = el.querySelector('#chatInput');
    const body = input.value.trim();
    if (!body) return;
    input.value = '';
    try {
      await cloud.sendChannelMessage(channel, body);
      state.announce('talk', { channel });
      await loadChat();
    } catch (err) { toast(err.message); input.value = body; }
  };
  el.querySelector('#chatSend').addEventListener('click', send);
  el.querySelector('#chatInput').addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
  paintChat();
  loadChat();
  unsubs.push(cloud.on('rt-table', 'talk', p => { if (!p.channel || p.channel === channel) loadChat(); }));
}

// ---------- resources ----------

function resHtml(r) {
  const mine = r.shared_by === cloud.user()?.id;
  return '<div class="item res">' +
    '<div class="pills"><span class="pill blue">' + esc(RESOURCE_TYPES[r.type] || r.type) + '</span></div>' +
    '<div class="title"><a href="' + esc(safeUrl(r.url)) + '" target="_blank" rel="noopener">' + esc(r.title) + '</a></div>' +
    (r.take ? '<div class="take">' + esc(r.take) + '</div>' : '') +
    '<a class="url" href="' + esc(safeUrl(r.url)) + '" target="_blank" rel="noopener">' + esc(r.url) + '</a>' +
    '<div class="meta mt"><span>Shared by ' + esc(r.sharer) + '</span><span>&middot;</span><span>' + timeAgo(r.created_at) + '</span>' +
    (mine || state.isHost() ? '<button class="linkbtn danger" style="margin-left:auto;padding:0" data-delres="' + r.id + '">Delete</button>' : '') + '</div></div>';
}

function paintResources() {
  const list = el?.querySelector('#resList');
  if (!list) return;
  list.innerHTML = resources.length ? resources.map(resHtml).join('') :
    '<div class="empty">Nothing in the library yet. Drop the book or podcast that changed how you think about money.</div>';
  list.querySelectorAll('[data-delres]').forEach(b => b.addEventListener('click', async () => {
    try { await cloud.deleteResource(b.dataset.delres); state.announce('resources'); await loadResources(); }
    catch (err) { toast(err.message); }
  }));
}

async function loadResources() {
  try {
    resources = await cloud.listResources();
    state.jset('resources', resources);
  } catch (err) { if (!handleKick(err)) toast('Could not load resources: ' + err.message); }
  paintResources();
}

function renderResources() {
  resources = state.jget('resources', []);
  el.innerHTML =
    '<div class="card"><h3>Share a resource</h3>' +
    '<label>Link<input type="url" id="rUrl" maxlength="500" placeholder="https://"></label>' +
    '<label>Title<input type="text" id="rTitle" maxlength="160" placeholder="Name of the book, episode, or article"></label>' +
    '<label>Type<select id="rType">' + Object.entries(RESOURCE_TYPES).map(([k, v]) => '<option value="' + k + '">' + v + '</option>').join('') + '</select></label>' +
    '<label>Your take (optional)<textarea id="rTake" maxlength="600" placeholder="One or two lines on why it is worth their time"></textarea></label>' +
    '<button class="btn primary big" id="rAdd" style="margin-bottom:0">Add to the library</button><div class="hint" id="rStatus"></div></div>' +
    '<div id="resList"></div>' + DISCLAIMER;
  el.querySelector('#rAdd').addEventListener('click', async e => {
    const f = {
      url: safeUrl(el.querySelector('#rUrl').value),
      title: el.querySelector('#rTitle').value.trim(),
      type: el.querySelector('#rType').value,
      take: el.querySelector('#rTake').value.trim() || null
    };
    const status = el.querySelector('#rStatus');
    if (!f.url || !f.title) { status.textContent = 'A link and a title are needed.'; return; }
    e.target.disabled = true;
    try {
      await cloud.addResource(f);
      state.announce('resources');
      toast('Added to the library');
      ['#rUrl', '#rTitle', '#rTake'].forEach(s => { el.querySelector(s).value = ''; });
      status.textContent = '';
      await loadResources();
    } catch (err) { status.textContent = err.message; }
    e.target.disabled = false;
  });
  paintResources();
  loadResources();
  unsubs.push(cloud.on('rt-table', 'resources', loadResources));
}

// ---------- entry ----------

export async function render(root, slug) {
  el = root;
  unsubs.push(state.onChange(() => { if (!state.isMember() || !el.dataset.ready) render(root, slug); }));
  if (!gate(el)) return;
  el.dataset.ready = '1';
  if (/^#\/resources$/.test(location.hash)) { renderResources(); return; }
  if (slug && CHANNELS[slug]) channel = slug;
  renderChannel();
}

export function destroy() {
  unsubs.forEach(f => f());
  unsubs = [];
  if (el) delete el.dataset.ready;
  el = null;
}
