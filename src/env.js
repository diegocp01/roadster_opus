import * as THREE from 'three';
import { makeAsphalt, makeGlowTexture, makeStreakTexture } from './textures.js';
import { buildCar } from './car.js';
import { smoothstep, mulberry32, ledRed } from './util.js';

export const STRIP_Z = -16.6;
export const STRIP_X0 = -70;
export const STRIP_X1 = -3;

const RED = (k) => new THREE.Color(...ledRed(7 * k));

const glowVert = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

export function buildEnvironment(scene, { sim, renderer }) {
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const glowTex = makeGlowTexture();
  const streakTex = makeStreakTexture();
  const E = { floods: [], floodPos: [], stripZ: STRIP_Z, stripX0: STRIP_X0, stripX1: STRIP_X1 };

  // ---------------- ground ----------------
  const asp = makeAsphalt(512);
  for (const t of [asp.map, asp.rough]) { t.repeat.set(110, 110); t.anisotropy = aniso; }
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(1000, 1000),
    new THREE.MeshStandardMaterial({ map: asp.map, roughnessMap: asp.rough, roughness: 1, metalness: 0, envMapIntensity: 0.35 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // landing 'X'
  const lineMat = new THREE.MeshStandardMaterial({
    color: 0xe6e6e6, roughness: 0.65, emissive: 0x303030, emissiveIntensity: 0.55,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  for (const ang of [0.56, -0.56]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(64, 0.16), lineMat);
    m.rotation.set(-Math.PI / 2, 0, ang);
    m.position.set(sim.landX, 0.01, 0);
    m.receiveShadow = true;
    scene.add(m);
  }

  // ---------------- red LED ground strip ----------------
  const segN = 60, segL = (STRIP_X1 - STRIP_X0) / segN;
  const strip = new THREE.InstancedMesh(
    new THREE.BoxGeometry(segL * 0.93, 0.07, 0.13),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
    segN
  );
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < segN; i++) {
    m4.makeTranslation(STRIP_X0 + segL * (i + 0.5), 0.05, STRIP_Z);
    strip.setMatrixAt(i, m4);
    strip.setColorAt(i, RED(1));
  }
  scene.add(strip);

  const stripGlowMat = new THREE.ShaderMaterial({
    uniforms: { uLevel: { value: 1 }, uSweep: { value: 1.05 }, uColor: { value: new THREE.Color(...ledRed(1.0)) } },
    vertexShader: glowVert,
    fragmentShader: /* glsl */ `
      uniform float uLevel; uniform float uSweep; uniform vec3 uColor; varying vec2 vUv;
      void main(){
        float d = abs(vUv.y - 0.5) * 2.0;
        float g = exp(-d * 10.0) * 0.55 + exp(-d * 2.8) * 0.12;
        float from = 1.0 - vUv.x;
        float lit = 1.0 - smoothstep(uSweep - 0.04, uSweep, from);
        float ends = smoothstep(0.0, 0.05, vUv.x) * smoothstep(0.0, 0.02, 1.0 - vUv.x);
        gl_FragColor = vec4(uColor * g * lit * ends * uLevel, 1.0);
      }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const stripGlow = new THREE.Mesh(new THREE.PlaneGeometry(STRIP_X1 - STRIP_X0 + 4, 16), stripGlowMat);
  stripGlow.rotation.x = -Math.PI / 2;
  stripGlow.position.set((STRIP_X0 + STRIP_X1) / 2, 0.025, STRIP_Z);
  scene.add(stripGlow);

  // ---------------- bleachers / stage seating ----------------
  const bl = { x0: -58, x1: -12, z0: STRIP_Z - 2.6, tiers: 6, depth: 1.8, rise: 0.95 };
  const tierMat = new THREE.MeshStandardMaterial({ color: 0x232427, roughness: 0.88, metalness: 0.1 });
  for (let k = 0; k < bl.tiers; k++) {
    const h = bl.rise * (k + 1);
    const b = new THREE.Mesh(new THREE.BoxGeometry(bl.x1 - bl.x0, h, bl.depth), tierMat);
    b.position.set((bl.x0 + bl.x1) / 2, h / 2, bl.z0 - k * bl.depth - bl.depth / 2);
    b.receiveShadow = true; b.castShadow = true;
    scene.add(b);
  }
  // back frame / rigging
  const rigMat = new THREE.MeshStandardMaterial({ color: 0x1b1c1f, roughness: 0.6, metalness: 0.6 });
  const zBack = bl.z0 - bl.tiers * bl.depth - 0.6;
  for (let x = bl.x0; x <= bl.x1 + 0.01; x += (bl.x1 - bl.x0) / 6) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.3, 11, 0.3), rigMat);
    p.position.set(x, 5.5, zBack);
    scene.add(p);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(bl.x1 - bl.x0 + 0.3, 0.5, 0.5), rigMat);
  beam.position.set((bl.x0 + bl.x1) / 2, 11, zBack);
  scene.add(beam);

  const dotsPer = 38;
  const dots = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.46, 0.1, 0.05),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
    bl.tiers * dotsPer
  );
  const dotLen = (bl.x1 - bl.x0) / dotsPer;
  for (let k = 0; k < bl.tiers; k++) {
    for (let j = 0; j < dotsPer; j++) {
      m4.makeTranslation(bl.x0 + dotLen * (j + 0.5), bl.rise * (k + 1) - 0.16, bl.z0 - k * bl.depth + 0.03);
      dots.setMatrixAt(k * dotsPer + j, m4);
      dots.setColorAt(k * dotsPer + j, RED(1));
    }
  }
  scene.add(dots);
  // red wash on each riser face
  const washMats = [];
  for (let k = 0; k < bl.tiers; k++) {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uLevel: { value: 1 }, uColor: { value: new THREE.Color(...ledRed(0.9)) } },
      vertexShader: glowVert,
      fragmentShader: /* glsl */ `
        uniform float uLevel; uniform vec3 uColor; varying vec2 vUv;
        void main(){
          float g = exp(-(1.0 - vUv.y) * 3.5) * 0.45;
          float ends = smoothstep(0.0, 0.02, vUv.x) * smoothstep(0.0, 0.02, 1.0 - vUv.x);
          gl_FragColor = vec4(uColor * g * ends * uLevel, 1.0);
        }`,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const h = bl.rise;
    const w = new THREE.Mesh(new THREE.PlaneGeometry(bl.x1 - bl.x0, h), mat);
    w.position.set((bl.x0 + bl.x1) / 2, bl.rise * (k + 1) - h / 2, bl.z0 - k * bl.depth + 0.02);
    scene.add(w);
    washMats.push(mat);
  }
  // red light rail along the top of the rigging
  const rail = new THREE.Mesh(new THREE.BoxGeometry(bl.x1 - bl.x0, 0.12, 0.12), new THREE.MeshBasicMaterial({ color: RED(0.8) }));
  rail.position.set((bl.x0 + bl.x1) / 2, 10.6, zBack + 0.35);
  scene.add(rail);

  // ---------------- floodlights on the strip ----------------
  const housingMat = new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.5, metalness: 0.7 });
  const floodSpec = [
    { pos: new THREE.Vector3(-30, 1.15, STRIP_Z + 0.7), target: new THREE.Vector3(-7, 2.5, 2), shadow: true },
    { pos: new THREE.Vector3(-13.5, 1.15, STRIP_Z + 0.7), target: new THREE.Vector3(3, 9, 0), shadow: false },
  ];
  for (const f of floodSpec) {
    const g = new THREE.Group();
    g.position.copy(f.pos);
    g.lookAt(f.target);
    const housing = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.9, 0.5), housingMat);
    housing.position.z = -0.26;
    const lensMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(7, 6.8, 6.4) });
    const lens = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 0.75), lensMat);
    lens.position.z = 0.005;
    g.add(housing, lens);
    scene.add(g);
    const legs = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.1, 0.12), housingMat);
    legs.position.set(f.pos.x, 0.55, f.pos.z - 0.3);
    scene.add(legs);

    const spot = new THREE.SpotLight(0xfff3e6, 1500, 160, 0.62, 0.55, 2);
    spot.position.copy(f.pos).add(new THREE.Vector3(0, 0, 0.4));
    spot.target.position.copy(f.target);
    if (f.shadow) {
      spot.castShadow = true;
      spot.shadow.mapSize.set(2048, 2048);
      spot.shadow.camera.near = 2;
      spot.shadow.camera.far = 90;
      spot.shadow.bias = -0.0004;
      spot.shadow.normalBias = 0.03;
    }
    scene.add(spot, spot.target);

    const spr = (map, color, sx, sy, opacity = 1) => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity,
      }));
      s.scale.set(sx, sy, 1);
      s.position.copy(f.pos).add(new THREE.Vector3(0, 0, 0.5));
      s.renderOrder = 4;
      scene.add(s);
      return s;
    };
    const sprites = [
      spr(glowTex, new THREE.Color(2.4, 2.35, 2.2), 2.6, 2.6),
      spr(glowTex, new THREE.Color(1, 0.96, 0.9), 9, 9, 0.16),
      spr(streakTex, new THREE.Color(1.4, 1.5, 1.9), 15, 0.45, 0.5),
    ];
    E.floods.push({ spot, lensMat, sprites, base: 1500, baseOpacity: sprites.map((s) => s.material.opacity) });
    E.floodPos.push(f.pos.clone());
  }

  // ---------------- ramp key lights ----------------
  const keyA = new THREE.SpotLight(0xeef3ff, 2600, 130, 0.43, 0.75, 2);
  keyA.position.set(-24, 1.6, 22);
  keyA.target.position.set(4.5, 12, 0);
  keyA.castShadow = true;
  keyA.shadow.mapSize.set(2048, 2048);
  keyA.shadow.camera.near = 5;
  keyA.shadow.camera.far = 90;
  keyA.shadow.bias = -0.0003;
  keyA.shadow.normalBias = 0.03;
  const keyB = new THREE.SpotLight(0xeef3ff, 1500, 130, 0.43, 0.75, 2);
  keyB.position.set(-22, 1.6, -11);
  keyB.target.position.set(4.5, 13, 0);
  scene.add(keyA, keyA.target, keyB, keyB.target);
  E.keyPos = keyA.position.clone();

  scene.add(new THREE.HemisphereLight(0x2a3546, 0x060606, 0.45));
  // faint overhead fill from the high stadium clusters so roofs and decks still read
  const top = new THREE.DirectionalLight(0xdde4ff, 0.32);
  top.position.set(-40, 80, 30);
  scene.add(top);

  // ---------------- high stadium light clusters ----------------
  const clusterMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.2, 2.1) });
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x0c0d0f, roughness: 0.7, metalness: 0.5 });
  for (const [x, y, z] of [[-110, 34, -95], [55, 38, -120], [-160, 30, 20], [110, 32, 60], [-40, 36, -150]]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, y, 8), poleMat);
    pole.position.set(x, y / 2, z);
    scene.add(pole);
    const g = new THREE.Group();
    g.position.set(x, y + 1.2, z);
    g.lookAt(0, 4, 0);
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 4; c++) {
        const q = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.38), clusterMat);
        q.position.set((c - 1.5) * 0.7, (r - 1) * 0.5, 0);
        g.add(q);
      }
    }
    scene.add(g);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color: new THREE.Color(1.2, 1.2, 1.1), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.45,
    }));
    s.scale.setScalar(7);
    s.position.set(x, y + 1.2, z);
    scene.add(s);
  }

  // ---------------- distant city glow on the horizon ----------------
  {
    const rnd = mulberry32(99);
    const N = 1400, pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
    const centres = [-2.2, -1.6, -0.9, 2.4, 2.9];
    for (let i = 0; i < N; i++) {
      const c = centres[i % centres.length];
      const a = c + (rnd() - 0.5) * 0.55 * Math.sqrt(rnd());
      const r = 620 + rnd() * 320;
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = -2 + rnd() * rnd() * rnd() * 14;
      pos[i * 3 + 2] = Math.sin(a) * r;
      const w = rnd();
      col[i * 3] = 1.0; col[i * 3 + 1] = 0.7 + 0.25 * w; col[i * 3 + 2] = 0.45 + 0.4 * w;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ size: 1.3, sizeAttenuation: false, vertexColors: true, fog: false, transparent: true, opacity: 0.45 }));
    scene.add(pts);
  }

  // ---------------- second (parked) car with headlights on ----------------
  const car2 = buildCar({ jets: false, headSpot: true, headIntensity: 260 });
  car2.root.position.set(-34, 0, 20);
  car2.root.rotation.y = Math.atan2(sim.landX + 34, -20);
  scene.add(car2.root);
  car2.update({
    pos: car2.root.position, quat: car2.root.quaternion, susp: 0, pitchW: 0, wheel: 0, main: 0, side: [0, 0, 0, 0], alt: 0,
  }, 0);

  // ---------------- light level control (sequenced show) ----------------
  const tmpC = new THREE.Color();
  E.update = (lv) => {
    const sw = lv.strip * 1.05;
    for (let i = 0; i < segN; i++) {
      const fr = 1 - (i + 0.5) / segN;
      const k = 1 - smoothstep(sw - 0.04, sw, fr);
      strip.setColorAt(i, tmpC.setRGB(...ledRed(7 * k + 0.02)));
    }
    strip.instanceColor.needsUpdate = true;
    stripGlowMat.uniforms.uSweep.value = sw;

    for (const f of E.floods) {
      f.spot.intensity = f.base * lv.flood;
      f.lensMat.color.setRGB(7, 6.8, 6.4).multiplyScalar(Math.max(0.01, lv.flood));
      f.sprites.forEach((s, i) => { s.material.opacity = f.baseOpacity[i] * Math.min(1.6, lv.flood); });
    }

    for (let k = 0; k < bl.tiers; k++) {
      for (let j = 0; j < dotsPer; j++) {
        const order = (k * 0.5 + (j / dotsPer) * 0.5) / 1.0;
        const on = smoothstep(order * 0.75, order * 0.75 + 0.25, lv.bleach);
        dots.setColorAt(k * dotsPer + j, tmpC.setRGB(...ledRed(7 * on + 0.02)));
      }
      washMats[k].uniforms.uLevel.value = smoothstep(k / bl.tiers * 0.8, k / bl.tiers * 0.8 + 0.3, lv.bleach);
    }
    dots.instanceColor.needsUpdate = true;
    rail.material.color.copy(RED(0.8 * smoothstep(0.7, 1, lv.bleach)));
    E.levels = lv;
  };
  E.update({ strip: 1, flood: 1, bleach: 1 });

  return E;
}
