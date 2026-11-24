import { loadYoga, type Yoga } from 'yoga-layout/load';
import { CanvasUIRenderer, type UIRenderer } from './CanvasRenderer';
import type { PaintState } from './UIPainter';
import {
  COMPONENT_SIZE_ATTR,
  isFitDim,
  BUILTIN_COMPONENTS,
  UIButton,
  UICheckBox,
  UIComponent,
  type UIElement,
  UIRadioButton,
  UISelect,
  UISlider,
  UILabel,
  UILayout,
  UIList,
  UIScrollView,
  type Attrs,
  type ComponentConstructor,
  type OverlayPainter,
  type PointerCapture,
  type Rect,
  type ImageLoader,
  type UIContext,
  type UIHandler,
} from './elements';
import { createCanvasMeasurer, wrapText, type MeasureTextWidth } from './text';
import { WIDGET_COMPONENTS, UIToast, type ToastOptions } from './widgets';
import { UIStackView, WIDGET2_COMPONENTS } from './widgets2';
import { roundRectPath, uiFont, UI_FONT_FAMILY, num } from './draw';
import { COMMENT_TAG, parseXml, XmlError, type XmlNode } from './xml';
import { cachedUIXml, fetchUIXml, loadUIXml } from './xmlSources';
import { registerUIComponent, uiComponents } from './registry';
import { createLogger } from '../core/Logger';

const log = createLogger('ui2d');

/** 把內建元件加進註冊表（已經註冊過的同名元件不覆蓋） */
function addBuiltins(map: Map<string, ComponentConstructor>): Map<string, ComponentConstructor> {
  for (const [tag, ctor] of Object.entries({ ...BUILTIN_COMPONENTS, ...WIDGET_COMPONENTS, ...WIDGET2_COMPONENTS }))
    if (!map.has(tag)) map.set(tag, ctor as ComponentConstructor);
  return map;
}

/** 相對網址以 base 為準（絕對網址、/ 開頭的不變） */
function resolveAgainst(base: string, src: string): string {
  if (!base || /^([a-z][a-z\d+.-]*:|\/)/i.test(src)) return src;
  return normalizePath(base + src);
}

/**
 * 整理路徑裡的 ./ 與 ../（場景資料夾裡的介面引用上一層的檔案：ui/orbit/ + ../theme.xml → ui/theme.xml）。
 * 超出最上層的 ../ 會保留（交給瀏覽器處理）。
 */
interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** 最多分成幾塊重畫（太多塊時把最近的合併） */
const MAX_DAMAGE_REGIONS = 6;
const boxArea = (b: Box) => (b.x1 - b.x0) * (b.y1 - b.y0);
const unionBox = (a: Box, b: Box): Box => ({
  x0: Math.min(a.x0, b.x0),
  y0: Math.min(a.y0, b.y0),
  x1: Math.max(a.x1, b.x1),
  y1: Math.max(a.y1, b.y1),
});

/**
 * 合併重畫範圍：重疊或靠得很近（合併後多出來的空白不到 30%）的合在一起，其餘分開重畫。
 * 以前是全部合成一個大框：畫面兩端各有一小塊變動（例如右上的效能面板、左下的小地圖），
 * 大框就超過畫面一半、變成整張重畫與上傳，造成固定間隔的卡頓。
 */
export function mergeDamage(input: readonly Box[]): Box[] {
  // 非常多塊（例如整個列表都在動）：合成一個大框就好，避免合併本身太花時間
  if (input.length > 64) return [input.reduce(unionBox)];
  const list = input.map((b) => ({ ...b }));
  // 很多小塊時先排序，讓相鄰的比較快合併
  list.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < list.length && !changed; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const u = unionBox(list[i], list[j]);
        if (boxArea(u) <= (boxArea(list[i]) + boxArea(list[j])) * 1.3) {
          list[i] = u;
          list.splice(j, 1);
          changed = true;
          break;
        }
      }
    }
  }
  // 太多塊：反覆合併「合併後增加面積最少」的兩塊
  while (list.length > MAX_DAMAGE_REGIONS) {
    let best = [0, 1];
    let bestCost = Infinity;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const cost = boxArea(unionBox(list[i], list[j])) - boxArea(list[i]) - boxArea(list[j]);
        if (cost < bestCost) {
          bestCost = cost;
          best = [i, j];
        }
      }
    }
    list[best[0]] = unionBox(list[best[0]], list[best[1]]);
    list.splice(best[1], 1);
  }
  return list;
}

/** 檔案網址所在的資料夾（ui/orbit/hud.xml → ui/orbit/） */
function dirOf(url: string): string {
  return url.includes('/') ? url.slice(0, url.lastIndexOf('/') + 1) : '';
}

/**
 * @param path 路徑（處理 ./ 與 ../）
 */
export function normalizePath(path: string): string {
  const [pathname, rest = ''] = path.split(/(?=[?#])/, 2);
  const out: string[] = [];
  const parts = pathname.split('/');
  parts.forEach((part, i) => {
    if (part === '.') return;
    if (part === '..' && out.length && out[out.length - 1] !== '..' && out[out.length - 1] !== '') out.pop();
    else if (part !== '' || i === 0 || i === parts.length - 1) out.push(part);
  });
  return out.join('/') + rest;
}

/** <UIComponent> 最多可以一層包一層幾次（避免意外的深層或循環內嵌） */
const MAX_COMPONENT_DEPTH = 8;

/** 斷點（行動優先）：寬度 ≥ 數值時，該前綴的屬性生效 */
export const DEFAULT_BREAKPOINTS: Readonly<Record<string, number>> = { sm: 640, md: 768, lg: 1024, xl: 1280 };

/** UI2D 的設定 */
export interface UI2DOptions {
  /** 介面放在哪個元素裡（尺寸跟著它）；null 為無畫面模式（測試、伺服器） */
  container?: HTMLElement | null;
  /** 無畫面模式的尺寸 */
  width?: number;
  /** 介面的高（像素；預設跟著容器） */
  height?: number;
  /** 事件處理函式：XML 裡的 onClick="名稱" 會呼叫這裡同名的函式 */
  handlers?: Record<string, UIHandler>;
  /** 斷點：名稱 → 最小寬度（例如 { md: 768 }，XML 寫 md:width="300"） */
  breakpoints?: Record<string, number>;
  /** 自訂文字量測（預設用 canvas） */
  measure?: MeasureTextWidth;
  /** 自訂圖片載入（預設用瀏覽器的 Image） */
  loadImage?: ImageLoader;
  /** 自訂顯示層（UIPlugin 用來把介面疊在 3D 畫面上）；預設有容器時用獨立畫布 */
  renderer?: UIRenderer | null;
  /** 裝置像素比（預設跟隨瀏覽器，最高 2） */
  pixelRatio?: number;
  /**
   * 遇到不認識的元件：'error'（預設）報錯；'placeholder' 顯示佔位方塊
   * （編輯器用：例如第三方套件提供的元件還沒安裝）
   */
  unknownTags?: 'error' | 'placeholder';
  /** 動畫自動用 requestAnimationFrame 推進（預設 true；false 時自己呼叫 ui.tick(dt)） */
  autoTick?: boolean;
  /** 編輯器模式：空的容器顯示成虛線提示框（遊戲執行時不要開） */
  editorHints?: boolean;
}

/** 沒有內容、可以不寫結尾的元件 */
const VOID_TAGS = ['UIImage', 'UIStyle', 'UISkin', 'UIImport', 'UIColumn', 'UIRow'];
/** 只定義樣式、不會建立元件的標籤 */
const STYLE_TAGS = new Set(['UIStyle', 'UISkin', 'UIImport', COMMENT_TAG]);

/** 根元件的寬高沒寫、空白或 auto：填滿畫面（其他元件的 auto 是依內容決定大小） */
function isAutoSize(value: string | undefined): boolean {
  return value === undefined || value.trim() === '' || value.trim() === 'auto';
}

let yogaPromise: Promise<Yoga> | null = null;

/** 載入 Yoga 排版引擎（WebAssembly，只載入一次） */
export function loadLayoutEngine(): Promise<Yoga> {
  return (yogaPromise ??= loadYoga());
}

/** 已載入的圖片（所有介面共用），繪圖時直接取用 */
const loadedImages = new Map<string, CanvasImageSource>();

function browserImageLoader(): ImageLoader {
  const cache = new Map<string, Promise<{ width: number; height: number }>>();
  return (url) => {
    let p = cache.get(url);
    if (!p) {
      p = new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          loadedImages.set(url, img);
          resolve({ width: img.naturalWidth, height: img.naturalHeight });
        };
        img.onerror = () => reject(new Error(`圖片載入失敗：${url}`));
        img.src = url;
      });
      cache.set(url, p);
    }
    return p;
  };
}

/**
 * 2D 介面：讀取 XML → 建立元件 → 用 Yoga 排版 → 顯示，並在尺寸改變時自動重新排版（RWD）。
 *
 * @example
 * const ui = await UI2D.create({ container: document.body, handlers: { start: () => game.start() } });
 * await ui.load('ui/scene.xml');
 * ui.get<UILabel>('score')!.setText(100);
 */
