/**
 * 場景轉場與資源載入頁面。
 *
 * 進入場景（包括遊戲一開始進入第一個場景）時：
 *   1. 畫面淡出成黑色（蓋住舊場景，也擋住滑鼠）
 *   2. 顯示載入頁面（XML），一邊下載這個場景的資源、介面檔，一邊更新進度條
 *   3. 載入完成：淡出載入頁面 → 切換 3D 場景（SceneManager）→ 疊上這個場景的介面（hud）→ 淡入
 *
 * @example
 * const transition = new SceneTransition({ ui, scenes: scenePlugin.scenes, assets: assetPlugin.assets, loading: 'ui/loading.xml' })
 *   .define('forest', {
 *     title: '迷霧森林',
 *     loading: 'ui/forest/loading.xml',     // 這個場景自己的載入頁面（沒寫用預設的）
 *     hud: 'ui/forest/hud.xml',             // 進入後疊在畫面上的介面
 *     assets: ['textures/tree.png', 'sounds/wind.wav', { url: 'models/hut.glb', type: 'gltf' }],
 *     tips: ['按空白鍵跳躍', '金幣會在 3 秒後重生'],
 *   })
 *   .define('desert', { title: '沙漠', hud: 'ui/desert/hud.xml' });
 * await transition.go('forest');
 *
 * 載入頁面的 XML 用這些 id 顯示進度（都可以省略）：
 *   loadingTitle（UILabel）場景名稱　loadingBar（UIProgressBar，0～100）進度
 *   loadingText（UILabel）百分比　loadingItem（UILabel）正在載入的檔案　loadingTip（UILabel／UIRichText）隨機提示
 */
import type { ScreenFader } from './CanvasRenderer';
import type { UIElement, UILabel } from './elements';
import { cachedUIXml, loadUIXml } from './xmlSources';
import type { UI2D } from './UI2D';
import { createLogger } from '../core/Logger';

const log = createLogger('ui2d');

/** 一個場景要準備的東西 */
export interface SceneDefinition {
  /** SceneManager 裡的場景名稱（預設和 define 的名稱相同）；不需要切換 3D 場景時寫 null */
  scene?: string | null;
  /** 顯示在載入頁面上的名稱（預設是場景名稱） */
  title?: string;
  /** 這個場景的載入頁面 XML（預設用 SceneTransition 的 loading） */
  loading?: string;
  /** 進入後疊在畫面上的介面 XML（離開場景時移除） */
  hud?: string;
  /** 先下載的介面檔（例如這個場景會打開的視窗），之後打開不用等 */
  ui?: readonly string[];
  /** 先下載的資源（圖片、音效、模型…，交給 AssetManager） */
  assets?: readonly (string | { url: string; type?: string })[];
  /** 載入頁面隨機顯示的提示 */
  tips?: readonly string[];
  /** 進入、離開時呼叫（3D 場景切換之後、之前） */
  onEnter?(): void | Promise<void>;
  /** 離開時呼叫（切換 3D 場景之前） */
  onExit?(): void | Promise<void>;
}

/** 載入進度 */
export interface SceneTransitionProgress {
  /** 場景名稱 */
  scene: string;
  /** 已完成（含失敗）的數量 */
  loaded: number;
  /** 要載入的總數 */
  total: number;
  /** 0～1 */
  progress: number;
  /** 剛完成的檔案 */
  item: string;
  /** 失敗的數量 */
  failed: number;
}

/** 轉場的狀態改變：開始（start）或進入場景（enter） */
export type SceneTransitionChange =
  | {
      /** 開始轉場（載入頁面出現、開始下載） */
      type: 'start';
      /** 原本的場景（第一次是 null） */
      from: string | null;
      /** 要去的場景 */
      to: string;
    }
  | {
      /** 已經進入新場景 */
      type: 'enter';
      /** 原本的場景（第一次是 null） */
      from: string | null;
      /** 進入的場景 */
      to: string;
    };

