/**
 * 入口頁（/portal.html）：置中的毛玻璃對話框列出 projects/ 裡的專案，點一下切換專案，也可以新增、匯入（別人的）、刪除、打包專案
 * （同 node hero create／remove／build：檔案操作共用 tools/project-files.js；打包在背景執行 node hero build，
 * 見 tools/project-build.ts）。
 * 切換＝ node hero select 名稱（寫進 .selected-project）＋ 開發伺服器換成那個專案後重新啟動（tools/project.ts 的 /__projects）。
 * 切換時不重新整理頁面（頁面沒有 Vite 用戶端）：等伺服器換好後就地更新列表，背景動畫不中斷、畫面不跳動。
 * 背景是一組旋轉的 3D 幾何物件（three.js），滑鼠移動時鏡頭會稍微跟著偏。
 */
import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { showAlert, showPrompt } from '../shared/dialog';
import { h } from '../shared/dom';
import { request } from '../shared/http';
import { readZip } from './zip';

// ───────── 專案列表 ─────────

interface ProjectList {
  current: string;
  saved: string;
  default: string;
  platform?: string;
  projects: string[];
  details?: { name: string; summary: string }[];
}

/** 打包的狀態（tools/project-build.ts 的 BuildJob） */
interface BuildJob {
  name: string;
  target: 'web' | 'mac';
  fullscreen: boolean;
  state: 'running' | 'done' | 'failed';
  step: string;
  log: string[];
  outputs: string[];
  startedAt: number;
  endedAt?: number;
}

const listEl = document.getElementById('list') as HTMLUListElement;
const statusEl = document.getElementById('status') as HTMLParagraphElement;
let current = '';
/** 預設專案（不能刪除） */
let defaultProject = '';
let switching = false;
/** 可以打包 macOS App（開發伺服器在 macOS 上） */
let canBuildMac = false;
/** 正在打包的專案（沒有時是 null） */
let building: BuildJob | null = null;
/** 專案名稱：小寫英文、數字、連字號（和 tools/project-files.js 的 VALID_NAME 一樣；伺服器會再檢查一次） */
const VALID_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
const EDIT_ICON =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.5 2.5l3 3L6 13H3v-3z"/><path d="M9 4l3 3"/></svg>';
const BUILD_ICON =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 1.8l5.7 3.1v6.2L8 14.2l-5.7-3.1V4.9z"/><path d="M2.4 4.9L8 8l5.6-3.1M8 8v6.1"/></svg>';
const TRASH_ICON =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4M6.8 7v4M9.2 7v4"/></svg>';

/** 標題下的說明列兼狀態列（固定一行高：換文字時對話框大小不變） */
const HINT = [
  document.createTextNode('選擇要開發的專案（同 '),
  h('code', '', 'node hero select'),
  document.createTextNode('）'),
];
function setStatus(text: string | Node[] = HINT, tone: '' | 'busy' | 'error' = ''): void {
  statusEl.className = `status${tone ? ` ${tone}` : ''}`;
  if (typeof text === 'string') statusEl.textContent = text;
  else statusEl.replaceChildren(...text);
  statusEl.title = statusEl.textContent ?? '';
}

/** official-demo-003-ui2d-ui3d → { num: '003', title: 'ui2d-ui3d' }；其他名稱沒有編號 */
function splitName(name: string): { num: string; title: string } {
  const m = /^(?:official-)?demo-(\d+)-(.+)$/.exec(name);
  return m ? { num: m[1], title: m[2] } : { num: name.slice(0, 2).toUpperCase(), title: name };
}

function item(name: string, summary: string): HTMLLIElement {
  const { num, title } = splitName(name);
  const btn = h('button', 'item');
  btn.type = 'button';
  btn.dataset.name = name;
  const text = h('span');
  text.append(h('span', 'name', title), h('span', summary ? 'summary' : 'summary empty', summary || '（沒有說明）'));
  btn.append(h('span', 'num', num), text, h('span', 'tag'));
  btn.addEventListener('click', () => void select(name, btn));
  const li = h('li');
  // 右邊的動作按鈕：編輯說明、刪除（預設專案是測試與手冊會用到的，不能刪）
  const actions = h('div', 'actions');
  const action = (cls: string, label: string, icon: string, run: () => void) => {
    const b = h('button', `act ${cls}`);
    b.type = 'button';
    b.title = label;
    b.setAttribute('aria-label', label);
    b.innerHTML = icon;
    b.addEventListener('click', run);
    actions.append(b);
  };
  action('build', `打包 ${name}（同 node hero build）`, BUILD_ICON, () =>
    openBuildMenu(name, actions.firstElementChild as HTMLButtonElement),
  );
  action('edit', `編輯 ${name} 的說明`, EDIT_ICON, () => void editSummary(name, btn));
  if (name !== defaultProject)
    action('del', `刪除專案 ${name}（同 node hero remove）`, TRASH_ICON, () => void remove(name));
  btn.style.paddingRight = `${actions.children.length * 34 + 18}px`;
  li.append(btn, actions);
  return li;
}

