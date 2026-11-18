/**
 * 節點式著色器的節點定義與型別系統（著色器編輯器、遊戲載入節點圖都用這裡）。
 *
 * - 型別：float、vec2、vec3、vec4，以及泛型 'T'（解析成「已連接的 T 輸入裡維度最大的」，沒有連接時是 float）
 * - 型別不同時自動轉換：float 擴展成向量，向量截取前幾個分量
 * - 節點產生的 GLSL 可以用的變數：vUv、sgNormal（世界空間法線）、sgWorldPos（世界座標）、
 *   sgObjPos（物件座標，只在片段著色器；頂點著色器用 position）、cameraPosition、
 *   uTime，以及節點圖的 uniform uMouse、uAspect、uLightDir（見 compile.ts）
 *
 * 新增節點：
 *
 *   defineShaderNode({
 *     type: 'myNode', title: 'My Node', category: 'math', desc: '說明',
 *     inputs: [{ name: 'x', type: 'T', default: 0 }],   // 或 { expr: 'vUv', exprType: 'vec2' }：沒有連接時的值
 *     outputs: [{ name: 'out', type: 'T' }],
 *     glsl: (i) => ({ out: `sin(${i.x})` }),
 *   });
 */

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

/** 置中、保持長寬比的 UV（範圍約 -1..1） */
export const CENTERED_UV = '((vUv - 0.5) * vec2(uAspect, 1.0) * 2.0)';
/** 世界空間法線 */
const N_EXPR = 'sgNormal';
/** 指向攝影機的方向 */
const V_EXPR = 'normalize(cameraPosition - sgWorldPos)';

/** 節點的一個輸入 */
export interface NodeInput {
  name: string;
  type: PortType;
  /** 沒有連接時的數值（節點上可以修改） */
  default?: number;
  /** 沒有連接時改用這段 GLSL（例如 vUv），不能在節點上修改 */
  expr?: string;
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
  kind: 'number' | 'color' | 'select' | 'image';
  default: string | number;
  /** 數字的間隔 */
  step?: number;
  /** 下拉選單的選項：[值, 顯示文字] */
  options?: [string, string][];
}

/** 產生 GLSL 時節點可以用的東西 */
export interface NodeContext {
  /** 'vertex'：在頂點著色器求值（接到 Vertex Output 的節點）；'fragment'：片段著色器 */
  stage: 'vertex' | 'fragment';
  /** 這個節點某個輸出的變數名稱（用在同一個節點的其他輸出，例如 rgb 取自 rgba） */
  v(name: string): string;
  /** 這個節點的貼圖 uniform 名稱（呼叫後會宣告 sampler2D） */
  texture(): string;
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
  /** 用到的 GLSL 輔助函式（HELPERS 的鍵） */
  helpers: string[];
  /** 產生每個輸出的 GLSL 運算式 */
  glsl?: (
    inputs: Record<string, string>,
    params: Record<string, string | number>,
    T: GraphType,
    ctx: NodeContext,
  ) => Record<string, string>;
}

/** defineShaderNode 的參數（inputs、outputs、params、helpers 可以省略） */
export type NodeDefInput = Omit<NodeDef, 'inputs' | 'outputs' | 'params' | 'helpers'> &
  Partial<Pick<NodeDef, 'inputs' | 'outputs' | 'params' | 'helpers'>>;

/** 較寬的型別 */
export function widerType(a: GraphType, b: GraphType): GraphType {
  return TYPE_DIM[b] > TYPE_DIM[a] ? b : a;
}

/** 把 GLSL 運算式從一種型別轉成另一種 */
export function convertType(expr: string, from: GraphType, to: GraphType): string {
  if (from === to) return expr;
  if (from === 'float') return `${to}(${expr})`;
  if (to === 'float') return `(${expr}).x`;
  const f = TYPE_DIM[from];
  const t = TYPE_DIM[to];
  if (t < f) return `(${expr}).${'xyzw'.slice(0, t)}`;
  if (from === 'vec2' && to === 'vec3') return `vec3(${expr}, 0.0)`;
  if (from === 'vec2' && to === 'vec4') return `vec4(${expr}, 0.0, 1.0)`;
  if (from === 'vec3' && to === 'vec4') return `vec4(${expr}, 1.0)`;
  return expr;
}