/** go() 的選項 */
export interface GoOptions {
  /**
   * 淡入前（畫面還是黑的）執行，例如打開標題畫面：淡入時它已經在畫面上，不會先看到遊戲再跳出來。
   * 執行完會等介面的圖片都讀完才淡入。
   */
  beforeReveal?(): void | Promise<void>;
}

/** SceneTransition 的設定 */
export interface SceneTransitionOptions {
  /** 介面（載入頁面、場景介面放在這裡） */
  ui: UI2D;
  /** 切換 3D 場景（SceneManager 或任何有 load(name) 的物件） */
  scenes?: {
    /**
     * 切換到這個 3D 場景
     * @param name 場景名稱
     */
    load(name: string): void;
  } | null;
  /** 下載資源（AssetManager 或任何有 load(url, type) 的物件） */
  assets?: {
    /**
     * 下載一個資源
     * @param url 資源網址
     * @param type 資源類型；省略時依副檔名判斷
     */
    load(url: string, type?: string): Promise<unknown>;
  } | null;
  /** 預設的載入頁面 XML 網址（沒給時用內建的） */
  loading?: string | null;
  /** 轉場效果：fade（預設，淡出淡入）或 none */
  effect?: 'fade' | 'none';
  /** 每一段淡入淡出的秒數（預設 0.35） */
  duration?: number;
  /** 淡出時的顏色（預設黑色） */
  color?: string;
  /** 載入頁面至少顯示幾秒（預設 0.6；資源很少時不會一閃而過） */
  minLoadingTime?: number;
  /** 淡入前最多等介面的圖片幾秒（預設 3；圖片很慢時不會一直停在黑畫面） */
  readyTimeout?: number;
  /**
   * 淡入淡出用的全螢幕單色層（預設用 ui.screenFader，UIPlugin 會提供）。
   * 有的話淡入淡出只改它的透明度，介面的變化都在全黑時完成，不會每幀重畫介面；沒有時用介面圖層淡入淡出。
   */
  fader?: ScreenFader | null;
  /** 動畫排程（測試可替換） */
  requestFrame?: (cb: () => void) => void;
  /** 目前時間的函式（測試可替換） */
  now?: () => number;
}

/** 內建的載入頁面 */
export const DEFAULT_LOADING_XML = `<UI width="auto" height="auto" background="#0c0f0b" align="center" justify="center" padding="24" gap="14">
  <UILabel fontSize="12" color="#838b78">LOADING</UILabel>
  <UILabel id="loadingTitle" fontSize="26" fontWeight="bold" color="#ffffff" textAlign="center">載入中</UILabel>
  <UIProgressBar id="loadingBar" value="0" max="100" width="70%" maxWidth="360" height="10" fill="#7aa828,#b4e05a" animate="0.15"/>
  <UILayout dir="h" gap="10" width="70%" maxWidth="360" justify="between">
    <UILabel id="loadingItem" fontSize="12" color="#838b78" shrink="1"></UILabel>
    <UILabel id="loadingText" fontSize="12" color="#b8c0ae">0%</UILabel>
  </UILayout>
  <UILabel id="loadingTip" fontSize="13" color="#b8c0ae" textAlign="center" maxWidth="420"></UILabel>
</UI>`;

const LAYER_COVER = '__sceneCover';
const LAYER_LOADING = '__sceneLoading';
const hudLayer = (name: string) => `scene:${name}`;

