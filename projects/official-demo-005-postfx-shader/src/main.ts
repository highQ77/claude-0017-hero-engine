/**
 * official-demo-005-postfx-shader：後製與著色器。
 *
 * 四個分頁，每一頁是一個場景（切換分頁時換場景）：
 *   ① 後製效果（postfx）：色調映射、曝光、光暈、景深（點物件對焦）、暗角、底片顆粒、環境光遮蔽、調色；風格預設
 *   ② 自訂材質（materials）：內建的溶解、全像投影、波浪；自己寫的條紋（shaders.update 熱更新）
 *   ③ 全螢幕效果（effects）：內建的像素化、色差、雨落窗；自己寫的錄影帶、夜視鏡
 *   ④ 節點圖（graph）：用程式組節點圖，編譯成著色器
 *
 * 介面在 public/ui/scene.xml。後製只套用在 3D 畫面，介面在後製之後才疊上去，不受影響。
 */
import type { Entity, World } from '@engine/ecs';
import { Color, Vector3 } from '@engine/math';
import { PluginManager } from '@engine/plugins';
import perfMonitor from '@engine/packages/perf-monitor';
import { create as postfxCreate } from '@engine/postfx';
import { OrbitControl, spawn } from '@engine/render';
import { type Scene, Transform, math } from '@engine/scene';
import {
  type CustomEffect,
  type EffectDefinition,
  EffectPresets,
  SHADER_GRAPH_FORMAT,
  type ShaderGraph,
  type ShaderContext,
  ShaderPresets,
  compileShaderGraph,
  shaderGraphDefinition,
  tsl,
} from '@engine/shaders';
import * as ui2d from '@engine/ui2d';
import type { UIButton, UILabel, UISelect, UISlider, UIStackView, UIToggle } from '@engine/ui2d';
import { engine, input, postfx, render, scenes, shaders, ui, world } from './engine';

type Vec3 = [number, number, number];

// ───────── 共用 ─────────

for (const e of Object.values(spawn.defaultLights(world, { shadows: true }))) scenes.persist(e);

/** 每幀要做的事（只在目前這一頁執行；換頁時清掉） */
let pageUpdate: ((dt: number, elapsed: number) => void) | null = null;
engine.on('update', (time) => pageUpdate?.(time.delta, time.elapsed));

const setBackground = (color: string) => (render.scene.background = new Color(color));

/** 可以用滑鼠轉動的攝影機；左邊的說明面板會擋住畫面左側，所以整個往左移一點，場景才會在右邊 */
function camera(position: Vec3, target: Vec3): Entity {
  const eye = new Vector3(...position);
  const look = new Vector3(...target);
  const shift = look
    .clone()
    .sub(eye)
    .cross(new Vector3(0, 1, 0))
    .normalize()
    .multiplyScalar(-0.15 * eye.distanceTo(look));
  eye.add(shift);
  look.add(shift);
  const cam = spawn.camera(world, { position: eye, target: look, fov: 50 });
  world.add(cam, OrbitControl, { target: look, minDistance: 3, maxDistance: 25, wheelNeedsFocus: true });
  return cam;
}

const floor = (w: World, color: string) =>
  spawn.mesh(w, {
    geometry: { circle: 12 },
    material: { standard: { color, roughness: 0.35, metalness: 0.2 } },
    rotation: [-Math.PI / 2, 0, 0],
    receiveShadow: true,
  });

/** 點一下畫面（按下到放開幾乎沒移動）；拖曳是轉動視角，不算點擊 */
let press: { x: number; y: number } | null = null;
function clicked(): boolean {
  if (input.wasPressed('Mouse:Left')) press = { x: input.pointer.x, y: input.pointer.y };
  if (!input.wasReleased('Mouse:Left') || !press) return false;
  const moved = Math.hypot(input.pointer.x - press.x, input.pointer.y - press.y);
  press = null;
  return moved < 6;
}

/** 後製設定全部回到預設（每一頁進來時先重設，再加上這一頁要的效果） */
function resetFx(): void {
  const d = postfxCreate.postFxSettings();
  const s = postfx.settings;
  s.toneMapping = d.toneMapping;
  s.exposure = d.exposure;
  for (const key of ['bloom', 'ao', 'dof', 'film', 'vignette', 'color'] as const) Object.assign(s[key], d[key]);
}

// ───────── ① 後製效果 ─────────