/** 數字寫成 GLSL 的浮點數（一定有小數點） */
export function glslFloat(v: unknown): string {
  let n = Number(v);
  if (!Number.isFinite(n)) n = 0;
  let s = n.toFixed(5).replace(/0+$/, '');
  if (s.endsWith('.')) s += '0';
  if (s === '-0.0') s = '0.0';
  return s;
}

/** '#rrggbb' 轉成 GLSL 的 vec3（0..1，不做色彩空間轉換） */
export function hexToVec3(hex: string): string {
  const n = Number.parseInt(String(hex).slice(1), 16) || 0;
  return `vec3(${glslFloat(((n >> 16) & 255) / 255)}, ${glslFloat(((n >> 8) & 255) / 255)}, ${glslFloat((n & 255) / 255)})`;
}

/** GLSL 輔助函式（依宣告順序輸出，被依賴的要排在前面） */
export const HELPERS: Record<string, string> = {
  hash: `float sgHash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}`,
  noise: `float sgNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(sgHash21(i), sgHash21(i + vec2(1.0, 0.0)), u.x),
             mix(sgHash21(i + vec2(0.0, 1.0)), sgHash21(i + vec2(1.0, 1.0)), u.x), u.y);
}`,
  fbm: `float sgFbm(vec2 p) {
  float v = 0.0, a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) { v += a * sgNoise(p); p = m * p; a *= 0.5; }
  return v;
}`,
  voronoi: `float sgVoronoi(vec2 p, float t) {
  vec2 i = floor(p), f = fract(p);
  float d = 8.0;
  for (int y = -1; y <= 1; y++)
  for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y));
    vec2 o = vec2(sgHash21(i + g), sgHash21(i + g + 17.0));
    o = 0.5 + 0.5 * sin(t + 6.2831 * o);
    d = min(d, length(g + o - f));
  }
  return d;
}`,
  rotate: `vec2 sgRot2(vec2 p, float a) {
  float c = cos(a), s = sin(a);
  return mat2(c, s, -s, c) * p;
}`,
  box: `float sgBox(vec2 p, vec2 b) {
  vec2 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}`,
  hsv: `vec3 sgHsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}`,
};

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

/** 新增一種節點（已經有同名的會取代） */
export function defineShaderNode(d: NodeDefInput): NodeDef {
  const def: NodeDef = { inputs: [], outputs: [], params: [], helpers: [], ...d };
  NODE_DEFS[def.type] = def;
  return def;
}

const N = defineShaderNode;
const uvIn = (name = 'p'): NodeInput => ({ name, type: 'vec2', expr: 'vUv', exprType: 'vec2', exprLabel: 'UV' });
const centeredIn = (name = 'p'): NodeInput => ({
  name,
  type: 'vec2',
  expr: CENTERED_UV,
  exprType: 'vec2',
  exprLabel: '置中 UV',
});
const normalIn: NodeInput = { name: 'normal', type: 'vec3', expr: N_EXPR, exprType: 'vec3', exprLabel: 'Normal' };
const lightIn: NodeInput = { name: 'light', type: 'vec3', expr: 'uLightDir', exprType: 'vec3', exprLabel: 'Light' };
const viewIn: NodeInput = { name: 'view', type: 'vec3', expr: V_EXPR, exprType: 'vec3', exprLabel: 'View' };

