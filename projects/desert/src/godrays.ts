/**
 * 月光光束（god rays）：月亮的光從船身、桅杆、船帆的縫隙間透出來，形成一道道放射狀的光束。
 *
 * 做法（螢幕空間的放射模糊，後製效果，放在色調映射前的高動態範圍階段）：
 * 1. 取出月亮：畫面中「很亮、又在月亮圓盤附近」的像素（月亮的顏色是 MOON_BRIGHTNESS 倍，遠超過一般物體）；
 *    被船身擋住的部分本來就是暗的，所以遮擋不用另外算
 * 2. 放射模糊：每個像素往月亮的方向取樣、一路累加並逐漸衰減，亮的地方就被拉成一條條光束
 *    （先長距離模糊一次，再短距離模糊一次把取樣的條紋抹平；都在一半解析度做，比較省）
 * 3. 疊回原本的畫面
 *
 * 在場景的 setup 裡呼叫 addGodrays(world, 月亮實體)；換場景時月亮被移除，光束自動停止。
 * godraySettings 可以在執行中調整（後製面板的「月光光束」區塊就是改它）。
 */
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { type Entity, type World, define } from '@engine/ecs';
import { Transform } from '@engine/scene';
import { ecs, postfx, render } from './engine';

/** 光束的整體設定（修改後下一幀生效） */
export const godraySettings = {
  /** 開關 */
  enabled: true,
  /** 強度：疊回畫面的亮度倍率 */
  intensity: 0.35,
  /** 長度：光束往外延伸多遠（1 = 從月亮一路拉到畫面上的這個像素） */
  length: 0.85,
  /** 衰減：每往外一步剩下多少（越接近 1 光束越長、越均勻） */
  decay: 0.97,
};
/** 預設值（「還原」用） */
export const GODRAY_DEFAULTS = { ...godraySettings };

/** 光束的顏色（偏冷的月光，和月亮本身的暖白色略有不同，看起來像空氣中的散射） */
const RAY_COLOR = new THREE.Color('#c9d6ff');
/** 亮度門檻：比這個亮才算是月亮（月亮約 10，幽靈約 2～3，一般物體 1 以下） */
const THRESHOLD = 3;
/** 放射模糊的取樣數（第一次長距離、第二次短距離抹平） */
const SAMPLES_LONG = 64;
const SAMPLES_SHORT = 16;

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/** 1. 取出月亮：亮度超過門檻、且在月亮圓盤附近（排除同樣很亮的幽靈） */
const maskMaterial = new THREE.ShaderMaterial({
  uniforms: {
    tDiffuse: { value: null },
    moonUv: { value: new THREE.Vector2() },
    moonRadius: { value: 0.05 },
    aspect: { value: 1 },
    threshold: { value: THRESHOLD },
  },
  vertexShader,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 moonUv;
    uniform float moonRadius;
    uniform float aspect;
    uniform float threshold;
    varying vec2 vUv;
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
      float bright = smoothstep(threshold, threshold * 1.5, lum);
      float d = length((vUv - moonUv) * vec2(aspect, 1.0));
      float near = 1.0 - smoothstep(moonRadius * 1.1, moonRadius * 1.5, d);
      // 亮度壓到固定值：光束的強弱由設定決定，不受月亮亮度、光暈影響
      gl_FragColor = vec4(vec3(bright * near), 1.0);
    }
  `,
  depthTest: false,
  depthWrite: false,
});

/** 2. 放射模糊：往月亮的方向取樣累加（加上每個像素不同的起點偏移，避免一圈圈的條紋） */
function radialBlurMaterial(samples: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    defines: { SAMPLES: samples },
    uniforms: {
      tDiffuse: { value: null },
      moonUv: { value: new THREE.Vector2() },
      length: { value: 1 },
      decay: { value: 0.97 },
    },
    vertexShader,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      uniform vec2 moonUv;
      uniform float length;
      uniform float decay;
      varying vec2 vUv;
      void main() {
        vec2 step = (vUv - moonUv) * length / float(SAMPLES);
        float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
        vec2 coord = vUv - step * jitter;
        float weight = 1.0;
        float total = 0.0;
        vec3 sum = vec3(0.0);
        for (int i = 0; i < SAMPLES; i++) {
          sum += texture2D(tDiffuse, coord).rgb * weight;
          total += weight;
          weight *= decay;
          coord -= step;
        }
        gl_FragColor = vec4(sum / total, 1.0);
      }
    `,
    depthTest: false,
    depthWrite: false,
  });
}

