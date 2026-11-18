/**
 * 九宮格編輯器（bgSlice）：在放大的圖片上拖曳四條線切出九宮格，右邊即時預覽延伸的結果。
 * - 數值是圖片的像素：bgSlice="上 右 下 左"（四邊相同時只寫一個數字）
 * - bgSliceWidth：邊框在畫面上的寬度（不填就和切割相同）
 * - 預覽用引擎的 drawNineSlice，和遊戲裡畫出來的一樣
 */
import { drawNineSlice } from '../../ui2d/UIPainter';

export interface SliceEditorOptions {
  /** 圖片網址（給瀏覽器載入用） */
  imageUrl: string;
  /** 顯示用的圖片名稱（XML 裡的寫法） */
  imageName: string;
  /** 目前的 bgSlice、bgSliceWidth（沒有就是 undefined） */
  slice?: string;
  sliceWidth?: string;
  /** 套用：null 代表移除該屬性 */
  onApply(slice: string | null, sliceWidth: string | null): void;
}

type Edges = [number, number, number, number]; // 上 右 下 左
const EDGE_NAMES = ['上', '右', '下', '左'] as const;
const STAGE_W = 340;
const STAGE_H = 300;

/** "16" / "8 12" / "上 右 下 左" → [上, 右, 下, 左]（和引擎的寫法相同） */
export function parseEdges(value: string | undefined): Edges | null {
  if (!value?.trim()) return null;
  const n = value
    .trim()
    .split(/\s+/)
    .map((p) => Math.max(0, Math.round(parseFloat(p) || 0)));
  const [t, r = t, b = t, l = r] = n;
  return [t, r, b, l];
}

/** [上, 右, 下, 左] → 最短的寫法 */
export function formatEdges([t, r, b, l]: Edges): string {
  if (t === r && r === b && b === l) return String(t);
  if (t === b && r === l) return `${t} ${r}`;
  if (r === l) return `${t} ${r} ${b}`;
  return `${t} ${r} ${b} ${l}`;
}

let root: HTMLDivElement | null = null;
let closeCurrent: (() => void) | null = null;

