/**
 * 節點式著色器的節點定義與型別系統（著色器編輯器、遊戲載入節點圖都用這裡）。
 *
 * - 型別：float、vec2、vec3、vec4，以及泛型 'T'（解析成「已連接的 T 輸入裡維度最大的」，沒有連接時是 float）
 * - 型別不同時自動轉換：float 擴展成向量，向量截取前幾個分量
 * - 每個節點的 tsl 函式拿到輸入的 TSL 節點，回傳每個輸出的節點（three.js 的 TSL：.add、.mul、sin、mix…）
 * - 內建的值（UV、法線、時間、滑鼠、光源方向…）用 ctx.builtin(名稱)，見 NodeBuiltin
 *
 * 新增節點：
 *
 *   defineShaderNode({
 *     type: 'myNode', title: 'My Node', category: 'math', desc: '說明',
 *     inputs: [{ name: 'x', type: 'T', default: 0 }],   // 或 { expr: 'uv', exprType: 'vec2' }：沒有連接時的內建值
 *     outputs: [{ name: 'out', type: 'T' }],
 *     tsl: (i) => ({ out: sin(i.x) }),
 *   });
 */
import { fbm3, hsv2rgb, rotate2, sdBox } from '../functions';
import { rainHeight } from '../presets';
import { type ShaderNode, tsl } from '../tsl';

const {
  abs,
  atan,
  clamp,
  cos,
  distance,
  dot,
  float,
  floor,
  fract,
  length,
  max,
  min,
  mix,
  mod,
  normalize,
  pow,
  sRGBTransferOETF,
  sin,
  smoothstep,
  sqrt,
  step,
  vec2,
  vec3,
  vec4,
} = tsl;

/** 節點連接埠的資料型別 */
export type GraphType = 'float' | 'vec2' | 'vec3' | 'vec4';
/** 連接埠型別：實際型別或泛型 T */
export type PortType = GraphType | 'T';

/** 各型別的維度 */
export const TYPE_DIM: Record<GraphType, number> = { float: 1, vec2: 2, vec3: 3, vec4: 4 };
/** 各型別在編輯器裡的顏色（連線、連接埠） */
export const TYPE_COLOR: Record<GraphType, string> = {
  float: '#9aa7b8',
  vec2: '#4fc3f7',
  vec3: '#ffca28',
  vec4: '#f06292',
};

/**
 * 節點可以用的內建值（ctx.builtin）：
 * uv（貼圖座標）、centeredUV（置中、保持長寬比的 UV，約 -1..1）、normal（世界空間法線）、
 * worldPos（世界座標）、objectPos（物件座標）、view（指向攝影機的方向）、light（光源方向，uniform uLightDir）、
 * time（秒）、resolution（畫面大小，像素）、mouse（滑鼠位置 0..1，uniform uMouse）、
 * screen（全螢幕效果：畫面原本的顏色 rgb）
 */
export type NodeBuiltin =
  | 'uv'
  | 'centeredUV'
  | 'normal'
  | 'worldPos'
  | 'objectPos'
  | 'view'
  | 'light'
  | 'time'
  | 'resolution'
  | 'mouse'
  | 'screen';

/** 節點的一個輸入 */
export interface NodeInput {
  name: string;
  type: PortType;
  /** 沒有連接時的數值（節點上可以修改） */
  default?: number;
  /** 沒有連接時改用這個內建值（例如 uv），不能在節點上修改 */
  expr?: NodeBuiltin;
  /** expr 的型別 */
  exprType?: GraphType;
  /** expr 在編輯器裡顯示的名稱 */
  exprLabel?: string;
}

/** 節點的一個輸出 */
export interface NodeOutput {
  name: string;
  type: PortType;
}

/** 節點的參數（不是連接埠：下拉選單、顏色、數字、圖片） */
export interface NodeParam {
  name: string;
  label?: string;
  kind: 'number' | 'color' | 'select' | 'image' | 'text';
  default: string | number;
  /** 數字的間隔 */
  step?: number;
  /** 下拉選單的選項：[值, 顯示文字] */
  options?: [string, string][];
}

/** 節點的 tsl 函式可以用的東西 */
export interface NodeContext {
  /** 'vertex'：在頂點階段求值（接到 Vertex Output 的節點）；'fragment'：片段階段 */
  stage: 'vertex' | 'fragment';
  /** 'material'：材質（Fragment Output）；'effect'：全螢幕效果（Effect Output） */
  mode: 'material' | 'effect';
  /** 內建的值（見 NodeBuiltin） */
  builtin(name: NodeBuiltin): ShaderNode;
  /** 這個節點的貼圖在 uv 的顏色（vec4） */
  texture(uv: ShaderNode): ShaderNode;
  /** 畫面原本的顏色（vec4）；只有全螢幕效果有，材質裡呼叫會丟出錯誤 */
  screen(uv: ShaderNode): ShaderNode;
  /** 參數節點（Parameter、Color Parameter）的 uniform */
  param(name: string): ShaderNode;
}

