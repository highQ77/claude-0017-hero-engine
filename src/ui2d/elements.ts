import {
  Align,
  Display,
  Edge,
  FlexDirection,
  Gutter,
  Justify,
  MeasureMode,
  Overflow,
  PositionType,
  Wrap,
  type Node as YogaNode,
  type Yoga,
} from 'yoga-layout/load';
import { wrapText, type FontSpec, type MeasureTextWidth, type TextMetrics } from './text';
import type { XmlNode } from './xml';
import { createLogger } from '../core/Logger';

const log = createLogger('ui2d');

/** XML 屬性：名稱 → 字串值（例如 { width: '120', color: '#fff' }） */
export type Attrs = Record<string, string>;

/** 介面事件（onClick、onChange 等處理函式收到的資料） */
export interface UIEvent {
  /** 事件名稱：click、change、input、drop… */
  type: string;
  /** 觸發事件的元件 */
  target: UIElement;
  /** UIList 樣板產生的元件：對應的資料與索引 */
  item?: unknown;
  /** UIList 樣板產生的元件：在清單裡的位置（從 0 開始） */
  index?: number;
  /** change 事件：新的值（勾選框為 true / false，單選按鈕與下拉選單為 value） */
  value?: unknown;
  /** change 事件：勾選框、單選按鈕是否勾選 */
  checked?: boolean;
  /** drop 事件：被拖曳過來的元件（例如另一個物品格） */
  source?: UIElement;
  /** 瀏覽器原本的事件（滑鼠、鍵盤），沒有時是 undefined */
  originalEvent?: Event;
}

/** 事件處理函式：XML 的 onClick="名稱" 對應 handlers 裡的同名函式 */
export type UIHandler = (event: UIEvent) => void;

/** 圖片的原始尺寸（像素） */
export interface ImageSize {
  /** 寬（像素） */
  width: number;
  /** 高（像素） */
  height: number;
}

/** 圖片載入器：回傳圖片原始尺寸（瀏覽器用 Image，測試可以替換） */
export type ImageLoader = (url: string) => Promise<ImageSize>;

/** 元件需要的共用環境（由 UI2D 提供） */
export interface UIContext {
  /** 排版引擎（Yoga） */
  yoga: Yoga;
  /** 量文字寬度的函式 */
  measure: MeasureTextWidth;
  /** 目前生效的斷點（由小到大），例如 ['sm', 'md'] */
  activeBreakpoints: readonly string[];
  /** 目前的樣式（<UIStyle name>）：名稱 → 屬性 */
  styles: Map<string, Attrs>;
  /** 還有 <UIImport> 的檔案在讀取中（讀好後會重新套用樣式，這段期間找不到樣式不用警告） */
  readonly importsPending?: boolean;
  /** 元件外觀（skin）：每種元件的預設屬性，例如所有 UIButton 的顏色 */
  skins: Map<string, Attrs>;
  /** 載入圖片的函式 */
  loadImage: ImageLoader;
  /** 相對路徑 → 網址；from 是寫這個路徑的元件（以它所在的介面檔為基準） */
  resolveUrl(src: string, from?: UIElement): string;
  /** 事件處理函式：XML 的 onClick="名稱" 對應這裡的同名函式 */
  handlers: Record<string, UIHandler>;
  /** 要求重新排版；reapply 為 true 時重新套用所有屬性 */
  requestLayout(reapply?: boolean): void;
  /** 開關下拉選單（由 UI2D 管理；null 為關閉） */
  openPopup?(select: UISelect | null): void;
  /** 只要求重畫（外觀改變、排版不變）；需要重畫的範圍請先用 damage 標記 */
  invalidate?(): void;
  /** 標記某個元件的範圍需要重畫（局部重畫用）；pad 為額外的邊界（陰影、提示） */
  damage?(el: UIElement, pad?: number): void;
  /** 預設樣式的空白節點（重設樣式用） */
  blankNode: YogaNode;
  /** 讓元件每幀收到 tick(dt)（動畫用），tick 回傳 false 時停止 */
  animate?(el: UIElement): void;
  /** 標記任意範圍需要重畫（拖曳中的圖示、浮動說明等不屬於任何元件的東西） */
  damageRect?(rect: Rect): void;
  /** 設定或移除畫在最上層的東西（key 用來識別；painter 為 null 時移除） */
  setOverlay?(key: object, painter: OverlayPainter | null): void;
  /** 介面目前的尺寸 */
  viewport?(): { width: number; height: number };
  /** 編輯器模式：空的容器顯示成虛線框（有最小尺寸），才看得到、拖得進去 */
  editorHints?: boolean;
  /** 已載入的圖片（元件自己繪製圖片時用） */
  imageSource?(url: string): CanvasImageSource | undefined;
  /** 顯示層把 UICanvas 分開疊上去（引擎內的介面才有）：畫布內容不用複製進介面畫布 */
  canvasLayers?(): UICanvasLayers | null;
}

/**
 * 畫布分層：顯示層把 UICanvas 的內容用它自己的貼圖疊在介面上（一塊四邊形），不複製進介面畫布。
 * 畫布每幀重畫（動畫、圖表）時，介面不用重畫、不用上傳；蓋在畫布上面的東西（下拉選單、提示）出現時，
 * 顯示層會改回複製進介面（才能維持上下順序）。
 */
export interface UICanvasLayers {
  /** 這個畫布現在是不是分層顯示（是的話介面只畫它的背景與邊框） */
  isLayered(el: UIElement): boolean;
  /** 分層顯示的畫布畫了新內容（它的貼圖已經標記要更新）：介面不用重畫，只要再畫一幀 */
  contentChanged(el: UIElement): void;
  /**
   * 3D 畫面用 WebGL 2 繪製時（瀏覽器不支援 WebGPU 的備援）：借用它的 WebGL，畫布直接畫進它的貼圖，
   * 疊上介面、貼到 3D 都不用複製。WebGPU 時是 null（畫布用自己的 WebGL，再上傳成貼圖）
   */
  sharedGL?(): { gl: WebGL2RenderingContext; resetState(): void } | null;
}

/** 畫在所有元件之上的東西（座標為介面座標） */
export type OverlayPainter = (ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D) => void;

/** 元件接管指標：按下後，移動與放開都交給它（拖曳搖桿、移動視窗、拖曳物品） */
export interface PointerCapture {
  /** target 為目前滑鼠下的元件 */
  move(x: number, y: number, target: UIElement | null): void;
  /** target 為放開時滑鼠下的元件 */
  up(x: number, y: number, target: UIElement | null): void;
  /** 被中斷（沒收到放開：視窗失去焦點、觸控被瀏覽器取消）：還原狀態，不要當成放開 */
  cancel?(): void;
}

/** 矩形（介面座標，像素） */
export interface Rect {
  /** 左邊（像素） */
  x: number;
  /** 上邊（像素） */
  y: number;
  /** 寬（像素） */
  width: number;
  /** 高（像素） */
  height: number;
}

// ───────── 屬性值解析 ─────────

type Dim = number | 'auto' | `${number}%`;

/** 寬高寫 fit：依內容決定大小（不會被父元件拉伸，最外層的 <UI> 也不會滿版） */
export function isFitDim(v: string | undefined): boolean {
  return v !== undefined && v.trim() === 'fit';
}

