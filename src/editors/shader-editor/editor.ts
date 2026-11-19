/**
 * 著色器編輯器（節點式，移植自 Shader Composer）：節點圖 UI、互動、屬性面板、預覽、存檔。
 *
 * - 節點定義與編譯器在引擎的 src/shaders/graph（遊戲載入同一份檔案）
 * - 預覽用 three.js 與引擎的 ShaderLibrary（preview.ts），和遊戲裡看到的一樣
 * - 存在專案的 public/shaders/<名稱>.shader.json（tools/shader-files-plugin.ts）；
 *   遊戲裡用 shaders.define(await loadShaderGraph('shaders/<名稱>.shader.json'))
 */
import * as THREE from 'three';
import type { EffectDefinition, ShaderDefinition } from '../../shaders';
import {
  CATEGORIES,
  NODE_DEFS,
  type NodeDef,
  type NodeInput,
  type NodeParam,
  type ShaderGraph,
  type ShaderGraphFile,
  type ShaderGraphNode,
  TYPE_COLOR,
  analyzeShaderGraphTypes,
  parseShaderGraphFile,
  shaderGraphKind,
  stringifyShaderGraphFile,
  upstreamHas,
} from '../../shaders/graph';
import { showConfirm, showPrompt } from '../shared/dialog';
import { download, h } from '../shared/dom';
import { storage } from '../shared/storage';
import { EXAMPLES, buildExample, createNode } from './examples';
import {
  deleteShaderFile,
  fileNameOf,
  listShaderFiles,
  readShaderFile,
  shaderNameOf,
  writeShaderFile,
  type ShaderFileInfo,
} from './files';
import {
  MainPreview,
  PREVIEW_MESHES,
  type PreviewMesh,
  type PreviewState,
  THUMB_PX,
  ThumbnailRenderer,
  graphDefinition,
  graphEffectDefinition,
} from './preview';

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;
const CATEGORY_MAP = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));
const typeColor = (t: string | undefined) => (t ? TYPE_COLOR[t as keyof typeof TYPE_COLOR] : undefined);

const graphEl = $('#graph');
const layerEl = $('#layer');
const linksG = document.querySelector('#links') as SVGGElement;
const tempWire = document.querySelector('#temp-wire') as SVGPathElement;
const nodesEl = $('#nodes');
const menuEl = $('#menu');
const menuInput = $<HTMLInputElement>('#menu-input');
const menuList = $('#menu-list');
const previewCanvas = $<HTMLCanvasElement>('#preview');
const errorEl = $('#error');
const codeEl = $('#code');
const propsEl = $('#tab-props');
const fileSelect = $<HTMLSelectElement>('#file-select');
const docNameEl = $('#doc-name');

const LAST_FILE_KEY = 'hero-shader-editor/last-file';
const viewKey = (file: string) => `hero-shader-editor/view/${file}`;

// ───────── 狀態 ─────────

let graph: ShaderGraph = { nodes: [], links: [], nextId: 1 };
let view = { x: 0, y: 0, scale: 1 };
const selected = new Set<number>();
interface NodeView {
  el: HTMLElement;
  ports: Record<string, HTMLElement>;
  thumb: HTMLCanvasElement | null;
  ctx: CanvasRenderingContext2D | null;
}
const nodeEls = new Map<number, NodeView>();
/** 綁定到節點數值的輸入元件（節點上與屬性面板，用來同步） */
let controls: { nodeId: number; key: string; el: HTMLInputElement | HTMLSelectElement }[] = [];
let portTypes: Record<string, string> = {};
const undoStack: string[] = [];
const redoStack: string[] = [];
const mouse = { x: innerWidth / 2, y: innerHeight / 2 };
let zTop = 1;
/** 圖片：編號 → data URL（不放進復原的快照，避免佔用大量記憶體） */
const assets: Record<string, string> = {};
/** 目前的檔案（null：還沒存過） */
let fileName: string | null = null;
/** 上次儲存時的內容摘要（docKey；判斷有沒有改過） */
let savedKey = '';
let files: ShaderFileInfo[] = [];

// ───────── 圖資料操作 ─────────

const getNode = (id: number) => graph.nodes.find((n) => n.id === id);
const snapshot = () => JSON.stringify(graph);
const linkInto = (id: number, port: string) => graph.links.find((l) => l.to === id && l.toPort === port);

function pushUndo(before: string): void {
  if (before === snapshot()) return;
  undoStack.push(before);
  if (undoStack.length > 200) undoStack.shift();
  redoStack.length = 0;
}
function mutate(fn: () => void): void {
  const before = snapshot();
  fn();
  pushUndo(before);
  changed();
}
function restore(json: string): void {
  graph = JSON.parse(json) as ShaderGraph;
  for (const id of [...selected]) if (!getNode(id)) selected.delete(id);
  changed();
}
function undo(): void {
  const prev = undoStack.pop();
  if (prev === undefined) return toast('沒有可復原的動作');
  redoStack.push(snapshot());
  restore(prev);
}
function redo(): void {
  const next = redoStack.pop();
  if (next === undefined) return;
  undoStack.push(snapshot());
  restore(next);
}

/** 結構性變更：重建節點、連線、重新編譯 */
function changed(): void {
  renderNodes();
  drawWires();
  renderPanel();
  scheduleCompile();
  scheduleDirty();
}

function connect(from: number, fromPort: string, to: number, toPort: string): boolean {
  if (from === to || upstreamHas(graph, from, to)) {
    toast('不能建立循環連線');
    return false;
  }
  graph.links = graph.links.filter((l) => !(l.to === to && l.toPort === toPort));
  graph.links.push({ from, fromPort, to, toPort });
  return true;
}

function deleteNodes(ids: number[]): void {
  const s = new Set(ids);
  graph.nodes = graph.nodes.filter((n) => !s.has(n.id));
  graph.links = graph.links.filter((l) => !s.has(l.from) && !s.has(l.to));
  for (const id of ids) selected.delete(id);
}

function duplicateSelection(): void {
  if (!selected.size) return;
  mutate(() => {
    const map = new Map<number, number>();
    for (const id of selected) {
      const n = getNode(id);
      if (!n || NODE_DEFS[n.type].unique) continue;
      const c = JSON.parse(JSON.stringify(n)) as ShaderGraphNode;
      c.id = graph.nextId++;
      c.x += 40;
      c.y += 40;
      graph.nodes.push(c);
      map.set(id, c.id);
    }
    for (const l of [...graph.links]) {
      const to = map.get(l.to);
      if (to === undefined) continue;
      graph.links.push({ from: map.get(l.from) ?? l.from, fromPort: l.fromPort, to, toPort: l.toPort });
    }
    selected.clear();
    for (const v of map.values()) selected.add(v);
  });
}

// ───────── 節點 ─────────

