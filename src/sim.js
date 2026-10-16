import * as THREE from 'three';
import { clamp, smoothstep, smootherstep, pulse } from './util.js';

export const G = 9.81;
export const WHEEL_R = 0.36;

export const PHASES = [
  'STANDBY', 'LAUNCH', 'CLIMB', 'EJECT', 'BARREL ROLL', 'FREEFALL', 'RETRO BURN', 'TOUCHDOWN', 'ROLLOUT',
];

// Side thruster stabilising puffs during the retro burn: [jet index, start time after burn ignition]
const PUFFS = [[0, 0.1], [3, 0.2], [1, 0.36], [2, 0.5], [0, 0.66], [3, 0.8], [2, 0.95], [1, 1.05]];

const _m = new THREE.Matrix4();
const _f = new THREE.Vector3(), _u = new THREE.Vector3(), _l = new THREE.Vector3();
const _qr = new THREE.Quaternion(), _qy = new THREE.Quaternion();
const AX_Z = new THREE.Vector3(0, 0, 1), AX_Y = new THREE.Vector3(0, 1, 0);

// Car frame: local +Z forward, +Y roof, +X left side.
// Heading alpha lives in the world XY plane (the ramp's plane), roll phi spins about the
// car's forward axis and yaw beta turns the whole car about world Y.
export function carQuat(alpha, phi, beta, q) {
  _f.set(Math.cos(alpha), Math.sin(alpha), 0);
  _u.set(-Math.sin(alpha), Math.cos(alpha), 0);
  _l.crossVectors(_u, _f);
  _m.makeBasis(_l, _u, _f);
  q.setFromRotationMatrix(_m);
  _qr.setFromAxisAngle(AX_Z, phi);
  q.multiply(_qr);
  _qy.setFromAxisAngle(AX_Y, beta);
  q.premultiply(_qy);
  return q;
}

// Deterministic stunt: the whole run is integrated once at 240 Hz and then sampled by time,
// so replays, slow motion and scrubbing are all exact.
export class StuntSim {
  constructor(profile) {
    this.profile = profile;
    this.dt = 1 / 240;
    this.T = 17;
    this.hCG = 0.55;     // centre of mass above the tyre contact plane
    this.wb = 2.75;      // wheelbase
    this.S0 = -5.4;      // start: car centre this far before the ramp toe
    this.tGo = 1.1;
    this.vCruise = 9.8;
    this.vLip = 5.8;
    this.fireAlt = 9.5;  // retro burn ignition altitude (m, underbody)
    this.vTouch = 1.3;   // target sink rate at touchdown
    this._run();
  }

