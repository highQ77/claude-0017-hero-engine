/**
 * 屬性面板的「網格」區塊：形狀與尺寸、材質、陰影等。
 * 形狀用幾何描述（{ box: [1, 2, 1] }），材質用顏色、standard 材質或節點圖（{ shaderGraph: 網址 }）；其他寫法切換到 JSON 編輯。
 */
import { checkField, colorField, numberField, row, selectField, h, type Field } from './fields';

type Json = Record<string, unknown>;

/** 形狀與參數（順序和幾何描述的陣列一樣） */
export const SHAPES: Record<
  string,
  { label: string; params: { label: string; default: number; step: number; int?: boolean }[] }
> = {
  box: {
    label: '方塊',
    params: [
      { label: '寬', default: 1, step: 0.05 },
      { label: '高', default: 1, step: 0.05 },
      { label: '深', default: 1, step: 0.05 },
    ],
  },
  sphere: {
    label: '球',
    params: [
      { label: '半徑', default: 0.5, step: 0.05 },
      { label: '橫向分段', default: 32, step: 1, int: true },
      { label: '縱向分段', default: 16, step: 1, int: true },
    ],
  },
  plane: {
    label: '平面',
    params: [
      { label: '寬', default: 1, step: 0.05 },
      { label: '高', default: 1, step: 0.05 },
    ],
  },
  circle: {
    label: '圓',
    params: [
      { label: '半徑', default: 0.5, step: 0.05 },
      { label: '分段', default: 48, step: 1, int: true },
    ],
  },
  cylinder: {
    label: '圓柱',
    params: [
      { label: '半徑', default: 0.5, step: 0.05 },
      { label: '高', default: 1, step: 0.05 },
      { label: '分段', default: 32, step: 1, int: true },
    ],
  },
  cone: {
    label: '圓錐',
    params: [
      { label: '半徑', default: 0.5, step: 0.05 },
      { label: '高', default: 1, step: 0.05 },
      { label: '分段', default: 32, step: 1, int: true },
    ],
  },
  capsule: {
    label: '膠囊',
    params: [
      { label: '半徑', default: 0.3, step: 0.05 },
      { label: '中間長度', default: 1, step: 0.05 },
    ],
  },
  torus: {
    label: '甜甜圈',
    params: [
      { label: '半徑', default: 0.5, step: 0.05 },
      { label: '管子半徑', default: 0.15, step: 0.01 },
    ],
  },
  torusKnot: {
    label: '環結',
    params: [
      { label: '半徑', default: 0.5, step: 0.05 },
      { label: '管子半徑', default: 0.15, step: 0.01 },
    ],
  },
  dodecahedron: {
    label: '正十二面體',
    params: [
      { label: '半徑', default: 0.5, step: 0.05 },
      { label: '細分', default: 0, step: 1, int: true },
    ],
  },
  icosahedron: {
    label: '正二十面體',
    params: [
      { label: '半徑', default: 0.5, step: 0.05 },
      { label: '細分', default: 0, step: 1, int: true },
    ],
  },
  octahedron: {
    label: '正八面體',
    params: [
      { label: '半徑', default: 0.5, step: 0.05 },
      { label: '細分', default: 0, step: 1, int: true },
    ],
  },
  tetrahedron: {
    label: '正四面體',
    params: [
      { label: '半徑', default: 0.5, step: 0.05 },
      { label: '細分', default: 0, step: 1, int: true },
    ],
  },
};

/** 新物件的幾何描述 */
export function defaultGeometry(shape: string): Json {
  return writeGeometry(
    shape,
    SHAPES[shape].params.map((p) => p.default),
    {},
  );
}

/** 幾何描述 → [形狀, 參數陣列]；認不得時回傳 null */
export function readGeometry(g: unknown): { shape: string; values: number[]; extra: Json } | null {
  if (!g || typeof g !== 'object' || Array.isArray(g)) return null;
  const { rotation, offset, ...rest } = g as Json;
  const keys = Object.keys(rest);
  if (keys.length !== 1 || !(keys[0] in SHAPES)) return null;
  const shape = keys[0];
  const raw = rest[shape];
  const list = typeof raw === 'number' ? [raw] : Array.isArray(raw) ? (raw as number[]) : null;
  if (!list?.every((n) => typeof n === 'number')) return null;
  const params = SHAPES[shape].params;
  // 方塊、平面只寫一個數字時，其他邊和第一個一樣
  const fill = shape === 'box' || shape === 'plane' ? list[0] : undefined;
  const values = params.map((p, i) => list[i] ?? fill ?? p.default);
  const extra: Json = {};
  if (rotation !== undefined) extra.rotation = rotation;
  if (offset !== undefined) extra.offset = offset;
  return { shape, values, extra };
}

