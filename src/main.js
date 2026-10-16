import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildProfile, buildRamp } from './ramp.js';
import { StuntSim, PHASES } from './sim.js';
import { buildCar, NOZZLES } from './car.js';
import { buildEnvironment } from './env.js';
import { Smoke } from './smoke.js';
import { Rigs, Director, CAMS, lightShow } from './cameras.js';
import { createPost } from './post.js';
import { buildEnvMap } from './envmap.js';
import { makeGlowTexture } from './textures.js';
import { smoothstep } from './util.js';

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------- renderer + scene
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.setSize(innerWidth, innerHeight, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
scene.fog = new THREE.FogExp2(0x020203, 0.0032);
scene.environment = buildEnvMap(renderer);

const camera = new THREE.PerspectiveCamera(34, innerWidth / innerHeight, 0.1, 2500);
camera.position.set(-6, 5, 64);

const profile = buildProfile();
const sim = new StuntSim(profile);
const ramp = buildRamp(profile, renderer);
scene.add(ramp.group);
const env = buildEnvironment(scene, { sim, renderer });
const car = buildCar({ jets: true });
scene.add(car.root);
const smoke = new Smoke(sim, NOZZLES, env);
scene.add(smoke.mesh);

// soft contact shadow under the hero car
const contact = new THREE.Mesh(
  new THREE.PlaneGeometry(2.7, 5.4),
  new THREE.MeshBasicMaterial({ map: makeGlowTexture(), color: 0x000000, transparent: true, opacity: 0.8, depthWrite: false })
);
contact.rotation.x = -Math.PI / 2;
contact.renderOrder = 1;
scene.add(contact);

const rigs = new Rigs(sim);
const director = new Director(sim);
const post = createPost(renderer, scene, camera);
post.setSize(innerWidth, innerHeight);

const controls = new OrbitControls(camera, canvas);
controls.enabled = false;
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.495;
controls.minDistance = 3;
controls.maxDistance = 260;

// ---------------------------------------------------------------- state
const DEFAULT_LEVELS = { strip: 1, flood: 1, bleach: 0 };
const state = { mode: 'director', cam: 'wide', simT: 0, playing: true, speed: 1, hud: true, dirCam: 'rear' };
const st = sim.makeState();
const lastTarget = new THREE.Vector3(0, 8, 0);
const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpC = new THREE.Vector3();

// ---------------------------------------------------------------- UI
const camBar = $('cams');
const camButtons = {};
for (const c of [{ id: 'director', label: 'Director cut' }, ...CAMS]) {
  const b = document.createElement('button');
  b.textContent = c.label;
  b.dataset.id = c.id;
  if (c.id === 'director') b.classList.add('primary');
  b.addEventListener('click', () => selectCam(c.id));
  camBar.appendChild(b);
  camButtons[c.id] = b;
}

function refreshButtons() {
  const active = state.mode === 'director' ? 'director' : state.cam;
  for (const [id, b] of Object.entries(camButtons)) b.classList.toggle('on', id === active);
  $('b-play').textContent = state.playing ? '❚❚' : '▶';
  document.querySelectorAll('#speeds button').forEach((b) => b.classList.toggle('on', +b.dataset.s === state.speed));
  document.body.classList.toggle('directing', state.mode === 'director');
}

function selectCam(id) {
  if (id === 'director') {
    state.mode = 'director';
    director.reset();
  } else {
    state.mode = 'manual';
    state.cam = id;
  }
  controls.enabled = id === 'free';
  if (id === 'free') {
    controls.target.copy(lastTarget);
    controls.update();
  }
  refreshButtons();
}

$('b-play').addEventListener('click', () => { state.playing = !state.playing; refreshButtons(); });
$('b-restart').addEventListener('click', restart);
function restart() {
  state.simT = 0;
  director.reset();
  state.playing = true;
  refreshButtons();
}
document.querySelectorAll('#speeds button').forEach((b) =>
  b.addEventListener('click', () => {
    state.speed = +b.dataset.s;
    if (state.mode === 'director') selectCam(state.dirCam);
    refreshButtons();
  })
);

// timeline with phase marks
const track = $('track');
const marks = [
  { t: sim.tGo, label: 'Go' }, { t: sim.tRamp, label: 'Climb' }, { t: sim.tExit, label: 'Eject' },
  { t: sim.tBurn, label: 'Retro' },
];
const TL_END = sim.T - 0.3;
for (const m of marks) {
  const el = document.createElement('div');
  el.className = 'mark';
  el.style.left = `${(m.t / TL_END) * 100}%`;
  el.innerHTML = `<span>${m.label}</span>`;
  $('marks').appendChild(el);
}
let scrubbing = false;
const scrubTo = (e) => {
  const r = track.getBoundingClientRect();
  const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  state.simT = f * TL_END;
};
track.addEventListener('pointerdown', (e) => {
  scrubbing = true;
  track.setPointerCapture(e.pointerId);
  if (state.mode === 'director') selectCam(state.dirCam);
  scrubTo(e);
});
track.addEventListener('pointermove', (e) => scrubbing && scrubTo(e));
track.addEventListener('pointerup', () => { scrubbing = false; });

$('b-hud').addEventListener('click', toggleHud);
$('b-showhud').addEventListener('click', toggleHud);
function toggleHud() {
  state.hud = !state.hud;
  document.body.classList.toggle('nohud', !state.hud);
}

// recording (WebM of one full director cycle; bars + fades are baked in by the post pass)
let recorder = null, chunks = [];
$('b-rec').addEventListener('click', () => (recorder ? stopRec() : startRec()));
function startRec() {
  const types = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
  const mimeType = types.find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t));
  if (!mimeType) { flash('Recording not supported in this browser'); return; }
  chunks = [];
  recorder = new MediaRecorder(canvas.captureStream(60), { mimeType, videoBitsPerSecond: 18e6 });
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  recorder.onstop = () => {
    const blob = new Blob(chunks, { type: mimeType.split(';')[0] });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ramp-drop.${mimeType.includes('mp4') ? 'mp4' : 'webm'}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    recorder = null;
    $('b-rec').classList.remove('live');
    $('b-rec').textContent = '● Rec';
  };
  selectCam('director');
  state.playing = true;
  refreshButtons();
  recorder.start(250);
  $('b-rec').classList.add('live');
  $('b-rec').textContent = '■ Stop';
}
function stopRec() { if (recorder && recorder.state !== 'inactive') recorder.stop(); }

