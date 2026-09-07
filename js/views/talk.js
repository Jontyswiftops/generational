// Talk: the table chat and market channels (realtime), direct messages,
// and the resource library.
import * as cloud from '../cloud.js';
import * as state from '../state.js';
import { esc, initials, fmtTime, timeAgo, toast, linkify, safeUrl, CHANNELS, RESOURCE_TYPES } from '../util.js';
import { gate, handleKick, DISCLAIMER } from './shared.js';

export const title = 'Talk';

let unsubs = [];
let el = null;
let channel = 'table';
let messages = [];
let resources = [];
let threads = [];
let dmMsgs = [];
let dmOther = null;

const chipsHtml = (active) =>
  '<div class="chips">' +
  '<button data-go="#/dm"' + (active === 'dm' ? ' class="on"' : '') + '>✉️ Messages' + (state.S.unread ? ' (' + state.S.unread + ')' : '') + '</button>' +
  Object.entries(CHANNELS).map(([k, v]) =>
    '<button data-go="#/talk/' + k + '"' + (active === k ? ' class="on"' : '') + '>' + v + '</button>').join('') +
  '<button data-go="#/resources"' + (active === 'res' ? ' class="on"' : '') + '>📚 Resources</button></div>';

function bindChips() {
  el.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => { location.hash = b.dataset.go; }));
}

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
    '<div class="empty">' + (channel === 'table' ? 'Quiet in here. This is the everyday chat for the whole table.' : 'Quiet in here. Start the conversation about ' + esc(CHANNELS[channel]) + '.') + '</div>';
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
  el.innerHTML = chipsHtml(channel) +
    '<div class="chat" id="chat"></div>' +
    '<div class="chatbar"><input type="text" id="chatInput" maxlength="2000" placeholder="' + (channel === 'table' ? 'Say something to the table' : 'Say something about ' + esc(CHANNELS[channel].toLowerCase())) + '" autocomplete="off">' +
    '<button class="btn primary" id="chatSend">Send</button></div>' + DISCLAIMER;
  bindChips();
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

// ---------- direct messages ----------

function threadHtml(t) {
  return '<a class="thread" href="#/dm/' + t.user_id + '">' +
    '<span class="avatar' + (state.onlineIds().has(t.user_id) ? ' on' : '') + '">' + esc(initials(t.display_name)) + '</span>' +
    '<div class="grow"><b>' + esc(t.display_name) + '</b>' +
    '<div class="last">' + (t.last_body ? (t.last_mine ? 'You: ' : '') + esc(t.last_body) : 'Start a conversation') + '</div></div>' +
    (t.unread ? '<span class="unread">' + t.unread + '</span>' : (t.last_at ? '<small>' + timeAgo(t.last_at) + '</small>' : '')) + '</a>';
}

function paintThreads() {
  const box = el?.querySelector('#threads');
  if (!box) return;
  box.innerHTML = threads.length ? threads.map(threadHtml).join('') :
    '<div class="empty">Just you at the table so far. Once mates join, you can message them here.</div>';
}

async function loadThreads() {
  try {
    threads = await cloud.dmThreads();
    state.jset('dm:threads', threads);
  } catch (err) { if (!handleKick(err)) toast('Could not load messages: ' + err.message); }
  paintThreads();
}

function renderThreads() {
  threads = state.jget('dm:threads', []);
  el.innerHTML = chipsHtml('dm') + '<h3>Direct messages</h3><div id="threads"></div>' +
    '<p class="hint">Private between the two of you. Keep it at the table.</p>' + DISCLAIMER;
  bindChips();
  paintThreads();
  loadThreads();
  unsubs.push(cloud.on('rt-table', 'dm', loadThreads));
  unsubs.push(state.onChange(paintThreads));
}

function dmHtml(m) {
  const mine = m.sender_id === cloud.user()?.id;
  return '<div class="msg' + (mine ? ' me' : '') + '">' +
    '<div class="bubble">' + linkify(esc(m.body)) + '</div>' +
    '<small class="t">' + fmtTime(m.created_at) + (mine ? (m.read_at ? ' &middot; seen' : '') + ' &middot; <button class="linkbtn" style="display:inline;padding:0;font-size:.66rem" data-deldm="' + m.id + '">delete</button>' : '') + '</small></div>';
}

