// Ideas: the board, pitching a new idea, and the detail with stances and
// discussion.
import * as cloud from '../cloud.js';
import * as state from '../state.js';
import { esc, initials, timeAgo, toast, linkify, safeUrl, CATEGORIES, IDEA_STATUS } from '../util.js';
import { gate, handleKick, DISCLAIMER , gateKey } from './shared.js';

export const title = 'Ideas';

let unsubs = [];
let el = null;
let ideas = [];
let filterCat = 'all';
let filterStatus = 'open';
let detail = null;
let replyTo = null;

const STANCES = {
  in: { label: "I'm in", cls: 'green', icon: '🤝' },
  keen: { label: 'Keen to hear more', cls: '', icon: '👀' },
  challenge: { label: 'Challenge it', cls: 'red', icon: '🥊' }
};

// ---------- list ----------

function ideaItem(i) {
  const st = IDEA_STATUS[i.status] || IDEA_STATUS.open;
  return '<a class="item" href="#/ideas/' + i.id + '">' +
    '<div class="pills"><span class="pill blue">' + esc(CATEGORIES[i.category] || i.category) + '</span>' +
    '<span class="pill ' + st.cls + '">' + st.label + '</span></div>' +
    '<div class="title">' + esc(i.title) + '</div>' +
    '<div class="excerpt">' + esc(i.pitch) + '</div>' +
    '<div class="meta"><span>' + esc(i.author) + '</span><span>&middot;</span><span>' + timeAgo(i.created_at) + '</span></div>' +
    '<div class="counts"><span class="in"><b>' + i.in_count + '</b> in</span><span class="keen"><b>' + i.keen_count + '</b> keen</span>' +
    '<span class="challenge"><b>' + i.challenge_count + '</b> challenge</span><span><b>' + i.comment_count + '</b> comments</span>' +
    (i.my_stance ? '<span class="pill gold">You: ' + esc(STANCES[i.my_stance].label) + '</span>' : '') + '</div></a>';
}

function paintList() {
  const list = el?.querySelector('#ideaList');
  if (!list) return;
  const shown = ideas.filter(i => (filterCat === 'all' || i.category === filterCat) && (filterStatus === 'all' || i.status === filterStatus));
  list.innerHTML = shown.length ? shown.map(ideaItem).join('') :
    '<div class="empty">' + (ideas.length ? 'Nothing matches those filters.' : 'No ideas pitched yet. Be the first to put one on the table.') + '</div>';
}

async function loadList() {
  try {
    ideas = await cloud.listIdeas(state.tid(), null);
    state.jset('ideas:' + state.tid(), ideas);
  } catch (err) { if (!handleKick(err)) toast('Could not load ideas: ' + err.message); }
  paintList();
}

function renderList() {
  ideas = state.jget('ideas:' + state.tid(), []);
  el.innerHTML =
    '<a class="btn primary big" href="#/ideas/new">Pitch an idea</a>' +
    '<div class="section-tabs">' + ['open', 'in_motion', 'parked', 'all'].map(s =>
      '<button data-status="' + s + '"' + (filterStatus === s ? ' class="on"' : '') + '>' + (s === 'all' ? 'All' : IDEA_STATUS[s].label) + '</button>').join('') + '</div>' +
    '<div class="chips"><button data-cat="all"' + (filterCat === 'all' ? ' class="on"' : '') + '>Everything</button>' +
    Object.entries(CATEGORIES).map(([k, v]) => '<button data-cat="' + k + '"' + (filterCat === k ? ' class="on"' : '') + '>' + v + '</button>').join('') + '</div>' +
    '<div id="ideaList"></div>' + DISCLAIMER;
  el.querySelectorAll('[data-status]').forEach(b => b.addEventListener('click', () => {
    filterStatus = b.dataset.status;
    el.querySelectorAll('[data-status]').forEach(x => x.classList.toggle('on', x === b));
    paintList();
  }));
  el.querySelectorAll('[data-cat]').forEach(b => b.addEventListener('click', () => {
    filterCat = b.dataset.cat;
    el.querySelectorAll('[data-cat]').forEach(x => x.classList.toggle('on', x === b));
    paintList();
  }));
  paintList();
  loadList();
  unsubs.push(cloud.on(state.tableChannel(), 'ideas', loadList));
}

// ---------- new ----------

