/**
 * 3D 場景編輯器（開發用，/s3d-editor.html）：編輯專案 public/scenes 裡的場景檔與 public/prefabs 裡的預製物件。
 *
 * 這個檔案只負責把各部分接起來：
 *   doc.ts        場景檔資料與復原／重做（唯一的真實來源）
 *   sync.ts       資料 → world（只更新有變化的部分）
 *   viewport.ts   畫面：編輯器攝影機、點選、控制器、圖示、試玩
 *   hierarchy.ts  階層面板        inspector.ts  屬性面板（fields/ 是輸入欄位，schemas.ts 是欄位說明）
 *   assets.ts     素材面板        prefabs.ts    預製物件（快取、存成預製物件、解除連結）
 *   files.ts      讀寫檔案        presets.ts    「＋」選單的物件
 *
 *   預覽          「預覽」在畫面區域裡跑真正的遊戲頁面（?heroPreview=場景檔），還沒存檔的修改用 BroadcastChannel 即時送過去
 *   uilayer.ts    UI 層：場景檔 ui 欄位的介面檔疊在畫面上，跟著 UI 編輯器即時更新（「編輯 UI」打開 UI 編輯器）
 *
 * 快速鍵：W／E／R 移動／旋轉／縮放（預覽中 Esc 關閉預覽）　Q 切換世界／區域座標　U 顯示／隱藏 UI 層　F 對準選取　Delete 刪除　F2 改名
 *        Cmd/Ctrl+D 複製　Cmd/Ctrl+Z 復原　Shift+Cmd/Ctrl+Z 或 Ctrl+Y 重做　Cmd/Ctrl+S 儲存　Esc 取消選取
 *        Cmd/Ctrl+P 試玩／停止（試玩中 Esc 也可以停止）
 */
import { Model } from '../../assets';
import * as THREE from 'three';
import { Collider, type ColliderShape } from '../../physics';
import {
  SCENE_PREVIEW_CHANNEL,
  SceneCodecsKey,
  Transform,
  expandPrefabs,
  transformCodec,
  type SceneFileData,
  type SceneFileEntity,
  type ScenePreviewMessage,
} from '../../scene';
import type { NavGridFile } from '../../ai';
import { fitCollider } from './colliders';
import { ASSET_MIME, AssetPanel, type AssetRef } from './assets';
import { AssetPreview } from './assetPreview';
import { componentLabel } from './schemas';
import { SceneDoc, duplicateEntities, insertEntity, removeEntities, setSetting, withDescendants } from './doc';
import {
  FOLDER,
  listFiles,
  listScripts,
  listUIFiles,
  newSceneTemplate,
  normalizeSceneName,
  prefabName,
  readFile,
  saveFile,
  saveFileText,
  type DocKind,
  type SceneFileInfo,
  type ScriptInfo,
} from './files';
import { HierarchyPanel } from './hierarchy';
import { Inspector } from './inspector';
import { readMaterial, writeMaterial } from './mesh';
import { PrefabCache, makePrefab, prefabPath, unpackPrefab, writeComponent } from './prefabs';
import { paintCells } from './navgrid';
import { SettingsPanel } from './settings';
import { PRESETS } from './presets';
import { SceneViewport, type GizmoMode } from './viewport';
import { uiEditorName } from '../ui-sync';
import { showConfirm, showPrompt } from '../shared/dialog';
import { requestText } from '../shared/http';
import { storage } from '../shared/storage';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const fileSelect = $<HTMLSelectElement>('fileSelect');
const saveBtn = $<HTMLButtonElement>('saveBtn');
const undoBtn = $<HTMLButtonElement>('undoBtn');
const redoBtn = $<HTMLButtonElement>('redoBtn');
const gridBtn = $<HTMLButtonElement>('gridBtn');
const colliderBtn = $<HTMLButtonElement>('colliderBtn');
const uiBtn = $<HTMLButtonElement>('uiBtn');
const uiEditBtn = $<HTMLButtonElement>('uiEditBtn');
const snapBtn = $<HTMLButtonElement>('snapBtn');
const spaceBtn = $<HTMLButtonElement>('spaceBtn');
const playBtn = $<HTMLButtonElement>('playBtn');
const previewBtn = $<HTMLButtonElement>('previewBtn');
const previewBox = $('preview');
const previewFrame = $<HTMLIFrameElement>('previewFrame');
const backBtn = $<HTMLButtonElement>('backBtn');
const addMenu = $<HTMLSelectElement>('addMenu');
const dupBtn = $<HTMLButtonElement>('dupBtn');
const delBtn = $<HTMLButtonElement>('delBtn');
const docName = $('docName');
const status = $('status');
const viewportEl = $('viewport');

/** 目前開啟的文件 */
interface DocRef {
  kind: DocKind;
  /** 相對於 public/scenes 或 public/prefabs 的檔名 */
  name: string;
}

const doc = new SceneDoc();
/** 選取的物件（展開後的 id；預製物件內部是「實例/內部」）；最後一個是主要選取 */
let selection: string[] = [];
/** 主要選取 */
const primary = () => selection.at(-1) ?? null;
/** 展開預製物件後的資料（畫面、階層的預製物件內部、屬性面板都用它） */
let expanded: SceneFileData = { format: 'hero-scene', version: 1, entities: [] };
/** 實體目前的內容：一般實體是場景檔裡的；預製物件內部的是展開、套用覆蓋後的 */
const entityView = (id: string) => (id.includes('/') ? expanded.entities.find((e) => e.id === id) : doc.get(id));
/** 畫尋路格子的模式 */
let paintMode = false;
let current: DocRef | null = null;
/** 從場景「開啟」預製物件時，記下原本的場景（「返回」按鈕） */
let previous: DocRef | null = null;
const projectSelect = $<HTMLSelectElement>('projectSelect');
/** 目前的專案（開發伺服器的 /__projects；讀不到時是空字串） */
let projectName = '';
/** 上次開的檔案（每個專案各記一個） */
const lastFileKey = () => `s3d-editor:last-file${projectName ? `:${projectName}` : ''}`;
const label = (ref: DocRef) => `${FOLDER[ref.kind]}/${ref.name}`;