/** 3. 疊回畫面 */
const compositeMaterial = new THREE.ShaderMaterial({
  uniforms: {
    tDiffuse: { value: null },
    tRays: { value: null },
    color: { value: new THREE.Vector3() },
  },
  vertexShader,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D tRays;
    uniform vec3 color;
    varying vec2 vUv;
    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      gl_FragColor = vec4(base.rgb + texture2D(tRays, vUv).rgb * color, base.a);
    }
  `,
  depthTest: false,
  depthWrite: false,
});

const _pos = new THREE.Vector3();
const _view = new THREE.Vector3();
const _uv = new THREE.Vector2();

class GodrayPass extends Pass {
  /** 月亮的世界座標；這一幀沒有月亮（場景已卸載）時為 null */
  source: THREE.Vector3 | null = null;
  /** 月亮圓盤的半徑（世界單位） */
  sourceRadius = 12;
  private readonly quad = new FullScreenQuad();
  private readonly long = radialBlurMaterial(SAMPLES_LONG);
  private readonly short = radialBlurMaterial(SAMPLES_SHORT);
  private readonly copy = new THREE.ShaderMaterial({
    uniforms: { tDiffuse: { value: null } },
    vertexShader,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      varying vec2 vUv;
      void main() { gl_FragColor = texture2D(tDiffuse, vUv); }
    `,
    depthTest: false,
    depthWrite: false,
  });
  private readonly a = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  private readonly b = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  private aspect = 1;

  setSize(width: number, height: number): void {
    // 一半解析度：光束本來就是模糊的，看不出差別
    const w = Math.max(1, Math.round(width / 2));
    const h = Math.max(1, Math.round(height / 2));
    this.a.setSize(w, h);
    this.b.setSize(w, h);
    this.aspect = width / Math.max(1, height);
  }

  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget) {
    const out = this.renderToScreen ? null : writeBuffer;
    const camera = render.activeCameraObject;
    const fade = this.source && camera ? this.project(this.source, camera) : 0;
    this.source = null; // 每幀由系統重新設定；沒設定代表月亮已經不在了

    if (fade <= 0 || !godraySettings.enabled) {
      this.copy.uniforms.tDiffuse.value = readBuffer.texture;
      this.draw(renderer, this.copy, out);
      return;
    }

    maskMaterial.uniforms.tDiffuse.value = readBuffer.texture;
    maskMaterial.uniforms.aspect.value = this.aspect;
    this.draw(renderer, maskMaterial, this.a);

    const s = godraySettings;
    this.long.uniforms.tDiffuse.value = this.a.texture;
    this.long.uniforms.length.value = s.length;
    this.long.uniforms.decay.value = s.decay;
    this.draw(renderer, this.long, this.b);

    this.short.uniforms.tDiffuse.value = this.b.texture;
    this.short.uniforms.length.value = s.length * 0.12;
    this.short.uniforms.decay.value = 1;
    this.draw(renderer, this.short, this.a);

    compositeMaterial.uniforms.tDiffuse.value = readBuffer.texture;
    compositeMaterial.uniforms.tRays.value = this.a.texture;
    // 取樣是平均值（月亮只占一小塊），乘上取樣數讓強度 1 左右就看得清楚
    const gain = s.intensity * fade * 6;
    (compositeMaterial.uniforms.color.value as THREE.Vector3).set(
      RAY_COLOR.r * gain,
      RAY_COLOR.g * gain,
      RAY_COLOR.b * gain,
    );
    this.draw(renderer, compositeMaterial, out);
  }

  /** 算出月亮在畫面上的位置與大小；回傳淡出係數（月亮在鏡頭後方時為 0） */
  private project(source: THREE.Vector3, camera: THREE.Camera): number {
    _view.copy(source).applyMatrix4(camera.matrixWorldInverse);
    if (_view.z >= 0) return 0; // 在鏡頭後方
    _pos.copy(source).project(camera);
    const uv = _uv.set(_pos.x * 0.5 + 0.5, _pos.y * 0.5 + 0.5);
    maskMaterial.uniforms.moonUv.value.copy(uv);
    this.long.uniforms.moonUv.value.copy(uv);
    this.short.uniforms.moonUv.value.copy(uv);
    // 圓盤半徑投影到畫面上（以畫面高度為 1）
    const fov = (camera as THREE.PerspectiveCamera).isPerspectiveCamera ? (camera as THREE.PerspectiveCamera).fov : 55;
    maskMaterial.uniforms.moonRadius.value =
      this.sourceRadius / (-_view.z * 2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2));
    // 月亮快要轉到鏡頭側面時慢慢淡出（光束方向在那時會變得很極端）
    const facing = -_view.z / _view.length();
    return THREE.MathUtils.smoothstep(facing, 0.05, 0.35);
  }

  private draw(renderer: THREE.WebGLRenderer, material: THREE.Material, target: THREE.WebGLRenderTarget | null) {
    this.quad.material = material;
    renderer.setRenderTarget(target);
    this.quad.render(renderer);
  }

  dispose(): void {
    this.a.dispose();
    this.b.dispose();
    this.long.dispose();
    this.short.dispose();
    this.copy.dispose();
    this.quad.dispose();
  }
}

const pass = new GodrayPass();
postfx.addPass(pass, 'scene');

/** 光源（掛在月亮上）：每幀把它的世界座標交給光束效果 */
const GodraySource = define.component('GodraySource', () => ({ radius: 12 }));
const _world = new THREE.Vector3();
ecs.each(
  'godray-source',
  [Transform, GodraySource],
  (_e, t, g) => {
    pass.source = _world.setFromMatrixPosition(t.worldMatrix);
    pass.sourceRadius = g.radius;
  },
  { phase: 'lateUpdate', priority: 1100 }, // 在攝影機與月亮轉向（1000）之後
);

/** 讓這個實體（月亮）發出光束；radius 是圓盤的半徑（世界單位，場景檔 circle 的第一個數字） */
export function addGodrays(world: World, moon: Entity, radius = 12): void {
  world.add(moon, GodraySource, { radius });
}
