/**
 * UI 編輯器：視覺化編輯（結構樹、拖曳、調整大小、屬性面板）＋ XML 原始碼，兩邊同步。
 * 文件的唯一來源是 XML 文字：視覺操作會修改結構後重新輸出文字。
 *
 * 網址可以指定要打開的檔案：/ui-editor.html?file=orbit/hud.xml（3D 場景編輯器的「編輯 UI」用）。
 * 每次修改都用 BroadcastChannel 送出目前的內容（3D 場景編輯器的 UI 層即時更新，見 s3d-editor/uilayer.ts）。
 */
import { showAlert, showConfirm, showPrompt } from '../shared/dialog';
import { download } from '../shared/dom';
import { storage } from '../shared/storage';
import { highlightXml } from './highlight';
import { EnginePreview, fillTemplateDemo } from './preview';
import { COMPONENT_DEMOS } from './componentDemos';
import {
  UIFileStore,
  baseName,
  folderOf,
  normalizeFileName,
  normalizeFolderName,
  type UIAssetInfo,
  type UIFileInfo,
} from './files';
import { analyzeCode, suggest, type CodeContext, type Suggestion } from './codeAssist';
import { openSliceEditor } from './sliceEditor';
import { installSplitters } from './splitters';
import { UI2D, type UIElement, UILabel, UIList, XmlError, type Attrs, type XmlNode } from '../../ui2d';
import { clearUIXmlCache } from '../../ui2d/xmlSources';
import { openUISyncChannel, type UISyncMessage } from '../ui-sync';
import {
  ATTRIBUTE_HINTS,
  PALETTE,
  VALUE_HINTS,
  duplicateNode,
  insertNode,
  insertionPoint,
  isContainer,
  moveNode,
  nodeAt,
  paletteNode,
  parentPath,
  parseDocument,
  pathAtLine,
  removeNode,
  samePath,
  serialize,
  shiftNode,
  type Path,
} from './model';

/** 舊版只編輯 scene.xml 時的草稿位置（啟動時搬到新的檔案草稿） */
const LEGACY_STORAGE_KEY = 'ui2d-editor-xml';
const LAST_FILE_KEY = 'ui2d-editor-last-file';
const DEFAULT_FILE = 'scene.xml';
const BREAKPOINTS = ['', 'sm', 'md', 'lg', 'xl'] as const;
type Bp = (typeof BREAKPOINTS)[number];

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const code = $<HTMLTextAreaElement>('code');
const errorBox = $<HTMLDivElement>('error');
/** 結構面板上方的錯誤提示（原始碼視窗關著時也看得到） */
const treeError = $<HTMLDivElement>('treeError');
const codeHl = $<HTMLPreElement>('codeHl');
const codeHlInner = codeHl.querySelector('code')!;
const errLine = $<HTMLDivElement>('errLine');
const logBox = $<HTMLDivElement>('log');
const frame = $<HTMLDivElement>('frame');
const stage = $<HTMLDivElement>('stage');
const overlay = $<HTMLDivElement>('overlay');
const hoverBox = $<HTMLDivElement>('hover');
const selectedBox = $<HTMLDivElement>('selected');
const dropLine = $<HTMLDivElement>('dropLine');
const treeHoverBox = $<HTMLDivElement>('treeHover');
const outlinesLayer = $<HTMLDivElement>('outlines');
const treeBox = $<HTMLDivElement>('tree');
const propsBox = $<HTMLDivElement>('props');
const paletteBox = $<HTMLDivElement>('palette');
const deviceSelect = $<HTMLSelectElement>('device');
const wInput = $<HTMLInputElement>('w');
const hInput = $<HTMLInputElement>('h');
const bpLabel = $<HTMLSpanElement>('bp');

// ───────── XML 管理：目前編輯的檔案 ─────────

const files = new UIFileStore('ui/');
let currentFile = DEFAULT_FILE;
/** 磁碟上的內容（和它不同就是「未儲存」） */
let diskText: string | null = null;
let fileInfos: UIFileInfo[] = [];
/** 介面檔的資料夾（每個場景一個） */
let folderNames: string[] = [];
const COLLAPSED_KEY = 'ui2d-editor-collapsed-folders';
const collapsedFolders = new Set<string>(storage.getJson<string[]>(COLLAPSED_KEY, []));

/** 通知同一個瀏覽器裡的 3D 場景編輯器（UI 層即時更新）；它剛打開時送出還沒存檔的內容 */
const syncChannel = openUISyncChannel((msg) => {
  try {
    if (msg.type === 'request' && text && isDirty()) broadcast({ type: 'draft', name: currentFile, text });
  } catch {
    /* 編輯器還在啟動（text 還沒建立）：略過 */
  }
});
function broadcast(msg: UISyncMessage): void {
  try {
    syncChannel?.postMessage(msg);
  } catch {
    /* 關閉中：略過 */
  }
}

/** 每次修改：存成這個檔案的草稿（和磁碟相同就清掉草稿） */
function persistDraft(next: string): void {
  if (diskText !== null && next === diskText) {
    files.clearDraft(currentFile);
    broadcast({ type: 'saved', name: currentFile });
  } else {
    files.setDraft(currentFile, next);
    broadcast({ type: 'draft', name: currentFile, text: next });
  }
  updateDocState();
}

function isDirty(): boolean {
  return diskText === null || text !== diskText;
}

// ───────── 狀態 ─────────

const ui = await UI2D.create({ container: frame, unknownTags: 'placeholder', editorHints: true });
let text = '';
let doc: XmlNode | null = null;
let selected: Path | null = null;
let mode: 'design' | 'interact' = 'design';
let editBp: Bp = '';
let showOutlines = false;
let reformatNoticeShown = false;

// ───────── 工具列：放不下的群組移到「⋯」下拉面板 ─────────

const tbMain = $<HTMLDivElement>('tbMain');
const moreBtn = $<HTMLButtonElement>('moreBtn');
const morePanel = $<HTMLDivElement>('morePanel');
const tbGroups = [...tbMain.querySelectorAll<HTMLElement>('.tb-group')].map((el, index) => ({
  el,
  index,
  priority: Number(el.dataset.priority ?? 5),
}));

/** 依目前寬度重新分配：先全部放回工具列，再從優先度低的開始移到面板，直到放得下 */
function fitToolbar(): void {
  for (const g of tbGroups) tbMain.appendChild(g.el);
  const moved: typeof tbGroups = [];
  for (const g of [...tbGroups].sort((a, b) => a.priority - b.priority)) {
    if (tbMain.scrollWidth <= tbMain.clientWidth + 1) break;
    moved.push(g);
    g.el.remove();
  }
  // 面板裡維持原本的順序
  for (const g of moved.sort((a, b) => a.index - b.index)) morePanel.appendChild(g.el);
  moreBtn.hidden = moved.length === 0;
  moreBtn.title = moved.length ? `更多功能：${moved.map((g) => g.el.dataset.name).join('、')}` : '更多功能';
  if (moved.length === 0) setMoreOpen(false);
}

function setMoreOpen(open: boolean): void {
  morePanel.classList.toggle('open', open);
  moreBtn.classList.toggle('on', open);
  moreBtn.setAttribute('aria-expanded', String(open));
}

moreBtn.addEventListener('click', () => setMoreOpen(!morePanel.classList.contains('open')));
// 點面板以外的地方關閉
document.addEventListener(
  'pointerdown',
  (e) => {
    if (!morePanel.classList.contains('open')) return;
    const t = e.target as Node;
    if (!morePanel.contains(t) && !moreBtn.contains(t)) setMoreOpen(false);
  },
  true,
);
window.addEventListener(
  'keydown',
  (e) => {
    if (e.key === 'Escape' && morePanel.classList.contains('open')) {
      setMoreOpen(false);
      e.stopImmediatePropagation();
    }
  },
  true,
);
new ResizeObserver(() => fitToolbar()).observe(document.querySelector('header')!);

// ───────── 正式預覽：在遊戲引擎上執行 ─────────

const previewWin = $<HTMLDivElement>('previewWin');
const pvViewport = $<HTMLDivElement>('pvViewport');
const pvStage = $<HTMLDivElement>('pvStage');
const pvLog = $<HTMLDivElement>('pvLog');
const pvError = $<HTMLSpanElement>('pvError');
let preview: EnginePreview | null = null;
/** 開啟中的預覽（關閉或重新開始時遞增，丟棄還沒啟動完成的舊預覽） */
let previewToken = 0;
let pvFpsTimer = 0;
let pvLastEvent: { text: string; count: number; el: HTMLElement } | null = null;

function previewOpen(): boolean {
  return previewWin.classList.contains('open');
}

/** 預覽畫面：裝置尺寸，縮放到放得進視窗 */
function layoutPreview(): void {
  const w = parseInt(frame.style.width, 10) || 1280;
  const h = parseInt(frame.style.height, 10) || 720;
  pvViewport.style.width = `${w}px`;
  pvViewport.style.height = `${h}px`;
  const scale = Math.min(1, (pvStage.clientWidth - 48) / w, (pvStage.clientHeight - 48) / h);
  pvViewport.style.transform = `scale(${scale})`;
  $('pvSize').textContent = `${w}×${h}${scale < 1 ? `　顯示 ${Math.round(scale * 100)}%` : ''}`;
}

function previewEvent(message: string): void {
  if (pvLastEvent && pvLastEvent.text === message) {
    // 同一個事件連續觸發（例如拖曳滑桿）：合併計數
    pvLastEvent.count++;
    pvLastEvent.el.querySelector('.n')!.textContent = `×${pvLastEvent.count}`;
    return;
  }
  pvLog.querySelector('.muted')?.remove();
  const el = document.createElement('span');
  el.className = 'ev';
  el.innerHTML = '<span class="t"></span><span class="n"></span>';
  el.querySelector('.t')!.textContent = message;
  pvLog.prepend(el);
  while (pvLog.children.length > 12) pvLog.lastElementChild!.remove();
  pvLastEvent = { text: message, count: 1, el };
}

async function openPreview(): Promise<void> {
  const token = ++previewToken;
  previewWin.classList.add('open');
  layoutPreview();
  $('pvLoading').style.display = '';
  pvError.textContent = '';
  try {
    const p = await EnginePreview.open(text, {
      container: pvViewport,
      baseUrl: docBase(),
      onEvent: previewEvent,
    });
    if (token !== previewToken) {
      p.close();
      return;
    }
    preview = p;
    p.setBackground($('pvBgSolid').classList.contains('on') ? 'solid' : 'scene');
    $('pvLoading').style.display = 'none';
    clearInterval(pvFpsTimer);
    pvFpsTimer = window.setInterval(() => {
      if (preview) $('pvFps').textContent = `${Math.round(preview.fps)} FPS`;
    }, 500);
    log('預覽：已在遊戲引擎上啟動');
  } catch (error) {
    if (token !== previewToken) return;
    $('pvLoading').style.display = 'none';
    pvError.textContent = `⚠ 預覽啟動失敗：${(error as Error).message}`;
    console.error(error);
  }
}

function closePreview(): void {
  previewToken++;
  clearInterval(pvFpsTimer);
  preview?.close();
  preview = null;
  pvViewport.replaceChildren();
  previewWin.classList.remove('open');
}

/** 編輯內容改變：預覽同步更新（XML 有錯時維持上一版並顯示錯誤） */
function syncPreview(xml: string): void {
  if (!preview) return;
  try {
    preview.update(xml);
    pvError.textContent = '';
  } catch (error) {
    pvError.textContent = `⚠ ${(error as Error).message}`;
  }
}

$('previewBtn').addEventListener('click', () => void openPreview());
$('pvClose').addEventListener('click', closePreview);
$('pvRestart').addEventListener('click', () => {
  closePreview();
  void openPreview();
});
for (const [id, mode] of [
  ['pvBgScene', 'scene'],
  ['pvBgSolid', 'solid'],
] as const) {
  $(id).addEventListener('click', () => {
    $('pvBgScene').classList.toggle('on', mode === 'scene');
    $('pvBgSolid').classList.toggle('on', mode === 'solid');
    preview?.setBackground(mode);
  });
}
new ResizeObserver(() => previewOpen() && layoutPreview()).observe(pvStage);
// 預覽開著時：Esc 關閉，其他編輯器快捷鍵都不作用（最先註冊，搶在其他鍵盤處理之前）
window.addEventListener(
  'keydown',
  (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      if (previewOpen()) closePreview();
      else void openPreview();
      return;
    }
    if (!previewOpen()) return;
    e.stopImmediatePropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      closePreview();
    }
  },
  true,
);
const history: string[] = [];
const future: string[] = [];
const warnedUnknown = new Set<string>();

/** 紀錄（中央區塊最下方）：最新的在最上面，最多保留 60 筆 */
function log(message: string): void {
  const line = document.createElement('div');
  line.textContent = `${new Date().toLocaleTimeString()}  ${message}`;
  if (message.startsWith('⚠')) line.className = 'warn';
  logBox.prepend(line);
  while (logBox.children.length > 60) logBox.lastChild!.remove();
  logBox.scrollTop = 0;
}
$('logClear').addEventListener('click', () => logBox.replaceChildren());

// ───────── 文字 ↔ 結構 ↔ 預覽 ─────────

/** 設定文件內容（唯一入口）：更新原始碼、結構、預覽與各面板 */
function setText(next: string, opts: { history?: boolean; fromCode?: boolean } = {}): void {
  if ((opts.history ?? true) && next !== text && text) {
    history.push(text);
    if (history.length > 200) history.shift();
    future.length = 0;
  }
  text = next;
  if (!opts.fromCode && code.value !== next) {
    code.value = next;
    renderHighlight();
  }
  persistDraft(next);
  try {
    doc = parseDocument(next);
    registerHandlers(next);
    ui.loadString(next, docBase());
    fillTemplateDemo(ui);
    ui.layout();
    errorBox.style.display = 'none';
    treeError.style.display = 'none';
    showErrorLine(0);
    for (const tag of ui.unknownComponents) {
      if (warnedUnknown.has(tag)) continue;
      warnedUnknown.add(tag);
      log(`<${tag}> 不是內建元件（可能來自第三方套件），預覽以佔位方塊顯示`);
    }
    if (selected && !nodeAt(doc, selected)) selected = null;
    syncSizeFromDoc();
    syncPreview(next);
  } catch (e) {
    const err = e as Error;
    errorBox.textContent = `⚠ ${err.message}`;
    errorBox.dataset.line = err instanceof XmlError ? String(err.line) : '';
    errorBox.style.display = 'block';
    treeError.textContent = `⚠ 原始碼有錯誤（第 ${err instanceof XmlError ? err.line : '?'} 行），點這裡查看`;
    treeError.style.display = 'block';
    showErrorLine(err instanceof XmlError ? err.line : 0);
  }
  renderAll();
}

/**
 * 視覺操作：在最新的結構上修改，再輸出成文字。
 * mutate 回傳新的選取路徑（或 undefined 維持原選取）。
 */
