import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// Runs after tone mapping: lens CA, vignette, film grain, letterbox bars and fade-to-black.
// Bars and fades live here (not in HTML) so they end up in recorded video too.
const FinishShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uLetterbox: { value: 0 },
    uFade: { value: 0 },
  },
  vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime; uniform vec2 uRes; uniform float uLetterbox; uniform float uFade;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec2 uv = vUv;
      vec2 d = uv - 0.5;
      float r2 = dot(d, d);
      vec2 off = d * 0.006 * r2;
      vec3 c;
      c.r = texture2D(tDiffuse, uv + off).r;
      c.g = texture2D(tDiffuse, uv).g;
      c.b = texture2D(tDiffuse, uv - off).b;
      c *= mix(1.0, 0.6, smoothstep(0.08, 0.5, r2));
      float n = hash(floor(uv * uRes) + fract(uTime * 7.3) * 113.0);
      c += (n - 0.5) * 0.03;
      if (uv.y < uLetterbox || uv.y > 1.0 - uLetterbox) c = vec3(0.0);
      c *= 1.0 - uFade;
      gl_FragColor = vec4(c, 1.0);
    }`,
};

// Tight clearcoat highlights from small, close lights can overflow half-float (Inf); blurring an
// Inf in the bloom chain turns into NaN blocks. Clamp the HDR frame before anything blurs it.
const ClampShader = {
  uniforms: { tDiffuse: { value: null }, uMax: { value: 48 } },
  vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uMax; varying vec2 vUv;
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      if (any(isnan(c))) c = vec3(0.0);
      c = clamp(c, vec3(-uMax), vec3(uMax));
      float m = max(c.r, max(c.g, c.b));
      if (m > uMax * 0.5) c *= (uMax * 0.5 + log(1.0 + m - uMax * 0.5)) / m;
      gl_FragColor = vec4(c, 1.0);
    }`,
};

export function createPost(renderer, scene, camera) {
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new ShaderPass(ClampShader));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.3, 0.95);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const finish = new ShaderPass(FinishShader);
  composer.addPass(finish);

  function setSize(w, h) {
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(w, h);
    finish.uniforms.uRes.value.set(w * renderer.getPixelRatio(), h * renderer.getPixelRatio());
  }

  function render(time, letterbox, fade) {
    finish.uniforms.uTime.value = time;
    finish.uniforms.uLetterbox.value = letterbox;
    finish.uniforms.uFade.value = fade;
    composer.render();
  }

  return { composer, bloom, setSize, render };
}