let focusNames = new Map<Entity, string>();
/** 開啟景深時預設對焦的物件（金屬結） */
let focusDefault: Entity | null = null;

const postfxPage: Scene = {
  name: 'postfx',
  setup(w) {
    setBackground('#07090d');
    floor(w, '#14171c');
    focusNames = new Map();
    // 會發光的霓虹環（emissive 很亮 → 光暈）
    const rings = ['#ff3d7f', '#3dd6ff', '#b4ff3d'].map((color, i) => {
      const e = spawn.mesh(w, {
        geometry: { torus: [0.9, 0.07] },
        material: { standard: { color: '#111111', emissive: color, emissiveIntensity: 4 } },
        position: [(i - 1) * 2.4, 1.3, -1],
        castShadow: true,
      });
      focusNames.set(e, ['粉紅環', '藍環', '綠環'][i]);
      return e;
    });
    // 金屬結、前後排的方塊（看景深的前後模糊）
    const knot = spawn.mesh(w, {
      geometry: { torusKnot: [0.6, 0.2] },
      material: { standard: { color: '#c8ccd8', roughness: 0.25, metalness: 0.35 } }, // 太金屬的話，暗場景裡沒有東西可以反射，會變成黑色
      position: [0, 1.2, 2],
      castShadow: true,
    });
    focusNames.set(knot, '金屬結');
    focusDefault = knot;
    for (let i = 0; i < 7; i++) {
      const e = spawn.mesh(w, {
        geometry: { box: 0.7 },
        material: { standard: { color: `hsl(${i * 45}, 60%, 55%)`, roughness: 0.5 } },
        position: [-4 + i * 1.3, 0.35, 4 - i * 1.6],
        castShadow: true,
        receiveShadow: true,
      });
      focusNames.set(e, `方塊 ${i + 1}`);
    }
    // 小燈泡（很亮的小球）
    for (let i = 0; i < 12; i++)
      spawn.mesh(w, {
        geometry: { sphere: 0.07 },
        material: { basic: { color: new Color('#ffd166').multiplyScalar(4) } },
        position: [Math.cos(i * 0.52) * 5, 0.3 + (i % 3) * 0.4, Math.sin(i * 0.52) * 5 - 2],
      });
    const cam = camera([0, 3, 9], [0, 1, 0]);
    resetFx();
    syncControls();
    applyFx();
    pageUpdate = (dt) => {
      rings.forEach((e, i) => math.rotate(w.require(e, Transform), [dt * (0.6 + i * 0.2), dt * 0.4, 0]));
      math.rotate(w.require(knot, Transform), [0, dt * 0.5, 0]);
      // 景深：點畫面上的物件對焦（dof.focusOn 讓對焦距離每幀跟著那個物件）
      if (postfx.settings.dof.enabled && clicked()) {
        const hit = render.pick(input.pointer.ndcX, input.pointer.ndcY);
        const dof = postfx.settings.dof;
        if (hit && focusNames.has(hit.entity)) {
          dof.focusOn = hit.entity; // 跟著物件：物件移動時對焦距離也跟著變
          ui.toast(`對焦：${focusNames.get(hit.entity)}`, { icon: 'target', color: '#9fe0ff' });
        } else if (hit) {
          dof.focusOn = null;
          dof.focus = hit.distance; // 地板等：固定對焦在這個距離
          ui.toast(`對焦距離 ${hit.distance.toFixed(1)} 公尺`, { icon: 'target', color: '#9fe0ff' });
        }
      }
    };
    // 效果清單（實際用到的處理步驟）每 0.5 秒更新
    engine.timers.every(0.5, () => ui.get<UILabel>('passes')?.setText(`處理步驟：${postfx.passNames.join(' → ')}`), {
      owner: cam,
    });
  },
};

/** 左邊的控制項 → postfx.settings */
function applyFx(): void {
  const s = postfx.settings;
  const toggle = (id: string) => ui.require<UIToggle>(id).checked;
  const slider = (id: string) => ui.require<UISlider>(id).value;
  s.toneMapping = ui.require<UISelect>('toneMapping').value as typeof s.toneMapping;
  s.exposure = slider('exposure');
  s.bloom.enabled = toggle('bloom');
  s.bloom.strength = slider('bloomStrength');
  s.bloom.threshold = slider('bloomThreshold');
  const dofWasOn = s.dof.enabled;
  s.dof.enabled = toggle('dof');
  if (s.dof.enabled && !dofWasOn && s.dof.focusOn === null) s.dof.focusOn = focusDefault; // 剛打開：先對焦在金屬結
  s.dof.aperture = slider('aperture');
  s.vignette.enabled = toggle('vignette');
  s.film.enabled = toggle('film') || toggle('grayscale');
  s.film.grayscale = toggle('grayscale');
  s.ao.enabled = toggle('ao');
  s.color.saturation = slider('saturation');
  s.color.contrast = slider('contrast');
  s.color.enabled = s.color.saturation !== 1 || s.color.contrast !== 1 || new Color(s.color.tint).getHex() !== 0xffffff;
}

