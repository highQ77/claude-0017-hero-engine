import * as THREE from 'three';

/** 面向攝影機的粒子面片，可依速度拉長 */
const vertexShader = /* glsl */ `
  attribute vec3 offset;
  attribute vec3 velocity;
  attribute vec4 color;
  attribute vec2 sizeRotation; // x：大小，y：旋轉
  uniform float stretch;
  varying vec2 vUv;
  varying vec4 vColor;

  void main() {
    vUv = uv;
    vColor = color;
    vec4 mvPosition = modelViewMatrix * vec4(offset, 1.0);
    float size = sizeRotation.x;
    vec2 corner;
    vec2 viewVelocity = (modelViewMatrix * vec4(velocity, 0.0)).xy;
    float speed = length(viewVelocity);
    if (stretch > 0.0 && speed > 1e-4) {
      // 沿螢幕上的移動方向拉長
      vec2 dir = viewVelocity / speed;
      vec2 perp = vec2(-dir.y, dir.x);
      corner = dir * position.y * size * (1.0 + speed * stretch * 10.0) + perp * position.x * size;
    } else {
      float c = cos(sizeRotation.y);
      float s = sin(sizeRotation.y);
      corner = mat2(c, s, -s, c) * position.xy * size;
    }
    mvPosition.xy += corner;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D map;
  varying vec2 vUv;
  varying vec4 vColor;

  void main() {
    vec4 color = texture2D(map, vUv) * vColor;
    if (color.a < 0.003) discard;
    gl_FragColor = color;
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

let defaultTexture: THREE.DataTexture | null = null;

/** 內建貼圖：柔和的白色圓點（程式產生，不需要圖檔） */
export function defaultParticleTexture(): THREE.DataTexture {
  if (defaultTexture) return defaultTexture;
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size - 0.5;
      const dy = (y + 0.5) / size - 0.5;
      const d = Math.min(1, Math.sqrt(dx * dx + dy * dy) * 2);
      const a = (1 - d) ** 2; // 中心最亮，往外平滑衰減
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(a * 255);
    }
  }
  defaultTexture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  defaultTexture.magFilter = THREE.LinearFilter;
  defaultTexture.minFilter = THREE.LinearFilter;
  defaultTexture.needsUpdate = true;
  return defaultTexture;
}

export function createParticleMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: defaultParticleTexture() },
      stretch: { value: 0 },
    },
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

/** 建立實例化的面片幾何與每個粒子的屬性 */
export function createParticleGeometry(max: number) {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3),
  );
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  const attr = (itemSize: number) => {
    const a = new THREE.InstancedBufferAttribute(new Float32Array(max * itemSize), itemSize);
    a.setUsage(THREE.DynamicDrawUsage);
    return a;
  };
  const attributes = {
    offset: attr(3),
    velocity: attr(3),
    color: attr(4),
    sizeRotation: attr(2),
  };
  for (const [name, a] of Object.entries(attributes)) geometry.setAttribute(name, a);
  geometry.instanceCount = 0;
  return { geometry, attributes };
}
