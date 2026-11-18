/**
 * 入口頁（/portal.html）：置中的毛玻璃對話框列出 projects/ 裡的專案，點一下切換專案，也可以新增、刪除專案
 * （同 node hero create／remove：檔案操作共用 tools/project-files.js）。
 * 切換＝ node hero select 名稱（寫進 .selected-project）＋ 開發伺服器換成那個專案後重新啟動（tools/project.ts 的 /__projects）。
 * 切換時不重新整理頁面（頁面沒有 Vite 用戶端）：等伺服器換好後就地更新列表，背景動畫不中斷、畫面不跳動。
 * 背景是一組旋轉的 3D 幾何物件（three.js），滑鼠移動時鏡頭會稍微跟著偏。
 */
import * as THREE from 'three';
import { showPrompt } from '../shared/dialog';
import { h } from '../shared/dom';
import { request } from '../shared/http';

// ───────── 專案列表 ─────────

interface ProjectList {
  current: string;
  saved: string;
  default: string;
  projects: string[];
  details?: { name: string; summary: string }[];
}

const listEl = document.getElementById('list') as HTMLUListElement;
const statusEl = document.getElementById('status') as HTMLParagraphElement;
let current = '';
/** 預設專案（不能刪除） */
let defaultProject = '';
let switching = false;
/** 專案名稱：小寫英文、數字、連字號（和 tools/project-files.js 的 VALID_NAME 一樣；伺服器會再檢查一次） */
const VALID_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
const EDIT_ICON =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.5 2.5l3 3L6 13H3v-3z"/><path d="M9 4l3 3"/></svg>';
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
    btn.classList.toggle('current', on);
    btn.classList.remove('busy');
    btn.disabled = false;
    btn.toggleAttribute('aria-current', on);
    btn.title = on ? `${btn.dataset.name}（目前的專案）` : `切換到 ${btn.dataset.name}`;
    btn.querySelector('.tag')!.textContent = on ? '目前' : '';
    for (const b of btn.nextElementSibling?.querySelectorAll('button') ?? []) b.disabled = false;
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
  for (const b of document.querySelectorAll<HTMLButtonElement>('.list button, #addBtn')) b.disabled = true;
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
    addBtn.disabled = false;
    btn.focus();
  }
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
  for (const b of document.querySelectorAll<HTMLButtonElement>('.list button, #addBtn')) b.disabled = true;
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
    addBtn.disabled = false;
  }
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
void load().then(() =>
  (listEl.querySelector<HTMLButtonElement>('.item.current') ?? listEl.querySelector('.item'))?.focus(),
);

// ───────── 背景：旋轉的 3D 幾何物件 ─────────

const canvas = document.getElementById('bg') as HTMLCanvasElement;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
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

const clock = new THREE.Clock();
let time = 0;
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05) * (reduceMotion ? 0.15 : 1);
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
