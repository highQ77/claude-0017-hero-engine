/**
 * UICanvas 繪圖範例（data-lang="canvas"）：在頁面裡直接執行，不用預覽框。
 *
 * - 所有範例共用同一個 <UICanvas>（放在畫面外的介面裡）：瀏覽器同時能存在的 WebGL context 數量有限
 * - 執行前先 ctx.reset()，範例之間不會互相影響；結果複製到範例自己的畫布上顯示
 * - 右邊是同一段程式在原生 Canvas 2D 上的結果（data-native="false" 的範例沒有原生對照）
 * - 範例可以用的變數：ctx、canvas、uicanvas、UICanvas、Path2D、log、sampleImage、tile；可以用 await
 *
 * 章節裡放 <input type="checkbox" data-cv-compare checked> 可以切換是否顯示原生對照。
 */
import { UI2D, UICanvas, type WebGL2DRenderingContext } from '@engine/ui2d';

/** 範例畫布的大小（CSS 像素） */
const W = 320;
const H = 200;

// ───────── 範例共用素材 ─────────

/** 20×20 的圖樣磚 */
function makeTile(): HTMLCanvasElement {
  const tile = document.createElement('canvas');
  tile.width = tile.height = 20;
  const t = tile.getContext('2d')!;
  t.fillStyle = '#fde68a';
  t.fillRect(0, 0, 20, 20);
  t.fillStyle = '#b45309';
  t.fillRect(0, 0, 10, 10);
  t.fillRect(10, 10, 10, 10);
  t.fillStyle = '#1e40af';
  t.beginPath();
  t.arc(10, 10, 4, 0, Math.PI * 2);
  t.fill();
  return tile;
}

/** 160×100 的示範圖片 */
function makeSampleImage(): HTMLCanvasElement {
  const img = document.createElement('canvas');
  img.width = 160;
  img.height = 100;
  const s = img.getContext('2d')!;
  const sky = s.createLinearGradient(0, 0, 0, 100);
  sky.addColorStop(0, '#60a5fa');
  sky.addColorStop(1, '#dbeafe');
  s.fillStyle = sky;
  s.fillRect(0, 0, 160, 100);
  s.fillStyle = '#fbbf24';
  s.beginPath();
  s.arc(122, 28, 14, 0, Math.PI * 2);
  s.fill();
  s.fillStyle = '#4b5563';
  s.beginPath();
  s.moveTo(0, 80);
  s.lineTo(45, 30);
  s.lineTo(80, 70);
  s.lineTo(105, 45);
  s.lineTo(160, 85);
  s.lineTo(160, 100);
  s.lineTo(0, 100);
  s.fill();
  s.fillStyle = '#f8fafc';
  s.beginPath();
  s.moveTo(45, 30);
  s.lineTo(35, 42);
  s.lineTo(55, 42);
  s.fill();
  s.fillStyle = '#16a34a';
  s.fillRect(0, 88, 160, 12);
  s.fillStyle = '#111827';
  s.font = 'bold 11px sans-serif';
  s.fillText('sampleImage', 6, 14);
  return img;
}

let assets: { tile: HTMLCanvasElement; sampleImage: HTMLCanvasElement } | null = null;
const getAssets = () => (assets ??= { tile: makeTile(), sampleImage: makeSampleImage() });

// ───────── 共用的 UICanvas ─────────

interface Shared {
  uicanvas: UICanvas;
  ctx: WebGL2DRenderingContext;
}
let shared: Promise<Shared> | null = null;

function sharedCanvas(): Promise<Shared> {
  shared ??= (async () => {
    const host = document.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = `position:fixed;left:-10000px;top:0;width:${W}px;height:${H}px;pointer-events:none;`;
    document.body.append(host);
    const ui = await UI2D.create({ container: host });
    ui.loadString(`<UI><UICanvas id="doc" width="${W}" height="${H}" background="transparent"/></UI>`);
    const uicanvas = ui.require<UICanvas>('doc');
    return { uicanvas, ctx: uicanvas.getContext() };
  })();
  return shared;
}

/** 範例畫布的解析度倍率（和 UICanvas 的 pixelRatio 相同：螢幕像素比，最多 4） */
const PR = Math.max(1, Math.min(4, window.devicePixelRatio || 1));

// ───────── 原生 Canvas 2D 端 ─────────

type Native = CanvasRenderingContext2D & Record<string, unknown>;