export function parseDim(v: string | undefined): Dim | undefined {
  if (v === undefined || v === '') return undefined;
  const s = v.trim();
  if (s === 'auto') return 'auto';
  if (s.endsWith('%')) {
    const n = parseFloat(s);
    return Number.isFinite(n) ? (`${n}%` as const) : undefined;
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : undefined;
}

/** CSS 式的四邊簡寫："8"、"8 16"、"8 16 4"、"8 16 4 2"（上 右 下 左） */
export function parseEdges(v: string): [Dim, Dim, Dim, Dim] | undefined {
  const parts = v
    .trim()
    .split(/\s+/)
    .map((p) => parseDim(p));
  if (parts.some((p) => p === undefined)) return undefined;
  const [a, b = a, c = a, d = b] = parts as Dim[];
  return [a, b, c, d];
}

const num = (v: string | undefined, fallback: number) => {
  const n = v === undefined ? NaN : parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
};
const bool = (v: string | undefined) => v !== undefined && v !== 'false' && v !== '0';

const ALIGN: Record<string, Align> = {
  start: Align.FlexStart,
  center: Align.Center,
  end: Align.FlexEnd,
  stretch: Align.Stretch,
  baseline: Align.Baseline,
};
const JUSTIFY: Record<string, Justify> = {
  start: Justify.FlexStart,
  center: Justify.Center,
  end: Justify.FlexEnd,
  between: Justify.SpaceBetween,
  around: Justify.SpaceAround,
  evenly: Justify.SpaceEvenly,
};

// ───────── 基礎元件 ─────────

/**
 * set() 時只影響這個元件外觀的屬性：不改大小位置、不傳給子元件，所以只重畫元件自己的範圍。
 * （opacity 會連子元件一起變淡、border 含寬度會影響排版，所以不在這裡）
 */
const PAINT_ONLY_ATTRS = new Set(['color', 'background', 'fill', 'trackColor']);

/**
 * 介面元件的基礎類別。
 *
 * 排版屬性（交給 Yoga）：width height minWidth maxWidth minHeight maxHeight
 *   flex grow shrink basis margin padding（含 marginTop 等）gap align justify self wrap
 *   position="absolute" left top right bottom aspectRatio hidden
 * 外觀屬性（由 UIPainter 在引擎內繪製）：background color radius border opacity shadow cursor
 *
 * 任何屬性都可以加斷點前綴，例如 md:dir="h"（螢幕寬度 ≥ md 時套用）。
 */
export class UIElement {
  /** XML 的 id 屬性（沒有時是 null）；用 ui.get(id) 找到這個元件 */
  id: string | null;
  /** 父元件（根元件是 null） */
  parent: UIElement | null = null;
  /** 子元件（依 XML 的順序） */
  readonly children: UIElement[] = [];
  /** XML 上寫的原始屬性（含斷點前綴） */
  readonly raw: Attrs;
  /** 套用樣式與斷點後的屬性 */
  attrs: Attrs = {};
  /** 排版節點（Yoga）：進階用途，一般用屬性設定排版 */
  readonly node: YogaNode;
  /** 相對於父元素的位置與大小（排版後更新） */
  readonly layout: Rect = { x: 0, y: 0, width: 0, height: 0 };
  /** UIList 樣板產生時的資料 */
  item?: unknown;
  /** UIList 樣板產生的元件：在清單裡的位置 */
  index?: number;
  /** 原始碼行號（錯誤訊息用） */
  line = 0;
  /**
   * 這個元件所在介面檔的資料夾（例如 ui/orbit/）：圖片等相對路徑以它為基準。
   * null：用主文件的位置（ui.load 的檔案）。疊加圖層、內嵌元件的內容會記錄自己的檔案位置。
   */
  baseUrl: string | null = null;
  /** 由容器控制的隱藏（例如 UIStackView 只顯示一頁），不會改到 XML 的 hidden 屬性 */
  forceHidden = false;
  /**
   * 樣式範圍：疊加圖層（另一份 XML）自己的 <UIStyle>、<UISkin> 只套用在圖層裡，
   * 不會影響其他畫面。設在圖層的根元件上。
   */
  styleScope: { styles: Map<string, Attrs>; skins: Map<string, Attrs> } | null = null;
  /** 由 <UIComponent src> 內嵌進來的元件：來源檔案的網址（line 是那個檔案的行號）；自己文件裡的元件是 null */
  includedFrom: string | null = null;
  /** 執行中的透明度倍率與位移（動畫用，不影響排版；位移會連同子元件一起移動） */
  alpha = 1;
  /** 額外的水平位移（不影響排版；拖曳視窗、動畫用） */
  offsetX = 0;
  /** 額外的垂直位移（不影響排版；拖曳視窗、動畫用） */
  offsetY = 0;
  private readonly listeners = new Map<string, Set<UIHandler>>();
  private destroyed = false;
  /** 已經要求載入的背景圖片 */
  private readonly bgRequested = new Set<string>();

  /** 動畫：每幀呼叫（需先 ctx.animate(this)），回傳 false 代表動畫結束 */
  tick?(dt: number): boolean;

  /** 按下時接管指標（回傳 null 走一般的點擊流程） */
  pointerDown?(x: number, y: number): PointerCapture | null;

  /** XML 子節點的特殊處理（例如對話框的選項），回傳 true 代表已處理 */
  consumeChild?(node: XmlNode): boolean;

  /** XML 子元件都加入後呼叫 */
  onBuilt?(): void;

  /** XML 裡的子元件要加到哪裡（視窗、分頁會加到內容區） */
  get contentParent(): UIElement {
    return this;
  }

  /** 已經被移除（destroy） */
  get isDestroyed(): boolean {
    return this.destroyed;
  }

  /** 內距（排版後的實際值）：文字等內容要畫在內距裡面 */
  get padding(): { top: number; right: number; bottom: number; left: number } {
    const n = this.node;
    return {
      top: n.getComputedPadding(Edge.Top),
      right: n.getComputedPadding(Edge.Right),
      bottom: n.getComputedPadding(Edge.Bottom),
      left: n.getComputedPadding(Edge.Left),
    };
  }

  /** 畫到自己範圍外多遠（陰影、數值提示）；局部重畫時至少重畫這麼寬的邊界 */
  get paintBleed(): number {
    return 16;
  }

  /**
   * 自訂繪製（選擇性）：在背景與邊框之後、子元件之前呼叫，
   * 讓自訂元件畫出圖表等內容。座標為介面座標（已換算像素比）。
   */
  paintContent?(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
  ): void;

  /** 外觀改變、排版不變時要求重畫（只重畫這個元件的範圍） */
  invalidate(): void {
    this.ctx.damage?.(this);
    if (this.ctx.invalidate) this.ctx.invalidate();
    else this.ctx.requestLayout();
  }

  constructor(
    /** 所屬介面的環境（排版引擎、樣式、圖片載入…） */
    readonly ctx: UIContext,
    /** 元件類型（XML 標籤名稱，例如 'UIButton'） */
    readonly type: string,
    raw: Attrs = {},
  ) {
    this.raw = { ...raw };
    this.id = raw.id ?? null;
    this.node = ctx.yoga.Node.create();
  }

  /** 元件類型的預設屬性（優先度最低） */
  defaults(): Attrs {
    return {};
  }

  // ───────── 屬性 ─────────

  /** 取得屬性目前的值（套用樣式、外觀、斷點之後），沒有時是 undefined */
  get(name: string): string | undefined {
    return this.attrs[name];
  }

  /** 修改屬性（會重新排版）。value 為 null 時移除 */
  set(name: string, value: string | number | null): this {
    // 值沒變就不重新排版（每幀呼叫 set 時，避免每幀整張介面重畫）
    if ((value === null ? undefined : String(value)) === this.raw[name]) return this;
    if (value === null) delete this.raw[name];
    else this.raw[name] = String(value);
    if (name === 'id') this.id = value === null ? null : String(value);
    // 立刻重新計算屬性：設定後馬上讀取（例如 visible）就是新的值
    this.resolve();
    // 只影響外觀的屬性（顏色、背景）：不用重新排版，只重畫這個元件的範圍。
    // 其他屬性可能改變大小或位置，要整份重新套用（整張重畫、整張上傳貼圖，高解析度螢幕約 10 ms）
    if (PAINT_ONLY_ATTRS.has(name)) this.invalidate();
    else this.ctx.requestLayout(true);
    return this;
  }

  /** 是否顯示（hidden 屬性的相反）；設成 false 會隱藏並不佔排版空間 */
  get visible(): boolean {
    return !this.forceHidden && !bool(this.attrs.hidden);
  }

  set visible(v: boolean) {
    this.set('hidden', v ? null : 'true');
  }

  /** 依樣式、元件預設與目前斷點，算出最終屬性 */
  resolve(): void {
    const out: Attrs = {};
    const base = (src: Attrs) => {
      for (const [k, v] of Object.entries(src)) if (!k.includes(':')) out[k] = v;
    };
    const responsive = (src: Attrs) => {
      for (const bp of this.ctx.activeBreakpoints) {
        const prefix = `${bp}:`;
        for (const [k, v] of Object.entries(src)) if (k.startsWith(prefix)) out[k.slice(prefix.length)] = v;
      }
    };
    // 樣式範圍：由近到遠（內嵌元件 → 圖層），最後才是整份介面的
    const scopes: NonNullable<UIElement['styleScope']>[] = [];
    for (let e: UIElement | null = this; e; e = e.parent) if (e.styleScope) scopes.push(e.styleScope);
    const styles = (this.raw.style ?? '')
      .split(/\s+/)
      .filter(Boolean)
      .map((name) => {
        let s: Attrs | undefined;
        for (const scope of scopes) if ((s = scope.styles.get(name))) break;
        s ??= this.ctx.styles.get(name);
        if (!s && !this.ctx.importsPending)
          log.warn(`找不到樣式「${name}」（${this.includedFrom ? `${this.includedFrom} ` : ''}第 ${this.line} 行）`);
        return s ?? {};
      });
    // 優先度：元件預設 < 外觀（skin） < 樣式（style） < 自己的屬性；斷點版本依同樣順序蓋上去
    // 外觀：整份介面的 < 圖層的 < 內嵌元件的（越近的越優先）
    let skin = this.ctx.skins?.get(this.type);
    for (let i = scopes.length - 1; i >= 0; i--) {
      const scoped = scopes[i].skins.get(this.type);
      if (scoped) skin = { ...skin, ...scoped };
    }
    base(this.defaults());
    if (skin) base(skin);
    for (const s of styles) base(s);
    base(this.raw);
    if (skin) responsive(skin);
    for (const s of styles) responsive(s);
    responsive(this.raw);
    this.attrs = out;
    this.applyActiveState();
  }

  /**
   * select="頁面堆疊id:頁" 的元件：對應的頁面顯示中時套用 activeBackground、activeColor
   * （自己做分頁按鈕用）。滑鼠移上去時維持 activeBackground（或另外指定 activeHoverBackground），
   * 不會換成一般的 hoverBackground（否則深色的 activeColor 文字會看不清楚）。
   */
  private applyActiveState(): void {
    const sel = this.attrs.select;
    if (!sel || (this.attrs.activeBackground === undefined && this.attrs.activeColor === undefined)) return;
    const [stackId, page] = sel.split(':');
    let root: UIElement = this;
    while (root.parent) root = root.parent;
    const stack = root.id === stackId ? root : root.find(stackId);
    const active = (stack as unknown as { isShowing?(page: string): boolean } | undefined)?.isShowing?.(page ?? '');
    if (!active) return;
    if (this.attrs.activeBackground !== undefined) {
      this.attrs.background = this.attrs.activeBackground;
      this.attrs.hoverBackground = this.attrs.activeHoverBackground ?? this.attrs.activeBackground;
    }
    if (this.attrs.activeColor !== undefined) this.attrs.color = this.attrs.activeColor;
  }

  /** 把屬性套用到 Yoga 節點 */
  applyLayout(): void {
    const n = this.node;
    const a = this.attrs;
    n.copyStyle(this.ctx.blankNode); // 先重設，避免斷點切換後殘留舊值

    const setDim = (name: string, fn: (v: Dim) => void) => {
      const v = parseDim(a[name]);
      if (v !== undefined) fn(v);
    };
    setDim('width', (v) => n.setWidth(v));
    setDim('height', (v) => n.setHeight(v));
    this.applyFit(isFitDim(a.width), isFitDim(a.height));
    setDim('minWidth', (v) => v !== 'auto' && n.setMinWidth(v));
    setDim('minHeight', (v) => v !== 'auto' && n.setMinHeight(v));
    setDim('maxWidth', (v) => v !== 'auto' && n.setMaxWidth(v));
    setDim('maxHeight', (v) => v !== 'auto' && n.setMaxHeight(v));
    setDim('basis', (v) => n.setFlexBasis(v));

    if (a.dir !== undefined)
      n.setFlexDirection(a.dir === 'h' || a.dir === 'row' ? FlexDirection.Row : FlexDirection.Column);
    if (a.flex !== undefined) n.setFlex(num(a.flex, 0));
    if (a.grow !== undefined) n.setFlexGrow(num(a.grow, 0));
    if (a.shrink !== undefined) n.setFlexShrink(num(a.shrink, 1));
    if (bool(a.wrap)) n.setFlexWrap(Wrap.Wrap);
    if (a.align && ALIGN[a.align] !== undefined) n.setAlignItems(ALIGN[a.align]);
    if (a.self && ALIGN[a.self] !== undefined) n.setAlignSelf(ALIGN[a.self]);
    if (a.justify && JUSTIFY[a.justify] !== undefined) n.setJustifyContent(JUSTIFY[a.justify]);
    if (a.gap !== undefined) n.setGap(Gutter.All, num(a.gap, 0));
    if (a.aspectRatio !== undefined) {
      const [w, h] = a.aspectRatio.split('/').map((x) => parseFloat(x));
      n.setAspectRatio(h ? w / h : w);
    }
    if (a.position === 'absolute') n.setPositionType(PositionType.Absolute);
    for (const [name, edge] of [
      ['left', Edge.Left],
      ['top', Edge.Top],
      ['right', Edge.Right],
      ['bottom', Edge.Bottom],
    ] as const) {
      const v = parseDim(a[name]);
      if (v !== undefined && v !== 'auto') n.setPosition(edge, v);
    }
    const edges = (prefix: 'margin' | 'padding') => {
      const set = (edge: Edge, v: Dim) => {
        if (prefix === 'margin') n.setMargin(edge, v);
        else if (v !== 'auto') n.setPadding(edge, v);
      };
      if (a[prefix] !== undefined) {
        const e = parseEdges(a[prefix]);
        if (e) [Edge.Top, Edge.Right, Edge.Bottom, Edge.Left].forEach((edge, i) => set(edge, e[i]));
      }
      for (const [side, edge] of [
        ['Top', Edge.Top],
        ['Right', Edge.Right],
        ['Bottom', Edge.Bottom],
        ['Left', Edge.Left],
      ] as const) {
        const v = parseDim(a[prefix + side]);
        if (v !== undefined) set(edge, v);
      }
    };
    edges('margin');
    edges('padding');
    if (!this.visible) n.setDisplay(Display.None);
    if (this.isEmptyContainer) {
      // 編輯器裡空的容器至少有個大小（不影響遊戲執行時的排版）
      if (a.width === undefined && a.minWidth === undefined) n.setMinWidth(120);
      if (a.height === undefined && a.minHeight === undefined) n.setMinHeight(48);
    }
    this.loadBackgroundImages();
  }

  /**
   * width="fit"／height="fit"：依內容決定大小。
   * Yoga 的 auto 在交叉軸上會被父元件的 align="stretch"（預設）拉伸，所以 fit 的那一邊改成靠起點對齊；
   * 主軸上的 auto 本來就是內容大小（有寫 flex、grow 時照它們的設定）。最外層 <UI> 的 fit 由 UI2D.layout() 處理。
   */
  private applyFit(fitW: boolean, fitH: boolean): void {
    if (!fitW && !fitH) return;
    const n = this.node;
    if (fitW) n.setWidth('auto');
    if (fitH) n.setHeight('auto');
    const p = this.parent;
    if (!p || this.attrs.self !== undefined || this.attrs.position === 'absolute') return;
    const row = p.attrs.dir === 'h' || p.attrs.dir === 'row';
    const crossFit = row ? fitH : fitW;
    const stretch = p.attrs.align === undefined || p.attrs.align === 'stretch';
    if (crossFit && stretch) n.setAlignSelf(Align.FlexStart);
  }

  /** 可以放子元件的容器（排版、捲動區、頁面堆疊…） */
  get acceptsChildren(): boolean {
    return false;
  }

  /** 編輯器模式下、XML 寫的、空的容器（顯示虛線提示框） */
  get isEmptyContainer(): boolean {
    if (
      !this.ctx.editorHints ||
      this.line <= 0 ||
      this.includedFrom ||
      !this.acceptsChildren ||
      this.children.length > 0
    )
      return false;
    // 有指定大小或伸縮的空容器通常是刻意的間隔（spacer），不顯示提示
    const a = this.raw;
    return !['width', 'height', 'flex', 'grow', 'basis', 'minWidth', 'minHeight'].some((k) => a[k] !== undefined);
  }

  /** 背景圖片的屬性（含各種狀態） */
  static readonly BG_IMAGE_ATTRS = ['bgImage', 'hoverBgImage', 'pressedBgImage', 'disabledBgImage'] as const;

  /** 載入背景圖片（bgImage 等）；載入完成後重畫這個元件 */
  private loadBackgroundImages(): void {
    for (const key of UIElement.BG_IMAGE_ATTRS) {
      const src = this.attrs[key];
      if (!src || src === 'none') continue;
      const url = this.ctx.resolveUrl(src, this);
      if (this.bgRequested.has(url)) continue;
      this.bgRequested.add(url);
      this.ctx.loadImage(url).then(
        () => {
          if (this.destroyed) return;
          this.ctx.damage?.(this);
          if (this.ctx.invalidate) this.ctx.invalidate();
          else this.ctx.requestLayout();
        },
        () => log.warn(`背景圖片載入失敗：${url}（${this.type}，第 ${this.line} 行）`),
      );
    }
  }

  // ───────── 樹狀結構 ─────────

  /** 加入子元件（index：插入位置，預設最後） */
  add(child: UIElement, index?: number): void {
    if (child.parent) child.parent.removeChild(child);
    // 移除之後才計算位置（可能是從自己這裡移到最後）
    index = Math.min(index ?? this.children.length, this.children.length);
    child.parent = this;
    this.children.splice(index, 0, child);
    this.node.insertChild(child.node, index);
  }

  /** 移除子元件（不會銷毀它） */
  removeChild(child: UIElement): void {
    const i = this.children.indexOf(child);
    if (i === -1) return;
    this.children.splice(i, 1);
    this.node.removeChild(child.node);
    child.parent = null;
  }

  /** 移除並釋放（含所有子元件） */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const c of [...this.children]) c.destroy();
    this.parent?.removeChild(this);
    this.node.free();
    this.listeners.clear();
  }

  /** 讀取 Yoga 的計算結果 */
  readLayout(): void {
    const l = this.node.getComputedLayout();
    this.layout.x = l.left;
    this.layout.y = l.top;
    this.layout.width = l.width;
    this.layout.height = l.height;
    for (const c of this.children) c.readLayout();
  }

  /** 相對於整個介面左上角的位置（考慮列表的捲動位置） */
  get absoluteRect(): Rect {
    let x = this.layout.x + this.offsetX;
    let y = this.layout.y + this.offsetY;
    for (let p = this.parent; p; p = p.parent) {
      x += p.layout.x + p.offsetX - (p instanceof UIScrollView ? p.scrollLeft : 0);
      y += p.layout.y + p.offsetY - (p instanceof UIScrollView ? p.scrollTop : 0);
    }
    return { x, y, width: this.layout.width, height: this.layout.height };
  }

  /** 尋找子孫元件 */
  find(id: string): UIElement | undefined {
    for (const c of this.children) {
      if (c.id === id) return c;
      const found = c.find(id);
      if (found) return found;
    }
    return undefined;
  }

  /** 走訪自己與所有子孫 */
  walk(fn: (el: UIElement) => void): void {
    fn(this);
    for (const c of this.children) c.walk(fn);
  }

  // ───────── 事件 ─────────

  /** 監聽事件（例如 'click'、'change'），回傳取消監聽的函式 */
  on(type: string, handler: UIHandler): () => void {
    let set = this.listeners.get(type);
    if (!set) this.listeners.set(type, (set = new Set()));
    set.add(handler);
    return () => set!.delete(handler);
  }

  /** 觸發事件：先呼叫監聽的函式，再往上傳給父元件（冒泡） */
  emit(type: string, extra: Partial<UIEvent> = {}): void {
    // select="頁面堆疊id:頁"：點擊時切換 UIStackView 的頁面（不用寫程式）
    if (type === 'click' && this.attrs.select) {
      const [stackId, page] = this.attrs.select.split(':');
      let root: UIElement = this;
      while (root.parent) root = root.parent;
      const stack = (root.id === stackId ? root : root.find(stackId)) as unknown as
        | { show?(page: string, emit?: boolean): void }
        | undefined;
      stack?.show?.(page ?? '', true);
    }
    const event: UIEvent = { type, target: this, item: this.item, index: this.index, ...extra };
    // XML 上的 onClick="handlerName" 等
    const attrName = `on${type[0].toUpperCase()}${type.slice(1)}`;
    const handlerName = this.attrs[attrName];
    if (handlerName) {
      const fn = this.ctx.handlers[handlerName];
      if (fn) fn(event);
      else log.warn(`找不到事件處理函式「${handlerName}」（${this.type}，第 ${this.line} 行）`);
    }
    for (const h of [...(this.listeners.get(type) ?? [])]) h(event);
  }

  /** 程式觸發點擊 */
  click(): void {
    this.emit('click');
  }

  /** 是否需要接收滑鼠事件（透明且沒有互動的地方讓點擊穿透到遊戲畫面） */
  get interactive(): boolean {
    // 有浮動說明（tooltip）的元件也要接收滑鼠，才知道滑鼠停在上面
    return (
      this.attrs.onClick !== undefined ||
      this.listeners.has('click') ||
      this.attrs.tooltip !== undefined ||
      this.attrs.select !== undefined
    );
  }
}