function renderNew() {
  el.innerHTML = '<div class="card"><h3>Pitch an idea</h3>' +
    '<label>Title<input type="text" id="fTitle" maxlength="120" placeholder="Short and punchy"></label>' +
    '<label>Category<select id="fCat">' + Object.entries(CATEGORIES).map(([k, v]) => '<option value="' + k + '">' + v + '</option>').join('') + '</select></label>' +
    '<label>The pitch<textarea id="fPitch" maxlength="4000" placeholder="What is it, why now, what would it take, what could it return?" style="min-height:140px"></textarea></label>' +
    '<label>Link (optional)<input type="url" id="fLink" maxlength="500" placeholder="https://"></label>' +
    '<label>The ask (optional)<input type="text" id="fAsk" maxlength="300" placeholder="e.g. Looking for two partners, or just want feedback"></label>' +
    '<button class="btn primary big" id="fSubmit">Put it on the table</button>' +
    '<div class="hint" id="fStatus"></div></div>';
  el.querySelector('#fSubmit').addEventListener('click', async e => {
    const f = {
      title: el.querySelector('#fTitle').value.trim(),
      category: el.querySelector('#fCat').value,
      pitch: el.querySelector('#fPitch').value.trim(),
      link: safeUrl(el.querySelector('#fLink').value) || null,
      ask: el.querySelector('#fAsk').value.trim() || null
    };
    const status = el.querySelector('#fStatus');
    if (!f.title || !f.pitch) { status.textContent = 'A title and a pitch are the minimum.'; return; }
    e.target.disabled = true;
    try {
      const row = await cloud.createIdea({ ...f, table_id: state.tid() });
      state.announce('ideas', { id: row.id });
      state.announce('feed');
      toast('Idea is on the table');
      location.hash = '#/ideas/' + row.id;
    } catch (err) {
      status.textContent = 'Could not save: ' + err.message;
      e.target.disabled = false;
    }
  });
}

// ---------- detail ----------

function commentHtml(c, canDelete) {
  return '<div class="comment' + (c.parent_id ? ' reply' : '') + '" data-cid="' + c.id + '">' +
    '<div class="head"><b>' + esc(c.author) + '</b><small>' + timeAgo(c.created_at) + '</small></div>' +
    '<p>' + linkify(esc(c.body)) + '</p>' +
    '<div class="actions">' + (c.parent_id ? '' : '<button data-reply="' + c.id + '" data-name="' + esc(c.author) + '">Reply</button>') +
    (canDelete ? '<button data-del="' + c.id + '">Delete</button>' : '') + '</div></div>';
}

function threaded(comments) {
  const tops = comments.filter(c => !c.parent_id);
  const byParent = {};
  comments.filter(c => c.parent_id).forEach(c => { (byParent[c.parent_id] ||= []).push(c); });
  const out = [];
  tops.forEach(t => { out.push(t); (byParent[t.id] || []).forEach(r => out.push(r)); });
  return out;
}

