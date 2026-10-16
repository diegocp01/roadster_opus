import * as THREE from 'three';
import { mulberry32 } from './util.js';
import { makeSmokeAtlas } from './textures.js';

// GPU smoke: every puff is spawned up-front from the deterministic stunt, and its whole life
// (drag, buoyancy, growth, fade, lighting) is evaluated in the vertex shader from sim time.
const vert = /* glsl */ `
attribute vec4 aA; // spawn, life, drag, rise
attribute vec3 aO; // origin
attribute vec3 aV; // initial velocity
attribute vec4 aB; // size0, size1, growth, alpha
attribute vec2 aC; // seed, kind
uniform float uTime;
uniform vec3 uWind;
uniform vec3 uCamPos;
uniform vec3 uJetPos; uniform float uJetI;
uniform vec3 uFloodA; uniform vec3 uFloodB; uniform float uFloodI;
uniform float uStripI; uniform float uStripZ; uniform float uStripX0; uniform float uStripX1;
uniform vec3 uHeadPos; uniform vec3 uHeadDir; uniform float uHeadI;
uniform vec3 uKeyPos; uniform float uKeyI;
varying vec2 vUv; varying float vAlpha; varying vec3 vCol; varying float vCell;

float phaseF(vec3 lp, vec3 p, vec3 toCam){
  vec3 d = normalize(p - lp);
  float c = max(dot(d, toCam), 0.0);
  return 0.45 + 2.2 * pow(c, 5.0);
}

void main(){
  float age = uTime - aA.x;
  if (age < 0.0 || age > aA.y) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vAlpha = 0.0; vCol = vec3(0.0); vUv = vec2(0.0); vCell = 0.0;
    return;
  }
  float k = aA.z;
  vec3 p = aO + aV * ((1.0 - exp(-k * age)) / k);
  p.y += aA.w * age;
  p += uWind * age;
  float size = mix(aB.x, aB.y, 1.0 - exp(-aB.z * age));
  p.y = max(p.y, size * (aC.y < 0.5 ? 0.3 : 0.18));
  float l01 = age / aA.y;
  vAlpha = aB.w * smoothstep(0.0, 0.1, age) * (1.0 - smoothstep(0.3, 1.0, l01));

  vec3 toCam = normalize(uCamPos - p);
  vec3 L = vec3(0.035, 0.04, 0.05);
  float dj = distance(p, uJetPos);
  L += vec3(0.55, 0.78, 1.0) * uJetI * 2.2 / (1.0 + dj * dj * 0.35);
  float da = distance(p, uFloodA), db = distance(p, uFloodB);
  L += vec3(1.0, 0.96, 0.9) * uFloodI * (phaseF(uFloodA, p, toCam) * 30.0 / (1.0 + da * da)
                                        + phaseF(uFloodB, p, toCam) * 30.0 / (1.0 + db * db));
  float sx = (1.0 - smoothstep(uStripX1 - 2.0, uStripX1 + 2.0, p.x)) * smoothstep(uStripX0 - 4.0, uStripX0 + 4.0, p.x);
  L += vec3(1.0, 0.05, 0.04) * uStripI * 0.22 * sx * exp(-abs(p.z - uStripZ) * 0.16) * exp(-p.y * 0.12);
  vec3 dh = p - uHeadPos; float dd = max(length(dh), 0.001);
  float cone = smoothstep(0.82, 0.97, dot(dh / dd, uHeadDir));
  L += vec3(1.0, 0.98, 0.94) * uHeadI * cone * 8.0 / (1.0 + dd * dd * 0.35)
       * (0.6 + 1.2 * pow(max(dot(dh / dd, toCam), 0.0), 4.0));
  float dk = distance(p, uKeyPos);
  L += vec3(0.95, 0.97, 1.0) * uKeyI * phaseF(uKeyPos, p, toCam) * 90.0 / (1.0 + dk * dk);
  // cheap self-shadowing: puffs that stayed in the dense core or hug the ground are darker
  float spread = smoothstep(0.0, 7.0, length(p.xz - aO.xz));
  L *= (0.55 + 0.45 * spread) * (0.7 + 0.3 * smoothstep(0.0, 4.0, p.y));
  vCol = L;

  vec4 mv = viewMatrix * vec4(p, 1.0);
  float ang = aC.x * 6.2831 + age * (fract(aC.x * 7.31) - 0.5) * 0.5;
  float cs = cos(ang), sn = sin(ang);
  vec2 c = vec2(cs * position.x - sn * position.y, sn * position.x + cs * position.y);
  mv.xy += c * size;
  gl_Position = projectionMatrix * mv;
  vUv = uv;
  vCell = floor(fract(aC.x * 13.71) * 4.0);
}`;

