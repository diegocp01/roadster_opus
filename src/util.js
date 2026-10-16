export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;

export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export const smootherstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
};

// Soft on/off window between a and b with edge width e.
export const pulse = (x, a, b, e = 0.04) => smoothstep(a, a + e, x) * (1 - smoothstep(b - e, b, x));

export function mulberry32(seed) {
  let a = seed | 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Saturated LED red that survives ACES: pre-compensates the ACES input matrix's green/blue leak
// (slightly negative G/B), so bright values stay red instead of drifting to orange-pink.
export const ledRed = (k) => [k, -0.075 * k, -0.02 * k];