function flash(msg) {
  const c = $('caption');
  c.querySelector('.txt').textContent = msg;
  c.classList.remove('show'); void c.offsetWidth; c.classList.add('show');
}

window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  const k = e.key.toLowerCase();
  if (k === ' ') { state.playing = !state.playing; refreshButtons(); e.preventDefault(); }
  else if (k === 'r') restart();
  else if (k === 'h') toggleHud();
  else if (k === 'd' || k === '0') selectCam('director');
  else if (/^[1-8]$/.test(k)) selectCam(CAMS[+k - 1].id);
  else if (k === 'arrowright') { if (state.mode === 'director') selectCam(state.dirCam); state.simT = Math.min(TL_END, state.simT + 0.25); }
  else if (k === 'arrowleft') { if (state.mode === 'director') selectCam(state.dirCam); state.simT = Math.max(0, state.simT - 0.25); }
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight, false);
  post.setSize(innerWidth, innerHeight);
});

// ---------------------------------------------------------------- HUD
const hud = {
  phase: $('t-phase'), speed: $('t-speed'), alt: $('t-alt'), pitch: $('t-pitch'), roll: $('t-roll'), g: $('t-g'),
  time: $('t-time'), fill: $('fill'), head: $('head'), fps: $('t-fps'),
  main: [0, 1, 2, 3].map((i) => $(`m${i}`)), side: [0, 1, 2, 3].map((i) => $(`s${i}`)),
};
let lastCaption = '', fpsAcc = 0, fpsN = 0, hudTick = 0;