const frag = /* glsl */ `
uniform sampler2D uTex;
varying vec2 vUv; varying float vAlpha; varying vec3 vCol; varying float vCell;
void main(){
  vec2 cell = vec2(mod(vCell, 2.0), floor(vCell * 0.5));
  vec4 t = texture2D(uTex, (vUv + cell) * 0.5);
  float a = t.a * vAlpha;
  if (a < 0.002) discard;
  gl_FragColor = vec4(vCol * (0.35 + 0.9 * t.r), a);
}`;

export class Smoke {
  constructor(sim, nozzles, env) {
    const parts = emit(sim, nozzles);
    const n = parts.length;
    this.count = n;
    const geo = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    geo.index = quad.index;
    geo.setAttribute('position', quad.attributes.position);
    geo.setAttribute('uv', quad.attributes.uv);
    const A = new Float32Array(n * 4), O = new Float32Array(n * 3), V = new Float32Array(n * 3);
    const B = new Float32Array(n * 4), C = new Float32Array(n * 2);
    parts.forEach((p, i) => {
      A.set([p.spawn, p.life, p.drag, p.rise], i * 4);
      O.set([p.ox, p.oy, p.oz], i * 3);
      V.set([p.vx, p.vy, p.vz], i * 3);
      B.set([p.s0, p.s1, p.grow, p.alpha], i * 4);
      C.set([p.seed, p.kind], i * 2);
    });
    geo.setAttribute('aA', new THREE.InstancedBufferAttribute(A, 4));
    geo.setAttribute('aO', new THREE.InstancedBufferAttribute(O, 3));
    geo.setAttribute('aV', new THREE.InstancedBufferAttribute(V, 3));
    geo.setAttribute('aB', new THREE.InstancedBufferAttribute(B, 4));
    geo.setAttribute('aC', new THREE.InstancedBufferAttribute(C, 2));
    geo.instanceCount = n;

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTex: { value: makeSmokeAtlas() },
        uTime: { value: 0 },
        uWind: { value: new THREE.Vector3(0.35, 0, 0.22) },
        uCamPos: { value: new THREE.Vector3() },
        uJetPos: { value: new THREE.Vector3() }, uJetI: { value: 0 },
        uFloodA: { value: env.floodPos[0].clone() }, uFloodB: { value: env.floodPos[1].clone() }, uFloodI: { value: 1 },
        uStripI: { value: 1 }, uStripZ: { value: env.stripZ }, uStripX0: { value: env.stripX0 }, uStripX1: { value: env.stripX1 },
        uHeadPos: { value: new THREE.Vector3() }, uHeadDir: { value: new THREE.Vector3(1, 0, 0) }, uHeadI: { value: 1 },
        uKeyPos: { value: env.keyPos.clone() }, uKeyI: { value: 1 },
      },
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
  }

  update(t, camPos, jetPos, jetI, headPos, headDir, levels) {
    const u = this.material.uniforms;
    u.uTime.value = t;
    u.uCamPos.value.copy(camPos);
    u.uJetPos.value.copy(jetPos);
    u.uJetI.value = jetI;
    u.uHeadPos.value.copy(headPos);
    u.uHeadDir.value.copy(headDir);
    u.uFloodI.value = levels.flood;
    u.uStripI.value = levels.strip;
  }
}