/** 一種節點 */
export interface NodeDef {
  type: string;
  title: string;
  category: CategoryId;
  desc?: string;
  /** 搜尋用的關鍵字（空白隔開） */
  keywords?: string;
  /** 每張圖只能有一個 */
  unique?: boolean;
  inputs: NodeInput[];
  outputs: NodeOutput[];
  params: NodeParam[];
  /** 產生每個輸出的 TSL 節點 */
  tsl?: (
    inputs: Record<string, ShaderNode>,
    params: Record<string, string | number>,
    T: GraphType,
    ctx: NodeContext,
  ) => Record<string, ShaderNode>;
}

/** defineShaderNode 的參數（inputs、outputs、params 可以省略） */
export type NodeDefInput = Omit<NodeDef, 'inputs' | 'outputs' | 'params'> &
  Partial<Pick<NodeDef, 'inputs' | 'outputs' | 'params'>>;

/** 較寬的型別 */
export function widerType(a: GraphType, b: GraphType): GraphType {
  return TYPE_DIM[b] > TYPE_DIM[a] ? b : a;
}

/** 把節點從一種型別轉成另一種（float 擴展成向量，向量截取前幾個分量） */
export function convertType(node: ShaderNode, from: GraphType, to: GraphType): ShaderNode {
  if (from === to) return node;
  const make = { float, vec2, vec3, vec4 }[to];
  if (from === 'float') return make(node);
  if (to === 'float') return node.x;
  const f = TYPE_DIM[from];
  const t = TYPE_DIM[to];
  if (t < f) return node['xyzw'.slice(0, t)];
  if (from === 'vec2' && to === 'vec3') return vec3(node, 0);
  if (from === 'vec2' && to === 'vec4') return vec4(node, 0, 1);
  if (from === 'vec3' && to === 'vec4') return vec4(node, 1);
  return node;
}