/** 標出目前的專案（就地改 class，不重建列表：畫面不會閃） */
function markCurrent(): void {
  for (const btn of listEl.querySelectorAll<HTMLButtonElement>('.item')) {
    const on = btn.dataset.name === current;
    const packing = building?.name === btn.dataset.name;
    btn.classList.toggle('current', on);
    btn.classList.toggle('busy', packing);
    btn.disabled = false;
    btn.toggleAttribute('aria-current', on);
    btn.title = on ? `${btn.dataset.name}（目前的專案）` : `切換到 ${btn.dataset.name}`;
    btn.querySelector('.tag')!.textContent = packing ? '打包中' : on ? '目前' : '';
    // 打包時：不能再開始另一個打包，也不能刪除正在打包的專案
    for (const b of btn.nextElementSibling?.querySelectorAll('button') ?? [])
      b.disabled = (!!building && b.classList.contains('build')) || (packing && b.classList.contains('del'));
  }
  listEl.classList.remove('switching');
}

/** 讀取專案列表；列表一樣時只更新標示 */
async function load(): Promise<void> {
  let data: ProjectList;
  try {
    data = await request<ProjectList>('/__projects');
  } catch (error) {
    setStatus(`讀不到專案列表：${(error as Error).message}（請用 node hero dev 開啟）`, 'error');
    return;
  }
  current = data.current;
  defaultProject = data.default ?? '';
  canBuildMac = data.platform === 'darwin';
  const shown = [...listEl.querySelectorAll<HTMLButtonElement>('.item')].map((b) => b.dataset.name);
  if (shown.join('\n') !== data.projects.join('\n')) {
    const summaries = new Map((data.details ?? []).map((d) => [d.name, d.summary]));
    listEl.replaceChildren(...data.projects.map((name) => item(name, summaries.get(name) ?? '')));
  }
  markCurrent();
  if (!data.projects.length) setStatus('projects/ 裡還沒有專案。用 node hero create 名稱 建立');
  else if (data.saved && data.saved !== current)
    setStatus(`這次執行用的是環境變數 PROJECT 指定的專案（node hero select 存的是 ${data.saved}）`);
}

/** 切換專案：存成預設專案（同 node hero select），等開發伺服器換好專案後就地更新列表（不重新整理頁面） */
async function select(name: string, btn: HTMLButtonElement): Promise<void> {
  if (switching) return;
  if (name === current) {
    // 已經是目前的專案：只確認存成預設
    try {
      await request('/__projects/select', post({ name, save: true }));
      setStatus(`已選擇專案 ${name}`);
    } catch (error) {
      setStatus(`選擇專案失敗：${(error as Error).message}`, 'error');
    }
    return;
  }
  switching = true;
  for (const b of document.querySelectorAll<HTMLButtonElement>('.list button, #addBtn, #openBtn')) b.disabled = true;
  listEl.classList.add('switching');
  btn.classList.add('busy');
  btn.querySelector('.tag')!.textContent = '切換中';
  setStatus(`切換到 ${name}，開發伺服器重新啟動中…`, 'busy');
  try {
    await request('/__projects/select', post({ name, save: true }));
    let ok = false;
    for (let i = 0; i < 60 && !ok; i++) {
      await new Promise((r) => setTimeout(r, 400));
      try {
        ok = (await request<ProjectList>('/__projects')).current === name;
      } catch {
        /* 重新啟動中 */
      }
    }
    if (!ok) throw new Error('開發伺服器沒有在時間內重新啟動');
    current = name;
    markCurrent();
    setStatus(`已切換到 ${name}`);
  } catch (error) {
    markCurrent();
    setStatus(`切換專案失敗：${(error as Error).message}`, 'error');
  } finally {
    switching = false;
    addBtn.disabled = openBtn.disabled = false;
    btn.focus();
  }
}

// ───────── 打包 ─────────