function bindEdit(
  el: HTMLInputElement | HTMLSelectElement,
  nodeId: number,
  key: string,
  apply: (v: string) => boolean | undefined,
): void {
  controls.push({ nodeId, key, el });
  let before: string | null = null;
  el.addEventListener('input', () => {
    if (before === null) before = snapshot();
    if (apply(el.value) === false) return;
    syncControls(nodeId, key, el);
    scheduleCompile();
    scheduleDirty();
  });
  el.addEventListener('change', () => {
    apply(el.value);
    syncControls(nodeId, key, el);
    if (before !== null) {
      pushUndo(before);
      before = null;
    }
    scheduleCompile();
    scheduleDirty();
  });
}
function syncControls(nodeId: number, key: string, src: HTMLInputElement | HTMLSelectElement): void {
  controls = controls.filter((c) => c.el.isConnected);
  for (const c of controls) if (c.nodeId === nodeId && c.key === key && c.el !== src) c.el.value = src.value;
}

function imageControl(n: ShaderGraphNode): HTMLElement {
  const wrap = h('div', 'img-ctl');
  wrap.append(h('span', 'img-name', n.params.image ? '自訂圖片' : '內建 UV 格線'));
  const pick = h('button', 'small', '選擇…');
  pick.title = '上傳圖片（也可以直接把圖檔拖進節點圖）';
  pick.onclick = () => pickImage(n.id);
  wrap.append(pick);
  if (n.params.image) {
    const reset = h('button', 'small', '✕');
    reset.title = '改回內建 UV 格線';
    reset.onclick = () =>
      mutate(() => {
        n.params.image = '';
      });
    wrap.append(reset);
  }
  return wrap;
}

function paramControl(n: ShaderGraphNode, p: NodeParam): HTMLElement {
  if (p.kind === 'image') return imageControl(n);
  let ctl: HTMLInputElement | HTMLSelectElement;
  if (p.kind === 'select') {
    ctl = h('select');
    for (const [v, l] of p.options ?? []) ctl.append(new Option(l, v));
  } else {
    ctl = h('input');
    ctl.type = p.kind === 'color' ? 'color' : 'number';
    if (p.kind === 'number') ctl.step = String(p.step ?? 0.1);
  }
  ctl.value = String(n.params[p.name]);
  bindEdit(ctl, n.id, `param:${p.name}`, (v) => {
    if (p.kind === 'number') {
      const f = Number.parseFloat(v);
      if (Number.isNaN(f)) return false;
      n.params[p.name] = f;
    } else n.params[p.name] = v;
    return true;
  });
  return ctl;
}
function valueControl(n: ShaderGraphNode, inp: NodeInput): HTMLElement {
  const ctl = h('input');
  ctl.type = 'number';
  ctl.step = '0.1';
  ctl.value = String(n.values[inp.name] ?? inp.default ?? 0);
  bindEdit(ctl, n.id, `in:${inp.name}`, (v) => {
    const f = Number.parseFloat(v);
    if (Number.isNaN(f)) return false;
    n.values[inp.name] = f;
    return true;
  });
  return ctl;
}

function makePort(nodeId: number, dir: 'in' | 'out', name: string): HTMLElement {
  const p = h('span', 'port');
  p.dataset.node = String(nodeId);
  p.dataset.dir = dir;
  p.dataset.port = name;
  return p;
}

function buildNodeEl(n: ShaderGraphNode): NodeView {
  const def = NODE_DEFS[n.type];
  const cat = CATEGORY_MAP[def.category];
  const el = h('div', `node${selected.has(n.id) ? ' selected' : ''}`);
  el.dataset.id = String(n.id);
  el.style.left = `${n.x}px`;
  el.style.top = `${n.y}px`;
  el.style.setProperty('--cat', cat.color);

  const head = h('div', 'node-head');
  head.append(h('span', 'node-title', def.title));
  if (def.outputs.length) {
    const t = h('button', 'icon-btn', n.preview !== false ? '▾' : '▸');
    t.title = '顯示／隱藏預覽';
    t.onclick = () =>
      mutate(() => {
        n.preview = n.preview === false;
      });
    head.append(t);
  }
  const del = h('button', 'icon-btn', '✕');
  del.title = '刪除節點';
  del.onclick = () => mutate(() => deleteNodes([n.id]));
  head.append(del);
  el.append(head);

  const body = h('div', 'node-body');
  const ports: Record<string, HTMLElement> = {};
  for (const o of def.outputs) {
    const row = h('div', 'row out');
    const port = makePort(n.id, 'out', o.name);
    row.append(h('label', '', o.name), port);
    body.append(row);
    ports[`out:${o.name}`] = port;
  }
  let thumb: HTMLCanvasElement | null = null;
  let ctx: CanvasRenderingContext2D | null = null;
  if (def.outputs.length && n.preview !== false) {
    thumb = h('canvas', 'thumb');
    thumb.width = thumb.height = THUMB_PX;
    ctx = thumb.getContext('2d');
    body.append(thumb);
  }
  for (const p of def.params) {
    const row = h('div', 'row param');
    if (p.kind !== 'color' || def.params.length > 1) row.append(h('label', '', p.label ?? p.name));
    row.append(paramControl(n, p));
    body.append(row);
  }
  for (const inp of def.inputs) {
    const row = h('div', 'row in');
    const port = makePort(n.id, 'in', inp.name);
    row.append(port, h('label', '', inp.name));
    if (!linkInto(n.id, inp.name)) {
      if (inp.expr) row.append(h('span', 'tag', inp.exprLabel ?? ''));
      else row.append(valueControl(n, inp));
    }
    body.append(row);
    ports[`in:${inp.name}`] = port;
  }
  el.append(body);
  return { el, ports, thumb, ctx };
}

function renderNodes(): void {
  nodesEl.textContent = '';
  nodeEls.clear();
  for (const n of graph.nodes) {
    const ne = buildNodeEl(n);
    nodeEls.set(n.id, ne);
    nodesEl.append(ne.el);
  }
  applyPortColors();
}

function refreshSelection(): void {
  for (const [id, ne] of nodeEls) ne.el.classList.toggle('selected', selected.has(id));
  renderPanel();
}

function applyPortColors(): void {
  for (const [id, ne] of nodeEls) {
    for (const key in ne.ports) {
      const [dir, name] = key.split(':');
      const t = portTypes[`${id}:${dir}:${name}`];
      ne.ports[key].style.setProperty('--pc', typeColor(t) ?? '#777');
      ne.ports[key].title = t ?? '';
    }
  }
}

// ───────── 連線 ─────────

function portPos(nodeId: number, dir: string, port: string): { x: number; y: number } | null {
  const ne = nodeEls.get(nodeId);
  const n = getNode(nodeId);
  if (!ne || !n) return null;
  const p = ne.ports[`${dir}:${port}`];
  if (!p) return null;
  let x = p.offsetWidth / 2;
  let y = p.offsetHeight / 2;
  let el: HTMLElement | null = p;
  while (el && el !== ne.el) {
    x += el.offsetLeft;
    y += el.offsetTop;
    const op = el.offsetParent as HTMLElement | null;
    if (op) {
      x += op.clientLeft;
      y += op.clientTop;
    }
    el = op;
  }
  return { x: n.x + x, y: n.y + y };
}

function curve(a: { x: number; y: number }, b: { x: number; y: number }): string {
  const dx = Math.max(40, Math.abs(b.x - a.x) * 0.5);
  return `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`;
}