/**
 * 原生 Canvas 2D：用 Proxy 讓 dpr 縮放永遠在最底層，行為與 UICanvas 的 pixelRatio 一致
 * （setTransform、resetTransform、reset 不會把縮放清掉；isPointInPath 用 CSS 座標；濾鏡、陰影長度以 CSS 像素計）
 */
function hidpiNative(n: CanvasRenderingContext2D, pr: number): CanvasRenderingContext2D {
  const base = () => n.setTransform(pr, 0, 0, pr, 0, 0);
  const scaled: Record<string, unknown> = {};
  const pt = (a: unknown[]): unknown[] =>
    a[0] && typeof a[0] === 'object'
      ? [a[0], (a[1] as number) * pr, (a[2] as number) * pr, ...a.slice(3)]
      : [(a[0] as number) * pr, (a[1] as number) * pr, ...a.slice(2)];
  const over: Record<string, unknown> = {
    pixelRatio: pr,
    setTransform(...a: unknown[]) {
      (n.setTransform as (...x: unknown[]) => void)(...a);
      const m = n.getTransform();
      n.setTransform(new DOMMatrix().scaleSelf(pr, pr).multiplySelf(m));
    },
    resetTransform: base,
    getTransform: () => new DOMMatrix().scaleSelf(1 / pr, 1 / pr).multiplySelf(n.getTransform()),
    reset() {
      if (n.reset) n.reset();
      else {
        // 舊瀏覽器沒有 reset()：重設寬度會清空畫布與狀態
        const w = n.canvas.width;
        n.canvas.width = w;
      }
      base();
      for (const k in scaled) delete scaled[k];
    },
    isPointInPath: (...a: unknown[]) => (n.isPointInPath as (...x: unknown[]) => boolean)(...pt(a)),
    isPointInStroke: (...a: unknown[]) => (n.isPointInStroke as (...x: unknown[]) => boolean)(...pt(a)),
  };
  // 原生的 filter / shadow 長度以 backing store 像素計算，乘上 dpr 才會與 CSS 像素一致
  const NUM = ['shadowBlur', 'shadowOffsetX', 'shadowOffsetY'];
  const px = (v: string) => v.replace(/(-?\d*\.?\d+)px/g, (_, x: string) => `${Number(x) * pr}px`);
  return new Proxy(n as Native, {
    get(t, k: string) {
      if (k in over) return over[k];
      if (k in scaled) return scaled[k];
      const v = t[k];
      return typeof v === 'function' ? (v as (...x: unknown[]) => unknown).bind(t) : v;
    },
    set(t, k: string, v: unknown) {
      if (NUM.includes(k)) {
        // 無效值會被原生忽略，讀回原值
        t[k] = (v as number) * pr;
        scaled[k] = (t[k] as number) / pr;
      } else if (k === 'filter' && typeof v === 'string') {
        const before = t.filter;
        t.filter = px(v);
        if (t.filter !== before || px(v) === before) scaled.filter = v;
      } else t[k] = v;
      return true;
    },
  });
}

// ───────── 執行 ─────────

function fmt(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v instanceof Error) return `${v.name}: ${v.message}`;
  if (ArrayBuffer.isView(v)) v = Array.from(v as unknown as ArrayLike<number>);
  if (v && typeof v === 'object') {
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
  return String(v);
}

type AsyncFn = (...args: unknown[]) => Promise<unknown>;
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (...args: string[]) => AsyncFn;
const PARAMS = ['ctx', 'canvas', 'uicanvas', 'UICanvas', 'Path2D', 'log', 'sampleImage', 'tile'];

function exec(code: string, env: Record<string, unknown>): Promise<unknown> {
  const fn = new AsyncFunction(...PARAMS, `"use strict";\n${code}`);
  return fn(...PARAMS.map((p) => env[p]));
}

/** 是否顯示原生對照（章節裡的 data-cv-compare 勾選框） */
const showNative = () => document.querySelector<HTMLInputElement>('[data-cv-compare]')?.checked ?? true;

// 所有範例共用同一個 UICanvas，所以排隊依序執行
let queue: Promise<unknown> = Promise.resolve();
const mounted = new Set<CanvasExample>();

export class CanvasExample {
  readonly element: HTMLElement;
  private readonly glView: HTMLCanvasElement;
  private readonly nView: HTMLCanvasElement | null;
  private readonly time: HTMLElement;
  private nctx: CanvasRenderingContext2D | null = null;
  private timer = 0;
  ran = false;

