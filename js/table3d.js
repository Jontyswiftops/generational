// The 3D round table room on the home screen. Three.js only loads through
// this module, so browsers without WebGL never fetch it.
//
// API: init(canvas, opts) -> Promise, setMembers(list), setSessionTitle(text),
//      onSeatTap(cb), pause(), resume(), dispose()
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

let renderer, scene, camera, canvas, host;
let seatsGroup, boardCtx, boardTex;
let members = [];
let seatObjs = new Map(); // id -> { group, chair, chairMats, avatar, glow, ring, state, phase }
let raf = null;
let paused = false;
let lastFrame = 0;
let angle = 0;
let angleVel = 0;
let dragging = false;
let dragMoved = 0;
let lastX = 0;
let tapCb = null;
let resizeObs = null;
let reduceMotion = false;
let lowPower = false;
let glowTexture = null;
let placeholderTable = null;
let floorMesh = null, boardFace = null, boardFrame = null;
let chairMaster = null;      // from the GLB
let lampSpot = null, lampBulb = null, lampBase = 0;
let sconces = [];
let goldMats = [];
let dust = null;
let envTex = null;
let seatRadius = 2.15;
let boardFlip = false;   // glTF UVs run the other way to a canvas
let glbLoaded = false;

const GOLD = 0xd4a84b;
const CAM_RADIUS = 6.9;
const CAM_HEIGHT = 3.9;

export function init(cnv, opts = {}) {
  canvas = cnv;
  host = canvas.parentElement;
  reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  lowPower = (navigator.deviceMemory && navigator.deviceMemory < 4) || navigator.hardwareConcurrency <= 4;

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lowPower ? 1.25 : 1.75));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = !lowPower;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x070a12, 0.045);
  camera = new THREE.PerspectiveCamera(32, 1, 0.1, 80);

  // Reflections for the gold and marble without any image assets.
  try {
    const pmrem = new THREE.PMREMGenerator(renderer);
    envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTex;
    pmrem.dispose();
  } catch { /* no env map: still renders */ }

  buildLights();
  buildFloor();
  placeholderTable = buildPlaceholderTable();
  scene.add(placeholderTable);
  buildWhiteboard();
  buildDust();
  seatsGroup = new THREE.Group();
  scene.add(seatsGroup);

  angle = -0.3;
  resize();
  resizeObs = new ResizeObserver(resize);
  resizeObs.observe(host);

  canvas.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  document.addEventListener('visibilitychange', onVisibility);

  start();

  if (opts.glbUrl) loadGlb(opts.glbUrl).catch(err => console.warn('table.glb not loaded', err));
  return Promise.resolve();
}

// ---------- scene pieces ----------

function buildLights() {
  scene.add(new THREE.HemisphereLight(0x2c3a66, 0x04060b, 0.35));
  scene.add(new THREE.AmbientLight(0x1a2240, 0.3));
  scene.environmentIntensity = 0.22;

  // The pendant over the table. Warm, tight, and the only shadow caster.
  lampSpot = new THREE.SpotLight(0xffe2b0, 110, 16, 0.72, 0.5, 1.5);
  lampSpot.position.set(0, 2.15, 0);
  lampSpot.target.position.set(0, 0, 0);
  lampSpot.castShadow = !lowPower;
  lampSpot.shadow.mapSize.set(1024, 1024);
  lampSpot.shadow.bias = -0.0004;
  lampSpot.shadow.radius = 4;
  lampSpot.shadow.camera.near = 0.5;
  lampSpot.shadow.camera.far = 12;
  lampBase = lampSpot.intensity;
  scene.add(lampSpot, lampSpot.target);

  const glint = new THREE.PointLight(GOLD, 4, 5, 2);
  glint.position.set(0, 1.5, 0);
  scene.add(glint);

  const fill = new THREE.DirectionalLight(0x7fa6ff, 0.25);
  fill.position.set(-5, 4, 6);
  scene.add(fill);

  // Wall wash from behind the camera so the room does not fall to black.
  const wash = new THREE.PointLight(0xb08a48, 6, 14, 1.8);
  wash.position.set(0, 3.2, 6.5);
  scene.add(wash);
}

function buildFloor() {
  const geo = new THREE.CircleGeometry(7, 64);
  const mat = new THREE.MeshStandardMaterial({ color: 0x0a0d1a, roughness: 0.15, metalness: 0.2, envMapIntensity: 0.8 });
  floorMesh = new THREE.Mesh(geo, mat);
  floorMesh.rotation.x = -Math.PI / 2;
  floorMesh.receiveShadow = true;
  scene.add(floorMesh);
}