function commit(mutate: (root: XmlNode) => Path | null | void): void {
  if (!doc) {
    log('原始碼有錯誤，請先修正才能使用視覺編輯');
    return;
  }
  const root = parseDocument(text);
  let next: Path | null | void;
  try {
    next = mutate(root);
  } catch (e) {
    log(`⚠ ${(e as Error).message}`);
    return;
  }
  if (next !== undefined) selected = next;
  if (!reformatNoticeShown) {
    reformatNoticeShown = true;
    log('視覺編輯會重新排列原始碼的縮排格式（註解會保留）');
  }
  setText(serialize(root));
}

/** XML 裡用到的事件名稱都接上記錄函式，互動模式下可以測試 */
function registerHandlers(xml: string): void {
  for (const m of xml.matchAll(/\bon(\w+)="([\w$.:-]+)"/g)) {
    const [, event, name] = m;
    if (!ui.handlers[name]) {
      ui.setHandler(name, (e) =>
        log(
          `on${event}="${name}" ← ${e.target.type}${e.target.id ? `#${e.target.id}` : ''}${e.value !== undefined ? ` 值：${JSON.stringify(e.value)}` : ''}${e.item !== undefined ? ` 資料：${JSON.stringify(e.item)}` : ''}`,
        ),
      );
    }
  }
}

// ───────── 元件 ↔ 路徑 ─────────

/** 預覽中的元件對應到的結構路徑（自動產生的元件往上找） */
function pathOfElement(el: UIElement | null): Path | null {
  if (!doc) return null;
  // <UIComponent> 內嵌進來的元件不在這份文件裡：往上找到 UIComponent 本身
  for (let e = el; e; e = e.parent) {
    if (e.line > 0 && !e.includedFrom) {
      const p = pathAtLine(doc, e.line);
      if (p) return p;
    }
  }
  return null;
}

function elementOfPath(path: Path | null): UIElement | null {
  if (!doc || !path || !ui.root) return null;
  const node = nodeAt(doc, path);
  if (!node) return null;
  let found: UIElement | null = null;
  ui.root.walk((el) => {
    if (!found && !el.includedFrom && el.line === node.line) found = el;
  });
  return found;
}

// ───────── 繪製面板 ─────────

function renderAll(): void {
  renderTree();
  renderProps();
  renderSkin();
  refreshOverlays();
  (document.getElementById('undo') as HTMLButtonElement).disabled = history.length === 0;
  (document.getElementById('redo') as HTMLButtonElement).disabled = future.length === 0;
}

function describe(node: XmlNode): string {
  const a = node.attrs;
  if (a.id) return `#${a.id}`;
  if (node.tag === 'UIStyle') return a.name ?? '';
  if (node.tag === 'UISkin') return a.for ? `外觀：${a.for}` : '';
  if (a.text) return `「${a.text}」`;
  if (node.text) return `「${node.text.slice(0, 24)}」`;
  if (a.value) return `= ${a.value}`;
  if (a.src) return node.tag === 'UIComponent' ? `⇢ ${a.src}` : a.src;
  if (a.dir) return a.dir === 'h' ? '水平' : '垂直';
  if (a.type) return a.type;
  return '';
}

function renderTree(): void {
  treeBox.replaceChildren();
  if (!doc) {
    treeBox.innerHTML = '<div class="muted" style="padding:8px 12px">原始碼有錯誤，修正後才會顯示結構</div>';
    return;
  }
  const add = (node: XmlNode, path: Path, depth: number) => {
    if (node.tag === '#comment') return;
    const row = document.createElement('div');
    row.className = `row${samePath(path, selected) ? ' sel' : ''}${node.tag === 'UIStyle' || node.tag === 'UISkin' ? ' style' : ''}`;
    row.style.paddingLeft = `${8 + depth * 14}px`;
    row.innerHTML = '<span class="tag"></span><span class="meta"></span>';
    row.querySelector('.tag')!.textContent = node.tag;
    row.querySelector('.meta')!.textContent = describe(node);
    row.dataset.path = JSON.stringify(path);
    row.draggable = path.length > 0;
    row.addEventListener('click', () => select(path));
    row.addEventListener('pointerenter', () => showTreeHover(node, path));
    row.addEventListener('pointerleave', () => showTreeHover(null, null));
    row.addEventListener('dragstart', (e) => {
      e.dataTransfer!.setData('application/x-ui2d', JSON.stringify({ kind: 'move', path }));
      e.dataTransfer!.effectAllowed = 'move';
    });
    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      clearDropMarks();
      row.classList.add(`drop-${dropZone(row, e, node, path)}`);
    });
    row.addEventListener('dragleave', () => clearDropMarks());
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      clearDropMarks();
      const data = readDrag(e);
      if (!data) return;
      const zone = dropZone(row, e, node, path);
      const parent = zone === 'inside' ? path : parentPath(path);
      const index = zone === 'inside' ? node.children.length : path[path.length - 1] + (zone === 'after' ? 1 : 0);
      if (data.kind === 'new') commit((root) => insertNode(root, parent, index, paletteNode(data.xml)));
      else commit((root) => moveNode(root, data.path, parent, index));
    });
    treeBox.appendChild(row);
    node.children.forEach((c, i) => add(c, [...path, i], depth + 1));
  };
  add(doc, [], 0);
  // 重建後滑鼠可能還停在某一列上：重新對應提示框
  const hovered = treeBox.querySelector<HTMLElement>('.row:hover');
  if (hovered && doc) {
    const path = JSON.parse(hovered.dataset.path!) as Path;
    showTreeHover(nodeAt(doc, path) ?? null, path);
  } else showTreeHover(null, null);
}

/** 元件本身或任何上層被隱藏 → 回傳最近的可見上層（自己可見則回傳 null） */
function hiddenBy(el: UIElement): { visibleAncestor: UIElement | null } | null {
  let hidden = false;
  for (let e: UIElement | null = el; e; e = e.parent) if (!e.visible) hidden = true;
  if (!hidden) return null;
  let a = el.parent;
  while (a) {
    let ok = true;
    for (let e: UIElement | null = a; e; e = e.parent) if (!e.visible) ok = false;
    if (ok) return { visibleAncestor: a };
    a = a.parent;
  }
  return { visibleAncestor: null };
}

/** 左側結構滑過某一列：在預覽區框出對應的元件並標上名稱與尺寸 */
function showTreeHover(node: XmlNode | null, path: Path | null): void {
  const el = node && path ? elementOfPath(path) : null;
  if (!node || !el) {
    treeHoverBox.style.display = 'none';
    return;
  }
  const hidden = hiddenBy(el);
  const target = hidden ? hidden.visibleAncestor : el;
  if (!target) {
    treeHoverBox.style.display = 'none';
    return;
  }
  const r = target.absoluteRect;
  Object.assign(treeHoverBox.style, {
    display: 'block',
    left: `${r.x}px`,
    top: `${r.y}px`,
    width: `${r.width}px`,
    height: `${r.height}px`,
  });
  treeHoverBox.classList.toggle('hidden-el', !!hidden);
  // 標籤預設在框的上方；太靠近上緣就放下方；上下都放不下（例如框住整個畫面）就放在框內左上角
  const tipH = 22 / (frame.getBoundingClientRect().width / frame.offsetWidth || 1);
  const above = r.y >= tipH;
  const below = !above && r.y + r.height + tipH <= ui.size.height;
  treeHoverBox.classList.toggle('below', below);
  treeHoverBox.classList.toggle('inside', !above && !below);
  const tip = treeHoverBox.querySelector<HTMLElement>('.tip')!;
  const name = `${node.tag}${node.attrs.id ? ` #${node.attrs.id}` : ''}`;
  tip.innerHTML = '<span class="name"></span><span class="size"></span>';
  tip.querySelector('.name')!.textContent = hidden ? `${name}（隱藏中）` : name;
  const own = el.absoluteRect;
  tip.querySelector('.size')!.textContent = hidden ? '' : `${Math.round(own.width)} × ${Math.round(own.height)}`;
}

/** 預覽區滑過元件時，左側結構對應的那一列也標示出來 */
function highlightRow(el: UIElement | null): void {
  treeBox.querySelector('.row.hl')?.classList.remove('hl');
  const path = el ? pathOfElement(el) : null;
  if (!path) return;
  const key = JSON.stringify(path);
  for (const row of treeBox.querySelectorAll<HTMLElement>('.row')) {
    if (row.dataset.path === key) {
      row.classList.add('hl');
      break;
    }
  }
}

function dropZone(row: HTMLElement, e: DragEvent, node: XmlNode, path: Path): 'before' | 'after' | 'inside' {
  const r = row.getBoundingClientRect();
  const y = (e.clientY - r.top) / r.height;
  if (path.length === 0) return 'inside';
  if (isContainer(node) && y > 0.25 && y < 0.75) return 'inside';
  return y < 0.5 ? 'before' : 'after';
}

function clearDropMarks(): void {
  for (const el of treeBox.querySelectorAll('.drop-before, .drop-after, .drop-inside')) {
    el.classList.remove('drop-before', 'drop-after', 'drop-inside');
  }
}

type DragData = { kind: 'new'; xml: string } | { kind: 'move'; path: Path };
function readDrag(e: DragEvent): DragData | null {
  try {
    return JSON.parse(e.dataTransfer!.getData('application/x-ui2d')) as DragData;
  } catch {
    return null;
  }
}

/** 元件面板 */
function renderPalette(): void {
  let group = '';
  for (const item of PALETTE) {
    if (item.group !== group) {
      group = item.group;
      const head = document.createElement('div');
      head.className = 'pal-group';
      head.textContent = group;
      paletteBox.appendChild(head);
    }
    const wrap = document.createElement('div');
    wrap.className = 'pal-item';
    const b = document.createElement('button');
    b.className = 'pal-main';
    b.innerHTML = '<span class="pal-name"></span><span class="pal-tag"></span>';
    b.querySelector('.pal-name')!.textContent = item.label;
    b.querySelector('.pal-tag')!.textContent = item.tag;
    b.setAttribute('aria-label', `${item.label} ${item.tag}`);
    b.draggable = true;
    b.addEventListener('pointerenter', () => showPaletteTip(b, item));
    b.addEventListener('pointerleave', hidePaletteTip);
    b.addEventListener('click', () => {
      hidePaletteTip();
      if (!doc) return;
      const { parent, index } = insertionPoint(doc, selected);
      commit((root) => insertNode(root, parent, index, paletteNode(item.xml)));
    });
    b.addEventListener('dragstart', (e) => {
      hidePaletteTip();
      e.dataTransfer!.setData('application/x-ui2d', JSON.stringify({ kind: 'new', xml: item.xml }));
      e.dataTransfer!.effectAllowed = 'copy';
    });
    // 右側的預覽鈕：彈出視窗實際運行這個元件
    const play = document.createElement('button');
    play.className = 'pal-play';
    play.textContent = '▶';
    play.title = `預覽「${item.label}」的實際運作`;
    play.setAttribute('aria-label', `預覽 ${item.label}`);
    play.addEventListener('click', (e) => {
      e.stopPropagation();
      hidePaletteTip();
      void openComponentPreview(item);
    });
    wrap.append(b, play);
    paletteBox.appendChild(wrap);
  }
}

// ───────── 元件預覽：彈出視窗實際運行元件（可以互動、有示範動畫） ─────────

const compWin = $<HTMLDivElement>('compPreview');
const compStage = $<HTMLDivElement>('cpStage');
const compLog = $<HTMLDivElement>('cpLog');
let compUI: UI2D | null = null;
let compCleanup: (() => void) | null = null;
let compItem: (typeof PALETTE)[number] | null = null;

/** 目前文件的 <UIStyle>、<UISkin>：預覽時一起帶入，外觀和編輯中的介面一致 */
function documentStyles(): string {
  if (!doc) return '';
  const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return doc.children
    .filter((c) => c.tag === 'UIStyle' || c.tag === 'UISkin')
    .map(
      (c) =>
        `<${c.tag}${Object.entries(c.attrs)
          .map(([k, v]) => ` ${k}="${esc(v)}"`)
          .join('')}/>`,
    )
    .join('');
}

function compLogLine(message: string): void {
  compLog.querySelector('.muted')?.remove();
  const last = compLog.firstElementChild as HTMLElement | null;
  if (last && last.dataset.text === message) {
    const n = Number(last.dataset.count ?? '1') + 1;
    last.dataset.count = String(n);
    last.querySelector('.n')!.textContent = `×${n}`;
    return;
  }
  const el = document.createElement('span');
  el.className = 'ev';
  el.dataset.text = message;
  el.innerHTML = '<span class="t"></span><span class="n"></span>';
  el.querySelector('.t')!.textContent = message;
  compLog.prepend(el);
  while (compLog.children.length > 6) compLog.lastElementChild!.remove();
}

async function openComponentPreview(item: (typeof PALETTE)[number]): Promise<void> {
  closeComponentPreview();
  compItem = item;
  const demo = COMPONENT_DEMOS[item.label] ?? {};
  $('cpName').textContent = item.label;
  $('cpTag').textContent = `<${item.tag}>`;
  $('cpDesc').textContent = item.desc;
  $('cpHint').textContent = demo.hint ?? '可以直接操作；觸發的事件會顯示在下方';
  compLog.innerHTML = '<span class="muted">觸發的事件（onClick、onChange…）會顯示在這裡</span>';
  const xml = demo.xml ?? item.xml;
  $('cpCode').innerHTML = highlightXml(xml.replace(/\s*\n\s*/g, ' '));
  compWin.classList.add('open');
  compStage.replaceChildren();
  const ui = await UI2D.create({ container: compStage, unknownTags: 'placeholder' });
  if (compItem !== item || !compWin.classList.contains('open')) {
    ui.destroy();
    return;
  }
  compUI = ui;
  // 沒有接遊戲程式：所有事件都記錄下來
  Object.setPrototypeOf(
    ui.handlers,
    new Proxy(
      {},
      {
        get: (_t, name) =>
          typeof name === 'string'
            ? (e: { type: string; target: UIElement; value?: unknown }) =>
                compLogLine(
                  `${name} ← ${e.target.type}${e.target.id ? `#${e.target.id}` : ''}${e.value !== undefined && typeof e.value !== 'object' ? `　值：${String(e.value)}` : ''}`,
                )
            : undefined,
        has: () => true,
      },
    ),
  );
  const align = demo.wide ? 'stretch' : 'center';
  try {
    ui.loadString(`<UI padding="28" align="${align}" justify="center" gap="12">${documentStyles()}${xml}</UI>`, 'ui/');
    // 樣板列表放示範資料
    ui.root?.walk((el) => {
      if (el instanceof UIList && el.template && el.id && el.children.length === 0) {
        ui.setItems(
          el.id,
          Array.from({ length: 6 }, (_, i) => ({ label: `項目 ${i + 1}` })),
        );
      }
    });
  } catch (error) {
    compLogLine(`⚠ ${(error as Error).message}`);
    return;
  }
  compCleanup = demo.run?.(ui, compLogLine) ?? null;
}

