import * as THREE from 'three';
import type { EffectDefinition, ShaderDefinition } from './ShaderLibrary';
import { type ShaderNode, tsl } from './tsl';

const {
  Discard,
  If,
  abs,
  clamp,
  cos,
  dot,
  float,
  floor,
  fract,
  materialColor,
  materialOpacity,
  max,
  min,
  mix,
  normalize,
  pow,
  select,
  sin,
  smoothstep,
  sqrt,
  step,
  vec2,
  vec3,
  vec4,
} = tsl;

/**
 * 內建範例著色器（TSL）。可以直接使用，也是自己撰寫時的參考。
 * 使用前先註冊：shaders.define(ShaderPresets.dissolve())
 */
export const ShaderPresets = {
  /**
   * 溶解：依雜訊逐漸消失，邊緣發光。保留標準材質的光照與陰影。
   * uniform progress：0 完整、1 完全消失
   */
  dissolve: (options: Record<string, unknown> = {}): ShaderDefinition => {
    /** 這個像素的雜訊值與邊緣亮度（color、emissive 都用） */
    const edge = (c: Parameters<NonNullable<ShaderDefinition['color']>>[0]) => {
      const u = c.uniforms;
      const n = c.fn.fbm3(c.worldPosition.mul(u.noiseScale));
      const glow = float(1)
        .sub(smoothstep(u.progress, u.progress.add(u.edgeWidth), n))
        .mul(step(0.001, u.progress)); // progress 為 0 時沒有邊緣
      return { n, glow };
    };
    return {
      name: 'dissolve',
      base: 'standard',
      options,
      uniforms: {
        progress: 0,
        edgeWidth: 0.08,
        edgeColor: new THREE.Color(1, 0.45, 0.1),
        noiseScale: 2.5,
      },
      color: (c) => {
        If(edge(c).n.lessThan(c.uniforms.progress), () => {
          Discard();
        });
        return vec4(materialColor, materialOpacity);
      },
      emissive: (c) => c.uniforms.edgeColor.mul(edge(c).glow).mul(6),
    };
  },

  /**
   * 全像投影：邊緣發光、掃描線、閃爍，半透明疊加。
   */
  hologram: (): ShaderDefinition => ({
    name: 'hologram',
    base: 'unlit',
    options: { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide },
    uniforms: {
      tint: new THREE.Color(0.2, 0.8, 1.0),
      scanDensity: 40,
      intensity: 1.5,
    },
    color: (c) => {
      const u = c.uniforms;
      const rim = c.fn.fresnel(c.viewDir, c.worldNormal, 2);
      const scan = sin(c.worldPosition.y.mul(u.scanDensity).sub(c.time.mul(6)))
        .mul(0.4)
        .add(0.6);
      const flicker = c.fn
        .noise2(vec2(c.time.mul(12), 0))
        .mul(0.15)
        .add(0.85);
      const alpha = rim.add(0.15).mul(scan).mul(flicker);
      return vec4(u.tint.mul(u.intensity), alpha);
    },
  }),

  /**
   * 波浪：頂點隨時間上下起伏（法線不會重新計算，適合旗子、水面等平面）。
   */
  wave: (options: Record<string, unknown> = {}): ShaderDefinition => ({
    name: 'wave',
    base: 'standard',
    options,
    uniforms: { amplitude: 0.15, frequency: 3, speed: 2 },
    position: (c) => {
      const u = c.uniforms;
      const p = c.position;
      const t = c.time.mul(u.speed);
      const dz = sin(p.x.mul(u.frequency).add(t))
        .mul(u.amplitude)
        .add(
          cos(p.y.mul(u.frequency).mul(0.7).add(t.mul(1.3)))
            .mul(u.amplitude)
            .mul(0.5),
        );
      return vec3(p.x, p.y, p.z.add(dz));
    },
  }),
};

// ───────── 雨落窗用的函式（和原本的 GLSL 一樣的算法；if／continue 改成乘上 0 或 1） ─────────

function rainHash(p: ShaderNode): ShaderNode {
  let q = fract(p.mul(vec2(233.34, 851.73)));
  q = q.add(dot(q, q.add(23.45)));
  return fract(q.x.mul(q.y));
}

/** 水滴到目前為止滑了多遠：一直往下，速度忽快忽慢 */
function rainFall(t: ShaderNode, seed: ShaderNode): ShaderNode {
  const v = seed.mul(0.35).add(0.3);
  const w = seed.mul(1.8).add(1.2);
  return t.mul(v).add(
    v
      .div(w)
      .mul(0.85)
      .mul(sin(t.mul(w).add(seed.mul(6.2831)))),
  );
}

