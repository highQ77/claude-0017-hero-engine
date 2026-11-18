/**
 * 節點圖 → 引擎的自訂著色器（ShaderDefinition，base: 'unlit'）。
 *
 * - Fragment Output 決定像素顏色；Vertex Output（可以沒有）決定頂點位移，接到它的節點在頂點著色器求值
 * - 產生的程式放進 ShaderLibrary 的 unlit 著色器：片段階段設定 color，頂點階段修改 transformed
 * - 節點圖的顏色是畫面上看到的顏色（sRGB）：輸出前轉成線性，經過引擎的色彩轉換後和預覽、設計時一樣
 * - 節點圖自己的 uniform：uMouse（vec2）、uAspect（float）、uLightDir（vec3）、每個貼圖節點的 uTex<編號>
 *
 * 這個檔案只產生 GLSL 文字，不用 three.js（測試、開發伺服器都可以用）。
 */
import { type GraphType, HELPERS, NODE_DEFS, type NodeDef, convertType, glslFloat, widerType } from './nodes';

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

/** 編譯結果（可以直接放進 ShaderDefinition） */
export interface CompiledShaderGraph {
  /** 頂點著色器的函式與宣告 */
  vertexHeader: string;
  /** 頂點著色器 main 裡的程式（修改 transformed；沒有 Vertex Output 時是空的） */
  vertex: string;
  /** 片段著色器的函式與宣告 */
  fragmentHeader: string;
  /** 片段著色器 main 裡的程式（設定 color） */
  fragment: string;
  /** 用到貼圖的節點編號（每個都有 uniform uTex<編號>） */
  textures: number[];
  /** 是否半透明（alpha 有連接或小於 1） */
  transparent: boolean;
  /** 畫哪一面 */
  side: 'front' | 'back' | 'double';
}

/** compileShaderGraph 的選項 */
export interface CompileOptions {
  /** 只預覽某個節點的某個輸出（編輯器的節點縮圖用）；省略時從 Fragment Output 產生完整的著色器 */
  target?: { nodeId: number; port: string };
}

/** 節點圖自己的 uniform 名稱與型別（ShaderLibrary 依初始值產生宣告） */
export const GRAPH_UNIFORMS = ['uMouse', 'uAspect', 'uLightDir'] as const;

interface Value {
  expr: string;
  type: GraphType;
}

function makeCompiler(graph: ShaderGraph, stage: 'vertex' | 'fragment') {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const incoming = new Map<string, ShaderGraphLink>();
  for (const l of graph.links) incoming.set(`${l.to}:${l.toPort}`, l);

  const lines: string[] = [];
  const helpers = new Set<string>();
  const textures = new Set<number>();
  const done = new Map<number, Record<string, Value>>();
  const visiting = new Set<number>();
  const types: Record<string, GraphType> = {};
  const inputExprs = new Map<number, Record<string, string>>();
  /** 有連接的輸入（判斷 alpha 是否半透明） */
  const linked = new Set<string>();

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

    // 3. 每個輸入的運算式（型別轉換、預設值）
    const ins: Record<string, string> = {};
    for (const inp of def.inputs) {
      const want = inp.type === 'T' ? T : inp.type;
      const s = src[inp.name];
      let e: string;
      if (s) e = convertType(s.expr, s.type, want);
      else if (inp.expr) e = convertType(inp.expr, inp.exprType ?? want, want);
      else e = convertType(glslFloat(node.values?.[inp.name] ?? inp.default ?? 0), 'float', want);
      ins[inp.name] = e;
      types[`${node.id}:in:${inp.name}`] = want;
    }

    for (const h of def.helpers) helpers.add(h);
    const ctx = {
      stage,
      v: (name: string) => `n${node.id}_${name}`,
      texture: () => {
        textures.add(node.id);
        return `uTex${node.id}`;
      },
    };
    const res = def.glsl ? def.glsl(ins, node.params ?? {}, T, ctx) : {};

    // 4. 每個輸出宣告成一個區域變數
    const outs: Record<string, Value> = {};
    for (const o of def.outputs) {
      const t = o.type === 'T' ? T : o.type;
      const v = `n${node.id}_${o.name}`;
      lines.push(`  ${t} ${v} = ${res[o.name]};  // ${def.title}`);
      outs[o.name] = { expr: v, type: t };
      types[`${node.id}:out:${o.name}`] = t;
    }

    inputExprs.set(node.id, ins);
    visiting.delete(node.id);
    done.set(node.id, outs);
    return outs;
  }

  return { visit, lines, helpers, textures, types, inputExprs, byId, visiting, linked };
}

type Compiler = ReturnType<typeof makeCompiler>;

