import type { UI2D } from './UI2D';
import type { UIElement } from './elements';
import { fetchUIXml } from './xmlSources';
import { createLogger } from '../core/Logger';

const log = createLogger('ui2d');

/** 一個介面畫面的來源：網址（例如 ui/settings.xml）或直接給 XML 文字 */
export type ScreenSource = { url: string } | { xml: string };

/** 畫面的設定 */
export interface ScreenOptions {
  /** 顯示名稱（工具、除錯用） */
  title?: string;
  /** 疊加時是否擋住下面的介面（加上半透明背景，點不到下面） */
  modal?: boolean;
  /** 疊加時的背景顏色（modal 才有，預設 rgba(0,0,0,0.5)） */
  backdrop?: string;
}

interface ScreenEntry extends ScreenOptions {
  name: string;
  source: ScreenSource;
  /** 已載入的 XML 文字（快取） */
  xml: string | null;
}

/** 畫面的變化：顯示基本畫面、打開、關閉 */
export type ScreenChange = { type: 'show' | 'open' | 'close'; name: string };

/**
 * 介面畫面管理（XML 管理器）：管理多份 UI XML，並在同一個介面上切換、疊加。
 *
 * - show(名稱)：換掉整個畫面（例如 標題畫面 → 遊戲 HUD）
 * - open(名稱)：疊在最上層（例如 設定、背包、對話），可以疊好幾層
 * - close(名稱)／back()：關閉疊加的畫面（back 關最上面那一層）
 *
 * XML 裡可以直接用內建的事件處理函式：
 *   onClick="screen.back"            關閉最上層
 *   onClick="screen.close"           關閉自己所在的那一層
 *   select 以外，也可以用 onClick="screen.open:inventory"、"screen.show:title"
 *
 * @example
 * const screens = new UIScreenManager(ui)
 *   .register('hud', { url: 'ui/scene.xml' })
 *   .register('settings', { url: 'ui/settings.xml' }, { modal: true });
 * await screens.show('hud');
 * await screens.open('settings');
 */
export class UIScreenManager {
  private readonly entries = new Map<string, ScreenEntry>();
  private base: string | null = null;
  private readonly stack: string[] = [];
  private readonly listeners = new Set<(change: ScreenChange) => void>();
  private readonly fetchText: (url: string) => Promise<string>;

  constructor(
    /** 介面 */
    readonly ui: UI2D,
    options: { fetch?: (url: string) => Promise<string> } = {},
  ) {
    this.fetchText = options.fetch ?? ((url) => fetchUIXml(url));
    this.installHandlers();
  }

  /** 註冊一個畫面 */
  register(name: string, source: ScreenSource, options: ScreenOptions = {}): this {
    this.entries.set(name, { name, source, xml: 'xml' in source ? source.xml : null, ...options });
    return this;
  }

  /** 一次註冊好幾個：{ hud: 'ui/scene.xml', settings: { url: 'ui/settings.xml', modal: true } } */
  registerAll(map: Record<string, string | (ScreenOptions & ScreenSource)>): this {
    for (const [name, v] of Object.entries(map)) {
      if (typeof v === 'string') this.register(name, { url: v });
      else this.register(name, 'url' in v ? { url: v.url } : { xml: v.xml }, v);
    }
    return this;
  }

  /** 已註冊的畫面名稱 */
  get names(): string[] {
    return [...this.entries.keys()];
  }

  /** 畫面的設定（沒有註冊時是 undefined） */
  info(name: string): Readonly<ScreenOptions & { name: string; source: ScreenSource }> | undefined {
    return this.entries.get(name);
  }

  /** 目前的基本畫面 */
  get current(): string | null {
    return this.base;
  }

  /** 疊加中的畫面（由下到上） */
  get overlays(): readonly string[] {
    return this.stack;
  }

  /** 畫面是否開著 */
  isOpen(name: string): boolean {
    return this.stack.includes(name);
  }

  /** 預先載入 XML（之後切換不用等網路） */
  async preload(...names: string[]): Promise<void> {
    await Promise.all((names.length ? names : this.names).map((n) => this.xmlOf(n)));
  }

  /** 換掉整個畫面（疊加中的畫面會保留在上面） */
  async show(name: string): Promise<UIElement> {
    const xml = await this.xmlOf(name);
    const entry = this.require(name);
    const base = entry.source && 'url' in entry.source ? entry.source.url : '';
    const root = this.ui.loadString(
      xml,
      base.includes('/') ? base.slice(0, base.lastIndexOf('/') + 1) : '',
      base || undefined,
    );
    this.base = name;
    // 重新疊回原本開著的畫面
    for (const overlay of this.stack) this.mount(overlay, this.require(overlay).xml!);
    this.emit({ type: 'show', name });
    return root;
  }