// ───────── 輸入 ─────────
N({
  type: 'uv',
  title: 'UV',
  category: 'input',
  desc: '網格的貼圖座標 (0..1)',
  outputs: [{ name: 'uv', type: 'vec2' }],
  glsl: () => ({ uv: 'vUv' }),
});
N({
  type: 'centeredUV',
  title: 'Centered UV',
  category: 'input',
  desc: '置中且保持長寬比的 UV (-1..1)',
  outputs: [{ name: 'uv', type: 'vec2' }],
  glsl: () => ({ uv: CENTERED_UV }),
});
N({
  type: 'time',
  title: 'Time',
  category: 'input',
  desc: '經過秒數（遊戲裡是引擎的 uTime）',
  keywords: '時間',
  outputs: [{ name: 'time', type: 'float' }],
  glsl: () => ({ time: 'uTime' }),
});
N({
  type: 'mouse',
  title: 'Mouse',
  category: 'input',
  desc: '滑鼠位置 (0..1)：預覽時是預覽畫面裡的位置；遊戲裡設定材質的 uniform uMouse',
  keywords: '滑鼠',
  outputs: [{ name: 'pos', type: 'vec2' }],
  glsl: () => ({ pos: 'uMouse' }),
});
N({
  type: 'float',
  title: 'Float',
  category: 'input',
  desc: '常數數值',
  keywords: '數值 常數 number',
  params: [{ name: 'value', label: '值', kind: 'number', default: 1, step: 0.1 }],
  outputs: [{ name: 'value', type: 'float' }],
  glsl: (_i, p) => ({ value: glslFloat(p.value) }),
});
N({
  type: 'color',
  title: 'Color',
  category: 'input',
  desc: '常數顏色',
  keywords: '顏色 rgb',
  params: [{ name: 'color', label: '顏色', kind: 'color', default: '#ff7a45' }],
  outputs: [{ name: 'rgb', type: 'vec3' }],
  glsl: (_i, p) => ({ rgb: hexToVec3(String(p.color)) }),
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
  glsl: (i, _p, _T, ctx) => {
    const s = ctx.texture();
    // 頂點著色器沒有自動的 mipmap 層級，要用 textureLod
    const sample = ctx.stage === 'vertex' ? `textureLod(${s}, ${i.uv}, 0.0)` : `texture(${s}, ${i.uv})`;
    return { rgba: sample, rgb: `${ctx.v('rgba')}.rgb`, a: `${ctx.v('rgba')}.a` };
  },
});
N({
  type: 'normal',
  title: 'Normal',
  category: 'input',
  desc: '世界空間法線',
  keywords: '法線',
  outputs: [{ name: 'n', type: 'vec3' }],
  glsl: () => ({ n: N_EXPR }),
});
N({
  type: 'worldPos',
  title: 'World Position',
  category: 'input',
  desc: '世界空間座標',
  keywords: '位置 position',
  outputs: [{ name: 'pos', type: 'vec3' }],
  glsl: () => ({ pos: 'sgWorldPos' }),
});
N({
  type: 'objectPos',
  title: 'Object Position',
  category: 'input',
  desc: '物件座標（不隨物件移動、旋轉、縮放；花紋會固定在物件上）',
  keywords: '位置 local 物件 position',
  outputs: [{ name: 'pos', type: 'vec3' }],
  glsl: (_i, _p, _T, ctx) => ({ pos: ctx.stage === 'vertex' ? 'position' : 'sgObjPos' }),
});
N({
  type: 'viewDir',
  title: 'View Direction',
  category: 'input',
  desc: '指向攝影機的方向',
  keywords: '視線 camera',
  outputs: [{ name: 'dir', type: 'vec3' }],
  glsl: () => ({ dir: V_EXPR }),
});
N({
  type: 'lightDir',
  title: 'Light Direction',
  category: 'input',
  desc: '方向光的方向（遊戲裡設定材質的 uniform uLightDir）',
  keywords: '光源',
  outputs: [{ name: 'dir', type: 'vec3' }],
  glsl: () => ({ dir: 'uLightDir' }),
});

// ───────── 數學 ─────────
for (const [type, title, desc, op, b] of [
  ['add', 'Add', '相加', '+', 0],
  ['subtract', 'Subtract', '相減', '-', 0],
  ['multiply', 'Multiply', '相乘', '*', 1],
  ['divide', 'Divide', '相除', '/', 1],
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
    glsl: (i) => ({ out: `(${i.a} ${op} ${i.b})` }),
  });

for (const [type, title, desc, fn, b] of [
  ['power', 'Power', '次方 pow(a, b)', 'pow', 2],
  ['minimum', 'Min', '取最小值', 'min', 0],
  ['maximum', 'Max', '取最大值', 'max', 0],
  ['modulo', 'Mod', '取餘數', 'mod', 1],
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
    glsl: (i) => ({ out: `${fn}(${i.a}, ${i.b})` }),
  });

for (const [type, title, desc, f] of [
  ['sin', 'Sin', '正弦', (x: string) => `sin(${x})`],
  ['cos', 'Cos', '餘弦', (x: string) => `cos(${x})`],
  ['abs', 'Abs', '絕對值', (x: string) => `abs(${x})`],
  ['fract', 'Fract', '小數部分', (x: string) => `fract(${x})`],
  ['floor', 'Floor', '無條件捨去', (x: string) => `floor(${x})`],
  ['sqrt', 'Sqrt', '平方根', (x: string) => `sqrt(${x})`],
  ['negate', 'Negate', '取負號', (x: string) => `(-${x})`],
  ['oneMinus', 'One Minus', '1 - x（反相）', (x: string) => `(1.0 - ${x})`],
  ['saturate', 'Saturate', '限制在 0..1', (x: string) => `clamp(${x}, 0.0, 1.0)`],
  ['normalize', 'Normalize', '正規化向量', (x: string) => `normalize(${x})`],
] as const)
  N({
    type,
    title,
    desc,
    category: 'math',
    inputs: [{ name: 'x', type: 'T', default: 0 }],
    outputs: [{ name: 'out', type: 'T' }],
    glsl: (i) => ({ out: f(i.x) }),
  });