/** 水滴在玻璃上走的路線：高度 y 時的水平位置 */
function rainPath(y: ShaderNode, seed: ShaderNode): ShaderNode {
  return seed
    .sub(0.5)
    .mul(0.3)
    .add(sin(y.mul(2.1).add(seed.mul(40))).mul(0.06))
    .add(sin(y.mul(5.3).add(seed.mul(17))).mul(0.035));
}

/** 球冠的高度：中心 1、半徑 r 以外 0（r 為 0 時是 0） */
function cap(d: ShaderNode, r: ShaderNode): ShaderNode {
  const rr = max(r.mul(r), 1e-8);
  return sqrt(clamp(float(1).sub(dot(d, d).div(rr)), 0, 1)).mul(step(1e-6, r));
}

/** 一層往下滑的大水滴：vec2(水的高度，水滴剛擦過的範圍) */
function rainSliding(p: ShaderNode, t: ShaderNode, amount: ShaderNode): ShaderNode {
  const col = floor(p.x);
  const lx = fract(p.x).sub(0.5);
  const fall = rainFall(t, rainHash(vec2(col, 7.7)));
  const spanY = 3;
  const trailLen = spanY * 0.8;
  const cell = floor(p.y.add(fall).div(spanY));
  let h: ShaderNode = float(0);
  let wiped: ShaderNode = float(0);
  for (let k = 0; k < 2; k++) {
    const id = cell.sub(k);
    const s = rainHash(vec2(col, id));
    const has = step(s, amount); // 雨量少：有些位置沒有水滴
    const dropY = id
      .add(0.5)
      .add(rainHash(vec2(id, col)).sub(0.5).mul(0.5))
      .mul(spanY)
      .sub(fall);
    const rn = rainHash(vec2(id.mul(3.1), col));
    const r = rn.mul(rn).mul(0.09).add(0.06);
    const dx = lx.sub(rainPath(dropY, s));
    const dy = p.y.sub(dropY);
    const d = vec2(dx, select(dy.greaterThan(0), dy.mul(0.85), dy));
    h = max(h, cap(d, r).mul(has));
    // 水痕：沿著水滴走過的路線，留在水滴上方
    const inTrail = step(r.mul(0.9), dy).mul(step(dy, trailLen)).mul(has);
    const fade = sqrt(clamp(float(1).sub(dy.div(trailLen)), 0, 1));
    const px = lx.sub(rainPath(p.y, s));
    wiped = max(wiped, smoothstep(r.mul(1.2), r.mul(0.5), abs(px)).mul(fade).mul(inTrail));
    // 小水珠固定在玻璃上，大小不一、有的地方斷掉
    const spacing = 0.16;
    const slot = floor(p.y.div(spacing));
    const kn = rainHash(vec2(slot, id.add(col.mul(13))));
    const ty = fract(p.y.div(spacing)).sub(0.5).sub(kn.sub(0.5).mul(0.3)).mul(spacing);
    const tr = min(r.mul(kn.mul(kn).mul(0.6).add(0.28)), spacing * 0.48)
      .mul(fade)
      .mul(step(0.2, kn));
    const tx = px.add(rainHash(vec2(slot, col)).sub(0.5).mul(r).mul(0.4));
    h = max(h, cap(vec2(tx, ty), tr).mul(0.9).mul(inTrail));
  }
  return vec2(h, wiped);
}

/** 靜止的小水滴：隨機出現、慢慢蒸發 */
function rainStatic(p: ShaderNode, t: ShaderNode, amount: ShaderNode): ShaderNode {
  const id = floor(p);
  const st = fract(p).sub(0.5);
  const n = rainHash(id);
  const pos = vec2(rainHash(id.add(1.7)), rainHash(id.add(9.2)))
    .sub(0.5)
    .mul(0.7);
  const life = fract(t.mul(0.12).add(n.mul(13)));
  const size = smoothstep(0, 0.05, life).mul(smoothstep(1, 0.4, life));
  const sn = rainHash(id.add(4.4));
  const r = size.mul(sn.mul(sn).mul(0.75).add(0.25)).mul(0.2);
  return cap(st.sub(pos), r).mul(step(n, amount));
}

/** 整片玻璃上的水（兩層大水滴 + 小水滴；大水滴滑過的地方小水滴被擦掉） */
function rainHeight(uv: ShaderNode, t: ShaderNode, aspect: ShaderNode, scale: ShaderNode, amount: ShaderNode) {
  const p = vec2(uv.x.mul(aspect), uv.y).mul(scale);
  const a = rainSliding(p, t, amount);
  const b = rainSliding(p.mul(1.45).add(vec2(0.37, 5)), t.mul(1.1).add(3), amount.mul(0.7));
  const c = max(
    rainStatic(p.mul(3), t, amount.mul(0.7)),
    rainStatic(p.mul(6).add(2.7), t.mul(0.8), amount.mul(0.4)),
  ).mul(float(1).sub(max(a.y, b.y)));
  return max(max(a.x, b.x), c.mul(0.9));
}

