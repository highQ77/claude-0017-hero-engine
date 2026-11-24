/**
 * 2D 介面的網頁層：<UIWeb> 元件的真正 HTML 元素放在畫布下面的一層，跟著元件的排版位置移動；
 * 介面在元件的位置挖洞（元件自己清掉下面畫的東西，3D 畫面用 RenderPlugin.setScreenHoles 變透明），網頁就露出來。
 * 之後畫的元件（對話框、通知、下拉選單）照樣蓋在網頁上面。
 */
import type { RenderPlugin, ScreenHole } from '../render/RenderPlugin';
import type { UI2D } from './UI2D';
import { UIScrollView, type Rect, type UIElement } from './elements';
import { num } from './draw';
import { UIWeb } from './widgets/web';

/** iframe 的權限：和 YouTube 嵌入碼相同（自動播放、加密影片、子母畫面、全螢幕、陀螺儀、分享…） */
const IFRAME_ALLOW =
  'accelerometer; autoplay; clipboard-write; encrypted-media; fullscreen; gyroscope; picture-in-picture; web-share';

/** 一個網頁元件的 HTML 元素 */
interface WebBox {
  /** 外層元素（位置、大小、裁切、圓角） */
  box: HTMLDivElement;
  /** 目前的內容（換 src、html 時重建） */
  key: string;
}

/** 兩個矩形的交集（沒有交集時寬或高是 0） */
function intersect(a: Rect, b: Rect): Rect {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x),
    height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y),
  };
}

/**
 * 管理 <UIWeb> 的 HTML 元素（UIPlugin 建立；每次繪製前呼叫 update）。
 * 介面裡沒有 <UIWeb> 時什麼都不做（不會動到畫布的樣式）。
 */
export class UIWebLayer {
  private layer: HTMLDivElement | null = null;
  private readonly boxes = new Map<UIWeb, WebBox>();
  private holesKey = '';
  private layerKey = '';
  /** 滑鼠目前所在的網頁元件（這時畫布不接收滑鼠） */
  private active: UIWeb | null = null;
  private readonly cleanup: (() => void)[] = [];

  /**
   * @param ui 介面
   * @param render 繪製外掛（畫布、畫面上的洞）
   */
  constructor(
    private readonly ui: UI2D,
    private readonly render: RenderPlugin,
  ) {}

  /** 滑鼠目前所在的網頁元件（沒有時是 null） */
  get activeElement(): UIWeb | null {
    return this.active;
  }

