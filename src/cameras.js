import * as THREE from 'three';
import { lerp, smoothstep } from './util.js';

const _v = new THREE.Vector3(), _w = new THREE.Vector3();

export const CAMS = [
  { id: 'rear', label: 'Low rear' },
  { id: 'wide', label: 'Wide track' },
  { id: 'dive', label: 'Overhead' },
  { id: 'hero', label: 'Low front' },
  { id: 'drone', label: 'Drone' },
  { id: 'iso', label: 'Aerial' },
  { id: 'chase', label: 'Chase' },
  { id: 'free', label: 'Free orbit' },
];

// Every rig is a pure function of sim time, so cuts, replays and scrubbing never pop.
export class Rigs {
  constructor(sim) {
    this.sim = sim;
    this.o = { pos: new THREE.Vector3(), target: new THREE.Vector3(), fov: 40 };
  }

  // Average of recent car positions = smooth, deterministic "camera operator" lag.
  lag(t, win, out) {
    out.set(0, 0, 0);
    const n = 7;
    for (let k = 0; k < n; k++) {
      this.sim.posAt(Math.max(0, t - (win * k) / (n - 1)), _w);
      out.add(_w);
    }
    return out.multiplyScalar(1 / n);
  }

  shake(t, out, k = 1) {
    const s = this.sim;
    let a = 0;
    if (t > s.tBurn && t < s.tTd) a += 0.05;
    if (t > s.tTd) a += 0.24 * Math.exp(-(t - s.tTd) * 3.2);
    a *= k;
    out.x += a * Math.sin(t * 41) * Math.sin(t * 13 + 1);
    out.y += a * Math.sin(t * 37 + 2);
    out.z += a * 0.5 * Math.sin(t * 29 + 4);
  }

  hand(u, out, amp) {
    out.x += amp * (Math.sin(u * 0.9) + 0.5 * Math.sin(u * 2.3 + 1.3));
    out.y += amp * (Math.sin(u * 1.1 + 2) + 0.4 * Math.sin(u * 2.9));
  }

  get(name, t, u = t) {
    const s = this.sim, o = this.o;
    switch (name) {
      case 'rear': {
        o.pos.set(s.S0 - 2.3 - 6.2, 1.05, 0.25);
        o.target.set(4, 2.6, 0);
        this.hand(u, o.target, 0.03);
        o.fov = 40;
        break;
      }
      case 'wide': {
        this.lag(t, 0.7, _v);
        o.pos.set(-6, 5.2, 64);
        const tx = -5 + Math.min(0, _v.x + 5) * 0.92;
        const ty = lerp(12.5, 4, smoothstep(s.tTd + 0.3, s.tTd + 4.5, t));
        o.target.set(tx, ty, _v.z * 0.4);
        this.shake(t, o.target, 0.5);
        this.hand(u, o.target, 0.04);
        o.fov = 33;
        break;
      }
      case 'dive': {
        this.lag(t, 0.25, _v);
        o.pos.set(-10, 47, 8);
        o.target.set(lerp(3, _v.x, 0.55), lerp(17, _v.y, 0.55), _v.z * 0.5);
        o.fov = 40;
        break;
      }
      case 'hero': {
        this.lag(t, 0.3, _v);
        o.pos.set(-31 + (t - s.tExit) * 0.25, 1.1, 3.2);
        o.target.copy(_v);
        o.target.y += 0.8;
        this.shake(t, o.target);
        o.fov = 24;
        break;
      }
      case 'drone': {
        this.lag(t, 0.5, _v);
        const k = smoothstep(s.tExit, s.tTd + 3, t);
        o.pos.set(lerp(4, -2, k), lerp(28, 20, k), lerp(7, 11, k));
        o.target.copy(_v);
        this.shake(t, o.target, 0.4);
        o.fov = 48;
        break;
      }
      case 'iso': {
        o.pos.set(-44 + t * 0.35, 52 - t * 0.25, 58 - t * 0.25);
        o.target.set(-8, 0, -6);
        o.fov = 36;
        break;
      }
      case 'chase': {
        this.lag(t, 0.9, _v);
        this.sim.posAt(t, _w);
        const k = smoothstep(s.tExit - 0.3, s.tTd + 0.5, t);
        o.pos.set(_v.x + lerp(-11, 11, k), Math.max(_v.y * 0.75, 0) + 3.2, _v.z + 6);
        o.target.copy(_w);
        o.target.y += 0.6;
        this.shake(t, o.target, 0.6);
        o.fov = 50;
        break;
      }
      default:
        break;
    }
    return o;
  }
}

// Edit decision list mirroring the reference: live wide run, then slow-motion replays, then an
// aerial pass where the stadium lights come up in sequence.
export class Director {
  constructor(sim) {
    const s = sim;
    this.shots = [
      { cam: 'rear', a: 0.0, b: 2.6, rate: 1, label: 'CAM 1 — LOW REAR' },
      { cam: 'wide', a: 2.6, b: s.tTd + 4.8, rate: 1, label: 'CAM 2 — WIDE TRACKING' },
      { cam: 'dive', a: s.tExit - 0.9, b: s.tExit + 2.1, rate: 0.42, label: 'REPLAY — OVERHEAD  0.42×', fade: true },
      { cam: 'hero', a: s.tExit + 1.2, b: s.tTd + 1.8, rate: 0.32, label: 'REPLAY — LOW FRONT  0.32×', fade: true },
      { cam: 'drone', a: s.tExit + 0.1, b: s.tTd + 2.6, rate: 0.6, label: 'REPLAY — DRONE  0.60×', fade: true },
      { cam: 'iso', a: 0.0, b: s.tTd + 5.5, rate: 1, label: 'CAM 4 — AERIAL', fade: true, show: true },
    ];
    for (const sh of this.shots) sh.dur = (sh.b - sh.a) / sh.rate;
    this.total = this.shots.reduce((a, sh) => a + sh.dur, 0);
    this.reset();
  }

  reset() {
    this.i = 0;
    this.u = 0;
    this.cycles = 0;
  }

  update(dt) {
    this.u += dt;
    while (this.u >= this.shots[this.i].dur) {
      this.u -= this.shots[this.i].dur;
      this.i = (this.i + 1) % this.shots.length;
      if (this.i === 0) this.cycles++;
    }
  }

  elapsed() {
    let e = 0;
    for (let k = 0; k < this.i; k++) e += this.shots[k].dur;
    return e + this.u;
  }

  state() {
    const sh = this.shots[this.i];
    const next = this.shots[(this.i + 1) % this.shots.length];
    let fade = 0;
    if (sh.fade) fade = Math.max(fade, 1 - smoothstep(0, 0.35, this.u));
    if (next.fade) fade = Math.max(fade, smoothstep(sh.dur - 0.25, sh.dur, this.u));
    return { cam: sh.cam, simT: sh.a + this.u * sh.rate, fade, label: sh.label, u: this.u, show: !!sh.show, rate: sh.rate };
  }
}

export function lightShow(u) {
  return {
    strip: smoothstep(0.8, 3.8, u),
    flood: u < 4.2 ? 0 : 1 + 1.4 * Math.exp(-(u - 4.2) * 6),
    bleach: smoothstep(4.8, 8.0, u),
  };
}