  _run() {
    const P = this.profile, dt = this.dt, n = Math.ceil(this.T / dt) + 1;
    this.n = n;
    const F = () => new Float32Array(n);
    const d = (this.d = {
      x: F(), y: F(), z: F(), head: F(), roll: F(), yaw: F(), spd: F(), wheel: F(), susp: F(), pitchW: F(),
      main: F(), s0: F(), s1: F(), s2: F(), s3: F(), g: F(), alt: F(), phase: new Uint8Array(n),
    });
    const hw = this.wb / 2, h = this.hCG;
    let mode = 0, s = this.S0, v = 0, wheel = 0, susp = 0, wSpin = 0;
    let cgx = 0, cgy = 0, vx = 0, vy = 0, alpha = 0, phi = 0, alpha0 = 0;
    let burning = false, thrust = 0;
    let gx = 0, gz = 0, gv = 0, impact = 0;
    this.tRamp = -1; this.tExit = -1; this.tBurn = -1; this.tTd = -1; this.landX = -10;
    const a = {}, b = {}, c = {};

    for (let i = 0; i < n; i++) {
      const t = i * dt;
      let x = 0, y = 0, z = 0, yaw = 0, ph = 0, g = 1, mainI = 0, pitchW = 0, spd = 0, alt = 0;
      let sj0 = 0, sj1 = 0, sj2 = 0, sj3 = 0;

      if (mode === 0) {
        // ---- on the ground / on the ramp: pose from the chord between the axles ----
        P.sample(s - hw, a); P.sample(s + hw, b); P.sample(s, c);
        let fx = b.x - a.x, fy = b.y - a.y;
        const fl = Math.hypot(fx, fy);
        fx /= fl; fy /= fl;
        alpha = Math.atan2(fy, fx);
        x = 0.5 * (a.x + b.x); y = 0.5 * (a.y + b.y);
        if (t >= this.tGo) {
          const vt = s < 0 ? this.vCruise : this.vCruise - (this.vCruise - this.vLip) * smoothstep(0.3 * P.L, P.L + hw, s);
          v = Math.max(0, v + clamp(3.2 * (vt - v), -3.0, 7.0) * dt);
        }
        const nload = (v * v * c.k) / G;
        g = nload + Math.cos(c.theta);
        susp += (-0.03 * nload - susp) * (1 - Math.exp(-dt * 12));
        spd = v; alt = y;
        wheel += (v * dt) / WHEEL_R; wSpin = v / WHEEL_R;
        ph = t < this.tGo ? 0 : s < 0.5 ? 1 : 2;
        if (this.tRamp < 0 && s + hw >= 0) this.tRamp = t;
        s += v * dt;
        if (s - hw >= P.L) {
          mode = 1; this.tExit = t + dt; alpha0 = alpha;
          cgx = x - fy * h; cgy = y + fx * h;
          vx = v * fx; vy = v * fy;
        }
      } else if (mode === 1) {
        // ---- airborne: ballistic CG + scripted attitude driven by the roll thrusters ----
        const tau = t - this.tExit;
        alpha = alpha0 + (Math.PI - alpha0) * smootherstep(0, 1.45, tau);
        phi = Math.PI * smootherstep(0.06, 1.25, tau);
        const sl = pulse(tau, 0.02, 0.52, 0.05), sr = pulse(tau, 0.7, 1.12, 0.05);
        sj0 = sj1 = sl; sj2 = sj3 = sr;
        const upx = -Math.sin(alpha) * Math.cos(phi), upy = Math.cos(alpha) * Math.cos(phi), upz = Math.sin(phi);
        const hb = cgy - h * Math.max(0.2, upy);
        if (!burning && vy < 0 && hb <= this.fireAlt) { burning = true; this.tBurn = t; }
        let acc = -G;
        if (burning) {
          const tb = t - this.tBurn;
          const ramp = smoothstep(0, 0.14, tb);
          const need = (vy * vy - this.vTouch * this.vTouch) / (2 * Math.max(hb, 0.06)) + G;
          thrust = clamp(need, 0, 4.6 * G) * ramp;
          acc += thrust;
          vx += (-2.4 - vx) * (1 - Math.exp(-1.5 * dt));
          mainI = Math.max(ramp * 0.8, clamp(thrust / (3.0 * G), 0, 1));
          for (const [j, t0] of PUFFS) {
            const pv = pulse(tb, t0, t0 + 0.11, 0.02);
            if (j === 0) sj0 = Math.max(sj0, pv);
            else if (j === 1) sj1 = Math.max(sj1, pv);
            else if (j === 2) sj2 = Math.max(sj2, pv);
            else sj3 = Math.max(sj3, pv);
          }
        }
        vy += acc * dt; cgx += vx * dt; cgy += vy * dt;
        x = cgx - upx * h; y = cgy - upy * h; z = -upz * h;
        wSpin *= Math.exp(-0.4 * dt); wheel += wSpin * dt;
        spd = Math.hypot(vx, vy); alt = Math.max(0, hb);
        g = burning ? thrust / G : 0;
        ph = burning ? 6 : tau < 0.3 ? 3 : tau < 1.3 ? 4 : 5;
        if (cgy - h * Math.max(0.2, upy) <= 0) {
          mode = 2; this.tTd = t + dt; impact = -vy; gv = -vx; gx = x; gz = z; this.landX = x;
        }
      } else {
        // ---- touchdown + rollout ----
        const tau = t - this.tTd;
        alpha = Math.PI; phi = Math.PI;
        const acc = tau < 0.7 ? -1.2 : 5.0 * smoothstep(0.7, 1.5, tau) * (1 - smoothstep(4.5, 6.5, tau));
        gv = clamp(gv + acc * dt, 0, 22);
        yaw = 0.26 * smoothstep(1.4, 5.0, tau);
        gx += -Math.cos(yaw) * gv * dt; gz += Math.sin(yaw) * gv * dt;
        x = gx; y = 0; z = gz;
        const om = 13, ze = 0.3, wd = om * Math.sqrt(1 - ze * ze);
        const env = Math.exp(-ze * om * tau);
        susp = -(impact / wd + 0.03) * env * Math.sin(wd * tau);
        pitchW = 0.03 * env * Math.sin(wd * tau + 0.9);
        mainI = (1 - smoothstep(0, 0.32, tau)) * 0.85;
        wheel += (gv * dt) / WHEEL_R;
        spd = gv; alt = 0;
        g = 1 + (Math.max(0, -susp) * om * om) / G;
        ph = tau < 0.9 ? 7 : 8;
      }

      d.x[i] = x; d.y[i] = y; d.z[i] = z;
      d.head[i] = alpha; d.roll[i] = phi; d.yaw[i] = yaw;
      d.spd[i] = spd; d.wheel[i] = wheel; d.susp[i] = susp; d.pitchW[i] = pitchW;
      d.main[i] = mainI; d.s0[i] = sj0; d.s1[i] = sj1; d.s2[i] = sj2; d.s3[i] = sj3;
      d.g[i] = g; d.alt[i] = alt; d.phase[i] = ph;
    }
    this.tRollEnd = this.tExit + 1.25;
  }