const TARGET_LABEL = (job: Pick<BuildJob, 'target' | 'fullscreen'>) =>
  job.target === 'web' ? '網頁版' : `macOS App${job.fullscreen ? '（全螢幕）' : ''}`;
let menu: HTMLElement | null = null;

function closeMenu(): void {
  menu?.remove();
  menu = null;
}
document.addEventListener('pointerdown', (e) => {
  if (menu && !menu.contains(e.target as Node)) closeMenu();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && menu) {
    closeMenu();
    e.stopPropagation();
  }
});
addEventListener('resize', closeMenu);

/** 打包按鈕的選單：網頁版、macOS App（開發伺服器在 macOS 上時才有） */
function openBuildMenu(name: string, anchor: HTMLButtonElement): void {
  if (menu) return closeMenu();
  if (switching || building) return;
  const options: { label: string; hint: string; target: 'web' | 'mac'; fullscreen: boolean }[] = [
    { label: '網頁版', hint: `dist/${name}/web/`, target: 'web', fullscreen: false },
  ];
  if (canBuildMac)
    options.push(
      { label: 'macOS App', hint: `dist/${name}/mac/${name}.app`, target: 'mac', fullscreen: false },
      { label: 'macOS App（全螢幕）', hint: '打開時就是全螢幕', target: 'mac', fullscreen: true },
    );
  const el = h('div', 'menu');
  el.setAttribute('role', 'menu');
  el.append(h('div', 'menu-title', `打包 ${name}`));
  for (const o of options) {
    const b = h('button', 'menu-item');
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    b.append(h('span', '', o.label), h('span', 'menu-hint', o.hint));
    b.addEventListener('click', () => {
      closeMenu();
      void build(name, o.target, o.fullscreen);
    });
    el.append(b);
  }
  el.append(h('div', 'menu-note', '先做格式、型別檢查與測試，全部通過才打包（要一點時間）'));
  document.body.append(el);
  // 放在按鈕下面、右邊對齊；下面放不下時放上面
  const r = anchor.getBoundingClientRect();
  const w = el.offsetWidth;
  const hgt = el.offsetHeight;
  el.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.right - w))}px`;
  el.style.top = `${r.bottom + 6 + hgt > innerHeight - 8 ? Math.max(8, r.top - 6 - hgt) : r.bottom + 6}px`;
  menu = el;
  el.querySelector<HTMLButtonElement>('.menu-item')?.focus();
}

/** 開始打包（同 PROJECT=名稱 node hero build；不會切換專案），之後由 watchBuild 更新進度 */
async function build(name: string, target: 'web' | 'mac', fullscreen: boolean): Promise<void> {
  try {
    const r = await request<{ job: BuildJob }>('/__projects/build', post({ name, target, fullscreen }));
    showBuild(r.job);
    watchBuild();
  } catch (error) {
    setStatus(`不能打包：${(error as Error).message}`, 'error');
  }
}

let watching = false;
/** 每秒問一次打包的進度，直到完成（開發伺服器重新啟動時暫時問不到，繼續等） */
function watchBuild(): void {
  if (watching) return;
  watching = true;
  const tick = async () => {
    let job: BuildJob | null = null;
    try {
      job = (await request<{ job: BuildJob | null }>('/__projects/build')).job;
    } catch {
      setTimeout(tick, 1000);
      return;
    }
    if (job) showBuild(job);
    if (job?.state === 'running') setTimeout(tick, 1000);
    else watching = false;
  };
  setTimeout(tick, 1000);
}

/** 依打包的狀態更新那一列與狀態列；剛結束時顯示結果 */
function showBuild(job: BuildJob): void {
  const was = building;
  building = job.state === 'running' ? job : null;
  if (!switching) markCurrent();
  const what = `${job.name}（${TARGET_LABEL(job)}）`;
  if (job.state === 'running') {
    if (!switching) setStatus(`打包 ${what}：${job.step}…`, 'busy');
    return;
  }
  if (!was) return; // 打開頁面前就結束的打包：不再顯示
  const sec = Math.round(((job.endedAt ?? Date.now()) - job.startedAt) / 1000);
  if (job.state === 'done') {
    setStatus(`✓ ${what}打包完成（${sec} 秒）：${job.outputs.join('、') || `dist/${job.name}/`}`);
    return;
  }
  setStatus(`✗ ${what}打包失敗（在「${job.step}」）`, 'error');
  const tail = job.log.filter((l) => l.trim()).slice(-25);
  void showAlert(`在「${job.step}」失敗。最後的輸出：\n\n${tail.join('\n')}`, { title: `打包 ${job.name} 失敗` });
}

// ───────── 編輯說明、新增、刪除專案 ─────────

/** 編輯專案說明：改寫 src/main.ts 開頭註解的第一行，改好後就地更新那一列 */
async function editSummary(name: string, btn: HTMLButtonElement): Promise<void> {
  if (switching) return;
  const el = btn.querySelector('.summary')!;
  const old = el.classList.contains('empty') ? '' : (el.textContent ?? '');
  const text = await showPrompt(
    `顯示在專案名稱下面的一句話（存在 projects/${name}/src/main.ts 開頭註解的第一行）`,
    old,
    {
      title: `${name} 的說明`,
      ok: '儲存',
      placeholder: '例如：太空射擊小遊戲',
      validate: (v) => {
        const t = v.trim();
        if (!t) return '請輸入說明';
        if (t.includes('*/')) return '不能有 */';
        if (t.length > 80) return '最多 80 個字';
        return null;
      },
    },
  );
  if (text === null || text.trim() === old) return;
  try {
    const r = await request<{ summary: string }>('/__projects/summary', post({ name, summary: text }));
    el.textContent = r.summary;
    el.classList.remove('empty');
    setStatus(`已更新 ${name} 的說明`);
  } catch (error) {
    setStatus(`更新說明失敗：${(error as Error).message}`, 'error');
  }
}

const addBtn = document.getElementById('addBtn') as HTMLButtonElement;
addBtn.addEventListener('click', () => void add());

/** 新增專案：輸入名稱，用範本建立（同 node hero create）；建立後不自動切換，點一下就切換 */
async function add(): Promise<void> {
  if (switching) return;
  const existing = new Set([...listEl.querySelectorAll<HTMLButtonElement>('.item')].map((b) => b.dataset.name));
  const name = await showPrompt('專案名稱（小寫英文、數字、連字號）：建立在 projects/<名稱>/', '', {
    title: '新增專案',
    ok: '建立',
    placeholder: 'my-game',
    validate: (v) => {
      const n = v.trim();
      if (!n) return '請輸入專案名稱';
      if (!VALID_NAME.test(n)) return '只能用小寫英文、數字和連字號（-），而且要以英文或數字開頭';
      if (existing.has(n)) return `已經有專案 ${n}`;
      return null;
    },
  });
  if (name === null) return;
  const n = name.trim();
  try {
    await request('/__projects/create', post({ name: n }));
  } catch (error) {
    setStatus(`建立專案失敗：${(error as Error).message}`, 'error');
    return;
  }
  await load();
  const btn = listEl.querySelector<HTMLButtonElement>(`.item[data-name="${CSS.escape(n)}"]`);
  if (btn) {
    btn.classList.add('fresh');
    btn.addEventListener('animationend', () => btn.classList.remove('fresh'), { once: true });
    btn.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    btn.focus();
  }
  setStatus(`已建立 projects/${n}/：點一下就切換到這個專案`);
}

/** 刪除專案（同 node hero remove）：列出會刪掉的資料夾，輸入專案名稱確認 */
async function remove(name: string): Promise<void> {
  if (switching) return;
  let info: { targets: { path: string; files: number }[]; selected: boolean; switchTo: string };
  try {
    info = await request(`/__projects/remove?name=${encodeURIComponent(name)}`);
  } catch (error) {
    setStatus(`不能刪除：${(error as Error).message}`, 'error');
    return;
  }
  const lines = info.targets.map((t) => `・${t.path}（${t.files} 個檔案）`).join('\n');
  const answer = await showPrompt(
    `會刪掉：\n${lines}${info.switchTo ? `\n\n這是開發伺服器正在用的專案：會先切換到 ${info.switchTo} 再刪除` : ''}${info.selected ? `\n\n這是 node hero select 選的專案：刪除後改選 ${defaultProject}` : ''}\n\n⚠ 刪除後無法復原（不會放進垃圾桶）。請輸入專案名稱確認：`,
    '',
    {
      title: `刪除專案 ${name}`,
      ok: '刪除',
      danger: true,
      placeholder: name,
      validate: (v) => (v.trim() === name ? null : `請輸入 ${name}`),
    },
  );
  if (answer === null) return;
  if (info.switchTo) return removeCurrent(name, info.switchTo);
  try {
    const r = await request<{ reselected: string }>('/__projects/remove', post({ name }));
    await load();
    setStatus(`已刪除專案 ${name}${r.reselected ? `（目前選擇改為 ${r.reselected}）` : ''}`);
  } catch (error) {
    setStatus(`刪除專案失敗：${(error as Error).message}`, 'error');
  }
}

/** 刪除正在用的專案：伺服器先換成 switchTo、重新啟動後再刪；等兩件事都完成再更新列表 */
async function removeCurrent(name: string, switchTo: string): Promise<void> {
  switching = true;
  for (const b of document.querySelectorAll<HTMLButtonElement>('.list button, #addBtn, #openBtn')) b.disabled = true;
  listEl.classList.add('switching');
  const btn = listEl.querySelector<HTMLButtonElement>(`.item[data-name="${CSS.escape(name)}"]`);
  btn?.classList.add('busy');
  if (btn) btn.querySelector('.tag')!.textContent = '刪除中';
  setStatus(`切換到 ${switchTo} 後刪除 ${name}…`, 'busy');
  try {
    await request('/__projects/remove', post({ name }));
    let ok = false;
    for (let i = 0; i < 60 && !ok; i++) {
      await new Promise((r) => setTimeout(r, 400));
      try {
        const d = await request<ProjectList>('/__projects');
        ok = d.current === switchTo && !d.projects.includes(name);
      } catch {
        /* 重新啟動中 */
      }
    }
    if (!ok) throw new Error('開發伺服器沒有在時間內完成（請看終端機的訊息）');
    await load();
    setStatus(`已刪除專案 ${name}，目前的專案改為 ${switchTo}`);
  } catch (error) {
    await load();
    setStatus(`刪除專案失敗：${(error as Error).message}`, 'error');
  } finally {
    switching = false;
    addBtn.disabled = openBtn.disabled = false;
  }
}

// ───────── 匯入別人的專案 ─────────

const openBtn = document.getElementById('openBtn') as HTMLButtonElement;
/** 選資料夾、選 zip 用的隱藏欄位（瀏覽器的檔案選擇視窗） */
function filePicker(setup: (input: HTMLInputElement) => void, onPick: (files: File[]) => void): HTMLInputElement {
  const input = h('input');
  input.type = 'file';
  input.hidden = true;
  setup(input);
  input.addEventListener('change', () => onPick([...(input.files ?? [])]));
  document.body.append(input);
  return input;
}
const folderPicker = filePicker(
  (i) => {
    i.multiple = true;
    i.webkitdirectory = true;
  },
  (files) => void openFolder(files),
);
const zipPicker = filePicker(
  (i) => {
    i.accept = '.zip,application/zip';
  },
  (files) => files[0] && void openZip(files[0]),
);
const pick = (input: HTMLInputElement) => {
  input.value = '';
  input.click();
};

/** 「匯入專案」的選單：資料夾或 .zip 檔 */
openBtn.addEventListener('click', () => {
  if (menu) return closeMenu();
  if (switching) return;
  const el = h('div', 'menu');
  el.setAttribute('role', 'menu');
  el.append(h('div', 'menu-title', '匯入別人的專案'));
  const option = (label: string, hint: string, run: () => void) => {
    const b = h('button', 'menu-item');
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    b.append(h('span', '', label), h('span', 'menu-hint', hint));
    b.addEventListener('click', () => {
      closeMenu();
      run();
    });
    el.append(b);
  };
  option('選擇資料夾…', '專案資料夾（裡面有 index.html）', () => pick(folderPicker));
  option('選擇 .zip 檔…', '把專案資料夾壓縮成的 zip', () => pick(zipPicker));
  el.append(h('div', 'menu-note', '會複製到 projects/ 並切換過去；node_modules、dist、隱藏檔不會複製'));
  document.body.append(el);
  const r = openBtn.getBoundingClientRect();
  el.style.left = `${Math.max(8, Math.min(innerWidth - el.offsetWidth - 8, r.right - el.offsetWidth))}px`;
  el.style.top = `${r.bottom + 6}px`;
  menu = el;
  el.querySelector<HTMLButtonElement>('.menu-item')?.focus();
});

/** 略過的檔案與資料夾（和 tools/project-files.js 的 skipImportSegment 一樣；伺服器會再檢查一次） */
const skipSegment = (s: string) => s.startsWith('.') || s === 'node_modules' || s === 'dist' || s === '__MACOSX';

/** 要複製的一個檔案：專案裡的路徑、大小、內容（zip 裡的檔案用到時才解壓縮） */
interface SourceFile {
  path: string;
  size: number;
  blob(): Promise<Blob>;
}

/** 選的資料夾 */
function openFolder(files: File[]): Promise<void> {
  return openProject(
    files.map((f) => ({ path: f.webkitRelativePath || f.name, size: f.size, blob: async () => f })),
    '這個資料夾',
  );
}

/** 選的 zip 檔：先讀出檔案列表（內容複製時才解壓縮） */
async function openZip(file: File): Promise<void> {
  if (switching) return;
  setStatus(`讀取 ${file.name}…`, 'busy');
  let entries: Awaited<ReturnType<typeof readZip>>;
  try {
    entries = await readZip(file);
  } catch (error) {
    setStatus();
    await showAlert(`${file.name}：${(error as Error).message}`, { title: '不能匯入' });
    return;
  }
  setStatus();
  // zip 裡直接是專案的檔案（沒有外層資料夾）時，用 zip 的檔名當資料夾名稱
  const folder = file.name.replace(/\.zip$/i, '');
  const flat = entries.some((e) => e.path === 'index.html');
  return openProject(
    entries.map((e) => ({ path: flat ? `${folder}/${e.path}` : e.path, size: e.size, blob: () => e.read() })),
    `${file.name} `,
  );
}

/** 資料夾名稱 → 合法的專案名稱（小寫、其他字元換成連字號；已經有同名專案時加上 -2、-3…） */
function suggestName(folder: string, existing: Set<string | undefined>): string {
  const base =
    folder
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 56) || 'my-game';
  let name = base;
  for (let i = 2; existing.has(name); i++) name = `${base}-${i}`;
  return name;
}

/**
 * 匯入別人的專案：資料夾或 zip 裡最淺的、有 index.html 的那一層（例如解壓縮後多一層也沒關係）複製到 projects/<名稱>/，
 * 完成後切換過去。檔案一個一個傳到開發伺服器（tools/project-import.ts），全部傳完才放進 projects/。
 */
async function openProject(files: SourceFile[], kind: string): Promise<void> {
  if (!files.length || switching) return;
  const paths = files.map((f) => f.path);
  // 專案的最上層：最淺的 index.html 所在的資料夾
  const roots = paths
    .filter((p) => /(^|\/)index\.html$/.test(p) && !p.split('/').some(skipSegment))
    .map((p) => p.slice(0, -'index.html'.length))
    .sort((a, b) => a.split('/').length - b.split('/').length);
  if (!roots.length) {
    await showAlert(
      `${kind}裡找不到 index.html，不是 Hero Engine 的專案。\n專案資料夾是裡面有 index.html、src/、public/ 的那一個。`,
      {
        title: '不能匯入',
      },
    );
    return;
  }
  const root = roots[0];
  const items = files
    .map((file, i) => ({ file, path: paths[i] }))
    .filter((x) => x.path.startsWith(root))
    .map((x) => ({ ...x.file, path: x.path.slice(root.length) }))
    .filter((x) => !x.path.split('/').some(skipSegment));
  const folder = root.split('/').filter(Boolean).pop() ?? 'my-game';
  const existing = new Set([...listEl.querySelectorAll<HTMLButtonElement>('.item')].map((b) => b.dataset.name));
  const size = items.reduce((n, x) => n + x.size, 0);
  const name = await showPrompt(
    `「${folder}」有 ${items.length} 個檔案（${size < 1024 * 1024 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`}），會複製到 projects/<名稱>/ 並切換過去。\n專案名稱（小寫英文、數字、連字號）：`,
    suggestName(folder, existing),
    {
      title: '匯入專案',
      ok: '匯入',
      validate: (v) => {
        const n = v.trim();
        if (!n) return '請輸入專案名稱';
        if (!VALID_NAME.test(n)) return '只能用小寫英文、數字和連字號（-），而且要以英文或數字開頭';
        if (existing.has(n)) return `已經有專案 ${n}`;
        return null;
      },
    },
  );
  if (name === null) return;
  const n = name.trim();

  switching = true;
  for (const b of document.querySelectorAll<HTMLButtonElement>('.list button, #addBtn, #openBtn')) b.disabled = true;
  let token = '';
  try {
    token = (await request<{ token: string }>('/__projects/import/begin', post({ name: n }))).token;
    let done = 0;
    // 同時傳幾個檔案（太多會讓開發伺服器忙不過來）
    const queue = [...items];
    const worker = async () => {
      for (let x = queue.shift(); x; x = queue.shift()) {
        const q = new URLSearchParams({ token, path: x.path });
        await request(`/__projects/import/file?${q}`, { method: 'PUT', body: await x.blob() });
        done++;
        setStatus(`匯入 ${n}：複製檔案 ${done}／${items.length}…`, 'busy');
      }
    };
    setStatus(`匯入 ${n}：複製檔案 0／${items.length}…`, 'busy');
    await Promise.all(Array.from({ length: 4 }, worker));
    await request('/__projects/import/commit', post({ token }));
    token = '';
  } catch (error) {
    if (token) await request('/__projects/import/cancel', post({ token })).catch(() => {});
    switching = false;
    markCurrent();
    addBtn.disabled = openBtn.disabled = false;
    setStatus(`匯入專案失敗：${(error as Error).message}`, 'error');
    return;
  }
  switching = false;
  await load();
  const btn = listEl.querySelector<HTMLButtonElement>(`.item[data-name="${CSS.escape(n)}"]`);
  if (!btn) {
    addBtn.disabled = openBtn.disabled = false;
    setStatus(`已複製到 projects/${n}/，但列表裡找不到它`, 'error');
    return;
  }
  btn.classList.add('fresh');
  btn.addEventListener('animationend', () => btn.classList.remove('fresh'), { once: true });
  btn.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  await select(n, btn);
}