// ───────── 元件 ─────────

/** 根元件：填滿整個畫面，直向排列 */
export class UIRoot extends UIElement {
  override defaults(): Attrs {
    return { dir: 'v' };
  }
}

/** 排版容器：dir="v"（垂直，預設）或 dir="h"（水平） */
export class UILayout extends UIElement {
  override defaults(): Attrs {
    return { dir: 'v' };
  }

  override get acceptsChildren(): boolean {
    return true;
  }
}

/**
 * 內嵌外部介面檔：<UIComponent src="card.xml"/>，把另一個 XML 的內容放進來（可以重複使用同一份介面）。
 * - src 和圖片一樣，以介面檔所在的資料夾為準（通常是 public/ui）。
 * - 外部檔案的根元素是 <UI> 時放入它的子元件，<UI> 上的屬性（padding、gap…）也會套用，自己寫的屬性優先；
 *   根元素是其他元件時（例如 <UIWindow>）整個放進來。
 * - 外部檔案的 <UIStyle>、<UISkin> 只套用在這個元件裡；外層的樣式在裡面也可以用。
 * - 本身是排版容器（預設垂直），可以設定 width、padding 等屬性；標籤裡不能再放子元件。
 */
export class UIComponent extends UILayout {
  /** 解析後的檔案網址 */
  url: string | null = null;
  /** empty：沒有 src；loading：讀取中；loaded：完成；error：讀取或解析失敗、循環內嵌 */
  status: 'empty' | 'loading' | 'loaded' | 'error' = 'empty';
  /** 載入外部檔案失敗時的錯誤訊息（成功時是 null） */
  error: string | null = null;
  /** 外層的內嵌路徑（檢查循環內嵌用） */
  chain: string[] = [];
  /** XML 上自己寫的屬性（外部 <UI> 的屬性不能蓋過它們） */
  readonly ownAttrs: Attrs;
  /** 外部檔案的 XML（匯入的樣式晚到時重新收集用） */
  sourceTree: XmlNode | null = null;