function closeComponentPreview(): void {
  compCleanup?.();
  compCleanup = null;
  compUI?.destroy();
  compUI = null;
  compStage.replaceChildren();
  compWin.classList.remove('open');
}

$('cpClose').addEventListener('click', closeComponentPreview);
$('cpReplay').addEventListener('click', () => compItem && void openComponentPreview(compItem));
$('cpInsert').addEventListener('click', () => {
  const item = compItem;
  closeComponentPreview();
  if (!item || !doc) return;
  const { parent, index } = insertionPoint(doc, selected);
  commit((root) => insertNode(root, parent, index, paletteNode(item.xml)));
});
compWin.addEventListener('pointerdown', (e) => {
  if (e.target === compWin) closeComponentPreview(); // 點背景關閉
});
// 預覽開著時：Esc 關閉，其他編輯器快捷鍵不作用
window.addEventListener(
  'keydown',
  (e) => {
    if (!compWin.classList.contains('open')) return;
    e.stopImmediatePropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      closeComponentPreview();
    }
  },
  true,
);

/** 元件庫的說明卡：滑鼠移到按鈕上時，顯示在元件庫左邊 */
const paletteTip = $<HTMLDivElement>('palTip');
function showPaletteTip(button: HTMLElement, item: (typeof PALETTE)[number]): void {
  paletteTip.innerHTML =
    '<div class="pt-head"><span class="pt-name"></span><span class="pt-tag"></span></div><div class="pt-desc"></div><pre class="pt-code"></pre><div class="pt-hint">點一下新增，或拖到結構、預覽上</div>';
  paletteTip.querySelector('.pt-name')!.textContent = item.label;
  paletteTip.querySelector('.pt-tag')!.textContent = `<${item.tag}>`;
  paletteTip.querySelector('.pt-desc')!.textContent = item.desc;
  paletteTip.querySelector('.pt-code')!.innerHTML = highlightXml(
    item.xml.length > 160 ? `${item.xml.slice(0, 157)}…` : item.xml,
  );
  paletteTip.classList.add('open');
  const r = button.getBoundingClientRect();
  const w = paletteTip.offsetWidth;
  const h = paletteTip.offsetHeight;
  const left = r.left - w - 12 >= 8 ? r.left - w - 12 : Math.min(window.innerWidth - w - 8, r.right + 12);
  const top = Math.max(8, Math.min(window.innerHeight - h - 8, r.top + r.height / 2 - h / 2));
  Object.assign(paletteTip.style, { left: `${left}px`, top: `${top}px` });
}
function hidePaletteTip(): void {
  paletteTip.classList.remove('open');
}

// ───────── 外觀（skin）：每種元件的預設外觀，寫成 XML 裡的 <UISkin for="…"> ─────────

const skinBox = $<HTMLDivElement>('skin');
const skinSelect = $<HTMLSelectElement>('skinTarget');
const skinFollow = $<HTMLInputElement>('skinFollow');
let skinTarget = 'UIButton';

/** 不算外觀的屬性（行為、資料、位置） */
const SKIN_EXCLUDE = new Set([
  'dir',
  'position',
  'left',
  'top',
  'right',
  'bottom',
  'min',
  'max',
  'step',
  'value',
  'type',
  'name',
  'placement',
  'range',
  'grid',
  'count',
  'speed',
  'columns',
  'scroll',
  'transition',
  'duration',
  'indicator',
  'loop',
  'swipe',
  'sortable',
  'selectable',
  'autoplay',
  'closable',
  'draggable',
  'deadzone',
  'knobSize',
  'textFormat',
  'animate',
  'emptyText',
  'dot',
  'showText',
  'showValue',
  'showPlayer',
  'rotate',
  'shape',
  'vertical',
  'orientation',
  'fit',
  'maxItems',
  'cursor',
  'striped',
  'self',
  'wrap',
  'grow',
  'shrink',
  'basis',
  'flex',
  'align',
  'justify',
  'textAlign',
  'minWidth',
  'minHeight',
  'max',
  'switchWidth',
  'boxSize',
  'lineHeight',
  'fontFamily',
]);
const SKIN_EXTRA = [
  'background',
  'hoverBackground',
  'bgImage',
  'bgFit',
  'bgSlice',
  'hoverBgImage',
  'pressedBgImage',
  'border',
  'radius',
  'shadow',
  'color',
  'fontSize',
  'fontWeight',
  'opacity',
  'padding',
];
const skinDefaultsCache = new Map<string, Attrs>();

function componentDefaults(tag: string): Attrs {
  let d = skinDefaultsCache.get(tag);
  if (!d) {
    try {
      const el = ui.createElement(tag);
      d = el.defaults();
      el.destroy();
    } catch {
      d = {};
    }
    skinDefaultsCache.set(tag, d);
  }
  return d;
}

function skinAttrNames(tag: string): string[] {
  const names = [...Object.keys(componentDefaults(tag)), ...SKIN_EXTRA].filter(
    (n) => !SKIN_EXCLUDE.has(n) && !n.includes(':'),
  );
  return [...new Set(names)];
}

function skinNodeOf(root: XmlNode, tag: string): XmlNode | undefined {
  return root.children.find((c) => c.tag === 'UISkin' && c.attrs.for === tag);
}

/** 修改外觀（value 為 null 時移除該屬性；沒有屬性的 <UISkin> 會刪掉） */
function setSkinAttr(tag: string, name: string, value: string | null): void {
  commit((root) => {
    let node = skinNodeOf(root, tag);
    if (!node) {
      if (value === null) return;
      node = { tag: 'UISkin', attrs: { for: tag }, children: [], text: '', line: 0 };
      // 放在 <UIStyle>／<UISkin> 後面（介面最上方）
      let i = 0;
      root.children.forEach((c, k) => {
        if (c.tag === 'UIStyle' || c.tag === 'UISkin') i = k + 1;
      });
      root.children.splice(i, 0, node);
      if (selected && selected.length > 0 && selected[0] >= i) selected = [selected[0] + 1, ...selected.slice(1)];
    }
    if (value === null || value === '') delete node.attrs[name];
    else node.attrs[name] = value;
    if (Object.keys(node.attrs).length <= 1) {
      const k = root.children.indexOf(node);
      root.children.splice(k, 1);
      if (selected && selected.length > 0 && selected[0] > k) selected = [selected[0] - 1, ...selected.slice(1)];
    }
  });
}

/** 顏色：#rgb、#rrggbb、rgb()、rgba() → #rrggbb（顏色選擇器用） */
function toHex(v: string | undefined): string | null {
  if (!v) return null;
  const s = v.trim();
  let m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) return `#${[...m[1]].map((c) => c + c).join('')}`.toLowerCase();
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(s);
  if (m) return `#${m[1]}`.toLowerCase();
  const r = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(s);
  if (r)
    return `#${r
      .slice(1, 4)
      .map((n) => Math.min(255, +n).toString(16).padStart(2, '0'))
      .join('')}`;
  return null;
}

/** 選了新顏色：原本是 rgba 時保留透明度 */
function withColor(old: string | undefined, hex: string): string {
  const a = old && /^rgba\([^)]*,\s*([\d.]+)\s*\)$/i.exec(old.trim());
  if (!a) return hex;
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a[1]})`;
}

const isColorAttr = (name: string) => /color|background|accent|fill$/i.test(name) && !/^border$/.test(name);

function renderSkin(): void {
  // 跟隨選取：選到哪種元件就編輯哪種的外觀
  if (skinFollow.checked && doc && selected) {
    const node = nodeAt(doc, selected);
    if (node && UI2D.components.has(node.tag)) skinTarget = node.tag;
  }
  const docSkins = new Set(doc ? doc.children.filter((c) => c.tag === 'UISkin').map((c) => c.attrs.for) : []);
  skinSelect.replaceChildren();
  for (const tag of [...UI2D.components.keys()].sort()) {
    const o = document.createElement('option');
    o.value = tag;
    o.textContent = `${docSkins.has(tag) ? '● ' : ''}${tag}`;
    skinSelect.appendChild(o);
  }
  skinSelect.value = skinTarget;

  skinBox.replaceChildren();
  const tag = skinTarget;
  let count = 0;
  ui.root?.walk((el) => {
    if (el.type === tag && el.line > 0) count++;
  });
  const info = document.createElement('div');
  info.className = 'skin-info';
  info.textContent = count
    ? `修改會套用到這份介面的全部 ${count} 個 <${tag}>（個別元件自己設定的屬性優先）`
    : `目前介面沒有 <${tag}>；設定後新加入的會套用`;
  skinBox.appendChild(info);

  const skinNode = doc ? skinNodeOf(doc, tag) : undefined;
  const defaults = componentDefaults(tag);
  const table = document.createElement('table');
  table.innerHTML = '<colgroup><col class="c-name"><col><col style="width:24px"></colgroup>';
  for (const name of skinAttrNames(tag)) {
    const value = skinNode?.attrs[name];
    const tr = table.insertRow();
    tr.className = value !== undefined ? 'set' : '';
    const nameCell = tr.insertCell();
    nameCell.className = 'name';
    nameCell.textContent = name;
    const cell = document.createElement('div');
    cell.className = 'val';
    tr.insertCell().appendChild(cell);
    if (isColorAttr(name)) {
      const pick = document.createElement('input');
      pick.type = 'color';
      pick.className = 'swatch';
      pick.value = toHex(value ?? defaults[name]) ?? '#000000';
      pick.title = '選擇顏色';
      pick.addEventListener('change', () => setSkinAttr(tag, name, withColor(value ?? defaults[name], pick.value)));
      cell.appendChild(pick);
    }
    const input = document.createElement('input');
    input.value = value ?? '';
    input.placeholder = defaults[name] ?? '';
    input.addEventListener('change', () => setSkinAttr(tag, name, input.value.trim() || null));
    input.addEventListener('keydown', (e) => e.key === 'Enter' && input.blur());
    cell.appendChild(input);
    const reset = tr.insertCell();
    reset.className = 'reset';
    if (value !== undefined) {
      const b = document.createElement('button');
      b.textContent = '↺';
      b.title = '還原預設';
      b.addEventListener('click', () => setSkinAttr(tag, name, null));
      reset.appendChild(b);
    }
  }
  skinBox.appendChild(table);
  if (skinNode) {
    const clear = document.createElement('button');
    clear.className = 'skin-clear';
    clear.textContent = `清除 <${tag}> 的全部外觀`;
    clear.addEventListener('click', () => {
      for (const name of Object.keys(skinNode.attrs)) if (name !== 'for') setSkinAttr(tag, name, null);
    });
    skinBox.appendChild(clear);
  }
}

skinSelect.addEventListener('change', () => {
  skinTarget = skinSelect.value;
  skinFollow.checked = false;
  renderSkin();
});
skinFollow.addEventListener('change', () => renderSkin());

/** 屬性面板 */
/** <UIComponent> 的寬高由外部檔案的 <UI width height> 決定：屬性面板不顯示、不能拖曳調整 */
const SIZE_ATTRS = new Set(['width', 'height']);
const sizeLocked = (tag: string | undefined) => tag === 'UIComponent';

function renderProps(): void {
  propsBox.replaceChildren();
  const node = doc && selected ? nodeAt(doc, selected) : null;
  if (!node || !selected) {
    propsBox.innerHTML = '<div class="muted">在結構或預覽中選取元件</div>';
    return;
  }
  const path = selected;
  const isRoot = path.length === 0;

  const title = document.createElement('div');
  title.className = 'title';
  title.innerHTML = '<strong></strong><span class="muted"></span>';
  title.querySelector('strong')!.textContent = `<${node.tag}>`;
  title.querySelector('.muted')!.textContent = node.line ? `第 ${node.line} 行` : '';
  propsBox.appendChild(title);

  const actions = document.createElement('div');
  actions.className = 'actions';
  const action = (label: string, fn: () => void, disabled = false) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.disabled = disabled;
    b.addEventListener('click', fn);
    actions.appendChild(b);
  };
  action('↑ 上移', () => commit((root) => shiftNode(root, path, -1)), isRoot);
  action('↓ 下移', () => commit((root) => shiftNode(root, path, 1)), isRoot);
  action('複製', () => commit((root) => duplicateNode(root, path)), isRoot);
  action(
    '刪除',
    () =>
      commit((root) => {
        removeNode(root, path);
        return null;
      }),
    isRoot,
  );
  action('看原始碼', () => showInCode(node.line));
  propsBox.appendChild(actions);

  // 背景圖片：九宮格編輯器（bgSlice、bgSliceWidth）
  {
    const live = elementOfPath(path);
    const pick = (name: string) =>
      node.attrs[(editBp ? `${editBp}:` : '') + name] ?? live?.attrs[name] ?? node.attrs[name];
    const bg = pick('bgImage');
    if (bg) {
      const slice = pick('bgSlice');
      const row = document.createElement('div');
      row.className = 'slice-row';
      row.innerHTML =
        '<span>背景</span><code></code><span class="state"></span><button title="拖曳線條切出九宮格：四角不變形、邊與中間延伸">⊞ 九宮格…</button>';
      row.querySelector('code')!.textContent = bg;
      const state = row.querySelector<HTMLSpanElement>('.state')!;
      state.textContent = slice ? `九宮格 ${slice}` : '未切割';
      state.classList.toggle('on', !!slice);
      row.querySelector('button')!.addEventListener('click', () =>
        openSliceEditor({
          imageUrl: /^([a-z][a-z\d+.-]*:|\/)/i.test(bg) ? bg : `ui/${bg.replace(/^\.\//, '')}`,
          imageName: bg,
          slice,
          sliceWidth: pick('bgSliceWidth'),
          onApply: (nextSlice, nextWidth) => {
            const prefix = editBp ? `${editBp}:` : '';
            commit((r) => {
              const n = nodeAt(r, path)!;
              if (nextSlice === null) delete n.attrs[`${prefix}bgSlice`];
              else n.attrs[`${prefix}bgSlice`] = nextSlice;
              if (nextWidth === null) delete n.attrs[`${prefix}bgSliceWidth`];
              else n.attrs[`${prefix}bgSliceWidth`] = nextWidth;
            });
            log(
              nextSlice === null
                ? `已清除 ${node.tag} 的九宮格`
                : `已設定 ${node.tag} 的 ${prefix}bgSlice="${nextSlice}"${nextWidth ? `、bgSliceWidth="${nextWidth}"` : ''}`,
            );
          },
        }),
      );
      propsBox.appendChild(row);
    }
  }

  // 文字內容
  if (node.tag === 'UILabel' || (node.text && node.children.length === 0)) {
    const ta = document.createElement('textarea');
    ta.value = node.text;
    ta.placeholder = '文字內容';
    ta.addEventListener('change', () =>
      commit((root) => {
        nodeAt(root, path)!.text = ta.value.trim();
      }),
    );
    propsBox.appendChild(ta);
  }

  // 斷點切換：編輯 md:width 這類 RWD 屬性
  const bps = document.createElement('div');
  bps.className = 'group bps';
  for (const bp of BREAKPOINTS) {
    const b = document.createElement('button');
    b.textContent = bp || '基本';
    b.title = bp ? `螢幕寬度 ≥ ${ui.breakpoints[bp]} 時套用（屬性名稱會加上 ${bp}:）` : '所有尺寸';
    b.classList.toggle('on', bp === editBp);
    b.addEventListener('click', () => {
      editBp = bp;
      renderProps();
    });
    bps.appendChild(b);
  }
  propsBox.appendChild(bps);

  const prefix = editBp ? `${editBp}:` : '';
  const keyOf = (name: string) => prefix + name;
  const table = document.createElement('table');
  const locked = sizeLocked(node.tag);
  const all = Object.entries(node.attrs).filter(([k]) => (prefix ? k.startsWith(prefix) : !k.includes(':')));
  const entries = locked ? all.filter(([k]) => !SIZE_ATTRS.has(k.slice(prefix.length))) : all;
  const ignored = all.filter((e) => !entries.includes(e));
  for (const [key, value] of entries) {
    const name = key.slice(prefix.length);
    const tr = table.insertRow();
    tr.insertCell().textContent = name;
    tr.cells[0].className = 'name';
    const input = valueInput(name, value);
    input.addEventListener('change', () => setAttr(path, key, input.value));
    tr.insertCell().appendChild(input);
    const del = document.createElement('button');
    del.textContent = '×';
    del.title = '刪除屬性';
    del.addEventListener('click', () => setAttr(path, key, null));
    const td = tr.insertCell();
    td.className = 'del';
    td.appendChild(del);
  }
  if (entries.length === 0) {
    const tr = table.insertRow();
    const td = tr.insertCell();
    td.className = 'muted';
    td.textContent = prefix ? `沒有 ${editBp}: 屬性` : '沒有屬性';
  }
  propsBox.appendChild(table);
  if (locked) {
    const note = document.createElement('div');
    note.className = 'muted size-note';
    note.textContent = '寬高由外部檔案的 <UI width height> 決定（要改大小請打開那個檔案）';
    if (ignored.length > 0) {
      note.textContent += `；這裡寫的 ${ignored.map(([k]) => k).join('、')} 會被忽略，`;
      const clean = document.createElement('button');
      clean.textContent = '刪除';
      clean.addEventListener('click', () =>
        commit((root) => {
          const n = nodeAt(root, path)!;
          for (const [k] of ignored) delete n.attrs[k];
        }),
      );
      note.appendChild(clean);
    }
    propsBox.appendChild(note);
  }

  // 新增屬性
  const add = document.createElement('div');
  add.className = 'add';
  const nameInput = document.createElement('input');
  nameInput.placeholder = '屬性';
  nameInput.setAttribute('list', 'attr-hints');
  const valueIn = document.createElement('input');
  valueIn.placeholder = '值';
  const addBtn = document.createElement('button');
  addBtn.textContent = '新增';
  const doAdd = () => {
    const name = nameInput.value.trim();
    if (!name) return;
    if (locked && SIZE_ATTRS.has(name)) {
      log(`<UIComponent> 不能設定 ${name}：請在外部檔案的 <UI ${name}="…"> 設定`);
      return;
    }
    setAttr(path, keyOf(name), valueIn.value);
  };
  addBtn.addEventListener('click', doAdd);
  valueIn.addEventListener('keydown', (e) => e.key === 'Enter' && doAdd());
  nameInput.addEventListener('input', () => valueIn.setAttribute('list', `values-${nameInput.value}`));
  add.append(nameInput, valueIn, addBtn);
  propsBox.appendChild(add);
  const hints = document.createElement('datalist');
  hints.id = 'attr-hints';
  for (const h of [...(ATTRIBUTE_HINTS[node.tag] ?? []), ...ATTRIBUTE_HINTS.common]) {
    if (locked && SIZE_ATTRS.has(h)) continue;
    if (!node.attrs[keyOf(h)]) hints.appendChild(new Option(h));
  }
  propsBox.appendChild(hints);
  for (const [name, values] of Object.entries(VALUE_HINTS)) {
    const dl = document.createElement('datalist');
    dl.id = `values-${name}`;
    for (const v of values) dl.appendChild(new Option(v));
    propsBox.appendChild(dl);
  }

  // 排版結果
  const el = elementOfPath(path);
  if (el) {
    const r = el.absoluteRect;
    const rect = document.createElement('div');
    rect.className = 'rect';
    rect.textContent =
      `排版結果：x ${round(r.x)}, y ${round(r.y)}, ${round(r.width)} × ${round(r.height)}` +
      (el instanceof UILabel ? `\n換行：${el.metrics.lines.length} 行` : '');
    propsBox.appendChild(rect);
  }
}