/** 控制項的值（風格預設會整組換掉） */
interface Look {
  toneMapping: string;
  exposure: number;
  bloom: boolean;
  bloomStrength: number;
  bloomThreshold: number;
  dof: boolean;
  aperture: number;
  vignette: boolean;
  film: boolean;
  grayscale: boolean;
  ao: boolean;
  saturation: number;
  contrast: number;
  tint: string;
}
const LOOKS: Record<string, Look> = {
  none: {
    toneMapping: 'aces',
    exposure: 1,
    bloom: false,
    bloomStrength: 0.8,
    bloomThreshold: 0.6,
    dof: false,
    aperture: 0.012,
    vignette: false,
    film: false,
    grayscale: false,
    ao: false,
    saturation: 1,
    contrast: 1,
    tint: '#ffffff',
  },
  neon: {
    toneMapping: 'aces',
    exposure: 1,
    bloom: true,
    bloomStrength: 1.1,
    bloomThreshold: 0.6,
    dof: false,
    aperture: 0.012,
    vignette: true,
    film: false,
    grayscale: false,
    ao: false,
    saturation: 1.35,
    contrast: 1.1,
    tint: '#ffffff',
  },
  film: {
    toneMapping: 'agx',
    exposure: 1,
    bloom: true,
    bloomStrength: 0.5,
    bloomThreshold: 0.7,
    dof: true,
    aperture: 0.008,
    vignette: true,
    film: true,
    grayscale: false,
    ao: true,
    saturation: 0.85,
    contrast: 1.15,
    tint: '#ffe8cc',
  },
  retro: {
    toneMapping: 'reinhard',
    exposure: 1.2,
    bloom: false,
    bloomStrength: 0.8,
    bloomThreshold: 0.6,
    dof: false,
    aperture: 0.012,
    vignette: true,
    film: true,
    grayscale: true,
    ao: false,
    saturation: 1,
    contrast: 1.3,
    tint: '#ffffff',
  },
};
let look: Look = LOOKS.none;

/** 風格預設的值寫回控制項（開關、滑桿、選單） */
function syncControls(): void {
  ui.require<UISelect>('toneMapping').value = look.toneMapping;
  for (const id of ['bloom', 'dof', 'vignette', 'film', 'grayscale', 'ao'] as const)
    ui.require<UIToggle>(id).checked = look[id];
  for (const id of ['exposure', 'bloomStrength', 'bloomThreshold', 'saturation', 'contrast'] as const)
    ui.require<UISlider>(id).value = look[id];
  ui.require<UISlider>('aperture').value = look.aperture;
  postfx.settings.color.tint = look.tint;
}

function usePreset(name: string): void {
  look = LOOKS[name];
  syncControls();
  applyFx();
}

// ───────── ② 自訂材質 ─────────

// 內建的範例著色器：先註冊，之後用 shaders.createMaterial(名稱) 建立
shaders
  .define(ShaderPresets.dissolve({ color: '#ffa94f', roughness: 0.35 }))
  .define(ShaderPresets.hologram())
  .define(ShaderPresets.wave({ color: '#4cc9f0', roughness: 0.3, side: 2 /* 雙面 */ }));

const { dot, fract, length, mix, sin, smoothstep, step, vec2, vec3, vec4 } = tsl;

// 自己寫的條紋材質（unlit：顏色完全由程式決定；TSL 節點）
/** 條紋：橫線或斜線（熱更新時換成另一個） */
const stripes = (diagonal: boolean) => (c: ShaderContext) => {
  const u = c.uniforms;
  const along = diagonal ? c.uv.x.add(c.uv.y) : c.uv.y;
  const s = step(0.5, fract(along.mul(u.count).add(c.time.mul(u.speed))));
  return vec4(mix(u.colorA, u.colorB, s), 1);
};
const STRIPES_H = stripes(false);
const STRIPES_D = stripes(true);
shaders.define({
  name: 'stripes',
  base: 'unlit',
  uniforms: { colorA: new Color('#ff6b6b'), colorB: new Color('#ffd166'), count: 12, speed: 0.5 },
  color: STRIPES_H,
});
let diagonal = false;

