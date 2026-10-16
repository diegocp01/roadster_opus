import * as THREE from 'three';
import { makeRampTexture } from './textures.js';
import { smoothstep, ledRed } from './util.js';

export const RAMP_W = 6.4;
const DEG = Math.PI / 180;

// The ramp lives in the XY plane (x = toward the wall, y = up); its width runs along Z.
// The profile is built by integrating a smoothed curvature schedule:
// a long base transition, a near-vertical wall, then a tight curl that overhangs to ~148°.
export function buildProfile() {
  const R1 = 9.0, R2 = 34.0, R3 = 6.2;
  const segs = [
    [78 * DEG * R1, 1 / R1],
    [26 * DEG * R2, 1 / R2],
    [44 * DEG * R3, 1 / R3],
  ];
  const target = 148 * DEG;
  const L0 = segs.reduce((a, s) => a + s[0], 0);
  const ds = 0.02;
  const n = Math.ceil(L0 / ds) + 1;
  const kAt = (s) => {
    if (s < 0) return 0;
    let acc = 0;
    for (const [len, k] of segs) {
      if (s < acc + len) return k;
      acc += len;
    }
    return segs[segs.length - 1][1];
  };
  // box-filter the curvature so transitions behave like clothoids
  const half = Math.round(1.6 / ds);
  const k = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let j = -half; j <= half; j++) sum += kAt((i + j) * ds);
    k[i] = sum / (2 * half + 1);
  }
  let tot = 0;
  for (let i = 0; i < n - 1; i++) tot += 0.5 * (k[i] + k[i + 1]) * ds;
  const sc = target / tot;
  for (let i = 0; i < n; i++) k[i] *= sc;

  const x = new Float32Array(n), y = new Float32Array(n), th = new Float32Array(n);
  for (let i = 0; i < n - 1; i++) {
    const dth = 0.5 * (k[i] + k[i + 1]) * ds;
    const mid = th[i] + dth * 0.5;
    th[i + 1] = th[i] + dth;
    x[i + 1] = x[i] + Math.cos(mid) * ds;
    y[i + 1] = y[i] + Math.sin(mid) * ds;
  }
  const L = (n - 1) * ds;
  let maxX = 0;
  for (let i = 0; i < n; i++) maxX = Math.max(maxX, x[i]);

  function sample(s, out = {}) {
    if (s <= 0) {
      out.x = s; out.y = 0; out.theta = 0; out.k = 0;
      return out;
    }
    if (s >= L) {
      const i = n - 1, t = th[i];
      out.x = x[i] + Math.cos(t) * (s - L);
      out.y = y[i] + Math.sin(t) * (s - L);
      out.theta = t; out.k = 0;
      return out;
    }
    const f = s / ds, i = Math.floor(f), a = f - i;
    out.x = x[i] + (x[i + 1] - x[i]) * a;
    out.y = y[i] + (y[i + 1] - y[i]) * a;
    out.theta = th[i] + (th[i + 1] - th[i]) * a;
    out.k = k[i] + (k[i + 1] - k[i]) * a;
    return out;
  }

  return {
    L, sample, maxX,
    height: y[n - 1],
    lip: { x: x[n - 1], y: y[n - 1], theta: th[n - 1] },
  };
}

export const rampThickness = (s) => 0.04 + 0.62 * smoothstep(0, 5, s);