export class UI2D {
  /** 自訂元件：UI2D.register('UIHealthBar', HealthBar) 後就能在 XML 使用 */
  /** 標籤名稱 → 元件類別（內建元件；套件在 UI2D 載入前註冊的同名元件優先） */
  static readonly components = addBuiltins(uiComponents);

  /**
   * @param tag XML 標籤名稱
   * @param component 元件類別
   */
  static register(tag: string, component: ComponentConstructor): void {
    registerUIComponent(tag, component);
  }

  /** 全域外觀（所有介面共用；XML 裡的 <UISkin> 會再蓋過它） */
  static readonly skins = new Map<string, Attrs>();

  /**
   * 設定某種元件的外觀（預設屬性），例如整個遊戲的按鈕顏色。
   * @param tag 元件的 XML 標籤（例如 'UIButton'）
   * @param attrs 預設屬性
   * @example UI2D.setSkin('UIButton', { background: '#9acd32', color: '#141a07', radius: '12' })
   */
  static setSkin(tag: string, attrs: Attrs | null): void {
    if (attrs) UI2D.skins.set(tag, { ...(UI2D.skins.get(tag) ?? {}), ...attrs });
    else UI2D.skins.delete(tag);
    UI2D.skinVersion++;
  }

  private static skinVersion = 0;

  /**
   * @param options 放在哪個元素、大小、事件處理函式、斷點、繪製方式、像素比等設定
   */
  static async create(options: UI2DOptions = {}): Promise<UI2D> {
    return new UI2D(await loadLayoutEngine(), options);
  }

  /** 目前的根元件 */
  root: UIElement | null = null;
  /** 事件處理函式：XML 的 onClick="名稱" 對應這裡的同名函式 */
  readonly handlers: Record<string, UIHandler>;
  /** 斷點：名稱 → 最小寬度 */
  readonly breakpoints: Record<string, number>;
  private readonly ctx: UIContext;
  private renderer: UIRenderer | null = null;
  /** 互動狀態 */
  private hover: UIElement | null = null;
  private pressed: UIElement | null = null;
  private drag: {
    list: UIScrollView;
    x: number;
    y: number;
    scrollLeft: number;
    scrollTop: number;
    moved: boolean;
  } | null = null;
  private renderScheduled = false;
  /** 局部重畫：需要重畫的範圍；damageAll 為 true 時整張重畫 */
  private damageRects: Rect[] = [];
  private damageAll = true;
  /** 上一次排版的元件位置（比對哪些元件移動了） */
  private prevRects = new Map<UIElement, Rect>();
  /** 展開中的下拉選單 */
  private openSelect: UISelect | null = null;
  /** 在下拉選單上按下的選項（放開時在同一個選項上才算選取） */
  private pressedOption = -1;
  /** 這次按下是用來關閉下拉選單的，放開時不要再觸發點擊 */
  private swallowUp = false;
  /** 拖曳中的滑桿 */
  private sliderDrag: { slider: UISlider; start: number } | null = null;
  /** 畫布的像素比（高解析度螢幕為 2） */
  pixelRatio: number;
  private readonly container: HTMLElement | null;
  private viewport = { width: 0, height: 0 };
  private activeBreakpoints: string[] = [];
  private styles = new Map<string, Attrs>();
  /** XML 裡 <UISkin for="UIButton" …/> 定義的外觀 */
  private docSkins = new Map<string, Attrs>();
  /** 合併後的外觀快取（全域或這份介面的外觀改變時重算） */
  private mergedSkins: Map<string, Attrs> | null = null;
  private mergedVersion = -1;
  private baseUrl = '';
  private scheduled = false;
  private needsReapply = true;
  private cleanupResize: (() => void) | null = null;
  private readonly layoutListeners = new Set<() => void>();
  private readonly loadListeners = new Set<(root: UIElement) => void>();
  private readonly unknownTags: 'error' | 'placeholder';
  /** 最近一次載入時遇到的不認識元件 */
  unknownComponents: string[] = [];
  /** 動畫中的元件（每幀呼叫 tick） */
  private readonly animating = new Set<UIElement>();
  /** 畫在最上層的東西（拖曳中的圖示、浮動說明） */
  private readonly overlays = new Map<object, OverlayPainter>();
  /** 接管指標的元件（搖桿、視窗、物品格拖曳） */
  private capture: PointerCapture | null = null;
  private readonly autoTick: boolean;
  private animFrame = 0;
  private lastFrame = 0;
  /** 浮動說明：滑鼠停在有 tooltip 屬性的元件上一段時間後顯示 */
  private tip: { el: UIElement; x: number; y: number; wait: number; rect: Rect | null } | null = null;
  private readonly tipKey = {};

  private constructor(yoga: Yoga, options: UI2DOptions) {
    this.handlers = { ...options.handlers };
    this.unknownTags = options.unknownTags ?? 'error';
    this.autoTick = options.autoTick ?? true;
    this.breakpoints = { ...DEFAULT_BREAKPOINTS, ...options.breakpoints };
    this.container =
      options.container === undefined ? (typeof document !== 'undefined' ? document.body : null) : options.container;
    this.pixelRatio =
      options.pixelRatio ?? (typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1);
    const renderer =
      options.renderer !== undefined ? options.renderer : this.container ? new CanvasUIRenderer(this.container) : null;
    if (renderer) this.setRenderer(renderer);
    this.viewport = { width: options.width ?? 0, height: options.height ?? 0 };

    const ui = this;
    this.ctx = {
      yoga,
      measure: options.measure ?? createCanvasMeasurer(),
      get activeBreakpoints() {
        return ui.activeBreakpoints;
      },
      get styles() {
        return ui.styles;
      },
      get importsPending() {
        return ui.importLoads.size > 0;
      },
      get skins() {
        return ui.skins;
      },
      loadImage: (
        (loader: ImageLoader) => (url: string) =>
          this.trackImage(loader(url))
      )(options.loadImage ?? browserImageLoader()),
      resolveUrl: (src, from) => this.resolveUrl(src, from),
      handlers: this.handlers,
      requestLayout: (reapply) => this.requestLayout(reapply),
      invalidate: () => this.scheduleRender(),
      damage: (el, pad) => this.damage(el, pad),
      openPopup: (select) => this.setOpenSelect(select && this.openSelect === select ? null : select),
      blankNode: yoga.Node.create(),
      animate: (el) => this.animate(el),
      damageRect: (r) => this.damageArea(r),
      setOverlay: (key, painter) => this.setOverlay(key, painter),
      viewport: () => this.size,
      editorHints: options.editorHints ?? false,
      imageSource: (url) => loadedImages.get(url),
      canvasLayers: () => this.renderer?.canvasLayers ?? null,
    };

    if (this.container) this.observeContainer(this.container);
    this.updateBreakpoints();
  }

  // ───────── 載入 ─────────

  /**
   * 讀取 XML 檔案（圖片等相對路徑以 XML 檔的位置為基準）；<UIComponent src> 內嵌的檔案會先讀好，載入後內容馬上就在
   * @param url XML 檔的網址
   */
  async load(url: string): Promise<UIElement> {
    const xml = await fetchUIXml(url);
    const base = url.includes('/') ? url.slice(0, url.lastIndexOf('/') + 1) : '';
    await this.preloadComponents(xml, base, url);
    return this.loadString(xml, base, url);
  }

  /**
   * 先讀取 XML 裡 <UIComponent src> 內嵌的檔案（包含內嵌裡的內嵌）。
   * 讀好之後 loadString、addLayer 會同步放入內容（ui.get 馬上找得到裡面的元件）；
   * 沒有先讀的話，內容會在背景讀取後才出現（可以 await ui.whenComponentsLoaded()）。
   * 讀不到的檔案這裡不會丟出錯誤，建立時會在元件裡顯示錯誤訊息。
   * @param xml XML 文字
   * @param baseUrl 相對路徑的基準
   * @param sourceUrl 這份 XML 自己的網址
   */
  async preloadComponents(xml: string, baseUrl = this.baseUrl, sourceUrl?: string): Promise<void> {
    const visit = async (text: string, chain: string[]): Promise<void> => {
      let tree: XmlNode;
      try {
        tree = parseXml(text, { voidTags: VOID_TAGS });
      } catch {
        return; // 語法錯誤留給 loadString 回報
      }
      const urls = new Set<string>();
      const walk = (node: XmlNode) => {
        if ((node.tag === 'UIComponent' || node.tag === 'UIImport') && node.attrs.src?.trim())
          urls.add(resolveAgainst(baseUrl, node.attrs.src.trim()));
        for (const c of node.children) walk(c);
      };
      walk(tree);
      await Promise.all(
        [...urls].map(async (url) => {
          if (chain.includes(url) || chain.length >= MAX_COMPONENT_DEPTH) return;
          try {
            await visit(await loadUIXml(url), [...chain, url]);
          } catch {
            /* 建立時顯示錯誤 */
          }
        }),
      );
    };
    await visit(xml, sourceUrl ? [sourceUrl] : []);
  }