function valueInput(name: string, value: string): HTMLInputElement {
  const input = document.createElement('input');
  input.value = value;
  if (VALUE_HINTS[name]) input.setAttribute('list', `values-${name}`);
  input.addEventListener('keydown', (e) => e.key === 'Enter' && input.blur());
  return input;
}

function setAttr(path: Path, key: string, value: string | null): void {
  commit((root) => {
    const node = nodeAt(root, path)!;
    if (value === null) delete node.attrs[key];
    else node.attrs[key] = value;
  });
}

const round = (n: number) => Math.round(n * 10) / 10;

/**
 * 拖曳時要修改的屬性名稱：目前畫面上實際生效的那一個。
 * 有指定編輯斷點就用它；否則找目前生效、最大的斷點裡已經寫了這個屬性的（例如 md:width），
 * 都沒有才改基本屬性。避免改了 width 卻被 md:width 蓋掉、畫面沒有變化。
 */
function effectiveKey(node: XmlNode, name: string): string {
  if (editBp) return `${editBp}:${name}`;
  for (const bp of [...ui.breakpoint].reverse()) {
    if (node.attrs[`${bp}:${name}`] !== undefined) return `${bp}:${name}`;
  }
  return name;
}

function select(path: Path | null): void {
  selected = path;
  renderTree();
  renderProps();
  renderSkin();
  renderAssetDetail();
  refreshOverlays();
  // 讓選取的那一列出現在畫面中
  treeBox.querySelector('.row.sel')?.scrollIntoView({ block: 'nearest' });
}

function showInCode(line: number): void {
  openCodeWindow(true);
  const lines = code.value.split('\n');
  const start = lines.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0);
  code.focus();
  code.setSelectionRange(start, start + (lines[line - 1]?.length ?? 0));
  const lh = parseFloat(getComputedStyle(code).lineHeight) || 20;
  code.scrollTop = Math.max(0, (line - 5) * lh);
}

// ───────── 預覽：框線、選取、拖曳、調整大小 ─────────

function place(box: HTMLElement, el: UIElement | null): void {
  if (!el?.visible) {
    box.style.display = 'none';
    return;
  }
  const r = el.absoluteRect;
  Object.assign(box.style, {
    display: 'block',
    left: `${r.x}px`,
    top: `${r.y}px`,
    width: `${r.width}px`,
    height: `${r.height}px`,
  });
}

function refreshOverlays(): void {
  outlinesLayer.replaceChildren();
  if (showOutlines && ui.root) {
    ui.root.walk((el) => {
      if (el === ui.root || !el.visible) return;
      const box = document.createElement('div');
      box.className = 'box';
      place(box, el);
      outlinesLayer.appendChild(box);
    });
  }
  const el = mode === 'design' ? elementOfPath(selected) : null;
  place(selectedBox, el);
  // 根元件、<UIComponent>（寬高由外部檔案決定）不能調整大小
  const resizable = !!selected && selected.length > 0 && !sizeLocked(doc ? nodeAt(doc, selected)?.tag : undefined);
  for (const h of selectedBox.querySelectorAll<HTMLElement>('.handle')) h.style.display = resizable ? 'block' : 'none';
  const bps = ui.breakpoint;
  const bpText = `${ui.size.width}×${ui.size.height}　斷點：${bps.length ? bps.join(' › ') : '（無，手機）'}`;
  if (bpLabel.textContent !== bpText) {
    bpLabel.textContent = bpText;
    if (bpLabel.isConnected) requestAnimationFrame(() => fitToolbar()); // 文字長度變了，重新分配工具列
  }
}

/** 包含該點、最深層的元件 */
function hitTest(x: number, y: number): UIElement | null {
  let found: UIElement | null = null;
  ui.root?.walk((el) => {
    if (!el.visible) return;
    const r = el.absoluteRect;
    if (x >= r.x && y >= r.y && x <= r.x + r.width && y <= r.y + r.height) found = el;
  });
  return found;
}

function framePoint(e: { clientX: number; clientY: number }): { x: number; y: number } {
  const rect = frame.getBoundingClientRect();
  const scale = rect.width / frame.offsetWidth;
  return { x: (e.clientX - rect.left) / scale, y: (e.clientY - rect.top) / scale };
}

/** 父元件的主軸是否為水平 */
function isRowParent(parent: UIElement): boolean {
  if (parent instanceof UIList) return parent.listType !== 'vertical';
  return parent.get('dir') === 'h' || parent.get('dir') === 'row';
}

/** 依滑鼠位置算出在兄弟之間的插入位置（回傳結構中的索引與指示線位置） */
function siblingDrop(
  el: UIElement,
  p: { x: number; y: number },
): { index: number; line: { x: number; y: number; w: number; h: number } } | null {
  const parent = el.parent;
  if (!parent || !doc) return null;
  const parentPathValue = pathOfElement(parent);
  if (!parentPathValue) return null;
  const parentNode = nodeAt(doc, parentPathValue)!;
  // 和結構對應的兄弟（略過自動產生的元件）
  const siblings = parent.children.filter((c) => c.line > 0 && c !== el && c.visible);
  const row = isRowParent(parent);
  let i = 0;
  for (const s of siblings) {
    const r = s.absoluteRect;
    const center = row ? r.x + r.width / 2 : r.y + r.height / 2;
    if ((row ? p.x : p.y) > center) i++;
  }
  const xmlIndexOf = (s: UIElement) => {
    const sp = pathOfElement(s);
    return sp ? sp[sp.length - 1] : parentNode.children.length;
  };
  const index =
    i < siblings.length ? xmlIndexOf(siblings[i]) : siblings.length ? xmlIndexOf(siblings[siblings.length - 1]) + 1 : 0;
  const pr = parent.absoluteRect;
  let line: { x: number; y: number; w: number; h: number };
  if (i < siblings.length) {
    const r = siblings[i].absoluteRect;
    line = row ? { x: r.x - 2, y: r.y, w: 3, h: r.height } : { x: r.x, y: r.y - 2, w: r.width, h: 3 };
  } else if (siblings.length) {
    const r = siblings[siblings.length - 1].absoluteRect;
    line = row ? { x: r.x + r.width, y: r.y, w: 3, h: r.height } : { x: r.x, y: r.y + r.height, w: r.width, h: 3 };
  } else {
    line = { x: pr.x, y: pr.y, w: row ? 3 : pr.width, h: row ? pr.height : 3 };
  }
  return { index, line };
}

function showDropLine(l: { x: number; y: number; w: number; h: number } | null): void {
  if (!l) {
    dropLine.style.display = 'none';
    return;
  }
  Object.assign(dropLine.style, {
    display: 'block',
    left: `${l.x}px`,
    top: `${l.y}px`,
    width: `${l.w}px`,
    height: `${l.h}px`,
  });
}

overlay.addEventListener('pointermove', (e) => {
  if (drag) return;
  const p = framePoint(e);
  const el = hitTest(p.x, p.y);
  place(hoverBox, el);
  highlightRow(el);
});
overlay.addEventListener('pointerleave', () => {
  if (drag) return;
  place(hoverBox, null);
  highlightRow(null);
});

// 拖曳：移動元件（絕對定位改 left/top；一般元件在兄弟之間換位置）
let drag: null | {
  kind: 'move' | 'resize';
  dir?: string;
  el: UIElement;
  path: Path;
  start: { x: number; y: number };
  startRect: { x: number; y: number; w: number; h: number };
  startPos?: { left: number; top: number };
  moved: boolean;
  dropIndex?: number;
  values?: Record<string, string>;
} = null;

overlay.addEventListener('pointerdown', (e) => {
  if (mode !== 'design') return;
  const p = framePoint(e);
  const el = hitTest(p.x, p.y);
  const path = pathOfElement(el);
  select(path);
  if (!el || !path || path.length === 0) return;
  const target = elementOfPath(path)!;
  const r = target.absoluteRect;
  drag = {
    kind: 'move',
    el: target,
    path,
    start: p,
    moved: false,
    startRect: { x: r.x, y: r.y, w: r.width, h: r.height },
    startPos: { left: target.layout.x, top: target.layout.y },
  };
  overlay.setPointerCapture(e.pointerId);
});

for (const handle of selectedBox.querySelectorAll<HTMLElement>('.handle')) {
  handle.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    const el = elementOfPath(selected);
    if (!el || !selected) return;
    const r = el.absoluteRect;
    drag = {
      kind: 'resize',
      dir: handle.dataset.dir,
      el,
      path: selected,
      start: framePoint(e),
      moved: false,
      startRect: { x: r.x, y: r.y, w: r.width, h: r.height },
    };
    handle.setPointerCapture(e.pointerId);
  });
  // 只註冊一次（拖曳狀態由 drag 判斷）
  handle.addEventListener('pointermove', onDragMove);
  handle.addEventListener('pointerup', onDragEnd);
}
overlay.addEventListener('pointermove', onDragMove);
overlay.addEventListener('pointerup', onDragEnd);

function onDragMove(e: PointerEvent): void {
  if (!drag) return;
  const p = framePoint(e);
  const dx = p.x - drag.start.x;
  const dy = p.y - drag.start.y;
  if (!drag.moved && Math.hypot(dx, dy) < 4) return;
  drag.moved = true;
  const node = doc && nodeAt(doc, drag.path);
  const keyFor = (name: string) => (node ? effectiveKey(node, name) : name);
  if (drag.kind === 'resize') {
    // 即時預覽：直接改元件屬性（放開時才寫回原始碼）
    const values: Record<string, string> = {};
    if (drag.dir!.includes('e')) values.width = String(Math.max(4, Math.round(drag.startRect.w + dx)));
    if (drag.dir!.includes('s')) values.height = String(Math.max(4, Math.round(drag.startRect.h + dy)));
    for (const [k, v] of Object.entries(values)) drag.el.set(keyFor(k), v);
    drag.values = values;
    ui.layout();
    refreshOverlays();
  } else if (drag.el.get('position') === 'absolute') {
    const values = {
      left: String(Math.round(drag.startPos!.left + dx)),
      top: String(Math.round(drag.startPos!.top + dy)),
    };
    for (const [k, v] of Object.entries(values)) drag.el.set(keyFor(k), v);
    drag.el.set('right', null);
    drag.el.set('bottom', null);
    drag.values = values;
    ui.layout();
    refreshOverlays();
  } else {
    const drop = siblingDrop(drag.el, p);
    drag.dropIndex = drop?.index;
    showDropLine(drop?.line ?? null);
  }
}