function helperSource(c: Compiler): string {
  return Object.keys(HELPERS)
    .filter((k) => c.helpers.has(k))
    .map((k) => HELPERS[k])
    .join('\n\n');
}

/** 片段、頂點階段共用的變數：sgWorldPos（世界座標）、sgNormal（世界空間法線） */
const FRAGMENT_PRELUDE = '  vec3 sgWorldPos = vWorldPosition;\n  vec3 sgNormal = normalize(vWorldNormal);\n';
/** 依位移重算法線：用螢幕空間導數（頂點位移後光照才正確） */
const FLAT_PRELUDE =
  '  vec3 sgWorldPos = vWorldPosition;\n  vec3 sgNormal = normalize(cross(dFdx(vWorldPosition), dFdy(vWorldPosition)));\n';
const VERTEX_PRELUDE =
  '  vec3 sgWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;\n  vec3 sgNormal = normalize(mat3(modelMatrix) * normal);\n';

/** 物件座標（還沒移動、旋轉、縮放的頂點位置）：頂點著色器傳給片段著色器 */
const OBJ_VARYING = 'varying vec3 sgObjPos;\n';
const OBJ_ASSIGN = '  sgObjPos = position;\n';

/** sRGB（畫面上的顏色）→ 線性：引擎最後會把線性轉回 sRGB */
const toLinear = (rgb: string) => `sRGBTransferEOTF(vec4(max(${rgb}, vec3(0.0)), 1.0)).rgb`;

/**
 * 節點圖編譯成引擎自訂著色器的程式片段。
 * 圖有錯誤（循環連線、沒有 Fragment Output、未知節點）時丟出錯誤。
 * @example
 * // 一般用 shaderGraphDefinition（file.ts）：會補上 uniform、貼圖、材質參數；這裡只拿 GLSL 片段
 * const c = compileShaderGraph(parseShaderGraphFile(json).graph);
 * console.log(c.vertex, c.fragment);
 */
export function compileShaderGraph(graph: ShaderGraph, options: CompileOptions = {}): CompiledShaderGraph {
  const fc = makeCompiler(graph, 'fragment');
  const { target } = options;
  if (target) {
    const node = fc.byId.get(target.nodeId);
    if (!node) throw new Error(`找不到節點 ${target.nodeId}`);
    const o = fc.visit(node)[target.port];
    if (!o) throw new Error(`節點 ${target.nodeId} 沒有輸出 ${target.port}`);
    return {
      vertexHeader: OBJ_VARYING,
      vertex: OBJ_ASSIGN,
      fragmentHeader: OBJ_VARYING + helperSource(fc),
      fragment: `${FRAGMENT_PRELUDE}${fc.lines.join('\n')}\n  color = vec4(${toLinear(convertType(o.expr, o.type, 'vec3'))}, 1.0);`,
      textures: [...fc.textures],
      transparent: false,
      side: 'front',
    };
  }

  const out = graph.nodes.find((n) => n.type === 'output');
  if (!out) throw new Error('圖中沒有 Fragment Output 節點');
  const vout = graph.nodes.find((n) => n.type === 'vertexOutput');
  const flat = vout?.params?.normals === 'flat';
  fc.visit(out);
  const i = fc.inputExprs.get(out.id)!;
  const alphaLinked = fc.linked.has(`${out.id}:alpha`);
  const alphaValue = Number(out.values?.alpha ?? 1);
  const textures = new Set(fc.textures);

  let vertexHeader = OBJ_VARYING;
  let vertex = OBJ_ASSIGN;
  if (vout) {
    const vc = makeCompiler(graph, 'vertex');
    vc.visit(vout);
    const vi = vc.inputExprs.get(vout.id)!;
    vertexHeader = OBJ_VARYING + helperSource(vc);
    vertex = `${OBJ_ASSIGN}${VERTEX_PRELUDE}${vc.lines.join('\n')}\n  transformed += normal * (${vi.displacement}) + (${vi.offset});`;
    for (const t of vc.textures) textures.add(t);
  }
  const side = String(out.params?.side ?? 'front');
  return {
    vertexHeader,
    vertex,
    fragmentHeader: OBJ_VARYING + helperSource(fc),
    fragment: `${flat ? FLAT_PRELUDE : FRAGMENT_PRELUDE}${fc.lines.join('\n')}\n  color = vec4(${toLinear(i.color)}, ${i.alpha});`,
    textures: [...textures],
    transparent: alphaLinked || alphaValue < 1,
    side: side === 'double' || side === 'back' ? side : 'front',
  };
}

/** 整張圖每個連接埠的實際型別（鍵是「節點編號:in|out:名稱」；編輯器替連線、連接埠上色） */
export function analyzeShaderGraphTypes(graph: ShaderGraph): Record<string, GraphType> {
  const c = makeCompiler(graph, 'fragment');
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