/** 打開九宮格編輯器 */
export function openSliceEditor(options: SliceEditorOptions): void {
  closeCurrent?.();
  root ??= createDom();
  const q = <T extends HTMLElement>(sel: string) => root!.querySelector(sel) as T;
  const stage = q<HTMLDivElement>('.se-stage');
  const imgBox = q<HTMLDivElement>('.se-img');
  const img = q<HTMLImageElement>('.se-img img');
  const lines = [...root.querySelectorAll<HTMLDivElement>('.se-line')];
  const shades = [...root.querySelectorAll<HTMLDivElement>('.se-shade')];
  const inputs = [...root.querySelectorAll<HTMLInputElement>('.se-edges input')];
  const linkBox = q<HTMLInputElement>('#seLink');
  const widthInput = q<HTMLInputElement>('#seWidth');
  const info = q<HTMLDivElement>('.se-info');
  const previews = [...root.querySelectorAll<HTMLCanvasElement>('.se-previews canvas')];
  const status = q<HTMLDivElement>('.se-status');
  q<HTMLSpanElement>('.se-name').textContent = options.imageName;

  let size = { width: 0, height: 0 };
  let zoom = 1;
  let edges: Edges = parseEdges(options.slice) ?? [0, 0, 0, 0];
  let linked = edges.every((v) => v === edges[0]);
  widthInput.value = options.sliceWidth ?? '';
  linkBox.checked = linked;
  status.textContent = '';

  /** 一條線不能越過對面的線：上＋下 ≤ 圖片高度、左＋右 ≤ 寬度 */
  const dimOf = (i: number) => (i % 2 === 0 ? size.height : size.width);
  const clampOne = (i: number, v: number, e: Edges) => Math.max(0, Math.min(Math.round(v), dimOf(i) - e[(i + 2) % 4]));
  const clampEdges = (e: Edges): Edges => {
    const out = [...e] as Edges;
    for (let i = 0; i < 4; i++) out[i] = clampOne(i, out[i], out);
    return out;
  };

  const render = () => {
    const [t, r, b, l] = edges;
    const w = size.width * zoom;
    const h = size.height * zoom;
    // 四條線：上、右、下、左
    const pos = [t * zoom, w - r * zoom, h - b * zoom, l * zoom];
    lines.forEach((line, i) => {
      if (i % 2 === 0) line.style.top = `${pos[i]}px`;
      else line.style.left = `${pos[i]}px`;
      line.querySelector('span')!.textContent = `${EDGE_NAMES[i]} ${edges[i]}`;
    });
    // 四邊（不會延伸的部分）加上淡淡的顏色
    const [st, sr, sb, sl] = shades.map((s) => s.style);
    Object.assign(st, { left: '0', top: '0', width: `${w}px`, height: `${t * zoom}px` });
    Object.assign(sb, { left: '0', top: `${h - b * zoom}px`, width: `${w}px`, height: `${b * zoom}px` });
    Object.assign(sl, {
      left: '0',
      top: `${t * zoom}px`,
      width: `${l * zoom}px`,
      height: `${Math.max(0, h - (t + b) * zoom)}px`,
    });
    Object.assign(sr, {
      left: `${w - r * zoom}px`,
      top: `${t * zoom}px`,
      width: `${r * zoom}px`,
      height: `${Math.max(0, h - (t + b) * zoom)}px`,
    });
    inputs.forEach((input, i) => {
      if (document.activeElement !== input) input.value = String(edges[i]);
      input.max = String(i % 2 === 0 ? size.height : size.width);
    });
    const none = edges.every((v) => v === 0);
    info.textContent = size.width
      ? `圖片 ${size.width} × ${size.height}・中間延伸區 ${Math.max(0, size.width - l - r)} × ${Math.max(0, size.height - t - b)}・${none ? '還沒有切割' : `bgSlice="${formatEdges(edges)}"`}`
      : '';
    drawPreviews();
  };

  const drawPreviews = () => {
    if (!size.width) return;
    const slice = formatEdges(edges);
    const sliceWidth = widthInput.value.trim() || undefined;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    for (const canvas of previews) {
      const cw = Number(canvas.dataset.w);
      const ch = Number(canvas.dataset.h);
      canvas.width = cw * dpr;
      canvas.height = ch * dpr;
      canvas.style.width = `${cw}px`;
      canvas.style.height = `${ch}px`;
      const ctx = canvas.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cw, ch);
      ctx.imageSmoothingEnabled = zoom < 2; // 小圖（像素風）放大時保持銳利
      if (edges.every((v) => v === 0))
        ctx.drawImage(img, 0, 0, cw, ch); // 沒有切割：整張拉伸
      else drawNineSlice(ctx, img, size, slice, sliceWidth, 0, 0, cw, ch);
    }
  };

  const setEdge = (i: number, value: number) => {
    if (linked) {
      // 四邊相同：最多到短邊的一半
      const v = Math.max(0, Math.min(Math.round(value), Math.floor(Math.min(size.width, size.height) / 2)));
      edges = [v, v, v, v];
    } else {
      const next = [...edges] as Edges;
      next[i] = clampOne(i, value, next);
      edges = next;
    }
    render();
  };

  // 拖曳線條
  const offs: (() => void)[] = [];
  const on = <K extends keyof HTMLElementEventMap>(
    el: HTMLElement | Window,
    type: K,
    fn: (e: HTMLElementEventMap[K]) => void,
  ) => {
    el.addEventListener(type, fn as EventListener);
    offs.push(() => el.removeEventListener(type, fn as EventListener));
  };
  lines.forEach((line, i) => {
    on(line, 'pointerdown', (e) => {
      e.preventDefault();
      line.setPointerCapture(e.pointerId);
      line.classList.add('drag');
      const box = imgBox.getBoundingClientRect();
      const move = (ev: PointerEvent) => {
        const px = (i % 2 === 0 ? ev.clientY - box.top : ev.clientX - box.left) / zoom;
        // 上、左從起點算；右、下從終點算
        const v = i === 0 || i === 3 ? px : (i === 1 ? size.width : size.height) - px;
        setEdge(i, v);
      };
      const up = () => {
        line.classList.remove('drag');
        line.removeEventListener('pointermove', move);
        line.removeEventListener('pointerup', up);
        line.removeEventListener('pointercancel', up);
      };
      line.addEventListener('pointermove', move);
      line.addEventListener('pointerup', up);
      line.addEventListener('pointercancel', up);
    });
    // 鍵盤：方向鍵微調（Shift 一次 10）
    on(line, 'keydown', (e) => {
      const step = e.shiftKey ? 10 : 1;
      const grow = i === 0 || i === 3 ? ['ArrowDown', 'ArrowRight'] : ['ArrowUp', 'ArrowLeft'];
      const shrink = i === 0 || i === 3 ? ['ArrowUp', 'ArrowLeft'] : ['ArrowDown', 'ArrowRight'];
      if (grow.includes(e.key)) setEdge(i, edges[i] + step);
      else if (shrink.includes(e.key)) setEdge(i, edges[i] - step);
      else return;
      e.preventDefault();
    });
  });
  inputs.forEach((input, i) => on(input, 'input', () => setEdge(i, Number(input.value) || 0)));
  on(linkBox, 'change', () => {
    linked = linkBox.checked;
    if (linked) setEdge(0, edges[0]);
  });
  on(widthInput, 'input', drawPreviews);
  on(q('.se-auto'), 'click', () => {
    // 建議值：短邊的四分之一（常見的框、按鈕）
    const v = Math.max(1, Math.floor(Math.min(size.width, size.height) / 4));
    linked = true;
    linkBox.checked = true;
    setEdge(0, v);
  });

  const close = () => {
    root!.classList.remove('open');
    for (const off of offs.splice(0)) off();
    closeCurrent = null;
  };
  closeCurrent = close;
  on(q('.se-cancel'), 'click', close);
  on(q('.se-x'), 'click', close);
  on(root, 'pointerdown', (e) => {
    if (e.target === root) close();
  });
  on(window, 'keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
    if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'BUTTON') {
      e.preventDefault();
      apply();
    }
  });
  const apply = () => {
    const none = edges.every((v) => v === 0);
    const width = widthInput.value.trim();
    options.onApply(none ? null : formatEdges(edges), none || !width ? null : width);
    close();
  };
  on(q('.se-apply'), 'click', apply);
  on(q('.se-clear'), 'click', () => {
    options.onApply(null, null);
    close();
  });

  // 載入圖片後決定放大倍率
  img.onload = () => {
    size = { width: img.naturalWidth, height: img.naturalHeight };
    zoom = Math.min(STAGE_W / size.width, STAGE_H / size.height, 12);
    if (zoom >= 1) zoom = Math.max(1, Math.floor(zoom)); // 整數倍放大，像素對齊
    imgBox.style.width = `${size.width * zoom}px`;
    imgBox.style.height = `${size.height * zoom}px`;
    stage.classList.toggle('pixel', zoom >= 2);
    edges = clampEdges(edges);
    render();
  };
  img.onerror = () => {
    size = { width: 0, height: 0 };
    status.textContent = `⚠ 無法載入圖片 ${options.imageName}`;
    info.textContent = '';
  };
  img.src = options.imageUrl;
  root.classList.add('open');
  requestAnimationFrame(() => lines[0]?.focus({ preventScroll: true }));
}