/** [形狀, 參數] → 幾何描述（去掉尾端和預設值一樣的參數） */
export function writeGeometry(shape: string, values: number[], extra: Json): Json {
  const params = SHAPES[shape].params;
  const out = [...values];
  // 省略尾端的參數：方塊、平面省略的邊等於第一個值，其他形狀用參數的預設值
  const fillsFromFirst = shape === 'box' || shape === 'plane';
  const omitted = (i: number) => (fillsFromFirst ? out[0] : params[i].default);
  // 圓柱、圓錐、膠囊、甜甜圈、環結一定要寫 [半徑, 第二個參數]
  const required = ['cylinder', 'cone', 'capsule', 'torus', 'torusKnot'].includes(shape) ? 2 : 1;
  while (out.length > required && out[out.length - 1] === omitted(out.length - 1)) out.pop();
  return { [shape]: out.length === 1 ? out[0] : out, ...extra };
}

/** 材質 → 簡單編輯用的欄位；不是顏色或 standard 時回傳 null（改用 JSON） */
export function readMaterial(
  m: unknown,
): { color: string; roughness: number; metalness: number; emissive: string; extra: Json } | null {
  if (typeof m === 'string' && /^#[0-9a-f]{6}$/i.test(m))
    return { color: m.toLowerCase(), roughness: 1, metalness: 0, emissive: '#000000', extra: {} };
  if (!m || typeof m !== 'object' || Array.isArray(m) || Object.keys(m).length !== 1 || !('standard' in m)) return null;
  const {
    color = '#ffffff',
    roughness = 1,
    metalness = 0,
    emissive = '#000000',
    ...extra
  } = (m as { standard: Json }).standard;
  if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)) return null;
  if (typeof emissive !== 'string' || !/^#[0-9a-f]{6}$/i.test(emissive)) return null;
  if (typeof roughness !== 'number' || typeof metalness !== 'number') return null;
  return { color: color.toLowerCase(), roughness, metalness, emissive: emissive.toLowerCase(), extra };
}

/** 簡單欄位 → 材質描述：只有顏色時寫成 '#rrggbb' */
export function writeMaterial(v: NonNullable<ReturnType<typeof readMaterial>>): unknown {
  const params: Json = { color: v.color };
  if (v.roughness !== 1) params.roughness = v.roughness;
  if (v.metalness !== 0) params.metalness = v.metalness;
  if (v.emissive !== '#000000') params.emissive = v.emissive;
  Object.assign(params, v.extra);
  return Object.keys(params).length === 1 ? v.color : { standard: params };
}

/** 節點圖材質的網址；不是節點圖時是 null */
export function graphOf(m: unknown): string | null {
  if (!m || typeof m !== 'object' || Array.isArray(m) || Object.keys(m).length !== 1) return null;
  const url = (m as { shaderGraph?: unknown }).shaderGraph;
  return typeof url === 'string' ? url : null;
}

/** 網格欄位需要編輯器提供的東西（節點圖材質用） */
export interface MeshFieldHooks {
  /** 專案裡的節點圖檔網址（shaders/lava.shader.json…） */
  shaderGraphs(): readonly string[];
  /** 在著色器編輯器打開這個節點圖檔 */
  openShader(url: string): void;
}

/**
 * 建立網格區塊的欄位。回傳 null 代表資料是看不懂的寫法，要改用 JSON 編輯。
 * change(新的元件資料, done, 合併鍵)
 */