const viewport = new SceneViewport(viewportEl, {
  onPick: (id, modifier) => pick(id, modifier),
  onTransformLive: (_id, json) => inspector.live('Transform', json),
  onTransformEnd: (changes) => {
    const name = { translate: '移動', rotate: '旋轉', scale: '縮放' }[viewport.gizmoMode];
    doc.commit(changes.length > 1 ? `${name} ${changes.length} 個物件` : name, (d) => {
      for (const c of changes) writeComponent(d, c.id, 'Transform', c.transform);
    });
  },
  onNavPaint: (cells, erase, done) => {
    const nav = doc.toFile().settings?.navGrid as NavGridFile | undefined;
    if (nav && cells.length)
      doc.commit(
        erase ? '擦掉尋路格子' : '畫尋路格子',
        (d) => setSetting(d, 'navGrid', paintCells(nav, cells, erase)),
        {
          merge: 'navgrid-paint',
        },
      );
    if (done) doc.seal();
  },
  onUIStatus: (error) => {
    if (error) showStatus(`UI 層載入失敗：${error}`, 'error', 8000);
  },
});
const prefabs = new PrefabCache(() => refreshView());
// 素材面板：拖到畫面上放置；雙擊打開預覽小視窗（視窗裡的按鈕放進場景、套用到選取的物件）
const assetPreview = new AssetPreview($('viewport'), {
  place: (asset) => placeAsset(asset, null),
  openShader: (url) => openShaderEditor(url),
  openSound: (url) => {
    const name = url.replace(/^.*\//, '').replace(/\.sfx\.json$/, '');
    window.open(`/se-editor.html?file=${encodeURIComponent(name)}`, 'hero-se-editor');
  },
  saveText: (asset, text) => saveAssetText(asset, text),
});

/** 預覽視窗存回編輯過的原始碼：預製物件先確認格式；畫面上的實例、用到節點圖的材質會跟著更新 */
async function saveAssetText(asset: AssetRef, text: string): Promise<void> {
  if (asset.kind === 'shader') {
    const name = asset.path.replace(/^shaders\//, '');
    await requestText(`/__shaders/files/${encodeURIComponent(name)}`, { method: 'PUT', body: text });
    return; // 開著的畫面會收到存檔通知，自動重新載入材質
  }
  const name = prefabName(asset.path);
  if (asset.kind !== 'prefab' || !name) throw new Error('只能編輯 prefabs/ 裡的預製物件與 shaders/ 裡的節點圖');
  const editingIt = current?.kind === 'prefab' && current.name === name;
  if (editingIt && doc.dirty) throw new Error('這個預製物件正在編輯器裡打開，而且有沒儲存的修改：先儲存或放棄那些修改');
  const { data } = await saveFileText('prefab', name, text);
  prefabs.set(asset.path, data);
  if (editingIt && current) await open(current);
  else refreshView();
}
const assets = new AssetPanel($('assets'), (asset) => assetPreview.open(asset));
const hierarchy = new HierarchyPanel($('tree'), doc, {
  onSelect: (ids) => select(ids),
  keepWorld,
  innerChildren: (parent) => expanded.entities.filter((e) => e.parent === parent && e.id.includes('/')),
  // 滑鼠移到階層的項目：畫面上那個物件出現外框與名稱標籤
  onHover: (id) => {
    const e = id !== null ? entityView(id) : undefined;
    if (id === null || !e) return viewport.setHover(null);
    const detail = e.prefab
      ? `預製物件：${e.prefab}`
      : Object.keys(e.components ?? {})
          .map(componentLabel)
          .join('、');
    viewport.setHover(id, { name: e.name ?? id, detail });
  },
});
const settingsPanel = new SettingsPanel($('props'), doc, {
  paintMode: () => paintMode,
  setPaintMode: (on) => {
    paintMode = on;
    viewport.paintMode = on;
    viewportEl.classList.toggle('painting', on);
    if (on) showStatus('畫尋路格子：左鍵拖曳畫擋住的地方，按住 Shift 擦掉；右鍵拖曳平移攝影機', 'info', 6000);
  },
  colliderBoxes: () => viewport.colliderBoxes(),
  status: (m, kind) => showStatus(m, kind),
  uiFiles: () => listUIFiles(),
  openUI: (url) => openUIEditor(url),
});
const inspector = new Inspector($('props'), doc, {
  entity: (id) => entityView(id),
  renderEmpty: () => settingsPanel.render(),
  codecs: () => viewport.world.requireResource(SceneCodecsKey),
  suggest: (kind, id) => {
    if (kind === 'models') return assets.paths('model');
    if (kind === 'sounds') return assets.paths('audio');
    const e = viewport.sync.entityOf(id);
    return (e !== undefined ? viewport.world.get(e, Model)?.animations : undefined)?.map((c) => c.name) ?? [];
  },
  openPrefab: (path) => {
    const name = prefabName(path);
    if (!name) return showStatus(`${path} 不在 ${FOLDER.prefab}/ 裡，不能在這裡編輯`, 'error');
    const from = current;
    void open({ kind: 'prefab', name }).then((ok) => {
      if (ok && from?.kind === 'scene') previous = from;
      updateToolbar();
    });
  },
  unpackPrefab: (id) => {
    if (!doc.commit('解除連結', (d) => unpackPrefab(d, id, prefabs)))
      showStatus('預製物件還沒讀到（或讀取失敗），不能解除連結', 'error');
  },
  makePrefab: (id) => void saveAsPrefab(id),
  fitCollider: (id) => fitColliderToMesh(id),
  scripts: () => scriptInfos,
  shaderGraphs: () => assets.paths('shader'),
  openShader: (url) => {
    if (!url) showStatus('專案裡還沒有節點圖：在著色器編輯器新增、儲存後，再回來選「節點圖」', 'warn');
    openShaderEditor(url);
  },
});

/** 專案 src/ 裡的腳本（開啟時讀一次；回到編輯器分頁時重新讀：改了程式馬上看得到） */
let scriptInfos: ScriptInfo[] = [];
async function refreshScripts(): Promise<void> {
  try {
    const next = await listScripts();
    if (JSON.stringify(next) === JSON.stringify(scriptInfos)) return;
    scriptInfos = next;
    inspector.show(selection); // 「加入腳本」與參數欄位跟著更新
  } catch {
    /* 舊版開發伺服器沒有 /__scenes/scripts：選單會是空的 */
  }
}
void refreshScripts();
window.addEventListener('focus', () => {
  void refreshScripts();
  // 著色器編輯器新存的節點圖檔、放進 public 的素材
  const before = assets.paths('shader').join();
  void assets.refresh().then(() => {
    if (assets.paths('shader').join() !== before) inspector.show(selection);
  });
});

// ───────── 狀態列 ─────────

let statusTimer = 0;
function showStatus(message: string, kind: 'info' | 'warn' | 'error' = 'info', ms = 4000): void {
  status.textContent = message;
  status.className = kind === 'info' ? '' : kind;
  clearTimeout(statusTimer);
  if (ms > 0) statusTimer = window.setTimeout(() => (status.textContent = ''), ms);
}

// ───────── 選取與資料變動 ─────────

/** 設定選取（null 或空陣列代表不選；最後一個是主要選取） */
function select(ids: string | readonly string[] | null): void {
  const list = ids === null ? [] : typeof ids === 'string' ? [ids] : [...ids];
  selection = [...new Set(list)].filter((id) => entityView(id) !== undefined);
  viewport.select(selection);
  hierarchy.select(selection);
  inspector.show(selection);
  // 沒有選取時屬性面板是場景設定：顯示尋路格子；離開時結束畫格子
  viewport.navGridVisible = selection.length === 0;
  if (selection.length && paintMode) {
    paintMode = false;
    viewport.paintMode = false;
    viewportEl.classList.remove('painting');
  }
  dupBtn.disabled = delBtn.disabled = !selection.some((id) => !id.includes('/'));
}

/**
 * 在畫面上點選：預製物件裡的東西第一次點選到整個實例，實例（或它裡面的東西）已經選取時再點，選到裡面的那個物件。
 * 按著 Shift 或 Cmd/Ctrl：加選或取消選取。
 */
function pick(id: string | null, modifier: boolean): void {
  let target = id;
  if (id?.includes('/')) {
    const instance = id.split('/')[0];
    const drilled = selection.some((s) => s === instance || s.startsWith(`${instance}/`));
    target = drilled ? id : instance;
  }
  if (!modifier) return select(target);
  if (target === null) return;
  select(selection.includes(target) ? selection.filter((s) => s !== target) : [...selection, target]);
}

let lastWarnings = '';
/** 依目前的資料更新畫面（預製物件讀好後也會呼叫） */
function refreshView(): void {
  const data = prefabs.attach(doc.toFile());
  try {
    expanded = expandPrefabs(data, { missing: 'skip' }).data;
  } catch {
    expanded = data; // 預製物件互相包含等錯誤：畫面的警告會說明
  }
  const warnings = [...viewport.show(data)];
  for (const e of doc.entities) {
    const error = e.prefab ? prefabs.errorOf(e.prefab) : undefined;
    if (error) warnings.unshift(`「${e.name ?? e.id}」的預製物件 ${e.prefab} 讀不到：${error}`);
  }
  const w = warnings.join('\n');
  if (w && w !== lastWarnings) showStatus(`${warnings.length} 個警告：${warnings[0]}`, 'warn', 8000);
  lastWarnings = w;
}

doc.onChange((kind) => {
  refreshView();
  if (kind === 'load') select(null);
  else if (selection.some((id) => !entityView(id))) select(selection);
  else {
    hierarchy.render();
    inspector.refresh();
    viewport.select(selection); // 加減 Transform 後控制器要跟著出現／消失
  }
  schedulePreviewSync();
  if (kind === 'undo') showStatus('復原', 'info', 1200);
  if (kind === 'redo') showStatus('重做', 'info', 1200);
  updateToolbar();
});

function updateToolbar(): void {
  undoBtn.disabled = !doc.canUndo;
  redoBtn.disabled = !doc.canRedo;
  undoBtn.title = doc.undoLabel ? `復原：${doc.undoLabel}（Cmd/Ctrl+Z）` : '復原（Cmd/Ctrl+Z）';
  redoBtn.title = doc.redoLabel ? `重做：${doc.redoLabel}（Shift+Cmd/Ctrl+Z）` : '重做（Shift+Cmd/Ctrl+Z）';
  saveBtn.disabled = current === null;
  playBtn.disabled = current === null;
  previewBtn.disabled = current === null;
  docName.textContent = current ? label(current) : '尚未開啟';
  docName.classList.toggle('dirty', doc.dirty);
  docName.classList.toggle('prefab', current?.kind === 'prefab');
  backBtn.hidden = !(previous && current?.kind === 'prefab');
  const uiFiles = doc.toFile().ui ?? [];
  uiEditBtn.disabled = current === null;
  uiEditBtn.title = uiFiles.length
    ? `在 UI 編輯器打開 ${uiFiles.at(-1)}（另一個分頁），修改會即時顯示在 UI 層`
    : '這個場景還沒有搭配介面檔：不選物件，在屬性面板的「介面（UI 層）」加入';
  if (previous) backBtn.textContent = `← 回到 ${previous.name}`;
  document.title = `${doc.dirty ? '● ' : ''}${current?.name ?? ''} — 3D 場景編輯器`;
}

// ───────── 檔案 ─────────

const refValue = (ref: DocRef) => `${ref.kind}:${ref.name}`;

async function refreshFileList(): Promise<{ scenes: SceneFileInfo[]; prefabs: SceneFileInfo[] }> {
  const [scenes, prefabList] = await Promise.all([listFiles('scene'), listFiles('prefab')]);
  fileSelect.replaceChildren();
  const placeholder = new Option(scenes.length + prefabList.length ? '選擇檔案…' : '還沒有場景檔', '');
  placeholder.disabled = true;
  fileSelect.add(placeholder);
  for (const [kind, title, list] of [
    ['scene', '場景（public/scenes）', scenes],
    ['prefab', '預製物件（public/prefabs）', prefabList],
  ] as const) {
    if (!list.length) continue;
    const group = document.createElement('optgroup');
    group.label = title;
    for (const f of list) group.append(new Option(f.name, refValue({ kind, name: f.name })));
    fileSelect.append(group);
  }
  fileSelect.value = current ? refValue(current) : '';
  return { scenes, prefabs: prefabList };
}

const confirmDiscard = async () =>
  !doc.dirty ||
  !current ||
  (await showConfirm(`${label(current)} 有沒儲存的修改，要放棄嗎？`, {
    title: '放棄修改',
    ok: '放棄修改',
    danger: true,
  }));

async function open(ref: DocRef): Promise<boolean> {
  if (viewport.playing) stopPlay();
  closePreview();
  if (!(await confirmDiscard())) {
    fileSelect.value = current ? refValue(current) : '';
    return false;
  }
  try {
    const data = await readFile(ref.kind, ref.name);
    current = ref;
    previous = null;
    lastWarnings = '';
    prefabs.clear(); // 重新讀取預製物件（可能在別的地方改過）
    doc.load(data);
    storage.set(lastFileKey(), refValue(ref));
    fileSelect.value = refValue(ref);
    if (!status.classList.contains('warn')) showStatus(`已開啟 ${label(ref)}`);
    return true;
  } catch (error) {
    showStatus(`開啟 ${label(ref)} 失敗：${(error as Error).message}`, 'error', 0);
    fileSelect.value = current ? refValue(current) : '';
    return false;
  }
}

async function save(): Promise<void> {
  if (!current) return;
  const data = doc.toFile();
  if (current.kind === 'prefab') {
    const roots = data.entities.filter((e) => e.parent === undefined).length;
    if (roots !== 1)
      return showStatus(
        `預製物件要剛好有一個最上層的物件（現在有 ${roots} 個），請把其他物件拖進根節點底下`,
        'error',
        0,
      );
  }
  try {
    await saveFile(current.kind, current.name, data);
    if (current.kind === 'prefab') {
      prefabs.set(prefabPath(current.name), data);
      void assets.refresh();
    }
    await refreshFileList();
    doc.markSaved();
    sendPreview({ type: 'saved', path: label(current), reload: false }); // 開發伺服器會通知遊戲重新載入
    showStatus(`已儲存 ${label(current)}`);
  } catch (error) {
    showStatus(`儲存失敗：${(error as Error).message}`, 'error', 0);
  }
}

async function createScene(): Promise<void> {
  if (!(await confirmDiscard())) return;
  const files = await listFiles('scene');
  const input = await showPrompt('存在 public/scenes/，可以用一層資料夾，例如 levels/forest', 'untitled', {
    title: '新場景的檔名',
    validate: (v) => {
      const n = normalizeSceneName(v);
      if (!n) return '檔名只能用英數字、中文、- _ .，最多一層資料夾';
      return files.some((f) => f.name === n) ? `已經有 ${n}，請換一個名稱` : null;
    },
  });
  if (input === null) return;
  const name = normalizeSceneName(input)!;
  current = { kind: 'scene', name };
  previous = null;
  doc.load(newSceneTemplate());
  await save();
}

// ───────── 物件操作 ─────────

function addEntity(label: string, entity: SceneFileEntity): void {
  let id = '';
  doc.commit(`加入${label}`, (d) => {
    id = insertEntity(d, entity);
  });
  select(id);
}

function addPreset(groupIndex: number, itemIndex: number): void {
  const preset = PRESETS[groupIndex][1][itemIndex];
  addEntity(preset.label, { id: preset.id, ...preset.make(viewport.spawnPoint()) });
}

/** 選取裡的場景物件（預製物件內部的不算） */
const docSelection = () => selection.filter((id) => !id.includes('/'));

function duplicateSelected(): void {
  const from = docSelection();
  if (!from.length) return showStatus('預製物件裡的物件不能單獨複製', 'warn');
  let ids: string[] = [];
  doc.commit(from.length > 1 ? `複製 ${from.length} 個物件` : '複製', (d) => {
    ids = duplicateEntities(d, from);
  });
  select(ids);
}

function deleteSelected(): void {
  const ids = docSelection();
  if (!ids.length) {
    if (selection.length) showStatus('預製物件裡的物件不能刪除（可以在屬性面板移除它的元件）', 'warn');
    return;
  }
  const kids = ids.some((id) => doc.childrenOf(id).length > 0);
  const label = ids.length > 1 ? `刪除 ${ids.length} 個物件` : '刪除';
  doc.commit(kids ? `${label}（含子物件）` : label, (d) => removeEntities(d, ids));
}

/** 檔名（不含資料夾與副檔名），當作新物件的名稱 */
const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '');

/**
 * 放置素材：模型、預製物件放在 at（滑鼠下的位置；null 時放在畫面中央）；
 * 貼圖放到 target 的材質上（null 時用選取的物件）。
 */
function placeAsset(asset: AssetRef, at: { point: number[]; id: string | null } | null): void {
  if (!current) return showStatus('先開啟或新增一個場景', 'error');
  const point = at?.point ?? viewport.spawnPoint();
  if (asset.kind === 'model') {
    addEntity('模型', {
      id: baseName(asset.path),
      name: baseName(asset.path),
      components: { Transform: { position: point }, Model: { url: asset.path, castShadow: true, receiveShadow: true } },
    });
  } else if (asset.kind === 'prefab') {
    if (current.kind === 'prefab' && asset.path === prefabPath(current.name))
      return showStatus('不能把預製物件放進它自己裡面', 'error');
    // 名稱用預製物件根節點的名稱（還沒讀到時用檔名）
    const rootName = prefabs.get(asset.path)?.entities.find((e) => e.parent === undefined)?.name;
    addEntity('預製物件', {
      id: baseName(asset.path),
      name: rootName ?? baseName(asset.path),
      prefab: asset.path,
      components: { Transform: { position: point } },
    });
  } else if (asset.kind === 'audio') {
    // 拖到物件上：加在那個物件（預製物件裡的東西加在實例上）；空白處：新增音效物件
    const target = at ? at.id : primary();
    const source = { url: asset.path, loop: true, playing: true };
    if (target && entityView(target)) {
      doc.commit('加上音效', (d) => writeComponent(d, target, 'AudioSource', source));
      select(target);
    } else
      addEntity('音效', {
        id: baseName(asset.path),
        name: baseName(asset.path),
        components: { Transform: { position: point }, AudioSource: source },
      });
  } else if (asset.kind === 'shader') {
    const hit = at ? at.id : primary();
    if (!hit) return showStatus('把節點圖拖到畫面上的物件，或先選一個物件，再按預覽視窗的「套用到選取的物件」', 'warn');
    const mesh = entityView(hit)?.components?.MeshRenderer as Record<string, unknown> | undefined;
    if (!mesh) return showStatus('這個物件沒有網格，不能套用節點圖材質', 'warn');
    doc.commit('套用節點圖材質', (d) =>
      writeComponent(d, hit, 'MeshRenderer', { ...mesh, material: { shaderGraph: asset.path } }),
    );
    select(hit);
  } else {
    const hit = at ? at.id : primary();
    if (!hit) return showStatus('把貼圖拖到畫面上的物件，或先選一個物件，再按預覽視窗的「套用到選取的物件」', 'warn');
    const mesh = entityView(hit)?.components?.MeshRenderer as Record<string, unknown> | undefined;
    if (!mesh) return showStatus('這個物件沒有網格，不能加貼圖', 'warn');
    const m = readMaterial(mesh.material);
    if (!m) return showStatus('這個物件的材質不是一般的顏色／standard 材質，請用 JSON 編輯加上 map', 'warn');
    doc.commit('加上貼圖', (d) =>
      writeComponent(d, hit, 'MeshRenderer', {
        ...mesh,
        material: writeMaterial({ ...m, extra: { ...m.extra, map: asset.path } }),
      }),
    );
    select(hit);
  }
}

/** 換父節點時保留世界位置：新的 Transform = 新父節點世界矩陣的反矩陣 × 自己的世界矩陣 */
function keepWorld(id: string, parent: string | null): unknown {
  const world = viewport.worldMatrixOf(id);
  if (!world) return undefined;
  const parentWorld = parent !== null ? viewport.worldMatrixOf(parent) : new THREE.Matrix4();
  if (!parentWorld) return undefined;
  const t = Transform.create();
  world.premultiply(parentWorld.invert()).decompose(t.position, t.rotation, t.scale);
  return transformCodec.write(t);
}

/** 碰撞體「符合網格大小」 */
function fitColliderToMesh(id: string): void {
  const bounds = viewport.localBoundsOf(id);
  if (!bounds) return showStatus('這個物件沒有網格或模型（模型要先載入完成）', 'warn');
  const current = (entityView(id)?.components?.Collider ?? {}) as Record<string, unknown>;
  const shape = (current.shape as ColliderShape | undefined) ?? Collider.create().shape;
  if (shape === 'convexHull' || shape === 'trimesh') return showStatus('凸包、三角網格本來就用網格的形狀', 'info');
  const next: Record<string, unknown> = { ...current };
  for (const key of ['halfExtents', 'radius', 'halfHeight', 'offset']) delete next[key];
  doc.commit('符合網格大小', (d) => writeComponent(d, id, 'Collider', { ...next, ...fitCollider(shape, bounds) }));
}

/** 存成預製物件：選取的物件（連同子物件）存到 public/prefabs，場景裡換成實例 */
async function saveAsPrefab(id: string): Promise<void> {
  const entity = doc.get(id);
  if (!entity || !current) return;
  const editing = current;
  const input = await showPrompt('存在 public/prefabs/', entity.id, {
    title: '預製物件的檔名',
    validate: (v) => {
      const n = normalizeSceneName(v);
      if (!n) return '檔名只能用英數字、中文、- _ .，最多一層資料夾';
      return editing.kind === 'prefab' && editing.name === n ? '不能存成正在編輯的這個預製物件' : null;
    },
  });
  if (input === null) return;
  const name = normalizeSceneName(input)!;
  const existing = await listFiles('prefab');
  if (
    existing.some((f) => f.name === name) &&
    !(await showConfirm(`已經有預製物件 ${name}，要覆蓋嗎？用到它的地方都會變。`, { ok: '覆蓋', danger: true }))
  )
    return;
  const path = prefabPath(name);
  const { prefab, instance } = makePrefab(doc.toFile(), id, path);
  try {
    await saveFile('prefab', name, prefab);
  } catch (error) {
    return showStatus(`儲存預製物件失敗：${(error as Error).message}`, 'error', 0);
  }
  prefabs.set(path, prefab);
  doc.commit('存成預製物件', (d) => {
    const family = withDescendants(d, [id]);
    family.delete(id);
    d.entities = d.entities.filter((e) => !family.has(e.id)).map((e) => (e.id === id ? instance : e));
  });
  select(id);
  void assets.refresh();
  await refreshFileList();
  showStatus(`已存成預製物件 ${path}（要記得儲存場景）`);
}

function setGizmo(mode: GizmoMode): void {
  viewport.gizmoMode = mode;
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-gizmo]'))
    b.classList.toggle('on', b.dataset.gizmo === mode);
}