N({
  type: 'length',
  title: 'Length',
  category: 'math',
  desc: '向量長度',
  inputs: [{ name: 'v', type: 'T', default: 0 }],
  outputs: [{ name: 'out', type: 'float' }],
  glsl: (i) => ({ out: `length(${i.v})` }),
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
  glsl: (i) => ({ out: `distance(${i.a}, ${i.b})` }),
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
  glsl: (i) => ({ out: `dot(${i.a}, ${i.b})` }),
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
  glsl: (i) => ({ out: `mix(${i.a}, ${i.b}, ${i.t})` }),
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
  glsl: (i) => ({ out: `clamp(${i.x}, ${i.min}, ${i.max})` }),
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
  glsl: (i) => ({ out: `smoothstep(${i.edge0}, ${i.edge1}, ${i.x})` }),
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
  glsl: (i) => ({ out: `step(${i.edge}, ${i.x})` }),
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
  glsl: (i) => ({
    out: `(${i.outMin} + (${i.x} - ${i.inMin}) / (${i.inMax} - ${i.inMin}) * (${i.outMax} - ${i.outMin}))`,
  }),
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
  glsl: (i) => ({ x: `${i.v}.x`, y: `${i.v}.y`, z: `${i.v}.z`, w: `${i.v}.w` }),
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
  glsl: (i) => ({
    xy: `vec2(${i.x}, ${i.y})`,
    xyz: `vec3(${i.x}, ${i.y}, ${i.z})`,
    xyzw: `vec4(${i.x}, ${i.y}, ${i.z}, ${i.w})`,
  }),
});
N({
  type: 'rotate',
  title: 'Rotate 2D',
  category: 'vector',
  desc: '旋轉 2D 座標（弧度）',
  keywords: '旋轉',
  helpers: ['rotate'],
  inputs: [centeredIn(), { name: 'angle', type: 'float', default: 0 }],
  outputs: [{ name: 'out', type: 'vec2' }],
  glsl: (i) => ({ out: `sgRot2(${i.p}, ${i.angle})` }),
});
N({
  type: 'polar',
  title: 'Polar',
  category: 'vector',
  desc: '轉為極座標 (角度 0..1, 半徑)',
  keywords: '極座標',
  inputs: [centeredIn()],
  outputs: [{ name: 'out', type: 'vec2' }],
  glsl: (i) => ({ out: `vec2(atan(${i.p}.y, ${i.p}.x) / 6.28318 + 0.5, length(${i.p}))` }),
});
N({
  type: 'tile',
  title: 'Tile',
  category: 'vector',
  desc: '重複平鋪座標',
  keywords: '平鋪 repeat',
  inputs: [uvIn(), { name: 'count', type: 'float', default: 4 }],
  outputs: [{ name: 'out', type: 'vec2' }],
  glsl: (i) => ({ out: `fract(${i.p} * ${i.count})` }),
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
  glsl: (i) => ({ d: `(length(${i.p}) - ${i.radius})` }),
});
N({
  type: 'box',
  title: 'Box SDF',
  category: 'pattern',
  desc: '矩形距離場',
  keywords: '方形 矩形',
  helpers: ['box'],
  inputs: [
    centeredIn(),
    { name: 'width', type: 'float', default: 0.5 },
    { name: 'height', type: 'float', default: 0.5 },
  ],
  outputs: [{ name: 'd', type: 'float' }],
  glsl: (i) => ({ d: `sgBox(${i.p}, vec2(${i.width}, ${i.height}))` }),
});
N({
  type: 'checker',
  title: 'Checker',
  category: 'pattern',
  desc: '棋盤格',
  keywords: '棋盤',
  inputs: [uvIn(), { name: 'count', type: 'float', default: 8 }],
  outputs: [{ name: 'out', type: 'float' }],
  glsl: (i) => ({ out: `mod(floor(${i.p}.x * ${i.count}) + floor(${i.p}.y * ${i.count}), 2.0)` }),
});
N({
  type: 'noise',
  title: 'Value Noise',
  category: 'pattern',
  desc: '平滑數值雜訊',
  keywords: '雜訊',
  helpers: ['hash', 'noise'],
  inputs: [uvIn(), { name: 'scale', type: 'float', default: 8 }],
  outputs: [{ name: 'out', type: 'float' }],
  glsl: (i) => ({ out: `sgNoise(${i.p} * ${i.scale})` }),
});
N({
  type: 'fbm',
  title: 'FBM',
  category: 'pattern',
  desc: '分形布朗運動（多層雜訊）',
  keywords: '雜訊 雲',
  helpers: ['hash', 'noise', 'fbm'],
  inputs: [uvIn(), { name: 'scale', type: 'float', default: 4 }],
  outputs: [{ name: 'out', type: 'float' }],
  glsl: (i) => ({ out: `sgFbm(${i.p} * ${i.scale})` }),
});
N({
  type: 'voronoi',
  title: 'Voronoi',
  category: 'pattern',
  desc: '細胞雜訊（到最近點的距離）',
  keywords: '細胞 cell',
  helpers: ['hash', 'voronoi'],
  inputs: [uvIn(), { name: 'scale', type: 'float', default: 6 }, { name: 'time', type: 'float', default: 0 }],
  outputs: [{ name: 'd', type: 'float' }],
  glsl: (i) => ({ d: `sgVoronoi(${i.p} * ${i.scale}, ${i.time})` }),
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
  glsl: (i) => ({ out: `max(dot(${i.normal}, ${i.light}), 0.0)` }),
});
N({
  type: 'specular',
  title: 'Specular',
  category: 'light',
  desc: 'Blinn-Phong 高光',
  keywords: '高光 phong',
  inputs: [normalIn, lightIn, viewIn, { name: 'shininess', type: 'float', default: 32 }],
  outputs: [{ name: 'out', type: 'float' }],
  glsl: (i) => ({ out: `pow(max(dot(${i.normal}, normalize(${i.light} + ${i.view})), 0.0), ${i.shininess})` }),
});
N({
  type: 'fresnel',
  title: 'Fresnel',
  category: 'light',
  desc: '邊緣光（視角越斜越亮）',
  keywords: '邊緣 rim',
  inputs: [normalIn, viewIn, { name: 'power', type: 'float', default: 3 }],
  outputs: [{ name: 'out', type: 'float' }],
  glsl: (i) => ({ out: `pow(1.0 - clamp(dot(${i.normal}, ${i.view}), 0.0, 1.0), ${i.power})` }),
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
  glsl: (i, p) => {
    const P = PALETTES[String(p.preset)] ?? PALETTES.rainbow;
    const v = (a: number[]) => `vec3(${a.map(glslFloat).join(', ')})`;
    return { rgb: `(${v(P.a)} + ${v(P.b)} * cos(6.28318 * (${v(P.c)} * ${i.t} + ${v(P.d)})))` };
  },
});
N({
  type: 'hsv',
  title: 'HSV → RGB',
  category: 'color',
  desc: '色相 / 飽和度 / 明度轉 RGB',
  keywords: '色相 hue',
  helpers: ['hsv'],
  inputs: [
    { name: 'h', type: 'float', default: 0 },
    { name: 's', type: 'float', default: 1 },
    { name: 'v', type: 'float', default: 1 },
  ],
  outputs: [{ name: 'rgb', type: 'vec3' }],
  glsl: (i) => ({ rgb: `sgHsv2rgb(vec3(${i.h}, ${i.s}, ${i.v}))` }),
});
N({
  type: 'grayscale',
  title: 'Luminance',
  category: 'color',
  desc: '顏色轉亮度',
  keywords: '灰階 亮度',
  inputs: [{ name: 'rgb', type: 'vec3', default: 0 }],
  outputs: [{ name: 'out', type: 'float' }],
  glsl: (i) => ({ out: `dot(${i.rgb}, vec3(0.299, 0.587, 0.114))` }),
});

// ───────── 輸出 ─────────
N({
  type: 'output',
  title: 'Fragment Output',
  category: 'output',
  unique: true,
  desc: '最終輸出顏色（每張圖只能有一個）。alpha 小於 1 或有連接時材質會是半透明',
  keywords: '輸出 fragment',
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
  ],
  inputs: [
    { name: 'color', type: 'vec3', default: 0 },
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