  /** 疊在最上層（已經開著的話移到最上面） */
  async open(name: string): Promise<UIElement> {
    const xml = await this.xmlOf(name);
    if (!this.ui.root) throw new Error('請先用 show() 顯示一個基本畫面');
    const i = this.stack.indexOf(name);
    if (i >= 0) this.stack.splice(i, 1);
    this.stack.push(name);
    const layer = this.mount(name, xml);
    this.emit({ type: 'open', name });
    return layer;
  }

  /** 關閉疊加的畫面（不給名稱時關最上層） */
  close(name?: string): boolean {
    const target = name ?? this.stack[this.stack.length - 1];
    if (!target) return false;
    const i = this.stack.indexOf(target);
    if (i < 0) return false;
    this.stack.splice(i, 1);
    this.ui.removeLayer(target);
    this.emit({ type: 'close', name: target });
    return true;
  }

  /** 關閉最上層；沒有疊加畫面時回傳 false（遊戲可以用來決定按 Esc 要不要開選單） */
  back(): boolean {
    return this.close();
  }

  /** 開／關切換 */
  async toggle(name: string): Promise<void> {
    if (this.isOpen(name)) this.close(name);
    else await this.open(name);
  }

  /** 關閉所有疊在上面的畫面 */
  closeAll(): void {
    for (const name of [...this.stack].reverse()) this.close(name);
  }

  /** 畫面打開、關閉時通知，回傳取消監聽的函式 */
  onChange(listener: (change: ScreenChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ───────── 內部 ─────────

  private require(name: string): ScreenEntry {
    const e = this.entries.get(name);
    if (!e) throw new Error(`沒有註冊畫面「${name}」，已註冊：${this.names.join('、') || '（無）'}`);
    return e;
  }

  private async xmlOf(name: string): Promise<string> {
    const e = this.require(name);
    if (e.xml === null) {
      const url = (e.source as { url: string }).url;
      const xml = await this.fetchText(url);
      // <UIComponent src> 內嵌的檔案也先讀好：切換畫面後裡面的元件馬上就在
      await this.ui.preloadComponents(xml, url.includes('/') ? url.slice(0, url.lastIndexOf('/') + 1) : '', url);
      e.xml = xml;
    }
    return e.xml;
  }

  private mount(name: string, xml: string): UIElement {
    const entry = this.require(name);
    const layer = this.ui.addLayer(name, xml, 'url' in entry.source ? entry.source.url : undefined);
    if (entry.modal) {
      // 擋住下面的介面：半透明背景（有背景就會攔截點擊），內容置中
      layer.raw.background ??= entry.backdrop ?? 'rgba(0,0,0,0.5)';
      layer.raw.align ??= 'center';
      layer.raw.justify ??= 'center';
      layer.walk((e) => e.resolve());
      this.ui.requestLayout(true);
    }
    layer.raw['data-screen'] = name;
    return layer;
  }

  /** 找出元件所在的疊加畫面 */
  screenOf(el: UIElement): string | null {
    for (let e: UIElement | null = el; e; e = e.parent) {
      const s = e.raw['data-screen'];
      if (s) return s;
    }
    return null;
  }

  private emit(change: ScreenChange): void {
    for (const l of [...this.listeners]) l(change);
  }

  /** 內建的事件處理函式：screen.back、screen.close、screen.open:名稱、screen.show:名稱 */
  private installHandlers(): void {
    const ui = this.ui;
    ui.setHandler('screen.back', () => void this.back());
    ui.setHandler('screen.close', (e) => void this.close(this.screenOf(e.target) ?? undefined));
    const fallback = Object.getPrototypeOf(ui.handlers) as object;
    // screen.open:xxx、screen.show:xxx、screen.toggle:xxx 用查找處理（名稱任意）
    const lookup = new Proxy(fallback, {
      get: (target, key, receiver) => {
        if (typeof key === 'string') {
          const m = /^screen\.(open|show|toggle|close):(.+)$/.exec(key);
          if (m) {
            const [, action, name] = m;
            return () => {
              if (action === 'close') this.close(name);
              else void this[action as 'open' | 'show' | 'toggle'](name).catch((err) => log.error(err));
            };
          }
        }
        return Reflect.get(target, key, receiver);
      },
      has: (target, key) =>
        (typeof key === 'string' && /^screen\.(open|show|toggle|close):/.test(key)) || Reflect.has(target, key),
    });
    Object.setPrototypeOf(ui.handlers, lookup);
  }
}
