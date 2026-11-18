/**
 * 3D 場景編輯器的 UI 層：把場景檔 ui 欄位列出的介面檔（public/ui 的 XML）疊在 3D 畫面上預覽，和遊戲裡看到的一樣。
 *
 * - 第一個介面檔是底層（ui.loadString），後面的依序疊上去（ui.addLayer）
 * - 只顯示、不能點（UIPlugin.interactive = false）：點擊照常穿透到 3D 畫面選取物件
 * - 和 UI 編輯器同步（同一個瀏覽器，訊息格式見 ../ui-sync.ts）：UI 編輯器每次修改都會送出目前的內容（還沒存檔也會），
 *   這裡收到後用 setUIXmlOverride 取代檔案內容，再重新載入 UI 層與 3D 介面面板（UIPanel3D）；
 *   UI 編輯器存檔或捨棄修改後取消取代，改回讀磁碟上的檔案
 */
import type { Engine } from '../../core';
import type { RenderPlugin } from '../../render';
import { UIPlugin } from '../../ui2d';
import { clearUIXmlCache, fetchUIXml, setUIXmlOverride } from '../../ui2d/xmlSources';
import { openUISyncChannel, uiUrl, type UISyncMessage } from '../ui-sync';

export interface UILayerEvents {
  /** 載入失敗或成功（error 為 null） */
  onStatus(error: string | null): void;
  /** UI 編輯器改了介面檔（UI 層或 3D 面板要重新載入時；name 是遊戲裡的網址） */
  onExternalChange?(url: string): void;
}

export class UILayer {
  private plugin: UIPlugin | null = null;
  private creating: Promise<UIPlugin> | null = null;
  private files: string[] = [];
  private _visible = true;
  /** 重新載入的序號：較舊的載入結果直接丟掉 */
  private token = 0;
  private timer = 0;
  private readonly channel: BroadcastChannel | null;

  constructor(
    private readonly engine: Engine,
    private readonly events: UILayerEvents,
  ) {
    this.channel = openUISyncChannel((msg) => this.onMessage(msg));
    // 已經開著的 UI 編輯器：請它送出還沒存檔的內容
    this.channel?.postMessage({ type: 'request' } satisfies UISyncMessage);
  }

  /** 目前顯示的介面檔（遊戲裡的網址） */
  get current(): readonly string[] {
    return this.files;
  }

  get visible(): boolean {
    return this._visible;
  }

  /** 顯示或隱藏 UI 層 */
  set visible(v: boolean) {
    if (v === this._visible) return;
    this._visible = v;
    void this.reload();
  }

  /** 設定要顯示的介面檔（和目前一樣時不做事） */
  setFiles(files: readonly string[]): void {
    if (files.length === this.files.length && files.every((f, i) => f === this.files[i])) return;
    this.files = [...files];
    void this.reload();
  }

  private async ensurePlugin(): Promise<UIPlugin> {
    if (this.plugin) return this.plugin;
    this.creating ??= UIPlugin.create().then((plugin) => {
      plugin.interactive = false;
      this.engine.use(plugin);
      this.plugin = plugin;
      return plugin;
    });
    return this.creating;
  }

  /** 重新載入（介面檔或內容改了） */
  async reload(): Promise<void> {
    const token = ++this.token;
    const files = this._visible ? this.files : [];
    if (!files.length) {
      this.plugin?.ui.clear();
      this.redraw();
      this.events.onStatus(null);
      return;
    }
    try {
      const plugin = await this.ensurePlugin();
      // 內嵌（UIComponent、UIImport）的檔案也要重新讀
      clearUIXmlCache();
      const texts = await Promise.all(files.map((f) => fetchUIXml(f, { cache: 'no-store' })));
      if (token !== this.token) return;
      const ui = plugin.ui;
      const base = (url: string) => (url.includes('/') ? url.slice(0, url.lastIndexOf('/') + 1) : '');
      await Promise.all(texts.map((t, i) => ui.preloadComponents(t, base(files[i]), files[i])));
      if (token !== this.token) return;
      ui.loadString(texts[0], base(files[0]), files[0]);
      for (let i = 1; i < files.length; i++) ui.addLayer(`scene-ui-${i}`, texts[i], files[i]);
      await ui.whenReady();
      if (token !== this.token) return;
      this.redraw();
      this.events.onStatus(null);
    } catch (error) {
      if (token !== this.token) return;
      this.plugin?.ui.clear();
      this.redraw();
      this.events.onStatus((error as Error).message);
    }
  }

  /** 引擎在跑時會自己畫；保險起見補畫一次 */
  private redraw(): void {
    const render = this.engine.getPlugin<RenderPlugin>('render');
    if (render && render.engineState !== 'running') render.draw();
  }

  /** UI 編輯器的訊息：更新內容後延遲一下再重新載入（連續打字時只載入一次） */
  private onMessage(msg: UISyncMessage): void {
    if (msg.type === 'request' || typeof msg.name !== 'string') return;
    const url = uiUrl(msg.name);
    if (msg.type === 'draft' && typeof msg.text === 'string') setUIXmlOverride(url, msg.text);
    else if (msg.type === 'saved') setUIXmlOverride(url, null);
    else return;
    // UI 層與 3D 介面面板一起延遲重新載入：連續打字時只載入一次，面板不會一直閃
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.events.onExternalChange?.(url);
      void this.reload();
    }, 200);
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.channel?.close();
    if (this.plugin && this.engine.getPlugin('ui2d')) this.engine.removePlugin('ui2d');
    this.plugin = null;
  }
}
