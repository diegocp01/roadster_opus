import * as THREE from 'three';

// A tiny "night proving ground" light probe: black sky, floodlights, red LED strip and the
// lit ramp face. Gives the clearcoat and glass believable reflections without flattening the dark.
export function buildEnvMap(renderer) {
  const s = new THREE.Scene();
  s.add(new THREE.Mesh(
    new THREE.SphereGeometry(100, 32, 16),
    new THREE.MeshBasicMaterial({ color: 0x010102, side: THREE.BackSide })
  ));
  const panel = (w, h, pos, color, k) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide })
    );
    m.position.set(...pos);
    m.lookAt(0, 0, 0);
    s.add(m);
  };
  panel(70, 70, [0, 45, 0], 0xffffff, 0.22);
  panel(3, 1.5, [-30, 2, -20], 0xfff4e6, 40);
  panel(3, 1.5, [-14, 2, -22], 0xfff4e6, 40);
  panel(90, 1.2, [-30, 1, -26], 0xff1010, 5);
  panel(9, 40, [30, 15, 0], 0xb0b4b8, 0.9);
  panel(4, 2, [-30, 3, 30], 0xffffff, 10);
  panel(160, 4, [0, 2, 80], 0x30343a, 0.4);
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(s, 0.02);
  pm.dispose();
  return rt.texture;
}