export function meshFields(
  data: Json,
  change: (next: Json, done: boolean, key: string) => void,
  hooks?: MeshFieldHooks,
): { el: HTMLElement; update(data: Json): boolean } | null {
  const geo = readGeometry(data.geometry);
  const graph = graphOf(data.material);
  const mat = graph !== null ? readMaterial('#ffffff') : readMaterial(data.material);
  if (!geo || !mat) return null;
  const el = h('div');
  let current = data;
  let g = geo;
  let m = mat;
  const updaters: ((d: Json) => void)[] = [];

  // 形狀
  const shapeSel = selectField(
    g.shape,
    Object.entries(SHAPES).map(([k, s]) => [k, s.label] as const),
    (shape) => change({ ...current, geometry: { ...defaultGeometry(shape), ...g.extra } }, true, 'geometry.shape'),
  );
  el.append(row('形狀', shapeSel.el));
  const paramFields: Field<number>[] = SHAPES[g.shape].params.map((p, i) => {
    const f = numberField(
      g.values[i],
      (n, done) => {
        const values = [...g.values];
        values[i] = p.int ? Math.round(n) : n;
        change({ ...current, geometry: writeGeometry(g.shape, values, g.extra) }, done, `geometry.${i}`);
      },
      { step: p.step, min: p.int ? 0 : 0.001, digits: p.int ? 0 : undefined },
    );
    el.append(row(p.label, f.el));
    return f;
  });

  // 材質種類：一般（顏色、standard）或節點圖
  const kindSel = selectField(
    graph !== null ? 'graph' : 'standard',
    [
      ['standard', '一般'],
      ['graph', '節點圖（著色器編輯器）'],
    ] as const,
    (kind) => {
      const first = hooks?.shaderGraphs()[0];
      if (kind === 'graph' && !first) {
        kindSel.set('standard');
        hooks?.openShader('');
        return;
      }
      change({ ...current, material: kind === 'graph' ? { shaderGraph: first } : '#ffffff' }, true, 'material.kind');
    },
  );
  el.append(row('材質', kindSel.el));
  let graphSel: Field<string> | null = null;
  if (graph !== null) {
    const list = [...new Set([graph, ...(hooks?.shaderGraphs() ?? [])])];
    graphSel = selectField(
      graph,
      list.map((u) => [u, u.replace(/^shaders\//, '').replace(/\.shader\.json$/, '')] as const),
      (url) => change({ ...current, material: { shaderGraph: url } }, true, 'material.graph'),
    );
    const edit = h('button', 'btn', '編輯 ↗');
    edit.title = '在著色器編輯器打開這個節點圖（另一個分頁）；存檔後這裡會自動更新';
    edit.addEventListener('click', () => hooks?.openShader(current.material ? (graphOf(current.material) ?? '') : ''));
    const wrap = h('div', 'f-inline');
    wrap.style.cssText = 'display:flex;gap:6px;align-items:center';
    graphSel.el.style.flex = '1';
    wrap.append(graphSel.el, edit);
    el.append(row('節點圖', wrap));
  }

  // 材質
  const setMat = (patch: Partial<typeof m>, done: boolean, key: string) =>
    change({ ...current, material: writeMaterial({ ...m, ...patch }) }, done, `material.${key}`);
  const color = colorField(m.color, (v, done) => setMat({ color: v }, done, 'color'));
  const rough = numberField(m.roughness, (v, done) => setMat({ roughness: v }, done, 'roughness'), {
    step: 0.01,
    min: 0,
    max: 1,
  });
  const metal = numberField(m.metalness, (v, done) => setMat({ metalness: v }, done, 'metalness'), {
    step: 0.01,
    min: 0,
    max: 1,
  });
  const emissive = colorField(m.emissive, (v, done) => setMat({ emissive: v }, done, 'emissive'));
  if (graph === null)
    el.append(row('顏色', color.el), row('粗糙度', rough.el), row('金屬感', metal.el), row('發光', emissive.el));

  // 其他
  const flag = (key: string, label: string) => {
    const get = (d: Json) => (key === 'visible' ? d[key] !== false : d[key] === true);
    const f = checkField(get(current), (v) => {
      const next = { ...current };
      if (v === (key === 'visible')) delete next[key];
      else next[key] = v;
      change(next, true, key);
    });
    el.append(row(label, f.el));
    updaters.push((d) => f.set(get(d)));
  };
  flag('castShadow', '投射陰影');
  flag('receiveShadow', '接收陰影');
  flag('visible', '顯示');

  return {
    el,
    update(d) {
      const ng = readGeometry(d.geometry);
      const ngraph = graphOf(d.material);
      const nm = ngraph !== null ? m : readMaterial(d.material);
      // 形狀、材質種類換了，或改成看不懂的寫法：重建
      if (!ng || !nm || ng.shape !== g.shape || (ngraph === null) !== (graph === null)) return false;
      if (ngraph !== null) graphSel?.set(ngraph);
      current = d;
      g = ng;
      m = nm;
      shapeSel.set(g.shape);
      paramFields.forEach((f, i) => f.set(g.values[i]));
      color.set(m.color);
      rough.set(m.roughness);
      metal.set(m.metalness);
      emissive.set(m.emissive);
      for (const u of updaters) u(d);
      return true;
    },
  };
}