  makeState() {
    return {
      pos: new THREE.Vector3(), quat: new THREE.Quaternion(), side: [0, 0, 0, 0],
      speed: 0, alt: 0, g: 1, wheel: 0, susp: 0, pitchW: 0, main: 0, phase: 0, headDeg: 0, rollDeg: 0, yaw: 0,
    };
  }

  _idx(t) {
    const f = clamp(t / this.dt, 0, this.n - 1.0001);
    const i = Math.floor(f);
    return [i, f - i];
  }

  sample(t, o) {
    const d = this.d;
    const [i, a] = this._idx(t);
    const j = i + 1;
    const L = (arr) => arr[i] + (arr[j] - arr[i]) * a;
    o.pos.set(L(d.x), L(d.y), L(d.z));
    const al = L(d.head), ph = L(d.roll), yw = L(d.yaw);
    carQuat(al, ph, yw, o.quat);
    o.speed = L(d.spd); o.alt = L(d.alt); o.g = L(d.g); o.wheel = L(d.wheel);
    o.susp = L(d.susp); o.pitchW = L(d.pitchW); o.main = L(d.main);
    o.side[0] = L(d.s0); o.side[1] = L(d.s1); o.side[2] = L(d.s2); o.side[3] = L(d.s3);
    o.phase = d.phase[a < 0.5 ? i : j];
    o.headDeg = (al * 180) / Math.PI; o.rollDeg = (ph * 180) / Math.PI; o.yaw = yw;
    return o;
  }

  posAt(t, v) {
    const d = this.d;
    const [i, a] = this._idx(t);
    const j = i + 1;
    return v.set(
      d.x[i] + (d.x[j] - d.x[i]) * a,
      d.y[i] + (d.y[j] - d.y[i]) * a,
      d.z[i] + (d.z[j] - d.z[i]) * a
    );
  }
}
