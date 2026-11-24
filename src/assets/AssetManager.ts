import type { AssetTypeMap } from './types';

/**
 * 載入器：負責某一類資源的載入與釋放。
 * 可以用 registerLoader() 自行擴充，或覆蓋內建的載入器。
 */
export interface AssetLoader<T = unknown> {
  /** 對應的副檔名（含點，小寫），例如 ['.png', '.jpg']；可用多段副檔名如 '.typeface.json' */
  readonly extensions: readonly string[];
  /**
   * 載入一個資源
   * @param url 資源網址
   * @param manager 資源管理器（載入其他資源用）
   */
  load(url: string, manager: AssetManager): Promise<T>;
  /**
   * 參考計數歸零時呼叫
   * @param asset 要釋放的資源
   */
  dispose?(asset: T): void;
}

/** 資源種類：texture、audio、gltf、json、text…，也可以是自己註冊的載入器 */
export type AssetType = keyof AssetTypeMap | (string & {});
type AssetOf<K> = K extends keyof AssetTypeMap ? AssetTypeMap[K] : unknown;

type EntryState = 'loading' | 'loaded';

interface Entry {
  key: string;
  url: string;
  type: string;
  refs: number;
  state: EntryState;
  promise: Promise<unknown>;
  asset?: unknown;
}

/** 載入進度 */
export interface AssetProgress {
  /** 本批次已完成（含失敗）的數量 */
  loaded: number;
  /** 本批次總數 */
  total: number;
  /** 本批次失敗的數量 */
  failed: number;
}

/** 載入進度的監聽函式 */
export type ProgressListener = (progress: AssetProgress, url: string) => void;

/** AssetManager 的設定 */
export interface AssetManagerOptions {
  /** 相對路徑的前綴，例如 '/assets/' */
  baseUrl?: string;
}

/**
 * 資源管理：統一載入、快取、參考計數與釋放。
 *
 * - 同一個網址同時載入多次，只會真正下載一次
 * - 每次 load() 參考計數加一，release() 減一，歸零時自動釋放（例如 GPU 記憶體）
 * - 載入失敗不會留在快取裡，之後可以重試
 */
export class AssetManager {
  /** 相對網址的基準（例如 '/assets/'） */
  baseUrl: string;
  private readonly loaders = new Map<string, AssetLoader<unknown>>();
  private readonly entries = new Map<string, Entry>();
  private readonly progressListeners = new Set<ProgressListener>();
  private idleResolvers: (() => void)[] = [];
  private batch: AssetProgress = { loaded: 0, total: 0, failed: 0 };

  /**
   * @param options 網址前綴（baseUrl）等設定
   */
  constructor(options: AssetManagerOptions = {}) {
    this.baseUrl = options.baseUrl ?? '';
  }

  // ───────── 載入器 ─────────

  /**
   * 註冊或覆蓋某類型的載入器
   * @param type 資源類型名稱（例如 'texture'、'gltf'）
   * @param loader 載入器
   */
  registerLoader<K extends AssetType>(type: K, loader: AssetLoader<AssetOf<K>>): this {
    this.loaders.set(type, loader);
    return this;
  }

  /**
   * 是否有這種資源的載入器
   * @param type 資源類型名稱
   */
  hasLoader(type: string): boolean {
    return this.loaders.has(type);
  }

  /**
   * 取得載入器
   * @param type 資源類型名稱
   */
  getLoader(type: string): AssetLoader<unknown> | undefined {
    return this.loaders.get(type);
  }

  /**
   * 移除載入器
   * @param type 資源類型名稱
   */
  unregisterLoader(type: string): boolean {
    return this.loaders.delete(type);
  }