function buildPlaceholderTable() {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x2a1a10, roughness: 0.3, metalness: 0.05 });
  const gold = new THREE.MeshStandardMaterial({ color: GOLD, roughness: 0.26, metalness: 1 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x161a26, roughness: 0.45, metalness: 0.4 });
  const top = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.1, 96), wood);
  top.position.y = 0.78;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.032, 12, 128), gold);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.83;
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.4, 0.62, 48), dark);
  stem.position.y = 0.4;
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.78, 0.86, 0.07, 64), dark);
  foot.position.y = 0.035;
  [top, rim, stem, foot].forEach(m => { m.castShadow = true; m.receiveShadow = true; });
  g.add(top, rim, stem, foot);
  goldMats.push(gold);
  return g;
}

function buildWhiteboard() {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 560;
  boardCtx = c.getContext('2d');
  boardTex = new THREE.CanvasTexture(c);
  boardTex.colorSpace = THREE.SRGBColorSpace;
  boardTex.anisotropy = 4;
  paintBoard('');
  boardFace = new THREE.Mesh(new THREE.PlaneGeometry(3.55, 1.95), new THREE.MeshBasicMaterial({ map: boardTex }));
  boardFace.position.set(0, 1.95, -6.4);
  boardFrame = new THREE.Mesh(new THREE.PlaneGeometry(3.7, 2.1),
    new THREE.MeshStandardMaterial({ color: GOLD, roughness: 0.3, metalness: 1 }));
  boardFrame.position.set(0, 1.95, -6.42);
  scene.add(boardFrame, boardFace);
}

let boardTitle = '';
function paintBoard(title) {
  boardTitle = title || '';
  const ctx = boardCtx, w = 1024, h = 560;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (boardFlip) { ctx.translate(0, h); ctx.scale(1, -1); }
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#131a2c');
  grad.addColorStop(1, '#0a0d18');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  // faint grid, like a real whiteboard with old marker ghosts
  ctx.strokeStyle = 'rgba(255,255,255,0.03)';
  ctx.lineWidth = 1;
  for (let x = 64; x < w; x += 64) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  for (let y = 64; y < h; y += 64) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
  ctx.strokeStyle = 'rgba(212,168,75,0.35)';
  ctx.lineWidth = 3;
  ctx.strokeRect(28, 28, w - 56, h - 56);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#8b95b0';
  ctx.font = '600 40px Inter, system-ui, sans-serif';
  ctx.fillText(title ? 'NEXT ROUND TABLE' : 'THE ROUND TABLE', w / 2, 140);
  ctx.fillStyle = '#f0c669';
  ctx.font = '800 66px Inter, system-ui, sans-serif';
  wrapText(ctx, title || 'Nothing scheduled yet', w / 2, 250, w - 160, 80, 3);
  // a gold underline flourish
  ctx.strokeStyle = 'rgba(240,198,105,0.6)';
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(w / 2 - 140, 470); ctx.lineTo(w / 2 + 140, 470); ctx.stroke();
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

function buildDust() {
  const n = lowPower ? 90 : 220;
  const pos = new Float32Array(n * 3);
  const seed = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = Math.sqrt(Math.random()) * 2.4;
    const a = Math.random() * Math.PI * 2;
    pos[i * 3] = Math.cos(a) * r;
    pos[i * 3 + 1] = 0.6 + Math.random() * 2.2;
    pos[i * 3 + 2] = Math.sin(a) * r;
    seed[i] = Math.random() * Math.PI * 2;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.userData.seed = seed;
  geo.userData.base = pos.slice();
  const mat = new THREE.PointsMaterial({
    map: glowTex(), color: 0xffe0a8, size: 0.06, transparent: true, opacity: 0.55,
    depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true
  });
  dust = new THREE.Points(geo, mat);
  scene.add(dust);
}

function glowTex() {
  if (glowTexture) return glowTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(240,198,105,1)');
  g.addColorStop(0.3, 'rgba(240,198,105,0.45)');
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
  const cx = 128, cy = 60, r = 52;
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 12;
  const g = ctx.createLinearGradient(cx, cy - r, cx, cy + r);
  g.addColorStop(0, '#f6d27e');
  g.addColorStop(1, '#b8892e');
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = g; ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.stroke();
  ctx.fillStyle = '#1a1305';
  ctx.font = '800 44px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(initials, cx, cy + 2);
  if (isHost) {
    ctx.font = '700 24px Inter, system-ui, sans-serif';
    ctx.fillStyle = '#fff2c8';
    ctx.fillText('★', cx + r - 8, cy - r + 10);
  }
  ctx.font = '700 24px Inter, system-ui, sans-serif';
  const label = name.length > 14 ? name.slice(0, 13) + '…' : name;
  const tw = ctx.measureText(label).width + 28;
  const px = cx - tw / 2, py = 120, ph = 34;
  ctx.fillStyle = 'rgba(8,11,20,0.88)';
  roundRect(ctx, px, py, tw, ph, 17); ctx.fill();
  ctx.strokeStyle = 'rgba(212,168,75,0.55)'; ctx.lineWidth = 2; ctx.stroke();
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

function proceduralChair() {
  const leather = new THREE.MeshStandardMaterial({ color: 0x171a26, roughness: 0.45, metalness: 0.05, emissive: GOLD, emissiveIntensity: 0 });
  const frame = new THREE.MeshStandardMaterial({ color: 0x161a26, roughness: 0.45, metalness: 0.4 });
  const g = new THREE.Group();
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.1, 0.54), leather);
  seat.position.y = 0.47;
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.62, 0.07), leather);
  back.position.set(0, 0.83, 0.25);
  back.rotation.x = 0.12;
  g.add(seat, back);
  [[-0.22, -0.22], [0.22, -0.22], [-0.22, 0.22], [0.22, 0.22]].forEach(([x, z]) => {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.39, 0.04), frame);
    leg.position.set(x, 0.195, z);
    g.add(leg);
  });
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return { obj: g, mats: [leather] };
}

