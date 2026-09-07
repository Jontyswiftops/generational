// The 3D round table on the home screen. Three.js only loads through this
// module, so browsers without WebGL never fetch it.
//
// API: init(canvas, opts) -> Promise, setMembers(list), setSessionTitle(text),
//      onSeatTap(cb), pause(), resume(), dispose()
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

let renderer, scene, camera, canvas, host;
let tableGroup, seatsGroup, boardCtx, boardTex;
let members = [];
let seatObjs = new Map(); // id -> { group, ring, pad, back, avatar, glow, state }
let raf = null;
let paused = false;
let lastFrame = 0;
let angle = 0;
let angleVel = 0;
let dragging = false;
let dragStart = null;
let dragMoved = 0;
let lastX = 0;
let tapCb = null;
let resizeObs = null;
let reduceMotion = false;
let glowTexture = null;
let placeholderTable = null;
let glbLoaded = false;

const GOLD = 0xd4a84b;
const CAM_RADIUS = 6.6;
const CAM_HEIGHT = 4.2;
let seatRadius = 2.05;
let floorMesh = null, boardFace = null, boardFrame = null;

export function init(cnv, opts = {}) {
  canvas = cnv;
  host = canvas.parentElement;
  reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = false;

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(33, 1, 0.1, 60);

  buildLights();
  buildFloor();
  placeholderTable = buildPlaceholderTable();
  scene.add(placeholderTable);
  buildWhiteboard();
  seatsGroup = new THREE.Group();
  scene.add(seatsGroup);

  angle = -0.35;
  resize();
  resizeObs = new ResizeObserver(resize);
  resizeObs.observe(host);

  canvas.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  document.addEventListener('visibilitychange', onVisibility);

  start();

  if (opts.glbUrl) loadGlb(opts.glbUrl).catch(() => { /* placeholder stays */ });
  return Promise.resolve();
}

// ---------- scene pieces ----------

function buildLights() {
  const hemi = new THREE.HemisphereLight(0x3a4a7a, 0x05070c, 0.9);
  scene.add(hemi);
  const spot = new THREE.SpotLight(0xfff0d0, 70, 14, 0.42, 0.7, 1.6);
  spot.position.set(0, 5.5, 0.6);
  spot.target.position.set(0, 0.8, 0);
  scene.add(spot, spot.target);
  const glint = new THREE.PointLight(GOLD, 6, 6, 2);
  glint.position.set(0, 1.4, 0);
  scene.add(glint);
  const fill = new THREE.DirectionalLight(0x8fb0ff, 0.35);
  fill.position.set(-4, 3, 4);
  scene.add(fill);
}

function buildFloor() {
  const geo = new THREE.CircleGeometry(6, 64);
  const mat = new THREE.MeshStandardMaterial({ color: 0x0b0f1c, roughness: 0.55, metalness: 0.25 });
  const floor = new THREE.Mesh(geo, mat);
  floorMesh = floor;
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0;
  scene.add(floor);
}

function buildPlaceholderTable() {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x2a1a10, roughness: 0.32, metalness: 0.08 });
  const gold = new THREE.MeshStandardMaterial({ color: GOLD, roughness: 0.28, metalness: 1 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x161a26, roughness: 0.5, metalness: 0.3 });

  const top = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.09, 96), wood);
  top.position.y = 0.78;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.03, 12, 128), gold);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.825;
  const inlay = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.012, 8, 96), gold);
  inlay.rotation.x = Math.PI / 2;
  inlay.position.y = 0.826;
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.42, 0.7, 48), dark);
  stem.position.y = 0.38;
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.8, 0.06, 64), dark);
  foot.position.y = 0.03;
  const footRim = new THREE.Mesh(new THREE.TorusGeometry(0.78, 0.012, 8, 96), gold);
  footRim.rotation.x = Math.PI / 2;
  footRim.position.y = 0.065;
  g.add(top, rim, inlay, stem, foot, footRim);
  g.name = 'PlaceholderTable';
  return g;
}

function buildWhiteboard() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 288;
  boardCtx = c.getContext('2d');
  boardTex = new THREE.CanvasTexture(c);
  boardTex.colorSpace = THREE.SRGBColorSpace;
  paintBoard('');
  const face = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.35),
    new THREE.MeshBasicMaterial({ map: boardTex }));
  face.position.set(0, 1.65, -2.85);
  const frame = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 1.45),
    new THREE.MeshStandardMaterial({ color: GOLD, roughness: 0.3, metalness: 1 }));
  frame.position.set(0, 1.65, -2.86);
  boardFace = face;
  boardFrame = frame;
  scene.add(frame, face);
}