function toggleSpace(): void {
  const local = spaceBtn.dataset.space !== 'local';
  spaceBtn.dataset.space = local ? 'local' : 'world';
  spaceBtn.textContent = local ? '區域' : '世界';
  viewport.gizmoSpace = local ? 'local' : 'world';
}

function toggleSnap(): void {
  const on = !snapBtn.classList.contains('on');
  snapBtn.classList.toggle('on', on);
  viewport.setSnap(on ? { translate: 0.25, rotate: 15, scale: 0.1 } : null);
}

// ───────── 預覽：真正的遊戲 ─────────

/**
 * 預覽中的遊戲（同一個瀏覽器的 iframe 或新分頁）會收聽這個頻道：
 * 還沒存檔的內容即時送過去（遊戲裡那個場景自動重新載入），存檔或改回原狀後改讀磁碟上的檔案。
 */
const previewChannel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(SCENE_PREVIEW_CHANNEL) : null;
function sendPreview(msg: ScenePreviewMessage): void {
  try {
    previewChannel?.postMessage(msg);
  } catch {
    /* 關閉中：略過 */
  }
}
/** 上一次送出草稿的檔案（換檔案時要通知遊戲改回磁碟上的內容） */
let draftPath: string | null = null;
let previewTimer = 0;
function syncPreview(): void {
  const path = current ? label(current) : null;
  if (draftPath && draftPath !== path) sendPreview({ type: 'saved', path: draftPath });
  draftPath = null;
  if (!path) return;
  if (doc.dirty) {
    sendPreview({ type: 'draft', path, data: doc.toFile() });
    draftPath = path;
  } else sendPreview({ type: 'saved', path });
}
/** 資料改了：等一下再送（連續拖曳時不會每一幀都送） */
function schedulePreviewSync(): void {
  clearTimeout(previewTimer);
  previewTimer = window.setTimeout(syncPreview, 150);
}
previewChannel?.addEventListener('message', (e: MessageEvent<ScenePreviewMessage>) => {
  // 預覽的遊戲剛開啟：送出還沒存檔的內容
  if (e.data?.type === 'request' && current && doc.dirty) syncPreview();
});