const post = (body: object): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

// 上下鍵在專案之間移動（Enter／空白鍵 = 點一下）
listEl.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const items = [...listEl.querySelectorAll<HTMLButtonElement>('.item')];
  const i = items.indexOf(document.activeElement as HTMLButtonElement);
  items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
  e.preventDefault();
});

setStatus();
void load().then(async () => {
  (listEl.querySelector<HTMLButtonElement>('.item.current') ?? listEl.querySelector('.item'))?.focus();
  // 重新打開入口頁時，接著顯示還在進行的打包
  try {
    const { job } = await request<{ job: BuildJob | null }>('/__projects/build');
    if (job?.state === 'running') {
      showBuild(job);
      watchBuild();
    }
  } catch {
    /* 舊的開發伺服器沒有打包功能 */
  }
});

// ───────── 背景：旋轉的 3D 幾何物件 ─────────

const canvas = document.getElementById('bg') as HTMLCanvasElement;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
// WebGPURenderer（setAnimationLoop 會先等它初始化完成）
const renderer = new WebGPURenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x101310, 0.045);
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
camera.position.set(0, 0, 14);

const ACCENT = 0x9acd32;
const TEAL = 0x8ecae6;
const WARM = 0xffb347;
scene.add(new THREE.HemisphereLight(0xdfe8d0, 0x0c0f0a, 0.6));
const key = new THREE.DirectionalLight(0xffffff, 1.6);
key.position.set(5, 8, 6);
scene.add(key);
const glowA = new THREE.PointLight(ACCENT, 60, 30);
const glowB = new THREE.PointLight(TEAL, 45, 30);
scene.add(glowA, glowB);