function paintBoard(title) {
  const ctx = boardCtx, w = 512, h = 288;
  ctx.clearRect(0, 0, w, h);
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#111626');
  grad.addColorStop(1, '#0a0d18');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(212,168,75,0.25)';
  ctx.lineWidth = 2;
  ctx.strokeRect(14, 14, w - 28, h - 28);
  ctx.fillStyle = '#8b95b0';
  ctx.font = '600 22px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(title ? 'NEXT ROUND TABLE' : 'THE ROUND TABLE', w / 2, 70);
  ctx.fillStyle = '#f0c669';
  ctx.font = '800 34px Inter, system-ui, sans-serif';
  wrapText(ctx, title || 'Nothing scheduled yet', w / 2, 130, w - 80, 42, 3);
  if (boardTex) boardTex.needsUpdate = true;
}

function wrapText(ctx, text, x, y, maxW, lh, maxLines) {
  const words = String(text).split(/\s+/);
  let line = '', lines = [];
  for (const wd of words) {
    const test = line ? line + ' ' + wd : wd;
    if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = wd; }
    else line = test;
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) { lines = lines.slice(0, maxLines); lines[maxLines - 1] += '…'; }
  lines.forEach((l, i) => ctx.fillText(l, x, y + i * lh));
}

function glowTex() {
  if (glowTexture) return glowTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(240,198,105,0.9)');
  g.addColorStop(0.35, 'rgba(240,198,105,0.35)');
  g.addColorStop(1, 'rgba(240,198,105,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  glowTexture = new THREE.CanvasTexture(c);
  glowTexture.colorSpace = THREE.SRGBColorSpace;
  return glowTexture;
}

function avatarTex(name, initials, isHost) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 160;
  const ctx = c.getContext('2d');
  // disc
  const cx = 128, cy = 60, r = 52;
  const g = ctx.createLinearGradient(cx, cy - r, cx, cy + r);
  g.addColorStop(0, '#f0c669');
  g.addColorStop(1, '#b8892e');
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = g; ctx.fill();
  ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.stroke();
  ctx.fillStyle = '#1a1305';
  ctx.font = '800 44px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(initials, cx, cy + 2);
  if (isHost) {
    ctx.font = '700 22px Inter, system-ui, sans-serif';
    ctx.fillStyle = '#f0c669';
    ctx.fillText('★', cx + r - 6, cy - r + 8);
  }
  // name pill
  ctx.font = '700 24px Inter, system-ui, sans-serif';
  const label = name.length > 14 ? name.slice(0, 13) + '…' : name;
  const tw = ctx.measureText(label).width + 28;
  const px = cx - tw / 2, py = 120, ph = 34;
  ctx.fillStyle = 'rgba(8,11,20,0.85)';
  roundRect(ctx, px, py, tw, ph, 17); ctx.fill();
  ctx.strokeStyle = 'rgba(212,168,75,0.5)'; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = '#eef1f8';
  ctx.fillText(label, cx, py + ph / 2 + 1);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ---------- seats ----------

function makeSeat(m) {
  const group = new THREE.Group();
  const chairMat = new THREE.MeshStandardMaterial({ color: 0x1b2236, roughness: 0.6, metalness: 0.2, emissive: GOLD, emissiveIntensity: 0 });
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.18, 0.05, 32), chairMat);
  pad.position.y = 0.46;
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.4, 0.04), chairMat);
  back.position.set(0, 0.66, 0.18);
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.44, 12),
    new THREE.MeshStandardMaterial({ color: 0x161a26, roughness: 0.5, metalness: 0.4 }));
  post.position.y = 0.22;
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.36, 48),
    new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.12, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.012;

  const avatar = new THREE.Sprite(new THREE.SpriteMaterial({ map: avatarTex(m.name, m.initials, m.isHost), transparent: true, depthWrite: false }));
  avatar.scale.set(1.0, 0.625, 1);
  avatar.position.y = 1.3;
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  glow.scale.set(1.3, 1.3, 1);
  glow.position.y = 1.24;

  group.add(ring, post, pad, back, glow, avatar);
  group.userData.seatId = m.id;
  [pad, back, avatar, ring].forEach(o => { o.userData.seatId = m.id; });
  return { group, pad, back, avatar, glow, ring, mat: chairMat, phase: Math.random() * Math.PI * 2 };
}

