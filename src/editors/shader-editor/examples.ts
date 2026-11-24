/**
 * 著色器編輯器的範例節點圖（移植自 Shader Composer）。新增範例只要在 EXAMPLES 加一筆。
 *
 *   build(N, L)：
 *     N(type, x, y, { values, params }) → 建立節點，回傳編號
 *     L(fromId, fromPort, toId, toPort) → 建立連線
 *   mesh：載入時切換的預覽網格（省略時維持目前的網格）
 */
import { NODE_DEFS, type ShaderGraph, type ShaderGraphNode } from '../../shaders/graph';

/** 建立節點：回傳節點編號 */
export type AddNode = (
  type: string,
  x: number,
  y: number,
  opts?: { values?: Record<string, number>; params?: Record<string, string | number> },
) => number;
/** 建立連線 */
export type AddLink = (from: number, fromPort: string, to: number, toPort: string) => void;

/** 一個範例 */
export interface ShaderExample {
  id: string;
  group: string;
  label: string;
  desc?: string;
  /** 預覽網格 */
  mesh?: 'sphere' | 'cube' | 'torus' | 'plane' | 'quad';
  build(N: AddNode, L: AddLink): void;
}

export const EXAMPLES: ShaderExample[] = [
  /* ----------------------------- 2D 圖案 ----------------------------- */
  {
    id: 'rings',
    group: '2D 圖案',
    label: '同心波紋',
    desc: '距離 × 頻率 − 時間 → sin → 調色盤',
    build(N, L) {
      const cuv = N('centeredUV', 40, 40);
      const len = N('length', 260, 40);
      L(cuv, 'uv', len, 'v');
      const mul = N('multiply', 480, 40, { values: { b: 10 } });
      L(len, 'out', mul, 'a');
      const t = N('time', 480, 330);
      const sub = N('subtract', 700, 120);
      L(mul, 'out', sub, 'a');
      L(t, 'time', sub, 'b');
      const sin = N('sin', 920, 120);
      L(sub, 'out', sin, 'x');
      const pal = N('palette', 1140, 120);
      L(sin, 'out', pal, 't');
      const out = N('output', 1380, 180);
      L(pal, 'rgb', out, 'color');
    },
  },
  {
    id: 'plasma',
    group: '2D 圖案',
    label: '電漿',
    desc: '三組 sin 波（水平、垂直、放射）相加後上色',
    build(N, L) {
      const cuv = N('centeredUV', 40, 200);
      const sp = N('split', 260, 40);
      L(cuv, 'uv', sp, 'v');
      const t = N('time', 40, 520);
      const t2 = N('multiply', 260, 520, { values: { b: 1.3 } });
      L(t, 'time', t2, 'a');

      const mx = N('multiply', 480, 0, { values: { b: 6 } });
      L(sp, 'x', mx, 'a');
      const ax = N('add', 700, 0);
      L(mx, 'out', ax, 'a');
      L(t, 'time', ax, 'b');
      const sx = N('sin', 920, 0);
      L(ax, 'out', sx, 'x');

      const my = N('multiply', 480, 260, { values: { b: 5 } });
      L(sp, 'y', my, 'a');
      const ay = N('add', 700, 260);
      L(my, 'out', ay, 'a');
      L(t2, 'out', ay, 'b');
      const sy = N('sin', 920, 260);
      L(ay, 'out', sy, 'x');

      const len = N('length', 260, 760);
      L(cuv, 'uv', len, 'v');
      const mr = N('multiply', 480, 760, { values: { b: 8 } });
      L(len, 'out', mr, 'a');
      const ar = N('subtract', 700, 760);
      L(mr, 'out', ar, 'a');
      L(t, 'time', ar, 'b');
      const sr = N('sin', 920, 760);
      L(ar, 'out', sr, 'x');

      const s1 = N('add', 1140, 120);
      L(sx, 'out', s1, 'a');
      L(sy, 'out', s1, 'b');
      const s2 = N('add', 1360, 300);
      L(s1, 'out', s2, 'a');
      L(sr, 'out', s2, 'b');
      const k = N('multiply', 1580, 300, { values: { b: 0.35 } });
      L(s2, 'out', k, 'a');
      const pal = N('palette', 1800, 300, { params: { preset: 'neon' } });
      L(k, 'out', pal, 't');
      const out = N('output', 2040, 340);
      L(pal, 'rgb', out, 'color');
    },
  },
  {
    id: 'spiral',
    group: '2D 圖案',
    label: '催眠螺旋',
    desc: '極座標：角度 × 臂數 + 半徑 − 時間 → fract → smoothstep',
    build(N, L) {
      const cuv = N('centeredUV', 40, 40);
      const pol = N('polar', 260, 40);
      L(cuv, 'uv', pol, 'p');
      const sp = N('split', 480, 40);
      L(pol, 'out', sp, 'v');
      const arms = N('multiply', 700, 0, { values: { b: 5 } });
      L(sp, 'x', arms, 'a');
      const rad = N('multiply', 700, 260, { values: { b: 6 } });
      L(sp, 'y', rad, 'a');
      const t = N('time', 480, 480);
      const tm = N('multiply', 700, 520, { values: { b: 0.6 } });
      L(t, 'time', tm, 'a');
      const s1 = N('add', 920, 60);
      L(arms, 'out', s1, 'a');
      L(rad, 'out', s1, 'b');
      const s2 = N('subtract', 1140, 100);
      L(s1, 'out', s2, 'a');
      L(tm, 'out', s2, 'b');
      const fr = N('fract', 1360, 100);
      L(s2, 'out', fr, 'x');
      const st = N('smoothstep', 1580, 100, { values: { edge0: 0.45, edge1: 0.55 } });
      L(fr, 'out', st, 'x');
      const dark = N('color', 1360, 420, { params: { color: '#1b1035' } });
      const hot = N('color', 1580, 420, { params: { color: '#ff3d7f' } });
      const mix = N('mix', 1800, 160);
      L(dark, 'rgb', mix, 'a');
      L(hot, 'rgb', mix, 'b');
      L(st, 'out', mix, 't');
      const out = N('output', 2040, 200);
      L(mix, 'out', out, 'color');
    },
  },
  {
    id: 'checker',
    group: '2D 圖案',
    label: '旋轉棋盤',
    desc: 'Rotate 2D 隨時間旋轉座標 → Checker，再加上暗角',
    build(N, L) {
      const t = N('time', 40, 40);
      const ang = N('multiply', 260, 40, { values: { b: 0.4 } });
      L(t, 'time', ang, 'a');
      const rot = N('rotate', 480, 40);
      L(ang, 'out', rot, 'angle');
      const ch = N('checker', 700, 40, { values: { count: 4 } });
      L(rot, 'out', ch, 'p');
      const c1 = N('color', 700, 330, { params: { color: '#22313f' } });
      const c2 = N('color', 700, 470, { params: { color: '#f5f0e6' } });
      const mix = N('mix', 940, 120);
      L(c1, 'rgb', mix, 'a');
      L(c2, 'rgb', mix, 'b');
      L(ch, 'out', mix, 't');
      const cuv = N('centeredUV', 40, 380);
      const len = N('length', 260, 380);
      L(cuv, 'uv', len, 'v');
      const ss = N('smoothstep', 480, 380, { values: { edge0: 0.5, edge1: 1.5 } });
      L(len, 'out', ss, 'x');
      const om = N('oneMinus', 700, 640);
      L(ss, 'out', om, 'x');
      const mul = N('multiply', 1180, 200);
      L(mix, 'out', mul, 'a');
      L(om, 'out', mul, 'b');
      const out = N('output', 1420, 240);
      L(mul, 'out', out, 'color');
    },
  },
  {
    id: 'neon',
    group: '2D 圖案',
    label: '霓虹光環',
    desc: 'Circle SDF 的半徑隨時間脈動，0.02 ÷ |d| 做出發光效果',
    build(N, L) {
      const t = N('time', 40, 320);
      const tm = N('multiply', 260, 320, { values: { b: 2 } });
      L(t, 'time', tm, 'a');
      const sn = N('sin', 480, 320);
      L(tm, 'out', sn, 'x');
      const amp = N('multiply', 700, 320, { values: { b: 0.08 } });
      L(sn, 'out', amp, 'a');
      const rad = N('add', 920, 320, { values: { b: 0.55 } });
      L(amp, 'out', rad, 'a');
      const circ = N('circle', 1140, 40);
      L(rad, 'out', circ, 'radius');
      const ab = N('abs', 1360, 40);
      L(circ, 'd', ab, 'x');
      const glow = N('divide', 1580, 40, { values: { a: 0.02 } });
      L(ab, 'out', glow, 'b');
      const col = N('color', 1580, 360, { params: { color: '#ff4fd8' } });
      const mul = N('multiply', 1820, 120);
      L(col, 'rgb', mul, 'a');
      L(glow, 'out', mul, 'b');
      const out = N('output', 2060, 160);
      L(mul, 'out', out, 'color');
    },
  },
  {
    id: 'hueWheel',
    group: '2D 圖案',
    label: '色相環',
    desc: '極座標角度 → 色相、半徑 → 飽和度，圓外以 alpha 透明',
    build(N, L) {
      const cuv = N('centeredUV', 40, 40);
      const pol = N('polar', 260, 40);
      L(cuv, 'uv', pol, 'p');
      const sp = N('split', 480, 40);
      L(pol, 'out', sp, 'v');
      const t = N('time', 260, 360);
      const tm = N('multiply', 480, 360, { values: { b: 0.1 } });
      L(t, 'time', tm, 'a');
      const hue = N('add', 700, 0);
      L(sp, 'x', hue, 'a');
      L(tm, 'out', hue, 'b');
      const hsv = N('hsv', 940, 40);
      L(hue, 'out', hsv, 'h');
      L(sp, 'y', hsv, 's');
      const stp = N('step', 700, 300, { values: { edge: 0.9 } });
      L(sp, 'y', stp, 'x');
      const mask = N('oneMinus', 940, 340);
      L(stp, 'out', mask, 'x');
      const out = N('output', 1180, 120);
      L(hsv, 'rgb', out, 'color');
      L(mask, 'out', out, 'alpha');
    },
  },
  {
    id: 'clouds',
    group: '2D 圖案',
    label: 'FBM 雲',
    desc: 'UV 隨時間平移 → FBM → 在兩個顏色間內插',
    build(N, L) {
      const uv = N('uv', 40, 40);
      const t = N('time', 40, 300);
      const tm = N('multiply', 260, 300, { values: { b: 0.06 } });
      L(t, 'time', tm, 'a');
      const add = N('add', 480, 80);
      L(uv, 'uv', add, 'a');
      L(tm, 'out', add, 'b');
      const fbm = N('fbm', 700, 80, { values: { scale: 4 } });
      L(add, 'out', fbm, 'p');
      const c1 = N('color', 700, 400, { params: { color: '#173a7a' } });
      const c2 = N('color', 920, 400, { params: { color: '#f4f7ff' } });
      const mix = N('mix', 1140, 120);
      L(c1, 'rgb', mix, 'a');
      L(c2, 'rgb', mix, 'b');
      L(fbm, 'out', mix, 't');
      const out = N('output', 1380, 180);
      L(mix, 'out', out, 'color');
    },
  },
  {
    id: 'cells',
    group: '2D 圖案',
    label: 'Voronoi 細胞',
    desc: 'Voronoi 距離 → 霓虹調色盤，並以 smoothstep 做出發光核心',
    build(N, L) {
      const uv = N('uv', 40, 40);
      const t = N('time', 40, 300);
      const vor = N('voronoi', 260, 80, { values: { scale: 6 } });
      L(uv, 'uv', vor, 'p');
      L(t, 'time', vor, 'time');
      const pal = N('palette', 520, 40, { params: { preset: 'neon' } });
      L(vor, 'd', pal, 't');
      const ss = N('smoothstep', 520, 340, { values: { edge0: 0, edge1: 0.7 } });
      L(vor, 'd', ss, 'x');
      const om = N('oneMinus', 760, 340);
      L(ss, 'out', om, 'x');
      const mul = N('multiply', 1000, 120);
      L(pal, 'rgb', mul, 'a');
      L(om, 'out', mul, 'b');
      const out = N('output', 1240, 180);
      L(mul, 'out', out, 'color');
    },
  },

  /* ----------------------------- 互動 ----------------------------- */
  {
    id: 'mouseGlow',
    group: '互動',
    label: '滑鼠光暈',
    mesh: 'quad',
    desc: '在預覽視窗移動滑鼠：UV 與滑鼠的距離 → 光暈',
    build(N, L) {
      const uv = N('uv', 40, 40);
      const m = N('mouse', 40, 300);
      const d = N('distance', 260, 120);
      L(uv, 'uv', d, 'a');
      L(m, 'pos', d, 'b');
      const ss = N('smoothstep', 480, 120, { values: { edge0: 0, edge1: 0.5 } });
      L(d, 'out', ss, 'x');
      const om = N('oneMinus', 700, 120);
      L(ss, 'out', om, 'x');
      const pw = N('power', 920, 120, { values: { b: 2 } });
      L(om, 'out', pw, 'a');
      const t = N('time', 700, 420);
      const tm = N('multiply', 920, 420, { values: { b: 0.2 } });
      L(t, 'time', tm, 'a');
      const pal = N('palette', 1140, 400, { params: { preset: 'rainbow' } });
      L(tm, 'out', pal, 't');
      const boost = N('multiply', 1140, 120, { values: { b: 1.6 } });
      L(pw, 'out', boost, 'a');
      const col = N('multiply', 1380, 160);
      L(pal, 'rgb', col, 'a');
      L(boost, 'out', col, 'b');
      const out = N('output', 1620, 200);
      L(col, 'out', out, 'color');
    },
  },

  /* ----------------------------- 3D 材質 ----------------------------- */
  {
    id: 'rim',
    group: '3D 材質',
    label: 'Fresnel 邊緣光',
    mesh: 'sphere',
    desc: 'Lambert 漫反射 + Specular 高光 + Fresnel 邊緣光',
    build(N, L) {
      const lam = N('lambert', 40, 40);
      const base = N('color', 40, 300, { params: { color: '#4b2bb3' } });
      const m1 = N('multiply', 280, 80);
      L(base, 'rgb', m1, 'a');
      L(lam, 'out', m1, 'b');
      const spec = N('specular', 280, 330, { values: { shininess: 48 } });
      const a1 = N('add', 520, 120);
      L(m1, 'out', a1, 'a');
      L(spec, 'out', a1, 'b');
      const fr = N('fresnel', 520, 400, { values: { power: 2.5 } });
      const rim = N('color', 760, 470, { params: { color: '#5ee7ff' } });
      const m2 = N('multiply', 760, 220);
      L(rim, 'rgb', m2, 'a');
      L(fr, 'out', m2, 'b');
      const a2 = N('add', 1000, 140);
      L(a1, 'out', a2, 'a');
      L(m2, 'out', a2, 'b');
      const out = N('output', 1240, 180);
      L(a2, 'out', out, 'color');
    },
  },
  {
    id: 'toon',
    group: '3D 材質',
    label: '卡通渲染',
    mesh: 'torus',
    desc: 'Lambert 量化成 3 階色帶，step 做出硬邊高光與黑色輪廓線',
    build(N, L) {
      const lam = N('lambert', 40, 40);
      const bands = N('multiply', 260, 40, { values: { b: 3 } });
      L(lam, 'out', bands, 'a');
      const fl = N('floor', 480, 40);
      L(bands, 'out', fl, 'x');
      const q = N('divide', 700, 40, { values: { b: 3 } });
      L(fl, 'out', q, 'a');
      const lit = N('remap', 940, 40, { values: { inMin: 0, inMax: 1, outMin: 0.35, outMax: 1 } });
      L(q, 'out', lit, 'x');
      const base = N('color', 940, 380, { params: { color: '#ff8a3d' } });
      const shade = N('multiply', 1180, 120);
      L(base, 'rgb', shade, 'a');
      L(lit, 'out', shade, 'b');
      const fr = N('fresnel', 700, 560, { values: { power: 4 } });
      const edge = N('step', 940, 600, { values: { edge: 0.5 } });
      L(fr, 'out', edge, 'x');
      const om = N('oneMinus', 1180, 600);
      L(edge, 'out', om, 'x');
      const outl = N('multiply', 1420, 200);
      L(shade, 'out', outl, 'a');
      L(om, 'out', outl, 'b');
      const spec = N('specular', 1180, 840, { values: { shininess: 40 } });
      const hi = N('step', 1420, 840, { values: { edge: 0.5 } });
      L(spec, 'out', hi, 'x');
      const fin = N('add', 1660, 280);
      L(outl, 'out', fin, 'a');
      L(hi, 'out', fin, 'b');
      const out = N('output', 1900, 320);
      L(fin, 'out', out, 'color');
    },
  },
  {
    id: 'hologram',
    group: '3D 材質',
    label: '全息投影',
    mesh: 'torus',
    desc: 'Fresnel 輪廓 × 世界座標 Y 方向的移動掃描線，並輸出到 alpha 呈現半透明',
    build(N, L) {
      const fr = N('fresnel', 40, 40, { values: { power: 1.5 } });
      const glow = N('add', 280, 40, { values: { b: 0.3 } });
      L(fr, 'out', glow, 'a');
      const col = N('color', 1380, 600, { params: { color: '#3ef0ff' } });
      const wp = N('worldPos', 40, 400);
      const sp = N('split', 260, 400);
      L(wp, 'pos', sp, 'v');
      const t = N('time', 260, 760);
      const ys = N('multiply', 480, 400, { values: { b: 40 } });
      L(sp, 'y', ys, 'a');
      const tt = N('multiply', 480, 760, { values: { b: 4 } });
      L(t, 'time', tt, 'a');
      const sub = N('subtract', 700, 480);
      L(ys, 'out', sub, 'a');
      L(tt, 'out', sub, 'b');
      const sn = N('sin', 920, 480);
      L(sub, 'out', sn, 'x');
      const lines = N('remap', 1140, 480, { values: { inMin: -1, inMax: 1, outMin: 0.35, outMax: 1 } });
      L(sn, 'out', lines, 'x');
      const inten = N('multiply', 1380, 100);
      L(glow, 'out', inten, 'a');
      L(lines, 'out', inten, 'b');
      const bright = N('multiply', 1380, 360, { values: { b: 1.6 } });
      L(inten, 'out', bright, 'a');
      const rgb = N('multiply', 1620, 160);
      L(col, 'rgb', rgb, 'a');
      L(bright, 'out', rgb, 'b');
      const out = N('output', 1860, 200);
      L(rgb, 'out', out, 'color');
      L(inten, 'out', out, 'alpha');
    },
  },

  /* ----------------------------- 頂點位移 ----------------------------- */
  {
    id: 'terrain',
    group: '頂點位移',
    label: '地形',
    mesh: 'plane',
    desc: 'FBM 同時驅動頂點高度與顏色（依位移重算法線）',
    build(N, L) {
      const uv = N('uv', 40, 60);
      const fbm = N('fbm', 260, 60, { values: { scale: 3 } });
      L(uv, 'uv', fbm, 'p');
      const hgt = N('multiply', 520, 40, { values: { b: 0.8 } });
      L(fbm, 'out', hgt, 'a');
      const vout = N('vertexOutput', 780, 40, { params: { normals: 'flat' } });
      L(hgt, 'out', vout, 'displacement');
      const low = N('color', 260, 380, { params: { color: '#1d5e3a' } });
      const high = N('color', 260, 540, { params: { color: '#efe6d2' } });
      const ss = N('smoothstep', 520, 300, { values: { edge0: 0.35, edge1: 0.75 } });
      L(fbm, 'out', ss, 'x');
      const mix = N('mix', 780, 300);
      L(low, 'rgb', mix, 'a');
      L(high, 'rgb', mix, 'b');
      L(ss, 'out', mix, 't');
      const lam = N('lambert', 780, 600);
      const lit = N('remap', 1020, 600, { values: { inMin: 0, inMax: 1, outMin: 0.25, outMax: 1.1 } });
      L(lam, 'out', lit, 'x');
      const mul = N('multiply', 1260, 340);
      L(mix, 'out', mul, 'a');
      L(lit, 'out', mul, 'b');
      const out = N('output', 1500, 380);
      L(mul, 'out', out, 'color');
    },
  },
  {
    id: 'water',
    group: '頂點位移',
    label: '水面波浪',
    mesh: 'plane',
    desc: '兩組 sin 波推動頂點，Fresnel 決定深淺水色，再加上高光',
    build(N, L) {
      const uv = N('uv', 40, 40);
      const sp = N('split', 260, 40);
      L(uv, 'uv', sp, 'v');
      const t = N('time', 40, 420);
      const t1 = N('multiply', 260, 420, { values: { b: 2 } });
      L(t, 'time', t1, 'a');
      const t2 = N('multiply', 260, 600, { values: { b: 1.4 } });
      L(t, 'time', t2, 'a');
      const wx = N('multiply', 480, 0, { values: { b: 14 } });
      L(sp, 'x', wx, 'a');
      const ax = N('add', 700, 0);
      L(wx, 'out', ax, 'a');
      L(t1, 'out', ax, 'b');
      const sx = N('sin', 920, 0);
      L(ax, 'out', sx, 'x');
      const wy = N('multiply', 480, 280, { values: { b: 9 } });
      L(sp, 'y', wy, 'a');
      const ay = N('add', 700, 280);
      L(wy, 'out', ay, 'a');
      L(t2, 'out', ay, 'b');
      const sy = N('sin', 920, 280);
      L(ay, 'out', sy, 'x');
      const sum = N('add', 1140, 120);
      L(sx, 'out', sum, 'a');
      L(sy, 'out', sum, 'b');
      const amp = N('multiply', 1360, 120, { values: { b: 0.04 } });
      L(sum, 'out', amp, 'a');
      const vout = N('vertexOutput', 1600, 120, { params: { normals: 'flat' } });
      L(amp, 'out', vout, 'displacement');
      const fr = N('fresnel', 1140, 520, { values: { power: 3 } });
      const deep = N('color', 1140, 820, { params: { color: '#06324f' } });
      const light = N('color', 1360, 820, { params: { color: '#7fd8f2' } });
      const mix = N('mix', 1600, 520);
      L(deep, 'rgb', mix, 'a');
      L(light, 'rgb', mix, 'b');
      L(fr, 'out', mix, 't');
      const spec = N('specular', 1600, 820, { values: { shininess: 64 } });
      const fin = N('add', 1840, 560);
      L(mix, 'out', fin, 'a');
      L(spec, 'out', fin, 'b');
      const out = N('output', 2080, 600);
      L(fin, 'out', out, 'color');
    },
  },
  {
    id: 'lava',
    group: '頂點位移',
    label: '熔岩星球',
    mesh: 'sphere',
    desc: '物件座標三個投影面的 FBM 取平均（無 UV 接縫，花紋固定在物件上），高處為岩石、低處為發光熔岩',
    build(N, L) {
      const wp = N('objectPos', 40, 300);
      const sp = N('split', 260, 300);
      L(wp, 'pos', sp, 'v');
      const pxy = N('combine', 480, 0);
      L(sp, 'x', pxy, 'x');
      L(sp, 'y', pxy, 'y');
      const pyz = N('combine', 480, 300);
      L(sp, 'y', pyz, 'x');
      L(sp, 'z', pyz, 'y');
      const pzx = N('combine', 480, 600);
      L(sp, 'z', pzx, 'x');
      L(sp, 'x', pzx, 'y');
      const f1 = N('fbm', 720, 0, { values: { scale: 2.5 } });
      L(pxy, 'xy', f1, 'p');
      const f2 = N('fbm', 720, 300, { values: { scale: 2.5 } });
      L(pyz, 'xy', f2, 'p');
      const f3 = N('fbm', 720, 600, { values: { scale: 2.5 } });
      L(pzx, 'xy', f3, 'p');
      const s1 = N('add', 960, 120);
      L(f1, 'out', s1, 'a');
      L(f2, 'out', s1, 'b');
      const s2 = N('add', 1180, 300);
      L(s1, 'out', s2, 'a');
      L(f3, 'out', s2, 'b');
      const avg = N('multiply', 1400, 300, { values: { b: 0.3333 } });
      L(s2, 'out', avg, 'a');
      const disp = N('multiply', 1640, 40, { values: { b: 0.3 } });
      L(avg, 'out', disp, 'a');
      const vout = N('vertexOutput', 1880, 40, { params: { normals: 'flat' } });
      L(disp, 'out', vout, 'displacement');
      const ss = N('smoothstep', 1640, 300, { values: { edge0: 0.3, edge1: 0.36 } });
      L(avg, 'out', ss, 'x');
      const lava = N('oneMinus', 1880, 320);
      L(ss, 'out', lava, 'x');
      const rock = N('color', 1640, 600, { params: { color: '#3a2620' } });
      const hot = N('color', 1880, 600, { params: { color: '#ff5a1f' } });
      const lam = N('lambert', 1880, 760);
      const lit = N('remap', 2120, 760, { values: { inMin: 0, inMax: 1, outMin: 0.15, outMax: 1.2 } });
      L(lam, 'out', lit, 'x');
      const rockLit = N('multiply', 2360, 560);
      L(rock, 'rgb', rockLit, 'a');
      L(lit, 'out', rockLit, 'b');
      const glow = N('multiply', 2120, 300);
      L(hot, 'rgb', glow, 'a');
      L(lava, 'out', glow, 'b');
      const fin = N('add', 2600, 380);
      L(rockLit, 'out', fin, 'a');
      L(glow, 'out', fin, 'b');
      const out = N('output', 2840, 420);
      L(fin, 'out', out, 'color');
    },
  },
  {
    id: 'textured',
    group: '頂點位移',
    label: '貼圖 + 位移',
    mesh: 'sphere',
    desc: 'Texture 上色，亮度同時作為高度圖（可上傳自己的圖片）',
    build(N, L) {
      const tex = N('texture', 40, 60);
      const lam = N('lambert', 320, 40);
      const lit = N('remap', 560, 40, { values: { inMin: 0, inMax: 1, outMin: 0.3, outMax: 1.1 } });
      L(lam, 'out', lit, 'x');
      const mul = N('multiply', 820, 120);
      L(tex, 'rgb', mul, 'a');
      L(lit, 'out', mul, 'b');
      const out = N('output', 1060, 160);
      L(mul, 'out', out, 'color');
      const lum = N('grayscale', 320, 420);
      L(tex, 'rgb', lum, 'rgb');
      const amt = N('multiply', 560, 420, { values: { b: 0.12 } });
      L(lum, 'out', amt, 'a');
      const vout = N('vertexOutput', 820, 460);
      L(amt, 'out', vout, 'displacement');
    },
  },

  /* ----------------------------- 全螢幕效果（後製） ----------------------------- */
  {
    id: 'fxVignette',
    group: '全螢幕效果',
    label: '暗角',
    desc: '畫面四周變暗：置中 UV 的長度 → smoothstep → 1 − x，乘上畫面顏色',
    mesh: 'quad',
    build(N, L) {
      const cuv = N('centeredUV', 40, 40);
      const len = N('length', 260, 40);
      L(cuv, 'uv', len, 'v');
      const ss = N('smoothstep', 480, 40, { values: { edge0: 0.7, edge1: 1.6 } });
      L(len, 'out', ss, 'x');
      const inv = N('oneMinus', 700, 40);
      L(ss, 'out', inv, 'x');
      const scr = N('screenColor', 480, 300);
      const mul = N('multiply', 920, 160);
      L(scr, 'rgb', mul, 'a');
      L(inv, 'out', mul, 'b');
      const out = N('effectOutput', 1140, 160);
      L(mul, 'out', out, 'color');
    },
  },
  {
    id: 'fxSepia',
    group: '全螢幕效果',
    label: '復古（懷舊色調）',
    desc: '畫面轉灰階再乘上暖色，和原本的顏色混合',
    mesh: 'quad',
    build(N, L) {
      const scr = N('screenColor', 40, 120);
      const gray = N('grayscale', 280, 40);
      L(scr, 'rgb', gray, 'rgb');
      const tint = N('color', 280, 240, { params: { color: '#ffd29a' } });
      const mul = N('multiply', 500, 120);
      L(gray, 'out', mul, 'a');
      L(tint, 'rgb', mul, 'b');
      const mix = N('mix', 740, 160, { values: { t: 0.85 } });
      L(scr, 'rgb', mix, 'a');
      L(mul, 'out', mix, 'b');
      const out = N('effectOutput', 980, 160);
      L(mix, 'out', out, 'color');
    },
  },
  {
    id: 'fxWave',
    group: '全螢幕效果',
    label: '波動扭曲',
    desc: '讀取畫面時把 UV 往左右推：sin(UV.y × 頻率 + 時間) × 幅度（水面、熱浪、夢境）',
    mesh: 'quad',
    build(N, L) {
      const uv = N('uv', 40, 40);
      const split = N('split', 240, 40);
      L(uv, 'uv', split, 'v');
      const freq = N('multiply', 460, 40, { values: { b: 18 } });
      L(split, 'y', freq, 'a');
      const t = N('time', 460, 260);
      const add = N('add', 680, 60);
      L(freq, 'out', add, 'a');
      L(t, 'time', add, 'b');
      const sin = N('sin', 900, 60);
      L(add, 'out', sin, 'x');
      const amp = N('multiply', 1120, 60, { values: { b: 0.01 } });
      L(sin, 'out', amp, 'a');
      const comb = N('combine', 1340, 60);
      L(amp, 'out', comb, 'x');
      const off = N('add', 1560, 120);
      L(uv, 'uv', off, 'a');
      L(comb, 'xy', off, 'b');
      const scr = N('screenColor', 1780, 120);
      L(off, 'out', scr, 'uv');
      const out = N('effectOutput', 2000, 120);
      L(scr, 'rgb', out, 'color');
    },
  },
  {
    id: 'fxScanlines',
    group: '全螢幕效果',
    label: 'CRT 掃描線',
    desc: '每隔幾個像素變暗一點：sin(UV.y × 畫面高度 × 頻率) 對應到 0.75～1，乘上畫面顏色',
    mesh: 'quad',
    build(N, L) {
      const uv = N('uv', 40, 40);
      const split = N('split', 240, 40);
      L(uv, 'uv', split, 'v');
      const size = N('screenSize', 40, 260);
      const sizeSplit = N('split', 240, 260);
      L(size, 'size', sizeSplit, 'v');
      const rows = N('multiply', 460, 120);
      L(split, 'y', rows, 'a');
      L(sizeSplit, 'y', rows, 'b');
      const freq = N('multiply', 680, 120, { values: { b: 1.5 } });
      L(rows, 'out', freq, 'a');
      const sin = N('sin', 900, 120);
      L(freq, 'out', sin, 'x');
      const remap = N('remap', 1120, 120, { values: { outMin: 0.75, outMax: 1 } });
      L(sin, 'out', remap, 'x');
      const scr = N('screenColor', 1120, 360);
      const mul = N('multiply', 1360, 200);
      L(scr, 'rgb', mul, 'a');
      L(remap, 'out', mul, 'b');
      const out = N('effectOutput', 1580, 200);
      L(mul, 'out', out, 'color');
    },
  },

  /* ----------------------------- 內建材質（和程式版 ShaderPresets 一樣） ----------------------------- */
  {
    id: 'presetDissolve',
    group: '內建材質',
    label: '溶解',
    mesh: 'torus',
    desc:
      '同 ShaderPresets.dissolve：3D 雜訊小於 progress 的地方丟掉（透明：裁切），邊緣發光（emissive）。標準光照，有陰影。' +
      '遊戲裡改 material.uniforms.progress.value（0 完整、1 完全消失）',
    build(N, L) {
      const wp = N('worldPos', 40, 40);
      const ns = N('floatParam', 40, 240, { params: { name: 'noiseScale', value: 2.5 } });
      const scaled = N('multiply', 280, 80);
      L(wp, 'pos', scaled, 'a');
      L(ns, 'value', scaled, 'b');
      const n = N('fbm3', 500, 80, { values: { scale: 1 } });
      L(scaled, 'out', n, 'p');
      const prog = N('floatParam', 40, 460, { params: { name: 'progress', value: 0.35 } });
      const width = N('floatParam', 40, 680, { params: { name: 'edgeWidth', value: 0.08 } });
      // 雜訊 ≥ progress 才留下
      const keep = N('step', 760, 40);
      L(prog, 'value', keep, 'edge');
      L(n, 'out', keep, 'x');
      // 邊緣：1 − smoothstep(progress, progress + edgeWidth, 雜訊)，progress 為 0 時沒有
      const pw = N('add', 280, 600);
      L(prog, 'value', pw, 'a');
      L(width, 'value', pw, 'b');
      const ss = N('smoothstep', 760, 300);
      L(prog, 'value', ss, 'edge0');
      L(pw, 'out', ss, 'edge1');
      L(n, 'out', ss, 'x');
      const inv = N('oneMinus', 980, 300);
      L(ss, 'out', inv, 'x');
      const on = N('step', 760, 600, { values: { edge: 0.001 } });
      L(prog, 'value', on, 'x');
      const glow = N('multiply', 1200, 380);
      L(inv, 'out', glow, 'a');
      L(on, 'out', glow, 'b');
      const ec = N('colorParam', 1200, 640, { params: { name: 'edgeColor', color: '#ffb359' } });
      const e1 = N('multiply', 1420, 440);
      L(ec, 'rgb', e1, 'a');
      L(glow, 'out', e1, 'b');
      const e2 = N('multiply', 1640, 440, { values: { b: 6 } });
      L(e1, 'out', e2, 'a');
      const base = N('colorParam', 1640, 140, { params: { name: 'baseColor', color: '#ffa94f' } });
      const out = N('output', 1880, 200, { params: { lighting: 'standard', alphaMode: 'clip', roughness: 0.35 } });
      L(base, 'rgb', out, 'color');
      L(keep, 'out', out, 'alpha');
      L(e2, 'out', out, 'emissive');
    },
  },
  {
    id: 'presetHologram',
    group: '內建材質',
    label: '全像投影（疊加）',
    mesh: 'torus',
    desc: '同 ShaderPresets.hologram：Fresnel 邊緣光 × 移動的掃描線 × 閃爍，兩面、疊加混合。參數 tint、scanDensity、intensity',
    build(N, L) {
      const fr = N('fresnel', 40, 40, { values: { power: 2 } });
      const rim = N('add', 280, 40, { values: { b: 0.15 } });
      L(fr, 'out', rim, 'a');
      const wp = N('worldPos', 40, 320);
      const sp = N('split', 260, 320);
      L(wp, 'pos', sp, 'v');
      const dens = N('floatParam', 260, 580, { params: { name: 'scanDensity', value: 40 } });
      const ys = N('multiply', 500, 320);
      L(sp, 'y', ys, 'a');
      L(dens, 'value', ys, 'b');
      const t = N('time', 260, 800);
      const t6 = N('multiply', 500, 580, { values: { b: 6 } });
      L(t, 'time', t6, 'a');
      const sub = N('subtract', 720, 380);
      L(ys, 'out', sub, 'a');
      L(t6, 'out', sub, 'b');
      const sn = N('sin', 940, 380);
      L(sub, 'out', sn, 'x');
      const scan = N('remap', 1160, 380, { values: { inMin: -1, inMax: 1, outMin: 0.2, outMax: 1 } });
      L(sn, 'out', scan, 'x');
      // 閃爍：沿著時間的雜訊 0.85～1
      const t12 = N('multiply', 500, 800, { values: { b: 12 } });
      L(t, 'time', t12, 'a');
      const cb = N('combine', 720, 760);
      L(t12, 'out', cb, 'x');
      const nz = N('noise', 940, 760, { values: { scale: 1 } });
      L(cb, 'xy', nz, 'p');
      const flick = N('remap', 1160, 760, { values: { inMin: 0, inMax: 1, outMin: 0.85, outMax: 1 } });
      L(nz, 'out', flick, 'x');
      const a1 = N('multiply', 1400, 120);
      L(rim, 'out', a1, 'a');
      L(scan, 'out', a1, 'b');
      const a2 = N('multiply', 1620, 200);
      L(a1, 'out', a2, 'a');
      L(flick, 'out', a2, 'b');
      const tint = N('colorParam', 1400, 440, { params: { name: 'tint', color: '#7ce7ff' } });
      const inten = N('floatParam', 1400, 660, { params: { name: 'intensity', value: 1.5 } });
      const col = N('multiply', 1620, 480);
      L(tint, 'rgb', col, 'a');
      L(inten, 'value', col, 'b');
      const out = N('output', 1860, 300, { params: { side: 'double', blending: 'additive' } });
      L(col, 'out', out, 'color');
      L(a2, 'out', out, 'alpha');
    },
  },
  {
    id: 'presetWave',
    group: '內建材質',
    label: '波浪（頂點）',
    mesh: 'sphere',
    desc:
      '同 ShaderPresets.wave：頂點沿物件座標 Z 隨時間起伏（法線不重算，適合旗子、水面等平面）。標準光照、兩面。' +
      '參數 amplitude、frequency、speed、baseColor',
    build(N, L) {
      const op = N('objectPos', 40, 40);
      const sp = N('split', 260, 40);
      L(op, 'pos', sp, 'v');
      const freq = N('floatParam', 40, 320, { params: { name: 'frequency', value: 3 } });
      const speed = N('floatParam', 40, 520, { params: { name: 'speed', value: 2 } });
      const amp = N('floatParam', 40, 720, { params: { name: 'amplitude', value: 0.15 } });
      const time = N('time', 260, 520);
      const t = N('multiply', 500, 520);
      L(time, 'time', t, 'a');
      L(speed, 'value', t, 'b');
      // sin(x × frequency + t) × amplitude
      const xf = N('multiply', 500, 40);
      L(sp, 'x', xf, 'a');
      L(freq, 'value', xf, 'b');
      const a1 = N('add', 720, 40);
      L(xf, 'out', a1, 'a');
      L(t, 'out', a1, 'b');
      const s1 = N('sin', 940, 40);
      L(a1, 'out', s1, 'x');
      const w1 = N('multiply', 1160, 40);
      L(s1, 'out', w1, 'a');
      L(amp, 'value', w1, 'b');
      // cos(y × frequency × 0.7 + t × 1.3) × amplitude × 0.5
      const yf = N('multiply', 500, 280);
      L(sp, 'y', yf, 'a');
      L(freq, 'value', yf, 'b');
      const yf2 = N('multiply', 720, 280, { values: { b: 0.7 } });
      L(yf, 'out', yf2, 'a');
      const t13 = N('multiply', 720, 520, { values: { b: 1.3 } });
      L(t, 'out', t13, 'a');
      const a2 = N('add', 940, 340);
      L(yf2, 'out', a2, 'a');
      L(t13, 'out', a2, 'b');
      const c2 = N('cos', 1160, 340);
      L(a2, 'out', c2, 'x');
      const w2 = N('multiply', 1380, 340);
      L(c2, 'out', w2, 'a');
      L(amp, 'value', w2, 'b');
      const w2h = N('multiply', 1600, 340, { values: { b: 0.5 } });
      L(w2, 'out', w2h, 'a');
      const dz = N('add', 1820, 140);
      L(w1, 'out', dz, 'a');
      L(w2h, 'out', dz, 'b');
      const off = N('combine', 2040, 140);
      L(dz, 'out', off, 'z');
      const vout = N('vertexOutput', 2280, 140);
      L(off, 'xyz', vout, 'offset');
      const base = N('colorParam', 2040, 520, { params: { name: 'baseColor', color: '#4cc9f0' } });
      const out = N('output', 2280, 480, { params: { lighting: 'standard', side: 'double', roughness: 0.3 } });
      L(base, 'rgb', out, 'color');
    },
  },
  {
    id: 'presetPulseRing',
    group: '內建材質',
    label: '脈衝光環',
    mesh: 'plane',
    desc: '同 official-demo-000-start 的 pulseRing：往外擴散的光環條紋，外緣淡出，疊加混合。參數 ringColor、speed、rings',
    build(N, L) {
      const cuv = N('centeredUV', 40, 40);
      const r = N('length', 260, 40);
      L(cuv, 'uv', r, 'v');
      const rings = N('floatParam', 40, 240, { params: { name: 'rings', value: 3 } });
      const speed = N('floatParam', 40, 440, { params: { name: 'speed', value: 0.8 } });
      const time = N('time', 260, 440);
      const rr = N('multiply', 500, 80);
      L(r, 'out', rr, 'a');
      L(rings, 'value', rr, 'b');
      const ts = N('multiply', 500, 400);
      L(time, 'time', ts, 'a');
      L(speed, 'value', ts, 'b');
      const sub = N('subtract', 720, 180);
      L(rr, 'out', sub, 'a');
      L(ts, 'out', sub, 'b');
      const wave = N('fract', 940, 180);
      L(sub, 'out', wave, 'x');
      const in1 = N('smoothstep', 1160, 40, { values: { edge0: 0, edge1: 0.15 } });
      L(wave, 'out', in1, 'x');
      const in2 = N('smoothstep', 1160, 300, { values: { edge0: 0.15, edge1: 0.5 } });
      L(wave, 'out', in2, 'x');
      const inv = N('oneMinus', 1380, 300);
      L(in2, 'out', inv, 'x');
      const band = N('multiply', 1600, 140);
      L(in1, 'out', band, 'a');
      L(inv, 'out', band, 'b');
      const fadeS = N('smoothstep', 1160, 560, { values: { edge0: 0.6, edge1: 1 } });
      L(r, 'out', fadeS, 'x');
      const fade = N('oneMinus', 1380, 560);
      L(fadeS, 'out', fade, 'x');
      const alpha = N('multiply', 1820, 260);
      L(band, 'out', alpha, 'a');
      L(fade, 'out', alpha, 'b');
      const col = N('colorParam', 1600, 520, { params: { name: 'ringColor', color: '#ffc46b' } });
      const bright = N('multiply', 1820, 520, { values: { b: 3 } });
      L(col, 'rgb', bright, 'a');
      const out = N('output', 2060, 340, { params: { blending: 'additive' } });
      L(bright, 'out', out, 'color');
      L(alpha, 'out', out, 'alpha');
    },
  },
  {
    id: 'presetStripes',
    group: '內建材質',
    label: '條紋',
    mesh: 'sphere',
    desc: '同 official-demo-005-postfx-shader 的 stripes：UV.y × count + 時間 × speed 取小數，step 切成兩色',
    build(N, L) {
      const uv = N('uv', 40, 40);
      const sp = N('split', 260, 40);
      L(uv, 'uv', sp, 'v');
      const count = N('floatParam', 40, 280, { params: { name: 'count', value: 12 } });
      const speed = N('floatParam', 40, 480, { params: { name: 'speed', value: 0.5 } });
      const time = N('time', 260, 480);
      const yc = N('multiply', 500, 80);
      L(sp, 'y', yc, 'a');
      L(count, 'value', yc, 'b');
      const ts = N('multiply', 500, 400);
      L(time, 'time', ts, 'a');
      L(speed, 'value', ts, 'b');
      const add = N('add', 720, 180);
      L(yc, 'out', add, 'a');
      L(ts, 'out', add, 'b');
      const fr = N('fract', 940, 180);
      L(add, 'out', fr, 'x');
      const st = N('step', 1160, 180, { values: { edge: 0.5 } });
      L(fr, 'out', st, 'x');
      const ca = N('colorParam', 1160, 400, { params: { name: 'colorA', color: '#ff6b6b' } });
      const cb = N('colorParam', 1160, 600, { params: { name: 'colorB', color: '#ffd166' } });
      const mix = N('mix', 1400, 320);
      L(ca, 'rgb', mix, 'a');
      L(cb, 'rgb', mix, 'b');
      L(st, 'out', mix, 't');
      const out = N('output', 1640, 320);
      L(mix, 'out', out, 'color');
    },
  },

  /* ----------------------------- 內建全螢幕效果（和程式版 EffectPresets 一樣） ----------------------------- */
  {
    id: 'presetChromatic',
    group: '內建全螢幕效果',
    label: '色差',
    mesh: 'quad',
    desc: '同 EffectPresets.chromaticAberration：紅、藍通道往外偏移，越靠邊越明顯。參數 amount',
    build(N, L) {
      const uv = N('uv', 40, 40);
      const c = N('subtract', 260, 40, { values: { b: 0.5 } });
      L(uv, 'uv', c, 'a');
      const amount = N('floatParam', 40, 260, { params: { name: 'amount', value: 0.004 } });
      const m1 = N('multiply', 500, 80);
      L(c, 'out', m1, 'a');
      L(amount, 'value', m1, 'b');
      const off = N('multiply', 720, 80, { values: { b: 2 } });
      L(m1, 'out', off, 'a');
      const uvR = N('add', 940, 40);
      L(uv, 'uv', uvR, 'a');
      L(off, 'out', uvR, 'b');
      const uvB = N('subtract', 940, 300);
      L(uv, 'uv', uvB, 'a');
      L(off, 'out', uvB, 'b');
      const sR = N('screenColor', 1160, 40);
      L(uvR, 'out', sR, 'uv');
      const sG = N('screenColor', 1160, 300);
      const sB = N('screenColor', 1160, 560);
      L(uvB, 'out', sB, 'uv');
      const r = N('split', 1400, 40);
      L(sR, 'rgba', r, 'v');
      const g = N('split', 1400, 300);
      L(sG, 'rgba', g, 'v');
      const b = N('split', 1400, 560);
      L(sB, 'rgba', b, 'v');
      const cmb = N('combine', 1640, 300);
      L(r, 'x', cmb, 'x');
      L(g, 'y', cmb, 'y');
      L(b, 'z', cmb, 'z');
      const out = N('effectOutput', 1880, 300);
      L(cmb, 'xyz', out, 'color');
      L(g, 'w', out, 'alpha');
    },
  },
  {
    id: 'fxPixelate',
    group: '內建全螢幕效果',
    label: '像素化',
    mesh: 'quad',
    desc: '同 EffectPresets.pixelate：格子大小 = pixelSize ÷ 畫面大小，UV 取到格子中心再讀畫面。參數 pixelSize（像素）',
    build(N, L) {
      const size = N('screenSize', 40, 240);
      const px = N('floatParam', 40, 420, { params: { name: 'pixelSize', value: 6 } });
      const cell = N('divide', 260, 320);
      L(px, 'value', cell, 'a');
      L(size, 'size', cell, 'b');
      const uv = N('uv', 260, 40);
      const div = N('divide', 500, 80);
      L(uv, 'uv', div, 'a');
      L(cell, 'out', div, 'b');
      const fl = N('floor', 720, 80);
      L(div, 'out', fl, 'x');
      const half = N('add', 940, 80, { values: { b: 0.5 } });
      L(fl, 'out', half, 'a');
      const back = N('multiply', 1160, 120);
      L(half, 'out', back, 'a');
      L(cell, 'out', back, 'b');
      const scr = N('screenColor', 1380, 120);
      L(back, 'out', scr, 'uv');
      const out = N('effectOutput', 1600, 120);
      L(scr, 'rgb', out, 'color');
    },
  },
  {
    id: 'presetColorGrade',
    group: '內建全螢幕效果',
    label: '調色 + 暗角',
    mesh: 'quad',
    desc:
      '同後製的調色（postfx.settings.color、vignette）：亮度 → 對比 → 飽和度 → 色調，再加暗角。' +
      '參數 brightness、contrast、saturation、tint、vignetteOffset、vignetteDarkness',
    build(N, L) {
      const scr = N('screenColor', 40, 40);
      const bright = N('floatParam', 40, 280, { params: { name: 'brightness', value: 0 } });
      const contrast = N('floatParam', 40, 480, { params: { name: 'contrast', value: 1.1 } });
      const sat = N('floatParam', 40, 680, { params: { name: 'saturation', value: 1.2 } });
      const a1 = N('add', 280, 40);
      L(scr, 'rgb', a1, 'a');
      L(bright, 'value', a1, 'b');
      const c1 = N('subtract', 500, 40, { values: { b: 0.5 } });
      L(a1, 'out', c1, 'a');
      const c2 = N('multiply', 720, 40);
      L(c1, 'out', c2, 'a');
      L(contrast, 'value', c2, 'b');
      const c3 = N('add', 940, 40, { values: { b: 0.5 } });
      L(c2, 'out', c3, 'a');
      const luma = N('grayscale', 1160, 280);
      L(c3, 'out', luma, 'rgb');
      const sm = N('mix', 1400, 120);
      L(luma, 'out', sm, 'a');
      L(c3, 'out', sm, 'b');
      L(sat, 'value', sm, 't');
      const tint = N('colorParam', 1400, 440, { params: { name: 'tint', color: '#ffffff' } });
      const tinted = N('multiply', 1620, 160);
      L(sm, 'out', tinted, 'a');
      L(tint, 'rgb', tinted, 'b');
      // 暗角：離中心越遠越接近 1 − darkness
      const uv = N('uv', 940, 680);
      const off = N('floatParam', 940, 860, { params: { name: 'vignetteOffset', value: 1 } });
      const dark = N('floatParam', 1400, 860, { params: { name: 'vignetteDarkness', value: 1 } });
      const d0 = N('subtract', 1160, 680, { values: { b: 0.5 } });
      L(uv, 'uv', d0, 'a');
      const d = N('multiply', 1400, 660);
      L(d0, 'out', d, 'a');
      L(off, 'value', d, 'b');
      const dd = N('dot', 1620, 660);
      L(d, 'out', dd, 'a');
      L(d, 'out', dd, 'b');
      const edge = N('oneMinus', 1620, 880);
      L(dark, 'value', edge, 'x');
      const vig = N('mix', 1860, 380);
      L(tinted, 'out', vig, 'a');
      L(edge, 'out', vig, 'b');
      L(dd, 'out', vig, 't');
      const cl = N('saturate', 2080, 380);
      L(vig, 'out', cl, 'x');
      const out = N('effectOutput', 2300, 380);
      L(cl, 'out', out, 'color');
    },
  },
  {
    id: 'presetRain',
    group: '內建全螢幕效果',
    label: '雨落窗',
    mesh: 'quad',
    desc:
      '同 EffectPresets.rainOnWindow：隔著淋雨、起霧的玻璃看出去。Rain Drops 算出水滴，Screen Blur 是起霧的玻璃，' +
      '水滴的斜率偏移畫面做出透鏡，邊緣暗一圈、加上反光。參數 amount、speed、scale、distortion、fog、darken',
    build(N, L) {
      const time = N('time', 40, 40);
      const speed = N('floatParam', 40, 200, { params: { name: 'speed', value: 1 } });
      const amount = N('floatParam', 40, 400, { params: { name: 'amount', value: 0.7 } });
      const scale = N('floatParam', 40, 600, { params: { name: 'scale', value: 5 } });
      const t = N('multiply', 280, 80);
      L(time, 'time', t, 'a');
      L(speed, 'value', t, 'b');
      const rain = N('rainDrops', 500, 260);
      L(t, 'out', rain, 'time');
      L(amount, 'value', rain, 'amount');
      L(scale, 'value', rain, 'scale');
      // 1 = 在水滴上
      const wet = N('smoothstep', 780, 40, { values: { edge0: 0, edge1: 0.06 } });
      L(rain, 'height', wet, 'x');
      // 起霧的玻璃：模糊、稍微變暗
      const fog = N('floatParam', 500, 700, { params: { name: 'fog', value: 5 } });
      const darken = N('floatParam', 500, 900, { params: { name: 'darken', value: 0.08 } });
      const blur = N('screenBlur', 780, 660);
      L(fog, 'value', blur, 'radius');
      const keep = N('oneMinus', 780, 960);
      L(darken, 'value', keep, 'x');
      const misty = N('multiply', 1020, 760);
      L(blur, 'rgb', misty, 'a');
      L(keep, 'out', misty, 'b');
      // 水滴像小凸透鏡：依斜率偏移畫面
      const dist = N('floatParam', 780, 440, { params: { name: 'distortion', value: 0.6 } });
      const b1 = N('multiply', 1020, 300);
      L(rain, 'slope', b1, 'a');
      L(dist, 'value', b1, 'b');
      const b2 = N('multiply', 1240, 300, { values: { b: 0.003 } });
      L(b1, 'out', b2, 'a');
      const bend = N('clamp', 1460, 300, { values: { min: -0.06, max: 0.06 } });
      L(b2, 'out', bend, 'x');
      const uv = N('uv', 1460, 560);
      const uvb = N('add', 1680, 360);
      L(uv, 'uv', uvb, 'a');
      L(bend, 'out', uvb, 'b');
      const uvc = N('clamp', 1900, 360);
      L(uvb, 'out', uvc, 'x');
      const through = N('screenColor', 2120, 360);
      L(uvc, 'out', through, 'uv');
      const mixed = N('mix', 2360, 560);
      L(misty, 'out', mixed, 'a');
      L(through, 'rgb', mixed, 'b');
      L(wet, 'out', mixed, 't');
      // 邊緣暗一圈
      const hs = N('smoothstep', 1020, 40, { values: { edge0: 0, edge1: 0.4 } });
      L(rain, 'height', hs, 'x');
      const hinv = N('oneMinus', 1240, 40);
      L(hs, 'out', hinv, 'x');
      const rim = N('multiply', 1460, 40);
      L(wet, 'out', rim, 'a');
      L(hinv, 'out', rim, 'b');
      const rim2 = N('multiply', 1680, 40, { values: { b: 0.45 } });
      L(rim, 'out', rim2, 'a');
      const rimK = N('oneMinus', 1900, 40);
      L(rim2, 'out', rimK, 'x');
      const shaded = N('multiply', 2600, 300);
      L(mixed, 'out', shaded, 'a');
      L(rimK, 'out', shaded, 'b');
      // 左上方光源在水滴上的小亮點
      const light = N('combine', 1020, 1100, { values: { x: -0.45, y: 0.6, z: 0.9 } });
      const ln = N('normalize', 1240, 1100);
      L(light, 'xyz', ln, 'x');
      const dt = N('dot', 1460, 1000);
      L(rain, 'normal', dt, 'a');
      L(ln, 'out', dt, 'b');
      const mx = N('maximum', 1680, 1000, { values: { b: 0 } });
      L(dt, 'out', mx, 'a');
      const pw = N('power', 1900, 1000, { values: { b: 28 } });
      L(mx, 'out', pw, 'a');
      const g1 = N('multiply', 2120, 1000);
      L(pw, 'out', g1, 'a');
      L(wet, 'out', g1, 'b');
      const g2 = N('multiply', 2360, 1000, { values: { b: 0.7 } });
      L(g1, 'out', g2, 'a');
      const fin = N('add', 2840, 500);
      L(shaded, 'out', fin, 'a');
      L(g2, 'out', fin, 'b');
      const out = N('effectOutput', 3080, 500);
      L(fin, 'out', out, 'color');
    },
  },

  /* ----------------------------- 其他 ----------------------------- */
  {
    id: 'blank',
    group: '其他',
    label: '空白',
    build(N) {
      N('output', 400, 160);
    },
  },
  {
    id: 'blankEffect',
    group: '其他',
    label: '空白全螢幕效果',
    desc: 'Screen Color（畫面原本的顏色）接到 Effect Output：從這裡開始改',
    mesh: 'quad',
    build(N, L) {
      const scr = N('screenColor', 120, 160);
      const out = N('effectOutput', 420, 160);
      L(scr, 'rgb', out, 'color');
    },
  },
];

