/**
 * 節點圖 → 引擎的自訂著色器（ShaderDefinition，base: 'unlit'），或全螢幕效果（EffectDefinition，後製）。
 * 產生的是 TSL 節點（three.js 的節點著色器）：編譯結果是「拿到 uniform 與環境，組出節點」的函式，每個材質各自呼叫。
 *
 * - 圖裡有 Effect Output：全螢幕效果。Screen Color 讀取畫面原本的顏色，顏色都是畫面上看到的值（sRGB），
 *   不做轉換（效果加在色調映射之後）；3D 才有的值（世界座標、法線）是固定的預設值
 * - Fragment Output 決定像素顏色；Vertex Output（可以沒有）決定頂點位移
 * - 節點圖的顏色是畫面上看到的顏色（sRGB）：材質輸出前轉成線性，經過引擎的色彩轉換後和預覽、設計時一樣
 * - 節點圖自己的 uniform：uMouse（vec2）、uAspect（float，材質）、uLightDir（vec3）、每個貼圖節點的 uTex<編號>，
 *   以及參數節點（Parameter、Color Parameter）的名稱
 * - Fragment Output 的「光照」選標準時建立在標準材質上（受燈光、陰影影響），color 是基本色、emissive 是發光
 */
import { type GraphType, NODE_DEFS, type NodeBuiltin, type NodeDef, convertType, widerType } from './nodes';
import { type ShaderNode, tsl } from '../tsl';

const {
  cameraPosition,
  cross,
  dFdx,
  dFdy,
  float,
  max,
  normalLocal,
  normalWorld,
  normalize,
  positionLocal,
  positionWorld,
  sRGBTransferEOTF,
  screenSize,
  time,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} = tsl;

/** 節點圖裡的一個節點 */
export interface ShaderGraphNode {
  /** 節點編號（同一張圖裡不重複） */
  id: number;
  /** 節點種類（NODE_DEFS 的鍵） */
  type: string;
  /** 在編輯器裡的位置（左） */
  x: number;
  /** 在編輯器裡的位置（上） */
  y: number;
  /** 沒有連接的輸入的數值 */
  values: Record<string, number>;
  /** 參數（顏色、下拉選單、圖片） */
  params: Record<string, string | number>;
  /** 編輯器裡是否顯示縮圖 */
  preview?: boolean;
}

/** 一條連線：from 節點的 fromPort 輸出 → to 節點的 toPort 輸入 */
export interface ShaderGraphLink {
  /** 輸出的節點編號 */
  from: number;
  /** 輸出的名稱 */
  fromPort: string;
  /** 輸入的節點編號 */
  to: number;
  /** 輸入的名稱 */
  toPort: string;
}

/** 節點圖 */
export interface ShaderGraph {
  /** 所有節點 */
  nodes: ShaderGraphNode[];
  /** 所有連線（每個輸入最多一條） */
  links: ShaderGraphLink[];
  /** 下一個節點的編號 */
  nextId: number;
}

/** 節點圖的種類：材質（Fragment Output）或全螢幕效果（Effect Output） */
export type ShaderGraphKind = 'material' | 'effect';

/** 節點圖是材質還是全螢幕效果（有 Effect Output 就是效果） */
export function shaderGraphKind(graph: ShaderGraph): ShaderGraphKind {
  return graph.nodes.some((n) => n.type === 'effectOutput') ? 'effect' : 'material';
}

/** 組節點時的環境：uniform 節點、全螢幕效果的畫面 */
export interface GraphEnv {
  /** 節點圖的 uniform 節點：uMouse、uLightDir、uAspect（材質）、uTex<編號> */
  uniforms: Record<string, ShaderNode>;
  /** 全螢幕效果：畫面座標（vec2，左下 0,0） */
  uv?: ShaderNode;
  /** 全螢幕效果：畫面在 uv 的顏色（vec4）；材質預覽效果的圖時是一張當成畫面的貼圖 */
  screen?: (uv: ShaderNode) => ShaderNode;
  /** Time 節點的值（省略時是 three.js 的 time：經過的秒數）；著色器編輯器用它暫停預覽 */
  time?: ShaderNode;
}