  /**
   * 依副檔名判斷資源類型（多段副檔名優先，例如 .typeface.json 優先於 .json）
   * @param url 資源網址
   */
  resolveType(url: string): string {
    const path = url.split(/[?#]/)[0].toLowerCase();
    let best: string | null = null;
    let bestLength = 0;
    for (const [type, loader] of this.loaders) {
      for (const ext of loader.extensions) {
        if (ext.length > bestLength && path.endsWith(ext)) {
          best = type;
          bestLength = ext.length;
        }
      }
    }
    if (best === null) throw new Error(`無法判斷資源類型：${url}（請指定 type 參數）`);
    return best;
  }

  /**
   * 把相對網址換成完整網址（依 baseUrl）
   * @param url 相對或完整的網址
   */
  resolveUrl(url: string): string {
    if (!this.baseUrl || /^([a-z][a-z\d+.-]*:|\/\/|\/)/i.test(url)) return url;
    return this.baseUrl.replace(/\/?$/, '/') + url;
  }

  // ───────── 載入與釋放 ─────────

  /**
   * 載入資源，參考計數加一。用完請呼叫 release()。
   * @param url 資源網址
   * @param type 資源類型；省略時依副檔名判斷
   * @example
   * const gltf = await assets.load('models/hero.glb');
   * const tex = await assets.load('textures/wall.png', 'texture');
   */
  load<K extends AssetType>(url: string, type?: K): Promise<AssetOf<K>> {
    const entry = this.acquire(url, type);
    return entry.promise as Promise<AssetOf<K>>;
  }

  /**
   * 取得已載入完成的資源（不改變參考計數），尚未載入完成時回傳 undefined
   * @param url 資源網址
   * @param type 資源類型；省略時依副檔名判斷
   */
  get<K extends AssetType>(url: string, type?: K): AssetOf<K> | undefined {
    const entry = this.entries.get(this.keyOf(url, type));
    return entry?.state === 'loaded' ? (entry.asset as AssetOf<K>) : undefined;
  }

  /**
   * 是否已經載入完成
   * @param url 資源網址
   * @param type 資源類型；省略時依副檔名判斷
   */
  isLoaded(url: string, type?: AssetType): boolean {
    return this.entries.get(this.keyOf(url, type))?.state === 'loaded';
  }

  /**
   * 被引用的次數（release 會減少，0 時釋放）
   * @param url 資源網址
   * @param type 資源類型；省略時依副檔名判斷
   */
  refCount(url: string, type?: AssetType): number {
    return this.entries.get(this.keyOf(url, type))?.refs ?? 0;
  }

  /**
   * 參考計數減一；歸零時釋放（若還在載入，會在載入完成後釋放）
   * @param url 資源網址
   * @param type 資源類型；省略時依副檔名判斷
   */
  release(url: string, type?: AssetType): void {
    const entry = this.entries.get(this.keyOf(url, type));
    if (!entry || entry.refs === 0) return;
    entry.refs--;
    if (entry.refs === 0 && entry.state === 'loaded') this.disposeEntry(entry);
  }

  /**
   * 一次載入多個資源（每個參考計數加一）。任一失敗則整體失敗。
   * @param items 網址，或 { url, type }
   */
  async preload(items: readonly (string | { url: string; type?: AssetType })[]): Promise<void> {
    await Promise.all(
      items.map((item) => (typeof item === 'string' ? this.load(item) : this.load(item.url, item.type))),
    );
  }

  /** 建立群組：記錄群組內載入的資源，之後一次釋放（適合在場景 teardown 時使用） */
  group(): AssetGroup {
    return new AssetGroup(this);
  }

  /** 強制釋放全部資源（不論參考計數） */
  disposeAll(): void {
    for (const entry of [...this.entries.values()]) {
      entry.refs = 0;
      if (entry.state === 'loaded') this.disposeEntry(entry);
    }
    this.entries.clear();
  }

  // ───────── 進度 ─────────

  /** 目前的整體載入進度 */
  get progress(): Readonly<AssetProgress> {
    return this.batch;
  }

  /** 是否還有資源在載入 */
  get loading(): boolean {
    return this.batch.total > this.batch.loaded;
  }

  /**
   * 監聽載入進度（每個資源完成或失敗時觸發）
   * @param listener 進度改變時呼叫（已完成、總數）
   */
  onProgress(listener: ProgressListener): () => void {
    this.progressListeners.add(listener);
    return () => this.progressListeners.delete(listener);
  }

  /** 等到目前所有載入都結束（不論成功或失敗） */
  whenIdle(): Promise<void> {
    if (!this.loading) return Promise.resolve();
    return new Promise((resolve) => this.idleResolvers.push(resolve));
  }

  // ───────── 內部 ─────────

  private keyOf(url: string, type?: AssetType): string {
    return `${type ?? this.resolveType(url)}:${this.resolveUrl(url)}`;
  }

  private acquire(url: string, type?: AssetType): Entry {
    const resolvedType = type ?? this.resolveType(url);
    const resolvedUrl = this.resolveUrl(url);
    const key = `${resolvedType}:${resolvedUrl}`;
    const existing = this.entries.get(key);
    if (existing) {
      existing.refs++;
      return existing;
    }

    const loader = this.loaders.get(resolvedType);
    if (!loader) throw new Error(`沒有「${resolvedType}」類型的載入器`);

    this.batch.total++;
    const entry: Entry = { key, url: resolvedUrl, type: resolvedType, refs: 1, state: 'loading', promise: null! };
    entry.promise = Promise.resolve()
      .then(() => loader.load(resolvedUrl, this))
      .then(
        (asset) => {
          entry.asset = asset;
          entry.state = 'loaded';
          this.settle(resolvedUrl, false);
          // 載入期間已全部 release → 立刻釋放
          if (entry.refs === 0) this.disposeEntry(entry);
          return asset;
        },
        (error: unknown) => {
          if (this.entries.get(key) === entry) this.entries.delete(key);
          this.settle(resolvedUrl, true);
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(`載入失敗：${resolvedUrl}（${message}）`, { cause: error });
        },
      );
    this.entries.set(key, entry);
    return entry;
  }

  private settle(url: string, failed: boolean): void {
    this.batch.loaded++;
    if (failed) this.batch.failed++;
    const snapshot = { ...this.batch };
    for (const listener of [...this.progressListeners]) listener(snapshot, url);
    if (this.batch.loaded >= this.batch.total) {
      this.batch = { loaded: 0, total: 0, failed: 0 };
      const resolvers = this.idleResolvers;
      this.idleResolvers = [];
      for (const resolve of resolvers) resolve();
    }
  }

  private disposeEntry(entry: Entry): void {
    if (this.entries.get(entry.key) === entry) this.entries.delete(entry.key);
    this.loaders.get(entry.type)?.dispose?.(entry.asset);
    entry.asset = undefined;
  }
}

/**
 * 資源群組：記錄透過它載入的資源，releaseAll() 時一次釋放。
 */
export class AssetGroup {
  private readonly items: { url: string; type?: AssetType }[] = [];

  /**
   * @param manager 資源管理器
   */
  constructor(private readonly manager: AssetManager) {}

  /**
   * 載入資源（群組會記住，releaseAll 一起釋放）
   * @param url 資源網址
   * @param type 資源類型；省略時依副檔名判斷
   */
  load<K extends AssetType>(url: string, type?: K): Promise<AssetOf<K>> {
    const promise = this.manager.load(url, type);
    this.items.push({ url, type });
    return promise;
  }

  /** 釋放這個群組載入的所有資源 */
  releaseAll(): void {
    for (const { url, type } of this.items.splice(0)) this.manager.release(url, type);
  }
}