/** 預覽的網址：遊戲頁面加上 ?heroPreview=場景檔（編輯預製物件時用開啟它的場景） */
function previewUrl(): string | null {
  if (!current) return null;
  const target = current.kind === 'prefab' && previous ? previous : current;
  return `./?heroPreview=${encodeURIComponent(label(target))}`;
}

function openPreview(): void {
  const url = previewUrl();
  if (!url || !current) return;
  if (viewport.playing) stopPlay();
  const target = current.kind === 'prefab' && previous ? previous : current;
  $('previewTitle').innerHTML = '';
  const title = $('previewTitle');
  title.append('預覽 ', Object.assign(document.createElement('b'), { textContent: label(target) }));
  title.append(
    current.kind === 'prefab' && !previous
      ? '（預製物件：遊戲照常開始，用到它的場景會套用修改）'
      : '：和遊戲一樣（遊戲程式、介面、腳本都會跑），還沒存檔的修改會即時套用',
  );
  previewFrame.src = url;
  previewBox.hidden = false;
  document.body.classList.add('previewing');
  previewBtn.classList.add('on');
  viewport.engine.pause(); // 編輯畫面被蓋住：不用繪製
  previewFrame.focus();
}

function closePreview(): void {
  if (previewBox.hidden) return;
  previewFrame.src = 'about:blank'; // 停止遊戲（音效、迴圈）
  previewBox.hidden = true;
  document.body.classList.remove('previewing');
  previewBtn.classList.remove('on');
  viewport.engine.resume();
}