/** 參數節點（Parameter、Color Parameter）：變成材質或效果的 uniform */
export interface ShaderGraphParam {
  /** uniform 名稱 */
  name: string;
  /** float：數字；color：顏色（THREE.Color） */
  kind: 'float' | 'color';
  /** 預設值：數字，或 '#rrggbb' */
  value: number | string;
}

/** Fragment Output 的光照：unlit（顏色就是最後的顏色）、standard（受燈光影響） */
export type ShaderGraphLighting = 'unlit' | 'standard';

/** 編譯結果（shaderGraphDefinition、shaderGraphEffectDefinition 用它組出定義） */
export interface CompiledShaderGraph {
  /** 材質或全螢幕效果 */
  kind: ShaderGraphKind;
  /** 用到貼圖的節點編號（每個都有 uniform uTex<編號>） */
  textures: number[];
  /** 是否半透明（alpha 有連接或小於 1） */
  transparent: boolean;
  /** 畫哪一面 */
  side: 'front' | 'back' | 'double';
  /** 光照（全螢幕效果、只預覽一個節點時是 unlit） */
  lighting: ShaderGraphLighting;
  /** 混合方式 */
  blending: 'normal' | 'additive';
  /** alpha 小於 0.5 的像素丟掉（Fragment Output 的透明選「裁切」） */
  alphaClip: boolean;
  /** 粗糙度（光照是 standard 時用） */
  roughness: number;
  /** 金屬度（光照是 standard 時用） */
  metalness: number;
  /** 參數節點（每個名稱一個） */
  params: ShaderGraphParam[];
  /**
   * 組出顏色（vec4）：材質是線性的顏色（已從 sRGB 轉換）；全螢幕效果是畫面上的顏色。
   * 只預覽一個節點（target）時是那個輸出的顏色（sRGB，還沒轉換）
   */
  color(env: GraphEnv): ShaderNode;
  /** 組出頂點位置（物件座標，vec3）；沒有 Vertex Output 時是 null */
  position: ((env: GraphEnv) => ShaderNode) | null;
  /** 組出發光（線性的 vec3）；光照是 unlit 或 emissive 沒有連接、是 0 時是 null */
  emissive: ((env: GraphEnv) => ShaderNode) | null;
}

/** compileShaderGraph 的選項 */
export interface CompileOptions {
  /** 只預覽某個節點的某個輸出（編輯器的節點縮圖用）；省略時從 Fragment Output 產生完整的著色器 */
  target?: { nodeId: number; port: string };
}

/** 節點圖自己的 uniform 名稱（貼圖另外是 uTex<編號>） */
export const GRAPH_UNIFORMS = ['uMouse', 'uAspect', 'uLightDir'] as const;

/** 參數節點的種類 */
const PARAM_NODES: Record<string, ShaderGraphParam['kind']> = { floatParam: 'float', colorParam: 'color' };

/**
 * 圖裡所有參數節點（同名的只算一個，用第一個的預設值）。
 * 名稱不能用的時候（空白、不是英文字母開頭、和節點圖自己的 uniform 重複、同名但種類不同）丟出錯誤
 */
export function shaderGraphParams(graph: ShaderGraph): ShaderGraphParam[] {
  const out = new Map<string, ShaderGraphParam>();
  for (const n of graph.nodes) {
    const kind = PARAM_NODES[n.type];
    if (!kind) continue;
    const name = String(n.params?.name ?? '').trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))
      throw new Error(`參數名稱「${name}」不能用：要是英文字母開頭，只有英文字母、數字、底線`);
    if ((GRAPH_UNIFORMS as readonly string[]).includes(name) || name === 'uScreen' || /^uTex\d+$/.test(name))
      throw new Error(`參數名稱「${name}」是節點圖自己用的，請換一個`);
    const prev = out.get(name);
    if (prev && prev.kind !== kind) throw new Error(`參數「${name}」同時是數值和顏色：同名的參數要是同一種`);
    if (!prev)
      out.set(name, {
        name,
        kind,
        value: kind === 'color' ? String(n.params?.color ?? '#ffffff') : Number(n.params?.value ?? 0) || 0,
      });
  }
  return [...out.values()];
}