function onDragEnd(): void {
  const d = drag;
  drag = null;
  showDropLine(null);
  if (!d?.moved) return;
  if (d.values) {
    const values = d.values;
    const absolute = d.kind === 'move';
    const original = doc && nodeAt(doc, d.path);
    const keys = Object.fromEntries(Object.keys(values).map((k) => [k, original ? effectiveKey(original, k) : k]));
    commit((root) => {
      const node = nodeAt(root, d.path)!;
      for (const [k, v] of Object.entries(values)) node.attrs[keys[k]] = v;
      if (absolute) {
        delete node.attrs.right;
        delete node.attrs.bottom;
      }
      return d.path;
    });
    log(
      d.kind === 'resize'
        ? `調整大小：${Object.entries(values)
            .map(([k, v]) => `${keys[k]}=${v}`)
            .join('、')}`
        : `移動到 ${keys.left}=${values.left}, ${keys.top}=${values.top}`,
    );
  } else if (d.dropIndex !== undefined) {
    const parent = parentPath(d.path);
    commit((root) => moveNode(root, d.path, parent, d.dropIndex!));
  }
}

// 從元件面板拖到預覽上
overlay.addEventListener('dragover', (e) => {
  e.preventDefault();
  const p = framePoint(e);
  place(hoverBox, hitTest(p.x, p.y));
});
overlay.addEventListener('drop', (e) => {
  e.preventDefault();
  const data = readDrag(e);
  if (!data || !doc) return;
  const p = framePoint(e);
  const path = pathOfElement(hitTest(p.x, p.y)) ?? [];
  const node = nodeAt(doc, path)!;
  const parent = isContainer(node) ? path : parentPath(path);
  const index = isContainer(node) ? node.children.length : path[path.length - 1] + 1;
  if (data.kind === 'new') commit((root) => insertNode(root, parent, index, paletteNode(data.xml)));
  else commit((root) => moveNode(root, data.path, parent, index));
});

// ───────── 工具列 ─────────

function setSize(width: number, height: number): void {
  frame.style.width = `${width}px`;
  frame.style.height = `${height}px`;
  wInput.value = String(width);
  hInput.value = String(height);
  // 下拉選單：剛好是預設尺寸就選它，否則是「自訂」
  const preset = `${width}x${height}`;
  deviceSelect.value = [...deviceSelect.options].some((o) => o.value === preset) ? preset : 'custom';
  fitFrame();
  if (previewOpen()) layoutPreview();
}

// ───────── 預覽尺寸與 <UI width height> 同步 ─────────
//
// 介面檔的 <UI> 寫了固定寬高（數字）時，預覽尺寸跟著它；在工具列改尺寸也會寫回 <UI>。
// 沒寫、auto 或百分比（自動滿版）時，工具列只是切換預覽的螢幕大小，不會寫進檔案。

/** 使用者自己選的預覽尺寸（介面檔沒有固定寬高時使用） */
const freeSize = { width: 1280, height: 720 };

/** <UI> 上固定的寬高（只看基本屬性；auto、百分比、沒寫都是 undefined） */
function fixedRootSize(root: XmlNode | null): { width?: number; height?: number } {
  const num = (v: string | undefined) => (v !== undefined && /^\s*\d+(\.\d+)?\s*$/.test(v) ? Number(v) : undefined);
  if (root?.tag !== 'UI') return {};
  return { width: num(root.attrs.width), height: num(root.attrs.height) };
}

/** 介面檔改變後：預覽尺寸跟著 <UI> 的固定寬高 */
/** <UI> 寫 fit 的那一邊：排版後的內容大小（預覽框跟著它，不用工具列的尺寸） */
function fitRootSize(): { width?: number; height?: number } {
  const root = ui.root;
  if (!root || !doc || doc.tag !== 'UI') return {};
  const isFit = (v: string | undefined) => v?.trim() === 'fit';
  return {
    width: isFit(doc.attrs.width) ? Math.max(1, Math.ceil(root.layout.width)) : undefined,
    height: isFit(doc.attrs.height) ? Math.max(1, Math.ceil(root.layout.height)) : undefined,
  };
}

function syncSizeFromDoc(): void {
  const fixed = fixedRootSize(doc);
  const fit = fitRootSize();
  const w = fixed.width ?? fit.width ?? freeSize.width;
  const h = fixed.height ?? fit.height ?? freeSize.height;
  wInput.classList.toggle('linked', fixed.width !== undefined);
  hInput.classList.toggle('linked', fixed.height !== undefined);
  // fit：顯示內容大小，不能手動改（改 XML 的內容或拿掉 fit 才會變）
  wInput.classList.toggle('fit', fit.width !== undefined);
  hInput.classList.toggle('fit', fit.height !== undefined);
  wInput.disabled = fit.width !== undefined;
  hInput.disabled = fit.height !== undefined;
  const title = (fixedV: number | undefined, fitV: number | undefined, axis: 'width' | 'height', label: string) =>
    fixedV !== undefined
      ? `和 <UI ${axis}> 同步`
      : fitV !== undefined
        ? `<UI ${axis}="fit">：依內容決定（目前 ${fitV}）`
        : `預覽${label}（<UI> 沒有固定大小：自動滿版）`;
  wInput.title = title(fixed.width, fit.width, 'width', '寬度');
  hInput.title = title(fixed.height, fit.height, 'height', '高度');
  if (w !== parseInt(frame.style.width, 10) || h !== parseInt(frame.style.height, 10)) setSize(w, h);
}

/** 在工具列改尺寸：預覽跟著改；<UI> 有固定寬高的那一邊寫回檔案 */
function changeSize(width: number, height: number): void {
  const fixed = fixedRootSize(doc);
  // fit 的那一邊永遠是內容大小（選預設尺寸、旋轉都不會改它）
  const fit = fitRootSize();
  if (fit.width !== undefined) width = fit.width;
  if (fit.height !== undefined) height = fit.height;
  if (fixed.width === undefined && fit.width === undefined) freeSize.width = width;
  if (fixed.height === undefined && fit.height === undefined) freeSize.height = height;
  setSize(width, height);
  const writeW = fixed.width !== undefined && fixed.width !== width;
  const writeH = fixed.height !== undefined && fixed.height !== height;
  if (!writeW && !writeH) return;
  commit((root) => {
    if (writeW) root.attrs.width = String(width);
    if (writeH) root.attrs.height = String(height);
  });
  log(`<UI> 的尺寸改成 ${fixedRootSize(doc).width ?? 'auto'} × ${fixedRootSize(doc).height ?? 'auto'}`);
}

// ───────── 預覽區縮放與平移 ─────────

/** fit = true 時跟著預覽區大小自動縮放；使用者縮放或平移後改為手動 */
const view = { zoom: 1, panX: 0, panY: 0, fit: true };
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;
const ZOOM_STEPS = [0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8];
const baseRatio = ui.pixelRatio;
let pixelRatioTimer = 0;

function fitZoom(): number {
  const w = parseInt(frame.style.width, 10);
  const h = parseInt(frame.style.height, 10);
  return Math.min(1, (stage.clientWidth - 32) / w, (stage.clientHeight - 32) / h);
}

function applyView(): void {
  if (view.fit) {
    view.zoom = fitZoom();
    view.panX = view.panY = 0;
  }
  frame.style.transform = `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})`;
  frame.style.setProperty('--inv-scale', String(1 / view.zoom));
  $('zoomPct').textContent = `${Math.round(view.zoom * 100)}%`;
  $('zoomFit').classList.toggle('on', view.fit);
  // 放大時提高畫布解析度，文字才不會糊（停止縮放後才重畫，避免縮放過程卡頓）
  clearTimeout(pixelRatioTimer);
  pixelRatioTimer = window.setTimeout(() => {
    const pr = Math.min(4, baseRatio * Math.max(1, view.zoom));
    if (Math.abs(pr - ui.pixelRatio) > 0.01) {
      ui.pixelRatio = pr;
      ui.invalidate();
    }
  }, 150);
}

function fitFrame(): void {
  applyView();
}

/** 以畫面上某一點為中心縮放（滑鼠位置不動） */
function zoomAt(next: number, clientX?: number, clientY?: number): void {
  const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
  const r = stage.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const sx = (clientX ?? cx) - cx;
  const sy = (clientY ?? cy) - cy;
  view.panX = sx - ((sx - view.panX) * z) / view.zoom;
  view.panY = sy - ((sy - view.panY) * z) / view.zoom;
  view.zoom = z;
  view.fit = false;
  applyView();
}

function zoomStep(dir: 1 | -1): void {
  const z = view.zoom;
  const next =
    dir > 0
      ? (ZOOM_STEPS.find((s) => s > z + 0.001) ?? MAX_ZOOM)
      : ([...ZOOM_STEPS].reverse().find((s) => s < z - 0.001) ?? MIN_ZOOM);
  zoomAt(next);
}

function setFit(): void {
  view.fit = true;
  applyView();
}

$('zoomIn').addEventListener('click', () => zoomStep(1));
$('zoomOut').addEventListener('click', () => zoomStep(-1));
$('zoomPct').addEventListener('click', () => zoomAt(1));
$('zoomFit').addEventListener('click', setFit);

// 滾輪：Ctrl/⌘（含觸控板雙指縮放）= 縮放；其他 = 平移
// 互動模式下滑鼠在介面上時，滾輪交給介面（例如捲動列表）
stage.addEventListener(
  'wheel',
  (e) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025));
      zoomAt(view.zoom * factor, e.clientX, e.clientY);
      return;
    }
    if (mode === 'interact' && frame.contains(e.target as Node)) return;
    e.preventDefault();
    const k = e.deltaMode === 1 ? 16 : 1;
    view.panX -= (e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX) * k;
    view.panY -= (e.shiftKey && !e.deltaX ? 0 : e.deltaY) * k;
    view.fit = false;
    applyView();
  },
  { passive: false },
);

// 拖曳平移：按住空白鍵拖曳、滑鼠中鍵拖曳、或拖曳預覽外的空白處
let spaceHeld = false;
let pan: { x: number; y: number; px: number; py: number; id: number } | null = null;
const typing = (t: EventTarget | null) =>
  t instanceof HTMLElement &&
  (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !typing(e.target)) {
    e.preventDefault();
    if (!spaceHeld) {
      spaceHeld = true;
      stage.classList.add('space-pan');
    }
  }
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') {
    spaceHeld = false;
    stage.classList.remove('space-pan');
  }
});
window.addEventListener('blur', () => {
  spaceHeld = false;
  stage.classList.remove('space-pan');
});
// 捕獲階段：搶在預覽區的選取、拖曳之前
stage.addEventListener(
  'pointerdown',
  (e) => {
    const onBackground = e.target === stage;
    if (!(spaceHeld || e.button === 1 || (onBackground && e.button === 0))) return;
    if ((e.target as HTMLElement).closest('#zoomBar')) return;
    e.preventDefault();
    e.stopPropagation();
    pan = { x: view.panX, y: view.panY, px: e.clientX, py: e.clientY, id: e.pointerId };
    stage.setPointerCapture(e.pointerId);
    stage.classList.add('panning');
  },
  true,
);
stage.addEventListener(
  'pointermove',
  (e) => {
    if (!pan || e.pointerId !== pan.id) return;
    e.stopPropagation();
    view.panX = pan.x + e.clientX - pan.px;
    view.panY = pan.y + e.clientY - pan.py;
    view.fit = false;
    applyView();
  },
  true,
);
const endPan = (e: PointerEvent) => {
  if (!pan || e.pointerId !== pan.id) return;
  e.stopPropagation();
  pan = null;
  stage.classList.remove('panning');
};
stage.addEventListener('pointerup', endPan, true);
stage.addEventListener('pointercancel', endPan, true);
// 中鍵在某些瀏覽器會出現自動捲動圖示
stage.addEventListener('mousedown', (e) => e.button === 1 && e.preventDefault());

// 快捷鍵：Ctrl/⌘ + = / − / 0（符合）/ 1（100%）
window.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || typing(e.target)) return;
  if (e.key === '=' || e.key === '+') zoomStep(1);
  else if (e.key === '-' || e.key === '_') zoomStep(-1);
  else if (e.key === '0') setFit();
  else if (e.key === '1') zoomAt(1);
  else return;
  e.preventDefault();
});

deviceSelect.addEventListener('change', () => {
  if (deviceSelect.value === 'custom') return;
  const [w, h] = deviceSelect.value.split('x').map(Number);
  changeSize(w, h);
});
for (const input of [wInput, hInput]) {
  input.addEventListener('change', () => {
    changeSize(
      Math.max(1, Math.round(Number(wInput.value)) || 375),
      Math.max(1, Math.round(Number(hInput.value)) || 667),
    );
  });
}
$('rotate').addEventListener('click', () => {
  changeSize(Number(hInput.value), Number(wInput.value));
});
new ResizeObserver(fitFrame).observe(stage);

function setMode(next: 'design' | 'interact'): void {
  mode = next;
  $('modeDesign').classList.toggle('on', next === 'design');
  $('modeInteract').classList.toggle('on', next === 'interact');
  overlay.style.display = next === 'design' ? 'block' : 'none';
  place(hoverBox, null);
  refreshOverlays();
  log(next === 'design' ? '設計模式：選取、拖曳、調整大小' : '互動模式：可以點擊按鈕測試事件');
}
$('modeDesign').addEventListener('click', () => setMode('design'));
$('modeInteract').addEventListener('click', () => setMode('interact'));

function undo(): void {
  if (!history.length) return;
  future.push(text);
  setText(history.pop()!, { history: false });
}
function redo(): void {
  if (!future.length) return;
  history.push(text);
  setText(future.pop()!, { history: false });
}
$('undo').addEventListener('click', undo);
$('redo').addEventListener('click', redo);

$('outlinesBtn').addEventListener('click', (e) => {
  showOutlines = !showOutlines;
  (e.currentTarget as HTMLElement).classList.toggle('on', showOutlines);
  refreshOverlays();
});

// ───────── 原始碼視窗：可拖曳、可調整大小，位置與大小會記住 ─────────