function paintDetail() {
  const d = detail;
  if (!d || !el) return;
  const uid = cloud.user()?.id;
  const mine = d.author_id === uid;
  const canEdit = mine || state.isHost();
  const st = IDEA_STATUS[d.status] || IDEA_STATUS.open;
  const counts = { in: 0, keen: 0, challenge: 0 };
  d.stances.forEach(s => { counts[s.stance] = (counts[s.stance] || 0) + 1; });

  el.innerHTML =
    '<div class="card">' +
    '<div class="pills"><span class="pill blue">' + esc(CATEGORIES[d.category] || d.category) + '</span><span class="pill ' + st.cls + '">' + st.label + '</span></div>' +
    '<h2 class="mt">' + esc(d.title) + '</h2>' +
    '<div class="hint" style="margin:0">' + esc(d.author) + ' &middot; ' + timeAgo(d.created_at) + '</div>' +
    '<div class="pitch">' + linkify(esc(d.pitch)) + '</div>' +
    (d.link ? '<a class="btn sm" href="' + esc(safeUrl(d.link)) + '" target="_blank" rel="noopener">Open link</a>' : '') +
    (d.ask ? '<div class="ask"><b>The ask:</b> ' + esc(d.ask) + '</div>' : '') +
    '<div class="stances">' + Object.entries(STANCES).map(([k, s]) =>
      '<button class="btn ' + s.cls + (d.my_stance === k ? ' on' : '') + '" data-stance="' + k + '"><b>' + counts[k] + '</b>' + s.icon + ' ' + s.label + '</button>').join('') + '</div>' +
    (d.stances.length ? '<div class="backers">' + d.stances.map(s =>
      '<span class="backer ' + s.stance + '">' + esc(s.display_name) + ' &middot; ' + esc(STANCES[s.stance].label) + '</span>').join('') + '</div>' : '') +
    (canEdit ? '<div class="row mt"><select id="statusSel" class="grow">' + Object.entries(IDEA_STATUS).map(([k, v]) =>
      '<option value="' + k + '"' + (d.status === k ? ' selected' : '') + '>' + v.label + '</option>').join('') + '</select>' +
      '<button class="btn sm danger" id="delIdea">Delete</button></div>' : '') +
    '</div>' +
    '<div class="card"><h3>Discussion <small>(' + d.comments.length + ')</small></h3>' +
    '<div class="comments" id="commentList">' + (d.comments.length ? threaded(d.comments).map(c => commentHtml(c, c.author_id === uid || state.isHost())).join('') :
      '<div class="hint">No comments yet. Ask a question, add a number, or hype it up.</div>') + '</div>' +
    '<div id="replyHint" class="hint" hidden></div>' +
    '<div class="composer"><textarea id="commentBody" maxlength="2000" placeholder="Add to the discussion"></textarea><button class="btn primary" id="commentBtn">Post</button></div>' +
    '</div>' + DISCLAIMER;

  el.querySelectorAll('[data-stance]').forEach(b => b.addEventListener('click', async () => {
    const k = b.dataset.stance;
    const next = d.my_stance === k ? null : k;
    try {
      await cloud.setStance(d.id, next);
      state.announce('ideas', { id: d.id });
      await loadDetail(d.id);
    } catch (err) { toast(err.message); }
  }));
  el.querySelector('#statusSel')?.addEventListener('change', async e => {
    try { await cloud.updateIdea(d.id, { status: e.target.value }); state.announce('ideas', { id: d.id }); await loadDetail(d.id); toast('Status updated'); }
    catch (err) { toast(err.message); }
  });
  el.querySelector('#delIdea')?.addEventListener('click', async () => {
    if (!confirm('Delete this idea and its discussion?')) return;
    try { await cloud.deleteIdea(d.id); state.announce('ideas'); toast('Idea deleted'); location.hash = '#/ideas'; }
    catch (err) { toast(err.message); }
  });
  el.querySelectorAll('[data-reply]').forEach(b => b.addEventListener('click', () => {
    replyTo = b.dataset.reply;
    const h = el.querySelector('#replyHint');
    h.hidden = false;
    h.innerHTML = 'Replying to ' + esc(b.dataset.name) + ' <button class="linkbtn" id="cancelReply" style="display:inline;padding:0 6px">cancel</button>';
    h.querySelector('#cancelReply').addEventListener('click', () => { replyTo = null; h.hidden = true; });
    el.querySelector('#commentBody').focus();
  }));
  el.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
    try { await cloud.deleteComment(b.dataset.del); state.announce('ideas', { id: d.id }); await loadDetail(d.id); }
    catch (err) { toast(err.message); }
  }));
  el.querySelector('#commentBtn').addEventListener('click', async e => {
    const ta = el.querySelector('#commentBody');
    const body = ta.value.trim();
    if (!body) return;
    e.target.disabled = true;
    try {
      await cloud.addComment('idea', d.id, body, replyTo);
      replyTo = null;
      state.announce('ideas', { id: d.id });
      await loadDetail(d.id);
    } catch (err) { toast(err.message); e.target.disabled = false; }
  });
}

async function loadDetail(id) {
  try {
    detail = await cloud.ideaDetail(id);
    paintDetail();
  } catch (err) {
    if (handleKick(err)) return;
    el.innerHTML = '<div class="card"><p>' + esc(err.message) + '</p><a class="btn mt" href="#/ideas">Back to ideas</a></div>';
  }
}

function renderDetail(id) {
  detail = null;
  replyTo = null;
  el.innerHTML = '<div class="empty">Loading&hellip;</div>';
  loadDetail(id);
  unsubs.push(cloud.on(state.tableChannel(), 'ideas', p => { if (!p.id || p.id === id) loadDetail(id); }));
}

// ---------- entry ----------

export async function render(root, id) {
  el = root;
  unsubs.forEach(fn => fn());
  unsubs = [];
  const startKey = gateKey();
  unsubs.push(state.onChange(() => { if (gateKey() !== startKey) render(root, id); }));
  if (!gate(el)) return;
  el.dataset.ready = '1';
  const hash = location.hash;
  if (/\/new$/.test(hash)) renderNew();
  else if (id) renderDetail(id);
  else renderList();
}

export function destroy() {
  unsubs.forEach(f => f());
  unsubs = [];
  if (el) delete el.dataset.ready;
  el = null;
  detail = null;
}