  /** 等背景讀取中的 <UIComponent> 都放好內容（包含讀取後才發現的內嵌） */
  /** 讀取中的圖片（背景圖、UIImage） */
  private readonly pendingImages = new Set<Promise<unknown>>();

  private trackImage<T>(p: Promise<T>): Promise<T> {
    const tracked = p.finally(() => this.pendingImages.delete(tracked));
    this.pendingImages.add(tracked);
    tracked.catch(() => {}); // 失敗由元件自己處理，這裡只追蹤
    return tracked;
  }

  /**
   * 等介面準備好：內嵌的檔案、匯入的樣式、圖片都讀完（失敗的也算完成）。
   * 例如轉場時等新畫面的圖片都到了再淡入，畫面才不會一張一張跳出來。
   */
  async whenReady(): Promise<void> {
    for (let i = 0; i < 10; i++) {
      if (this.scheduled) this.layout(); // 圖片在排版時才開始讀
      await this.whenComponentsLoaded();
      if (this.scheduled) this.layout();
      if (!this.pendingImages.size && !this.pendingComponents.size) return;
      await Promise.allSettled([...this.pendingImages]);
    }
  }

  /** 等內嵌的介面檔（UIComponent、UIImport）都讀完 */
  async whenComponentsLoaded(): Promise<void> {
    while (this.pendingComponents.size) await Promise.allSettled([...this.pendingComponents]);
  }

  /**
   * 從 XML 字串建立介面（取代目前的介面）。
   * sourceUrl：這份 XML 自己的網址（有的話，<UIComponent> 內嵌回自己時可以馬上發現循環）
   * @param xml XML 文字
   * @param baseUrl 相對路徑（圖片等）的基準
   * @param sourceUrl 這份 XML 自己的網址（偵測內嵌循環用）
   */
  loadString(xml: string, baseUrl = '', sourceUrl?: string): UIElement {
    const tree = parseXml(xml, { voidTags: VOID_TAGS });
    this.clear();
    this.openSelect = null;
    this.capture = null;
    this.tip = null;
    this.overlays.clear();
    this.damageAll = true;
    this.prevRects = new Map();
    this.unknownComponents = [];
    this.baseUrl = baseUrl;
    this.styles = new Map();
    this.docSkins = new Map();
    this.mergedSkins = null;
    this.docTree = tree;
    this.collectStyles(tree);
    const root = this.withIncludeChain(sourceUrl, () => this.build(tree));
    this.root = root;
    this.needsReapply = true;
    this.layout();
    for (const l of [...this.loadListeners]) l(root);
    return root;
  }

  // ───────── 疊加圖層（彈出選單、背包等另一份 XML） ─────────

  /** 疊加中的圖層（名稱 → 圖層的根元件），越後面越上層 */
  private readonly layers = new Map<string, UIElement>();

  /**
   * 把另一份 XML 疊在目前介面的最上層（例如彈出的設定視窗、背包）。
   * 圖層填滿整個畫面；透明的地方會讓點擊穿透到下面的介面。
   * 圖層裡的 <UIStyle>、<UISkin> 只套用在這個圖層（不會影響其他畫面）。回傳圖層的根元件。
   * options.order 為 'bottom' 時放在所有圖層的最下面（例如場景介面：要在視窗、選單等畫面的下面）。
   * @param name 圖層名稱
   * @param xml XML 文字
   * @param sourceUrl 這份 XML 自己的網址
   * @param options 放在最上面（top，預設）或最下面（bottom）
   */
  addLayer(
    name: string,
    xml: string,
    sourceUrl?: string,
    options: {
      /** 'top'（預設）放在最上面；'bottom' 放在所有圖層的最下面 */
      order?: 'top' | 'bottom';
    } = {},
  ): UIElement {
    if (!this.root) throw new Error('請先載入介面（loadString / load）才能加入圖層');
    this.removeLayer(name);
    const tree = parseXml(xml, { voidTags: VOID_TAGS });
    // 圖層的相對路徑（圖片、<UIImport>、<UIComponent>）以它自己的檔案位置為基準
    const base = sourceUrl ? dirOf(sourceUrl) : null;
    const scope = { styles: new Map<string, Attrs>(), skins: new Map<string, Attrs>() };
    this.collectStyles(tree, scope.styles, scope.skins, new Set(), base ?? this.baseUrl);
    const layer = this.withBuildBase(base, () => this.withIncludeChain(sourceUrl, () => this.build(tree)));
    layer.styleScope = scope;
    Object.assign(layer.raw, { position: 'absolute', left: '0', top: '0', right: '0', bottom: '0' });
    // width／height="fit" 的圖層依內容決定大小：那一邊只貼齊起點，不撐滿
    if (isFitDim(layer.raw.width)) delete layer.raw.right;
    if (isFitDim(layer.raw.height)) delete layer.raw.bottom;
    layer.walk((e) => e.resolve());
    if (options.order === 'bottom') {
      // 放在第一個圖層前面（主文件的內容之後），圖層的順序也排在最前面
      const first = this.layers.values().next().value as UIElement | undefined;
      this.root.add(layer, first ? this.root.children.indexOf(first) : undefined);
      const rest = [...this.layers];
      this.layers.clear();
      this.layers.set(name, layer);
      for (const [n, l] of rest) this.layers.set(n, l);
    } else {
      this.root.add(layer);
      this.layers.set(name, layer);
    }
    this.layerTrees.set(layer, tree);
    this.damageAll = true;
    this.requestLayout(true);
    return layer;
  }

  /**
   * 把圖層移到最上層（例如轉場的黑幕：轉場中才打開的視窗也不能蓋過它）
   * @param name 圖層名稱
   */
  raiseLayer(name: string): boolean {
    const layer = this.layers.get(name);
    if (!layer || !this.root) return false;
    this.root.add(layer); // 移到最後面
    this.layers.delete(name);
    this.layers.set(name, layer);
    this.damageAll = true;
    this.requestLayout();
    return true;
  }

  /**
   * 移除圖層
   * @param name 圖層名稱
   */
  removeLayer(name: string): boolean {
    const layer = this.layers.get(name);
    if (!layer) return false;
    this.layers.delete(name);
    this.layerTrees.delete(layer);
    layer.walk((e) => {
      if (e === this.openSelect) this.openSelect = null;
    });
    layer.destroy();
    this.hover = null;
    this.pressed = null;
    this.capture = null;
    this.damageAll = true;
    this.requestLayout(true);
    return true;
  }

  /** 目前的圖層名稱（由下到上） */
  get layerNames(): string[] {
    return [...this.layers.keys()];
  }

  /**
   * 取得疊加圖層（addLayer 的名稱）
   * @param name 圖層名稱
   */
  getLayer(name: string): UIElement | undefined {
    return this.layers.get(name);
  }

  /** 移除目前的介面 */
  clear(): void {
    this.layers.clear(); // 圖層是根元件的子元件，會一起銷毀
    this.layerTrees.clear();
    this.docTree = null;
    this.root?.destroy();
    this.root = null;
    // 畫面也要清掉：沒有重畫的話，顯示層會留著最後一次畫的介面
    this.damageAll = true;
    this.scheduleRender();
  }

  // ───────── 查詢與操作 ─────────

  /**
   * 依 id 找元件（沒有時是 undefined）
   * @param id 元件的 id
   */
  get<T extends UIElement = UIElement>(id: string): T | undefined {
    if (!this.root) return undefined;
    return (this.root.id === id ? this.root : this.root.find(id)) as T | undefined;
  }

  /**
   * 依 id 找元件（沒有時拋出錯誤）
   * @param id 元件的 id
   */
  require<T extends UIElement = UIElement>(id: string): T {
    const el = this.get<T>(id);
    if (!el) throw new Error(`找不到介面元件「${id}」`);
    return el;
  }

  /**
   * 註冊或替換事件處理函式（XML 裡用 onClick="名稱" 呼叫）
   * @param name 函式名稱（XML 裡 onClick="名稱"）
   * @param handler 事件處理函式
   */
  setHandler(name: string, handler: UIHandler): void {
    this.handlers[name] = handler;
  }

  /**
   * 一次註冊多個事件處理函式：ui.setHandlers({ start: () => …, quit: () => … })
   * @param handlers 名稱 → 事件處理函式
   */
  setHandlers(handlers: Record<string, UIHandler>): void {
    Object.assign(this.handlers, handlers);
  }

  /**
   * 用資料產生列表項目（需要列表裡有 <UITemplate>）。
   * 樣板裡的 {欄位} 會換成資料值，{$index} 為索引。
   * @param listId 列表的 id
   * @param items 資料：每一筆產生一個項目
   * @example ui.setItems('inventory', [{ name: '劍', icon: 'sword.png' }])
   */
  setItems(listId: string, items: readonly unknown[]): void {
    const list = this.require<UIList>(listId);
    if (!(list instanceof UIList)) throw new Error(`「${listId}」不是 UIList`);
    if (!list.template) throw new Error(`列表「${listId}」沒有 <UITemplate>`);
    for (const c of [...list.children]) c.destroy();
    items.forEach((item, index) => {
      const xml = interpolate(list.template!, item, index);
      const el = this.withBuildBase(list.baseUrl, () => this.build(xml));
      el.walk((e) => {
        e.item = item;
        e.index = index;
      });
      list.add(el);
    });
    this.requestLayout(true);
  }