function drawWires(): void {
  let html = '';
  for (const l of graph.links) {
    const a = portPos(l.from, 'out', l.fromPort);
    const b = portPos(l.to, 'in', l.toPort);
    if (!a || !b) continue;
    const d = curve(a, b);
    const color = typeColor(portTypes[`${l.from}:out:${l.fromPort}`]) ?? '#999';
    html += `<path class="wire-hit" d="${d}" data-to="${l.to}" data-port="${l.toPort}"><title>雙擊刪除</title></path><path class="wire" d="${d}" stroke="${color}"/>`;
  }
  linksG.innerHTML = html;
}

// ───────── 視圖 ─────────

function applyView(): void {
  layerEl.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
  const g = 24 * view.scale;
  graphEl.style.backgroundSize = `${g}px ${g}px`;
  graphEl.style.backgroundPosition = `${view.x}px ${view.y}px`;
  $('#zoom-label').textContent = `${Math.round(view.scale * 100)}%`;
}
function toWorld(cx: number, cy: number): { x: number; y: number } {
  const r = graphEl.getBoundingClientRect();
  return { x: (cx - r.left - view.x) / view.scale, y: (cy - r.top - view.y) / view.scale };
}
function frameAll(): void {
  if (!graph.nodes.length) return;
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  for (const n of graph.nodes) {
    const ne = nodeEls.get(n.id);
    const w = ne ? ne.el.offsetWidth : 160;
    const ht = ne ? ne.el.offsetHeight : 100;
    x0 = Math.min(x0, n.x);
    y0 = Math.min(y0, n.y);
    x1 = Math.max(x1, n.x + w);
    y1 = Math.max(y1, n.y + ht);
  }
  const r = graphEl.getBoundingClientRect();
  const pad = 50;
  const s = Math.min(1.1, Math.max(0.2, Math.min((r.width - pad * 2) / (x1 - x0), (r.height - pad * 2) / (y1 - y0))));
  view.scale = s;
  view.x = (r.width - (x1 - x0) * s) / 2 - x0 * s;
  view.y = (r.height - (y1 - y0) * s) / 2 - y0 * s;
  applyView();
  saveView();
}

// ───────── 互動：節點圖 ─────────

graphEl.addEventListener('pointerdown', (e) => {
  const target = e.target as HTMLElement;
  const port = target.closest<HTMLElement>('.port');
  if (port && e.button === 0) return startWire(port, e);
  if (target.closest('input, select, button, textarea')) return;
  const nodeEl = target.closest<HTMLElement>('.node');
  if (nodeEl && e.button === 0) return startNodeDrag(nodeEl, e);
  if (e.button === 0 || e.button === 1) startPan(e);
});

function startWire(portEl: HTMLElement, e: PointerEvent): void {
  e.preventDefault();
  const before = snapshot();
  let dir = portEl.dataset.dir as 'in' | 'out';
  let nodeId = Number(portEl.dataset.node);
  let port = portEl.dataset.port!;
  // 從已連接的輸入拖曳：拔起原本的連線
  if (dir === 'in') {
    const l = linkInto(nodeId, port);
    if (l) {
      graph.links = graph.links.filter((x) => x !== l);
      dir = 'out';
      nodeId = l.from;
      port = l.fromPort;
      changed();
    }
  }
  const color = dir === 'out' ? typeColor(portTypes[`${nodeId}:out:${port}`]) : '#ccd';
  tempWire.setAttribute('stroke', color ?? '#ccd');
  const move = (ev: PointerEvent) => {
    const a = portPos(nodeId, dir, port);
    if (!a) return;
    const p = toWorld(ev.clientX, ev.clientY);
    tempWire.setAttribute('d', dir === 'out' ? curve(a, p) : curve(p, a));
    tempWire.style.display = '';
  };
  const up = (ev: PointerEvent) => {
    removeEventListener('pointermove', move);
    removeEventListener('pointerup', up);
    tempWire.style.display = 'none';
    const hit = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
    const target = hit?.closest<HTMLElement>('.port');
    if (target && target.dataset.dir !== dir) {
      const tn = Number(target.dataset.node);
      const tp = target.dataset.port!;
      if (dir === 'out') connect(nodeId, port, tn, tp);
      else connect(tn, tp, nodeId, port);
      pushUndo(before);
      changed();
    } else {
      pushUndo(before);
      if (!target && hit && graphEl.contains(hit) && !hit.closest('.node'))
        openMenu(ev.clientX, ev.clientY, { dir, nodeId, port });
    }
  };
  move(e);
  addEventListener('pointermove', move);
  addEventListener('pointerup', up);
}

function startNodeDrag(nodeEl: HTMLElement, e: PointerEvent): void {
  const id = Number(nodeEl.dataset.id);
  if (e.shiftKey || e.metaKey || e.ctrlKey) {
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
  } else if (!selected.has(id)) {
    selected.clear();
    selected.add(id);
  }
  refreshSelection();
  nodeEl.style.zIndex = String(++zTop);
  const before = snapshot();
  const sx = e.clientX;
  const sy = e.clientY;
  const origin = [...selected]
    .map((i) => getNode(i))
    .filter((n): n is ShaderGraphNode => !!n)
    .map((n) => ({ n, x: n.x, y: n.y }));
  const move = (ev: PointerEvent) => {
    const dx = (ev.clientX - sx) / view.scale;
    const dy = (ev.clientY - sy) / view.scale;
    for (const o of origin) {
      o.n.x = Math.round(o.x + dx);
      o.n.y = Math.round(o.y + dy);
      const ne = nodeEls.get(o.n.id);
      if (ne) {
        ne.el.style.left = `${o.n.x}px`;
        ne.el.style.top = `${o.n.y}px`;
      }
    }
    drawWires();
  };
  const up = () => {
    removeEventListener('pointermove', move);
    removeEventListener('pointerup', up);
    pushUndo(before);
    scheduleDirty();
  };
  addEventListener('pointermove', move);
  addEventListener('pointerup', up);
}

function startPan(e: PointerEvent): void {
  e.preventDefault();
  const sx = e.clientX;
  const sy = e.clientY;
  const vx = view.x;
  const vy = view.y;
  let moved = false;
  graphEl.classList.add('panning');
  const move = (ev: PointerEvent) => {
    const dx = ev.clientX - sx;
    const dy = ev.clientY - sy;
    if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
    view.x = vx + dx;
    view.y = vy + dy;
    applyView();
  };
  const up = () => {
    removeEventListener('pointermove', move);
    removeEventListener('pointerup', up);
    graphEl.classList.remove('panning');
    if (!moved && e.button === 0 && selected.size) {
      selected.clear();
      refreshSelection();
    }
    saveView();
  };
  addEventListener('pointermove', move);
  addEventListener('pointerup', up);
}

graphEl.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const r = graphEl.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    const ns = Math.min(2.5, Math.max(0.2, view.scale * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015))));
    view.x = mx - (mx - view.x) * (ns / view.scale);
    view.y = my - (my - view.y) * (ns / view.scale);
    view.scale = ns;
    applyView();
    drawWires();
    saveView();
  },
  { passive: false },
);

