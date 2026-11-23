/**
 * 月光光束（god rays）：月亮的光從船身、桅杆、船帆的縫隙間透出來，形成一道道放射狀的光束。
 *
 * 做法（螢幕空間的放射模糊，後製效果，放在色調映射前的高動態範圍階段；TSL 節點）：
 * 1. 取出月亮：畫面中「很亮、又在月亮圓盤附近」的像素（月亮的顏色是 MOON_BRIGHTNESS 倍，遠超過一般物體）；
 *    被船身擋住的部分本來就是暗的，所以遮擋不用另外算
 * 2. 放射模糊：每個像素往月亮的方向取樣、一路累加並逐漸衰減，亮的地方就被拉成一條條光束
 *    （先長距離模糊一次，再短距離模糊一次把取樣的條紋抹平；光束本來就是模糊的，都在四分之一解析度做，
 *    並跟著動態解析度一起降低：全螢幕、高解析度螢幕上也不會拖慢畫面）
 * 3. 疊回原本的畫面
 *
 * 在場景的 setup 裡呼叫 addGodrays(world, 月亮實體)；換場景時月亮被移除，光束自動停止。
 * godraySettings 可以在執行中調整（後製面板的「月光光束」區塊就是改它）。
 */
import { type Entity, type World, define } from '@engine/ecs';
import { Color, MathUtils, Vector2, Vector3 } from '@engine/math';
import { Transform } from '@engine/scene';
import { type PostFxPass, type ShaderNode, tsl } from '@engine/shaders';
import { ecs, postfx, render } from './engine';

const { Fn, Loop, dot, float, fract, length, rtt, screenCoordinate, screenUV, smoothstep, uniform, vec2, vec3, vec4 } =
  tsl;

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
const RAY_COLOR = new Color('#c9d6ff');
/** 亮度門檻：比這個亮才算是月亮（月亮約 10，幽靈約 2～3，一般物體 1 以下） */
const THRESHOLD = 3;
/** 放射模糊的取樣數（第一次長距離、第二次短距離抹平） */
const SAMPLES_LONG = 40;
const SAMPLES_SHORT = 12;
/** 取出月亮、放射模糊的解析度（相對於 3D 畫面） */
const RAY_RESOLUTION = 0.25;

/** 畫面座標：左下 (0,0)（TSL 的 screenUV 是左上 (0,0)；月亮的位置用左下的座標算） */
const flip = (p: ShaderNode) => vec2(p.x, float(1).sub(p.y));

/** 每幀由系統寫入的值 */
const u = {
  moonUv: uniform(new Vector2()),
  moonRadius: uniform(0.05),
  aspect: uniform(1),
  length: uniform(godraySettings.length),
  decay: uniform(godraySettings.decay),
  color: uniform(new Vector3()),
};

/** 1. 取出月亮：亮度超過門檻、且在月亮圓盤附近（排除同樣很亮的幽靈）；亮度壓到固定值 */
function moonMask(scene: ShaderNode): ShaderNode {
  return Fn(() => {
    const p = flip(screenUV);
    // 前一個效果的顏色（這個像素的）：在小的繪製目標裡直接算，不用先把整個畫面複製一份
    const c = scene.rgb;
    const lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
    const bright = smoothstep(THRESHOLD, THRESHOLD * 1.5, lum);
    const d = length(p.sub(u.moonUv).mul(vec2(u.aspect, 1)));
    const near = smoothstep(u.moonRadius.mul(1.1), u.moonRadius.mul(1.5), d).oneMinus();
    return vec4(vec3(bright.mul(near)), 1);
  })();
}

