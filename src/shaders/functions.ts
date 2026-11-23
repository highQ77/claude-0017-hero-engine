/**
 * 自訂著色器共用的函式（TSL）：雜訊、碎形雜訊、Voronoi、旋轉、形狀距離、調色盤、HSV…
 * 用法和 three.js 的 TSL 函式一樣（參數、回傳值都是節點，也可以傳數字）：
 *
 *   import { shaderFns } from '@engine/shaders';
 *   color: (ctx) => vec4(vec3(shaderFns.fbm2(ctx.uv.mul(4))), 1)
 *
 * 都是一般的 JS 函式，呼叫時直接組出節點（迴圈在 JS 裡展開）。
 */
import { type ShaderNode, tsl } from './tsl';

const { abs, clamp, cos, dot, float, floor, fract, length, max, min, mix, normalize, pow, sin, vec2, vec3 } = tsl;

/** 節點或數字（TSL 函式的參數） */
export type NodeInput = ShaderNode | number;

const n = (v: NodeInput): ShaderNode => (typeof v === 'number' ? float(v) : v);

/** 2D → 0..1 的雜湊（偽亂數） */
export function hash12(p: ShaderNode): ShaderNode {
  let p3 = fract(vec3(p.x, p.y, p.x).mul(0.1031));
  p3 = p3.add(dot(p3, vec3(p3.y, p3.z, p3.x).add(33.33)));
  return fract(p3.x.add(p3.y).mul(p3.z));
}

/** 3D → 0..1 的雜湊（偽亂數） */
export function hash13(p: ShaderNode): ShaderNode {
  let p3 = fract(p.mul(0.1031));
  p3 = p3.add(dot(p3, vec3(p3.z, p3.y, p3.x).add(31.32)));
  return fract(p3.x.add(p3.y).mul(p3.z));
}

/** 2D 值雜訊（0..1，平滑） */
export function noise2(p: ShaderNode): ShaderNode {
  const i = floor(p);
  const f = fract(p);
  const u = f.mul(f).mul(f.mul(-2).add(3));
  const a = hash12(i);
  const b = hash12(i.add(vec2(1, 0)));
  const c = hash12(i.add(vec2(0, 1)));
  const d = hash12(i.add(vec2(1, 1)));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

/** 3D 值雜訊（0..1，平滑） */
export function noise3(p: ShaderNode): ShaderNode {
  const i = floor(p);
  const f = fract(p);
  const u = f.mul(f).mul(f.mul(-2).add(3));
  const h = (x: number, y: number, z: number) => hash13(i.add(vec3(x, y, z)));
  return mix(
    mix(mix(h(0, 0, 0), h(1, 0, 0), u.x), mix(h(0, 1, 0), h(1, 1, 0), u.x), u.y),
    mix(mix(h(0, 0, 1), h(1, 0, 1), u.x), mix(h(0, 1, 1), h(1, 1, 1), u.x), u.y),
    u.z,
  );
}

/** 2D 碎形雜訊（4 層值雜訊疊加，0..1） */
export function fbm2(p: ShaderNode, octaves = 4): ShaderNode {
  let v: ShaderNode = float(0);
  let a = 0.5;
  let total = 0;
  let q = p;
  for (let i = 0; i < octaves; i++) {
    v = v.add(noise2(q).mul(a));
    total += a;
    q = q.mul(2.02);
    a *= 0.5;
  }
  return v.div(total);
}

/** 3D 碎形雜訊（4 層值雜訊疊加，0..1） */
export function fbm3(p: ShaderNode, octaves = 4): ShaderNode {
  let v: ShaderNode = float(0);
  let a = 0.5;
  let total = 0;
  let q = p;
  for (let i = 0; i < octaves; i++) {
    v = v.add(noise3(q).mul(a));
    total += a;
    q = q.mul(2.02);
    a *= 0.5;
  }
  return v.div(total);
}

/** Voronoi（細胞）：到最近細胞中心的距離；t 讓中心移動（例如傳時間） */
export function voronoi(p: ShaderNode, t: NodeInput = 0): ShaderNode {
  const i = floor(p);
  const f = fract(p);
  let d: ShaderNode = float(8);
  for (let y = -1; y <= 1; y++) {
    for (let x = -1; x <= 1; x++) {
      const g = vec2(x, y);
      const o = vec2(hash12(i.add(g)), hash12(i.add(g).add(17)));
      const moved = sin(o.mul(6.2831).add(n(t)))
        .mul(0.5)
        .add(0.5);
      d = min(d, length(g.add(moved).sub(f)));
    }
  }
  return d;
}

/** 數值重新映射：inMin..inMax → outMin..outMax */
export function remap(
  v: NodeInput,
  inMin: NodeInput,
  inMax: NodeInput,
  outMin: NodeInput,
  outMax: NodeInput,
): ShaderNode {
  return n(v).sub(inMin).mul(n(outMax).sub(outMin)).div(n(inMax).sub(inMin)).add(outMin);
}

/** 菲涅耳（邊緣光）：視線與法線越垂直越接近 1 */
export function fresnel(viewDir: ShaderNode, normal: ShaderNode, power: NodeInput = 2): ShaderNode {
  return pow(float(1).sub(clamp(dot(normalize(viewDir), normalize(normal)), 0, 1)), power);
}

/** 旋轉 2D 向量（弧度） */
export function rotate2(p: ShaderNode, angle: NodeInput): ShaderNode {
  const c = cos(n(angle));
  const s = sin(n(angle));
  return vec2(c.mul(p.x).sub(s.mul(p.y)), s.mul(p.x).add(c.mul(p.y)));
}

/** 矩形的距離（中心在原點、半寬高 b；裡面是負的） */
export function sdBox(p: ShaderNode, b: ShaderNode): ShaderNode {
  const d = abs(p).sub(b);
  return length(max(d, 0)).add(min(max(d.x, d.y), 0));
}

/** HSV（色相 0..1、飽和度、明度）→ RGB */
export function hsv2rgb(c: ShaderNode): ShaderNode {
  const p = abs(
    fract(vec3(c.x, c.x, c.x).add(vec3(0, 2 / 3, 1 / 3)))
      .mul(6)
      .sub(3),
  );
  return mix(vec3(1), clamp(p.sub(1), 0, 1), c.y).mul(c.z);
}

/** 餘弦調色盤：a + b * cos(2π(c * t + d))（https://iquilezles.org/articles/palettes/） */
export function palette(t: NodeInput, a: ShaderNode, b: ShaderNode, c: ShaderNode, d: ShaderNode): ShaderNode {
  return a.add(b.mul(cos(c.mul(n(t)).add(d).mul(6.28318))));
}

/** 所有共用函式（自訂著色器的 ctx.fn 也是這一份） */
export const shaderFns = {
  /** 2D → 0..1 的雜湊（偽亂數） */
  hash12,
  /** 3D → 0..1 的雜湊（偽亂數） */
  hash13,
  /** 2D 值雜訊（0..1，平滑） */
  noise2,
  /** 3D 值雜訊（0..1，平滑） */
  noise3,
  /** 2D 碎形雜訊（0..1） */
  fbm2,
  /** 3D 碎形雜訊（0..1） */
  fbm3,
  /** Voronoi：到最近細胞中心的距離 */
  voronoi,
  /** 數值重新映射 */
  remap,
  /** 菲涅耳（邊緣光） */
  fresnel,
  /** 旋轉 2D 向量（弧度） */
  rotate2,
  /** 矩形的距離 */
  sdBox,
  /** HSV → RGB */
  hsv2rgb,
  /** 餘弦調色盤 */
  palette,
} as const;