function paintDm() {
  const box = el?.querySelector('#dmList');
  if (!box) return;
  const other = state.member(dmOther);
  box.innerHTML = dmMsgs.length ? dmMsgs.map(dmHtml).join('') :
    '<div class="empty">No messages yet with ' + esc(other?.display_name || 'them') + '. Say g\'day.</div>';
  box.querySelectorAll('[data-deldm]').forEach(b => b.addEventListener('click', async () => {
    try { await cloud.dmDelete(b.dataset.deldm); cloud.ping('rt-table', 'dm', { to: dmOther }); await loadDm(); }
    catch (err) { toast(err.message); }
  }));
  window.scrollTo(0, document.body.scrollHeight);
}

async function loadDm() {
  try {
    dmMsgs = await cloud.dmThread(dmOther);
    state.jset('dm:' + dmOther, dmMsgs);
    if (dmMsgs.some(m => m.sender_id === dmOther && !m.read_at)) {
      await cloud.dmMarkRead(dmOther);
      cloud.ping('rt-table', 'dm', { to: dmOther });
      state.refreshUnread();
    }
  } catch (err) { if (!handleKick(err)) toast('Could not load the conversation: ' + err.message); }
  paintDm();
}

function renderDm(uid) {
  dmOther = uid;
  dmMsgs = state.jget('dm:' + uid, []);
  const other = state.member(uid);
  el.innerHTML =
    '<a class="thread" href="#/member/' + uid + '" style="margin-bottom:12px">' +
    '<span class="avatar' + (state.onlineIds().has(uid) ? ' on' : '') + '">' + esc(initials(other?.display_name || '?')) + '</span>' +
    '<div class="grow"><b>' + esc(other?.display_name || 'Member') + '</b><div class="last">View profile</div></div></a>' +
    '<div class="chat" id="dmList"></div>' +
    '<div class="chatbar"><input type="text" id="dmInput" maxlength="2000" placeholder="Message ' + esc((other?.display_name || '').split(' ')[0]) + '" autocomplete="off">' +
    '<button class="btn primary" id="dmSend">Send</button></div>' + DISCLAIMER;
  const send = async () => {
    const input = el.querySelector('#dmInput');
    const body = input.value.trim();
    if (!body) return;
    input.value = '';
    try {
      await cloud.dmSend(uid, body);
      cloud.ping('rt-table', 'dm', { to: uid });
      await loadDm();
    } catch (err) { toast(err.message); input.value = body; }
  };
  el.querySelector('#dmSend').addEventListener('click', send);
  el.querySelector('#dmInput').addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
  paintDm();
  loadDm();
  unsubs.push(cloud.on('rt-table', 'dm', p => { if (!p.to || p.to === cloud.user()?.id) loadDm(); }));
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
  el.innerHTML = chipsHtml('res') +
    '<div class="card"><h3>Share a resource</h3>' +
    '<label>Link<input type="url" id="rUrl" maxlength="500" placeholder="https://"></label>' +
    '<label>Title<input type="text" id="rTitle" maxlength="160" placeholder="Name of the book, episode, or article"></label>' +
    '<label>Type<select id="rType">' + Object.entries(RESOURCE_TYPES).map(([k, v]) => '<option value="' + k + '">' + v + '</option>').join('') + '</select></label>' +
    '<label>Your take (optional)<textarea id="rTake" maxlength="600" placeholder="One or two lines on why it is worth their time"></textarea></label>' +
    '<button class="btn primary big" id="rAdd" style="margin-bottom:0">Add to the library</button><div class="hint" id="rStatus"></div></div>' +
    '<div id="resList"></div>' + DISCLAIMER;
  bindChips();
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

export async function render(root, param) {
  el = root;
  unsubs.forEach(fn => fn());
  unsubs = [];
  const gateKey = () => JSON.stringify([!!cloud.user(), !!state.S.status, state.isMember(), state.S.status?.host_claimed]);
  const startKey = gateKey();
  unsubs.push(state.onChange(() => { if (gateKey() !== startKey) render(root, param); }));
  if (!gate(el)) return;
  el.dataset.ready = '1';
  const hash = location.hash;
  if (/^#\/resources$/.test(hash)) { renderResources(); return; }
  if (/^#\/dm$/.test(hash)) { renderThreads(); return; }
  if (/^#\/dm\//.test(hash) && param) { renderDm(param); return; }
  if (param && CHANNELS[param]) channel = param;
  renderChannel();
}

export function destroy() {
  unsubs.forEach(f => f());
  unsubs = [];
  if (el) delete el.dataset.ready;
  el = null;
  dmOther = null;
}