  // ───────── 顯示 ─────────

  /** 顯示層提供的全螢幕單色層（UIPlugin 才有）：淡入淡出不用重畫介面 */
  get screenFader(): import('./CanvasRenderer').ScreenFader | null {
    return this.renderer?.fader ?? null;
  }

  /** 顯示層的重畫統計（UIPlugin、3D 面板的貼圖顯示層才有；效能面板用） */
  get renderStats(): import('./UITexture').UIRenderStats | null {
    return (this.renderer as { uploadStats?: import('./UITexture').UIRenderStats } | null)?.uploadStats ?? null;
  }

  /**
   * 設定顯示層（取代原本的）
   * @param renderer 顯示層
   */
  setRenderer(renderer: UIRenderer | null): void {
    this.renderer?.dispose();
    this.renderer = renderer;
    renderer?.attach(this);
    this.invalidate();
  }

  /** 互動狀態（給繪圖器決定按鈕外觀） */
  get paintState(): PaintState {
    return {
      hover: this.hover,
      pressed: this.pressed,
      openSelect: this.openSelect,
      overlays: [...this.overlays.values()],
    };
  }

  /** 展開中的下拉選單 */
  get activeSelect(): UISelect | null {
    return this.openSelect;
  }

  /**
   * 開關下拉選單
   * @param select 要展開的下拉選單；null 關閉
   */
  setOpenSelect(select: UISelect | null): void {
    if (this.openSelect === select) return;
    this.openSelect = select;
    if (select) {
      // 展開時讓目前選取的項目出現在畫面中
      const p = select.popupLayout(this.viewport.height);
      const maxScroll = Math.max(0, select.options.length * p.itemHeight - p.visible * p.itemHeight);
      select.popupScroll = Math.min(maxScroll, Math.max(0, (select.selectedIndex - p.visible + 1) * p.itemHeight));
      select.hoverIndex = -1;
    }
    this.invalidate();
  }

  /**
   * 某一組單選按鈕目前選取的值（都沒選為 null）
   * @param group 單選按鈕的 group
   */
  getRadioValue(group: string): string | null {
    let value: string | null = null;
    this.root?.walk((el) => {
      if (el instanceof UIRadioButton && el.group === group && el.checked) value = el.value;
    });
    return value;
  }

  /**
   * 選取某一組單選按鈕中 value 相符的那一個（不會觸發 change 事件）
   * @param group 單選按鈕的 group
   * @param value 要選取的值
   */
  setRadioValue(group: string, value: string): void {
    let target: UIRadioButton | null = null;
    this.root?.walk((el) => {
      if (!target && el instanceof UIRadioButton && el.group === group && el.value === value) target = el;
    });
    (target as UIRadioButton | null)?.select();
  }

  /** 目前生效的外觀：全域（UI2D.setSkin）再蓋上這份介面的 <UISkin> */
  get skins(): Map<string, Attrs> {
    if (this.mergedSkins && this.mergedVersion === UI2D.skinVersion) return this.mergedSkins;
    const merged = new Map<string, Attrs>();
    for (const [tag, attrs] of UI2D.skins) merged.set(tag, { ...attrs });
    for (const [tag, attrs] of this.docSkins) merged.set(tag, { ...(merged.get(tag) ?? {}), ...attrs });
    this.mergedSkins = merged;
    this.mergedVersion = UI2D.skinVersion;
    return merged;
  }

  /**
   * 這份介面的外觀（不含全域），改了之後會重新套用
   * @param tag 元件的 XML 標籤
   * @param attrs 預設屬性
   */
  setDocumentSkin(tag: string, attrs: Attrs | null): void {
    if (attrs) this.docSkins.set(tag, { ...attrs });
    else this.docSkins.delete(tag);
    this.mergedSkins = null;
    this.requestLayout(true);
    this.invalidate();
  }

  /**
   * 已載入的圖片（給繪圖器用）
   * @param url 圖片網址
   */
  imageSource(url: string): CanvasImageSource | undefined {
    return loadedImages.get(url);
  }

  /**
   * 註冊圖片（自訂圖片載入時，讓繪圖器也能取得圖片）
   * @param url 圖片網址
   * @param image 圖片
   */
  static setImage(url: string, image: CanvasImageSource): void {
    loadedImages.set(url, image);
  }

  /**
   * 要求重畫（外觀改變但排版不變）。
   * 不帶參數時整張重畫；帶元件時只重畫那些元件的範圍（局部重畫，省下重畫與上傳 GPU 的成本）。
   * @param elements 要重畫的元件；不給時整張重畫
   */
  invalidate(...elements: (UIElement | null | undefined)[]): void {
    if (elements.length === 0) this.damageAll = true;
    else for (const el of elements) if (el) this.damage(el);
    this.scheduleRender();
  }

  /**
   * 標記元件範圍需要重畫（目前位置與上一次排版的位置都算）
   * @param el 元件
   * @param pad 額外的邊界（陰影、提示，像素）
   */
  damage(el: UIElement, pad = 16): void {
    if (this.damageAll) return;
    pad = Math.max(pad, el.paintBleed);
    this.damageRects.push(expand(el.absoluteRect, pad));
    const prev = this.prevRects.get(el);
    if (prev) this.damageRects.push(expand(prev, pad));
  }

  /**
   * 顯示層呼叫：取出需要重畫的範圍。null 代表整張重畫；空陣列代表不用重畫。
   * 範圍太大（超過畫面一半）時也會改成整張重畫。
   */
  consumeDamage(): Rect[] | null {
    const all = this.damageAll;
    const rects = this.damageRects;
    this.damageAll = false;
    this.damageRects = [];
    if (all) return null;
    if (rects.length === 0) return [];
    const { width, height } = this.viewport;
    // 裁到畫面內、取整數
    const boxes: Box[] = [];
    for (const r of rects) {
      const x0 = Math.max(0, Math.floor(r.x));
      const y0 = Math.max(0, Math.floor(r.y));
      const x1 = Math.min(width, Math.ceil(r.x + r.width));
      const y1 = Math.min(height, Math.ceil(r.y + r.height));
      if (x1 > x0 && y1 > y0) boxes.push({ x0, y0, x1, y1 });
    }
    if (boxes.length === 0) return [];
    const merged = mergeDamage(boxes);
    // 真正要重畫的面積超過畫面一半：整張重畫比較快
    const area = merged.reduce((sum, b) => sum + (b.x1 - b.x0) * (b.y1 - b.y0), 0);
    if (area > width * height * 0.5) return null;
    return merged.map((b) => ({ x: b.x0, y: b.y0, width: b.x1 - b.x0, height: b.y1 - b.y0 }));
  }

  private scheduleRender(): void {
    if (this.renderScheduled || !this.renderer) return;
    // 介面動畫進行中：下一幀的 tick() 會一起重畫，這裡不另外重畫。
    // 否則遊戲更新（例如每幀改進度條）和介面動畫各自重畫、各自上傳貼圖，每幀變成兩次
    if (this.animFrame) return;
    this.renderScheduled = true;
    queueMicrotask(() => {
      this.renderScheduled = false;
      this.renderer?.render();
    });
  }

  /** 滑鼠所在位置應該顯示的游標 */
  get cursor(): string {
    if (this.drag?.moved || this.sliderDrag) return 'grabbing';
    const h = this.hover;
    if (!h || (h instanceof UIButton && h.disabled)) return '';
    return h.attrs.cursor ?? 'pointer';
  }

  // ───────── 互動（引擎自己判斷點到哪個元件） ─────────

  /**
   * 找出某一點最上層、會攔截滑鼠的元件（有互動、有背景的元件或列表）。
   * 透明且沒有互動的地方回傳 null，點擊會穿透到遊戲畫面。
   * @param x X（介面座標）
   * @param y Y（介面座標）
   */
  hitTest(x: number, y: number): UIElement | null {
    if (!this.root) return null;
    let found: UIElement | null = null;
    const visit = (el: UIElement, ox: number, oy: number) => {
      if (!el.visible) return;
      // pointerEvents="none"：這個元件和裡面的元件都不接收滑鼠（點擊、滾輪會穿透到後面，例如 FPS 面板）
      if (el.attrs.pointerEvents === 'none') return;
      const ex = ox + el.layout.x + el.offsetX;
      const ey = oy + el.layout.y + el.offsetY;
      const inside = x >= ex && y >= ey && x <= ex + el.layout.width && y <= ey + el.layout.height;
      const bg = el.attrs.background;
      const bgImage = el.attrs.bgImage;
      if (
        inside &&
        (el.interactive || (bg && bg !== 'transparent' && bg !== 'none') || (bgImage && bgImage !== 'none'))
      )
        found = el;
      if (el instanceof UIScrollView) {
        if (!inside) return; // 捲動區外的內容被裁掉了
        for (const c of el.children) visit(c, ex - el.scrollLeft, ey - el.scrollTop);
      } else {
        for (const c of el.children) visit(c, ex, ey);
      }
    };
    visit(this.root, 0, 0);
    return found;
  }