/** 每個物件：自轉速度、繞中心公轉、上下飄 */
interface Spinner {
  obj: THREE.Object3D;
  spin: THREE.Vector3;
  orbit: { radius: number; speed: number; phase: number; tilt: number; y: number } | null;
  bob: number;
}
const spinners: Spinner[] = [];

/** 實心（平面著色）＋外圍線框的物件 */
function solid(geo: THREE.BufferGeometry, color: number, wire = true): THREE.Group {
  const g = new THREE.Group();
  g.add(
    new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.55, flatShading: true })),
  );
  if (wire) {
    const lines = new THREE.LineSegments(
      new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({ color: 0xeef6dd, transparent: true, opacity: 0.35 }),
    );
    lines.scale.setScalar(1.002);
    g.add(lines);
  }
  return g;
}

/** 只有線框的外殼（中心物件外面那層） */
function shell(geo: THREE.BufferGeometry, color: number, opacity: number): THREE.LineSegments {
  return new THREE.LineSegments(
    new THREE.EdgesGeometry(geo),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity }),
  );
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const randSpin = (s: number) => new THREE.Vector3(rand(-s, s), rand(-s, s), rand(-s, s));

// 中心：二十面體 ＋ 兩層反向旋轉的線框外殼
const core = solid(new THREE.IcosahedronGeometry(1.7, 0), 0x3c4a2c);
scene.add(core);
spinners.push({ obj: core, spin: new THREE.Vector3(0.12, 0.18, 0.05), orbit: null, bob: 0 });
const shellA = shell(new THREE.IcosahedronGeometry(2.6, 1), ACCENT, 0.45);
const shellB = shell(new THREE.DodecahedronGeometry(3.4, 0), TEAL, 0.25);
scene.add(shellA, shellB);
spinners.push(
  { obj: shellA, spin: new THREE.Vector3(-0.08, -0.14, 0.03), orbit: null, bob: 0 },
  { obj: shellB, spin: new THREE.Vector3(0.05, 0.07, -0.06), orbit: null, bob: 0 },
);