export function buildRamp(profile, renderer) {
  const group = new THREE.Group();
  const hw = RAMP_W / 2;
  const L = profile.L;
  const N = Math.ceil(L / 0.12);
  const tmp = {};
  const pts = [];
  for (let i = 0; i <= N; i++) {
    const s = (L * i) / N;
    profile.sample(s, tmp);
    const t = tmp.theta;
    pts.push({ s, x: tmp.x, y: tmp.y, tx: Math.cos(t), ty: Math.sin(t), nx: -Math.sin(t), ny: Math.cos(t), d: rampThickness(s) });
  }

  // ----- driving surface -----
  const M = 6;
  {
    const pos = [], nor = [], uv = [], idx = [];
    for (let i = 0; i <= N; i++) {
      const p = pts[i];
      for (let j = 0; j <= M; j++) {
        const z = -hw + (RAMP_W * j) / M;
        pos.push(p.x, p.y, z);
        nor.push(p.nx, p.ny, 0);
        uv.push(j / M, p.s / 12.8);
      }
    }
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < M; j++) {
        const a = i * (M + 1) + j, b = (i + 1) * (M + 1) + j, c = a + 1, d = b + 1;
        idx.push(a, c, b, c, d, b);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    const tex = makeRampTexture();
    tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    const mat = new THREE.MeshStandardMaterial({
      map: tex, roughness: 0.8, metalness: 0.0, envMapIntensity: 0.3,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    });
    const mesh = new THREE.Mesh(g, mat);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    group.add(mesh);
  }

  // ----- back face, side faces, lip cap -----
  {
    const pos = [], nor = [], idx = [];
    const push = (x, y, z, nx, ny, nz) => { pos.push(x, y, z); nor.push(nx, ny, nz); return pos.length / 3 - 1; };
    // back
    const base = pos.length / 3;
    for (let i = 0; i <= N; i++) {
      const p = pts[i];
      const bx = p.x - p.nx * p.d, by = p.y - p.ny * p.d;
      push(bx, by, -hw, -p.nx, -p.ny, 0);
      push(bx, by, hw, -p.nx, -p.ny, 0);
    }
    for (let i = 0; i < N; i++) {
      const a = base + i * 2, c = a + 1, b = a + 2, d = a + 3;
      idx.push(a, b, c, c, b, d);
    }
    // sides
    for (const side of [-1, 1]) {
      const sb = pos.length / 3;
      for (let i = 0; i <= N; i++) {
        const p = pts[i];
        push(p.x, p.y, side * hw, 0, 0, side);
        push(p.x - p.nx * p.d, p.y - p.ny * p.d, side * hw, 0, 0, side);
      }
      for (let i = 0; i < N; i++) {
        const t0 = sb + i * 2, b0 = t0 + 1, t1 = t0 + 2, b1 = t0 + 3;
        if (side > 0) idx.push(t0, b0, t1, b0, b1, t1);
        else idx.push(t0, t1, b0, b0, t1, b1);
      }
    }
    // lip cap
    {
      const p = pts[N];
      const A = push(p.x, p.y, -hw, p.tx, p.ty, 0);
      const B = push(p.x, p.y, hw, p.tx, p.ty, 0);
      const C = push(p.x - p.nx * p.d, p.y - p.ny * p.d, -hw, p.tx, p.ty, 0);
      const D = push(p.x - p.nx * p.d, p.y - p.ny * p.d, hw, p.tx, p.ty, 0);
      idx.push(A, B, C, B, D, C);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setIndex(idx);
    const mat = new THREE.MeshStandardMaterial({ color: 0x80868c, roughness: 0.5, metalness: 0.6 });
    const mesh = new THREE.Mesh(g, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // ----- red LED edge strips -----
  const ledMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(...ledRed(5.5)) });
  for (const side of [-1, 1]) {
    const cpts = [];
    for (let i = 0; i <= N; i += 2) {
      const p = pts[i];
      cpts.push(new THREE.Vector3(p.x + p.nx * 0.035, p.y + p.ny * 0.035, side * (hw - 0.1)));
    }
    const curve = new THREE.CatmullRomCurve3(cpts);
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 500, 0.045, 6, false), ledMat);
    group.add(tube);
  }

  // ----- approach apron -----
  const apron = new THREE.Mesh(
    new THREE.PlaneGeometry(9, RAMP_W + 0.6),
    new THREE.MeshStandardMaterial({ color: 0x55585c, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })
  );
  apron.rotation.x = -Math.PI / 2;
  apron.position.set(-4.5, 0.004, 0);
  apron.receiveShadow = true;
  group.add(apron);

  const truss = buildTruss(profile, hw);
  group.add(truss.mesh, truss.leds);

  return { group, ledMat, topLedMat: truss.ledMat };
}

