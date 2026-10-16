import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeGlowTexture } from './textures.js';
import { smoothstep, clamp, ledRed } from './util.js';

// Car local frame: +Z forward, +Y up, +X = left side. Origin = tyre contact plane, mid-wheelbase.
export const NOZZLES = {
  main: [
    { pos: new THREE.Vector3(0.62, 0.22, 1.92), dir: new THREE.Vector3(0, -1, 0) },
    { pos: new THREE.Vector3(-0.62, 0.22, 1.92), dir: new THREE.Vector3(0, -1, 0) },
    { pos: new THREE.Vector3(0.62, 0.22, -1.9), dir: new THREE.Vector3(0, -1, 0) },
    { pos: new THREE.Vector3(-0.62, 0.22, -1.9), dir: new THREE.Vector3(0, -1, 0) },
  ],
  // LF, LR, RF, RR — fender-mounted roll / attitude thrusters
  side: [
    { pos: new THREE.Vector3(0.9, 0.64, 1.5), dir: new THREE.Vector3(1, 0.12, 0).normalize() },
    { pos: new THREE.Vector3(0.92, 0.66, -1.5), dir: new THREE.Vector3(1, 0.12, 0).normalize() },
    { pos: new THREE.Vector3(-0.9, 0.64, 1.5), dir: new THREE.Vector3(-1, 0.12, 0).normalize() },
    { pos: new THREE.Vector3(-0.92, 0.66, -1.5), dir: new THREE.Vector3(-1, 0.12, 0).normalize() },
  ],
};

const WHEELS = [
  { x: 0.84, z: 1.38, side: 1 }, { x: -0.84, z: 1.38, side: -1 },
  { x: 0.84, z: -1.37, side: 1 }, { x: -0.84, z: -1.37, side: -1 },
];

let SHARED = null;
function shared() {
  if (SHARED) return SHARED;
  const glow = makeGlowTexture();
  SHARED = {
    glow,
    paint: new THREE.MeshPhysicalMaterial({
      color: 0xf1f2f4, roughness: 0.32, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.12, vertexColors: true,
    }),
    glass: new THREE.MeshPhysicalMaterial({
      color: 0x050608, roughness: 0.1, metalness: 0.5, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.6,
    }),
    black: new THREE.MeshStandardMaterial({ color: 0x0a0b0d, roughness: 0.55, metalness: 0.25 }),
    tire: new THREE.MeshStandardMaterial({ color: 0x0c0c0d, roughness: 0.92, metalness: 0 }),
    rim: new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.28, metalness: 0.9 }),
    rimFace: new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.35, metalness: 0.7 }),
    nozzle: new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.4, metalness: 0.9 }),
    head: new THREE.MeshBasicMaterial({ color: new THREE.Color(7, 7.3, 8) }),
    tail: new THREE.MeshBasicMaterial({ color: new THREE.Color(...ledRed(7)) }),
    bodyGeo: makeBodyGeometry(),
    canopyGeo: makeCanopyGeometry(),
    wheelGeo: makeWheelGeometries(),
    jetGeo: {
      mainCore: new THREE.CylinderGeometry(0.045, 0.2, 1, 16, 40, true).translate(0, -0.5, 0),
      mainSheath: new THREE.CylinderGeometry(0.09, 0.62, 1, 16, 40, true).translate(0, -0.5, 0),
      sideCore: new THREE.CylinderGeometry(0.03, 0.14, 1, 12, 30, true).translate(0, -0.5, 0),
      sideSheath: new THREE.CylinderGeometry(0.06, 0.45, 1, 12, 30, true).translate(0, -0.5, 0),
    },
  };
  return SHARED;
}