const codeWin = $<HTMLDivElement>('codeWin');
const openCodeBtn = $<HTMLButtonElement>('openCode');
const WIN_KEY = 'ui2d-editor-code-window';
interface WinRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function defaultWinRect(): WinRect {
  // 預設：靠近左側結構面板的右邊，蓋住預覽區左半部
  const w = Math.min(560, window.innerWidth - 40);
  const h = Math.min(640, window.innerHeight - 100);
  return { x: Math.min(320, window.innerWidth - w - 20), y: 70, w, h };
}
function loadWinRect(): WinRect {
  const r = storage.getJson<WinRect | null>(WIN_KEY, null);
  return r && [r.x, r.y, r.w, r.h].every(Number.isFinite) ? r : defaultWinRect();
}
function saveWinRect(): void {
  // 全螢幕時不記錄（還原後要回到原本的位置與大小）
  if (!codeWin.classList.contains('open') || codeWin.classList.contains('max')) return;
  const r: WinRect = { x: codeWin.offsetLeft, y: codeWin.offsetTop, w: codeWin.offsetWidth, h: codeWin.offsetHeight };
  storage.set(WIN_KEY, JSON.stringify(r));
}
/** 讓視窗留在畫面內（至少標題列看得到、拉得到） */
function clampWin(r: WinRect): WinRect {
  const w = Math.min(Math.max(320, r.w), window.innerWidth);
  const h = Math.min(Math.max(200, r.h), window.innerHeight);
  return {
    w,
    h,
    x: Math.min(Math.max(0, r.x), window.innerWidth - Math.min(w, 120)),
    y: Math.min(Math.max(0, r.y), window.innerHeight - 36),
  };
}
function applyWinRect(r: WinRect): void {
  const c = clampWin(r);
  Object.assign(codeWin.style, { left: `${c.x}px`, top: `${c.y}px`, width: `${c.w}px`, height: `${c.h}px` });
}

function openCodeWindow(focus = false): void {
  if (!codeWin.classList.contains('open')) {
    applyWinRect(loadWinRect());
    codeWin.classList.add('open');
    const max = storage.get(MAX_KEY) === '1';
    codeWin.classList.toggle('max', max);
    renderHighlight();
  }
  openCodeBtn.classList.add('on');
  openCodeBtn.textContent = '關閉原始碼';
  if (focus) code.focus();
}
function closeCodeWindow(): void {
  saveWinRect();
  codeWin.classList.remove('open');
  openCodeBtn.classList.remove('on');
  openCodeBtn.textContent = '打開原始碼';
}
const MAX_KEY = 'ui2d-editor-code-window-max';
function setCodeMaximized(max: boolean): void {
  if (max) saveWinRect(); // 先記住目前位置，還原時用
  codeWin.classList.toggle('max', max);
  const btn = $<HTMLButtonElement>('codeWinMax');
  btn.title = max ? '還原視窗大小（Esc）' : '全螢幕（雙擊標題列也可以切換）';
  btn.setAttribute('aria-label', max ? '還原' : '全螢幕');
  storage.set(MAX_KEY, max ? '1' : '');
  code.focus();
}
$('codeWinMax').addEventListener('click', () => setCodeMaximized(!codeWin.classList.contains('max')));
// 全螢幕時按 Esc 還原（不論焦點在哪；搶在編輯器的 Esc 取消選取之前處理）
window.addEventListener(
  'keydown',
  (e) => {
    if (
      e.key === 'Escape' &&
      !previewOpen() &&
      !codeAssistOpen() &&
      codeWin.classList.contains('open') &&
      codeWin.classList.contains('max')
    ) {
      e.preventDefault();
      e.stopImmediatePropagation();
      setCodeMaximized(false);
    }
  },
  true,
);

openCodeBtn.addEventListener('click', () =>
  codeWin.classList.contains('open') ? closeCodeWindow() : openCodeWindow(true),
);
$('codeWinClose').addEventListener('click', closeCodeWindow);

// 拖曳邊緣、角落調整視窗大小（最小 320 × 200，不會超出畫面）
{
  const MIN_W = 320;
  const MIN_H = 200;
  for (const handle of codeWin.querySelectorAll<HTMLDivElement>('.rz')) {
    const dir = handle.dataset.dir ?? '';
    let start: { px: number; py: number; x: number; y: number; w: number; h: number } | null = null;
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || codeWin.classList.contains('max')) return;
      start = {
        px: e.clientX,
        py: e.clientY,
        x: codeWin.offsetLeft,
        y: codeWin.offsetTop,
        w: codeWin.offsetWidth,
        h: codeWin.offsetHeight,
      };
      handle.setPointerCapture(e.pointerId);
      codeWin.classList.add('resizing');
      handle.style.pointerEvents = 'auto'; // .resizing 會關掉子元素的事件，拖曳中的這個要留著
      e.preventDefault();
    });
    handle.addEventListener('pointermove', (e) => {
      if (!start) return;
      const dx = e.clientX - start.px;
      const dy = e.clientY - start.py;
      let { x, y, w, h } = start;
      if (dir.includes('e')) w = Math.min(Math.max(MIN_W, start.w + dx), window.innerWidth - start.x);
      if (dir.includes('s')) h = Math.min(Math.max(MIN_H, start.h + dy), window.innerHeight - start.y);
      if (dir.includes('w')) {
        // 左邊：右邊緣固定不動
        const right = start.x + start.w;
        x = Math.min(Math.max(0, start.x + dx), right - MIN_W);
        w = right - x;
      }
      if (dir.includes('n')) {
        const bottom = start.y + start.h;
        y = Math.min(Math.max(0, start.y + dy), bottom - MIN_H);
        h = bottom - y;
      }
      Object.assign(codeWin.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
    });
    const end = () => {
      if (!start) return;
      start = null;
      codeWin.classList.remove('resizing');
      handle.style.pointerEvents = '';
      saveWinRect();
      renderHighlight(); // 寬度改變後重新對齊高亮與換行
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }
}

// 拖曳標題列移動視窗
{
  const title = $<HTMLDivElement>('codeWinTitle');
  let start: { px: number; py: number; x: number; y: number } | null = null;
  title.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).closest('button') || e.button !== 0 || codeWin.classList.contains('max')) return;
    start = { px: e.clientX, py: e.clientY, x: codeWin.offsetLeft, y: codeWin.offsetTop };
    title.setPointerCapture(e.pointerId);
    codeWin.classList.add('dragging');
    e.preventDefault();
  });
  title.addEventListener('pointermove', (e) => {
    if (!start) return;
    applyWinRect({
      x: start.x + e.clientX - start.px,
      y: start.y + e.clientY - start.py,
      w: codeWin.offsetWidth,
      h: codeWin.offsetHeight,
    });
  });
  const end = () => {
    if (!start) return;
    start = null;
    codeWin.classList.remove('dragging');
    saveWinRect();
  };
  title.addEventListener('pointerup', end);
  title.addEventListener('pointercancel', end);
  // 雙擊標題列：切換全螢幕
  title.addEventListener('dblclick', (e) => {
    if ((e.target as HTMLElement).closest('button')) return;
    setCodeMaximized(!codeWin.classList.contains('max'));
  });
}
// 右下角調整大小後記住；瀏覽器視窗變小時把它拉回畫面內
new ResizeObserver(() => saveWinRect()).observe(codeWin);
window.addEventListener('resize', () => {
  if (codeWin.classList.contains('open'))
    applyWinRect({ x: codeWin.offsetLeft, y: codeWin.offsetTop, w: codeWin.offsetWidth, h: codeWin.offsetHeight });
});

// 原始碼高亮：pre 跟著 textarea 捲動
function renderHighlight(): void {
  // 結尾多一個換行：最後一行是空行時高度才會一致
  codeHlInner.innerHTML = `${highlightXml(code.value)}\n`;
  syncHighlightScroll();
}
function syncHighlightScroll(): void {
  const t = `translate(${-code.scrollLeft}px, ${-code.scrollTop}px)`;
  codeHlInner.style.transform = t;
  errLine.style.transform = `translateY(${-code.scrollTop}px)`;
}
function showErrorLine(line: number): void {
  if (!line) {
    errLine.style.display = 'none';
    return;
  }
  const cs = getComputedStyle(code);
  const lh = parseFloat(cs.lineHeight) || 20;
  Object.assign(errLine.style, {
    display: 'block',
    top: `${parseFloat(cs.paddingTop) + (line - 1) * lh}px`,
    height: `${lh}px`,
  });
}
let highlightFrame = 0;
code.addEventListener('scroll', syncHighlightScroll);
code.addEventListener('input', () => {
  // 打字時立即著色（每幀最多一次），預覽則等停下來才更新
  if (!highlightFrame)
    highlightFrame = requestAnimationFrame(() => {
      highlightFrame = 0;
      renderHighlight();
    });
});

// ───────── 原始碼提示：打標籤、屬性、屬性值時列出可以用的選項 ─────────

const assistBox = $<HTMLDivElement>('codeAssist');
let assist: { ctx: CodeContext; items: Suggestion[]; index: number } | null = null;
let assistBusy = false;
const measureCtx = document.createElement('canvas').getContext('2d')!;

function codeAssistOpen(): boolean {
  return assist !== null;
}

function closeAssist(): void {
  assist = null;
  assistBox.classList.remove('open');
}

/** 游標在 textarea 裡的像素位置（相對於 codeBody） */
function caretPoint(): { x: number; y: number; lh: number } {
  const cs = getComputedStyle(code);
  measureCtx.font = `${cs.fontSize} ${cs.fontFamily}`;
  const before = code.value.slice(0, code.selectionStart);
  const line = before.split('\n').length - 1;
  const lineText = before.slice(before.lastIndexOf('\n') + 1).replace(/\t/g, '  ');
  const lh = parseFloat(cs.lineHeight) || 20;
  return {
    x: parseFloat(cs.paddingLeft) + measureCtx.measureText(lineText).width - code.scrollLeft,
    y: parseFloat(cs.paddingTop) + (line + 1) * lh - code.scrollTop,
    lh,
  };
}

/** 重新分析並顯示提示；manual 為 true 時，前綴是空的也顯示（Ctrl+Space、插入屬性後） */
function refreshAssist(manual = false, typed = ''): void {
  if (code.selectionStart !== code.selectionEnd) return closeAssist();
  const ctx = analyzeCode(code.value, code.selectionStart);
  if (!ctx) return closeAssist();
  // 屬性名稱：剛打空白、打字中、或手動叫出來時才顯示（游標移動時不要一直跳出來）
  if (!manual && ctx.kind === 'attr' && ctx.prefix === '' && typed !== ' ') return closeAssist();
  if (!manual && ctx.kind === 'value' && ctx.prefix === '' && typed !== '"') return closeAssist();
  const styles = doc ? doc.children.filter((c) => c.tag === 'UIStyle' && c.attrs.name).map((c) => c.attrs.name) : [];
  const items = suggest(ctx, {
    components: [...UI2D.components.keys()],
    styles,
    defaults: (tag) => (UI2D.components.has(tag) ? componentDefaults(tag) : {}),
  });
  // 已經打完整的唯一選項不用再提示
  if (items.length === 0 || (items.length === 1 && items[0].value === ctx.prefix)) return closeAssist();
  const keep =
    assist && assist.ctx.kind === ctx.kind
      ? items.findIndex((i) => i.value === assist!.items[assist!.index]?.value)
      : -1;
  assist = { ctx, items, index: Math.max(0, keep) };
  renderAssist();
}

function renderAssist(): void {
  if (!assist) return;
  const { ctx, items, index } = assist;
  const head =
    ctx.kind === 'tag'
      ? '元件'
      : ctx.kind === 'attr'
        ? `<b>&lt;${ctx.tag}&gt;</b> 的屬性${ctx.breakpoint ? `（${ctx.breakpoint.slice(0, -1)} 斷點）` : ''}`
        : `<b>${ctx.attr}</b> 的值`;
  assistBox.innerHTML = `<div class="ca-head">${head}<span>${items.length} 個</span></div><div class="ca-list"></div><div class="ca-doc"></div><div class="ca-keys">↑↓ 選擇 · Enter／Tab 插入 · Esc 關閉 · Ctrl+Space 叫出提示</div>`;
  const list = assistBox.querySelector('.ca-list')!;
  items.slice(0, 80).forEach((item, i) => {
    const el = document.createElement('div');
    el.className = `ca-item ${ctx.kind === 'tag' ? 'tag' : ctx.kind === 'value' ? 'val' : 'attr'}${i === index ? ' on' : ''}`;
    el.innerHTML = '<span class="k"></span><span class="h"></span>';
    el.querySelector('.k')!.textContent = item.label;
    el.querySelector('.h')!.textContent = item.hint ?? '';
    // mousedown：不讓 textarea 失去焦點
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      assist!.index = i;
      acceptAssist();
    });
    list.appendChild(el);
  });
  assistBox.querySelector('.ca-doc')!.textContent =
    items[index]?.detail ?? (ctx.kind === 'value' ? '' : '（沒有說明）');
  list.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
  // 位置：游標下方；下面放不下就放上面
  assistBox.classList.add('open');
  const body = $('codeBody');
  const p = caretPoint();
  const w = assistBox.offsetWidth;
  const h = assistBox.offsetHeight;
  const x = Math.max(8, Math.min(p.x - 12, body.clientWidth - w - 8));
  const below = p.y + 4;
  const y = below + h > body.clientHeight - 4 && p.y - p.lh - h - 4 > 0 ? p.y - p.lh - h - 4 : below;
  Object.assign(assistBox.style, { left: `${x}px`, top: `${y}px` });
}

/** 插入選中的提示 */
function acceptAssist(): void {
  if (!assist) return;
  const { ctx } = assist;
  const item = assist.items[assist.index];
  if (!item) return closeAssist();
  const caret = code.selectionStart;
  let insert = item.value;
  let caretAt: number;
  if (ctx.kind === 'tag') {
    insert += ' ';
    caretAt = ctx.start + insert.length;
  } else if (ctx.kind === 'attr') {
    insert += '=""';
    caretAt = ctx.start + insert.length - 1; // 放在引號中間
  } else {
    const endsOpen = insert.endsWith(':'); // screen.open: 之後還要打名稱
    caretAt = ctx.start + insert.length + (!endsOpen && code.value[caret] === '"' ? 1 : 0);
  }
  assistBusy = true;
  code.focus();
  code.setSelectionRange(ctx.start, caret);
  // execCommand 會進入瀏覽器的復原紀錄（Cmd+Z 可以復原）
  if (!document.execCommand('insertText', false, insert)) {
    code.setRangeText(insert, ctx.start, caret, 'end');
    code.dispatchEvent(new Event('input'));
  }
  code.setSelectionRange(caretAt, caretAt);
  assistBusy = false;
  closeAssist();
  // 插入屬性後，接著提示它的值；值以冒號結尾（screen.open:）時繼續提示
  // 插入標籤後接著提示它的屬性
  if (ctx.kind === 'tag' || ctx.kind === 'attr' || (ctx.kind === 'value' && insert.endsWith(':'))) refreshAssist(true);
}

code.addEventListener(
  'keydown',
  (e) => {
    if ((e.ctrlKey || e.metaKey) && e.code === 'Space') {
      e.preventDefault();
      refreshAssist(true);
      return;
    }
    if (!assist) return;
    const n = Math.min(assist.items.length, 80);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      assist.index = (assist.index + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
      renderAssist();
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      acceptAssist();
    } else if (e.key === 'Escape') {
      closeAssist();
    } else {
      return;
    }
    e.preventDefault();
    e.stopImmediatePropagation();
  },
  true,
);
code.addEventListener('input', (e) => {
  if (assistBusy) return;
  refreshAssist(false, (e as InputEvent).data ?? '');
});
code.addEventListener('blur', () => setTimeout(() => document.activeElement !== code && closeAssist(), 100));
code.addEventListener('mousedown', closeAssist);
code.addEventListener('scroll', () => assist && renderAssist());