const fileName = (url: string) => decodeURIComponent(url.split(/[?#]/)[0].split('/').pop() ?? url);
const dirOf = (url: string) => (url.includes('/') ? url.slice(0, url.lastIndexOf('/') + 1) : '');

/** 場景轉場與資源載入頁面：淡出 → 載入頁面（下載資源）→ 切換場景 → 淡入 */
export class SceneTransition {
  private readonly defs = new Map<string, SceneDefinition>();
  private readonly progressListeners = new Set<(p: SceneTransitionProgress) => void>();
  private readonly changeListeners = new Set<(c: SceneTransitionChange) => void>();
  private _current: string | null = null;
  private running: Promise<void> | null = null;
  private queued: string | null = null;
  private _target: string | null = null;
  /** 轉場中必須在最上面的圖層（由下到上） */
  private onTop: string[] = [];

  /**
   * @param options 介面、場景管理器、資源管理器、載入頁面、轉場效果、時間、顏色等設定
   */
  constructor(private readonly options: SceneTransitionOptions) {}

  // ───────── 設定 ─────────

  /**
   * 定義一個場景
   * @param name 場景名稱
   * @param def 場景的定義：3D 場景、介面、要下載的資源、提示文字、進入離開時呼叫的函式
   */
  define(name: string, def: SceneDefinition = {}): this {
    this.defs.set(name, def);
    return this;
  }

  /**
   * 一次定義多個場景
   * @param map 場景名稱 → 定義
   */
  defineAll(map: Record<string, SceneDefinition>): this {
    for (const [name, def] of Object.entries(map)) this.define(name, def);
    return this;
  }

  /** 所有定義過的場景名稱 */
  get names(): string[] {
    return [...this.defs.keys()];
  }

  /**
   * 場景的定義（沒有時是 undefined）
   * @param name 場景名稱
   */
  info(name: string): Readonly<SceneDefinition> | undefined {
    return this.defs.get(name);
  }

  /** 目前的場景（還沒進入任何場景時是 null） */
  get current(): string | null {
    return this._current;
  }

  /** 正在進入（或最後要求進入）的場景；沒有轉場時等於 current */
  get target(): string | null {
    return this.queued ?? this._target ?? this._current;
  }

  /** 轉場中 */
  get busy(): boolean {
    return this.running !== null;
  }

  /**
   * 載入進度改變時通知，回傳取消監聽的函式
   * @param listener 進度改變時呼叫
   */
  onProgress(listener: (p: SceneTransitionProgress) => void): () => void {
    this.progressListeners.add(listener);
    return () => this.progressListeners.delete(listener);
  }

  /**
   * 開始轉場、進入場景時通知，回傳取消監聽的函式
   * @param listener 開始轉場、進入場景時呼叫
   */
  onChange(listener: (c: SceneTransitionChange) => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  // ───────── 轉場 ─────────

  /**
   * 進入場景：淡出 → 載入頁面（下載資源）→ 切換 → 淡入。
   * 轉場中再呼叫：等目前的轉場結束後進入最後要求的場景。
   * @param name 場景名稱（define 定義的）
   * @param options 淡入前要做的事（beforeReveal）
   */
  go(name: string, options: GoOptions = {}): Promise<void> {
    if (!this.defs.has(name))
      return Promise.reject(new Error(`沒有定義場景「${name}」，已定義：${this.names.join('、') || '（無）'}`));
    if (this.running) {
      this.queued = name;
      return this.running;
    }
    this._target = name;
    const run = this.run(name, options).finally(() => {
      this.running = null;
      this._target = null;
      const next = this.queued;
      this.queued = null;
      if (next && next !== this._current) void this.go(next);
    });
    this.running = run;
    return run;
  }

  private async run(name: string, options: GoOptions): Promise<void> {
    const stopGuard = this.guardTop();
    try {
      await this.steps(name, options);
    } finally {
      stopGuard();
      this.onTop = [];
    }
  }

  /**
   * 轉場中每一幀檢查：黑幕、載入頁面要在最上面。
   * 轉場中才打開的畫面（例如標題、視窗）會被加在最上層，要把轉場用的圖層移回它們上面。
   */
  private guardTop(): () => void {
    const ui = this.options.ui;
    let alive = true;
    const frame = this.frameFn();
    const check = () => {
      if (!alive) return;
      const names = ui.layerNames;
      const want = this.onTop.filter((n) => names.includes(n));
      if (want.length && names.slice(names.length - want.length).join('\u0000') !== want.join('\u0000')) {
        for (const n of want) ui.raiseLayer(n);
      }
      frame(check);
    };
    frame(check);
    return () => {
      alive = false;
    };
  }

  private frameFn(): (cb: () => void) => void {
    return (
      this.options.requestFrame ??
      (typeof requestAnimationFrame !== 'undefined'
        ? (cb: () => void) => requestAnimationFrame(cb)
        : (cb: () => void) => setTimeout(cb, 16))
    );
  }

  private async steps(name: string, options: GoOptions): Promise<void> {
    const fader = this.options.fader !== undefined ? this.options.fader : this.options.ui.screenFader;
    if (fader && this.options.effect !== 'none') await this.stepsWithFader(name, options, fader);
    else await this.stepsWithLayers(name, options);
  }

  /**
   * 有全螢幕單色層時：淡入淡出只改它的透明度（不重畫介面）。
   * 介面的變化（移除舊介面、顯示載入頁面、切換場景）都在全黑時完成，
   * 並多等幾幀讓重畫、著色器編譯在黑畫面下做完，淡入時才不會卡頓。
   */
  private async stepsWithFader(name: string, options: GoOptions, fader: ScreenFader): Promise<void> {
    const ui = this.options.ui;
    const def = this.defs.get(name)!;
    const from = this._current;
    const color = this.options.color ?? '#000';
    const fade = (a: number, b: number) => this.animate((v) => fader.set(v, color), a, b);
    this.emitChange({ type: 'start', from, to: name });
    if (!ui.root) ui.loadString('<UI/>');

    // 1. 淡出成黑色。透明的介面黑幕先擋住滑鼠（全黑後才讓它不透明，蓋住舊介面）
    const cover = ui.addLayer(LAYER_COVER, `<UI width="auto" height="auto" background="${color}" opacity="0"/>`);
    this.onTop = [LAYER_COVER];
    if (from === null) fader.set(1, color);
    else {
      await this.frames(1); // 黑幕圖層的重畫先做完，淡出才從第一幀開始平順
      await fade(0, 1);
    }
    cover.set('opacity', '1');
    if (from !== null) await this.defs.get(from)?.onExit?.();
    if (from !== null) ui.removeLayer(hudLayer(from));

    // 2. 載入頁面：在黑畫面下放好，再淡入
    const page = await this.showLoadingPage(name, def);
    this.onTop = [LAYER_COVER, LAYER_LOADING];
    await this.frames(2);
    await fade(1, 0);

    // 3. 下載資源與介面檔，更新進度
    await this.loadWithProgress(name, def, page);

    // 4. 淡出 → 切換 3D 場景、放上場景介面 → 淡入
    await fade(0, 1);
    ui.removeLayer(LAYER_LOADING);
    this.onTop = [LAYER_COVER];
    await this.enterScene(name, def, options);
    ui.removeLayer(LAYER_COVER);
    this.onTop = [];
    // 新場景第一次繪製（編譯著色器、建立陰影）與介面重畫，在黑畫面下做完
    await this.frames(3);
    this.emitChange({ type: 'enter', from, to: name });
    await fade(1, 0);
    fader.set(0);
  }

  /** 沒有全螢幕單色層時：用介面圖層淡入淡出（每幀重畫介面） */
  private async stepsWithLayers(name: string, options: GoOptions): Promise<void> {
    const ui = this.options.ui;
    const def = this.defs.get(name)!;
    const from = this._current;
    this.emitChange({ type: 'start', from, to: name });
    if (!ui.root) ui.loadString('<UI/>');

    // 1. 淡出成黑色（蓋住舊場景）
    const color = this.options.color ?? '#000';
    const cover = () => ui.addLayer(LAYER_COVER, `<UI width="auto" height="auto" background="${color}" opacity="0"/>`);
    this.onTop = [LAYER_COVER];
    // 第一次進入（遊戲剛開始）：直接全黑，不要先看到還沒準備好的畫面再淡出
    if (from === null) cover().set('opacity', '1');
    else await this.fade(cover(), 0, 1);
    if (from !== null) await this.defs.get(from)?.onExit?.();
    if (from !== null) ui.removeLayer(hudLayer(from));

    // 2. 載入頁面（在黑色上面淡入）
    const page = await this.showLoadingPage(name, def);
    page.set('opacity', '0');
    this.onTop = [LAYER_COVER, LAYER_LOADING];
    await this.fade(page, 0, 1);

    // 3. 下載資源與介面檔，更新進度
    await this.loadWithProgress(name, def, page);

    // 4. 載入頁面淡出 → 切換 3D 場景、疊上場景介面 → 淡入
    this.onTop = [LAYER_LOADING, LAYER_COVER];
    await this.fade(cover(), 0, 1); // 黑色重新加到最上層，蓋住載入頁面
    ui.removeLayer(LAYER_LOADING);
    await this.enterScene(name, def, options);
    // 場景介面加在最後，會蓋在黑色上面：黑色重新加到最上層（addLayer 同名會先移除舊的）再淡入
    const finalCover = ui.addLayer(LAYER_COVER, `<UI width="auto" height="auto" background="${color}" opacity="1"/>`);
    this.emitChange({ type: 'enter', from, to: name });
    await this.fade(finalCover, 1, 0);
    ui.removeLayer(LAYER_COVER);
  }

  /** 讀取並放上載入頁面（場景名稱、隨機提示） */
  private async showLoadingPage(name: string, def: SceneDefinition): Promise<UIElement> {
    const ui = this.options.ui;
    const loadingUrl = def.loading ?? this.options.loading ?? null;
    let loadingXml = DEFAULT_LOADING_XML;
    if (loadingUrl) {
      try {
        loadingXml = await loadUIXml(loadingUrl);
        await ui.preloadComponents(loadingXml, dirOf(loadingUrl), loadingUrl);
      } catch (error) {
        log.warn(`載入頁面 ${loadingUrl} 讀取失敗，改用內建的：${(error as Error).message}`);
        loadingXml = DEFAULT_LOADING_XML;
      }
    }
    const page = ui.addLayer(
      LAYER_LOADING,
      loadingXml,
      loadingUrl && loadingXml !== DEFAULT_LOADING_XML ? loadingUrl : undefined,
    );
    const find = <T extends UIElement>(id: string) => (page.id === id ? page : page.find(id)) as T | undefined;
    find<UILabel>('loadingTitle')?.setText(def.title ?? name);
    if (def.tips?.length) find<UILabel>('loadingTip')?.setText(def.tips[Math.floor(Math.random() * def.tips.length)]);
    return page;
  }

  /** 下載資源並更新載入頁面的進度；至少顯示 minLoadingTime 秒 */
  private async loadWithProgress(name: string, def: SceneDefinition, page: UIElement): Promise<void> {
    const find = <T extends UIElement>(id: string) => (page.id === id ? page : page.find(id)) as T | undefined;
    const started = this.now();
    await this.loadAll(name, def, (p) => {
      const bar = find<UIElement & { value: number }>('loadingBar');
      if (bar && 'value' in bar) bar.value = Math.round(p.progress * 100);
      find<UILabel>('loadingText')?.setText(`${Math.round(p.progress * 100)}%`);
      find<UILabel>('loadingItem')?.setText(p.item);
    });
    const min = (this.options.minLoadingTime ?? 0.6) * 1000;
    const left = min - (this.now() - started);
    if (left > 0) await new Promise((r) => setTimeout(r, left));
  }

  /** 切換 3D 場景、放上場景介面、onEnter、beforeReveal，等圖片讀完 */
  private async enterScene(name: string, def: SceneDefinition, options: GoOptions): Promise<void> {
    const ui = this.options.ui;
    if (def.scene !== null) this.options.scenes?.load(def.scene ?? name);
    this._current = name;
    if (def.hud) {
      try {
        const xml = await loadUIXml(def.hud);
        await ui.preloadComponents(xml, dirOf(def.hud), def.hud);
        // 放在所有圖層的最下面：開著的視窗、選單仍然在它上面
        ui.addLayer(hudLayer(name), xml, def.hud, { order: 'bottom' });
      } catch (error) {
        log.error(`場景「${name}」的介面 ${def.hud} 載入失敗：`, error);
      }
    }
    await def.onEnter?.();
    await options.beforeReveal?.();
    // 新畫面的圖片（場景介面、beforeReveal 打開的畫面）都讀完再淡入，不會一張一張跳出來
    await Promise.race([ui.whenReady(), new Promise((r) => setTimeout(r, (this.options.readyTimeout ?? 3) * 1000))]);
  }

  /** 下載場景的資源與介面檔；失敗的項目記錄警告後繼續 */
  private async loadAll(
    scene: string,
    def: SceneDefinition,
    update: (p: SceneTransitionProgress) => void,
  ): Promise<void> {
    const tasks: { label: string; run: () => Promise<unknown> }[] = [];
    const xmlTask = (url: string) => ({
      label: fileName(url),
      run: async () => {
        if (cachedUIXml(url) !== undefined) return;
        const xml = await loadUIXml(url);
        await this.options.ui.preloadComponents(xml, dirOf(url), url);
      },
    });
    for (const url of new Set([...(def.hud ? [def.hud] : []), ...(def.ui ?? [])])) tasks.push(xmlTask(url));
    const assets = this.options.assets;
    for (const item of def.assets ?? []) {
      const { url, type } = typeof item === 'string' ? { url: item, type: undefined } : item;
      if (!assets) {
        log.warn(`場景「${scene}」有資源 ${url}，但 SceneTransition 沒有設定 assets（AssetManager）`);
        continue;
      }
      tasks.push({ label: fileName(url), run: () => assets.load(url, type) });
    }
    const total = tasks.length;
    let loaded = 0;
    let failed = 0;
    const report = (item: string) => {
      const p: SceneTransitionProgress = { scene, loaded, total, failed, item, progress: total ? loaded / total : 1 };
      update(p);
      for (const l of [...this.progressListeners]) l(p);
    };
    report('');
    await Promise.all(
      tasks.map(async (t) => {
        try {
          await t.run();
        } catch (error) {
          failed++;
          log.warn(`場景「${scene}」的資源 ${t.label} 載入失敗：${(error as Error).message}`);
        }
        loaded++;
        report(t.label);
      }),
    );
  }

  // ───────── 動畫 ─────────

  private now(): number {
    return this.options.now?.() ?? (typeof performance !== 'undefined' ? performance.now() : Date.now());
  }

  /** 介面圖層的透明度動畫 */
  private fade(layer: UIElement, from: number, to: number): Promise<void> {
    return this.animate(
      (v) => layer.set('opacity', String(Math.round(v * 1000) / 1000)),
      from,
      to,
      () => layer.isDestroyed,
    );
  }

  /**
   * 數值動畫（duration 秒，前後都平順）。從第一幀開始計時：
   * 開始前那一幀如果比較久（例如剛放上新介面），不會一開始就跳一大段。
   */
  private animate(set: (v: number) => void, from: number, to: number, cancelled?: () => boolean): Promise<void> {
    const seconds = this.options.effect === 'none' ? 0 : (this.options.duration ?? 0.35);
    if (seconds <= 0) {
      set(to);
      return Promise.resolve();
    }
    const frame = this.frameFn();
    let start: number | null = null;
    set(from);
    return new Promise((resolve) => {
      const step = () => {
        if (cancelled?.()) return resolve();
        start ??= this.now();
        const t = Math.min(1, (this.now() - start) / 1000 / seconds);
        const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
        set(from + (to - from) * eased);
        if (t < 1) frame(step);
        else resolve();
      };
      frame(step);
    });
  }

  /** 等幾幀（讓重畫、著色器編譯在畫面全黑時做完） */
  private frames(n: number): Promise<void> {
    const frame = this.frameFn();
    return new Promise((resolve) => {
      const tick = (left: number) => (left <= 0 ? resolve() : frame(() => tick(left - 1)));
      tick(n);
    });
  }

  private emitChange(change: SceneTransitionChange): void {
    for (const l of [...this.changeListeners]) l(change);
  }
}