function chairInstance() {
  if (!chairMaster) return proceduralChair();
  const obj = chairMaster.clone(true);
  obj.visible = true;
  obj.position.set(0, 0, 0);
  obj.rotation.set(0, 0, 0);
  const mats = [];
  obj.traverse(o => {
    o.visible = true;
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    const arr = Array.isArray(o.material) ? o.material : [o.material];
    const cloned = arr.map(m => {
      const c = m.clone();
      c.envMapIntensity = /gold/i.test(m.name) ? 1.2 : 0.12;
      if (/leather/i.test(m.name)) { c.emissive = new THREE.Color(GOLD); c.emissiveIntensity = 0; mats.push(c); }
      return c;
    });
    o.material = Array.isArray(o.material) ? cloned : cloned[0];
  });
  return { obj, mats };
}

// Planar UVs for a mesh exported without them (the whiteboard face).
function ensureUv(geo) {
  if (geo.attributes.uv) return;
  geo.computeBoundingBox();
  const b = geo.boundingBox, p = geo.attributes.position;
  const sx = b.max.x - b.min.x || 1, sy = b.max.y - b.min.y || 1;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    uv[i * 2] = (p.getX(i) - b.min.x) / sx;
    uv[i * 2 + 1] = (p.getY(i) - b.min.y) / sy;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

function makeSeat(m) {
  const group = new THREE.Group();
  const { obj: chair, mats } = chairInstance();
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.42, 48),
    new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  const avatar = new THREE.Sprite(new THREE.SpriteMaterial({ map: avatarTex(m.name, m.initials, m.isHost), transparent: true, depthWrite: false }));
  avatar.scale.set(1.0, 0.625, 1);
  avatar.position.y = 1.55;
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  glow.scale.set(1.4, 1.4, 1);
  glow.position.y = 1.5;
  group.add(ring, chair, glow, avatar);
  group.userData.seatId = m.id;
  group.traverse(o => { o.userData.seatId = m.id; });
  return { group, chair, mats, avatar, glow, ring, phase: Math.random() * Math.PI * 2, baseY: 1.55 };
}

export function setMembers(list) {
  members = list || [];
  const ids = new Set(members.map(m => m.id));
  for (const [id, s] of seatObjs) {
    if (!ids.has(id)) { seatsGroup.remove(s.group); disposeObj(s.group); seatObjs.delete(id); }
  }
  members.forEach(m => {
    if (!seatObjs.has(m.id)) {
      const s = makeSeat(m);
      seatsGroup.add(s.group);
      seatObjs.set(m.id, s);
    }
  });
  const n = members.length;
  members.forEach((m, i) => {
    const s = seatObjs.get(m.id);
    const a = Math.PI + (i / Math.max(n, 1)) * Math.PI * 2;
    s.group.position.set(Math.sin(a) * seatRadius, 0, Math.cos(a) * seatRadius);
    // chair front is -z (Blender +y), so rotation.y = a faces the centre
    s.group.rotation.set(0, a, 0);
    applyState(s, m);
  });
}