graphEl.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  openMenu(e.clientX, e.clientY);
});
graphEl.addEventListener('dblclick', (e) => {
  const target = e.target as Element;
  const hit = target.closest<SVGPathElement>('.wire-hit');
  if (hit) {
    const to = Number(hit.dataset.to);
    const port = hit.dataset.port;
    return mutate(() => {
      graph.links = graph.links.filter((l) => !(l.to === to && l.toPort === port));
    });
  }
  if (!target.closest('.node')) openMenu(e.clientX, e.clientY);
});

// 從節點庫拖進來、拖入圖檔
graphEl.addEventListener('dragover', (e) => {
  const t = e.dataTransfer?.types ?? [];
  if (t.includes('application/x-shader-node') || t.includes('Files')) {
    e.preventDefault();
    graphEl.classList.add('drop-target');
  }
});
// 圖檔掉在節點圖以外時，不要讓瀏覽器直接開啟那個檔案
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', (e) => e.preventDefault());
graphEl.addEventListener('dragleave', () => graphEl.classList.remove('drop-target'));
graphEl.addEventListener('drop', async (e) => {
  e.preventDefault();
  graphEl.classList.remove('drop-target');
  const p = toWorld(e.clientX, e.clientY);
  const dropped = [...(e.dataTransfer?.files ?? [])].filter((f) => f.type.startsWith('image/'));
  if (dropped.length) {
    // 拖到貼圖節點上：替換它的圖片；否則建立新的貼圖節點
    const hitEl = (e.target as HTMLElement).closest<HTMLElement>('.node');
    const hitNode = hitEl ? getNode(Number(hitEl.dataset.id)) : undefined;
    for (const [k, f] of dropped.entries()) {
      const id = await importImage(f);
      if (!id) continue;
      if (k === 0 && hitNode?.type === 'texture')
        mutate(() => {
          hitNode.params.image = id;
        });
      else addNode('texture', p.x - 70 + k * 30, p.y - 16 + k * 30, null, { params: { image: id } });
    }
    return;
  }
  const type = e.dataTransfer?.getData('application/x-shader-node');
  if (type) addNode(type, p.x - 70, p.y - 16);
});

// ───────── 圖片 ─────────

function hashString(str: string): string {
  let x = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 7) {
    x ^= str.charCodeAt(i);
    x = Math.imul(x, 16777619);
  }
  return (x >>> 0).toString(36) + str.length.toString(36);
}

/** 讀取圖檔、縮到最長邊 1024px，存成 data URL；回傳圖片編號 */
async function importImage(file: File): Promise<string | null> {
  try {
    const url = await new Promise<string>((ok, fail) => {
      const r = new FileReader();
      r.onload = () => ok(String(r.result));
      r.onerror = () => fail(new Error('無法讀取檔案'));
      r.readAsDataURL(file);
    });
    const img = await new Promise<HTMLImageElement>((ok, fail) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => fail(new Error('不支援的圖片格式'));
      i.src = url;
    });
    const s = Math.min(1, 1024 / Math.max(img.width, img.height));
    const c = h('canvas');
    c.width = Math.max(1, Math.round(img.width * s));
    c.height = Math.max(1, Math.round(img.height * s));
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    const keepAlpha = /png|webp|gif|svg/.test(file.type);
    const data = c.toDataURL(keepAlpha ? 'image/png' : 'image/jpeg', 0.9);
    const id = `img_${hashString(data)}`;
    assets[id] = data;
    return id;
  } catch (error) {
    toast(`圖片載入失敗：${(error as Error).message}`);
    return null;
  }
}

function pickImage(nodeId: number): void {
  const input = $<HTMLInputElement>('#image-input');
  input.onchange = async () => {
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    const id = await importImage(f);
    const n = getNode(nodeId);
    if (id && n)
      mutate(() => {
        n.params.image = id;
      });
  };
  input.click();
}

addEventListener('pointermove', (e) => {
  mouse.x = e.clientX;
  mouse.y = e.clientY;
});

interface Pending {
  dir: 'in' | 'out';
  nodeId: number;
  port: string;
}

function addNode(
  type: string,
  x: number,
  y: number,
  pending: Pending | null = null,
  opts: { values?: Record<string, number>; params?: Record<string, string | number> } = {},
): void {
  const def = NODE_DEFS[type];
  if (def.unique && graph.nodes.some((n) => n.type === type)) {
    toast(`每張圖只能有一個 ${def.title}`);
    return;
  }
  mutate(() => {
    const n = createNode(graph, type, x, y, opts);
    selected.clear();
    selected.add(n.id);
    if (pending) {
      if (pending.dir === 'out' && def.inputs.length) {
        const target = def.inputs.find((i) => !i.expr) ?? def.inputs[0];
        connect(pending.nodeId, pending.port, n.id, target.name);
      } else if (pending.dir === 'in' && def.outputs.length) {
        n.x -= 190;
        connect(n.id, def.outputs[0].name, pending.nodeId, pending.port);
      }
    }
  });
}

function graphCenterWorld(): { x: number; y: number } {
  const r = graphEl.getBoundingClientRect();
  return toWorld(r.left + r.width / 2, r.top + r.height / 2);
}

// ───────── 新增節點選單 ─────────

let menuState: { world: { x: number; y: number }; pending: Pending | null } | null = null;
let menuActive = 0;

function matchDef(d: NodeDef, q: string): boolean {
  if (!q) return true;
  const hay =
    `${d.title} ${d.type} ${d.desc ?? ''} ${d.keywords ?? ''} ${CATEGORY_MAP[d.category].label}`.toLowerCase();
  return q.split(/\s+/).every((t) => hay.includes(t));
}

function openMenu(cx: number, cy: number, pending: Pending | null = null): void {
  const r = graphEl.getBoundingClientRect();
  if (cx < r.left || cx > r.right || cy < r.top || cy > r.bottom) {
    cx = r.left + r.width / 2;
    cy = r.top + r.height / 2;
  }
  menuState = { world: toWorld(cx, cy), pending };
  menuEl.hidden = false;
  menuEl.style.left = `${Math.min(cx, innerWidth - 280)}px`;
  menuEl.style.top = `${Math.min(cy, innerHeight - 410)}px`;
  menuInput.value = '';
  menuActive = 0;
  renderMenu();
  menuInput.focus();
}
function closeMenu(): void {
  menuEl.hidden = true;
  menuState = null;
}

function renderMenu(): void {
  const q = menuInput.value.trim().toLowerCase();
  const p = menuState?.pending;
  menuList.textContent = '';
  let idx = 0;
  for (const cat of CATEGORIES) {
    const defs = Object.values(NODE_DEFS).filter(
      (d) => d.category === cat.id && matchDef(d, q) && (!p || (p.dir === 'out' ? d.inputs.length : d.outputs.length)),
    );
    if (!defs.length) continue;
    menuList.append(h('li', 'menu-cat', cat.label));
    for (const d of defs) {
      const li = h('li', `menu-item${idx === menuActive ? ' active' : ''}`);
      li.dataset.type = d.type;
      li.dataset.idx = String(idx++);
      li.append(h('span', '', d.title), h('small', '', d.desc ?? ''));
      menuList.append(li);
    }
  }
  if (!idx) menuList.append(h('li', 'menu-cat', '找不到符合的節點'));
  menuList.querySelector('.menu-item.active')?.scrollIntoView({ block: 'nearest' });
}