// 原始碼編輯
let timer = 0;
code.addEventListener('input', () => {
  clearTimeout(timer);
  timer = window.setTimeout(() => setText(code.value, { fromCode: true }), 300);
});
code.addEventListener('keydown', (e) => {
  if (e.key !== 'Tab') return;
  e.preventDefault();
  code.setRangeText('  ', code.selectionStart, code.selectionEnd, 'end');
  code.dispatchEvent(new Event('input'));
});
treeError.addEventListener('click', () => showInCode(Number(errorBox.dataset.line) || 1));
errorBox.addEventListener('click', () => {
  const line = Number(errorBox.dataset.line);
  if (line) showInCode(line);
});

// 快捷鍵（焦點在輸入框時不處理，保留輸入框自己的行為）
document.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement;
  if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return;
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) redo();
    else undo();
  } else if (mod && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    redo();
  } else if (mod && e.key.toLowerCase() === 'd' && selected?.length) {
    e.preventDefault();
    const p = selected;
    commit((root) => duplicateNode(root, p));
  } else if ((e.key === 'Delete' || e.key === 'Backspace') && selected && selected.length) {
    e.preventDefault();
    const p = selected;
    commit((root) => {
      removeNode(root, p);
      return null;
    });
  } else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && selected?.length) {
    e.preventDefault();
    const p = selected;
    commit((root) => shiftNode(root, p, e.key === 'ArrowUp' ? -1 : 1));
  } else if (e.key === 'Escape') {
    select(null);
  }
});

// ───────── XML 管理：開檔、存檔、檔案清單 ─────────

const fileListBox = $<HTMLDivElement>('fileList');

function updateDocState(): void {
  const name = $('docName');
  name.textContent = currentFile;
  name.classList.toggle('dirty', isDirty());
  ($('saveBtn') as HTMLButtonElement).disabled = !isDirty() && diskText !== null;
  document.title = `${isDirty() ? '● ' : ''}${currentFile} · Hero Engine UI 編輯器`;
  // 清單上的「未儲存」標記
  for (const row of fileListBox.querySelectorAll<HTMLElement>('.file')) {
    const f = row.dataset.name!;
    const dirty = f === currentFile ? isDirty() : files.draft(f) !== null;
    row.querySelector('.dirty')?.toggleAttribute('hidden', !dirty);
    // 還原鈕：有沒存檔的修改、而且磁碟上有這個檔案時才顯示
    row.querySelector('.rev')?.toggleAttribute('hidden', !dirty || !files.existsOnDisk(f));
  }
}

/** 還原檔案：捨棄沒存檔的修改（目前編輯中的檔案可以用「復原」找回） */
async function revertFile(name: string): Promise<void> {
  const current = name === currentFile;
  if (
    !(await showConfirm(
      `沒存檔的修改會捨棄，回到磁碟上的版本。${current ? '\n之後可以用「復原」Ctrl/⌘ Z 找回。' : ''}`,
      { title: `還原「${name}」`, ok: '還原', danger: true },
    ))
  )
    return;
  if (current) {
    await reloadFromDisk();
  } else {
    files.clearDraft(name);
    broadcast({ type: 'saved', name });
    log(`已還原 ${name}（捨棄沒存檔的修改）`);
  }
  updateDocState();
}

/** 打開檔案：有沒存檔的草稿就用草稿 */
async function openFile(name: string): Promise<void> {
  let disk: string | null = null;
  try {
    disk = await files.read(name);
  } catch (e) {
    if (files.existsOnDisk(name)) log(`⚠ ${(e as Error).message}`);
  }
  const draft = files.draft(name);
  if (disk === null && draft === null) {
    log(`⚠ 無法打開 ${name}`);
    return;
  }
  currentFile = name;
  diskText = disk;
  storage.set(LAST_FILE_KEY, name);
  history.length = 0;
  future.length = 0;
  selected = null;
  text = '';
  setText(draft ?? disk!, { history: false });
  log(draft !== null && draft !== disk ? `已打開 ${name}（還原沒存檔的修改）` : `已打開 ${name}`);
  renderFiles();
}

/** 捨棄草稿，重新讀取磁碟上的檔案（可以用復原找回） */
async function reloadFromDisk(): Promise<void> {
  try {
    const disk = await files.read(currentFile);
    diskText = disk;
    files.clearDraft(currentFile);
    selected = null;
    setText(disk);
    log(`已重新載入 ${currentFile}`);
  } catch (e) {
    log(`無法載入 ${currentFile}：${(e as Error).message}`);
  }
}

async function saveCurrent(): Promise<void> {
  if (!files.writable) {
    download(currentFile, text, 'application/xml');
    log(`目前不能直接存檔（不是開發伺服器）：已下載 ${currentFile}`);
    return;
  }
  try {
    await files.save(currentFile, text);
    diskText = text;
    broadcast({ type: 'saved', name: currentFile });
    log(`已儲存 public/ui/${currentFile}`);
    await refreshFiles();
  } catch (e) {
    log(`⚠ 儲存失敗：${(e as Error).message}`);
  }
}

/** 新檔案的內容：場景資料夾裡的檔案用 ../ 匯入共用主題 */
function newFileTemplate(name: string): string {
  const theme = fileInfos.some((f) => f.name === 'theme.xml')
    ? `\n  <UIImport src="${folderOf(name) ? '../' : ''}theme.xml"/>`
    : '';
  return `<!-- 新的介面 -->
<UI width="auto" height="auto" padding="16" gap="12">${theme}
  <UILabel fontSize="20" fontWeight="bold">新的介面</UILabel>
  <UIButton text="關閉" onClick="screen.close"/>
</UI>
`;
}

/** 新場景的介面：進入場景後疊在畫面上的 hud.xml */
function sceneHudTemplate(scene: string): string {
  const theme = fileInfos.some((f) => f.name === 'theme.xml') ? '\n  <UIImport src="../theme.xml"/>' : '';
  return `<!--
  場景「${scene}」的介面：進入場景後疊在畫面上（SceneTransition 的 hud），離開場景時移除
  版面尺寸：滿版（auto × auto）；透明的地方可以點到遊戲
-->
<UI width="auto" height="auto" padding="16" align="center">${theme}
  <UILabel fontSize="18" fontWeight="bold" color="#ffffff" padding="6 14" background="rgba(0,0,0,0.5)" radius="999">${scene}</UILabel>
</UI>
`;
}

/** 新場景的載入頁面：SceneTransition 用這些 id 顯示進度 */
function sceneLoadingTemplate(scene: string): string {
  return `<!--
  場景「${scene}」的資源載入頁面（SceneTransition 的 loading）
  版面尺寸：滿版（auto × auto）
  這些 id 會自動更新：loadingTitle 場景名稱、loadingBar 進度（0～100）、loadingText 百分比、loadingItem 正在載入的檔案、loadingTip 提示
-->
<UI width="auto" height="auto" background="#0c0f0b" align="center" justify="center" padding="24" gap="14">
  <UILabel fontSize="12" color="#838b78">LOADING</UILabel>
  <UILabel id="loadingTitle" fontSize="26" fontWeight="bold" color="#ffffff">${scene}</UILabel>
  <UIProgressBar id="loadingBar" value="0" max="100" width="70%" maxWidth="360" height="10" animate="0.15"/>
  <UILayout dir="h" width="70%" maxWidth="360" justify="between">
    <UILabel id="loadingItem" fontSize="12" color="#838b78"></UILabel>
    <UILabel id="loadingText" fontSize="12" color="#b8c0ae">0%</UILabel>
  </UILayout>
  <UILabel id="loadingTip" fontSize="13" color="#b8c0ae" textAlign="center"></UILabel>
</UI>
`;
}

/** 問新的檔名（檢查格式、不能和現有的檔案重複）；取消時回傳 null */
async function askName(title: string, initial: string, message = ''): Promise<string | null> {
  const input = await showPrompt(message, initial, {
    title,
    validate: (v) => {
      const name = normalizeFileName(v);
      if (!name) return '檔名只能用英數字、中文、- _ .，副檔名是 .xml';
      return fileInfos.some((f) => f.name === name) ? `已經有檔案「${name}」` : null;
    },
  });
  return input === null ? null : normalizeFileName(input);
}

async function createFile(name: string, content: string): Promise<void> {
  if (files.writable) await files.save(name, content);
  else files.createLocal(name, content);
  await refreshFiles();
  await openFile(name);
}

async function refreshFiles(): Promise<void> {
  clearUIXmlCache(); // 存檔、新增、刪除後：<UIComponent> 下次會讀到新的內容
  fileInfos = await files.list();
  folderNames = await files.listFolders(fileInfos);
  renderFiles();
  void refreshAssets(); // 新增、刪除、重新命名、存檔後資源清單也要更新
}

function renderFiles(): void {
  $('fileCount').textContent = String(fileInfos.length);
  const mode = $('fileMode');
  mode.textContent = files.writable ? '可存檔' : '唯讀';
  mode.classList.toggle('on', files.writable);
  $('fileStatus').textContent = files.writable
    ? '開發伺服器：「儲存」會直接寫入 public/ui/。沒存檔的修改會保留在瀏覽器裡（● 標示）。每個場景可以有自己的資料夾（＋ 場景）。'
    : '唯讀模式（打包後的版本）：用「儲存」或「下載」取得 XML 檔，放進 public/ui/。新增的檔案只存在瀏覽器裡。';
  fileListBox.replaceChildren();
  // 分組：共用（public/ui 根目錄）＋ 每個場景資料夾
  const groups = ['', ...folderNames];
  for (const folder of groups) {
    const inGroup = fileInfos.filter((f) => folderOf(f.name) === folder);
    if (folder === '' && inGroup.length === 0 && folderNames.length > 0) continue;
    fileListBox.appendChild(folderRow(folder, inGroup.length));
    if (collapsedFolders.has(folder)) continue;
    for (const f of inGroup) fileListBox.appendChild(fileRow(f));
    if (folder && inGroup.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'fgroup-empty';
      empty.textContent = '空的資料夾：按 ＋ 新增這個場景的介面檔';
      fileListBox.appendChild(empty);
    }
  }
  updateDocState();
}

/** 資料夾（場景）的標題列：收合、新增檔案、重新命名、刪除 */
function folderRow(folder: string, count: number): HTMLElement {
  const row = document.createElement('div');
  row.className = `fgroup${collapsedFolders.has(folder) ? ' collapsed' : ''}${folder === folderOf(currentFile) ? ' has-cur' : ''}`;
  row.innerHTML = `<span class="caret">▾</span><span class="gname"></span><span class="gcount"></span>
    <span class="acts"><button class="add" title="在這裡新增介面檔">＋</button>${folder ? '<button class="ren" title="重新命名場景資料夾">✎</button><button class="del" title="刪除資料夾（要先清空）">✕</button>' : ''}</span>`;
  row.querySelector('.gname')!.textContent = folder ? folder : '共用';
  row.title = folder ? `場景資料夾 public/ui/${folder}/` : '共用的介面檔（public/ui/）：主題、各場景都會用到的畫面';
  row.querySelector('.gcount')!.textContent = String(count);
  row.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('.acts')) return;
    if (collapsedFolders.has(folder)) collapsedFolders.delete(folder);
    else collapsedFolders.add(folder);
    storage.set(COLLAPSED_KEY, JSON.stringify([...collapsedFolders]));
    renderFiles();
  });
  row.querySelector('.add')!.addEventListener('click', async () => {
    const name = await askName(
      `新增介面檔${folder ? `（場景「${folder}」）` : '（共用）'}`,
      folder ? `${folder}/new.xml` : 'new.xml',
    );
    if (name) void createFile(name, newFileTemplate(name)).catch((err) => log(`⚠ ${(err as Error).message}`));
  });
  row.querySelector('.ren')?.addEventListener('click', async () => {
    const input = await showPrompt('新的資料夾名稱', folder, {
      title: `重新命名場景資料夾「${folder}」`,
      validate: (v) => {
        const n = normalizeFolderName(v);
        if (!n) return '名稱只能用英數字、中文、- _ .，不能以 . 開頭';
        return n !== folder && folderNames.includes(n) ? `已經有資料夾「${n}」` : null;
      },
    });
    if (input === null) return;
    const to = normalizeFolderName(input)!;
    if (to === folder) return;
    try {
      await files.renameFolder(
        folder,
        to,
        fileInfos.map((f) => f.name),
      );
      if (folderOf(currentFile) === folder) {
        currentFile = `${to}/${baseName(currentFile)}`;
        storage.set(LAST_FILE_KEY, currentFile);
      }
      if (collapsedFolders.delete(folder)) collapsedFolders.add(to);
      log(`已把場景資料夾 ${folder} 重新命名為 ${to}（記得更新程式裡的網址，例如 ui/${to}/…）`);
      await refreshFiles();
    } catch (err) {
      log(`⚠ ${(err as Error).message}`);
    }
  });
  row.querySelector('.del')?.addEventListener('click', async () => {
    if (count > 0)
      return showAlert(`資料夾裡還有 ${count} 個檔案，請先移走或刪除。`, { title: `不能刪除「${folder}」` });
    if (!(await showConfirm(`刪除空的場景資料夾「${folder}」？`, { title: '刪除資料夾', ok: '刪除', danger: true })))
      return;
    try {
      await files.removeFolder(folder);
      log(`已刪除資料夾 ${folder}`);
      await refreshFiles();
    } catch (err) {
      log(`⚠ ${(err as Error).message}`);
    }
  });
  return row;
}