let mats: {
  dissolve: ReturnType<typeof shaders.createMaterial>;
  wave: ReturnType<typeof shaders.createMaterial>;
  stripes: ReturnType<typeof shaders.createMaterial>;
} | null = null;

const materialsPage: Scene = {
  name: 'materials',
  setup(w) {
    setBackground('#0e1116');
    floor(w, '#1c2026');
    const dissolve = shaders.createMaterial('dissolve');
    const wave = shaders.createMaterial('wave');
    const stripes = shaders.createMaterial('stripes');
    mats = { dissolve, wave, stripes };
    const knot = spawn.mesh(w, {
      geometry: { torusKnot: [0.65, 0.22, 128, 24] },
      material: dissolve,
      position: [-3.4, 1.3, 0],
      castShadow: true,
    });
    const ball = spawn.mesh(w, {
      geometry: { sphere: [0.85, 48, 32] },
      material: stripes,
      position: [-1, 1.2, 0],
      castShadow: true,
    });
    // 全像投影：一個人形（膠囊 + 頭），加上底座
    spawn.mesh(w, {
      geometry: { cylinder: [0.6, 0.12] },
      material: '#2a3140',
      position: [1.3, 0.06, 0],
      receiveShadow: true,
    });
    spawn.mesh(w, {
      geometry: { capsule: [0.32, 0.7] },
      material: shaders.createMaterial('hologram'),
      position: [1.3, 0.85, 0],
    });
    spawn.mesh(w, {
      geometry: { sphere: 0.26 },
      material: shaders.createMaterial('hologram'),
      position: [1.3, 1.65, 0],
    });
    // 波浪：分段很多的平面（頂點才能動）
    spawn.mesh(w, {
      geometry: { plane: [2, 1.4, 48, 32] },
      material: wave,
      position: [3.6, 1.3, 0],
      rotation: [0, -0.4, 0],
    });
    camera([0, 2.6, 8], [0, 1.1, 0]);
    // 光暈讓溶解的邊緣、全像投影發亮
    resetFx();
    Object.assign(postfx.settings.bloom, { enabled: true, strength: 0.8, threshold: 0.75 });
    applyMaterialUniforms();
    pageUpdate = (dt, elapsed) => {
      math.rotate(w.require(knot, Transform), [0, dt * 0.4, 0]);
      math.rotate(w.require(ball, Transform), [0, dt * 0.3, 0]);
      // 自動來回：progress 在 0~1 之間來回
      if (ui.require<UIToggle>('dissolveAuto').checked)
        dissolve.uniforms.progress.value = 0.5 - 0.5 * Math.cos(elapsed * 0.8);
    };
  },
  teardown() {
    mats = null;
  },
};

function applyMaterialUniforms(): void {
  if (!mats) return;
  if (!ui.require<UIToggle>('dissolveAuto').checked)
    mats.dissolve.uniforms.progress.value = ui.require<UISlider>('dissolve').value;
  mats.wave.uniforms.amplitude.value = ui.require<UISlider>('waveAmp').value;
  mats.stripes.uniforms.count.value = ui.require<UISlider>('stripes').value;
}

// ───────── ③ 全螢幕效果 ─────────

/** 偽亂數：0..1 */
const rand = (p: ReturnType<typeof vec2>) => fract(sin(dot(p, vec2(12.9898, 78.233))).mul(43758.5453));