  constructor(ctx: UIContext, type: string, raw: Attrs = {}, _text = '') {
    super(ctx, type, withoutComponentSize(raw));
    this.ownAttrs = { ...this.raw };
  }

  override get acceptsChildren(): boolean {
    return false; // 內容來自 src 的檔案
  }
}

/** 寬高屬性（含斷點前綴，例如 md:width） */
export const COMPONENT_SIZE_ATTR = /^(?:[\w-]+:)?(?:width|height)$/;

/**
 * <UIComponent> 不能自己定義寬高：大小由外部檔案的 <UI width height> 決定（寫在標籤上的會被忽略並提醒）。
 */
function withoutComponentSize(raw: Attrs): Attrs {
  const out: Attrs = {};
  const ignored: string[] = [];
  for (const [k, v] of Object.entries(raw)) {
    if (COMPONENT_SIZE_ATTR.test(k)) ignored.push(k);
    else out[k] = v;
  }
  if (ignored.length) {
    log.warn(
      `<UIComponent src="${raw.src ?? ''}"> 不能設定 ${ignored.join('、')}：寬高請寫在外部檔案的 <UI width="…" height="…">`,
    );
  }
  return out;
}

/** 文字：內容寫在標籤裡或 text 屬性；會依寬度自動換行 */
export class UILabel extends UIElement {
  /** 文字內容（要改內容請用 setText，畫面才會更新） */
  text: string;
  /** 排版後的換行結果（顯示層使用） */
  metrics: TextMetrics = { lines: [], width: 0, height: 0 };
  /** 只顯示前幾個字（打字機效果；排版仍以完整文字計算，不會跳動） */
  revealed = Infinity;