function emit(sim, nozzles) {
  const rnd = mulberry32(1337);
  const P = [];
  const st = sim.makeState(), st2 = sim.makeState();
  const dtE = 1 / 120;
  const t0 = sim.tExit, t1 = sim.tTd + 0.6;
  const accG = [0, 0, 0, 0], accJ = [0, 0, 0, 0], accS = [0, 0, 0, 0];
  const nz = new THREE.Vector3(), dir = new THREE.Vector3(), vel = new THREE.Vector3();
  const REACH = 13;

  for (let t = t0; t < t1; t += dtE) {
    sim.sample(t, st);
    sim.sample(t + dtE, st2);
    vel.subVectors(st2.pos, st.pos).multiplyScalar(1 / dtE);
    const c = st.pos;

    for (let k = 0; k < 4; k++) {
      const I = st.main;
      if (I < 0.02) continue;
      nz.copy(nozzles.main[k].pos).applyQuaternion(st.quat).add(c);
      dir.copy(nozzles.main[k].dir).applyQuaternion(st.quat);
      const h = Math.max(0, nz.y);
      if (h < REACH) {
        const prox = Math.pow(1 - h / REACH, 1.3);
        accG[k] += I * (40 + 440 * prox) * dtE;
        while (accG[k] >= 1) {
          accG[k] -= 1;
          const ang = Math.atan2(nz.z - c.z, nz.x - c.x) + (rnd() - 0.5) * 2.6;
          const sp = (3 + 16 * rnd()) * (0.35 + 0.65 * prox) * (0.6 + 0.4 * I);
          const big = rnd();
          P.push({
            spawn: t + rnd() * dtE, life: 7 + 7 * rnd(), drag: 0.9 + 1.4 * rnd(), rise: 0.08 + 0.3 * rnd() * rnd(),
            ox: nz.x + (rnd() - 0.5) * 0.6, oy: 0.2 + 0.3 * rnd(), oz: nz.z + (rnd() - 0.5) * 0.6,
            vx: Math.cos(ang) * sp, vy: (0.2 + 1.5 * rnd()) * (0.5 + 0.5 * prox), vz: Math.sin(ang) * sp,
            s0: 0.6 + 0.8 * rnd(), s1: (2.6 + 4.2 * big * big) * (0.65 + 0.35 * prox), grow: 0.35 + 0.5 * rnd(),
            alpha: 0.16 + 0.24 * rnd(), seed: rnd(), kind: 0,
          });
        }
      }
      // misty column riding down the jet
      accJ[k] += I * 26 * dtE;
      while (accJ[k] >= 1) {
        accJ[k] -= 1;
        const sp = 14 + 10 * rnd();
        P.push({
          spawn: t + rnd() * dtE, life: 1.0 + 0.8 * rnd(), drag: 2.2, rise: 0.2,
          ox: nz.x + dir.x * 0.6, oy: nz.y + dir.y * 0.6, oz: nz.z + dir.z * 0.6,
          vx: dir.x * sp + vel.x + (rnd() - 0.5), vy: dir.y * sp + vel.y, vz: dir.z * sp + vel.z + (rnd() - 0.5),
          s0: 0.25, s1: 1.6 + rnd(), grow: 1.5, alpha: 0.1 + 0.06 * rnd(), seed: rnd(), kind: 1,
        });
      }
    }

    for (let k = 0; k < 4; k++) {
      const I = st.side[k];
      if (I < 0.05) continue;
      nz.copy(nozzles.side[k].pos).applyQuaternion(st.quat).add(c);
      dir.copy(nozzles.side[k].dir).applyQuaternion(st.quat);
      accS[k] += I * 140 * dtE;
      while (accS[k] >= 1) {
        accS[k] -= 1;
        const sp = 16 + 10 * rnd();
        P.push({
          spawn: t + rnd() * dtE, life: 1.4 + 1.0 * rnd(), drag: 1.6 + rnd(), rise: 0.1,
          ox: nz.x + dir.x * 0.4, oy: nz.y + dir.y * 0.4, oz: nz.z + dir.z * 0.4,
          vx: dir.x * sp + vel.x, vy: dir.y * sp + vel.y, vz: dir.z * sp + vel.z,
          s0: 0.35, s1: 1.8 + 1.4 * rnd(), grow: 1.1, alpha: 0.07 + 0.05 * rnd(), seed: rnd(), kind: 1,
        });
      }
    }
  }
  return P;
}