previewBtn.addEventListener('click', () => (previewBox.hidden ? openPreview() : closePreview()));
$('previewClose').addEventListener('click', closePreview);
$('previewRestart').addEventListener('click', () => {
  const url = previewUrl();
  if (url) previewFrame.src = url;
});
$('previewTab').addEventListener('click', () => {
  const url = previewUrl();
  if (url) window.open(url, 'hero-game-preview');
});

// ───────── UI 層 ─────────

/** 在 UI 編輯器打開介面檔（同一個分頁重複使用）；修改會透過 BroadcastChannel 即時傳回 UI 層 */
function openUIEditor(url: string): void {
  const name = uiEditorName(url);
  if (!name) return showStatus(`${url} 不在 public/ui 裡，UI 編輯器打不開`, 'error');
  const win = window.open(`ui-editor.html?file=${encodeURIComponent(name)}`, 'hero-ui-editor');
  if (!win) showStatus('瀏覽器擋住了新分頁，請允許這個網站開啟彈出視窗', 'warn', 6000);
  else showStatus(`已在 UI 編輯器打開 ${url}：修改會即時顯示在 UI 層`);
}

/** 「編輯 UI」：打開場景最上層的介面檔（通常是這個場景自己的 HUD） */
function editSceneUI(): void {
  const files = doc.toFile().ui ?? [];
  if (!files.length) {
    select(null); // 屬性面板顯示場景設定
    return showStatus('這個場景還沒有搭配介面檔：在右邊「介面（UI 層）」加入 public/ui 的介面檔', 'warn', 6000);
  }
  openUIEditor(files.at(-1)!);
}