function createDom(): HTMLDivElement {
  const el = document.createElement('div');
  el.id = 'sliceEditor';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', '九宮格編輯器');
  el.innerHTML = `
    <div class="se-win">
      <div class="cp-head">
        <span class="cp-name">九宮格</span><span class="cp-tag se-name"></span>
        <span class="spacer"></span>
        <button class="se-x" title="關閉（Esc）">✕</button>
      </div>
      <div class="cp-desc">拖曳圖片上的四條線切出九宮格：<b>四角</b>保持原樣，<b>四邊</b>單向延伸，<b>中間</b>雙向延伸。數值是圖片的像素（也可以選取線條後用方向鍵微調，Shift 一次 10）。</div>
      <div class="se-body">
        <div class="se-stage"><div class="se-img"><img alt="" draggable="false" />
          <div class="se-shade"></div><div class="se-shade"></div><div class="se-shade"></div><div class="se-shade"></div>
          <div class="se-line h" tabindex="0" aria-label="上邊線"><span></span></div>
          <div class="se-line v" tabindex="0" aria-label="右邊線"><span></span></div>
          <div class="se-line h" tabindex="0" aria-label="下邊線"><span></span></div>
          <div class="se-line v" tabindex="0" aria-label="左邊線"><span></span></div>
        </div></div>
        <div class="se-side">
          <div class="se-label">切割（bgSlice，圖片像素）</div>
          <div class="se-edges">
            <label>上<input type="number" min="0" step="1" /></label>
            <label>右<input type="number" min="0" step="1" /></label>
            <label>下<input type="number" min="0" step="1" /></label>
            <label>左<input type="number" min="0" step="1" /></label>
          </div>
          <div class="se-row"><label class="follow"><input type="checkbox" id="seLink" /> 四邊相同</label><span class="spacer"></span><button class="se-auto ghost" title="用短邊的四分之一當切割值">自動</button></div>
          <div class="se-label">邊框顯示寬度（bgSliceWidth，可省略）</div>
          <input id="seWidth" placeholder="同切割（例如 24 或 12 24）" />
          <div class="se-label">預覽（延伸到不同大小）</div>
          <div class="se-previews"><canvas data-w="200" data-h="64"></canvas><canvas data-w="96" data-h="96"></canvas><canvas data-w="300" data-h="40"></canvas></div>
        </div>
      </div>
      <div class="se-info"></div>
      <div class="se-status"></div>
      <div class="se-foot">
        <button class="se-clear" title="移除 bgSlice、bgSliceWidth（整張圖片依 bgFit 顯示）">清除九宮格</button>
        <span class="spacer"></span>
        <button class="se-cancel">取消</button>
        <button class="se-apply primary">套用</button>
      </div>
    </div>`;
  document.body.appendChild(el);
  return el;
}