function pickMenu(type: string): void {
  if (!menuState) return;
  const { world, pending } = menuState;
  closeMenu();
  addNode(type, world.x, world.y - 16, pending);
}

menuInput.addEventListener('input', () => {
  menuActive = 0;
  renderMenu();
});
menuInput.addEventListener('keydown', (e) => {
  const items = [...menuList.querySelectorAll<HTMLElement>('.menu-item')];
  if (e.key === 'Escape') closeMenu();
  else if (e.key === 'ArrowDown') {
    e.preventDefault();
    menuActive = Math.min(items.length - 1, menuActive + 1);
    renderMenu();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    menuActive = Math.max(0, menuActive - 1);
    renderMenu();
  } else if (e.key === 'Enter') {
    const it = items[menuActive];
    if (it) pickMenu(it.dataset.type!);
  }
  e.stopPropagation();
});
menuList.addEventListener('pointermove', (e) => {
  const it = (e.target as HTMLElement).closest<HTMLElement>('.menu-item');
  if (it && Number(it.dataset.idx) !== menuActive) {
    menuList.querySelector('.menu-item.active')?.classList.remove('active');
    it.classList.add('active');
    menuActive = Number(it.dataset.idx);
  }
});
menuList.addEventListener('click', (e) => {
  const it = (e.target as HTMLElement).closest<HTMLElement>('.menu-item');
  if (it) pickMenu(it.dataset.type!);
});
document.addEventListener(
  'pointerdown',
  (e) => {
    if (!menuEl.hidden && !menuEl.contains(e.target as Node)) closeMenu();
  },
  true,
);

// ───────── 節點庫（左側） ─────────

const paletteEl = $('#palette');
const paletteSearch = $<HTMLInputElement>('#palette-search');
function renderPalette(): void {
  const q = paletteSearch.value.trim().toLowerCase();
  paletteEl.textContent = '';
  for (const cat of CATEGORIES) {
    const defs = Object.values(NODE_DEFS).filter((d) => d.category === cat.id && matchDef(d, q));
    if (!defs.length) continue;
    const det = h('details', 'pal-cat');
    det.open = true;
    const sum = h('summary');
    const dot = h('span', 'cat-dot');
    dot.style.background = cat.color;
    sum.append(dot, cat.label);
    det.append(sum);
    for (const d of defs) {
      const it = h('div', 'pal-item');
      it.draggable = true;
      it.title = d.desc ?? '';
      it.append(h('span', '', d.title), h('small', '', d.desc ?? ''));
      it.addEventListener('dragstart', (e) => {
        e.dataTransfer?.setData('application/x-shader-node', d.type);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
      });
      it.addEventListener('dblclick', () => {
        const c = graphCenterWorld();
        addNode(d.type, c.x - 70, c.y - 40);
      });
      det.append(it);
    }
    paletteEl.append(det);
  }
}
paletteSearch.addEventListener('input', renderPalette);

// ───────── 屬性面板（右側） ─────────

function typeDot(t: string | undefined): HTMLElement {
  const d = h('span', 'type-dot');
  d.style.background = typeColor(t) ?? '#777';
  d.title = t ?? '';
  return d;
}

function renderPanel(): void {
  propsEl.textContent = '';
  const wrap = h('div', 'props');
  propsEl.append(wrap);

  if (selected.size === 1) {
    const n = getNode([...selected][0]);
    if (!n) return;
    const def = NODE_DEFS[n.type];
    const cat = CATEGORY_MAP[def.category];
    wrap.style.setProperty('--cat', cat.color);
    const title = h('h3', '', def.title);
    title.append(h('span', 'chip', cat.label));
    wrap.append(title, h('div', 'desc', def.desc ?? ''));

    if (def.params.length) {
      const sec = h('section');
      sec.append(h('div', 'sec-title', '參數'));
      for (const p of def.params) {
        const row = h('div', 'prop-row');
        row.append(h('span', '', p.label ?? p.name), paramControl(n, p));
        sec.append(row);
      }
      wrap.append(sec);
    }
    if (def.inputs.length) {
      const sec = h('section');
      sec.append(h('div', 'sec-title', '輸入'));
      for (const inp of def.inputs) {
        const row = h('div', 'prop-row');
        const lab = h('span');
        lab.append(typeDot(portTypes[`${n.id}:in:${inp.name}`]), inp.name);
        row.append(lab);
        const l = linkInto(n.id, inp.name);
        if (l) {
          const src = getNode(l.from);
          row.append(h('span', 'linked', `← ${src ? NODE_DEFS[src.type].title : '?'}.${l.fromPort}`));
        } else if (inp.expr) row.append(h('span', 'muted', `預設：${inp.exprLabel}`));
        else row.append(valueControl(n, inp));
        sec.append(row);
      }
      wrap.append(sec);
    }
    if (def.outputs.length) {
      const sec = h('section');
      sec.append(h('div', 'sec-title', '輸出'));
      for (const o of def.outputs) {
        const row = h('div', 'prop-row');
        const lab = h('span');
        const t = portTypes[`${n.id}:out:${o.name}`];
        lab.append(typeDot(t), o.name);
        row.append(lab, h('span', 'muted mono', t ?? ''));
        sec.append(row);
      }
      wrap.append(sec);
    }
    return;
  }

  if (selected.size > 1) {
    wrap.append(
      h('h3', '', `已選取 ${selected.size} 個節點`),
      h('div', 'desc', '拖曳可一起移動，Delete 刪除，⌘/Ctrl+D 複製。'),
    );
    return;
  }

  // 沒有選取：總覽與在遊戲裡使用的方式
  wrap.append(h('h3', '', '節點圖'));
  const stat = h('div', 'stat');
  const s1 = h('div');
  s1.append(h('b', '', graph.nodes.length), h('span', 'muted', '節點'));
  const s2 = h('div');
  s2.append(h('b', '', graph.links.length), h('span', 'muted', '連線'));
  stat.append(s1, s2);
  wrap.append(h('div', 'desc', '點選節點以編輯屬性。'), stat);

  const use = h('section');
  use.append(h('div', 'sec-title', '在遊戲裡使用'));
  const name = fileName ? shaderNameOf(fileName) : '名稱';
  const code = h('pre', 'mono');
  code.style.cssText = 'margin:0 0 8px;white-space:pre-wrap;font-size:11.5px;color:var(--text2)';
  if (shaderGraphKind(graph) === 'effect') {
    // 全螢幕效果：寫在後製設定裡最簡單（場景檔也可以）
    code.textContent = `// 寫法一（建議）：寫在後製設定\npostfx.settings.effects = [{ graph: 'shaders/${name}.shader.json' }];\n\n// 寫法二（擇一）：自己載入、加進後製\nshaders.defineEffect(await loadShaderGraphEffect('shaders/${name}.shader.json'));\npostfx.addPass(shaders.createEffect('${name}'), 'display');`;
    use.append(
      code,
      h(
        'div',
        'desc',
        '全螢幕效果（後製）：套用在色調映射之後、畫面上看到的顏色。uniform：uMouse（滑鼠 0..1）可以在遊戲裡修改；uAspect 是畫面的長寬比。',
      ),
    );
  } else {
    code.textContent = `shaders.define(await loadShaderGraph('shaders/${name}.shader.json'));\nmesh.material = shaders.createMaterial('${name}');`;
    use.append(
      code,
      h(
        'div',
        'desc',
        '材質的 uniform：uMouse（滑鼠 0..1）、uLightDir（光的方向）、uAspect（長寬比）可以在遊戲裡修改。',
      ),
    );
  }
  wrap.append(use);

  const legend = h('section');
  legend.append(h('div', 'sec-title', '資料型別'));
  const lg = h('div', 'legend');
  for (const t of Object.keys(TYPE_COLOR)) {
    const s = h('span');
    s.append(typeDot(t), t);
    lg.append(s);
  }
  legend.append(
    lg,
    h(
      'div',
      'desc',
      '型別不同時會自動轉換：float 會擴展成向量，向量會截取前幾個分量。數學節點的輸出維度取決於輸入中最大的那個。',
    ),
  );
  wrap.append(legend);

  const keys = h('section');
  keys.append(h('div', 'sec-title', '快速鍵'));
  const ul = h('ul', 'keys');
  for (const [a, b] of [
    ['新增節點', 'Space / 右鍵'],
    ['刪除', 'Delete'],
    ['複製', '⌘/Ctrl + D'],
    ['全選', '⌘/Ctrl + A'],
    ['復原 / 重做', '⌘/Ctrl + Z / ⇧Z'],
    ['儲存', '⌘/Ctrl + S'],
    ['全部置中', 'F'],
    ['多選', 'Shift + 點擊'],
  ]) {
    const li = h('li');
    li.append(h('span', '', a));
    const k = h('span');
    b.split(' / ').forEach((x, i) => {
      if (i) k.append(' / ');
      k.append(h('kbd', '', x));
    });
    li.append(k);
    ul.append(li);
  }
  keys.append(ul);
  wrap.append(keys);
}