  constructor(ctx: UIContext, type: string, raw: Attrs = {}, text = '') {
    super(ctx, type, raw);
    this.text = raw.text ?? text;
    this.node.setMeasureFunc((width, widthMode) => {
      const max = widthMode === MeasureMode.Undefined ? Infinity : width;
      const m = wrapText(this.text, this.font, max, ctx.measure);
      return { width: widthMode === MeasureMode.Exactly ? width : Math.min(m.width, max), height: m.height };
    });
  }

  override defaults(): Attrs {
    return { fontSize: '16', color: '#ffffff', fontWeight: 'normal', lineHeight: '1.3' };
  }

  /** 目前使用的字型（大小、粗細、字體、行高） */
  get font(): FontSpec {
    return {
      size: num(this.attrs.fontSize, 16),
      family: this.attrs.fontFamily ?? 'system-ui, -apple-system, "PingFang TC", "Noto Sans TC", sans-serif',
      weight: this.attrs.fontWeight ?? 'normal',
      lineHeight: num(this.attrs.lineHeight, 1.3),
    };
  }

  override resolve(): void {
    super.resolve();
    // 按鈕自動產生的文字：字型與顏色跟著按鈕（父元件會先算好）
    const p = this.parent as (UIElement & { label?: UILabel | null }) | null;
    if (p && p.label === this) {
      for (const key of ['color', 'fontSize', 'fontWeight', 'fontFamily']) {
        if (p.attrs[key] !== undefined && this.raw[key] === undefined) this.attrs[key] = p.attrs[key];
      }
    }
  }

  /** 設定文字內容，回傳自己（可以串接） */
  setText(text: string | number): this {
    const t = String(text);
    if (t === this.text) return this;
    this.text = t;
    this.ctx.damage?.(this);
    this.node.markDirty();
    this.ctx.requestLayout();
    return this;
  }

  override applyLayout(): void {
    super.applyLayout();
    this.node.markDirty(); // 字型屬性可能改變
  }

  override readLayout(): void {
    super.readLayout();
    // 換行寬度要扣掉內距（文字畫在內距裡面）
    const p = this.padding;
    this.metrics = wrapText(
      this.text,
      this.font,
      Math.max(0, this.layout.width - p.left - p.right) + 0.5,
      this.ctx.measure,
    );
  }
}

/** 圖片：src 為網址；沒有指定尺寸時使用圖片原始尺寸，只給寬或高時維持比例 */
export class UIImage extends UIElement {
  /** 圖片的原始尺寸（載入完成前是 null） */
  natural: ImageSize | null = null;
  private loadingSrc = '';

  override defaults(): Attrs {
    return { fit: 'contain' };
  }

  /** 圖片網址 */
  get src(): string {
    return this.attrs.src ? this.ctx.resolveUrl(this.attrs.src, this) : '';
  }

  /** 換圖片，回傳自己（可以串接） */
  setSrc(src: string): this {
    return this.set('src', src);
  }

  override applyLayout(): void {
    super.applyLayout();
    const src = this.src;
    if (src && src !== this.loadingSrc) {
      this.loadingSrc = src;
      this.natural = null;
      this.ctx.loadImage(src).then(
        (size) => {
          if (this.loadingSrc !== src) return;
          this.natural = size;
          this.ctx.requestLayout(true);
        },
        () => log.warn(`圖片載入失敗：${src}（第 ${this.line} 行）`),
      );
    }
    const n = this.natural;
    if (!n || n.height === 0) return;
    const hasW = this.attrs.width !== undefined;
    const hasH = this.attrs.height !== undefined;
    if (!hasW && !hasH) {
      this.node.setWidth(n.width);
      this.node.setHeight(n.height);
    } else if (hasW !== hasH && this.attrs.aspectRatio === undefined) {
      this.node.setAspectRatio(n.width / n.height);
    }
  }
}