  /** 從元件往上找第一個可以互動的（例如點到按鈕裡的文字，要算按鈕） */
  private interactiveAt(el: UIElement | null): UIElement | null {
    for (let e = el; e; e = e.parent) if (e.interactive && !(e instanceof UIScrollView)) return e;
    return null;
  }

  private listAt(el: UIElement | null): UIScrollView | null {
    for (let e = el; e; e = e.parent) if (e instanceof UIScrollView) return e;
    return null;
  }

  /**
   * 處理指標事件（座標為介面座標）。回傳 true 代表事件被介面用掉（不要再傳給遊戲）。
   */
  /**
   * 中斷目前的指標操作（拖曳物品、滑桿、搖桿、捲動…）並還原狀態。
   * 收不到放開事件時呼叫：視窗失去焦點、觸控被瀏覽器取消（pointercancel）。
   */
  cancelPointer(): void {
    const capture = this.capture;
    const pressed = this.pressed;
    this.capture = null;
    this.pressed = null;
    this.drag = null;
    this.pressedOption = -1;
    this.swallowUp = false;
    this.hideTooltip();
    if (capture) {
      try {
        if (capture.cancel) capture.cancel();
        else capture.up(-1e6, -1e6, null);
      } catch (error) {
        log.error('中斷指標操作時發生錯誤：', error);
      }
    }
    if (this.sliderDrag) {
      const { slider, start } = this.sliderDrag;
      this.sliderDrag = null;
      if (slider.value !== start) slider.emit('change', { value: slider.value });
    }
    if (this.hover) {
      const old = this.hover;
      this.hover = null;
      this.invalidate(old);
    }
    this.invalidate(pressed);
  }

  /**
   * 處理指標事件（UIPlugin 自動呼叫；自己的畫布要手動轉發），回傳是否點到介面
   * @param type down、move、up、leave
   * @param x X（介面座標，CSS 像素）
   * @param y Y（介面座標，CSS 像素）
   */
  handlePointer(type: 'down' | 'move' | 'up' | 'leave', x: number, y: number): boolean {
    if (type !== 'move') this.hideTooltip();
    // 上一次的拖曳沒收到放開（例如在視窗外放開）：先結束它，這次的按下照常處理
    if (type === 'down' && (this.capture || this.sliderDrag)) this.cancelPointer();
    // 元件接管中（拖曳搖桿、移動視窗、拖曳物品）
    if (this.capture) {
      if (type === 'move') {
        this.capture.move(x, y, this.hitTest(x, y));
        return true;
      }
      if (type === 'up') {
        const capture = this.capture;
        const pressed = this.pressed;
        this.capture = null;
        this.pressed = null;
        capture.up(x, y, this.hitTest(x, y));
        this.invalidate(pressed);
        return true;
      }
      if (type === 'leave') return true;
    }
    const popup = this.handlePopupPointer(type, x, y);
    if (popup !== null) return popup;
    if (type === 'leave') {
      if (this.hover) {
        const old = this.hover;
        this.hover = null;
        this.invalidate(old);
      }
      return false;
    }
    const hit = this.hitTest(x, y);
    if (type === 'move') {
      if (this.sliderDrag) {
        this.moveSlider(this.sliderDrag.slider, x, y);
        return true;
      }
      if (this.drag) {
        const d = this.drag;
        const dx = x - d.x;
        const dy = y - d.y;
        if (!d.moved && Math.hypot(dx, dy) > 5) {
          d.moved = true;
          this.pressed = null; // 拖曳捲動時不算點擊
        }
        if (d.moved) this.scrollTo(d.list, d.scrollLeft - dx, d.scrollTop - dy);
        return true;
      }
      const hover = this.interactiveAt(hit);
      if (hover !== this.hover) {
        const old = this.hover;
        this.hover = hover;
        this.invalidate(old, hover);
      }
      this.trackTooltip(hit, x, y);
      return hit !== null;
    }
    if (type === 'down') {
      if (!hit) return false;
      this.pressed = this.interactiveAt(hit);
      const capture = this.pressed?.pointerDown?.(x, y) ?? null;
      if (capture) {
        this.capture = capture;
        this.drag = null;
        this.invalidate(this.pressed);
        return true;
      }
      if (this.pressed instanceof UISlider) {
        const slider = this.pressed;
        if (slider.disabled) {
          this.pressed = null;
          return true;
        }
        this.sliderDrag = { slider, start: slider.value };
        this.drag = null;
        this.moveSlider(slider, x, y); // 點軌道直接跳到該位置
        this.invalidate();
        return true;
      }
      const list = this.listAt(hit);
      this.drag = list ? { list, x, y, scrollLeft: list.scrollLeft, scrollTop: list.scrollTop, moved: false } : null;
      this.invalidate(this.pressed);
      return true;
    }
    // up
    if (this.sliderDrag) {
      const { slider, start } = this.sliderDrag;
      this.sliderDrag = null;
      this.pressed = null;
      if (slider.value !== start) slider.emit('change', { value: slider.value });
      this.invalidate();
      return true;
    }
    const pressed = this.pressed;
    const wasActive = pressed !== null || this.drag !== null;
    this.pressed = null;
    this.drag = null;
    if (pressed && this.interactiveAt(hit) === pressed) pressed.emit('click');
    this.invalidate(pressed);
    return wasActive || hit !== null;
  }

  /**
   * 下拉選單展開時的指標處理。回傳 null 代表沒有處理（交給一般流程）。
   */
  private handlePopupPointer(type: 'down' | 'move' | 'up' | 'leave', x: number, y: number): boolean | null {
    if (type === 'up' && this.swallowUp) {
      this.swallowUp = false;
      this.pressed = null;
      this.drag = null;
      return true;
    }
    const select = this.openSelect;
    if (!select) return null;
    if (!select.visible || (!select.parent && select !== this.root)) {
      this.setOpenSelect(null);
      return null;
    }
    const vh = this.viewport.height;
    const index = select.optionAt(x, y, vh);
    if (type === 'leave') {
      select.hoverIndex = -1;
      this.invalidate();
      return false;
    }
    if (type === 'move') {
      if (index !== select.hoverIndex) {
        select.hoverIndex = index;
        this.invalidate();
      }
      if (this.hover) {
        this.hover = null;
        this.invalidate();
      }
      return true; // 展開時不和下面的介面互動
    }
    if (type === 'down') {
      if (index >= 0) {
        this.pressedOption = index;
        return true;
      }
      // 點選單外面（包含下拉選單本身）：關閉，且這次點擊不再往下傳
      this.setOpenSelect(null);
      this.swallowUp = true;
      return true;
    }
    // up
    const pressed = this.pressedOption;
    this.pressedOption = -1;
    if (pressed >= 0 && pressed === index) {
      this.setOpenSelect(null);
      select.choose(index);
    }
    return true;
  }

  /**
   * 處理滾輪：捲動滑鼠所在的列表。回傳 true 代表被介面用掉
   * @param dx 橫向捲動量
   * @param dy 縱向捲動量
   * @param x 指標 X（介面座標）
   * @param y 指標 Y（介面座標）
   */
  handleWheel(dx: number, dy: number, x: number, y: number): boolean {
    const open = this.openSelect;
    if (open) {
      const p = open.popupLayout(this.viewport.height);
      if (x >= p.x && x <= p.x + p.width && y >= p.y && y <= p.y + p.height) {
        const max = Math.max(0, (open.options.length - p.visible) * p.itemHeight);
        open.popupScroll = Math.min(max, Math.max(0, open.popupScroll + dy));
        open.hoverIndex = open.optionAt(x, y, this.viewport.height);
        this.invalidate();
      }
      return true;
    }
    const hit = this.hitTest(x, y);
    const list = this.listAt(hit);
    if (list) {
      const axis = list.scrollAxis;
      if (axis === 'both') this.scrollTo(list, list.scrollLeft + dx, list.scrollTop + dy);
      else if (axis === 'x') this.scrollTo(list, list.scrollLeft + (dx || dy), list.scrollTop);
      else this.scrollTo(list, list.scrollLeft, list.scrollTop + dy);
      return true;
    }
    return hit !== null;
  }

  // ───────── 動畫、最上層圖層、浮動說明 ─────────

  /**
   * 讓元件每幀收到 tick(dt)，直到它回傳 false
   * @param el 要收到 tick 的元件
   */
  animate(el: UIElement): void {
    if (!el.tick) return;
    this.animating.add(el);
    this.scheduleFrame();
  }

  /**
   * 推進動畫 dt 秒（預設由 requestAnimationFrame 自動呼叫；autoTick: false 時自己呼叫）。
   * @param dt 經過的時間（秒）
   */
  tick(dt: number): void {
    for (const el of [...this.animating]) {
      if (el.isDestroyed || !el.tick || !el.tick(dt)) this.animating.delete(el);
    }
    const tip = this.tip;
    if (tip && !tip.rect) {
      tip.wait -= dt;
      if (tip.wait <= 0) this.showTooltip(tip);
    }
    if (this.damageAll || this.damageRects.length) this.scheduleRender();
  }

