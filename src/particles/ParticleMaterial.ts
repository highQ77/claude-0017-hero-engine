import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  Fn,
  If,
  attribute,
  cameraProjectionMatrix,
  cos,
  length,
  modelViewMatrix,
  positionGeometry,
  sin,
  texture,
  uniform,
  uv,
  vec2,
  vec4,
} from 'three/tsl';

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

/**
 * 粒子材質（節點材質）：面向攝影機的面片，可依速度拉長、加法混合。
 * uniforms.map（貼圖）、uniforms.stretch（依速度拉長的程度）可以改。
 */
export type ParticleMaterial = THREE.Material & {
  uniforms: { map: { value: THREE.Texture }; stretch: { value: number } };
};

/** 建立粒子材質 */
export function createParticleMaterial(): ParticleMaterial {
  return createParticleNodeMaterial();
}

/** 面向攝影機、可依速度拉長；色調映射與顏色轉換由節點材質自動處理 */
function createParticleNodeMaterial(): ParticleMaterial {
  const map = texture(defaultParticleTexture());
  const stretch = uniform(0);
  const material = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  material.vertexNode = Fn(() => {
    const offset = attribute('offset', 'vec3');
    const velocity = attribute('velocity', 'vec3');
    const sizeRotation = attribute('sizeRotation', 'vec2');
    const size = sizeRotation.x;
    const mv = modelViewMatrix.mul(vec4(offset, 1)).toVar();
    const viewVelocity = modelViewMatrix.mul(vec4(velocity, 0)).xy;
    const speed = length(viewVelocity);
    const corner = vec2(0, 0).toVar();
    If(stretch.greaterThan(0).and(speed.greaterThan(1e-4)), () => {
      // 沿螢幕上的移動方向拉長
      const dir = viewVelocity.div(speed);
      const perp = vec2(dir.y.negate(), dir.x);
      corner.assign(
        dir
          .mul(positionGeometry.y)
          .mul(size)
          .mul(speed.mul(stretch).mul(10).add(1))
          .add(perp.mul(positionGeometry.x).mul(size)),
      );
    }).Else(() => {
      const c = cos(sizeRotation.y);
      const s = sin(sizeRotation.y);
      // 和 GLSL 的 mat2(c, s, -s, c) * p 一樣
      const p = positionGeometry.xy;
      corner.assign(vec2(c.mul(p.x).sub(s.mul(p.y)), s.mul(p.x).add(c.mul(p.y))).mul(size));
    });
    return cameraProjectionMatrix.mul(vec4(mv.xy.add(corner), mv.z, mv.w));
  })();
  material.colorNode = map.sample(uv()).mul(attribute('color', 'vec4'));
  material.alphaTest = 0.003;
  // 和 ShaderMaterial 一樣的介面：uniforms.map.value、uniforms.stretch.value
  (material as unknown as ParticleMaterial).uniforms = { map, stretch } as unknown as ParticleMaterial['uniforms'];
  return material as unknown as ParticleMaterial;
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