/** 自己寫的效果（TSL）：c.color 是這個像素原本的顏色，c.sample(uv) 讀整張畫面，c.uv 是座標 */
const VHS: EffectDefinition = {
  name: 'vhs',
  uniforms: { shift: 0.006, noise: 0.08 },
  color: (c) => {
    const { uv, uniforms: u } = c;
    const wobble = sin(uv.y.mul(40).add(c.time.mul(3))).mul(0.0015);
    const r = c.sample(uv.add(vec2(u.shift.add(wobble), 0))).r;
    const b = c.sample(uv.sub(vec2(u.shift.sub(wobble), 0))).b;
    let rgb = vec3(r, c.color.g, b).add(
      rand(uv.add(fract(c.time)))
        .sub(0.5)
        .mul(u.noise),
    );
    rgb = rgb.mul(sin(uv.y.mul(c.resolution.y).mul(1.5)).mul(0.08).add(0.92));
    return vec4(rgb, c.color.a);
  },
};
const NIGHT_VISION: EffectDefinition = {
  name: 'nightVision',
  uniforms: { gain: 2.2 },
  color: (c) => {
    const { uv, resolution: res } = c;
    let lum = dot(c.color.rgb, vec3(0.299, 0.587, 0.114)).mul(c.uniforms.gain);
    lum = lum.add(rand(uv.mul(res).add(c.time)).sub(0.5).mul(0.15));
    lum = lum.mul(
      sin(uv.y.mul(res.y).mul(0.8).add(c.time.mul(10)))
        .mul(0.15)
        .add(0.85),
    );
    const ring = smoothstep(0.75, 0.35, length(uv.sub(0.5).mul(vec2(res.x.div(res.y), 1))));
    return vec4(vec3(0.15, 1, 0.3).mul(lum).mul(ring), 1);
  },
};
shaders
  .defineEffect(EffectPresets.pixelate())
  .defineEffect(EffectPresets.chromaticAberration())
  .defineEffect(EffectPresets.rainOnWindow())
  .defineEffect(VHS)
  .defineEffect(NIGHT_VISION);

/** 每個效果在滑桿上調整的 uniform */
const EFFECTS: Record<
  string,
  { uniform: string; label: string; min: number; max: number; step: number; value: number; desc: string }
> = {
  pixelate: {
    uniform: 'pixelSize',
    label: '像素大小（pixelSize）',
    min: 2,
    max: 24,
    step: 1,
    value: 6,
    desc: '把畫面切成格子，每格取中間的顏色。',
  },
  chromaticAberration: {
    uniform: 'amount',
    label: '偏移量（amount）',
    min: 0,
    max: 0.02,
    step: 0.0005,
    value: 0.006,
    desc: '紅、藍通道往外偏，越靠邊越明顯，像便宜的鏡頭。',
  },
  rainOnWindow: {
    uniform: 'amount',
    label: '雨量（amount）',
    min: 0,
    max: 1,
    step: 0.05,
    value: 0.7,
    desc: '像隔著淋雨、起霧的玻璃看出去。',
  },
  vhs: {
    uniform: 'shift',
    label: '色偏（shift）',
    min: 0,
    max: 0.03,
    step: 0.001,
    value: 0.006,
    desc: '色偏 + 雜訊 + 掃描線 + 輕微抖動（自己寫的）。',
  },
  nightVision: {
    uniform: 'gain',
    label: '亮度增益（gain）',
    min: 0.5,
    max: 5,
    step: 0.1,
    value: 2.2,
    desc: '轉成亮度、乘上綠色，加上雜訊與圓形視野（自己寫的）。',
  },
};
let effect: CustomEffect | null = null;

function useEffect(name: string): void {
  if (effect) postfx.removePass(effect);
  effect = null;
  const cfg = EFFECTS[name];
  ui.require('effectParam').visible = !!cfg;
  ui.require('effectValue').visible = !!cfg;
  if (!cfg) {
    ui.require<UILabel>('effectDesc').setText('沒有套用效果。');
    return;
  }
  effect = shaders.createEffect(name);
  postfx.addPass(effect, 'display'); // display：在色調映射之後，處理最終看到的顏色
  const slider = ui.require<UISlider>('effectValue');
  slider.set('min', cfg.min).set('max', cfg.max).set('step', cfg.step);
  slider.value = cfg.value;
  effect.uniforms[cfg.uniform].value = cfg.value;
  ui.require<UILabel>('effectParam').setText(cfg.label);
  ui.require<UILabel>('effectDesc').setText(cfg.desc);
}