// ---------- body shell: side profile extruded across the width, then sculpted ----------
function makeBodyGeometry() {
  const s = new THREE.Shape();
  s.moveTo(-2.1, 0.3);
  s.lineTo(-2.16, 0.5);
  s.quadraticCurveTo(-2.19, 0.7, -2.02, 0.76);
  s.lineTo(-1.3, 0.8);
  s.quadraticCurveTo(-0.2, 0.86, 0.95, 0.77);
  s.quadraticCurveTo(1.75, 0.68, 2.08, 0.5);
  s.quadraticCurveTo(2.2, 0.42, 2.12, 0.3);
  s.lineTo(1.98, 0.24);
  const ra = 0.52, a0 = -0.28;
  s.absarc(1.38, 0.36, ra, a0, Math.PI - a0, false);
  s.absarc(-1.37, 0.36, ra, a0, Math.PI - a0, false);
  s.lineTo(-2.0, 0.24);
  s.lineTo(-2.1, 0.3);

  let g = new THREE.ExtrudeGeometry(s, {
    depth: 1.76, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.08, bevelSegments: 6, curveSegments: 28, steps: 1,
  });
  g.translate(0, 0, -0.88);
  g.rotateY(-Math.PI / 2); // shape X -> car Z, extrusion -> car X

  const p = g.attributes.position;
  const col = new Float32Array(p.count * 3).fill(1);
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), z = p.getZ(i);
    let x = p.getX(i);
    const tumble = 1 - 0.14 * smoothstep(0.48, 0.88, y);
    const front = 1 - 0.17 * smoothstep(1.7, 2.35, z);
    const rear = 1 - 0.07 * smoothstep(-1.75, -2.3, z);
    const tuck = 1 - 0.06 * (1 - smoothstep(0.22, 0.46, y));
    const hips = 1 + 0.025 * Math.exp(-((z + 1.37) * (z + 1.37)) / 0.35) * smoothstep(0.35, 0.6, y);
    x *= tumble * front * rear * tuck * hips;
    p.setX(i, x);
  }
  // darken arch liners + underside on the extruded walls (group 1)
  for (const grp of g.groups) {
    if (grp.materialIndex !== 1) continue;
    for (let i = grp.start; i < grp.start + grp.count; i++) {
      const y = p.getY(i), z = p.getZ(i);
      let dark = y < 0.255;
      for (const cz of [1.38, -1.37]) {
        if (Math.hypot(z - cz, y - 0.36) < 0.64 && y < 0.95) dark = true;
      }
      if (dark) col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = 0.035;
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g.clearGroups();
  g = mergeVertices(g, 1e-4);
  g.computeVertexNormals();
  return g;
}

function makeCanopyGeometry() {
  const s = new THREE.Shape();
  s.moveTo(-1.55, 0.74);
  s.quadraticCurveTo(-0.85, 1.06, 0.05, 1.1);
  s.quadraticCurveTo(0.55, 1.1, 1.1, 0.76);
  s.lineTo(-1.55, 0.74);
  let g = new THREE.ExtrudeGeometry(s, {
    depth: 1.0, bevelEnabled: true, bevelThickness: 0.16, bevelSize: 0.05, bevelSegments: 6, curveSegments: 24,
  });
  g.translate(0, 0, -0.5);
  g.rotateY(-Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), z = p.getZ(i);
    const k = (1 - 0.35 * smoothstep(0.78, 1.12, y)) * (1 - 0.62 * smoothstep(-0.2, -1.6, z)) * (1 - 0.18 * smoothstep(0.4, 1.15, z));
    p.setX(i, p.getX(i) * k);
  }
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g.clearGroups();
  g = mergeVertices(g, 1e-4);
  g.computeVertexNormals();
  return g;
}