function rebuildChairs() {
  // Called once the GLB chair arrives: swap procedural chairs for the model.
  for (const s of seatObjs.values()) {
    s.group.remove(s.chair);
    disposeObj(s.chair);
    const { obj, mats } = chairInstance();
    s.chair = obj;
    s.mats = mats;
    s.group.add(obj);
  }
  setMembers(members);
}

function applyState(s, m) {
  s.state = m.active ? 'active' : (m.online ? 'online' : 'off');
  const on = s.state !== 'off';
  s.mats.forEach(mat => { mat.emissiveIntensity = on ? 0.12 : 0; });
  s.avatar.material.opacity = on ? 1 : 0.4;
  s.avatar.material.color.setHex(on ? 0xffffff : 0x8a8f9c);
  s.glow.material.opacity = s.state === 'active' ? 0.6 : (on ? 0.3 : 0);
  s.ring.material.opacity = on ? 0.4 : 0.08;
}

export function setSessionTitle(text) { paintBoard(text || ''); }
export function onSeatTap(cb) { tapCb = cb; }

// ---------- GLB (from Blender) ----------

async function loadGlb(url) {
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(url);
  const model = gltf.scene;
  sconces = [];
  // Multi-material objects load as a Group of meshes, so look up by name first.
  chairMaster = model.getObjectByName('Marker_Chair') || null;
  if (chairMaster) chairMaster.visible = false;
  const ENV = { Gold: 1.3, GoldDim: 0.6, Marble: 0.18, Leather: 0.12, DarkMetal: 0.2, Walnut: 0.2, WalnutDark: 0.15, Stone: 0.05 };
  model.traverse(o => {
    if (!o.isMesh) return;
    const name = o.name || '';
    const parent = o.parent?.name || '';
    if (name === 'Whiteboard_Face') {
      ensureUv(o.geometry);
      boardFlip = true;
      paintBoard(boardTitle);
      o.material = new THREE.MeshBasicMaterial({ map: boardTex });
    } else if (name === 'Lamp_Bulb') {
      lampBulb = o;
    } else if (/^Sconce_\d+$/.test(name)) {
      sconces.push(o);
    }
    if (/^(Table_|Lamp_|Pillar)/.test(name) || /^Whiteboard_(Frame|Ledge)/.test(name)) o.castShadow = true;
    if (/^(Floor|Rug|Table_Top|Wall)/.test(name)) o.receiveShadow = true;
    if (o.material && 'envMapIntensity' in o.material && !/Marker_Chair/.test(parent + name)) {
      o.material.envMapIntensity = ENV[o.material.name] ?? 0.08;
      if (/^Gold$/.test(o.material.name) && !goldMats.includes(o.material)) goldMats.push(o.material);
    }
  });
  const seat1 = model.getObjectByName('Seat_01');
  if (seat1) {
    const r = Math.hypot(seat1.position.x, seat1.position.z);
    if (r > 0.5 && r < 5) seatRadius = r;
  }
  [placeholderTable, floorMesh, boardFace, boardFrame].forEach(o => { if (o) { scene.remove(o); disposeObj(o, true); } });
  placeholderTable = floorMesh = boardFace = boardFrame = null;
  scene.add(model);
  glbLoaded = true;
  if (chairMaster) rebuildChairs(); else setMembers(members);
}

// ---------- interaction ----------

function onDown(e) {
  dragging = true;
  dragMoved = 0;
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
  renderOnce(performance.now());
}