  /** 每次繪製前：網頁元素跟著元件的位置、可見性、裁切；更新畫面上的洞 */
  update(): void {
    const ui = this.ui;
    const found: { el: UIWeb; rect: Rect; visible: Rect; opacity: number; clipped: boolean }[] = [];
    if (ui.root) {
      const visit = (el: UIElement, opacity: number, clip: Rect | null): void => {
        if (!el.visible) return;
        const o = opacity * (el.attrs.opacity !== undefined ? num(el.attrs.opacity, 1) : 1) * Math.max(0, el.alpha);
        if (o <= 0.001) return;
        if (el instanceof UIWeb) {
          const rect = el.absoluteRect;
          const visible = clip ? intersect(rect, clip) : rect;
          if (visible.width > 0 && visible.height > 0)
            found.push({
              el,
              rect,
              visible,
              opacity: o,
              clipped: visible.width < rect.width || visible.height < rect.height,
            });
        }
        const childClip =
          el instanceof UIScrollView ? (clip ? intersect(clip, el.absoluteRect) : el.absoluteRect) : clip;
        for (const c of el.children) visit(c, o, childClip);
      };
      visit(ui.root, 1, null);
    }
    // 移除已經不在介面裡的元件；暫時看不到的（例如在別的分頁）只隱藏，iframe 的內容保留
    for (const [el, b] of this.boxes) {
      if (el.isDestroyed || el.ctx !== ui.root?.ctx) {
        b.box.remove();
        this.boxes.delete(el);
        el.element = el.iframe = null;
        if (this.active === el) this.leave();
      } else b.box.style.display = 'none';
    }
    if (found.length === 0 && !this.layer) return;
    const layer = this.ensureLayer();
    const canvas = this.canvas;
    const r = canvas.getBoundingClientRect();
    const layerKey = `${r.left}|${r.top}|${r.width}|${r.height}`;
    if (layerKey !== this.layerKey) {
      this.layerKey = layerKey;
      Object.assign(layer.style, {
        left: `${r.left}px`,
        top: `${r.top}px`,
        width: `${r.width}px`,
        height: `${r.height}px`,
      });
    }
    // 介面座標 → 畫布的 CSS 像素（畫面上）與繪製的 CSS 像素（洞）
    const sx = r.width / Math.max(1, ui.size.width);
    const sy = r.height / Math.max(1, ui.size.height);
    const hx = this.render.size.width / Math.max(1, ui.size.width);
    const hy = this.render.size.height / Math.max(1, ui.size.height);
    const holes: ScreenHole[] = [];
    for (const f of found) {
      const b = this.boxOf(f.el, layer);
      const s = b.box.style;
      const radius = num(f.el.attrs.radius, 0);
      s.display = '';
      s.left = `${f.rect.x * sx}px`;
      s.top = `${f.rect.y * sy}px`;
      s.width = `${f.rect.width}px`;
      s.height = `${f.rect.height}px`;
      s.transform = sx === 1 && sy === 1 ? '' : `scale(${sx}, ${sy})`;
      s.borderRadius = `${radius}px`;
      s.background = f.el.attrs.background ?? '';
      s.opacity = f.opacity >= 0.999 ? '' : String(f.opacity);
      s.pointerEvents = f.el.attrs.pointerEvents === 'none' ? 'none' : 'auto';
      // 在列表裡被裁掉的部分（元件自己的座標）
      const top = f.visible.y - f.rect.y;
      const left = f.visible.x - f.rect.x;
      const bottom = f.rect.y + f.rect.height - (f.visible.y + f.visible.height);
      const right = f.rect.x + f.rect.width - (f.visible.x + f.visible.width);
      s.clipPath = f.clipped ? `inset(${top}px ${right}px ${bottom}px ${left}px)` : '';
      holes.push({
        x: f.visible.x * hx,
        y: f.visible.y * hy,
        width: f.visible.width * hx,
        height: f.visible.height * hy,
        radius: f.clipped ? 0 : radius * hx,
        strength: f.opacity,
      });
    }
    const key = JSON.stringify(holes);
    if (key !== this.holesKey) {
      this.holesKey = key;
      this.render.setScreenHoles(holes);
    }
  }

  /** 移除所有網頁元素、還原畫布 */
  dispose(): void {
    for (const fn of this.cleanup.splice(0)) fn();
    for (const [el, b] of this.boxes) {
      b.box.remove();
      el.element = el.iframe = null;
    }
    this.boxes.clear();
    this.layer = null;
    if (this.holesKey) this.render.setScreenHoles([]);
    this.holesKey = '';
  }

  // ───────── 內部 ─────────

  private get canvas(): HTMLCanvasElement {
    return this.render.renderer.domElement as HTMLCanvasElement;
  }

