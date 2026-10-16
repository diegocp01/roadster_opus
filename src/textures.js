import * as THREE from 'three';
import { clamp, smoothstep, mulberry32 } from './util.js';

// ---------- tileable value noise ----------
function hash2(x, y, seed) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function vnoise(x, y, px, py, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const x0 = ((xi % px) + px) % px, x1 = (x0 + 1) % px;
  const y0 = ((yi % py) + py) % py, y1 = (y0 + 1) % py;
  const a = hash2(x0, y0, seed), b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed), d = hash2(x1, y1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export function fbm(x, y, px, py, oct = 5, seed = 0) {
  let s = 0, amp = 0.5, f = 1, norm = 0;
  for (let o = 0; o < oct; o++) {
    s += amp * vnoise(x * f, y * f, px * f, py * f, seed + o * 17);
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return s / norm;
}

function dataTex(clamped, w, h, srgb, repeat) {
  const t = new THREE.DataTexture(new Uint8Array(clamped.buffer), w, h, THREE.RGBAFormat);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

// ---------- asphalt (color + roughness) ----------
export function makeAsphalt(size = 512) {
  const col = new Uint8ClampedArray(size * size * 4);
  const rough = new Uint8ClampedArray(size * size * 4);
  const rnd = mulberry32(7);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const big = fbm(u * 6, v * 6, 6, 6, 5, 3);
      const mid = fbm(u * 24, v * 24, 24, 24, 3, 9);
      const f = rnd();
      let l = 0.2 + 0.07 * (big - 0.5) + 0.05 * (mid - 0.5) + 0.06 * (f - 0.5);
      if (f > 0.992) l += 0.12;
      const g = clamp(l, 0, 1) * 255;
      const i = (y * size + x) * 4;
      col[i] = g; col[i + 1] = g; col[i + 2] = g * 1.04; col[i + 3] = 255;
      const r = clamp(0.86 - 0.28 * smoothstep(0.55, 0.75, big) + 0.1 * (f - 0.5), 0, 1) * 255;
      rough[i] = r; rough[i + 1] = r; rough[i + 2] = r; rough[i + 3] = 255;
    }
  }
  return { map: dataTex(col, size, size, true, true), rough: dataTex(rough, size, size, false, true) };
}

// ---------- ramp driving surface: concrete + center line + tire marks ----------
// Covers 6.4 m (u) x 12.8 m (v); repeats along v.
export function makeRampTexture() {
  const W = 512, H = 1024;
  const data = new Uint8ClampedArray(W * H * 4);
  const rnd = mulberry32(21);
  const band = (u, c, w) => Math.exp(-((u - c) * (u - c)) / (w * w));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W, v = (y + 0.5) / H;
      const n = fbm(u * 5, v * 10, 5, 10, 5, 11);
      const n2 = fbm(u * 20, v * 40, 20, 40, 3, 4);
      const f = rnd();
      let l = 0.74 + 0.1 * (n - 0.5) + 0.05 * (n2 - 0.5) + 0.05 * (f - 0.5);
      const tm = (band(u, 0.5 - 0.134, 0.024) + band(u, 0.5 + 0.134, 0.024)) *
        (0.3 + 0.7 * fbm(u * 2, v * 30, 2, 30, 3, 5));
      l -= 0.24 * tm;
      if (y % 256 < 2) l -= 0.14;
      if (Math.abs(u - 0.5) < 0.0095) l = 0.97 + 0.03 * (f - 0.5) - 0.06 * (n2 - 0.5);
      const e = Math.min(u, 1 - u);
      if (e < 0.03) l *= 0.8;
      const g = clamp(l, 0, 1) * 255;
      const i = (y * W + x) * 4;
      data[i] = g; data[i + 1] = g * 1.01; data[i + 2] = g * 1.03; data[i + 3] = 255;
    }
  }
  const t = dataTex(data, W, H, true, true);
  t.wrapS = THREE.ClampToEdgeWrapping;
  return t;
}

// ---------- smoke puff atlas (2x2 cells) ----------
// Domain-warped fbm with a noisy, eroded outline so overlapping puffs read as billowing
// cauliflower smoke rather than round bokeh blobs.
export function makeSmokeAtlas() {
  const S = 256, W = 512;
  const data = new Uint8ClampedArray(W * W * 4);
  for (let cell = 0; cell < 4; cell++) {
    const rnd = mulberry32(300 + cell * 11);
    const blobs = [];
    for (let k = 0; k < 6; k++) {
      const a = rnd() * Math.PI * 2, r = 0.05 + rnd() * 0.16;
      blobs.push([0.5 + Math.cos(a) * r, 0.5 + Math.sin(a) * r, 0.13 + 0.1 * rnd()]);
    }
    const ox = (cell % 2) * S, oy = Math.floor(cell / 2) * S;
    const sd = 60 + cell * 9;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const u = (x + 0.5) / S, v = (y + 0.5) / S;
        const wx = fbm(u * 3 + cell * 1.7, v * 3, 64, 64, 4, sd) - 0.5;
        const wy = fbm(u * 3, v * 3 + cell * 2.3, 64, 64, 4, sd + 5) - 0.5;
        const uu = u + wx * 0.32, vv = v + wy * 0.32;
        const n = fbm(uu * 5, vv * 5, 64, 64, 6, sd + 9);
        let b = 0;
        for (const [bx, by, br] of blobs) {
          const dx = uu - bx, dy = vv - by;
          b = Math.max(b, Math.exp(-(dx * dx + dy * dy) / (br * br)));
        }
        const r = Math.hypot(u - 0.5, v - 0.5) * 2;
        const shape = (1 - smoothstep(0.45, 1.0, r + (0.5 - n) * 0.55)) * (0.35 + 0.65 * b);
        let den = shape * (0.35 + 1.0 * n);
        den = smoothstep(0.12, 0.78, den);
        const shade = clamp(0.5 + 0.75 * (n - 0.5) + 0.32 * (0.5 - v) + 0.15 * b, 0, 1);
        const i = ((oy + y) * W + ox + x) * 4;
        data[i] = shade * 255; data[i + 1] = shade * 255; data[i + 2] = shade * 255; data[i + 3] = den * 255;
      }
    }
  }
  return dataTex(data, W, W, false, false);
}

// ---------- glow + anamorphic streak sprites ----------
export function makeGlowTexture(size = 128) {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size * 2 - 1, dy = (y + 0.5) / size * 2 - 1;
      const r = Math.hypot(dx, dy);
      const a = clamp(Math.exp(-r * r * 14) + Math.exp(-r * 4.5) * 0.35, 0, 1) * (1 - smoothstep(0.82, 1, r));
      const i = (y * size + x) * 4;
      data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; data[i + 3] = a * 255;
    }
  }
  return dataTex(data, size, size, false, false);
}

export function makeStreakTexture() {
  const W = 256, H = 32;
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = Math.abs((x + 0.5) / W * 2 - 1), dy = Math.abs((y + 0.5) / H * 2 - 1);
      const a = Math.exp(-dy * dy * 18) * Math.pow(1 - dx, 2.5);
      const i = (y * W + x) * 4;
      data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; data[i + 3] = clamp(a, 0, 1) * 255;
    }
  }
  return dataTex(data, W, H, false, false);
}