interface Value {
  node: ShaderNode;
  type: GraphType;
}

/** 試組節點用的 uniform（檢查圖有沒有錯、分析型別） */
function stubEnv(graph: ShaderGraph, mode: ShaderGraphKind): GraphEnv {
  const uniforms: Record<string, ShaderNode> = {
    uMouse: uniform(vec2(0.5, 0.5)),
    uAspect: uniform(1),
    uLightDir: uniform(vec3(0, 1, 0)),
  };
  for (const n of graph.nodes) if (n.type === 'texture') uniforms[`uTex${n.id}`] = tsl.texture(null);
  for (const p of shaderGraphParams(graph)) uniforms[p.name] = p.kind === 'color' ? uniform(vec3(1)) : uniform(0);
  return mode === 'effect' ? { uniforms, uv: uv(), screen: () => vec4(0) } : { uniforms };
}

function makeCompiler(
  graph: ShaderGraph,
  stage: 'vertex' | 'fragment',
  mode: ShaderGraphKind,
  env: GraphEnv,
  flatNormals = false,
) {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const incoming = new Map<string, ShaderGraphLink>();
  for (const l of graph.links) incoming.set(`${l.to}:${l.toPort}`, l);

  const textures = new Set<number>();
  const done = new Map<number, Record<string, Value>>();
  const visiting = new Set<number>();
  const types: Record<string, GraphType> = {};
  const inputNodes = new Map<number, Record<string, ShaderNode>>();
  /** 有連接的輸入（判斷 alpha 是否半透明） */
  const linked = new Set<string>();

  const effect = mode === 'effect';
  const fsUv = effect ? env.uv! : uv();
  const aspect = effect ? screenSize.x.div(screenSize.y) : env.uniforms.uAspect;
  const effectPos = () => vec3(fsUv.sub(0.5), 0);
  const builtin = (name: NodeBuiltin): ShaderNode => {
    switch (name) {
      case 'uv':
        return fsUv;
      case 'centeredUV':
        return fsUv.sub(0.5).mul(vec2(aspect, 1)).mul(2);
      case 'normal':
        if (effect) return vec3(0, 0, 1);
        // 依位移重算法線：用螢幕空間導數（只有片段階段）
        if (flatNormals && stage === 'fragment') return normalize(cross(dFdx(positionWorld), dFdy(positionWorld)));
        return normalWorld;
      case 'worldPos':
        return effect ? effectPos() : positionWorld;
      case 'objectPos':
        return effect ? effectPos() : positionLocal;
      case 'view':
        return effect ? vec3(0, 0, 1) : normalize(cameraPosition.sub(positionWorld));
      case 'light':
        return env.uniforms.uLightDir;
      case 'time':
        return env.time ?? time;
      case 'resolution':
        return screenSize;
      case 'mouse':
        return env.uniforms.uMouse;
      case 'screen':
        if (!env.screen)
          throw new Error('Screen Color 只能用在全螢幕效果（圖裡要有 Effect Output，不是 Fragment Output）');
        return env.screen(fsUv).rgb;
    }
  };

  function visit(node: ShaderGraphNode): Record<string, Value> {
    const cached = done.get(node.id);
    if (cached) return cached;
    if (visiting.has(node.id)) throw new Error('偵測到循環連線');
    visiting.add(node.id);

    const def: NodeDef | undefined = NODE_DEFS[node.type];
    if (!def) throw new Error(`未知的節點類型：${node.type}`);

    // 1. 先求出所有已連接的上游輸出
    const src: Record<string, Value> = {};
    for (const inp of def.inputs) {
      const l = incoming.get(`${node.id}:${inp.name}`);
      if (!l) continue;
      const from = byId.get(l.from);
      if (!from) continue;
      const outs = visit(from);
      if (outs[l.fromPort]) {
        src[inp.name] = outs[l.fromPort];
        linked.add(`${node.id}:${inp.name}`);
      }
    }

    // 2. 解析泛型 T
    let T: GraphType = 'float';
    for (const inp of def.inputs) if (inp.type === 'T' && src[inp.name]) T = widerType(T, src[inp.name].type);

    // 3. 每個輸入的節點（型別轉換、預設值）
    const ins: Record<string, ShaderNode> = {};
    for (const inp of def.inputs) {
      const want = inp.type === 'T' ? T : inp.type;
      const s = src[inp.name];
      let n: ShaderNode;
      if (s) n = convertType(s.node, s.type, want);
      else if (inp.expr) n = convertType(builtin(inp.expr), inp.exprType ?? want, want);
      else n = convertType(float(Number(node.values?.[inp.name] ?? inp.default ?? 0) || 0), 'float', want);
      ins[inp.name] = n;
      types[`${node.id}:in:${inp.name}`] = want;
    }

    const ctx = {
      stage,
      mode,
      builtin,
      texture: (at: ShaderNode) => {
        textures.add(node.id);
        const sample = env.uniforms[`uTex${node.id}`].sample(at);
        // 頂點階段沒有自動的 mipmap 層級：用第 0 層
        return stage === 'vertex' ? sample.level(0) : sample;
      },
      screen: (at: ShaderNode) => {
        if (!env.screen)
          throw new Error(`${def.title} 只能用在全螢幕效果（圖裡要有 Effect Output，不是 Fragment Output）`);
        return env.screen(at);
      },
      param: (name: string) => {
        const u = env.uniforms[name];
        if (!u) throw new Error(`找不到參數「${name}」的 uniform`);
        return u;
      },
    };
    const res = def.tsl ? def.tsl(ins, node.params ?? {}, T, ctx) : {};

    // 4. 每個輸出（toVar：同一個值給好幾個節點用時只算一次）
    const outs: Record<string, Value> = {};
    for (const o of def.outputs) {
      const t = o.type === 'T' ? T : o.type;
      outs[o.name] = { node: res[o.name], type: t };
      types[`${node.id}:out:${o.name}`] = t;
    }

    inputNodes.set(node.id, ins);
    visiting.delete(node.id);
    done.set(node.id, outs);
    return outs;
  }

  return { visit, textures, types, inputNodes, byId, visiting, linked };
}