export function setMembers(list) {
  members = list || [];
  const ids = new Set(members.map(m => m.id));
  // remove gone
  for (const [id, s] of seatObjs) {
    if (!ids.has(id)) { seatsGroup.remove(s.group); disposeObj(s.group); seatObjs.delete(id); }
  }
  // add new
  members.forEach(m => {
    if (!seatObjs.has(m.id)) {
      const s = makeSeat(m);
      seatsGroup.add(s.group);
      seatObjs.set(m.id, s);
    }
  });
  // place around the ring, host at the far side facing the camera's start
  const n = members.length;
  members.forEach((m, i) => {
    const s = seatObjs.get(m.id);
    const a = Math.PI + (i / Math.max(n, 1)) * Math.PI * 2;
    const x = Math.sin(a) * seatRadius, z = Math.cos(a) * seatRadius;
    s.group.position.set(x, 0, z);
    s.group.lookAt(0, 0, 0);
    applyState(s, m);
  });
}

function applyState(s, m) {
  s.state = m.active ? 'active' : (m.online ? 'online' : 'off');
  const on = s.state !== 'off';
  s.mat.emissiveIntensity = on ? 0.18 : 0;
  s.mat.color.setHex(on ? 0x243052 : 0x1b2236);
  s.avatar.material.opacity = on ? 1 : 0.42;
  s.avatar.material.color.setHex(on ? 0xffffff : 0x8a8f9c);
  s.glow.material.opacity = s.state === 'active' ? 0.55 : (on ? 0.32 : 0);
  s.ring.material.opacity = on ? 0.35 : 0.1;
}

export function setSessionTitle(text) {
  paintBoard(text || '');
}

export function onSeatTap(cb) { tapCb = cb; }

// ---------- GLB (from Blender) ----------

async function loadGlb(url) {
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(url);
  const model = gltf.scene;
  // The Blender scene owns the table, floor, wall and whiteboard; seats stay
  // procedural so the ring re-spaces for any member count.
  model.traverse(o => {
    if (!o.isMesh) return;
    if (o.name === 'Whiteboard_Face') {
      o.material = new THREE.MeshBasicMaterial({ map: boardTex });
    } else if (o.name === 'Marker_Disc') {
      o.visible = false;
    }
  });
  const seat1 = model.getObjectByName('Seat_01');
  if (seat1) {
    const r = Math.hypot(seat1.position.x, seat1.position.z);
    if (r > 0.5 && r < 5) seatRadius = r;
  }
  [placeholderTable, floorMesh, boardFace, boardFrame].forEach(o => {
    if (o) { scene.remove(o); disposeObj(o); }
  });
  placeholderTable = floorMesh = boardFace = boardFrame = null;
  scene.add(model);
  glbLoaded = true;
  setMembers(members);
}

// ---------- interaction ----------

function onDown(e) {
  dragging = true;
  dragMoved = 0;
  dragStart = { x: e.clientX, y: e.clientY };
  lastX = e.clientX;
  angleVel = 0;
  try { canvas.setPointerCapture(e.pointerId); } catch {}
}
function onMove(e) {
  if (!dragging) return;
  const dx = e.clientX - lastX;
  lastX = e.clientX;
  dragMoved += Math.abs(dx) + Math.abs(e.movementY || 0);
  angle -= dx * 0.006;
  angleVel = -dx * 0.006;
}
function onUp(e) {
  if (!dragging) return;
  dragging = false;
  if (dragMoved < 8 && tapCb) {
    const hit = pick(e.clientX, e.clientY);
    if (hit) {
      const r = canvas.getBoundingClientRect();
      tapCb(hit, { x: e.clientX - r.left, y: e.clientY - r.top });
    }
  }
}

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
function pick(cx, cy) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects(seatsGroup.children, true);
  for (const h of hits) {
    let o = h.object;
    while (o && !o.userData.seatId) o = o.parent;
    if (o?.userData.seatId) return members.find(m => m.id === o.userData.seatId) || null;
  }
  return null;
}

// ---------- loop ----------

function resize() {
  if (!renderer || !host) return;
  const w = host.clientWidth || 320, h = host.clientHeight || 300;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderOnce();
}