/** 元件裡的文字標籤：還沒有時建立並加進去，有的話換文字（按鈕、勾選框共用）；回傳那個標籤 */
function setChildLabel(owner: UIElement, label: UILabel | null, text: string | number): UILabel {
  if (label) {
    label.setText(text);
    return label;
  }
  const created = new UILabel(owner.ctx, 'UILabel', {}, String(text));
  owner.add(created);
  owner.ctx.requestLayout(true);
  return created;
}

/** 按鈕：可以包含其他元件；text 屬性或標籤內文字會自動產生文字 */
export class UIButton extends UIElement {
  /** 按鈕上的文字元件（沒有文字時是 null） */
  label: UILabel | null = null;

  constructor(ctx: UIContext, type: string, raw: Attrs = {}, text = '') {
    super(ctx, type, raw);
    const t = raw.text ?? text;
    if (t) this.setText(t);
  }

  override defaults(): Attrs {
    return {
      dir: 'h',
      align: 'center',
      justify: 'center',
      padding: '10 18',
      gap: '8',
      background: '#3a7bfd',
      hoverBackground: '#5a92ff',
      pressedBackground: '#2a62d8',
      radius: '8',
      color: '#ffffff',
      fontSize: '16',
      cursor: 'pointer',
    };
  }

  /** 是否停用（停用時不能點、顯示停用的外觀） */
  get disabled(): boolean {
    return bool(this.attrs.disabled);
  }

  set disabled(v: boolean) {
    this.set('disabled', v ? 'true' : null);
  }

  /** 設定按鈕文字，回傳自己（可以串接） */
  setText(text: string | number): this {
    this.label = setChildLabel(this, this.label, text);
    return this;
  }

  override emit(type: string, extra: Partial<UIEvent> = {}): void {
    if (this.disabled && type === 'click') return;
    super.emit(type, extra);
  }

  override get interactive(): boolean {
    return true;
  }
}

// ───────── 表單元件 ─────────

/** 勾選框、單選按鈕前面的方塊或圓圈（由繪圖器畫） */
export class UICheckIndicator extends UIElement {
  override applyLayout(): void {
    super.applyLayout();
    const size = num(this.parent?.attrs.boxSize, 20);
    // 開關（UIToggle）比較寬
    this.node.setWidth(num(this.parent?.attrs.switchWidth, size));
    this.node.setHeight(size);
    this.node.setFlexShrink(0);
  }
}

/**
 * 勾選框：點擊切換 checked，觸發 change 事件（event.checked、event.value）。
 * @example <UICheckBox id="music" text="背景音樂" checked="true" onChange="setMusic"/>
 */
export class UICheckBox extends UIElement {
  /** 勾選框的方塊（畫勾的部分） */
  readonly indicator: UICheckIndicator;
  /** 旁邊的文字元件（沒有文字時是 null） */
  label: UILabel | null = null;

  constructor(ctx: UIContext, type: string, raw: Attrs = {}, text = '') {
    super(ctx, type, raw);
    this.indicator = new UICheckIndicator(ctx, 'UICheckIndicator');
    this.add(this.indicator);
    const t = raw.text ?? text;
    if (t) this.setText(t);
  }

  override defaults(): Attrs {
    return {
      dir: 'h',
      align: 'center',
      gap: '8',
      cursor: 'pointer',
      boxSize: '20',
      color: '#ffffff',
      fontSize: '16',
      accent: '#3a7bfd',
    };
  }

  /** 是否勾選（狀態屬性不受斷點影響，直接讀 XML 上的值） */
  get checked(): boolean {
    return bool(this.raw.checked);
  }

  /** 設定勾選狀態（不會觸發 change 事件） */
  set checked(v: boolean) {
    if (v === this.checked) return;
    this.set('checked', v ? 'true' : 'false');
  }

  /** 是否停用 */
  get disabled(): boolean {
    return bool(this.attrs.disabled);
  }

  set disabled(v: boolean) {
    this.set('disabled', v ? 'true' : null);
  }

  /** 設定旁邊的文字，回傳自己（可以串接） */
  setText(text: string | number): this {
    this.label = setChildLabel(this, this.label, text);
    return this;
  }

  /** 使用者點擊時的行為 */
  protected toggle(): void {
    this.checked = !this.checked;
    this.emit('change', { checked: this.checked, value: this.checked });
  }

  override emit(type: string, extra: Partial<UIEvent> = {}): void {
    if (type === 'click') {
      if (this.disabled) return;
      super.emit('click', extra);
      this.toggle();
      return;
    }
    super.emit(type, extra);
  }

  override get interactive(): boolean {
    return true;
  }
}

/**
 * 單選按鈕：同一個 group 裡只能選一個；選取時觸發 change 事件（event.value 為 value 屬性）。
 * @example <UIRadioButton group="quality" value="high" text="高" onChange="setQuality"/>
 */
export class UIRadioButton extends UICheckBox {
  /** 單選群組名稱：同一群組只能選一個 */
  get group(): string {
    return this.raw.group ?? '';
  }

  /** 選中時代表的值（ui.radioValue(群組) 取得目前選中的值） */
  get value(): string {
    return this.raw.value ?? this.label?.text ?? '';
  }

  /** 同一個介面裡、同一組的單選按鈕 */
  groupMembers(): UIRadioButton[] {
    let root: UIElement = this;
    while (root.parent) root = root.parent;
    const members: UIRadioButton[] = [];
    root.walk((el) => {
      if (el instanceof UIRadioButton && el.group === this.group) members.push(el);
    });
    return members;
  }

  /** 選取這一個（同組的其他會取消；不會觸發 change 事件） */
  select(): void {
    for (const m of this.groupMembers()) if (m !== this) m.checked = false;
    this.checked = true;
  }

  protected override toggle(): void {
    if (this.checked) return; // 已選取：再點一次不會取消
    this.select();
    this.emit('change', { checked: true, value: this.value });
  }
}

/** 下拉選單的選項 */
export interface SelectOption {
  /** 選項的值（change 事件的 value） */
  value: string;
  /** 顯示的文字 */
  label: string;
}

/**
 * 下拉選單：點擊展開選項（蓋在所有介面之上），選取後觸發 change 事件（event.value）。
 * @example
 * <UISelect id="effect" value="none" onChange="setEffect">
 *   <UIOption value="none">無</UIOption>
 *   <UIOption value="ca">色差</UIOption>
 * </UISelect>
 */
export class UISelect extends UIElement {
  /** 所有選項（用 setOptions 修改） */
  options: SelectOption[] = [];
  /** 顯示目前選項的文字元件 */
  readonly label: UILabel;
  /** 展開時：滑鼠所在的選項與捲動位置（由 UI2D 更新） */
  hoverIndex = -1;
  /** 展開的選單捲動到哪裡（像素） */
  popupScroll = 0;

  constructor(ctx: UIContext, type: string, raw: Attrs = {}) {
    super(ctx, type, raw);
    this.label = new UILabel(ctx, 'UILabel', {}, '');
    this.add(this.label);
  }

  override defaults(): Attrs {
    return {
      dir: 'h',
      align: 'center',
      padding: '8 32 8 12',
      minWidth: '120',
      background: '#252b36',
      hoverBackground: '#2f3644',
      border: '1 rgba(255,255,255,0.18)',
      radius: '8',
      color: '#ffffff',
      fontSize: '15',
      cursor: 'pointer',
      maxItems: '6',
      popupBackground: '#1f242d',
      accent: '#3a7bfd',
    };
  }