for (const t of document.querySelectorAll<HTMLElement>('.tab'))
  t.addEventListener('click', () => {
    for (const x of document.querySelectorAll('.tab')) x.classList.toggle('active', x === t);
    $('#tab-props').hidden = t.dataset.tab !== 'props';
    $('#tab-code').hidden = t.dataset.tab !== 'code';
  });

// ───────── 鍵盤 ─────────

addEventListener('keydown', (e) => {
  const tag = (e.target as HTMLElement).tagName;
  const editing = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
  const mod = e.metaKey || e.ctrlKey;
  const k = e.key.toLowerCase();
  if (mod && k === 's') {
    e.preventDefault();
    void save();
    return;
  }
  if (mod && k === 'z' && !editing) {
    e.preventDefault();
    if (e.shiftKey) redo();
    else undo();
    return;
  }
  if (mod && k === 'y' && !editing) {
    e.preventDefault();
    redo();
    return;
  }
  if (editing || !menuEl.hidden) return;
  if (mod && k === 'd') {
    e.preventDefault();
    duplicateSelection();
  } else if (mod && k === 'a') {
    e.preventDefault();
    for (const n of graph.nodes) selected.add(n.id);
    refreshSelection();
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    if (selected.size) {
      e.preventDefault();
      mutate(() => deleteNodes([...selected]));
    }
  } else if (e.key === ' ' || e.key === 'Tab') {
    e.preventDefault();
    openMenu(mouse.x, mouse.y);
  } else if (k === 'f' && !mod) frameAll();
  else if (e.key === 'Escape') {
    selected.clear();
    refreshSelection();
  }
});

// ───────── 編譯 ─────────

let compileTimer = 0;
let lastSrc = '';
function scheduleCompile(): void {
  clearTimeout(compileTimer);
  compileTimer = window.setTimeout(compileAll, 40);
}

/** 目前的檔案內容 */
const currentFile = (): ShaderGraphFile => ({
  format: 'hero-shader-graph',
  version: 1,
  graph,
  assets,
  preview: { mesh: main?.meshKind ?? 'sphere' },
});

/** GLSL 分頁要顯示的段落 */
type CodeSection = readonly [title: string, src: string];
const codeSections = (def: ShaderDefinition): CodeSection[] => [
  ['頂點：宣告與函式（vertexHeader）', def.vertexHeader ?? ''],
  ['頂點：main 裡（修改 transformed）', def.vertex ?? ''],
  ['片段：宣告與函式（fragmentHeader）', def.fragmentHeader ?? ''],
  ['片段：main 裡（設定 color）', def.fragment ?? ''],
];
/** 全螢幕效果：顯示遊戲裡實際用的效果程式（shaders.defineEffect 的 header、fragment） */
const effectSections = (def: EffectDefinition): CodeSection[] => [
  ['全螢幕效果：宣告與函式（header）', def.header ?? ''],
  ['全螢幕效果：main 裡（color 是畫面原本的顏色，改成新的顏色）', def.fragment],
];

function compileAll(): void {
  portTypes = analyzeShaderGraphTypes(graph);
  applyPortColors();
  drawWires();

  const file = currentFile();
  // 全螢幕效果：在平面 2D 上預覽（效果套用在示範畫面上），不能換網格
  const effect = shaderGraphKind(graph) === 'effect';
  meshSelect.disabled = effect;
  meshSelect.title = effect ? '全螢幕效果固定用平面 2D 預覽' : '';
  if (effect && main && main.meshKind !== 'quad') setMesh('quad');
  try {
    // 只編譯一次：GLSL 分頁、主預覽都用這份定義
    const def = graphDefinition(file);
    const effectDef = effect ? graphEffectDefinition(file, fileName ? shaderNameOf(fileName) : 'effect') : null;
    const sections = effectDef ? effectSections(effectDef) : codeSections(def);
    lastSrc = sections.map(([title, src]) => `// ===== ${title} =====\n${src}\n`).join('');
    renderCode(sections, Object.keys((effectDef ?? def).uniforms ?? {}), !!effectDef);
    showError(main ? main.setDefinition(def) : '');
  } catch (error) {
    const msg = (error as Error).message;
    showError(msg);
    lastSrc = '';
    codeEl.textContent = `// ${msg}`;
  }

  if (thumbs) {
    const ids = new Set<number>();
    for (const [id, ne] of nodeEls) {
      if (!ne.thumb) continue;
      const n = getNode(id)!;
      ids.add(id);
      thumbs.set(file, id, NODE_DEFS[n.type].outputs[0].name);
    }
    thumbs.keep(ids);
  }
  // 屬性面板裡的型別圓點要更新
  if (selected.size === 1 && !propsEl.contains(document.activeElement)) renderPanel();
}

function showError(msg: string): void {
  errorEl.textContent = msg;
}