// 公轉的小物件
const orbiters: [THREE.BufferGeometry, number][] = [
  [new THREE.TorusKnotGeometry(0.55, 0.17, 96, 12), ACCENT],
  [new THREE.OctahedronGeometry(0.75, 0), TEAL],
  [new THREE.TorusGeometry(0.6, 0.2, 12, 36), 0xc4cbba],
  [new THREE.TetrahedronGeometry(0.8, 0), WARM],
  [new THREE.DodecahedronGeometry(0.65, 0), ACCENT],
  [new THREE.BoxGeometry(0.9, 0.9, 0.9), TEAL],
  [new THREE.ConeGeometry(0.55, 1.1, 6), 0xc4cbba],
  [new THREE.IcosahedronGeometry(0.6, 0), WARM],
];
orbiters.forEach(([geo, color], i) => {
  const obj = solid(geo, color, !(geo instanceof THREE.TorusKnotGeometry || geo instanceof THREE.TorusGeometry));
  scene.add(obj);
  spinners.push({
    obj,
    spin: randSpin(0.9),
    orbit: {
      radius: 4.6 + (i % 3) * 1.4 + rand(-0.3, 0.3),
      speed: (0.08 + rand(0, 0.06)) * (i % 2 ? 1 : -1),
      phase: (i / orbiters.length) * Math.PI * 2,
      tilt: rand(-0.5, 0.5),
      y: rand(-1.8, 1.8),
    },
    bob: rand(0, Math.PI * 2),
  });
});