  get value(): string {
    return this.raw.value ?? this.options[0]?.value ?? '';
  }

  /** 設定選取的值（不會觸發 change 事件） */
  set value(v: string) {
    if (v === this.raw.value) return;
    this.set('value', v);
    this.refreshLabel();
  }

  /** 目前選中第幾個（從 0 開始；沒有選中時是 -1） */
  get selectedIndex(): number {
    return this.options.findIndex((o) => o.value === this.value);
  }

  /** 目前選中的選項 */
  get selectedOption(): SelectOption | undefined {
    return this.options[this.selectedIndex];
  }

  /** 是否停用 */
  get disabled(): boolean {
    return bool(this.attrs.disabled);
  }

  set disabled(v: boolean) {
    this.set('disabled', v ? 'true' : null);
  }

  /** 設定選項，回傳自己（可以串接） */
  setOptions(options: SelectOption[]): this {
    this.options = options.map((o) => ({ ...o }));
    this.refreshLabel();
    this.ctx.requestLayout(true);
    return this;
  }

  /** 使用者選了某個選項 */
  choose(index: number): void {
    const option = this.options[index];
    if (!option) return;
    const changed = option.value !== this.value;
    this.value = option.value;
    if (changed) this.emit('change', { value: option.value });
  }

  override resolve(): void {
    super.resolve();
    this.refreshLabel();
  }

  private refreshLabel(): void {
    this.label.setText(this.selectedOption?.label ?? this.raw.placeholder ?? '');
  }

  /** 展開後的選單位置（介面座標）；下方空間不夠時往上展開 */
  popupLayout(viewportHeight: number): {
    x: number;
    y: number;
    width: number;
    height: number;
    itemHeight: number;
    padding: number;
    visible: number;
    up: boolean;
  } {
    const r = this.absoluteRect;
    const itemHeight = Math.round(num(this.attrs.fontSize, 15) * 2.2);
    const padding = 4;
    const visible = Math.max(1, Math.min(this.options.length, Math.floor(num(this.attrs.maxItems, 6))));
    const height = visible * itemHeight + padding * 2;
    const below = viewportHeight - (r.y + r.height);
    const up = below < height + 4 && r.y > below;
    return {
      x: r.x,
      y: up ? r.y - height - 4 : r.y + r.height + 4,
      width: r.width,
      height,
      itemHeight,
      padding,
      visible,
      up,
    };
  }

  /** 某一點對應的選項索引（不在選單內為 -1） */
  optionAt(x: number, y: number, viewportHeight: number): number {
    const p = this.popupLayout(viewportHeight);
    if (x < p.x || x > p.x + p.width || y < p.y + p.padding || y > p.y + p.height - p.padding) return -1;
    const i = Math.floor((y - p.y - p.padding + this.popupScroll) / p.itemHeight);
    return i >= 0 && i < this.options.length ? i : -1;
  }

  override emit(type: string, extra: Partial<UIEvent> = {}): void {
    if (type === 'click') {
      if (this.disabled) return;
      super.emit('click', extra);
      this.ctx.openPopup?.(this);
      return;
    }
    super.emit(type, extra);
  }

  override get interactive(): boolean {
    return true;
  }
}

/**
 * 滑桿：拖曳或點擊軌道改變數值。有水平（預設）與垂直兩種：
 * orientation="horizontal"｜"vertical"（也可以寫 vertical="true"），可以加斷點前綴，例如 md:orientation="vertical"。
 * 水平時左邊是最小值；垂直時下方是最小值（音量推桿的習慣）。
 * 拖曳中每次數值改變觸發 input 事件，放開時（數值有變）觸發 change 事件；event.value 為數值。
 * @example <UISlider id="volume" min="0" max="100" step="5" value="70" showValue="true" suffix="%" onChange="setVolume"/>
 * @example <UISlider orientation="vertical" height="200" value="40"/>
 */
export class UISlider extends UIElement {
  override defaults(): Attrs {
    return {
      orientation: 'horizontal',
      length: '160',
      thickness: '24',
      min: '0',
      max: '100',
      step: '1',
      thumbSize: '18',
      trackHeight: '6',
      accent: '#3a7bfd',
      trackColor: 'rgba(255,255,255,0.18)',
      thumbColor: '#ffffff',
      cursor: 'pointer',
      fontSize: '12',
      color: '#ffffff',
    };
  }

  /** 是否為垂直滑桿（orientation="vertical" 或 vertical="true"，含斷點） */
  get vertical(): boolean {
    const a = this.attrs;
    if (a.vertical !== undefined) return bool(a.vertical);
    return (a.orientation ?? this.raw.orientation) === 'vertical';
  }

  /** 切換水平／垂直（會重新排版） */
  set vertical(v: boolean) {
    delete this.raw.vertical; // 統一用 orientation
    this.set('orientation', v ? 'vertical' : 'horizontal');
  }

  /** 方向：水平或垂直（vertical="true"） */
  get orientation(): 'horizontal' | 'vertical' {
    return this.vertical ? 'vertical' : 'horizontal';
  }

  /** 沒有指定寬高時依方向決定：長邊 length、短邊 thickness */
  override applyLayout(): void {
    super.applyLayout();
    const a = this.attrs;
    const length = num(a.length, 160);
    const thickness = num(a.thickness, 24);
    const vertical = this.vertical;
    if (a.width === undefined) this.node.setWidth(vertical ? thickness : length);
    if (a.height === undefined) this.node.setHeight(vertical ? length : thickness);
  }

  /** 最小值（min 屬性，預設 0） */
  get min(): number {
    return num(this.attrs.min ?? this.raw.min, 0);
  }

  /** 最大值（max 屬性，預設 100） */
  get max(): number {
    const max = num(this.attrs.max ?? this.raw.max, 100);
    return max > this.min ? max : this.min + 1;
  }

  /** 每一格的間距（step 屬性；0 為連續） */
  get step(): number {
    return Math.max(0, num(this.attrs.step ?? this.raw.step, 1));
  }

  /** 是否停用 */
  get disabled(): boolean {
    return bool(this.attrs.disabled);
  }

  set disabled(v: boolean) {
    this.set('disabled', v ? 'true' : null);
  }

  /** 把數值限制在範圍內並對齊 step */
  normalize(v: number): number {
    const { min, max, step } = this;
    let x = Math.min(max, Math.max(min, Number.isFinite(v) ? v : min));
    if (step > 0) x = min + Math.round((x - min) / step) * step;
    x = Math.min(max, Math.max(min, x));
    // 去掉浮點誤差（例如 0.1 + 0.2）
    return Number(x.toFixed(this.decimals));
  }

  /** 依 step 決定顯示的小數位數 */
  get decimals(): number {
    const step = this.step;
    if (step <= 0 || Number.isInteger(step)) return step > 0 ? 0 : 2;
    return Math.min(6, (String(step).split('.')[1] ?? '').length);
  }

  /** 目前的數值（狀態屬性直接讀 XML 上的值） */
  get value(): number {
    return this.normalize(this.raw.value !== undefined ? parseFloat(this.raw.value) : this.min);
  }

  /** 設定數值（不會觸發事件） */
  set value(v: number) {
    const n = this.normalize(v);
    if (n === this.value && this.raw.value !== undefined) return;
    // 數值不影響排版：只更新狀態並要求重畫（拖曳時不必重新套用所有屬性）
    this.raw.value = String(n);
    this.ctx.damage?.(this, 48);
    this.ctx.requestLayout();
  }