function makeWheelGeometries() {
  const prof = [
    [0.24, -0.15], [0.31, -0.155], [0.35, -0.14], [0.364, -0.08], [0.367, 0], [0.364, 0.08], [0.35, 0.14], [0.31, 0.155], [0.24, 0.15],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const tire = new THREE.LatheGeometry(prof, 44).rotateZ(Math.PI / 2);
  const rim = new THREE.CylinderGeometry(0.245, 0.245, 0.27, 36, 1, true).rotateZ(Math.PI / 2);
  const face = new THREE.CylinderGeometry(0.24, 0.24, 0.02, 36).rotateZ(Math.PI / 2).translate(0.13, 0, 0);
  const spoke = new THREE.BoxGeometry(0.03, 0.2, 0.05).translate(0.145, 0.11, 0);
  const hub = new THREE.CylinderGeometry(0.05, 0.05, 0.04, 16).rotateZ(Math.PI / 2).translate(0.15, 0, 0);
  return { tire, rim, face, spoke, hub };
}

function makeWheel(S, side) {
  const g = new THREE.Group();
  const spin = new THREE.Group();
  g.add(spin);
  const tire = new THREE.Mesh(S.wheelGeo.tire, S.tire);
  const rim = new THREE.Mesh(S.wheelGeo.rim, S.rim);
  const face = new THREE.Mesh(S.wheelGeo.face, S.rimFace);
  const hub = new THREE.Mesh(S.wheelGeo.hub, S.rim);
  tire.castShadow = true;
  spin.add(tire, rim, face, hub);
  for (let k = 0; k < 6; k++) {
    const sp = new THREE.Mesh(S.wheelGeo.spoke, S.rim);
    sp.rotation.x = (k / 6) * Math.PI * 2;
    spin.add(sp);
  }
  if (side < 0) g.rotation.y = Math.PI;
  return { g, spin, side };
}

// ---------- cold-gas jet plume ----------
const jetVert = /* glsl */ `
varying vec2 vUv; varying vec3 vN; varying vec3 vV;
void main(){
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;
const jetFrag = /* glsl */ `
uniform float uTime; uniform float uI; uniform float uLen; uniform float uSharp; uniform float uSeed;
uniform vec3 uColor; uniform float uGain;
varying vec2 vUv; varying vec3 vN; varying vec3 vV;
float h1(float n){ return fract(sin(n) * 43758.5453); }
float n1(float x){ float i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(h1(i), h1(i + 1.0), f); }
void main(){
  float a = 1.0 - vUv.y;                       // 0 at nozzle -> 1 at tip
  float facing = abs(dot(normalize(vN), normalize(vV)));
  float core = pow(facing, uSharp);
  float fall = pow(1.0 - a, 1.35) * smoothstep(0.0, 0.03, a + 0.01);
  float turb = n1(a * uLen * 2.5 - uTime * 38.0 + uSeed * 10.0) * 0.6
             + n1(a * uLen * 6.0 - uTime * 71.0 + vUv.x * 12.0 + uSeed) * 0.4;
  float diamonds = pow(0.5 + 0.5 * cos(a * uLen * 9.0), 6.0) * exp(-a * 2.5);
  float I = uI * core * fall * (0.55 + 0.6 * turb) * (1.0 + 1.6 * diamonds);
  vec3 col = mix(uColor, vec3(1.0), clamp(core * pow(1.0 - a, 3.0) * 1.4 - 0.25, 0.0, 1.0));
  gl_FragColor = vec4(col * I * uGain, 1.0);
}`;

function jetMaterial(sharp, gain, color, seed) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 }, uI: { value: 0 }, uLen: { value: 1 }, uSharp: { value: sharp }, uSeed: { value: seed },
      uColor: { value: new THREE.Color(...color) }, uGain: { value: gain },
    },
    vertexShader: jetVert, fragmentShader: jetFrag,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}

class Jet {
  constructor(parent, nozzle, kind, seed, S) {
    this.nozzle = nozzle;
    this.maxLen = kind === 'main' ? 7.5 : 4.6;
    this.g = new THREE.Group();
    this.g.position.copy(nozzle.pos);
    this.g.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), nozzle.dir);
    const geo = S.jetGeo;
    this.core = new THREE.Mesh(kind === 'main' ? geo.mainCore : geo.sideCore, jetMaterial(2.4, kind === 'main' ? 5.0 : 3.6, [0.45, 0.74, 1.0], seed));
    this.sheath = new THREE.Mesh(kind === 'main' ? geo.mainSheath : geo.sideSheath, jetMaterial(1.1, 1.2, [0.25, 0.55, 1.0], seed + 3.1));
    this.core.renderOrder = 3; this.sheath.renderOrder = 3;
    this.core.frustumCulled = false; this.sheath.frustumCulled = false;
    this.stretch = new THREE.Group();
    this.stretch.add(this.core, this.sheath);
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: S.glow, color: new THREE.Color(2.2, 3.2, 4.5), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
    }));
    this.glow.renderOrder = 3;
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.08, 14), S.nozzle);
    ring.position.y = 0.02;
    this.g.add(this.stretch, this.glow, ring);
    parent.add(this.g);
    this.kind = kind;
  }
  set(I, len, t) {
    const on = I > 0.01;
    this.stretch.visible = on;
    this.glow.visible = on;
    if (!on) return;
    this.stretch.scale.set(0.75 + 0.25 * I, Math.max(0.05, len), 0.75 + 0.25 * I);
    for (const m of [this.core.material, this.sheath.material]) {
      m.uniforms.uI.value = I;
      m.uniforms.uLen.value = len;
      m.uniforms.uTime.value = t;
    }
    const gs = (this.kind === 'main' ? 1.1 : 0.7) * (0.4 + 0.6 * I);
    this.glow.scale.set(gs, gs, gs);
  }
}

const _v = new THREE.Vector3(), _d = new THREE.Vector3();

export function buildCar(opts = {}) {
  const { jets = true, headSpot = true, headIntensity = 140 } = opts;
  const S = shared();
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const shell = new THREE.Mesh(S.bodyGeo, S.paint);
  shell.castShadow = true; shell.receiveShadow = true;
  const canopy = new THREE.Mesh(S.canopyGeo, S.glass);
  canopy.castShadow = true;
  body.add(shell, canopy);

  const box = (w, h, d, x, y, z, mat = S.black) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    body.add(m);
    return m;
  };
  box(1.62, 0.07, 3.9, 0, 0.215, 0);                          // flat undertray
  for (const sx of [-1, 1]) box(0.07, 0.13, 1.66, sx * 0.94, 0.3, 0.0); // side skirts
  box(1.36, 0.27, 0.32, 0, 0.335, -2.11);                      // black rear valance + diffuser
  for (let k = -2; k <= 2; k++) box(0.025, 0.13, 0.36, k * 0.22, 0.26, -2.1);
  box(1.72, 0.045, 0.3, 0, 0.245, 1.98);                       // front splitter

  // full-width light bars
  const bar = (pts, r, mat) => {
    const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
    const m = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, r, 6, false), mat);
    body.add(m);
    return m;
  };
  const headPts = [], tailPts = [];
  for (let k = 0; k <= 12; k++) {
    const u = k / 12 * 2 - 1;
    headPts.push([u * 0.8, 0.54, 2.17 - 0.24 * u * u * u * u]);
    tailPts.push([u * 0.9, 0.7, -2.245 + 0.1 * u * u * u * u]);
  }
  bar(headPts, 0.022, S.head);
  bar(tailPts, 0.024, S.tail);

  const sprite = (color, scale, pos) => {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: S.glow, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
    }));
    sp.scale.setScalar(scale);
    sp.position.set(...pos);
    body.add(sp);
    return sp;
  };
  sprite(new THREE.Color(1.5, 1.55, 1.7), 0.75, [0.62, 0.55, 2.18]);
  sprite(new THREE.Color(1.5, 1.55, 1.7), 0.75, [-0.62, 0.55, 2.18]);
  sprite(new THREE.Color(1.2, 1.25, 1.4), 0.5, [0, 0.55, 2.24]);
  sprite(new THREE.Color(0.9, 0.02, 0.03), 0.6, [0.7, 0.7, -2.27]);
  sprite(new THREE.Color(0.9, 0.02, 0.03), 0.6, [-0.7, 0.7, -2.27]);

  // wheels
  const wheels = WHEELS.map((w) => {
    const wh = makeWheel(S, w.side);
    wh.g.position.set(w.x, 0.36, w.z);
    root.add(wh.g);
    return wh;
  });

  // lights
  let spot = null;
  if (headSpot) {
    spot = new THREE.SpotLight(0xf4f7ff, headIntensity, 80, 0.5, 0.7, 2);
    spot.position.set(0, 0.56, 2.1);
    spot.target.position.set(0, -0.6, 14);
    root.add(spot, spot.target);
  }

  const J = { main: [], side: [] };
  let jetLight = null;
  if (jets) {
    NOZZLES.main.forEach((nz, k) => J.main.push(new Jet(body, nz, 'main', k * 1.7, S)));
    NOZZLES.side.forEach((nz, k) => J.side.push(new Jet(body, nz, 'side', 7 + k * 2.3, S)));
    jetLight = new THREE.PointLight(0xa8d2ff, 0, 45, 2);
    root.add(jetLight);
  }

  function update(st, t) {
    root.position.copy(st.pos);
    root.quaternion.copy(st.quat);
    body.position.y = st.susp;
    body.rotation.x = st.pitchW;
    for (const w of wheels) w.spin.rotation.x = w.side * st.wheel;
    if (!jets) return;
    root.updateMatrixWorld(true);
    J.main.forEach((jet, k) => {
      const I = st.main * (0.92 + 0.08 * Math.sin(t * 53 + k * 1.7));
      _v.copy(jet.nozzle.pos).applyMatrix4(root.matrixWorld);
      _d.copy(jet.nozzle.dir).applyQuaternion(root.quaternion);
      let len = jet.maxLen * (0.55 + 0.45 * I);
      if (_d.y < -0.2) len = Math.min(len, _v.y / -_d.y + 0.15);
      jet.set(I, len, t);
    });
    J.side.forEach((jet, k) => {
      const I = st.side[k];
      jet.set(I, jet.maxLen * (0.45 + 0.55 * I), t + k);
    });
    jetLight.intensity = st.main * 260;
    jetLight.position.set(0, -clamp(st.alt * 0.45, 0.25, 3.5), 0);
  }

  return { root, body, wheels, spot, jetLight, update };
}
