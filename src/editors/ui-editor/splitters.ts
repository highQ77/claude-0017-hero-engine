/**
 * 面板邊界拖曳：左側面板寬度、右側面板寬度、紀錄高度、資源管理器高度。
 * - 拖曳 .splitter[data-split] 調整；雙擊還原預設；選取後可以用方向鍵微調（Shift 一次 40px）
 * - 大小記在瀏覽器（localStorage），重新整理後還在
 * - 每個大小都有上下限，中央的預覽區至少保留 MIN_CENTER 寬
 */
import { storage } from '../shared/storage';

type SplitKey = 'left' | 'right' | 'log' | 'assets';
type Sizes = Partial<Record<SplitKey, number>>;

const STORAGE_KEY = 'ui2d-editor-layout';
const MIN_CENTER = 360;

function loadSizes(): Sizes {
  const raw = storage.getJson<Record<string, unknown> | null>(STORAGE_KEY, null) ?? {};
  const out: Sizes = {};
  for (const k of ['left', 'right', 'log', 'assets'] as const)
    if (typeof raw[k] === 'number' && Number.isFinite(raw[k])) out[k] = raw[k] as number;
  return out;
}

function saveSizes(sizes: Sizes): void {
  storage.setJson(STORAGE_KEY, sizes);
}

export function installSplitters(): void {
  const main = document.querySelector<HTMLElement>('main')!;
  const leftPanel = document.querySelector<HTMLElement>('aside.left')!;
  const rightPanel = document.querySelector<HTMLElement>('aside.right')!;
  const center = document.getElementById('center')!;
  const logPanel = document.getElementById('logPanel')!;
  const assets = document.getElementById('assetsCard')!;
  const sizes = loadSizes();

  const visible = (el: Element) => getComputedStyle(el).display !== 'none';
  /** 目前實際的大小（還沒拖過時是預設值） */
  const current: Record<SplitKey, () => number> = {
    left: () => leftPanel.getBoundingClientRect().width,
    right: () => rightPanel.getBoundingClientRect().width,
    log: () => logPanel.getBoundingClientRect().height,
    assets: () => assets.getBoundingClientRect().height,
  };
  /** 上下限（依視窗與其他面板目前的大小） */
  const limits = (key: SplitKey): [number, number] => {
    const mainW = main.getBoundingClientRect().width;
    const rightW = visible(rightPanel) && getComputedStyle(rightPanel).gridColumnStart !== '1' ? current.right() : 0;
    switch (key) {
      case 'left':
        return [180, Math.max(180, Math.min(600, mainW - rightW - MIN_CENTER))];
      case 'right':
        return [220, Math.max(220, Math.min(640, mainW - current.left() - MIN_CENTER))];
      case 'log':
        return [56, Math.max(56, center.getBoundingClientRect().height - 160)];
      case 'assets':
        return [90, Math.max(90, leftPanel.getBoundingClientRect().height - 170)];
    }
  };
  const clamp = (key: SplitKey, v: number) => {
    const [min, max] = limits(key);
    return Math.round(Math.max(min, Math.min(max, v)));
  };

  const apply = () => {
    const set = (el: HTMLElement, name: string, v: number | undefined) => {
      if (v === undefined) el.style.removeProperty(name);
      else el.style.setProperty(name, `${v}px`);
    };
    set(main, '--left-w', sizes.left);
    set(main, '--right-w', sizes.right);
    set(center, '--log-h', sizes.log);
    set(leftPanel, '--assets-h', sizes.assets);
    leftPanel.classList.toggle('assets-sized', sizes.assets !== undefined);
  };

  /** 視窗變小時，記住的大小也要收進上下限 */
  const reclamp = () => {
    let changed = false;
    for (const key of ['left', 'right', 'log', 'assets'] as const) {
      const v = sizes[key];
      if (v === undefined) continue;
      const c = clamp(key, v);
      if (c !== v) {
        sizes[key] = c;
        changed = true;
      }
    }
    if (changed) apply();
  };

  const setSize = (key: SplitKey, v: number) => {
    sizes[key] = clamp(key, v);
    apply();
  };

  for (const handle of document.querySelectorAll<HTMLElement>('.splitter[data-split]')) {
    const key = handle.dataset.split as SplitKey;
    const vertical = handle.classList.contains('col'); // 左右拖曳（調整寬度）
    // 往哪個方向拖會變大：左側面板往右、右側面板往左、紀錄與資源管理器往上
    const sign = key === 'left' ? 1 : -1;
    handle.tabIndex = 0;
    handle.setAttribute('role', 'separator');
    handle.setAttribute('aria-orientation', vertical ? 'vertical' : 'horizontal');
    handle.title ||= '拖曳調整大小（雙擊還原）';

    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      handle.classList.add('drag');
      document.body.classList.add(vertical ? 'resizing-col' : 'resizing-row');
      const start = vertical ? e.clientX : e.clientY;
      const startSize = current[key]();
      const move = (ev: PointerEvent) =>
        setSize(key, startSize + sign * ((vertical ? ev.clientX : ev.clientY) - start));
      const up = () => {
        handle.classList.remove('drag');
        document.body.classList.remove('resizing-col', 'resizing-row');
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
        saveSizes(sizes);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    });
    handle.addEventListener('dblclick', () => {
      delete sizes[key];
      apply();
      saveSizes(sizes);
    });
    handle.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 40 : 10;
      const keys = vertical ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown'];
      const i = keys.indexOf(e.key);
      if (i < 0) return;
      e.preventDefault();
      setSize(key, current[key]() + (i === 1 ? 1 : -1) * sign * step);
      saveSizes(sizes);
    });
  }

  apply();
  requestAnimationFrame(reclamp);
  window.addEventListener('resize', reclamp);
}