function renderCode(sections: CodeSection[], uniforms: string[], effect: boolean): void {
  codeEl.textContent = '';
  const frag = document.createDocumentFragment();
  frag.append(h('span', 'code-title', '// ===== uniform =====\n'));
  frag.append(
    effect
      ? `// tDiffuse（畫面）、uTime、uResolution（引擎內建）、${uniforms.join('、')}\n` +
          `// 遊戲裡：shaders.defineEffect(await loadShaderGraphEffect('shaders/檔名.shader.json'))，\n` +
          `//         postfx.addPass(shaders.createEffect('檔名'), 'display')，或寫在 postfx.settings.effects\n\n`
      : `// uTime（引擎內建）、${uniforms.join('、')}\n\n`,
  );
  for (const [title, src] of sections) {
    if (!src) continue;
    frag.append(h('span', 'code-title', `// ===== ${title} =====\n`));
    src.split('\n').forEach((line, i) => {
      frag.append(h('span', 'ln', `${String(i + 1).padStart(3)}  `), `${line}\n`);
    });
    frag.append('\n');
  }
  codeEl.append(frag);
}

// ───────── 預覽 ─────────

let main: MainPreview | null = null;
let thumbs: ThumbnailRenderer | null = null;
try {
  main = new MainPreview(previewCanvas);
  thumbs = new ThumbnailRenderer();
} catch (error) {
  showError(`無法建立預覽（需要 WebGL2）：${(error as Error).message}`);
}

const state: PreviewState = { time: 0, mouse: new THREE.Vector2(0.5, 0.5) };
let paused = false;
let lastT = performance.now();

const meshSelect = $<HTMLSelectElement>('#mesh-select');
for (const [v, l] of PREVIEW_MESHES) meshSelect.add(new Option(l, v));
meshSelect.addEventListener('change', () => setMesh(meshSelect.value as PreviewMesh));
function setMesh(m: PreviewMesh): void {
  meshSelect.value = m;
  main?.setMesh(m);
  $('#preview-wrap').classList.toggle('flat', m === 'quad');
  scheduleCompile(); // 重新編譯（平面 2D 用不同的攝影機）
  scheduleDirty();
}

previewCanvas.addEventListener('pointerdown', (e) => {
  previewCanvas.setPointerCapture(e.pointerId);
  let lx = e.clientX;
  let ly = e.clientY;
  const move = (ev: PointerEvent) => {
    if (main && main.meshKind !== 'quad') {
      main.cam.yaw -= (ev.clientX - lx) * 0.01;
      main.cam.pitch = Math.max(-1.45, Math.min(1.45, main.cam.pitch + (ev.clientY - ly) * 0.01));
    }
    lx = ev.clientX;
    ly = ev.clientY;
  };
  const up = () => {
    previewCanvas.removeEventListener('pointermove', move);
    previewCanvas.removeEventListener('pointerup', up);
  };
  previewCanvas.addEventListener('pointermove', move);
  previewCanvas.addEventListener('pointerup', up);
});
previewCanvas.addEventListener('pointermove', (e) => {
  const r = previewCanvas.getBoundingClientRect();
  state.mouse.set((e.clientX - r.left) / r.width, 1 - (e.clientY - r.top) / r.height);
});
previewCanvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    if (main) main.cam.dist = Math.max(1.8, Math.min(8, main.cam.dist * Math.exp(e.deltaY * 0.001)));
  },
  { passive: false },
);

const rotateBtn = $('#btn-rotate');
rotateBtn.classList.toggle('on', main?.cam.auto ?? false);
rotateBtn.onclick = () => {
  if (!main) return;
  main.cam.auto = !main.cam.auto;
  rotateBtn.classList.toggle('on', main.cam.auto);
};
$('#btn-pause').onclick = (e) => {
  paused = !paused;
  (e.currentTarget as HTMLElement).textContent = paused ? '▶' : '⏸';
};
$('#btn-shot').onclick = () =>
  previewCanvas.toBlob((b) => {
    if (b) download(`${fileName ? shaderNameOf(fileName) : 'shader'}-preview.png`, b);
  });
$('#btn-full').onclick = () => {
  const p = $('#preview-panel');
  if (document.fullscreenElement) void document.exitFullscreen();
  else void p.requestFullscreen?.();
};

const timeLabel = $('#time-label');
function frame(now: number): void {
  requestAnimationFrame(frame);
  const dt = Math.max(0, Math.min(0.1, (now - lastT) / 1000));
  lastT = now;
  if (!paused) state.time += dt;
  timeLabel.textContent = `${state.time.toFixed(1)}s`;
  main?.render(state, dt);
  if (thumbs) for (const [id, ne] of nodeEls) if (ne.ctx) thumbs.draw(id, ne.ctx, state);
}

// ───────── 檔案 ─────────

const fileText = () => stringifyShaderGraphFile(currentFile());

/**
 * 判斷有沒有改過用的摘要：節點圖、預覽網格、用到的圖片編號。
 * 圖片的編號是內容的雜湊，不用把好幾 MB 的 data URL 轉成文字比對。
 */
const docKey = () =>
  JSON.stringify([graph, main?.meshKind ?? 'sphere', graph.nodes.map((n) => n.params.image ?? '').filter(Boolean)]);

let dirtyTimer = 0;
function scheduleDirty(): void {
  clearTimeout(dirtyTimer);
  dirtyTimer = window.setTimeout(updateDirty, 150);
}
const isDirty = () => docKey() !== savedKey;
function updateDirty(): void {
  docNameEl.textContent = fileName ?? '未存檔';
  docNameEl.classList.toggle('dirty', isDirty());
  $<HTMLButtonElement>('#btn-delete').disabled = !fileName;
}

function saveView(): void {
  if (fileName) storage.setJson(viewKey(fileName), view);
}
function loadView(name: string): boolean {
  const v = storage.getJson<typeof view | null>(viewKey(name), null);
  if (!v || !Number.isFinite(v.scale)) return false;
  view = v;
  return true;
}

function renderFileSelect(): void {
  fileSelect.textContent = '';
  if (!fileName) fileSelect.add(new Option('（未存檔）', ''));
  for (const f of files) fileSelect.add(new Option(shaderNameOf(f.name), f.name));
  if (!files.length && fileName === null) fileSelect.title = '專案的 public/shaders 裡還沒有節點圖檔';
  fileSelect.value = fileName ?? '';
}

/** 換成另一份內容（開檔、新增、範例）；saved：這份內容是不是已經存在磁碟上 */
function setDocument(file: ShaderGraphFile, name: string | null, saved: boolean): void {
  graph = file.graph;
  for (const k of Object.keys(assets)) delete assets[k];
  Object.assign(assets, file.assets ?? {});
  selected.clear();
  undoStack.length = 0;
  redoStack.length = 0;
  fileName = name;
  const mesh = file.preview?.mesh;
  if (mesh && PREVIEW_MESHES.some(([m]) => m === mesh)) setMesh(mesh as PreviewMesh);
  changed();
  if (name && loadView(name)) applyView();
  else requestAnimationFrame(frameAll);
  // 存在磁碟上的、還沒存檔也沒動過的範例：不算修改過
  savedKey = saved || !name ? docKey() : '';
  renderFileSelect();
  updateDirty();
  if (name) storage.set(LAST_FILE_KEY, name);
}