/** 2. 放射模糊：往月亮的方向取樣累加（每個像素不同的起點偏移，避免一圈圈的條紋） */
function radialBlur(tex: ShaderNode, samples: number, len: ShaderNode, decay: ShaderNode): ShaderNode {
  return Fn(() => {
    const p = flip(screenUV);
    const step = p.sub(u.moonUv).mul(len).div(samples);
    const jitter = fract(fract(dot(screenCoordinate.xy, vec2(0.06711056, 0.00583715))).mul(52.9829189));
    const coord = p.sub(step.mul(jitter)).toVar();
    const weight = float(1).toVar();
    const total = float(0).toVar();
    const sum = vec3(0).toVar();
    Loop(samples, () => {
      sum.addAssign(tex.sample(flip(coord)).rgb.mul(weight));
      total.addAssign(weight);
      weight.mulAssign(decay);
      coord.subAssign(step);
    });
    return vec4(sum.div(total), 1);
  })();
}

/** three.js 的攝影機（從 render.activeCameraObject 取型別：遊戲不直接 import three） */
type ViewCamera = NonNullable<typeof render.activeCameraObject>;

/** 光束用的繪製目標（每條後製管線一組；後製會保留用過的管線，切換回來時重複使用） */
const targets = new Set<ShaderNode>();
/** 解析度跟著 3D 畫面（動態解析度降低時一起降低） */
function updateResolution(): void {
  for (const t of targets) t.setResolutionScale(RAY_RESOLUTION * render.renderScale);
}

const _pos = new Vector3();
const _view = new Vector3();

/** 光束效果（後製的自訂效果：apply 拿到畫面，回傳加上光束的畫面） */
const pass: PostFxPass & { source: Vector3 | null; sourceRadius: number } = {
  enabled: true,
  /** 月亮的世界座標；這一幀沒有月亮（場景已卸載）時為 null */
  source: null,
  /** 月亮圓盤的半徑（世界單位） */
  sourceRadius: 12,
  apply(input) {
    const mask = rtt(moonMask(input));
    const long = rtt(radialBlur(mask, SAMPLES_LONG, u.length, u.decay));
    const rays = rtt(radialBlur(long, SAMPLES_SHORT, u.length.mul(0.12), float(1)));
    for (const t of [mask, long, rays]) targets.add(t);
    updateResolution();
    return vec4(input.rgb.add(rays.sample(screenUV).rgb.mul(u.color)), input.a);
  },
};

/** 每幀：算出月亮在畫面上的位置與大小，寫進 uniform（沒有月亮或關閉時光束強度為 0） */
render.onBeforeDraw(() => {
  updateResolution();
  const camera = render.activeCameraObject;
  const fade = pass.source && camera ? project(pass.source, camera) : 0;
  pass.source = null; // 每幀由系統重新設定；沒設定代表月亮已經不在了
  const s = godraySettings;
  u.length.value = s.length;
  u.decay.value = s.decay;
  u.aspect.value = render.aspect;
  // 取樣是平均值（月亮只占一小塊），乘上取樣數讓強度 1 左右就看得清楚
  const gain = s.enabled ? s.intensity * fade * 6 : 0;
  u.color.value.set(RAY_COLOR.r * gain, RAY_COLOR.g * gain, RAY_COLOR.b * gain);
});

/** 算出月亮在畫面上的位置與大小；回傳淡出係數（月亮在鏡頭後方時為 0） */
function project(source: Vector3, camera: ViewCamera): number {
  _view.copy(source).applyMatrix4(camera.matrixWorldInverse);
  if (_view.z >= 0) return 0; // 在鏡頭後方
  _pos.copy(source).project(camera);
  u.moonUv.value.set(_pos.x * 0.5 + 0.5, _pos.y * 0.5 + 0.5);
  // 圓盤半徑投影到畫面上（以畫面高度為 1）
  const fov = (camera as ViewCamera & { fov?: number }).fov ?? 55;
  u.moonRadius.value = pass.sourceRadius / (-_view.z * 2 * Math.tan(MathUtils.degToRad(fov) / 2));
  // 月亮快要轉到鏡頭側面時慢慢淡出（光束方向在那時會變得很極端）
  const facing = -_view.z / _view.length();
  return MathUtils.smoothstep(facing, 0.05, 0.35);
}

postfx.addPass(pass, 'scene');

/** 光源（掛在月亮上）：每幀把它的世界座標交給光束效果 */
const GodraySource = define.component('GodraySource', () => ({ radius: 12 }));
const _world = new Vector3();
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