function fileRow(f: UIFileInfo): HTMLElement {
  const row = document.createElement('div');
  row.className = `file${f.name === currentFile ? ' cur' : ''}`;
  row.dataset.name = f.name;
  row.setAttribute('role', 'option');
  row.innerHTML = `<span class="ico${f.localOnly ? ' local' : ''}">XML</span>
    <span class="info"><span class="fname"></span><span class="meta"><span class="size"></span><span class="dirty" hidden> · 未儲存 ●</span></span></span>
    <span class="acts"><button class="rev" title="還原：捨棄沒存檔的修改，回到磁碟上的版本" hidden>↺</button><button class="dup" title="複製">⧉</button><button class="ren" title="重新命名">✎</button><button class="del" title="刪除">✕</button></span>`;
  row.querySelector('.fname')!.textContent = baseName(f.name);
  row.title = `public/ui/${f.name}`;
  row.querySelector('.size')!.textContent = f.localOnly ? '只在瀏覽器' : `${(f.size / 1024).toFixed(1)} KB`;
  row.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('.acts') || f.name === currentFile) return;
    void openFile(f.name);
  });
  row.querySelector('.rev')!.addEventListener('click', () => void revertFile(f.name));
  row.querySelector('.dup')!.addEventListener('click', async () => {
    const name = await askName(`複製「${f.name}」`, f.name.replace(/\.xml$/, '-copy.xml'), '新的檔名');
    if (!name) return;
    const content = f.name === currentFile ? text : (files.draft(f.name) ?? (await files.read(f.name)));
    await createFile(name, content).catch((err) => log(`⚠ ${(err as Error).message}`));
  });
  row.querySelector('.ren')!.addEventListener('click', async () => {
    const name = await askName(
      `重新命名「${f.name}」`,
      f.name,
      '寫成「資料夾/檔名.xml」可以移到別的場景資料夾；只寫檔名會放到共用',
    );
    if (!name) return;
    try {
      await files.rename(f.name, name);
      if (currentFile === f.name) {
        currentFile = name;
        storage.set(LAST_FILE_KEY, name);
      }
      log(`已重新命名為 ${name}（記得更新程式裡註冊的網址）`);
      await refreshFiles();
      updateDocState();
    } catch (err) {
      log(`⚠ ${(err as Error).message}`);
    }
  });
  row.querySelector('.del')!.addEventListener('click', async () => {
    const really = await showConfirm(`${f.localOnly ? '這個檔案只在瀏覽器裡。' : '磁碟上的檔案也會刪除，無法復原。'}`, {
      title: `刪除「${f.name}」`,
      ok: '刪除',
      danger: true,
    });
    if (!really) return;
    try {
      await files.remove(f.name);
      log(`已刪除 ${f.name}`);
      await refreshFiles();
      if (currentFile === f.name) await openFile(fileInfos[0]?.name ?? DEFAULT_FILE);
    } catch (err) {
      log(`⚠ ${(err as Error).message}`);
    }
  });
  return row;
}

function switchLeftTab(tab: 'tree' | 'files'): void {
  $('tabTree').classList.toggle('on', tab === 'tree');
  $('tabFiles').classList.toggle('on', tab === 'files');
  $('filesPane').hidden = tab !== 'files';
  $('treePane').hidden = tab !== 'tree';
  if (tab === 'files') void refreshFiles();
}
$('tabTree').addEventListener('click', () => switchLeftTab('tree'));
$('tabFiles').addEventListener('click', () => switchLeftTab('files'));
$('fileRefresh').addEventListener('click', () => void refreshFiles());

// ───────── 資源管理器：public/ui 裡的圖片（介面檔 .xml 在左側的「檔案」） ─────────
// 點一下預覽；可以插入成 UIImage、套用到選取的元件，或拖到結構、預覽上

const assetListBox = $<HTMLDivElement>('assetList');
const assetDetailBox = $<HTMLDivElement>('assetDetail');
const assetFilterInput = $<HTMLInputElement>('assetFilter');
let assets: UIAssetInfo[] = [];
/** null：還沒讀取；false：沒有開發伺服器 */
let assetsAvailable: boolean | null = null;
let selectedAsset: string | null = null;
const imageSizes = new Map<string, { width: number; height: number }>();

/** 資源的網址（加上修改時間，檔案換掉後縮圖會更新） */
function assetUrl(a: UIAssetInfo): string {
  return `ui/${a.path.split('/').map(encodeURIComponent).join('/')}${a.mtime ? `?v=${Math.round(a.mtime)}` : ''}`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const escapeAttr = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

async function refreshAssets(): Promise<void> {
  const list = await files.listAssets();
  assetsAvailable = list !== null;
  assets = list ?? [];
  if (selectedAsset && !assets.some((a) => a.path === selectedAsset)) selectedAsset = null;
  renderAssets();
}

function visibleAssets(): UIAssetInfo[] {
  const q = assetFilterInput.value.trim().toLowerCase();
  return q ? assets.filter((a) => a.path.toLowerCase().includes(q)) : assets;
}

function renderAssets(): void {
  $('assetCount').textContent = assetsAvailable ? String(assets.length) : '';
  assetListBox.replaceChildren();
  const empty = (message: string) => {
    const div = document.createElement('div');
    div.className = 'asset-empty';
    div.textContent = message;
    assetListBox.appendChild(div);
  };
  if (assetsAvailable === null) empty('讀取中…');
  else if (!assetsAvailable) empty('需要開發伺服器（node hero dev）才能讀取 public/ui 的圖片。');
  else if (!assets.length) empty('public/ui 裡還沒有圖片（png、jpg、svg、webp…）。');
  else {
    const list = visibleAssets();
    if (!list.length) empty('沒有符合的圖片。');
    for (const a of list) assetListBox.appendChild(assetRow(a));
  }
  renderAssetDetail();
}

function assetRow(a: UIAssetInfo): HTMLElement {
  const row = document.createElement('div');
  row.className = `asset${a.path === selectedAsset ? ' sel' : ''}`;
  row.setAttribute('role', 'option');
  row.dataset.path = a.path;
  const thumb = document.createElement('span');
  thumb.className = 'thumb';
  const img = document.createElement('img');
  img.loading = 'lazy';
  img.alt = '';
  img.src = assetUrl(a);
  img.draggable = false;
  thumb.appendChild(img);
  const info = document.createElement('span');
  info.className = 'ainfo';
  const name = document.createElement('span');
  name.className = 'aname';
  const slash = a.path.lastIndexOf('/');
  if (slash >= 0) {
    const dir = document.createElement('span');
    dir.className = 'dir';
    dir.textContent = a.path.slice(0, slash + 1);
    name.append(dir, a.path.slice(slash + 1));
  } else {
    name.textContent = a.path;
  }
  name.title = a.path;
  const meta = document.createElement('span');
  meta.className = 'ameta';
  meta.textContent = formatSize(a.size);
  info.append(name, meta);
  row.append(thumb, info);
  row.title = `${a.path}：點一下預覽、雙擊加入；拖到結構或預覽上可以加入圖片`;

  row.addEventListener('click', () => {
    selectedAsset = selectedAsset === a.path ? null : a.path;
    renderAssets();
  });
  row.addEventListener('dblclick', () => insertImageAsset(relAsset(a.path)));
  row.draggable = true;
  row.addEventListener('dragstart', (e) => {
    // 拖到結構或預覽上：新增 UIImage；拖到原始碼裡：插入路徑文字
    e.dataTransfer!.setData('application/x-ui2d', JSON.stringify({ kind: 'new', xml: imageXml(relAsset(a.path)) }));
    e.dataTransfer!.setData('text/plain', a.path);
    e.dataTransfer!.effectAllowed = 'copy';
  });
  return row;
}

const imageXml = (path: string) => `<UIImage src="${escapeAttr(path)}"/>`;

/** 目前檔案所在的資料夾網址（場景資料夾裡的檔案：ui/forest/），相對路徑以它為基準 */
function docBase(): string {
  const folder = folderOf(currentFile);
  return folder ? `ui/${folder}/` : 'ui/';
}

/** 資源的路徑（相對於 public/ui）→ 從目前檔案寫的相對路徑（場景資料夾裡要加 ../） */
function relAsset(path: string): string {
  const folder = folderOf(currentFile);
  if (!folder) return path;
  return path.startsWith(`${folder}/`) ? path.slice(folder.length + 1) : `../${path}`;
}

function insertImageAsset(path: string): void {
  if (!doc) return;
  const { parent, index } = insertionPoint(doc, selected);
  commit((root) => insertNode(root, parent, index, paletteNode(imageXml(path))));
  log(`已加入圖片 ${path}`);
}

/** 圖片套用到選取的元件：UIImage 設 src，其他元件設背景圖 bgImage */
function applyImageAsset(path: string): void {
  if (!doc || !selected) return;
  const node = nodeAt(doc, selected);
  if (!node) return;
  const key = node.tag === 'UIImage' ? 'src' : 'bgImage';
  setAttr(selected, key, path);
  log(`已設定 ${node.tag} 的 ${key}="${path}"`);
}

async function copyAssetPath(path: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(path);
    log(`已複製路徑 ${path}`);
  } catch {
    log(`路徑：${path}（無法自動複製，請手動選取）`);
  }
}

function renderAssetDetail(): void {
  const a = selectedAsset ? assets.find((x) => x.path === selectedAsset) : undefined;
  assetDetailBox.hidden = !a;
  assetDetailBox.replaceChildren();
  if (!a) return;
  const button = (
    label: string,
    title: string,
    onClick: () => void,
    opts: { primary?: boolean; disabled?: boolean } = {},
  ) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.title = title;
    if (opts.primary) b.className = 'primary';
    b.disabled = !!opts.disabled;
    b.addEventListener('click', onClick);
    return b;
  };
  const meta = document.createElement('div');
  meta.className = 'dmeta';
  const metaText = (dims?: { width: number; height: number }) => {
    meta.textContent = `${formatSize(a.size)}${dims ? ` · ${dims.width} × ${dims.height}` : ''}`;
  };
  metaText(imageSizes.get(a.path));

  const big = document.createElement('div');
  big.className = 'big';
  const img = document.createElement('img');
  img.alt = a.path;
  img.src = assetUrl(a);
  img.addEventListener('load', () => {
    const dims = { width: img.naturalWidth, height: img.naturalHeight };
    imageSizes.set(a.path, dims);
    metaText(dims);
  });
  big.appendChild(img);
  assetDetailBox.appendChild(big);
  const path = document.createElement('div');
  path.className = 'dpath';
  path.textContent = a.path;
  assetDetailBox.append(path, meta);

  const acts = document.createElement('div');
  acts.className = 'dacts';
  const node = doc && selected ? nodeAt(doc, selected) : undefined;
  const target = node ? (node.tag === 'UIImage' ? `${node.tag} 的 src` : `${node.tag} 的背景`) : '';
  acts.append(
    button(
      '插入圖片',
      '在選取的位置加入 <UIImage>（也可以雙擊，或拖到結構、預覽上）',
      () => insertImageAsset(relAsset(a.path)),
      { primary: true },
    ),
    button(
      node ? `設為 ${target}` : '套用到選取的元件',
      node
        ? `把選取的 ${node.tag} 的 ${node.tag === 'UIImage' ? 'src' : 'bgImage'} 設為這張圖`
        : '先在結構或預覽上選取一個元件',
      () => applyImageAsset(relAsset(a.path)),
      { disabled: !node },
    ),
    button('複製路徑', 'XML 裡的寫法（相對於 public/ui）', () => void copyAssetPath(relAsset(a.path))),
  );
  assetDetailBox.appendChild(acts);
}

$('assetRefresh').addEventListener('click', () => void refreshAssets());
assetFilterInput.addEventListener('input', () => renderAssets());
// 回到編輯器時重新讀取（可能在別的程式裡新增、修改了圖片）
window.addEventListener('focus', () => void refreshAssets());
$('fileNew').addEventListener('click', async () => {
  // 預設放在目前檔案所在的資料夾
  const folder = folderOf(currentFile);
  const name = await askName(
    '新的介面檔',
    folder ? `${folder}/new-ui.xml` : 'new-ui.xml',
    '寫成「資料夾/檔名.xml」放到場景資料夾',
  );
  if (name) void createFile(name, newFileTemplate(name)).catch((e) => log(`⚠ ${(e as Error).message}`));
});
// 新增場景：建立資料夾，放入場景介面（hud.xml）與載入頁面（loading.xml）
$('fileNewFolder').addEventListener('click', async () => {
  const input = await showPrompt('資料夾名稱，例如 forest、第二關', `scene${folderNames.length + 1}`, {
    title: '新場景',
    validate: (v) => {
      const n = normalizeFolderName(v);
      if (!n) return '名稱只能用英數字、中文、- _ .，不能以 . 開頭';
      return folderNames.includes(n) ? `已經有資料夾「${n}」` : null;
    },
  });
  if (input === null) return;
  const scene = normalizeFolderName(input)!;
  try {
    if (files.writable) {
      await files.createFolder(scene);
      await files.save(`${scene}/loading.xml`, sceneLoadingTemplate(scene));
      await files.save(`${scene}/hud.xml`, sceneHudTemplate(scene));
    } else {
      files.createLocal(`${scene}/loading.xml`, sceneLoadingTemplate(scene));
      files.createLocal(`${scene}/hud.xml`, sceneHudTemplate(scene));
    }
    collapsedFolders.delete(scene);
    log(`已新增場景 ${scene}：ui/${scene}/hud.xml（場景介面）、ui/${scene}/loading.xml（載入頁面）`);
    await refreshFiles();
    await openFile(`${scene}/hud.xml`);
  } catch (err) {
    log(`⚠ ${(err as Error).message}`);
  }
});
$('saveBtn').addEventListener('click', () => void saveCurrent());
$('reload').addEventListener('click', async () => {
  const ok = await showConfirm(`會捨棄「${currentFile}」沒存檔的修改（可以用復原找回）。`, {
    title: '重新載入檔案',
    ok: '重新載入',
    danger: true,
  });
  if (ok) void reloadFromDisk();
});
$('download').addEventListener('click', () => download(currentFile, text, 'application/xml'));
// Ctrl/⌘ S 存檔（在原始碼視窗裡打字時也可以）
window.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    void saveCurrent();
  }
});
window.addEventListener('beforeunload', (e) => {
  // 草稿已經存在瀏覽器裡；只在不能存檔時提醒
  if (isDirty() && !files.writable) e.preventDefault();
});

// fit 的內容大小在排版後才知道（圖片晚到、文字改變也會變）：每次排版後同步預覽框
ui.onLayout(() => {
  if (doc?.tag === 'UI' && (doc.attrs.width?.trim() === 'fit' || doc.attrs.height?.trim() === 'fit')) syncSizeFromDoc();
});

ui.onLayout(() => {
  if (!drag) refreshOverlays();
});

// ───────── 啟動 ─────────

// 開發模式：方便在瀏覽器主控台檢查（正式打包不會包含）
if (import.meta.env.DEV)
  Object.assign(globalThis, {
    editorDebug: {
      ui,
      get preview() {
        return preview;
      },
      get compUI() {
        return compUI;
      },
    },
  });

renderPalette();
installSplitters();
setSize(1280, 720);
{
  // 舊版的草稿（只編輯 scene.xml 時）搬到 scene.xml 的草稿
  const legacy = storage.get(LEGACY_STORAGE_KEY);
  if (legacy !== null) {
    if (files.draft(DEFAULT_FILE) === null) files.setDraft(DEFAULT_FILE, legacy);
    storage.remove(LEGACY_STORAGE_KEY);
  }
  await refreshFiles();
  const last = storage.get(LAST_FILE_KEY);
  // 網址指定的檔案（例如 3D 場景編輯器的「編輯 UI」：?file=orbit/hud.xml）優先
  const wanted = new URLSearchParams(location.search).get('file');
  if (wanted && !fileInfos.some((f) => f.name === wanted)) log(`⚠ 找不到 public/ui/${wanted}，改開上次的檔案`);
  const first =
    wanted && fileInfos.some((f) => f.name === wanted)
      ? wanted
      : last && fileInfos.some((f) => f.name === last)
        ? last
        : fileInfos.some((f) => f.name === DEFAULT_FILE)
          ? DEFAULT_FILE
          : (fileInfos[0]?.name ?? DEFAULT_FILE);
  await openFile(first);
}