const effectsPage: Scene = {
  name: 'effects',
  setup(w) {
    setBackground('#1a2230');
    floor(w, '#2a3324');
    const items: Entity[] = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      items.push(
        spawn.mesh(w, {
          geometry: i % 2 ? { box: 0.9 } : { icosahedron: 0.6 },
          material: { standard: { color: `hsl(${i * 45}, 75%, 58%)`, roughness: 0.4 } },
          position: [Math.cos(a) * 3, 0.8, Math.sin(a) * 3],
          castShadow: true,
        }),
      );
    }
    spawn.mesh(w, {
      geometry: { torusKnot: [0.8, 0.25] },
      material: { standard: { color: '#ffffff', roughness: 0.2, metalness: 0.6 } },
      position: [0, 1.4, 0],
      castShadow: true,
    });
    spawn.grid(w, { size: 24, divisions: 24, color: '#3a4430', position: [0, 0.01, 0] });
    camera([0, 3.5, 9], [0, 1, 0]);
    resetFx();
    useEffect(ui.require<UISelect>('effect').value);
    pageUpdate = (dt) =>
      items.forEach((e, i) => math.rotate(w.require(e, Transform), [dt * 0.5, dt * (0.3 + i * 0.05), 0]));
  },
  teardown() {
    if (effect) postfx.removePass(effect);
    effect = null;
  },
};

// ───────── ④ 節點圖 ─────────

/** 建立節點與連線的小工具（x、y 只是編輯器裡的位置） */
const node = (id: number, type: string, values: Record<string, number> = {}, params: Record<string, string> = {}) => ({
  id,
  type,
  x: (id - 1) * 160,
  y: 0,
  values,
  params,
});
const link = (from: number, fromPort: string, to: number, toPort: string) => ({ from, fromPort, to, toPort });

const GRAPHS: Record<string, { title: string; chain: string; graph: ShaderGraph }> = {
  rainbow: {
    title: '彩虹雜訊',
    chain: '① uv → fbm 雜訊\n② 時間 × 0.15\n①＋② → 調色盤 → 輸出',
    graph: {
      nodes: [
        node(1, 'uv'),
        node(2, 'time'),
        node(3, 'fbm', { scale: 3 }),
        node(4, 'multiply', { b: 0.15 }),
        node(5, 'add'),
        node(6, 'palette', {}, { preset: 'rainbow' }),
        node(7, 'output', { alpha: 1 }),
      ],
      links: [
        link(1, 'uv', 3, 'uv'),
        link(2, 'time', 4, 'a'),
        link(3, 'out', 5, 'a'),
        link(4, 'out', 5, 'b'),
        link(5, 'out', 6, 't'),
        link(6, 'rgb', 7, 'color'),
      ],
      nextId: 8,
    },
  },
  cells: {
    title: '細胞',
    chain: '① uv、時間 → voronoi 細胞距離\n② 深藍、淺藍\n用 ① 混合 ② → 輸出',
    graph: {
      nodes: [
        node(1, 'uv'),
        node(2, 'time'),
        node(3, 'voronoi', { scale: 5 }),
        node(4, 'color', {}, { color: '#10203a' }),
        node(5, 'color', {}, { color: '#9fe0ff' }),
        node(6, 'mix'),
        node(7, 'output', { alpha: 1 }),
      ],
      links: [
        link(1, 'uv', 3, 'uv'),
        link(2, 'time', 3, 'time'),
        link(4, 'rgb', 6, 'a'),
        link(5, 'rgb', 6, 'b'),
        link(3, 'd', 6, 't'),
        link(6, 'out', 7, 'color'),
      ],
      nextId: 8,
    },
  },
  rim: {
    title: '邊緣光',
    chain: '① fresnel（越靠邊越接近 1）\n② 暗綠、亮綠\n用 ① 混合 ② → 輸出',
    graph: {
      nodes: [
        node(1, 'fresnel', { power: 2.5 }),
        node(2, 'color', {}, { color: '#0a1a12' }),
        node(3, 'color', {}, { color: '#c8ff6a' }),
        node(4, 'mix'),
        node(5, 'output', { alpha: 1 }),
      ],
      links: [link(2, 'rgb', 4, 'a'), link(3, 'rgb', 4, 'b'), link(1, 'out', 4, 't'), link(4, 'out', 5, 'color')],
      nextId: 6,
    },
  },
};

let showGraph: (key: string) => void = () => {};