// ───────── 試玩 ─────────

async function startPlay(): Promise<void> {
  if (!current || viewport.playing) return;
  closePreview();
  document.body.classList.add('playing');
  playBtn.textContent = '■ 停止';
  playBtn.classList.add('on');
  showStatus('準備物理引擎…', 'info', 0);
  try {
    const camera = await viewport.play();
    if (!viewport.playing) return;
    const name = camera ? (doc.get(camera)?.name ?? camera) : null;
    showStatus(
      name
        ? `試玩中：從「${name}」看。按 Esc 或「停止」結束`
        : '試玩中（場景沒有攝影機，用編輯器的攝影機）。按 Esc 或「停止」結束',
      'info',
      0,
    );
  } catch (error) {
    stopPlay();
    showStatus(`無法試玩：${(error as Error).message}`, 'error', 0);
  }
}

function stopPlay(): void {
  viewport.stop();
  document.body.classList.remove('playing');
  playBtn.textContent = '▶ 試玩';
  playBtn.classList.remove('on');
  showStatus('已停止，回到編輯前的狀態', 'info', 2000);
}

// 「＋」選單
for (const [gi, [group, items]] of PRESETS.entries()) {
  const og = document.createElement('optgroup');
  og.label = group;
  items.forEach((p, ii) => og.append(new Option(p.label, `${gi}:${ii}`)));
  addMenu.append(og);
}