function buildTruss(profile, hw) {
  const members = [];
  const add = (ax, ay, az, bx, by, bz, r = 0.06) => members.push([ax, ay, az, bx, by, bz, r]);
  const xa = profile.maxX + 1.6, xb = xa + 3.2, zc = hw - 0.5;
  const yTop = profile.height + 2.8;

  // tower
  for (const x of [xa, xb]) for (const z of [-zc, zc]) add(x, 0, z, x, yTop, z, 0.16);
  const lv = 2.8, nL = Math.ceil(yTop / lv);
  for (let k = 0; k <= nL; k++) {
    const y = Math.min(yTop, k * lv);
    add(xa, y, -zc, xa, y, zc, 0.08);
    add(xb, y, -zc, xb, y, zc, 0.08);
    add(xa, y, -zc, xb, y, -zc, 0.08);
    add(xa, y, zc, xb, y, zc, 0.08);
    if (k < nL) {
      const y2 = Math.min(yTop, (k + 1) * lv), f = k % 2 ? 1 : -1;
      add(xa, y, -zc * f, xa, y2, zc * f, 0.05);
      add(xb, y, zc * f, xb, y2, -zc * f, 0.05);
      add(k % 2 ? xa : xb, y, -zc, k % 2 ? xb : xa, y2, -zc, 0.05);
      add(k % 2 ? xb : xa, y, zc, k % 2 ? xa : xb, y2, zc, 0.05);
    }
  }

  // ramp back: stringers, ribs, struts to the tower
  const tmp = {};
  const back = (s) => {
    profile.sample(s, tmp);
    const d = rampThickness(s);
    return [tmp.x + Math.sin(tmp.theta) * d, tmp.y - Math.cos(tmp.theta) * d];
  };
  let prev = null;
  const zs = [-zc, 0, zc];
  const backPts = [];
  for (let s = 0.8; s <= profile.L + 0.01; s += 1.5) {
    const [bx, by] = back(s);
    backPts.push([bx, by]);
    if (prev) for (const z of zs) add(prev[0], prev[1], z, bx, by, z, 0.09);
    add(bx, by, -hw + 0.15, bx, by, hw - 0.15, 0.07);
    if (by > 1.6 && bx < xa - 0.25) {
      for (const z of [-zc, zc]) {
        add(bx, by, z, xa, by, z, 0.07);
        add(bx, by, z, xa, Math.max(0, by - 1.5), z, 0.045);
      }
    } else if (by <= 1.6) {
      for (const z of [-zc, zc]) add(bx, 0, z, bx, by, z, 0.07);
    }
    prev = [bx, by];
  }
  {
    const [bx, by] = back(profile.L);
    for (const z of zs) add(prev[0], prev[1], z, bx, by, z, 0.09);
    backPts.push([bx, by]);
  }

  // top cantilever truss over the lip
  const y1 = yTop, y0 = yTop - 1.5, xL = profile.lip.x - 1.0;
  for (const z of [-zc, zc]) {
    add(xL, y1, z, xb, y1, z, 0.1);
    add(xL, y0, z, xa, y0, z, 0.09);
  }
  for (let x = xL; x < xa; x += 1.4) {
    for (const z of [-zc, zc]) {
      add(x, y0, z, x, y1, z, 0.05);
      add(x, y0, z, Math.min(xa, x + 1.4), y1, z, 0.045);
    }
    add(x, y1, -zc, x, y1, zc, 0.06);
    add(x, y0, -zc, x, y0, zc, 0.05);
  }
  for (const [bx, by] of backPts) {
    if (by > profile.height - 6 && bx < xa - 0.3 && bx > xL) {
      for (const z of [-zc, zc]) add(bx, by, z, bx, y0, z, 0.06);
    }
  }

  const geo = new THREE.CylinderGeometry(1, 1, 1, 8, 1);
  const mat = new THREE.MeshStandardMaterial({ color: 0xa6abb1, metalness: 0.75, roughness: 0.36 });
  const mesh = new THREE.InstancedMesh(geo, mat, members.length);
  const up = new THREE.Vector3(0, 1, 0), a = new THREE.Vector3(), b = new THREE.Vector3();
  const d = new THREE.Vector3(), q = new THREE.Quaternion(), m = new THREE.Matrix4(), sc = new THREE.Vector3(), mid = new THREE.Vector3();
  members.forEach(([ax, ay, az, bx, by, bz, r], i) => {
    a.set(ax, ay, az); b.set(bx, by, bz);
    d.subVectors(b, a);
    const len = d.length();
    d.normalize();
    q.setFromUnitVectors(up, d);
    mid.addVectors(a, b).multiplyScalar(0.5);
    m.compose(mid, q, sc.set(r, len, r));
    mesh.setMatrixAt(i, m);
  });
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  // red LED trim along the top cantilever
  const ledMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(...ledRed(6)) });
  const leds = new THREE.Group();
  for (const z of [-zc, zc]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(xb - xL, 0.08, 0.08), ledMat);
    bar.position.set((xL + xb) / 2, y1 + 0.16, z);
    leds.add(bar);
  }
  const front = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 2 * zc), ledMat);
  front.position.set(xL, y1 + 0.16, 0);
  leds.add(front);

  return { mesh, leds, ledMat };
}