function frame(t) {
  raf = requestAnimationFrame(frame);
  const anyActive = [...seatObjs.values()].some(s => s.state === 'active');
  const busy = dragging || Math.abs(angleVel) > 0.0005 || anyActive;
  const minDt = busy ? 0 : 1000 / 30;
  if (t - lastFrame < minDt) return;
  const dt = Math.min(0.05, (t - lastFrame) / 1000 || 0.016);
  lastFrame = t;

  if (!dragging) {
    if (Math.abs(angleVel) > 0.0005) { angle += angleVel; angleVel *= 0.92; }
    else if (!reduceMotion) angle += 0.06 * dt;
  }
  if (!reduceMotion) {
    for (const s of seatObjs.values()) {
      if (s.state === 'active') {
        const p = 0.5 + 0.5 * Math.sin(t / 420 + s.phase);
        s.glow.material.opacity = 0.35 + 0.4 * p;
        s.glow.scale.setScalar(1.2 + 0.35 * p);
        s.mat.emissiveIntensity = 0.15 + 0.25 * p;
      }
    }
  }
  renderOnce();
}

function renderOnce() {
  camera.position.set(Math.sin(angle) * CAM_RADIUS, CAM_HEIGHT, Math.cos(angle) * CAM_RADIUS);
  camera.lookAt(0, 0.7, 0);
  renderer.render(scene, camera);
}

function start() {
  if (raf || paused) return;
  lastFrame = performance.now();
  raf = requestAnimationFrame(frame);
}

export function pause() {
  paused = true;
  if (raf) { cancelAnimationFrame(raf); raf = null; }
}
export function resume() {
  paused = false;
  start();
}
function onVisibility() {
  if (document.hidden) { if (raf) { cancelAnimationFrame(raf); raf = null; } }
  else if (!paused) start();
}

function disposeObj(obj) {
  obj.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
    mats.forEach(m => {
      if (m.map && m.map !== glowTexture) m.map.dispose();
      m.dispose();
    });
  });
}

export function dispose() {
  pause();
  paused = false;
  if (resizeObs) { resizeObs.disconnect(); resizeObs = null; }
  if (canvas) canvas.removeEventListener('pointerdown', onDown);
  window.removeEventListener('pointermove', onMove);
  window.removeEventListener('pointerup', onUp);
  window.removeEventListener('pointercancel', onUp);
  document.removeEventListener('visibilitychange', onVisibility);
  if (scene) disposeObj(scene);
  if (glowTexture) { glowTexture.dispose(); glowTexture = null; }
  if (boardTex) { boardTex.dispose(); boardTex = null; }
  if (renderer) { renderer.dispose(); renderer = null; }
  seatObjs = new Map();
  members = [];
  scene = camera = canvas = host = null;
  placeholderTable = null;
  glbLoaded = false;
}

// Diagnostics for the browser console; not used by the app.
export function _debug(opts = {}) {
  const glb = scene && scene.children.find(c => c.type === 'Scene' || c.type === 'Group' && c !== seatsGroup);
  if (glb && 'hideGlb' in opts) glb.visible = !opts.hideGlb;
  if (glb && opts.mesh) glb.traverse(o => { if (o.name === opts.mesh) o.visible = !opts.hide; });
  const box = glb ? new THREE.Box3().setFromObject(glb) : null;
  const meshes = [];
  if (glb) glb.traverse(o => { if (o.isMesh) { const b = new THREE.Box3().setFromObject(o); meshes.push(o.name + ' y[' + b.min.y.toFixed(2) + ',' + b.max.y.toFixed(2) + '] z[' + b.min.z.toFixed(2) + ',' + b.max.z.toFixed(2) + '] side=' + o.material.side + ' t=' + o.material.transparent); } });
  return {
    glbBox: box ? [box.min.toArray().map(v => +v.toFixed(2)), box.max.toArray().map(v => +v.toFixed(2))] : null,
    meshes,
    members: members.length,
    seats: seatObjs.size,
    glbLoaded,
    seatRadius,
    children: scene ? scene.children.map(c => (c.name || c.type) + (c.visible ? '' : ' (hidden)')) : [],
    seatVisible: [...seatObjs.values()].map(s => s.group.visible + '@' + s.group.position.x.toFixed(2) + ',' + s.group.position.z.toFixed(2))
  };
}