const confirmDiscard = async () =>
  !isDirty() ||
  (await showConfirm('目前的修改還沒儲存，要放棄嗎？', { title: '放棄修改', ok: '放棄修改', danger: true }));

async function openFile(name: string): Promise<void> {
  try {
    setDocument(parseShaderGraphFile(await readShaderFile(name)), name, true);
  } catch (error) {
    toast(`開啟 ${name} 失敗：${(error as Error).message}`);
    renderFileSelect();
  }
}

async function refreshFiles(): Promise<void> {
  try {
    files = await listShaderFiles();
  } catch (error) {
    toast(`讀取檔案清單失敗：${(error as Error).message}`);
    files = [];
  }
  renderFileSelect();
}

/** 問檔名（新增、第一次存檔）；取消時回傳 null */
async function askName(suggest: string): Promise<string | null> {
  for (;;) {
    const input = await showPrompt('英數字、-、_；也是遊戲裡的著色器名稱', suggest, {
      title: '節點圖的名稱',
      validate: (v) => (fileNameOf(v) ? null : '名稱只能用英數字、-、_'),
    });
    if (input === null) return null;
    const name = fileNameOf(input)!;
    const exists = files.some((f) => f.name === name);
    if (exists && !(await showConfirm(`已經有「${shaderNameOf(name)}」，要覆蓋嗎？`, { ok: '覆蓋', danger: true }))) {
      suggest = input;
      continue;
    }
    return name;
  }
}

async function save(): Promise<void> {
  if (!fileName) {
    const name = await askName('my-shader');
    if (!name) return;
    fileName = name;
  }
  try {
    await writeShaderFile(fileName, fileText());
    savedKey = docKey();
    await refreshFiles();
    saveView();
    updateDirty();
    renderPanel();
    storage.set(LAST_FILE_KEY, fileName);
    toast(`已儲存 shaders/${fileName}`);
  } catch (error) {
    toast(`儲存失敗：${(error as Error).message}`);
  }
}

fileSelect.addEventListener('change', async () => {
  const name = fileSelect.value;
  if (!name || name === fileName) return;
  if (!(await confirmDiscard())) {
    renderFileSelect();
    return;
  }
  void openFile(name);
});
$('#btn-new').onclick = async () => {
  if (!(await confirmDiscard())) return;
  const name = await askName('my-shader');
  if (!name) return;
  const effect = await showConfirm('要做材質（貼在 3D 物件上），還是全螢幕效果（後製，套用在整個畫面上）？', {
    title: '新增節點圖',
    ok: '全螢幕效果',
    cancel: '材質',
  });
  setDocument(
    { format: 'hero-shader-graph', version: 1, graph: buildExample(effect ? 'blankEffect' : 'blank') },
    name,
    false,
  );
  if (effect) setMesh('quad');
  await save();
};
$('#btn-delete').onclick = async () => {
  if (!fileName) return;
  if (
    !(await showConfirm(`要刪除 shaders/${fileName} 嗎？無法復原。`, { title: '刪除節點圖', ok: '刪除', danger: true }))
  )
    return;
  try {
    await deleteShaderFile(fileName);
    toast(`已刪除 ${fileName}`);
    await refreshFiles();
    if (files.length) await openFile(files[0].name);
    else setDocument({ format: 'hero-shader-graph', version: 1, graph: buildExample('rings') }, null, false);
  } catch (error) {
    toast(`刪除失敗：${(error as Error).message}`);
  }
};
$('#btn-save').onclick = () => void save();
addEventListener('beforeunload', (e) => {
  if (isDirty()) e.preventDefault();
});

$('#btn-export').onclick = () => download(fileName ?? 'shader-graph.shader.json', fileText(), 'application/json');
$('#btn-import').onclick = () => $('#file-input').click();
$<HTMLInputElement>('#file-input').addEventListener('change', async (e) => {
  const input = e.target as HTMLInputElement;
  const f = input.files?.[0];
  input.value = '';
  if (!f) return;
  try {
    const file = parseShaderGraphFile(await f.text());
    Object.assign(assets, file.assets ?? {});
    mutate(() => {
      graph = file.graph;
      selected.clear();
    });
    frameAll();
    toast(`已匯入 ${f.name}（還沒儲存）`);
  } catch (error) {
    toast(`匯入失敗：${(error as Error).message}`);
  }
});
$('#btn-copy').onclick = () => {
  if (!lastSrc) return toast('目前沒有可複製的程式碼');
  navigator.clipboard.writeText(lastSrc).then(
    () => toast('已複製 GLSL'),
    () => toast('複製失敗'),
  );
};
$('#btn-undo').onclick = undo;
$('#btn-redo').onclick = redo;
$('#btn-frame').onclick = frameAll;
$('#btn-clear').onclick = async () => {
  if (!(await showConfirm('確定要清空節點圖？可以用復原還原。', { title: '清空', ok: '清空', danger: true }))) return;
  loadExample('blank');
};

let toastTimer = 0;
function toast(msg: string): void {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.remove('show'), 1800 + msg.length * 40);
}

// ───────── 範例 ─────────

function loadExample(id: string): void {
  const ex = EXAMPLES.find((e) => e.id === id);
  const g = buildExample(id);
  mutate(() => {
    graph = g;
    selected.clear();
  });
  if (ex?.mesh) setMesh(ex.mesh);
  frameAll();
  if (ex?.desc) toast(`${ex.label}：${ex.desc}`);
}

const exampleSelect = $<HTMLSelectElement>('#example-select');
exampleSelect.add(new Option('範例…', ''));
let group: HTMLOptGroupElement | null = null;
for (const ex of EXAMPLES) {
  if (!group || group.label !== ex.group) {
    group = document.createElement('optgroup');
    group.label = ex.group;
    exampleSelect.append(group);
  }
  const o = new Option(ex.label, ex.id);
  o.title = ex.desc ?? '';
  group.append(o);
}
exampleSelect.addEventListener('change', () => {
  const id = exampleSelect.value;
  exampleSelect.value = '';
  if (id) loadExample(id);
});

// ───────── 啟動 ─────────

renderPalette();
applyView();
await refreshFiles();
const wanted = new URLSearchParams(location.search).get('file');
const last = storage.get(LAST_FILE_KEY);
const start = [wanted && fileNameOf(wanted), last].find((n) => n && files.some((f) => f.name === n)) ?? files[0]?.name;
if (start) await openFile(start);
else setDocument({ format: 'hero-shader-graph', version: 1, graph: buildExample('rings') }, null, false);
requestAnimationFrame(frame);

// 除錯用：在瀏覽器主控台可以用 shaderEditor.graph 查看狀態（自動測試也用它）
(window as unknown as { shaderEditor: unknown }).shaderEditor = {
  get graph() {
    return graph;
  },
  get file() {
    return fileName;
  },
  get error() {
    return errorEl.textContent;
  },
  get dirty() {
    return isDirty();
  },
  loadExample,
  save,
};