// 遠處的光點
const starCount = 700;
const starPos = new Float32Array(starCount * 3);
for (let i = 0; i < starCount; i++) {
  const v = new THREE.Vector3().randomDirection().multiplyScalar(rand(10, 30));
  starPos.set([v.x, v.y, v.z], i * 3);
}
const stars = new THREE.Points(
  new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(starPos, 3)),
  new THREE.PointsMaterial({ color: 0xcfe6a8, size: 0.06, transparent: true, opacity: 0.7, sizeAttenuation: true }),
);
scene.add(stars);

// 滑鼠視差
const pointer = new THREE.Vector2();
addEventListener('pointermove', (e) => {
  pointer.set((e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1);
});

function resize(): void {
  const w = innerWidth;
  const hgt = innerHeight;
  renderer.setSize(w, hgt, false);
  camera.aspect = w / hgt;
  // 窄螢幕時往後退，讓物件不會被裁掉太多
  camera.position.z = w < hgt ? 20 : 14;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// THREE.Timer：three.js r183 起取代 THREE.Clock（每幀先 update 再讀 getDelta）
const timer = new THREE.Timer();
let time = 0;
renderer.setAnimationLoop((now) => {
  timer.update(now);
  const dt = Math.min(timer.getDelta(), 0.05) * (reduceMotion ? 0.15 : 1);
  time += dt;
  for (const s of spinners) {
    s.obj.rotation.x += s.spin.x * dt;
    s.obj.rotation.y += s.spin.y * dt;
    s.obj.rotation.z += s.spin.z * dt;
    if (s.orbit) {
      const o = s.orbit;
      const a = o.phase + time * o.speed;
      s.obj.position.set(
        Math.cos(a) * o.radius,
        o.y + Math.sin(a) * o.radius * o.tilt + Math.sin(time * 0.8 + s.bob) * 0.25,
        Math.sin(a) * o.radius - 2,
      );
    }
  }
  core.position.y = Math.sin(time * 0.6) * 0.15;
  stars.rotation.y = time * 0.01;
  glowA.position.set(Math.cos(time * 0.4) * 6, 3, Math.sin(time * 0.4) * 6);
  glowB.position.set(Math.cos(time * 0.3 + 2) * -6, -3, Math.sin(time * 0.3 + 2) * 6);
  // 鏡頭慢慢跟著滑鼠偏一點
  camera.position.x += (pointer.x * 1.6 - camera.position.x) * 0.04;
  camera.position.y += (-pointer.y * 1.0 - camera.position.y) * 0.04;
  camera.lookAt(0, 0, 0);
  renderer.render(scene, camera);
});
