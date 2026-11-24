import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  Fn,
  If,
  attribute,
  cameraProjectionMatrix,
  cos,
  float,
  length,
  materialReference,
  modelViewMatrix,
  positionGeometry,
  sin,
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

/**
 * 所有粒子材質共用同一份節點圖（模組層級只建一次）。
 * 效能：每個發射器各自建節點的話，著色器程式的快取鍵都不同，每次放特效（例如爆炸）都要重新產生、編譯一次著色器，畫面會卡一下。
 * 共用節點圖之後快取鍵相同，只編譯一次；每個材質不同的值（貼圖、拉長程度）用材質參照，繪製時才從各自的材質讀。
 */
let sharedNodes: { vertex: unknown; color: unknown } | null = null;

function particleNodes() {
  if (sharedNodes) return sharedNodes;
  // 型別定義把材質參照當成一般節點，實際上可以照 float、貼圖使用
  const map = materialReference('particleMap', 'texture') as unknown as ReturnType<typeof vec4>; // 用預設的 uv 取樣
  const stretch = materialReference('particleStretch', 'float') as unknown as ReturnType<typeof float>;
  const vertex = Fn(() => {
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
  const color = map.mul(attribute('color', 'vec4'));
  sharedNodes = { vertex, color };
  return sharedNodes;
}

/** 面向攝影機、可依速度拉長；色調映射與顏色轉換由節點材質自動處理 */
function createParticleNodeMaterial(): ParticleMaterial {
  const material = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }) as MeshBasicNodeMaterial & { particleMap: THREE.Texture; particleStretch: number };
  material.particleMap = defaultParticleTexture();
  material.particleStretch = 0;
  const nodes = particleNodes();
  material.vertexNode = nodes.vertex as never;
  material.colorNode = nodes.color as never;
  material.alphaTest = 0.003;
  // 和 ShaderMaterial 一樣的介面：uniforms.map.value、uniforms.stretch.value（實際存在材質的 particleMap、particleStretch）
  (material as unknown as ParticleMaterial).uniforms = {
    map: {
      get value() {
        return material.particleMap;
      },
      set value(v: THREE.Texture) {
        material.particleMap = v;
      },
    },
    stretch: {
      get value() {
        return material.particleStretch;
      },
      set value(v: number) {
        material.particleStretch = v;
      },
    },
  };
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