  /** 數值提示畫在圓點上方（水平）或右側（垂直），會超出滑桿範圍 */
  override get paintBleed(): number {
    if (!bool(this.attrs.showValue)) return 16;
    const size = num(this.attrs.fontSize, 12);
    // 提示框寬度約為文字寬度 + 12，加上和圓點的距離
    return Math.max(48, Math.ceil(this.displayValue.length * size * 0.75 + num(this.attrs.thumbSize, 18) + 24));
  }

  /** 數值在範圍中的比例 0~1 */
  get ratio(): number {
    return (this.value - this.min) / (this.max - this.min);
  }

  /** 顯示用的文字（含前後綴） */
  get displayValue(): string {
    return `${this.attrs.prefix ?? ''}${this.value.toFixed(this.decimals)}${this.attrs.suffix ?? ''}`;
  }

  /** 軌道的位置（介面座標）：圓點中心能移動的範圍 */
  trackRange(): { x0: number; y0: number; x1: number; y1: number } {
    const r = this.absoluteRect;
    const half = Math.min(num(this.attrs.thumbSize, 18), this.vertical ? r.width : r.height) / 2;
    if (this.vertical) {
      const cx = r.x + r.width / 2;
      return { x0: cx, y0: r.y + r.height - half, x1: cx, y1: r.y + half }; // 下方是最小值
    }
    const cy = r.y + r.height / 2;
    return { x0: r.x + half, y0: cy, x1: r.x + r.width - half, y1: cy };
  }

  /** 某一點對應的數值 */
  valueAt(x: number, y: number): number {
    const t = this.trackRange();
    const ratio = this.vertical ? (y - t.y0) / (t.y1 - t.y0 || 1) : (x - t.x0) / (t.x1 - t.x0 || 1);
    return this.normalize(this.min + Math.min(1, Math.max(0, ratio)) * (this.max - this.min));
  }

  override get interactive(): boolean {
    return true;
  }
}

/** 清單排列方式：直向、橫向、格狀 */
export type ListType = 'vertical' | 'horizontal' | 'grid';
/** 可以捲動的方向：x（水平）、y（垂直）、both */
export type ScrollAxis = 'x' | 'y' | 'both';

/**
 * 捲動區（基礎）：內容超出範圍時可以用滾輪或拖曳捲動，並顯示捲軸。
 * scroll="v" 垂直（預設）、"h" 水平、"both" 兩個方向；dir 決定內容排列方向，裡面可以放任意版面。
 * UIList（列表）、表格的資料區都是以它為基礎。
 * @example <UIScrollView height="200" scroll="v"><UILabel>很長的說明…</UILabel></UIScrollView>
 */
export class UIScrollView extends UIElement {
  /** 內容總尺寸（排版後更新） */
  contentWidth = 0;
  /** 內容的總高度（像素） */
  contentHeight = 0;
  /** 往下捲動了多少（像素） */
  scrollTop = 0;
  /** 往右捲動了多少（像素） */
  scrollLeft = 0;

  override defaults(): Attrs {
    return { scroll: 'v', dir: 'v', gap: '8' };
  }

  /** 可以捲動的方向 */
  get scrollAxis(): ScrollAxis {
    const s = this.attrs.scroll;
    return s === 'h' ? 'x' : s === 'both' ? 'both' : 'y';
  }

  override applyLayout(): void {
    super.applyLayout();
    const n = this.node;
    n.setOverflow(Overflow.Scroll);
    n.setFlexDirection(this.attrs.dir === 'h' || this.attrs.dir === 'row' ? FlexDirection.Row : FlexDirection.Column);
    // 可以往某個方向捲動時，內容不要被壓縮在可見範圍內
    n.setAlignItems(this.scrollAxis === 'y' ? Align.Stretch : Align.FlexStart);
  }

  /** 子元件套用屬性後呼叫：內容不縮小（才能捲動） */
  constrainChildren(): void {
    for (const c of this.children) c.node.setFlexShrink(0);
  }

  override readLayout(): void {
    super.readLayout();
    const n = this.node;
    let right = 0;
    let bottom = 0;
    for (const c of this.children) {
      if (!c.visible) continue;
      right = Math.max(right, c.layout.x + c.layout.width + c.node.getComputedMargin(Edge.Right));
      bottom = Math.max(bottom, c.layout.y + c.layout.height + c.node.getComputedMargin(Edge.Bottom));
    }
    this.contentWidth = right + n.getComputedPadding(Edge.Right);
    this.contentHeight = bottom + n.getComputedPadding(Edge.Bottom);
  }

  override get interactive(): boolean {
    return true; // 需要接收滾輪與拖曳
  }

  override get acceptsChildren(): boolean {
    return true;
  }
}

/**
 * 列表：捲動區加上排列方式與資料樣板。
 * type="vertical"（預設）、"horizontal"、"grid"（搭配 columns）。
 * 子元件可以直接寫在裡面，或用 <UITemplate> 搭配 ui.setItems() 由資料產生。
 */
export class UIList extends UIScrollView {
  /** <UITemplate> 的內容 */
  template: XmlNode | null = null;

  override defaults(): Attrs {
    return { type: 'vertical', gap: '8' };
  }

  /** 清單排列方式（type 屬性）：vertical、horizontal、grid */
  get listType(): ListType {
    const t = this.attrs.type;
    return t === 'horizontal' || t === 'grid' ? t : 'vertical';
  }

  /** 格狀清單的欄數（columns 屬性） */
  get columns(): number {
    return Math.max(1, Math.floor(num(this.attrs.columns, 3)));
  }

  /** 列表的捲動方向由 type 決定 */
  override get scrollAxis(): ScrollAxis {
    return this.listType === 'horizontal' ? 'x' : 'y';
  }

  override applyLayout(): void {
    super.applyLayout();
    const n = this.node;
    const type = this.listType;
    n.setFlexDirection(type === 'vertical' ? FlexDirection.Column : FlexDirection.Row);
    if (type === 'grid') n.setFlexWrap(Wrap.Wrap);
    n.setAlignItems(type === 'grid' ? Align.FlexStart : Align.Stretch);
  }

  /**
   * grid：依列表寬度算出每格寬度。回傳是否有改變（需要再排一次）。
   */
  fitGrid(): boolean {
    if (this.listType !== 'grid') return false;
    const n = this.node;
    const inner = this.layout.width - n.getComputedPadding(Edge.Left) - n.getComputedPadding(Edge.Right);
    const gap = num(this.attrs.gap, 0);
    const w = Math.max(0, Math.floor(((inner - gap * (this.columns - 1)) / this.columns) * 100) / 100);
    let changed = false;
    for (const c of this.children) {
      if (c.attrs.width !== undefined) continue; // 項目自己指定了寬度
      if (Math.abs(c.node.getComputedWidth() - w) > 0.01) {
        c.node.setWidth(w);
        changed = true;
      }
    }
    return changed;
  }
}

/** 內建元件 */
export const BUILTIN_COMPONENTS = {
  UI: UIRoot,
  UILayout,
  UIComponent,
  UILabel,
  UIImage,
  UIButton,
  UIList,
  UIScrollView,
  UICheckBox,
  UIRadioButton,
  UISelect,
  UISlider,
} as const;

/** 元件類別的建構函式（UI2D.register、套件註冊元件時用） */
export type ComponentConstructor = new (ctx: UIContext, type: string, raw: Attrs, text: string) => UIElement;