// ───────── 事件 ─────────

fileSelect.addEventListener('change', () => {
  const [kind, ...rest] = fileSelect.value.split(':');
  if (rest.length) void open({ kind: kind as DocKind, name: rest.join(':') });
});
$('newBtn').addEventListener('click', () => void createScene());
$('reloadBtn').addEventListener('click', () => {
  if (current) void open(current);
});
backBtn.addEventListener('click', () => {
  if (previous) void open(previous);
});
saveBtn.addEventListener('click', () => void save());
undoBtn.addEventListener('click', () => doc.undo());
redoBtn.addEventListener('click', () => doc.redo());
playBtn.addEventListener('click', () => (viewport.playing ? stopPlay() : void startPlay()));
gridBtn.addEventListener('click', () => {
  const on = !gridBtn.classList.contains('on');
  gridBtn.classList.toggle('on', on);
  viewport.gridVisible = on;
});
colliderBtn.addEventListener('click', () => {
  const on = !colliderBtn.classList.contains('on');
  colliderBtn.classList.toggle('on', on);
  viewport.collidersVisible = on;
});
/** UI 層的開關（記在瀏覽器裡，重新整理後維持） */
const UI_LAYER_KEY = 's3d-editor:ui-layer';
function setUILayerVisible(on: boolean, remember = true): void {
  uiBtn.classList.toggle('on', on);
  viewport.uiLayer.visible = on;
  if (!remember) return;
  storage.set(UI_LAYER_KEY, on ? '1' : '0');
}
function toggleUILayer(): void {
  const on = !uiBtn.classList.contains('on');
  setUILayerVisible(on);
  showStatus(on ? 'UI 層：顯示（U 鍵切換）' : 'UI 層：隱藏（U 鍵切換）', 'info', 1500);
}
uiBtn.addEventListener('click', toggleUILayer);

if (storage.get(UI_LAYER_KEY) === '0') setUILayerVisible(false, false);
uiEditBtn.addEventListener('click', editSceneUI);
// 著色器編輯器（另一個分頁）
/** 在另一個分頁打開著色器編輯器（url：要開的節點圖檔；空字串只打開編輯器） */
function openShaderEditor(url: string): void {
  const name = url.replace(/^.*\//, '').replace(/\.shader\.json$/, '');
  window.open(`/shader-editor.html${name ? `?file=${encodeURIComponent(name)}` : ''}`, 'hero-shader-editor');
}
snapBtn.addEventListener('click', toggleSnap);
spaceBtn.addEventListener('click', toggleSpace);
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-gizmo]'))
  b.addEventListener('click', () => setGizmo(b.dataset.gizmo as GizmoMode));
addMenu.addEventListener('change', () => {
  const [g, i] = addMenu.value.split(':').map(Number);
  addMenu.value = '';
  if (current && Number.isFinite(g)) addPreset(g, i);
});
dupBtn.addEventListener('click', duplicateSelected);
delBtn.addEventListener('click', deleteSelected);
$<HTMLInputElement>('assetFilter').addEventListener('input', (e) =>
  assets.setFilter((e.target as HTMLInputElement).value),
);
$('assetRefresh').addEventListener('click', () => void assets.refresh());