  constructor(
    private readonly getCode: () => string,
    private readonly print: (level: string, text: string) => void,
    private readonly clearLog: () => void,
    readonly native: boolean,
  ) {
    const el = (this.element = document.createElement('div'));
    el.className = 'cv-result';
    const fig = (caption: string, body: HTMLElement, cls = '') => {
      const f = document.createElement('figure');
      f.className = cls;
      const c = document.createElement('figcaption');
      const s = document.createElement('span');
      s.textContent = caption;
      c.append(s);
      f.append(c, body);
      el.append(f);
      return c;
    };
    const view = () => {
      const c = document.createElement('canvas');
      c.width = Math.round(W * PR);
      c.height = Math.round(H * PR);
      return c;
    };
    this.glView = view();
    this.time = document.createElement('span');
    this.time.className = 'cv-time';
    fig('UICanvas（WebGL）', this.glView).append(this.time);
    if (native) {
      this.nView = view();
      fig('原生 Canvas 2D', this.nView, 'cv-native');
    } else {
      this.nView = null;
      const p = document.createElement('p');
      p.className = 'cv-only';
      p.textContent = '這是 UICanvas（WebGL2D）專屬的 API，沒有原生版本可以對照。';
      fig('原生 Canvas 2D', p, 'cv-native');
    }
    mounted.add(this);
  }

  /** 停止輸入約半秒後重新執行 */
  schedule(): void {
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.run(), 500);
  }

  run(): Promise<void> {
    clearTimeout(this.timer);
    this.ran = true;
    const p = queue.then(() => this.runNow());
    queue = p.catch(() => {});
    return p;
  }

  dispose(): void {
    clearTimeout(this.timer);
    mounted.delete(this);
  }

  private async runNow(): Promise<void> {
    const code = this.getCode();
    this.clearLog();
    const log = (...a: unknown[]) => this.print('log', a.map(fmt).join(' '));
    const { sampleImage, tile } = getAssets();

    // UICanvas（WebGL2D）
    const view = this.glView.getContext('2d')!;
    view.clearRect(0, 0, this.glView.width, this.glView.height);
    let s: Shared;
    try {
      s = await sharedCanvas();
    } catch (error) {
      this.print('error', `無法建立 WebGL context：${fmt(error)}`);
      return;
    }
    const t0 = performance.now();
    try {
      s.ctx.reset();
      await exec(code, {
        ctx: s.ctx,
        canvas: s.uicanvas.canvas,
        uicanvas: s.uicanvas,
        UICanvas,
        Path2D: UICanvas.Path2D,
        log,
        sampleImage,
        tile,
      });
    } catch (error) {
      this.print('error', `UICanvas 錯誤 → ${fmt(error)}`);
    }
    view.drawImage(s.uicanvas.canvas, 0, 0, this.glView.width, this.glView.height);
    this.time.textContent = `${(performance.now() - t0).toFixed(1)} ms`;

    // 原生 Canvas 2D 對照
    if (this.nView && showNative()) {
      const nc = this.nView;
      this.nctx ??= hidpiNative(nc.getContext('2d')!, PR);
      const nctx = this.nctx;
      nctx.reset();
      // 原生端的 uicanvas：getContext() 回傳原生 context，讓同一段程式兩邊都能執行
      const fake = { getContext: () => nctx, canvas: nc, width: W, height: H, pixelRatio: PR, update() {} };
      try {
        await exec(code, {
          ctx: nctx,
          canvas: nc,
          uicanvas: fake,
          UICanvas,
          Path2D: window.Path2D,
          log: () => {},
          sampleImage,
          tile,
        });
      } catch (error) {
        this.print('error', `原生 Canvas 2D 錯誤 → ${fmt(error)}`);
      }
    }
  }
}

// 原生對照開關：切換顯示，重新執行已經執行過的範例
document.addEventListener('change', (e) => {
  const input = e.target as HTMLElement;
  if (!input.matches?.('[data-cv-compare]')) return;
  const on = (input as HTMLInputElement).checked;
  document.documentElement.classList.toggle('cv-hide-native', !on);
  if (on) for (const ex of mounted) if (ex.ran) void ex.run();
});

/** 測試用：依序執行目前章節的所有 UICanvas 範例，回傳每個範例的輸出 */
(window as unknown as { __runCanvasExamples?: () => Promise<unknown> }).__runCanvasExamples = async () => {
  const res: { title: string; errors: string[] }[] = [];
  for (const ex of mounted) {
    await ex.run();
    const fig = ex.element.closest('figure.example');
    res.push({
      title: fig?.querySelector('.ex-title')?.textContent ?? '',
      errors: [...(fig?.querySelectorAll('.log-error') ?? [])].map((e) => e.textContent ?? ''),
    });
  }
  return res;
};