function frame(t) {
  raf = requestAnimationFrame(frame);
  const busy = dragging || Math.abs(angleVel) > 0.0005;
  const minDt = busy || !lowPower ? 0 : 1000 / 30;
  if (t - lastFrame < minDt) return;
  const dt = Math.min(0.05, (t - lastFrame) / 1000 || 0.016);
  lastFrame = t;

  if (!dragging) {
    if (Math.abs(angleVel) > 0.0005) { angle += angleVel; angleVel *= 0.92; }
    else if (!reduceMotion) angle += 0.05 * dt;
  }
  if (!reduceMotion) {
    const s1 = t / 1000;
    // pendant breathes and flickers a touch
    if (lampSpot) lampSpot.intensity = lampBase * (1 + 0.04 * Math.sin(s1 * 1.3) + 0.02 * Math.sin(s1 * 9.7) + 0.012 * Math.sin(s1 * 23.1));
    if (lampBulb && lampBulb.material) lampBulb.material.emissiveIntensity = 10 + 1.5 * Math.sin(s1 * 9.7);
    sconces.forEach((sc, i) => { if (sc.material) sc.material.emissiveIntensity = 5 + 0.8 * Math.sin(s1 * (6 + i) + i); });
    // gold catches the light
    const shimmer = 0.5 + 0.5 * Math.sin(s1 * 0.8);
    goldMats.forEach(m => { m.roughness = 0.24 + 0.06 * shimmer; });
    // seats: hover, pulse
    for (const s of seatObjs.values()) {
      s.avatar.position.y = s.baseY + 0.04 * Math.sin(s1 * 1.6 + s.phase);
      if (s.state === 'active') {
        const p = 0.5 + 0.5 * Math.sin(s1 * 2.4 + s.phase);
        s.glow.material.opacity = 0.35 + 0.45 * p;
        s.glow.scale.setScalar(1.3 + 0.4 * p);
        s.mats.forEach(mat => { mat.emissiveIntensity = 0.1 + 0.2 * p; });
        s.ring.material.opacity = 0.3 + 0.3 * p;
      }
    }
    // dust drifts
    if (dust) {
      const pos = dust.geometry.attributes.position;
      const base = dust.geometry.userData.base;
      const seed = dust.geometry.userData.seed;
      for (let i = 0; i < pos.count; i++) {
        const k = seed[i];
        pos.array[i * 3] = base[i * 3] + 0.12 * Math.sin(s1 * 0.35 + k);
        pos.array[i * 3 + 1] = base[i * 3 + 1] + 0.1 * Math.sin(s1 * 0.5 + k * 1.7);
        pos.array[i * 3 + 2] = base[i * 3 + 2] + 0.12 * Math.cos(s1 * 0.3 + k);
      }
      pos.needsUpdate = true;
    }
  }
  renderOnce(t);
}

function renderOnce(t) {
  const bob = reduceMotion ? 0 : 0.08 * Math.sin((t || 0) / 2600);
  camera.position.set(Math.sin(angle) * CAM_RADIUS, CAM_HEIGHT + bob, Math.cos(angle) * CAM_RADIUS);
  camera.lookAt(0, 1.35, 0);
  renderer.render(scene, camera);
}

function start() {
  if (raf || paused) return;
  lastFrame = performance.now();
  raf = requestAnimationFrame(frame);
}
export function pause() { paused = true; if (raf) { cancelAnimationFrame(raf); raf = null; } }
export function resume() { paused = false; start(); }
function onVisibility() {
  if (document.hidden) { if (raf) { cancelAnimationFrame(raf); raf = null; } }
  else if (!paused) start();
}

function disposeObj(obj, keepBoard = false) {
  obj.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
    mats.forEach(m => {
      if (m.map && m.map !== glowTexture && !(keepBoard && m.map === boardTex)) m.map.dispose();
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
  if (envTex) { envTex.dispose(); envTex = null; }
  if (renderer) { renderer.dispose(); renderer = null; }
  seatObjs = new Map();
  members = [];
  goldMats = [];
  sconces = [];
  chairMaster = lampSpot = lampBulb = dust = null;
  scene = camera = canvas = host = null;
  placeholderTable = floorMesh = boardFace = boardFrame = null;
  glbLoaded = false;
}

// Diagnostics for the browser console; not used by the app.
export function _debug(opts = {}) {
  if (scene && 'env' in opts) scene.environmentIntensity = opts.env;
  if (renderer && 'exposure' in opts) renderer.toneMappingExposure = opts.exposure;
  if (boardTex && 'boardRot' in opts) { boardTex.rotation = opts.boardRot; boardTex.needsUpdate = true; }
  if (lampSpot && 'lamp' in opts) { lampBase = opts.lamp; lampSpot.intensity = opts.lamp; }
  if ('cam' in opts) { angle = opts.cam; }
  if (opts.snapshot && renderer) { renderOnce(performance.now()); return canvas.toDataURL('image/png'); }
  return {
    members: members.length, seats: seatObjs.size, glbLoaded, seatRadius, chair: !!chairMaster,
    sconces: sconces.length, lamp: !!lampBulb, lowPower, shadows: renderer?.shadowMap.enabled
  };
}