  /** 第一次有網頁元件時才建立網頁層（放在畫布下面）與滑鼠處理 */
  private ensureLayer(): HTMLDivElement {
    if (this.layer) return this.layer;
    const canvas = this.canvas;
    const layer = (this.layer = document.createElement('div'));
    layer.className = 'hero-web-layer-2d';
    // clip：不能被捲動（iframe 裡點錨點連結時，瀏覽器會連外層的捲動區域一起捲，網頁會移出洞外）
    Object.assign(layer.style, { position: 'fixed', overflow: 'clip', zIndex: '0', pointerEvents: 'none' });
    layer.addEventListener('scroll', () => layer.scrollTo(0, 0));
    canvas.parentElement?.insertBefore(layer, canvas);
    this.cleanup.push(() => layer.remove());
    // 畫布在上面（洞的地方透明，露出網頁）
    const prev = { position: canvas.style.position, zIndex: canvas.style.zIndex };
    if (getComputedStyle(canvas).position === 'static') canvas.style.position = 'relative';
    canvas.style.zIndex = '1';
    this.cleanup.push(() => {
      Object.assign(canvas.style, prev);
      canvas.style.pointerEvents = '';
    });
    // 滑鼠移到露出的網頁上：畫布暫時不接收滑鼠，事件直接到網頁；離開網頁元素時還原
    const onMove = (e: PointerEvent) => {
      // 已經在網頁上：主頁面又收到移動、而且不在那個網頁元素裡，表示滑鼠已經離開網頁
      // （別的網域的 iframe（例如 YouTube）在獨立的程序裡，離開時 pointerleave 不一定會送到）
      if (this.active) {
        const box = this.boxes.get(this.active)?.box;
        if (!box || !(e.target instanceof Node && box.contains(e.target))) this.leave();
        return;
      }
      if (e.target !== canvas || e.buttons !== 0) return;
      const r = canvas.getBoundingClientRect();
      const x = ((e.clientX - r.left) * this.ui.size.width) / Math.max(1, r.width);
      const y = ((e.clientY - r.top) * this.ui.size.height) / Math.max(1, r.height);
      const hit = this.ui.hitTest(x, y);
      if (hit instanceof UIWeb && this.boxes.get(hit)?.box.style.display === '') this.enter(hit);
    };
    window.addEventListener('pointermove', onMove, true);
    this.cleanup.push(() => window.removeEventListener('pointermove', onMove, true));
    return layer;
  }

  private enter(el: UIWeb): void {
    const b = this.boxes.get(el);
    if (!b) return;
    this.active = el;
    this.ui.handlePointer('leave', 0, 0); // 介面的滑鼠移入效果收起來
    this.canvas.style.pointerEvents = 'none';
    b.box.addEventListener('pointerleave', this.onBoxLeave);
  }

  /** 離開網頁元素的範圍：還給介面與遊戲 */
  private readonly onBoxLeave = (): void => this.leave();

  private leave(): void {
    if (this.active) this.boxes.get(this.active)?.box.removeEventListener('pointerleave', this.onBoxLeave);
    this.active = null;
    this.canvas.style.pointerEvents = '';
  }

  /** 元件的 HTML 元素（沒有就建立）；內容改變時重建 */
  private boxOf(el: UIWeb, layer: HTMLDivElement): WebBox {
    let b = this.boxes.get(el);
    if (!b) {
      const box = document.createElement('div');
      box.className = 'hero-web-2d';
      Object.assign(box.style, { position: 'absolute', overflow: 'clip', transformOrigin: '0 0' });
      box.addEventListener('scroll', () => box.scrollTo(0, 0));
      layer.appendChild(box);
      b = { box, key: '' };
      this.boxes.set(el, b);
      el.element = box;
    }
    const key = `${el.src}\u0000${el.html}`;
    if (b.key !== key) {
      b.key = key;
      b.box.replaceChildren();
      el.iframe = null;
      if (el.src) {
        const iframe = document.createElement('iframe');
        iframe.src = el.ctx.resolveUrl(el.src, el); // 和其他元件的 src 一樣：以介面檔所在的資料夾為準
        iframe.style.cssText = 'width:100%;height:100%;border:0;display:block;background:transparent';
        // 和 YouTube 等影片網站的嵌入碼相同的權限（自動播放、加密影片、子母畫面、全螢幕…）
        iframe.allow = IFRAME_ALLOW;
        // 送出來源網站（YouTube 等嵌入的影片需要知道是哪個網站嵌入的，否則可能出現播放器設定錯誤）
        iframe.referrerPolicy = 'strict-origin-when-cross-origin';
        b.box.appendChild(iframe);
        el.iframe = iframe;
      } else if (el.html) b.box.innerHTML = el.html;
    }
    return b;
  }
}