/** 建立範例的節點圖（找不到時是空白範例） */
export function buildExample(id: string): ShaderGraph {
  const ex = EXAMPLES.find((e) => e.id === id) ?? EXAMPLES.find((e) => e.id === 'blank')!;
  const g: ShaderGraph = { nodes: [], links: [], nextId: 1 };
  ex.build(
    (type, x, y, opts = {}) => createNode(g, type, x, y, opts).id,
    (from, fromPort, to, toPort) => {
      g.links.push({ from, fromPort, to, toPort });
    },
  );
  return g;
}

/** 在節點圖裡建立節點（填好預設值） */
export function createNode(
  g: ShaderGraph,
  type: string,
  x: number,
  y: number,
  opts: { values?: Record<string, number>; params?: Record<string, string | number> } = {},
): ShaderGraphNode {
  const def = NODE_DEFS[type];
  if (!def) throw new Error(`未知的節點類型：${type}`);
  const n: ShaderGraphNode = {
    id: g.nextId++,
    type,
    x: Math.round(x),
    y: Math.round(y),
    values: {},
    params: {},
    preview: true,
  };
  for (const i of def.inputs) if (i.default !== undefined) n.values[i.name] = i.default;
  for (const p of def.params) n.params[p.name] = p.default;
  Object.assign(n.values, opts.values ?? {});
  Object.assign(n.params, opts.params ?? {});
  g.nodes.push(n);
  return n;
}