function updateHud(dt) {
  fpsAcc += dt; fpsN++;
  if (fpsAcc > 0.5) { hud.fps.textContent = `${Math.round(fpsN / fpsAcc)} fps`; fpsAcc = 0; fpsN = 0; }
  if (hudTick++ % 2) return;
  hud.phase.textContent = PHASES[st.phase];
  document.body.dataset.phase = st.phase;
  hud.speed.textContent = Math.round(st.speed * 3.6);
  hud.alt.textContent = st.alt.toFixed(1);
  let pitch = st.headDeg;
  if (st.rollDeg > 90) pitch = 180 - pitch;
  hud.pitch.textContent = Math.round(pitch);
  hud.roll.textContent = Math.round(st.rollDeg);
  hud.g.textContent = st.g.toFixed(2);
  hud.time.textContent = state.simT.toFixed(2);
  const f = Math.min(1, state.simT / TL_END) * 100;
  hud.fill.style.width = `${f}%`;
  hud.head.style.left = `${f}%`;
  hud.main.forEach((el) => { el.style.opacity = 0.18 + 0.82 * st.main; el.classList.toggle('on', st.main > 0.05); });
  hud.side.forEach((el, i) => { el.style.opacity = 0.18 + 0.82 * st.side[i]; el.classList.toggle('on', st.side[i] > 0.05); });
}

// Rigs are framed for a ~16:10 screen; on narrower screens keep the same horizontal coverage.
const FRAME_ASPECT = 1.6;
function fitFov(fov, aspect) {
  if (aspect >= FRAME_ASPECT) return fov;
  const h = Math.atan(Math.tan(THREE.MathUtils.degToRad(fov) / 2) * FRAME_ASPECT);
  return Math.min(110, THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(h) / aspect)));
}

// ---------------------------------------------------------------- loop
let last = performance.now();
let lb = 0;
let firstFrame = true;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  let camName, fade = 0, levels = DEFAULT_LEVELS, u = now / 1000;
  if (state.mode === 'director') {
    if (state.playing) director.update(dt);
    const d = director.state();
    state.simT = d.simT;
    camName = d.cam;
    state.dirCam = d.cam;
    fade = d.fade;
    u = d.u;
    if (d.show) levels = lightShow(d.u);
    if (d.label !== lastCaption) {
      lastCaption = d.label;
      flash(d.label);
    }
    if (recorder && director.cycles >= 1) stopRec();
  } else {
    if (state.playing && !scrubbing) {
      state.simT += dt * state.speed;
      if (state.simT > TL_END) state.simT = 0;
    }
    camName = state.cam;
    lastCaption = '';
  }

  sim.sample(state.simT, st);
  car.update(st, state.simT);
  if (env.levels !== levels) env.update(levels);

  // contact shadow
  const grounded = 1 - smoothstep(0.05, 3.5, st.pos.y);
  contact.visible = grounded > 0.01;
  contact.position.set(st.pos.x, 0.015, st.pos.z);
  contact.rotation.z = Math.PI / 2 + st.yaw;
  contact.material.opacity = 0.85 * grounded;

  // camera
  if (camName === 'free') {
    controls.update();
  } else {
    const r = rigs.get(camName, state.simT, u);
    camera.position.copy(r.pos);
    camera.lookAt(r.target);
    lastTarget.copy(r.target);
    const fov = fitFov(r.fov, camera.aspect);
    if (camera.fov !== fov) { camera.fov = fov; camera.updateProjectionMatrix(); }
  }

  // smoke lighting inputs
  car.jetLight.getWorldPosition(tmpA);
  car.spot.getWorldPosition(tmpB);
  car.spot.target.getWorldPosition(tmpC);
  tmpC.sub(tmpB).normalize();
  smoke.update(state.simT, camera.position, tmpA, st.main, tmpB, tmpC, levels);

  const lbTarget = state.mode === 'director' && camera.aspect > 1.2 ? Math.max(0, (1 - camera.aspect / 2.39) / 2) : 0;
  lb += (lbTarget - lb) * (1 - Math.exp(-dt * 6));
  post.render(now / 1000, lb, fade);
  updateHud(dt);

  if (firstFrame) {
    firstFrame = false;
    $('loading').classList.add('done');
  }
}

refreshButtons();
requestAnimationFrame(frame);