  /** 有動畫中的元件或等待顯示的浮動說明 */
  get animatingCount(): number {
    return this.animating.size + (this.tip && !this.tip.rect ? 1 : 0);
  }

  private scheduleFrame(): void {
    if (!this.autoTick || this.animFrame || typeof requestAnimationFrame === 'undefined') return;
    this.lastFrame = performance.now();
    const loop = (t: number) => {
      this.animFrame = 0;
      const dt = Math.min(0.1, Math.max(0, (t - this.lastFrame) / 1000));
      this.lastFrame = t;
      this.tick(dt);
      if (this.animatingCount > 0) this.animFrame = requestAnimationFrame(loop);
    };
    this.animFrame = requestAnimationFrame(loop);
  }

  /**
   * 設定或移除最上層的圖層
   * @param key 識別用的物件（同一個 key 會取代）
   * @param painter 繪製函式；null 移除
   */
  setOverlay(key: object, painter: OverlayPainter | null): void {
    if (painter) this.overlays.set(key, painter);
    else this.overlays.delete(key);
    this.scheduleRender();
  }

  /**
   * 標記任意範圍需要重畫
   * @param r 要重畫的範圍（介面座標）
   */
  damageArea(r: Rect): void {
    if (!this.damageAll) this.damageRects.push(expand(r, 2));
    this.scheduleRender();
  }

  /**
   * 顯示提示訊息（需要介面裡有 <UIToast>；沒有時自動在最上層加一個）。
   * @param text 訊息文字
   * @param options 圖示、顏色、顯示幾秒、背景顏色
   * @example ui.toast('獲得金幣 ×10', { icon: 'coin', color: '#ffd75e' })
   */
  toast(text: string, options: ToastOptions = {}): void {
    if (!this.root) return;
    let toast: UIToast | null = null;
    this.root.walk((el) => {
      if (!toast && el instanceof UIToast) toast = el;
    });
    if (!toast) {
      toast = this.createElement<UIToast>('UIToast');
      this.root.add(toast);
      this.requestLayout(true);
    }
    (toast as UIToast).show(text, options);
  }

  /** 滑鼠移動時：找出有 tooltip 屬性的元件，停留一段時間後顯示 */
  private trackTooltip(hit: UIElement | null, x: number, y: number): void {
    let el: UIElement | null = null;
    for (let e = hit; e; e = e.parent) {
      if (e.attrs.tooltip) {
        el = e;
        break;
      }
    }
    if (this.tip?.el === el) {
      if (this.tip && !this.tip.rect) {
        this.tip.x = x;
        this.tip.y = y;
      }
      return;
    }
    this.hideTooltip();
    if (!el) return;
    this.tip = { el, x, y, wait: num(el.attrs.tooltipDelay, 0.45), rect: null };
    if (this.autoTick && typeof requestAnimationFrame !== 'undefined') this.scheduleFrame();
  }

  private hideTooltip(): void {
    const tip = this.tip;
    if (!tip) return;
    this.tip = null;
    if (tip.rect) {
      this.damageArea(expand(tip.rect, 12));
      this.setOverlay(this.tipKey, null);
    }
  }