/**
 * 內建範例全螢幕效果（TSL）。使用前先註冊：shaders.defineEffect(EffectPresets.pixelate())
 */
export const EffectPresets = {
  /** 色差：紅藍通道往外偏移，越靠邊越明顯 */
  chromaticAberration: (): EffectDefinition => ({
    name: 'chromaticAberration',
    uniforms: { amount: 0.004 },
    color: (c) => {
      const offset = c.uv.sub(0.5).mul(c.uniforms.amount).mul(2);
      return vec4(c.sample(c.uv.add(offset)).r, c.color.g, c.sample(c.uv.sub(offset)).b, c.color.a);
    },
  }),

  /**
   * 雨落窗：像隔著淋雨、起霧的玻璃看出去。後面的畫面很模糊（光斑），每顆水滴是一顆清楚的小凸透鏡，
   * 裡面是上下左右顛倒的畫面，邊緣暗一圈、左上有反光。大小不一的圓形水滴忽快忽慢一路往下滑出畫面，
   * 中途不會消失，沿著彎曲的路線留下一串固定在玻璃上、大小不一、慢慢蒸發的小水珠，滑過的地方把小水滴擦掉；
   * 玻璃上到處有小水滴出現再蒸發。
   *
   * 參數：amount 雨量（0~1）、speed 速度、scale 水滴密度（越大水滴越小越多）、
   * distortion 水滴的折射強度（越大越像顛倒的透鏡）、fog 玻璃起霧的模糊半徑（像素）、darken 起霧變暗（0~1）
   */
  rainOnWindow: (): EffectDefinition => ({
    name: 'rainOnWindow',
    uniforms: { amount: 0.7, speed: 1, scale: 5, distortion: 0.6, fog: 5, darken: 0.08 },
    color: (c) => {
      const u = c.uniforms;
      const uv = c.uv;
      const res = c.resolution;
      const aspect = res.x.div(res.y);
      const t = c.time.mul(u.speed);
      const ex = float(1).div(res.y);
      const h = rainHeight(uv, t, aspect, u.scale, u.amount);
      const hx = rainHeight(uv.add(vec2(ex, 0)), t, aspect, u.scale, u.amount);
      const hy = rainHeight(uv.add(vec2(0, ex)), t, aspect, u.scale, u.amount);
      const slope = vec2(hx.sub(h), hy.sub(h)).div(ex); // 水面的斜率
      const wet = smoothstep(0, 0.06, h); // 1 = 在水滴上
      // 起霧的玻璃：圓盤狀取樣（黃金角），亮的地方散成柔和的光斑
      let misty: ShaderNode = vec4(0);
      for (let i = 0; i < 16; i++) {
        const ang = i * 2.39996;
        const rad = Math.sqrt((i + 0.5) / 16);
        misty = misty.add(
          c.sample(
            uv.add(
              vec2(Math.cos(ang) * rad, Math.sin(ang) * rad)
                .mul(u.fog)
                .div(res),
            ),
          ),
        );
      }
      misty = misty.div(16);
      const mistyRgb = misty.rgb.mul(float(1).sub(u.darken));
      // 水滴像一顆小凸透鏡：看到的是清楚、顛倒的畫面
      const bend = clamp(slope.mul(u.distortion).mul(0.003), vec2(-0.06), vec2(0.06));
      const through = c.sample(clamp(uv.add(bend), 0, 1));
      let rgb = mix(mistyRgb, through.rgb, wet);
      // 邊緣暗一圈；左上方的光源在水滴上的小亮點
      const rim = wet.mul(float(1).sub(smoothstep(0, 0.4, h)));
      rgb = rgb.mul(float(1).sub(rim.mul(0.45)));
      const normal = normalize(vec3(slope.mul(-0.0025), 1));
      const glint = pow(max(dot(normal, normalize(vec3(-0.45, 0.6, 0.9))), 0), 28);
      rgb = rgb.add(glint.mul(wet).mul(0.7));
      return vec4(rgb, mix(misty.a, through.a, wet));
    },
  }),

  /** 像素化：復古遊戲風格 */
  pixelate: (): EffectDefinition => ({
    name: 'pixelate',
    uniforms: { pixelSize: 6 },
    color: (c) => {
      const cell = vec2(c.uniforms.pixelSize).div(c.resolution);
      return c.sample(floor(c.uv.div(cell)).add(0.5).mul(cell));
    },
  }),
};