/** sRGB（畫面上的顏色）→ 線性：引擎最後會把線性轉回 sRGB */
const toLinear = (rgb: ShaderNode) => sRGBTransferEOTF(max(rgb, vec3(0)));

/** 發光的顏色 → 線性：超過 1 的部分當成亮度倍數（顏色 × 6 就是 6 倍亮，不會因為 sRGB 曲線變成幾十倍） */
const hdrToLinear = (rgb: ShaderNode) => {
  const c = max(rgb, vec3(0));
  const m = max(max(c.x, c.y), max(c.z, 1));
  return toLinear(c.div(m)).mul(m);
};

/**
 * 節點圖編譯成組節點的函式。圖有錯誤（循環連線、沒有 Fragment Output、未知節點）時丟出錯誤。
 * @example
 * // 一般用 shaderGraphDefinition（file.ts）：會補上 uniform、貼圖、材質參數
 * const c = compileShaderGraph(parseShaderGraphFile(json).graph);
 * console.log(c.kind, c.textures, c.transparent);
 */
export function compileShaderGraph(graph: ShaderGraph, options: CompileOptions = {}): CompiledShaderGraph {
  const kind = shaderGraphKind(graph);
  if (kind === 'effect' && graph.nodes.some((n) => n.type === 'output' || n.type === 'vertexOutput'))
    throw new Error('一張圖只能是材質或全螢幕效果：請刪掉 Effect Output，或刪掉 Fragment Output、Vertex Output');
  const { target } = options;
  const out = graph.nodes.find((n) => n.type === (kind === 'effect' ? 'effectOutput' : 'output'));
  if (!target && !out) throw new Error('圖中沒有 Fragment Output 節點');
  const vout = kind === 'material' && !target ? graph.nodes.find((n) => n.type === 'vertexOutput') : undefined;
  const flat = vout?.params?.normals === 'flat';

  // 片段階段：組出顏色
  const fragment = (env: GraphEnv, mode: ShaderGraphKind = kind) => {
    const c = makeCompiler(graph, 'fragment', mode, env, flat);
    if (target) {
      const node = c.byId.get(target.nodeId);
      if (!node) throw new Error(`找不到節點 ${target.nodeId}`);
      const o = c.visit(node)[target.port];
      if (!o) throw new Error(`節點 ${target.nodeId} 沒有輸出 ${target.port}`);
      return { c, color: vec4(convertType(o.node, o.type, 'vec3'), 1) };
    }
    c.visit(out!);
    const i = c.inputNodes.get(out!.id)!;
    return {
      c,
      color: kind === 'effect' ? vec4(i.color, i.alpha) : vec4(toLinear(i.color), i.alpha),
      emissive: kind === 'effect' ? null : hdrToLinear(i.emissive),
    };
  };
  const vertex = (env: GraphEnv) => {
    const c = makeCompiler(graph, 'vertex', 'material', env);
    c.visit(vout!);
    const vi = c.inputNodes.get(vout!.id)!;
    return { c, position: positionLocal.add(normalLocal.mul(vi.displacement)).add(vi.offset) };
  };

  // 先試組一次：圖有錯誤時現在就丟出（編輯器馬上顯示）；也收集貼圖、半透明
  const stub = stubEnv(graph, kind);
  const f = fragment(stub);
  const textures = new Set(f.c.textures);
  if (vout) for (const t of vertex(stub).c.textures) textures.add(t);
  const alphaLinked = !!out && f.c.linked.has(`${out.id}:alpha`);
  const alphaValue = Number(out?.values?.alpha ?? 1);
  const side = String(out?.params?.side ?? 'front');
  const material = !target && kind === 'material';
  const lighting: ShaderGraphLighting = material && out?.params?.lighting === 'standard' ? 'standard' : 'unlit';
  const alphaClip = material && out?.params?.alphaMode === 'clip';
  const blending = material && out?.params?.blending === 'additive' ? 'additive' : 'normal';
  const emissiveValue = Number(out?.values?.emissive ?? 0);
  const hasEmissive = lighting === 'standard' && (f.c.linked.has(`${out!.id}:emissive`) || emissiveValue !== 0);
  const finite = (v: unknown, d: number) => (Number.isFinite(Number(v)) ? Number(v) : d);
  return {
    kind,
    textures: [...textures],
    transparent: material && ((!alphaClip && (alphaLinked || alphaValue < 1)) || blending === 'additive'),
    side: side === 'double' || side === 'back' ? side : 'front',
    lighting,
    blending,
    alphaClip,
    roughness: finite(out?.params?.roughness, 0.5),
    metalness: finite(out?.params?.metalness, 0),
    params: shaderGraphParams(graph),
    color: (env) => fragment(env).color,
    position: vout ? (env) => vertex(env).position : null,
    emissive: hasEmissive ? (env) => fragment(env).emissive : null,
  };
}

/** 整張圖每個連接埠的實際型別（鍵是「節點編號:in|out:名稱」；編輯器替連線、連接埠上色） */
export function analyzeShaderGraphTypes(graph: ShaderGraph): Record<string, GraphType> {
  const c = makeCompiler(graph, 'fragment', shaderGraphKind(graph), stubEnv(graph, shaderGraphKind(graph)));
  for (const n of graph.nodes) {
    try {
      c.visit(n);
    } catch {
      c.visiting.clear();
    }
  }
  return c.types;
}

/** a 的上游是否包含 b（連線會不會形成循環） */
export function upstreamHas(graph: ShaderGraph, a: number, b: number): boolean {
  const stack = [a];
  const seen = new Set<number>();
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === b) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const l of graph.links) if (l.to === cur) stack.push(l.from);
  }
  return false;
}