  private showTooltip(tip: { el: UIElement; x: number; y: number; rect: Rect | null }): void {
    const a = tip.el.attrs;
    const font = { size: num(a.tooltipFontSize, 13), family: UI_FONT_FAMILY, weight: 'normal', lineHeight: 1.45 };
    const titleFont = { ...font, weight: 'bold', size: font.size + 1 };
    const maxW = num(a.tooltipWidth, 240);
    const pad = 10;
    const title = a.tooltipTitle ? wrapText(a.tooltipTitle, titleFont, maxW, this.ctx.measure) : null;
    const body = wrapText(a.tooltip ?? '', font, maxW, this.ctx.measure);
    const w = Math.max(title?.width ?? 0, body.width) + pad * 2;
    const h = (title ? title.height + 4 : 0) + body.height + pad * 2;
    const vp = this.viewport;
    let x = tip.x + 14;
    let y = tip.y + 20;
    if (x + w > vp.width - 4) x = Math.max(4, tip.x - w - 10);
    if (y + h > vp.height - 4) y = Math.max(4, tip.y - h - 10);
    tip.rect = { x, y, width: w, height: h };
    const accent = a.tooltipColor ?? '#9acd32';
    this.setOverlay(this.tipKey, (ctx) => {
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.45)';
      ctx.shadowBlur = 12;
      ctx.shadowOffsetY = 4;
      ctx.fillStyle = 'rgba(14,17,12,0.96)';
      roundRectPath(ctx, x, y, w, h, 8);
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.strokeStyle = 'rgba(255,255,255,0.14)';
      ctx.lineWidth = 1;
      roundRectPath(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 8);
      ctx.stroke();
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      let ty = y + pad;
      if (title) {
        ctx.font = uiFont(titleFont.size, 'bold');
        ctx.fillStyle = accent;
        for (const line of title.lines) {
          ctx.fillText(line, x + pad, ty + (titleFont.size * titleFont.lineHeight) / 2);
          ty += titleFont.size * titleFont.lineHeight;
        }
        ty += 4;
      }
      ctx.font = uiFont(font.size);
      ctx.fillStyle = '#dfe5d6';
      for (const line of body.lines) {
        ctx.fillText(line, x + pad, ty + (font.size * font.lineHeight) / 2);
        ty += font.size * font.lineHeight;
      }
      ctx.restore();
    });
    this.damageArea(expand(tip.rect, 12));
  }

  /** 拖曳滑桿：數值改變時觸發 input 事件 */
  private moveSlider(slider: UISlider, x: number, y: number): void {
    const v = slider.valueAt(x, y);
    if (v === slider.value && slider.raw.value !== undefined) return;
    slider.value = v;
    slider.emit('input', { value: v });
    this.invalidate();
  }

  /** 拖曳中的滑桿 */
  get activeSlider(): UISlider | null {
    return this.sliderDrag?.slider ?? null;
  }

  /**
   * 捲動列表到指定位置（會限制在內容範圍內）
   * @param list 列表或捲動區
   * @param left 橫向捲動位置（像素）
   * @param top 縱向捲動位置（像素）
   */
  scrollTo(list: UIScrollView, left: number, top: number): void {
    const maxLeft = Math.max(0, list.contentWidth - list.layout.width);
    const maxTop = Math.max(0, list.contentHeight - list.layout.height);
    const l = Math.min(maxLeft, Math.max(0, left));
    const t = Math.min(maxTop, Math.max(0, top));
    if (l === list.scrollLeft && t === list.scrollTop) return;
    list.scrollLeft = l;
    list.scrollTop = t;
    list.emit('scroll');
    this.invalidate(list);
  }

  /** 比對這次與上次排版的位置：移動或改變大小的元件要重畫；結構改變（新增、移除）則整張重畫 */
  private trackMovedElements(root: UIElement): void {
    const rects = new Map<UIElement, Rect>();
    let structural = false;
    root.walk((el) => {
      const r = el.absoluteRect;
      rects.set(el, r);
      const p = this.prevRects.get(el);
      if (!p) structural = true;
      else if (p.x !== r.x || p.y !== r.y || p.width !== r.width || p.height !== r.height) {
        this.damageRects.push(expand(p, 16), expand(r, 16));
      }
    });
    if (structural || rects.size !== this.prevRects.size) this.damageAll = true;
    this.prevRects = rects;
  }

  /**
   * 每次載入新的介面後通知（套件可以在這裡把自己的元件加回去）
   * @param listener 載入後呼叫，拿到新的根元件
   */
  onLoad(listener: (root: UIElement) => void): () => void {
    this.loadListeners.add(listener);
    return () => this.loadListeners.delete(listener);
  }

  /**
   * 用程式建立元件（之後用 parent.add(el) 加進介面）。
   * @param tag XML 標籤（例如 'UILabel'）
   * @param attrs 屬性
   * @param text 文字內容
   * @example const badge = ui.createElement('UILabel', { color: '#f00' }, 'NEW');
   */
  createElement<T extends UIElement = UIElement>(tag: string, attrs: Attrs = {}, text = ''): T {
    const Ctor = UI2D.components.get(tag);
    if (!Ctor) throw new Error(`不認識的元件 <${tag}>`);
    const el = new Ctor(this.ctx, tag, attrs, text) as T;
    el.onBuilt?.();
    // 建立後立刻計算屬性（不能在建構函式裡做：子類別的欄位那時還沒初始化）
    el.walk((e) => e.resolve());
    return el;
  }

  /**
   * 每次排版完成後通知
   * @param listener 排版完成後呼叫
   */
  onLayout(listener: () => void): () => void {
    this.layoutListeners.add(listener);
    return () => this.layoutListeners.delete(listener);
  }

  /** 目前生效的斷點 */
  get breakpoint(): readonly string[] {
    return this.activeBreakpoints;
  }

  /** 介面的大小（像素） */
  get size(): { width: number; height: number } {
    return { ...this.viewport };
  }

  /**
   * 設定介面尺寸（無畫面模式用；有容器時會自動跟隨容器）
   * @param width 寬（CSS 像素）
   * @param height 高（CSS 像素）
   */
  resize(width: number, height: number): void {
    this.viewport = { width, height };
    this.damageAll = true;
    if (this.updateBreakpoints()) this.needsReapply = true;
    this.layout();
  }

  // ───────── 排版 ─────────

  /**
   * 要求重新排版（同一輪內多次要求只會排一次）
   * @param reapply true 時重新套用所有屬性（樣式、斷點改變時）
   */
  requestLayout(reapply = false): void {
    if (reapply) this.needsReapply = true;
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      if (this.scheduled) this.layout();
    });
  }

  /** 立刻排版並更新畫面 */
  layout(): void {
    this.scheduled = false;
    const root = this.root;
    if (!root) return;
    if (this.needsReapply) {
      this.needsReapply = false;
      this.damageAll = true;
      root.walk((el) => el.resolve());
      root.walk((el) => el.applyLayout());
      root.walk((el) => el instanceof UIScrollView && el.constrainChildren());
      root.walk((el) => el instanceof UIStackView && el.fitPages());
    }
    // 根元件 <UI> 的版面尺寸：沒寫或 auto → 填滿畫面；數字、百分比 → 照寫的大小；fit → 依內容
    //   <UI width="800" height="600">  800 × 600
    //   <UI width="auto" height="300"> 寬度滿版、高度 300
    //   <UI width="100" height="fit">  寬 100、高度依內容
    if (isAutoSize(root.attrs.width)) root.node.setWidth(this.viewport.width);
    if (isAutoSize(root.attrs.height)) root.node.setHeight(this.viewport.height);
    // fit 的那一邊不給可用空間，Yoga 才會依內容決定大小（否則根節點會被撐滿）
    const ownerW = isFitDim(root.attrs.width) ? undefined : this.viewport.width;
    const ownerH = isFitDim(root.attrs.height) ? undefined : this.viewport.height;
    root.node.calculateLayout(ownerW, ownerH);
    root.readLayout();
    // grid 列表需要先知道自己的寬度才能決定每格寬度，必要時再排一次
    let again = false;
    root.walk((el) => {
      if (el instanceof UIList && el.fitGrid()) again = true;
    });
    if (again) {
      root.node.calculateLayout(ownerW, ownerH);
      root.readLayout();
    }
    this.trackMovedElements(root);
    if (this.openSelect) {
      let attached = false;
      root.walk((el) => {
        if (el === this.openSelect) attached = true;
      });
      if (!attached || !this.openSelect.visible) this.openSelect = null;
    }
    this.renderer?.render();
    for (const l of [...this.layoutListeners]) l();
  }

  /** 銷毀介面 */
  destroy(): void {
    if (this.animFrame && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(this.animFrame);
    this.animFrame = 0;
    this.animating.clear();
    this.overlays.clear();
    this.clear();
    this.cleanupResize?.();
    this.renderer?.dispose();
    this.renderer = null;
    this.ctx.blankNode.free();
    this.layoutListeners.clear();
    this.loadListeners.clear();
  }

  // ───────── 內部 ─────────

  /**
   * 收集 <UIStyle>、<UISkin>，以及 <UIImport src> 匯入的檔案裡的樣式（依寫的順序，後面的蓋過前面的）。
   * 匯入的檔案還沒讀過時先略過，背景讀好後重新套用（restyle）。
   */
  private collectStyles(
    node: XmlNode,
    styles = this.styles,
    skins = this.docSkins,
    seen = new Set<string>(),
    base: string = this.baseUrl,
  ): void {
    for (const child of node.children) {
      if (child.tag === 'UIImport') {
        const src = child.attrs.src?.trim();
        if (!src) throw new XmlError('<UIImport> 需要 src 屬性（例如 src="theme.xml"）', child.line, 1);
        const url = resolveAgainst(base, src);
        if (seen.has(url)) continue; // 重複或循環匯入
        seen.add(url);
        const text = cachedUIXml(url);
        if (text === undefined) {
          this.requestImport(url, src);
          continue;
        }
        let imported: XmlNode;
        try {
          imported = parseXml(text, { voidTags: VOID_TAGS });
        } catch (error) {
          log.warn(`<UIImport src="${src}">（第 ${child.line} 行）：${(error as Error).message}`);
          continue;
        }
        // 匯入的檔案裡再匯入：以那個檔案的位置為基準
        this.collectStyles(imported, styles, skins, seen, dirOf(url));
        continue;
      }
      if (child.tag === 'UIStyle') {
        const { name, ...attrs } = child.attrs;
        if (!name) throw new XmlError('<UIStyle> 需要 name 屬性', child.line, 1);
        styles.set(name, attrs);
      } else if (child.tag === 'UISkin') {
        const { for: target, ...attrs } = child.attrs;
        if (!target) throw new XmlError('<UISkin> 需要 for 屬性（元件名稱，例如 for="UIButton"）', child.line, 1);
        skins.set(target, { ...(skins.get(target) ?? {}), ...attrs });
      } else {
        this.collectStyles(child, styles, skins, seen, base);
      }
    }
  }

  /** 文件與圖層的 XML（匯入的樣式晚到時重新收集用） */
  private docTree: XmlNode | null = null;
  private readonly layerTrees = new Map<UIElement, XmlNode>();
  private readonly importLoads = new Set<string>();

  /** 背景讀取 <UIImport> 的檔案，讀好後重新套用樣式 */
  private requestImport(url: string, src: string): void {
    if (this.importLoads.has(url)) return;
    this.importLoads.add(url);
    const task: Promise<void> = loadUIXml(url)
      .then(
        () => {
          // 先標記讀完再重新套用：重新套用時真的找不到的樣式才會警告
          this.importLoads.delete(url);
          this.restyle();
        },
        (error: Error) => log.warn(`<UIImport src="${src}"> 無法讀取：${error.message}`),
      )
      .finally(() => {
        this.importLoads.delete(url);
        this.pendingComponents.delete(task);
      });
    this.pendingComponents.add(task);
  }

  /** 重新收集所有樣式（文件、圖層、內嵌元件）並重新套用 */
  private restyle(): void {
    if (this.docTree) {
      this.styles = new Map();
      this.docSkins = new Map();
      this.mergedSkins = null;
      this.collectStyles(this.docTree);
    }
    for (const [layer, tree] of this.layerTrees) {
      if (layer.isDestroyed) {
        this.layerTrees.delete(layer);
        continue;
      }
      const scope = { styles: new Map<string, Attrs>(), skins: new Map<string, Attrs>() };
      this.collectStyles(tree, scope.styles, scope.skins, new Set(), layer.baseUrl ?? this.baseUrl);
      layer.styleScope = scope;
    }
    this.root?.walk((el) => {
      if (!(el instanceof UIComponent) || !el.sourceTree) return;
      const scope = { styles: new Map<string, Attrs>(), skins: new Map<string, Attrs>() };
      this.collectStyles(el.sourceTree, scope.styles, scope.skins, new Set(), el.url ? dirOf(el.url) : this.baseUrl);
      el.styleScope = scope.styles.size || scope.skins.size ? scope : null;
    });
    this.damageAll = true;
    this.requestLayout(true);
  }

  private build(xml: XmlNode): UIElement {
    const Ctor = UI2D.components.get(xml.tag);
    if (!Ctor && this.unknownTags === 'placeholder') {
      if (!this.unknownComponents.includes(xml.tag)) this.unknownComponents.push(xml.tag);
      const holder = new UILayout(this.ctx, xml.tag, {
        padding: '4 8',
        border: '1 #ff9f43',
        background: 'rgba(255,159,67,0.12)',
        ...xml.attrs,
      });
      holder.line = xml.line;
      const label = new UILabel(this.ctx, 'UILabel', { fontSize: '11', color: '#ffb469' }, `<${xml.tag}>`);
      label.line = xml.line;
      holder.add(label);
      for (const child of xml.children) if (!STYLE_TAGS.has(child.tag)) holder.add(this.build(child));
      return holder;
    }
    if (!Ctor) {
      throw new XmlError(`不認識的元件 <${xml.tag}>，可用的有：${[...UI2D.components.keys()].join('、')}`, xml.line, 1);
    }
    const el = new Ctor(this.ctx, xml.tag, xml.attrs, xml.text);
    el.line = xml.line;
    el.baseUrl = this.buildBase;
    if (el instanceof UIComponent) {
      const extra = xml.children.find((c) => c.tag !== COMMENT_TAG);
      if (extra) throw new XmlError('<UIComponent> 裡不能放子元件（內容來自 src 指定的檔案）', extra.line, 1);
      this.mountComponent(el);
      el.onBuilt?.();
      return el;
    }
    for (const child of xml.children) {
      if (STYLE_TAGS.has(child.tag)) continue;
      if (el.consumeChild?.(child)) continue;
      if (child.tag === 'UITemplate') {
        if (!(el instanceof UIList)) throw new XmlError('<UITemplate> 只能放在 <UIList> 裡', child.line, 1);
        if (child.children.length !== 1) throw new XmlError('<UITemplate> 裡要剛好有一個元件', child.line, 1);
        el.template = child.children[0];
        continue;
      }
      if (el instanceof UILabel) throw new XmlError('<UILabel> 裡只能放文字', child.line, 1);
      if (el instanceof UISelect) {
        if (child.tag !== 'UIOption') throw new XmlError('<UISelect> 裡只能放 <UIOption>', child.line, 1);
        const value = child.attrs.value ?? child.text;
        el.options.push({ value, label: child.text || child.attrs.label || value });
        continue;
      }
      if (el instanceof UICheckBox) throw new XmlError(`<${el.type}> 裡只能放文字（或用 text 屬性）`, child.line, 1);
      el.contentParent.add(this.build(child));
    }
    // 按鈕的文字標籤放在最後
    if (el instanceof UIButton && el.label) el.add(el.label);
    el.onBuilt?.();
    return el;
  }

  /** 相對路徑以寫它的元件所在的介面檔為基準（沒有記錄時用主文件的位置） */
  private resolveUrl(src: string, from?: UIElement | null): string {
    return resolveAgainst(from?.baseUrl ?? this.baseUrl, src);
  }

  /** 建立中的元件屬於哪個資料夾（null：主文件） */
  private buildBase: string | null = null;

  /** 以某個資料夾為基準建立元件（疊加圖層、內嵌元件的內容） */
  private withBuildBase<T>(base: string | null, fn: () => T): T {
    const saved = this.buildBase;
    this.buildBase = base;
    try {
      return fn();
    } finally {
      this.buildBase = saved;
    }
  }

  // ───────── <UIComponent src>：內嵌外部介面檔 ─────────

  /** 建立中的內嵌路徑（外層到內層的檔案網址），檢查循環內嵌用 */
  private includeChain: string[] = [];
  /** 背景讀取中的內嵌元件 */
  private readonly pendingComponents = new Set<Promise<void>>();

  /** 以某份文件為最外層建立元件（內嵌路徑從它開始算） */
  private withIncludeChain<T>(sourceUrl: string | undefined, fn: () => T): T {
    const saved = this.includeChain;
    this.includeChain = sourceUrl ? [sourceUrl] : [];
    try {
      return fn();
    } finally {
      this.includeChain = saved;
    }
  }

  private mountComponent(el: UIComponent): void {
    el.chain = [...this.includeChain];
    const src = (el.ownAttrs.src ?? '').trim();
    if (!src) {
      el.status = 'empty';
      el.url = null;
      this.componentNotice(el, '<UIComponent> 請設定 src，例如 src="card.xml"', false);
      return;
    }
    const url = this.resolveUrl(src, el);
    el.url = url;
    if (el.chain.includes(url)) {
      this.componentFailed(el, `循環內嵌：${[...el.chain, url].join(' → ')}`);
      return;
    }
    if (el.chain.length >= MAX_COMPONENT_DEPTH) {
      this.componentFailed(el, `內嵌太多層（最多 ${MAX_COMPONENT_DEPTH} 層）：${src}`);
      return;
    }
    const cached = cachedUIXml(url);
    if (cached !== undefined) {
      this.fillComponent(el, url, cached);
      return;
    }
    // 還沒讀過：背景讀取，讀好再放進去
    el.status = 'loading';
    const task: Promise<void> = loadUIXml(url)
      .then(
        (text) => {
          if (el.isDestroyed || el.url !== url) return;
          this.fillComponent(el, url, text);
          this.requestLayout(true);
        },
        (error: Error) => {
          if (el.isDestroyed || el.url !== url) return;
          this.componentFailed(el, `無法讀取 ${src}：${error.message}`);
          this.requestLayout(true);
        },
      )
      .finally(() => this.pendingComponents.delete(task));
    this.pendingComponents.add(task);
  }

  /** 把外部檔案的內容建立到元件裡 */
  private fillComponent(el: UIComponent, url: string, text: string): void {
    for (const c of [...el.children]) c.destroy();
    let tree: XmlNode;
    try {
      tree = parseXml(text, { voidTags: VOID_TAGS });
    } catch (error) {
      this.componentFailed(el, `${el.ownAttrs.src}：${(error as Error).message}`);
      return;
    }
    // 外部檔案自己的樣式、外觀只套用在這個元件裡
    const scope = { styles: new Map<string, Attrs>(), skins: new Map<string, Attrs>() };
    el.sourceTree = tree;
    this.collectStyles(tree, scope.styles, scope.skins, new Set(), dirOf(url));
    el.styleScope = scope.styles.size || scope.skins.size ? scope : null;
    // 根元素是 <UI>：它的屬性套到元件上（自己寫的屬性優先）
    for (const key of Object.keys(el.raw)) if (!(key in el.ownAttrs)) delete el.raw[key];
    const nodes = tree.tag === 'UI' ? tree.children : [tree];
    if (tree.tag === 'UI') {
      for (const [k, v] of Object.entries(tree.attrs)) {
        if (k in el.ownAttrs || k === 'id') continue;
        if (COMPONENT_SIZE_ATTR.test(k) && !v.trim()) continue;
        // 寬高只能由外部檔案決定：auto 是填滿放置的位置（和最外層 <UI> 的 auto 滿版一致），沒寫時依內容決定大小
        el.raw[k] = COMPONENT_SIZE_ATTR.test(k) && isAutoSize(v) ? '100%' : v;
      }
    }
    const saved = this.includeChain;
    this.includeChain = [...el.chain, url];
    try {
      for (const node of nodes) {
        if (STYLE_TAGS.has(node.tag)) continue;
        // 內嵌檔案裡的相對路徑以那個檔案的位置為基準
        const child = this.withBuildBase(dirOf(url), () => this.build(node));
        child.walk((e) => {
          e.includedFrom ??= url;
        });
        el.add(child);
      }
    } catch (error) {
      for (const c of [...el.children]) c.destroy();
      this.componentFailed(el, `${el.ownAttrs.src}：${(error as Error).message}`);
      return;
    } finally {
      this.includeChain = saved;
    }
    el.status = 'loaded';
    el.error = null;
  }

  private componentFailed(el: UIComponent, message: string): void {
    el.status = 'error';
    el.error = message;
    log.warn(`<UIComponent>（第 ${el.line} 行）${message}`);
    this.componentNotice(el, `⚠ ${message}`, true);
  }

  /** 元件裡顯示提示（沒有 src）或錯誤訊息 */
  private componentNotice(el: UIComponent, message: string, error: boolean): void {
    for (const c of [...el.children]) c.destroy();
    const label = new UILabel(
      this.ctx,
      'UILabel',
      {
        fontSize: '12',
        padding: '6 10',
        radius: '6',
        color: error ? '#ff9a8f' : '#9aa48f',
        background: error ? 'rgba(255,107,107,0.12)' : 'rgba(154,205,50,0.06)',
        border: error ? '1 rgba(255,107,107,0.45)' : '1 rgba(154,205,50,0.35)',
      },
      message,
    );
    label.includedFrom = el.url ?? '(UIComponent)';
    label.resolve();
    el.add(label);
  }

  private updateBreakpoints(): boolean {
    const w = this.viewport.width;
    const active = Object.entries(this.breakpoints)
      .filter(([, min]) => w >= min)
      .sort((a, b) => a[1] - b[1])
      .map(([name]) => name);
    const changed = active.join(',') !== this.activeBreakpoints.join(',');
    this.activeBreakpoints = active;
    return changed;
  }

  private observeContainer(container: HTMLElement): void {
    const isBody = container === document.body;
    const measure = () => {
      const w = isBody ? window.innerWidth : container.clientWidth;
      const h = isBody ? window.innerHeight : container.clientHeight;
      if (w !== this.viewport.width || h !== this.viewport.height) this.resize(w, h);
    };
    measure();
    if (typeof ResizeObserver !== 'undefined' && !isBody) {
      const ro = new ResizeObserver(measure);
      ro.observe(container);
      this.cleanupResize = () => ro.disconnect();
    } else {
      window.addEventListener('resize', measure);
      this.cleanupResize = () => window.removeEventListener('resize', measure);
    }
  }
}

/** 把樣板中的 {欄位} 換成資料值（支援 {a.b} 與 {$index}） */
function interpolate(node: XmlNode, item: unknown, index: number): XmlNode {
  const replace = (s: string) =>
    s.replace(/\{([$\w.]+)\}/g, (_m, path: string) => {
      if (path === '$index') return String(index);
      let v: unknown = item;
      for (const key of path.split('.')) v = v != null ? (v as Record<string, unknown>)[key] : undefined;
      return v == null ? '' : String(v);
    });
  return {
    tag: node.tag,
    attrs: Object.fromEntries(Object.entries(node.attrs).map(([k, v]) => [k, replace(v)])),
    text: replace(node.text),
    line: node.line,
    children: node.children.map((c) => interpolate(c, item, index)),
  };
}

/** 把範圍往外擴大（涵蓋陰影、邊框） */
function expand(r: Rect, pad: number): Rect {
  return { x: r.x - pad, y: r.y - pad, width: r.width + pad * 2, height: r.height + pad * 2 };
}