// 素材拖進畫面
viewportEl.addEventListener('dragover', (e) => {
  if (!e.dataTransfer?.types.includes(ASSET_MIME) || viewport.playing) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  viewportEl.classList.add('drop');
});
viewportEl.addEventListener('dragleave', () => viewportEl.classList.remove('drop'));
viewportEl.addEventListener('drop', (e) => {
  viewportEl.classList.remove('drop');
  const raw = e.dataTransfer?.getData(ASSET_MIME);
  if (!raw || viewport.playing) return;
  e.preventDefault();
  placeAsset(JSON.parse(raw) as AssetRef, viewport.dropPoint(e.clientX, e.clientY));
});

const typing = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));

window.addEventListener('keydown', (e) => {
  const mod = e.metaKey || e.ctrlKey;
  const key = e.key.toLowerCase();
  if (mod && key === 'p') {
    e.preventDefault();
    if (viewport.playing) stopPlay();
    else void startPlay();
    return;
  }
  if (viewport.playing) {
    if (key === 'escape') stopPlay();
    return; // 試玩中不能編輯
  }
  if (!previewBox.hidden && key === 'escape' && !typing(e.target)) {
    closePreview();
    return;
  }
  if (mod && key === 's') {
    e.preventDefault();
    void save();
    return;
  }
  if (typing(e.target)) return;
  if (mod && key === 'z') {
    e.preventDefault();
    if (e.shiftKey) doc.redo();
    else doc.undo();
  } else if (mod && key === 'y') {
    e.preventDefault();
    doc.redo();
  } else if (mod && key === 'd') {
    e.preventDefault();
    duplicateSelected();
  } else if (mod || e.altKey) {
    return;
  } else if (key === 'w') setGizmo('translate');
  else if (key === 'e') setGizmo('rotate');
  else if (key === 'r') setGizmo('scale');
  else if (key === 'q') toggleSpace();
  else if (key === 'u') toggleUILayer();
  else if (key === 'f' && selection.length) viewport.focus(selection);
  else if (key === 'f2' && primary()) hierarchy.rename(primary()!);
  else if (key === 'escape') select(null);
  else if (key === 'delete' || key === 'backspace') {
    e.preventDefault();
    deleteSelected();
  }
});

window.addEventListener('beforeunload', (e) => {
  if (doc.dirty) e.preventDefault();
});

// 除錯用：在瀏覽器主控台可以用 s3dEditor.doc、s3dEditor.viewport 查看狀態（自動測試也用它）
(window as unknown as { s3dEditor: unknown }).s3dEditor = {
  doc,
  viewport,
  prefabs,
  select,
  get selected() {
    return primary();
  },
  get selection() {
    return selection;
  },
  get expanded() {
    return expanded;
  },
  get current() {
    return current;
  },
};

// ───────── 專案 ─────────

/** 讀取專案清單，填入選單 */
async function loadProjects(): Promise<void> {
  try {
    const res = await fetch('/__projects', { cache: 'no-store' });
    if (!res.ok) throw new Error(String(res.status));
    const { current: name, projects } = (await res.json()) as { current: string; projects: string[] };
    projectName = name;
    projectSelect.replaceChildren(...projects.map((p) => new Option(`📁 ${p}`, p)));
    projectSelect.value = name;
  } catch {
    projectSelect.hidden = true; // 舊版的開發伺服器：沒有切換功能
  }
}

/** 切換專案：開發伺服器換成那個專案後重新啟動，頁面重新整理 */
async function switchProject(name: string): Promise<void> {
  if (name === projectName) return;
  if (!(await confirmDiscard())) {
    projectSelect.value = projectName;
    return;
  }
  closePreview();
  doc.load(doc.toFile()); // 已經確認放棄修改：離開頁面時不要再問
  projectSelect.disabled = true;
  showStatus(`切換到專案 ${name}，開發伺服器重新啟動中…`, 'info', 0);
  try {
    const res = await fetch('/__projects/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const r = (await res.json()) as { error?: string };
    if (!res.ok) throw new Error(r.error ?? String(res.status));
  } catch (error) {
    projectSelect.disabled = false;
    projectSelect.value = projectName;
    return showStatus(`切換專案失敗：${(error as Error).message}`, 'error', 0);
  }
  // 等開發伺服器換好專案再重新整理（Vite 重新連線時也可能自己重新整理）
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const res = await fetch('/__projects', { cache: 'no-store' });
      if (res.ok && ((await res.json()) as { current: string }).current === name) break;
    } catch {
      /* 重新啟動中 */
    }
  }
  location.reload();
}

projectSelect.addEventListener('change', () => void switchProject(projectSelect.value));

// ───────── 開始 ─────────

await loadProjects();

select(null);
updateToolbar();
hierarchy.render();
void assets.refresh();
refreshFileList()
  .then(({ scenes }) => {
    const last = storage.get(lastFileKey());
    const options = [...fileSelect.options].map((o) => o.value).filter(Boolean);
    const value =
      last && options.includes(last) ? last : scenes[0] ? refValue({ kind: 'scene', name: scenes[0].name }) : null;
    if (value) {
      const [kind, ...rest] = value.split(':');
      void open({ kind: kind as DocKind, name: rest.join(':') });
    } else $('tree').innerHTML = '<div class="empty">還沒有場景檔，按「新增場景」開始</div>';
  })
  .catch((error: Error) => showStatus(`讀取檔案清單失敗：${error.message}（要用 node hero dev 開啟）`, 'error', 0));