/** 參數的數值（不是數字時是 0） */
function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** '#rrggbb' 轉成 vec3（0..1，不做色彩空間轉換：節點圖的顏色是畫面上的顏色） */
export function hexColor(hex: string): ShaderNode {
  const n = Number.parseInt(String(hex).slice(1), 16) || 0;
  return vec3(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

// ───────── 節點圖自己的雜訊（和以前的 GLSL 一樣的算法：既有的節點圖畫出來一樣） ─────────

function sgHash21(p: ShaderNode): ShaderNode {
  let q = fract(p.mul(vec2(123.34, 456.21)));
  q = q.add(dot(q, q.add(45.32)));
  return fract(q.x.mul(q.y));
}

function sgNoise(p: ShaderNode): ShaderNode {
  const i = floor(p);
  const f = fract(p);
  const u = f.mul(f).mul(f.mul(-2).add(3));
  return mix(
    mix(sgHash21(i), sgHash21(i.add(vec2(1, 0))), u.x),
    mix(sgHash21(i.add(vec2(0, 1))), sgHash21(i.add(vec2(1, 1))), u.x),
    u.y,
  );
}

function sgFbm(p: ShaderNode): ShaderNode {
  let v: ShaderNode = float(0);
  let a = 0.5;
  let q = p;
  for (let i = 0; i < 5; i++) {
    v = v.add(sgNoise(q).mul(a));
    // mat2(1.6, 1.2, -1.2, 1.6) * q
    q = vec2(q.x.mul(1.6).sub(q.y.mul(1.2)), q.x.mul(1.2).add(q.y.mul(1.6)));
    a *= 0.5;
  }
  return v;
}

function sgVoronoi(p: ShaderNode, t: ShaderNode): ShaderNode {
  const i = floor(p);
  const f = fract(p);
  let d: ShaderNode = float(8);
  for (let y = -1; y <= 1; y++) {
    for (let x = -1; x <= 1; x++) {
      const g = vec2(x, y);
      const o = sin(
        vec2(sgHash21(i.add(g)), sgHash21(i.add(g).add(17)))
          .mul(6.2831)
          .add(t),
      )
        .mul(0.5)
        .add(0.5);
      d = min(d, length(g.add(o).sub(f)));
    }
  }
  return d;
}

/** 節點分類 */
export type CategoryId = 'input' | 'math' | 'vector' | 'pattern' | 'light' | 'color' | 'output';

/** 節點分類（節點庫的順序與顏色） */
export const CATEGORIES: readonly { id: CategoryId; label: string; color: string }[] = [
  { id: 'input', label: '輸入', color: '#3b82f6' },
  { id: 'math', label: '數學', color: '#10b981' },
  { id: 'vector', label: '向量 / UV', color: '#f59e0b' },
  { id: 'pattern', label: '形狀與雜訊', color: '#8b5cf6' },
  { id: 'light', label: '光照', color: '#06b6d4' },
  { id: 'color', label: '顏色', color: '#ec4899' },
  { id: 'output', label: '輸出', color: '#ef4444' },
];

/** 餘弦調色盤的配色 */
export const PALETTES: Record<string, { label: string; a: number[]; b: number[]; c: number[]; d: number[] }> = {
  rainbow: { label: '彩虹', a: [0.5, 0.5, 0.5], b: [0.5, 0.5, 0.5], c: [1, 1, 1], d: [0, 0.33, 0.67] },
  sunset: { label: '夕陽', a: [0.5, 0.5, 0.5], b: [0.5, 0.5, 0.5], c: [1, 1, 1], d: [0, 0.1, 0.2] },
  ocean: { label: '海洋', a: [0.5, 0.5, 0.5], b: [0.5, 0.5, 0.5], c: [1, 1, 0.5], d: [0.8, 0.9, 0.3] },
  neon: { label: '霓虹', a: [0.5, 0.5, 0.5], b: [0.5, 0.5, 0.5], c: [2, 1, 0], d: [0.5, 0.2, 0.25] },
  forest: { label: '森林', a: [0.8, 0.5, 0.4], b: [0.2, 0.4, 0.2], c: [2, 1, 1], d: [0, 0.25, 0.25] },
};

/** 所有節點（type → 定義） */
export const NODE_DEFS: Record<string, NodeDef> = {};

/**
 * 新增一種節點（已經有同名的會取代）
 * @param d 節點定義：種類、標題、分類、輸入、輸出、參數、tsl 函式
 */
export function defineShaderNode(d: NodeDefInput): NodeDef {
  const def: NodeDef = { inputs: [], outputs: [], params: [], ...d };
  NODE_DEFS[def.type] = def;
  return def;
}

const N = defineShaderNode;
const uvIn = (name = 'p'): NodeInput => ({ name, type: 'vec2', expr: 'uv', exprType: 'vec2', exprLabel: 'UV' });
const centeredIn = (name = 'p'): NodeInput => ({
  name,
  type: 'vec2',
  expr: 'centeredUV',
  exprType: 'vec2',
  exprLabel: '置中 UV',
});
const normalIn: NodeInput = { name: 'normal', type: 'vec3', expr: 'normal', exprType: 'vec3', exprLabel: 'Normal' };
const lightIn: NodeInput = { name: 'light', type: 'vec3', expr: 'light', exprType: 'vec3', exprLabel: 'Light' };
const viewIn: NodeInput = { name: 'view', type: 'vec3', expr: 'view', exprType: 'vec3', exprLabel: 'View' };

// ───────── 輸入 ─────────
N({
  type: 'uv',
  title: 'UV',
  category: 'input',
  desc: '網格的貼圖座標 (0..1)',
  outputs: [{ name: 'uv', type: 'vec2' }],
  tsl: (_i, _p, _T, ctx) => ({ uv: ctx.builtin('uv') }),
});
N({
  type: 'centeredUV',
  title: 'Centered UV',
  category: 'input',
  desc: '置中且保持長寬比的 UV (-1..1)',
  outputs: [{ name: 'uv', type: 'vec2' }],
  tsl: (_i, _p, _T, ctx) => ({ uv: ctx.builtin('centeredUV') }),
});
N({
  type: 'time',
  title: 'Time',
  category: 'input',
  desc: '經過秒數（遊戲裡是引擎的 uTime）',
  keywords: '時間',
  outputs: [{ name: 'time', type: 'float' }],
  tsl: (_i, _p, _T, ctx) => ({ time: ctx.builtin('time') }),
});
N({
  type: 'screenColor',
  title: 'Screen Color',
  category: 'input',
  desc: '全螢幕效果：畫面上這個位置原本的顏色（只能用在有 Effect Output 的圖）。UV 可以偏移，做出扭曲、色差、模糊',
  keywords: '畫面 螢幕 後製 screen 原本的顏色',
  inputs: [uvIn('uv')],
  outputs: [
    { name: 'rgba', type: 'vec4' },
    { name: 'rgb', type: 'vec3' },
    { name: 'a', type: 'float' },
  ],
  tsl: (i, _p, _T, ctx) => {
    const rgba = ctx.screen(i.uv);
    return { rgba, rgb: rgba.rgb, a: rgba.a };
  },
});
N({
  type: 'screenSize',
  title: 'Screen Size',
  category: 'input',
  desc: '畫面大小（像素）。一個像素在 UV 上是 1 / Screen Size，像素化、描邊等效果會用到',
  keywords: '解析度 畫面 寬高 resolution 像素',
  outputs: [{ name: 'size', type: 'vec2' }],
  tsl: (_i, _p, _T, ctx) => ({ size: ctx.builtin('resolution') }),
});
N({
  type: 'mouse',
  title: 'Mouse',
  category: 'input',
  desc: '滑鼠位置 (0..1)：預覽時是預覽畫面裡的位置；遊戲裡設定材質的 uniform uMouse',
  keywords: '滑鼠',
  outputs: [{ name: 'pos', type: 'vec2' }],
  tsl: (_i, _p, _T, ctx) => ({ pos: ctx.builtin('mouse') }),
});
N({
  type: 'float',
  title: 'Float',
  category: 'input',
  desc: '常數數值',
  keywords: '數值 常數 number',
  params: [{ name: 'value', label: '值', kind: 'number', default: 1, step: 0.1 }],
  outputs: [{ name: 'value', type: 'float' }],
  tsl: (_i, p) => ({ value: float(num(p.value)) }),
});
N({
  type: 'color',
  title: 'Color',
  category: 'input',
  desc: '常數顏色',
  keywords: '顏色 rgb',
  params: [{ name: 'color', label: '顏色', kind: 'color', default: '#ff7a45' }],
  outputs: [{ name: 'rgb', type: 'vec3' }],
  tsl: (_i, p) => ({ rgb: hexColor(String(p.color)) }),
});
N({
  type: 'texture',
  title: 'Texture',
  category: 'input',
  desc: '圖片貼圖（上傳圖片，或直接把圖檔拖進節點圖；沒有圖片時用內建 UV 格線）',
  keywords: '貼圖 圖片 image sampler 材質',
  params: [
    { name: 'image', label: '圖片', kind: 'image', default: '' },
    {
      name: 'wrap',
      label: '環繞',
      kind: 'select',
      default: 'repeat',
      options: [
        ['repeat', '重複'],
        ['clamp', '延伸邊緣'],
        ['mirror', '鏡像重複'],
      ],
    },
  ],
  inputs: [uvIn('uv')],
  outputs: [
    { name: 'rgba', type: 'vec4' },
    { name: 'rgb', type: 'vec3' },
    { name: 'a', type: 'float' },
  ],
  tsl: (i, _p, _T, ctx) => {
    const rgba = ctx.texture(i.uv);
    return { rgba, rgb: rgba.rgb, a: rgba.a };
  },
});
N({
  type: 'normal',
  title: 'Normal',
  category: 'input',
  desc: '世界空間法線',
  keywords: '法線',
  outputs: [{ name: 'n', type: 'vec3' }],
  tsl: (_i, _p, _T, ctx) => ({ n: ctx.builtin('normal') }),
});
N({
  type: 'worldPos',
  title: 'World Position',
  category: 'input',
  desc: '世界空間座標',
  keywords: '位置 position',
  outputs: [{ name: 'pos', type: 'vec3' }],
  tsl: (_i, _p, _T, ctx) => ({ pos: ctx.builtin('worldPos') }),
});
N({
  type: 'objectPos',
  title: 'Object Position',
  category: 'input',
  desc: '物件座標（不隨物件移動、旋轉、縮放；花紋會固定在物件上）',
  keywords: '位置 local 物件 position',
  outputs: [{ name: 'pos', type: 'vec3' }],
  tsl: (_i, _p, _T, ctx) => ({ pos: ctx.builtin('objectPos') }),
});
N({
  type: 'viewDir',
  title: 'View Direction',
  category: 'input',
  desc: '指向攝影機的方向',
  keywords: '視線 camera',
  outputs: [{ name: 'dir', type: 'vec3' }],
  tsl: (_i, _p, _T, ctx) => ({ dir: ctx.builtin('view') }),
});
N({
  type: 'lightDir',
  title: 'Light Direction',
  category: 'input',
  desc: '方向光的方向（遊戲裡設定材質的 uniform uLightDir）',
  keywords: '光源',
  outputs: [{ name: 'dir', type: 'vec3' }],
  tsl: (_i, _p, _T, ctx) => ({ dir: ctx.builtin('light') }),
});
N({
  type: 'floatParam',
  title: 'Parameter',
  category: 'input',
  desc: '可以在遊戲裡調整的數值：變成材質或效果的 uniform（material.uniforms.名稱.value、effect.uniforms.名稱.value，或後製設定的 uniforms）。名稱相同的參數節點是同一個值',
  keywords: '參數 uniform 變數 可調 屬性 property',
  params: [
    { name: 'name', label: '名稱', kind: 'text', default: 'amount' },
    { name: 'value', label: '預設值', kind: 'number', default: 1, step: 0.1 },
  ],
  outputs: [{ name: 'value', type: 'float' }],
  tsl: (_i, p, _T, ctx) => ({ value: ctx.param(String(p.name)) }),
});
N({
  type: 'colorParam',
  title: 'Color Parameter',
  category: 'input',
  desc: '可以在遊戲裡調整的顏色：變成 uniform（THREE.Color，例如 material.uniforms.名稱.value.set("#ff0000")）。名稱相同的參數節點是同一個值',
  keywords: '參數 uniform 顏色 可調 屬性 property color',
  params: [
    { name: 'name', label: '名稱', kind: 'text', default: 'tint' },
    { name: 'color', label: '預設值', kind: 'color', default: '#ffffff' },
  ],
  outputs: [{ name: 'rgb', type: 'vec3' }],
  // uniform 是線性的 THREE.Color（和 three.js 一樣）；節點圖用畫面上的顏色，轉回 sRGB
  tsl: (_i, p, _T, ctx) => ({ rgb: sRGBTransferOETF(ctx.param(String(p.name))) }),
});
N({
  type: 'screenBlur',
  title: 'Screen Blur',
  category: 'input',
  desc: '全螢幕效果：畫面模糊後的顏色（圓盤狀取樣，亮的地方散成光斑）。半徑是像素，取樣數越多越平滑也越耗效能',
  keywords: '模糊 blur 起霧 散景 bokeh 畫面',
  params: [
    {
      name: 'samples',
      label: '取樣數',
      kind: 'select',
      default: '16',
      options: [
        ['8', '8'],
        ['16', '16'],
        ['32', '32'],
      ],
    },
  ],
  inputs: [uvIn('uv'), { name: 'radius', type: 'float', default: 5 }],
  outputs: [
    { name: 'rgba', type: 'vec4' },
    { name: 'rgb', type: 'vec3' },
    { name: 'a', type: 'float' },
  ],
  tsl: (i, p, _T, ctx) => {
    const n = Math.max(1, Math.round(num(p.samples)) || 16);
    const res = ctx.builtin('resolution');
    let sum: ShaderNode = vec4(0);
    // 黃金角螺旋：取樣點平均分布在圓盤裡
    for (let k = 0; k < n; k++) {
      const ang = k * 2.39996;
      const rad = Math.sqrt((k + 0.5) / n);
      const off = vec2(Math.cos(ang) * rad, Math.sin(ang) * rad)
        .mul(i.radius)
        .div(res);
      sum = sum.add(ctx.screen(i.uv.add(off)));
    }
    const rgba = sum.div(n);
    return { rgba, rgb: rgba.rgb, a: rgba.a };
  },
});

// ───────── 數學 ─────────
for (const [type, title, desc, op, b] of [
  ['add', 'Add', '相加', (a: ShaderNode, x: ShaderNode) => a.add(x), 0],
  ['subtract', 'Subtract', '相減', (a: ShaderNode, x: ShaderNode) => a.sub(x), 0],
  ['multiply', 'Multiply', '相乘', (a: ShaderNode, x: ShaderNode) => a.mul(x), 1],
  ['divide', 'Divide', '相除', (a: ShaderNode, x: ShaderNode) => a.div(x), 1],
] as const)
  N({
    type,
    title,
    desc,
    category: 'math',
    inputs: [
      { name: 'a', type: 'T', default: 0 },
      { name: 'b', type: 'T', default: b },
    ],
    outputs: [{ name: 'out', type: 'T' }],
    tsl: (i) => ({ out: op(i.a, i.b) }),
  });

for (const [type, title, desc, fn, b] of [
  ['power', 'Power', '次方 pow(a, b)', pow, 2],
  ['minimum', 'Min', '取最小值', min, 0],
  ['maximum', 'Max', '取最大值', max, 0],
  ['modulo', 'Mod', '取餘數', mod, 1],
] as const)
  N({
    type,
    title,
    desc,
    category: 'math',
    inputs: [
      { name: 'a', type: 'T', default: 1 },
      { name: 'b', type: 'T', default: b },
    ],
    outputs: [{ name: 'out', type: 'T' }],
    tsl: (i) => ({ out: fn(i.a, i.b) }),
  });

for (const [type, title, desc, f] of [
  ['sin', 'Sin', '正弦', (x: ShaderNode) => sin(x)],
  ['cos', 'Cos', '餘弦', (x: ShaderNode) => cos(x)],
  ['abs', 'Abs', '絕對值', (x: ShaderNode) => abs(x)],
  ['fract', 'Fract', '小數部分', (x: ShaderNode) => fract(x)],
  ['floor', 'Floor', '無條件捨去', (x: ShaderNode) => floor(x)],
  ['sqrt', 'Sqrt', '平方根', (x: ShaderNode) => sqrt(x)],
  ['negate', 'Negate', '取負號', (x: ShaderNode) => x.negate()],
  ['oneMinus', 'One Minus', '1 - x（反相）', (x: ShaderNode) => x.oneMinus()],
  ['saturate', 'Saturate', '限制在 0..1', (x: ShaderNode) => clamp(x, 0, 1)],
  ['normalize', 'Normalize', '正規化向量', (x: ShaderNode) => normalize(x)],
] as const)
  N({
    type,
    title,
    desc,
    category: 'math',
    inputs: [{ name: 'x', type: 'T', default: 0 }],
    outputs: [{ name: 'out', type: 'T' }],
    tsl: (i) => ({ out: f(i.x) }),
  });

N({
  type: 'length',
  title: 'Length',
  category: 'math',
  desc: '向量長度',
  inputs: [{ name: 'v', type: 'T', default: 0 }],
  outputs: [{ name: 'out', type: 'float' }],
  tsl: (i) => ({ out: length(i.v) }),
});
N({
  type: 'distance',
  title: 'Distance',
  category: 'math',
  desc: '兩點距離',
  inputs: [
    { name: 'a', type: 'T', default: 0 },
    { name: 'b', type: 'T', default: 0 },
  ],
  outputs: [{ name: 'out', type: 'float' }],
  tsl: (i) => ({ out: distance(i.a, i.b) }),
});
N({
  type: 'dot',
  title: 'Dot',
  category: 'math',
  desc: '內積',
  inputs: [
    { name: 'a', type: 'T', default: 0 },
    { name: 'b', type: 'T', default: 0 },
  ],
  outputs: [{ name: 'out', type: 'float' }],
  tsl: (i) => ({ out: dot(i.a, i.b) }),
});
N({
  type: 'mix',
  title: 'Lerp',
  category: 'math',
  desc: '線性內插 mix(a, b, t)',
  keywords: 'mix 混合 內插',
  inputs: [
    { name: 'a', type: 'T', default: 0 },
    { name: 'b', type: 'T', default: 1 },
    { name: 't', type: 'float', default: 0.5 },
  ],
  outputs: [{ name: 'out', type: 'T' }],
  tsl: (i) => ({ out: mix(i.a, i.b, i.t) }),
});
N({
  type: 'clamp',
  title: 'Clamp',
  category: 'math',
  desc: '限制範圍',
  inputs: [
    { name: 'x', type: 'T', default: 0 },
    { name: 'min', type: 'float', default: 0 },
    { name: 'max', type: 'float', default: 1 },
  ],
  outputs: [{ name: 'out', type: 'T' }],
  tsl: (i) => ({ out: clamp(i.x, i.min, i.max) }),
});
N({
  type: 'smoothstep',
  title: 'Smoothstep',
  category: 'math',
  desc: '平滑階梯',
  inputs: [
    { name: 'edge0', type: 'float', default: 0 },
    { name: 'edge1', type: 'float', default: 1 },
    { name: 'x', type: 'T', default: 0 },
  ],
  outputs: [{ name: 'out', type: 'T' }],
  tsl: (i) => ({ out: smoothstep(i.edge0, i.edge1, i.x) }),
});
N({
  type: 'step',
  title: 'Step',
  category: 'math',
  desc: '階梯函數',
  inputs: [
    { name: 'edge', type: 'float', default: 0.5 },
    { name: 'x', type: 'T', default: 0 },
  ],
  outputs: [{ name: 'out', type: 'T' }],
  tsl: (i) => ({ out: step(i.edge, i.x) }),
});
N({
  type: 'remap',
  title: 'Remap',
  category: 'math',
  desc: '將數值從一個範圍映射到另一個範圍',
  keywords: '映射',
  inputs: [
    { name: 'x', type: 'T', default: 0 },
    { name: 'inMin', type: 'float', default: -1 },
    { name: 'inMax', type: 'float', default: 1 },
    { name: 'outMin', type: 'float', default: 0 },
    { name: 'outMax', type: 'float', default: 1 },
  ],
  outputs: [{ name: 'out', type: 'T' }],
  tsl: (i) => ({ out: i.outMin.add(i.x.sub(i.inMin).div(i.inMax.sub(i.inMin)).mul(i.outMax.sub(i.outMin))) }),
});

// ───────── 向量 / UV ─────────
N({
  type: 'split',
  title: 'Split',
  category: 'vector',
  desc: '拆分向量成 x y z w',
  keywords: '拆分 分量',
  inputs: [{ name: 'v', type: 'vec4', default: 0 }],
  outputs: ['x', 'y', 'z', 'w'].map((n) => ({ name: n, type: 'float' as const })),
  tsl: (i) => ({ x: i.v.x, y: i.v.y, z: i.v.z, w: i.v.w }),
});
N({
  type: 'combine',
  title: 'Combine',
  category: 'vector',
  desc: '由分量組合向量',
  keywords: '組合 vector',
  inputs: [
    { name: 'x', type: 'float', default: 0 },
    { name: 'y', type: 'float', default: 0 },
    { name: 'z', type: 'float', default: 0 },
    { name: 'w', type: 'float', default: 1 },
  ],
  outputs: [
    { name: 'xy', type: 'vec2' },
    { name: 'xyz', type: 'vec3' },
    { name: 'xyzw', type: 'vec4' },
  ],
  tsl: (i) => ({ xy: vec2(i.x, i.y), xyz: vec3(i.x, i.y, i.z), xyzw: vec4(i.x, i.y, i.z, i.w) }),
});
N({
  type: 'rotate',
  title: 'Rotate 2D',
  category: 'vector',
  desc: '旋轉 2D 座標（弧度）',
  keywords: '旋轉',
  inputs: [centeredIn(), { name: 'angle', type: 'float', default: 0 }],
  outputs: [{ name: 'out', type: 'vec2' }],
  tsl: (i) => ({ out: rotate2(i.p, i.angle) }),
});
N({
  type: 'polar',
  title: 'Polar',
  category: 'vector',
  desc: '轉為極座標 (角度 0..1, 半徑)',
  keywords: '極座標',
  inputs: [centeredIn()],
  outputs: [{ name: 'out', type: 'vec2' }],
  tsl: (i) => ({ out: vec2(atan(i.p.y, i.p.x).div(6.28318).add(0.5), length(i.p)) }),
});
N({
  type: 'tile',
  title: 'Tile',
  category: 'vector',
  desc: '重複平鋪座標',
  keywords: '平鋪 repeat',
  inputs: [uvIn(), { name: 'count', type: 'float', default: 4 }],
  outputs: [{ name: 'out', type: 'vec2' }],
  tsl: (i) => ({ out: fract(i.p.mul(i.count)) }),
});

// ───────── 形狀與雜訊 ─────────
N({
  type: 'circle',
  title: 'Circle SDF',
  category: 'pattern',
  desc: '圓形距離場（內部為負）',
  keywords: '圓',
  inputs: [centeredIn(), { name: 'radius', type: 'float', default: 0.5 }],
  outputs: [{ name: 'd', type: 'float' }],
  tsl: (i) => ({ d: length(i.p).sub(i.radius) }),
});
N({
  type: 'box',
  title: 'Box SDF',
  category: 'pattern',
  desc: '矩形距離場',
  keywords: '方形 矩形',
  inputs: [
    centeredIn(),
    { name: 'width', type: 'float', default: 0.5 },
    { name: 'height', type: 'float', default: 0.5 },
  ],
  outputs: [{ name: 'd', type: 'float' }],
  tsl: (i) => ({ d: sdBox(i.p, vec2(i.width, i.height)) }),
});
N({
  type: 'checker',
  title: 'Checker',
  category: 'pattern',
  desc: '棋盤格',
  keywords: '棋盤',
  inputs: [uvIn(), { name: 'count', type: 'float', default: 8 }],
  outputs: [{ name: 'out', type: 'float' }],
  tsl: (i) => ({ out: mod(floor(i.p.x.mul(i.count)).add(floor(i.p.y.mul(i.count))), 2) }),
});
N({
  type: 'noise',
  title: 'Value Noise',
  category: 'pattern',
  desc: '平滑數值雜訊',
  keywords: '雜訊',
  inputs: [uvIn(), { name: 'scale', type: 'float', default: 8 }],
  outputs: [{ name: 'out', type: 'float' }],
  tsl: (i) => ({ out: sgNoise(i.p.mul(i.scale)) }),
});
N({
  type: 'fbm',
  title: 'FBM',
  category: 'pattern',
  desc: '分形布朗運動（多層雜訊）',
  keywords: '雜訊 雲',
  inputs: [uvIn(), { name: 'scale', type: 'float', default: 4 }],
  outputs: [{ name: 'out', type: 'float' }],
  tsl: (i) => ({ out: sgFbm(i.p.mul(i.scale)) }),
});
N({
  type: 'voronoi',
  title: 'Voronoi',
  category: 'pattern',
  desc: '細胞雜訊（到最近點的距離）',
  keywords: '細胞 cell',
  inputs: [uvIn(), { name: 'scale', type: 'float', default: 6 }, { name: 'time', type: 'float', default: 0 }],
  outputs: [{ name: 'd', type: 'float' }],
  tsl: (i) => ({ d: sgVoronoi(i.p.mul(i.scale), i.time) }),
});
N({
  type: 'fbm3',
  title: '3D FBM',
  category: 'pattern',
  desc: '3D 的多層雜訊（輸入是 3D 座標，例如物件或世界座標）：花紋貼在物件表面上不會因為 UV 接縫斷開。結果約 0..1',
  keywords: '雜訊 noise 3d 溶解 dissolve 雲',
  inputs: [
    { name: 'p', type: 'vec3', expr: 'objectPos', exprType: 'vec3', exprLabel: '物件座標' },
    { name: 'scale', type: 'float', default: 2.5 },
  ],
  outputs: [{ name: 'out', type: 'float' }],
  tsl: (i) => ({ out: fbm3(i.p.mul(i.scale)) }),
});
N({
  type: 'rainDrops',
  title: 'Rain Drops',
  category: 'pattern',
  desc: '玻璃上的雨滴：往下滑的大水滴（留下一串小水珠）、隨機出現又蒸發的小水滴。height 是水的高度（0 = 乾的），slope 是水面斜率（拿來偏移畫面做折射），normal 是水面法線',
  keywords: '雨 水滴 玻璃 rain 窗戶 折射',
  inputs: [
    uvIn('uv'),
    { name: 'time', type: 'float', expr: 'time', exprType: 'float', exprLabel: 'Time' },
    { name: 'amount', type: 'float', default: 0.7 },
    { name: 'scale', type: 'float', default: 5 },
  ],
  outputs: [
    { name: 'height', type: 'float' },
    { name: 'slope', type: 'vec2' },
    { name: 'normal', type: 'vec3' },
  ],
  tsl: (i, _p, _T, ctx) => {
    const res = ctx.builtin('resolution');
    const effect = ctx.mode === 'effect';
    const aspect = effect ? res.x.div(res.y) : float(1);
    const ex = effect ? float(1).div(res.y) : float(1 / 512);
    const h = rainHeight(i.uv, i.time, aspect, i.scale, i.amount);
    const hx = rainHeight(i.uv.add(vec2(ex, 0)), i.time, aspect, i.scale, i.amount);
    const hy = rainHeight(i.uv.add(vec2(0, ex)), i.time, aspect, i.scale, i.amount);
    const slope = vec2(hx.sub(h), hy.sub(h)).div(ex);
    return { height: h, slope, normal: normalize(vec3(slope.mul(-0.0025), 1)) };
  },
});

// ───────── 光照 ─────────
N({
  type: 'lambert',
  title: 'Lambert',
  category: 'light',
  desc: '漫反射 max(N·L, 0)',
  keywords: '漫反射 diffuse',
  inputs: [normalIn, lightIn],
  outputs: [{ name: 'out', type: 'float' }],
  tsl: (i) => ({ out: max(dot(i.normal, i.light), 0) }),
});
N({
  type: 'specular',
  title: 'Specular',
  category: 'light',
  desc: 'Blinn-Phong 高光',
  keywords: '高光 phong',
  inputs: [normalIn, lightIn, viewIn, { name: 'shininess', type: 'float', default: 32 }],
  outputs: [{ name: 'out', type: 'float' }],
  tsl: (i) => ({ out: pow(max(dot(i.normal, normalize(i.light.add(i.view))), 0), i.shininess) }),
});
N({
  type: 'fresnel',
  title: 'Fresnel',
  category: 'light',
  desc: '邊緣光（視角越斜越亮）',
  keywords: '邊緣 rim',
  inputs: [normalIn, viewIn, { name: 'power', type: 'float', default: 3 }],
  outputs: [{ name: 'out', type: 'float' }],
  tsl: (i) => ({ out: pow(float(1).sub(clamp(dot(i.normal, i.view), 0, 1)), i.power) }),
});

// ───────── 顏色 ─────────
N({
  type: 'palette',
  title: 'Cosine Palette',
  category: 'color',
  desc: '餘弦調色盤（t → 顏色）',
  keywords: '調色盤 漸層 gradient',
  params: [
    {
      name: 'preset',
      label: '配色',
      kind: 'select',
      default: 'rainbow',
      options: Object.entries(PALETTES).map(([k, v]) => [k, v.label]),
    },
  ],
  inputs: [{ name: 't', type: 'float', default: 0 }],
  outputs: [{ name: 'rgb', type: 'vec3' }],
  tsl: (i, p) => {
    const P = PALETTES[String(p.preset)] ?? PALETTES.rainbow;
    const v = (a: number[]) => vec3(a[0], a[1], a[2]);
    return { rgb: v(P.a).add(v(P.b).mul(cos(v(P.c).mul(i.t).add(v(P.d)).mul(6.28318)))) };
  },
});
N({
  type: 'hsv',
  title: 'HSV → RGB',
  category: 'color',
  desc: '色相 / 飽和度 / 明度轉 RGB',
  keywords: '色相 hue',
  inputs: [
    { name: 'h', type: 'float', default: 0 },
    { name: 's', type: 'float', default: 1 },
    { name: 'v', type: 'float', default: 1 },
  ],
  outputs: [{ name: 'rgb', type: 'vec3' }],
  tsl: (i) => ({ rgb: hsv2rgb(vec3(i.h, i.s, i.v)) }),
});
N({
  type: 'grayscale',
  title: 'Luminance',
  category: 'color',
  desc: '顏色轉亮度',
  keywords: '灰階 亮度',
  inputs: [{ name: 'rgb', type: 'vec3', default: 0 }],
  outputs: [{ name: 'out', type: 'float' }],
  tsl: (i) => ({ out: dot(i.rgb, vec3(0.299, 0.587, 0.114)) }),
});

// ───────── 輸出 ─────────
N({
  type: 'output',
  title: 'Fragment Output',
  category: 'output',
  unique: true,
  desc:
    '最終輸出顏色（每張圖只能有一個）。光照選「標準」時 color 是基本色，會受場景的燈光、陰影影響，emissive 是自己發的光（超過 1 的部分當成亮度倍數）。' +
    '透明：「自動」在 alpha 小於 1 或有連接時半透明；「裁切」把 alpha 小於 0.5 的像素丟掉（溶解、鏤空，仍然是不透明材質）',
  keywords: '輸出 fragment 光照 lit 透明 混合 blending emissive 發光',
  params: [
    {
      name: 'side',
      label: '畫哪一面',
      kind: 'select',
      default: 'front',
      options: [
        ['front', '正面'],
        ['double', '兩面'],
        ['back', '背面'],
      ],
    },
    {
      name: 'lighting',
      label: '光照',
      kind: 'select',
      default: 'unlit',
      options: [
        ['unlit', '不受光（顏色就是最後的顏色）'],
        ['standard', '標準（受燈光、陰影影響）'],
      ],
    },
    {
      name: 'alphaMode',
      label: '透明',
      kind: 'select',
      default: 'auto',
      options: [
        ['auto', '自動（半透明）'],
        ['clip', '裁切（alpha < 0.5 丟掉）'],
      ],
    },
    {
      name: 'blending',
      label: '混合',
      kind: 'select',
      default: 'normal',
      options: [
        ['normal', '一般'],
        ['additive', '疊加（發光、全像）'],
      ],
    },
    { name: 'roughness', label: '粗糙度', kind: 'number', default: 0.5, step: 0.05 },
    { name: 'metalness', label: '金屬度', kind: 'number', default: 0, step: 0.05 },
  ],
  inputs: [
    { name: 'color', type: 'vec3', default: 0 },
    { name: 'alpha', type: 'float', default: 1 },
    { name: 'emissive', type: 'vec3', default: 0 },
  ],
});
N({
  type: 'effectOutput',
  title: 'Effect Output',
  category: 'output',
  unique: true,
  desc: '全螢幕效果（後製）的輸出：畫面每個像素的新顏色。有這個節點時，這張圖是全螢幕效果而不是材質，用 Screen Color 讀取畫面原本的顏色。沒有連接時是畫面原本的顏色',
  keywords: '後製 效果 post effect 全螢幕 畫面',
  inputs: [
    { name: 'color', type: 'vec3', expr: 'screen', exprType: 'vec3', exprLabel: '畫面' },
    { name: 'alpha', type: 'float', default: 1 },
  ],
});
N({
  type: 'vertexOutput',
  title: 'Vertex Output',
  category: 'output',
  unique: true,
  desc: '頂點位移：沿法線位移 + 位置偏移（每張圖只能有一個）。接到這裡的節點在頂點著色器求值',
  keywords: '頂點 位移 displacement vertex 高度',
  params: [
    {
      name: 'normals',
      label: '法線',
      kind: 'select',
      default: 'smooth',
      options: [
        ['smooth', '原始（平滑）'],
        ['flat', '依位移重算'],
      ],
    },
  ],
  inputs: [
    { name: 'displacement', type: 'float', default: 0 },
    { name: 'offset', type: 'vec3', default: 0 },
  ],
});