const graphPage: Scene = {
  name: 'graph',
  setup(w) {
    setBackground('#0e1116');
    floor(w, '#1c2026');
    camera([0, 2.4, 7], [0, 1.2, 0]);
    resetFx();
    let shown: Entity[] = [];
    showGraph = (key) => {
      const g = GRAPHS[key];
      for (const e of shown) w.destroy(e);
      // 節點圖 → 著色器定義 → 材質（每次建立新的材質，換圖時把舊的物件刪掉重建）
      const file = { format: SHADER_GRAPH_FORMAT, version: 1, graph: g.graph } as const;
      const material = shaders.createFromDefinition(shaderGraphDefinition(file, `graph_${key}`));
      shown = [
        spawn.mesh(w, { geometry: { sphere: [1, 64, 32] }, material, position: [-1.4, 1.2, 0], castShadow: true }),
        spawn.mesh(w, {
          geometry: { torusKnot: [0.6, 0.2, 128, 24] },
          material,
          position: [1.4, 1.2, 0],
          castShadow: true,
        }),
      ];
      ui.require<UILabel>('graphNodes').setText(`${g.title}：\n${g.chain}`);
      // 編譯的結果：節點圖變成 TSL 節點（three.js 再產生 WGSL；著色器編輯器的「程式碼」分頁看得到完整的程式）
      const c = compileShaderGraph(g.graph);
      ui.require<UILabel>('graphCode').setText(
        [
          `種類：${c.kind === 'effect' ? '全螢幕效果' : '材質'}`,
          `節點：${g.graph.nodes.length} 個、連線 ${g.graph.links.length} 條`,
          `頂點位移：${c.position ? '有' : '沒有'}`,
          `半透明：${c.transparent ? '是' : '否'}、畫${c.side === 'double' ? '兩面' : c.side === 'back' ? '背面' : '正面'}`,
          `貼圖：${c.textures.length} 張`,
        ].join('\n'),
      );
    };
    showGraph('rainbow');
    pageUpdate = (dt) => shown.forEach((e) => math.rotate(w.require(e, Transform), [0, dt * 0.4, 0]));
  },
};

// ───────── 分頁切換 ─────────

scenes.register(postfxPage, materialsPage, effectsPage, graphPage);
let currentPage = '';
function showPage(name: string): void {
  if (name === currentPage) return;
  pageUpdate = null;
  currentPage = name;
  scenes.load(name);
}

ui.setHandlers({
  page: () => showPage(ui.require<UIStackView>('pages').selectedPage?.id ?? 'postfx'),
  // ① 後製
  fx: () => applyFx(),
  presetNone: () => usePreset('none'),
  presetNeon: () => usePreset('neon'),
  presetFilm: () => usePreset('film'),
  presetRetro: () => usePreset('retro'),
  // ② 材質
  materialUniforms: (e) => {
    // 手動拖溶解的滑桿：關掉自動來回
    if ((e.target as { id?: string | null }).id === 'dissolve') ui.require<UIToggle>('dissolveAuto').checked = false;
    applyMaterialUniforms();
  },
  hotSwap: () => {
    diagonal = !diagonal;
    // 執行中修改著色器程式：所有用到 stripes 的材質重新編譯，uniform 的值保留
    shaders.update('stripes', { color: diagonal ? STRIPES_D : STRIPES_H });
    ui.require<UIButton>('hotSwap').setText(
      diagonal ? '熱更新：改回橫線（shaders.update）' : '熱更新：改成斜線（shaders.update）',
    );
  },
  // ③ 全螢幕效果
  effect: (e) => useEffect(String(e.value)),
  effectValue: (e) => {
    const cfg = EFFECTS[ui.require<UISelect>('effect').value];
    if (effect && cfg) effect.uniforms[cfg.uniform].value = Number(e.value);
  },
  // ④ 節點圖
  graphRainbow: () => showGraph('rainbow'),
  graphCells: () => showGraph('cells'),
  graphRim: () => showGraph('rim'),
});

// 效能監視器：按 ` 鍵顯示／隱藏（後製很吃效能，打開看看每個效果的成本）
await new PluginManager(engine, { api: { ui2d } }).install(perfMonitor, {
  toggleKey: 'Backquote',
  visible: false,
  position: { bottom: 16, right: 16 },
});

showPage('postfx');
engine.start();

// 預先編譯風格預設用到的效果組合：第一次切換風格時就不會頓一下（每幀一個，在看不見的小緩衝區畫一次）
void postfx.prewarm(
  Object.values(LOOKS).map((l) => ({
    toneMapping: l.toneMapping as 'aces',
    bloom: { enabled: l.bloom },
    dof: { enabled: l.dof },
    vignette: { enabled: l.vignette },
    film: { enabled: l.film || l.grayscale, grayscale: l.grayscale },
    ao: { enabled: l.ao },
    color: { enabled: l.saturation !== 1 || l.contrast !== 1 || l.tint !== '#ffffff' },
  })),
);
