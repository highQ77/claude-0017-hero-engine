import type { Engine, Plugin } from '../core/Engine';
import type { Phase, PhaseCallback } from '../core/Loop';
import type { EcsPlugin, ResourceKey, System, World } from '../ecs';
import { AssetsKey } from '../assets/keys';
import type { AssetLoader } from '../assets/AssetManager';
import { ShadersKey } from '../shaders/keys';
import type { EffectDefinition, ShaderDefinition } from '../shaders/ShaderLibrary';
import { registerChunk } from '../shaders/chunks';
import * as THREE from 'three';
import { uiComponents } from '../ui2d/registry';
import type { ComponentConstructor } from '../ui2d/elements';
import { ENGINE_VERSION } from '../core/version';
import type { EngineApi, EngineApiModules } from './api';
import { isValidVersion, satisfies } from './semver';
import { createLogger } from '../core/Logger';

const log = createLogger('plugins');

/**
 * 第三方套件的格式。
 * @example
 * export default define.plugin({
 *   name: 'my-studio/day-night',
 *   version: '1.0.0',
 *   engine: '^0.1.0',
 *   requires: ['ecs', 'render'],
 *   setup(ctx, options) {
 *     const { THREE } = ctx.api;
 *     ctx.addSystem({ name: 'day-night', run: (_world, time) => console.log(time.elapsed) }); // 依時間改變光線
 *   },
 * });
 */
export interface PluginPackage<O = Record<string, unknown>> {
  /** 唯一名稱，建議用「作者/名稱」 */
  name: string;
  /** 語意化版本，例如 1.2.0 */
  version: string;
  /** 說明（顯示在套件清單） */
  description?: string;
  /** 作者 */
  author?: string;
  /** 網站 */
  homepage?: string;
  /** 相容的引擎版本範圍，例如 '^0.1.0'（不寫則不檢查） */
  engine?: string;
  /** 需要先安裝的外掛或套件名稱，例如 ['ecs', 'render', 'other/package'] */
  requires?: string[];
  /** 安裝：在這裡註冊系統、元件等。透過 ctx 註冊的東西，移除時會自動撤銷 */
  setup(ctx: PluginContext, options: O): void | Promise<void>;
  /** 額外的清理（自動撤銷之外） */
  teardown?(ctx: PluginContext): void;
}

/** 型別輔助：讓編輯器提示套件的欄位 */
export function definePlugin<O = Record<string, unknown>>(pkg: PluginPackage<O>): PluginPackage<O> {
  return pkg;
}

/** 已安裝的套件資訊（plugins.list() 回傳） */
export interface InstalledPlugin {
  /** 套件名稱（例如 'engine/perf-monitor'） */
  name: string;
  /** 版本 */
  version: string;
  /** 說明 */
  description: string;
  /** 作者 */
  author: string;
  /** 來源：'local'（程式匯入）或網址 */
  source: string;
  /** 安裝的時間 */
  installedAt: Date;
}

/**
 * 套件安裝時拿到的環境。透過它註冊的東西都會被記錄，移除套件時自動撤銷。
 */
export class PluginContext {
  /** @internal 撤銷用的清單（反向執行） */
  readonly _cleanups: (() => void)[] = [];

  constructor(
    /** 引擎 */
    readonly engine: Engine,
    /** 引擎模組（PluginManager 的 api 選項提供；沒提供的模組用到時會出錯並說明要加哪個） */
    readonly api: EngineApi,
    /** 套件名稱（錯誤訊息、記錄用） */
    readonly pluginName: string,
    private readonly manager: PluginManager,
    private readonly modules: EngineApiModules = {},
  ) {}

  /** 可有可無的模組：沒提供時回傳 undefined（例如效能監視器有物理時才顯示剛體數量） */
  optionalApi<K extends keyof EngineApiModules>(name: K): EngineApiModules[K] | undefined {
    return this.modules[name];
  }

  /** ECS 世界（需要安裝 EcsPlugin） */
  get world(): World {
    const ecs = this.engine.getPlugin<EcsPlugin>('ecs');
    if (!ecs) throw new Error(`套件「${this.pluginName}」需要 EcsPlugin`);
    return ecs.world;
  }

  /** 新增系統（名稱會自動加上套件前綴，避免衝突） */
  addSystem(system: System): void {
    const ecs = this.engine.getPlugin<EcsPlugin>('ecs');
    if (!ecs) throw new Error(`套件「${this.pluginName}」需要 EcsPlugin 才能新增系統`);
    const named: System = { ...system, name: `${this.pluginName}:${system.name}` };
    // 保留 init / run / dispose 的 this
    named.init = system.init?.bind(system);
    named.run = system.run.bind(system);
    named.dispose = system.dispose?.bind(system);
    ecs.addSystem(named);
    this._cleanups.push(() => ecs.removeSystem(named.name));
  }

  /** 直接掛在主迴圈的某個階段 */
  on(phase: Phase, callback: PhaseCallback, priority = 0): void {
    this._cleanups.push(this.engine.on(phase, callback, priority));
  }

  /** 安裝一個引擎外掛（移除套件時一併移除） */
  use(plugin: Plugin): void {
    this.engine.use(plugin);
    this._cleanups.push(() => {
      if (this.engine.hasPlugin(plugin.name)) this.engine.removePlugin(plugin.name);
    });
  }

  /** 設定資源（移除套件時刪除） */
  setResource<T>(key: ResourceKey<T>, value: T): void {
    const world = this.world;
    world.setResource(key, value);
    this._cleanups.push(() => {
      if (world.getResource(key) === value) world.removeResource(key);
    });
  }

  /** 註冊資源載入器（需要 AssetPlugin）；移除時還原原本的載入器 */
  registerLoader<T>(type: string, loader: AssetLoader<T>): void {
    const assets = this.world.requireResource(AssetsKey);
    const previous = assets.getLoader(type);
    assets.registerLoader(type, loader as AssetLoader<never>);
    this._cleanups.push(() => {
      if (previous) assets.registerLoader(type, previous as AssetLoader<never>);
      else assets.unregisterLoader(type);
    });
  }

  /** 註冊 2D 介面元件，之後就能在 XML 裡使用 <tag> */
  registerUIComponent(tag: string, component: ComponentConstructor): void {
    const previous = uiComponents.get(tag);
    uiComponents.set(tag, component);
    this._cleanups.push(() => {
      if (previous) uiComponents.set(tag, previous);
      else uiComponents.delete(tag);
    });
  }

  /** 註冊自訂材質（需要 ShaderPlugin） */
  defineShader(def: ShaderDefinition): void {
    const lib = this.world.requireResource(ShadersKey);
    lib.define(def);
    this._cleanups.push(() => lib.remove(def.name));
  }

  /** 註冊全螢幕效果（需要 ShaderPlugin） */
  defineEffect(def: EffectDefinition): void {
    const lib = this.world.requireResource(ShadersKey);
    lib.defineEffect(def);
    this._cleanups.push(() => lib.remove(def.name));
  }

  /** 註冊著色器共用片段 */
  registerChunk(name: string, code: string): void {
    const chunks = THREE.ShaderChunk as Record<string, string>;
    const previous = chunks[name];
    registerChunk(name, code);
    this._cleanups.push(() => {
      if (previous === undefined) delete chunks[name];
      else chunks[name] = previous;
    });
  }

  /** 移除套件時要執行的清理 */
  onDispose(fn: () => void): void {
    this._cleanups.push(fn);
  }

  /** 取得其他已安裝的套件資訊 */
  getPackage(name: string): InstalledPlugin | undefined {
    return this.manager.get(name);
  }

  /** 印出訊息（前面加上套件名稱） */
  log(...args: unknown[]): void {
    log.info(`[${this.pluginName}]`, ...args);
  }
}

/** 從網址安裝的設定 */
export interface UrlInstallOptions<O> {
  /**
   * 內容雜湊，例如 'sha256-Base64...'。有給就會先下載並驗證，內容不符就拒絕安裝。
   * （此時套件必須是單一檔案、不能再匯入其他相對路徑的檔案）
   */
  integrity?: string;
  /** 傳給套件的設定 */
  options?: O;
}

/** PluginManager 的設定 */
export interface PluginManagerOptions {
  /**
   * 不需要雜湊驗證就能安裝的網址來源（預設只有同網域）。
   * 其他來源必須提供 integrity，避免載入被竄改的程式碼。
   */
  trustedOrigins?: string[];
  /** 自訂下載（測試用） */
  fetch?: (url: string) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;
  /** 自訂匯入模組（測試用） */
  importModule?: (url: string, code?: string) => Promise<Record<string, unknown>>;
  /**
   * 給套件使用的引擎模組（套件透過 ctx.api 取得，不用自己打包一份引擎）。
   * 全部：{ api: engineApi }；只給需要的：{ api: { ui2d, render } }（打包時只包含給的模組）。
   * 沒給的模組，套件用到時會出現錯誤訊息，告訴你要加哪一個。
   */
  api?: EngineApiModules;
}

/** 套件拿到的 ctx.api：沒有提供的模組在用到時說明要怎麼加 */
function makeApi(modules: EngineApiModules, pluginName: string): EngineApi {
  const base = { version: ENGINE_VERSION, THREE, ...modules } as Record<string, unknown>;
  return new Proxy(base, {
    get(target, key) {
      if (typeof key === 'string' && !(key in target))
        throw new Error(
          `套件「${pluginName}」用到 ctx.api.${key}，但 PluginManager 沒有提供：` +
            `new PluginManager(engine, { api: { ${key} } })（或 { api: engineApi } 提供全部模組）`,
        );
      return target[key as string];
    },
  }) as EngineApi;
}

interface Record_ {
  pkg: PluginPackage<never>;
  ctx: PluginContext;
  info: InstalledPlugin;
}

/**
 * 套件管理：安裝第三方套件（npm 匯入或網址載入）、檢查版本與相依、移除時自動撤銷。
 *
 * 注意：套件和遊戲執行在同一個環境中，可以存取所有東西。
 * 只安裝信任的套件；來自其他網域的套件請使用 integrity 驗證內容。
 */
export class PluginManager {
  private readonly installed = new Map<string, Record_>();
  private readonly listeners = new Set<() => void>();
  private readonly trustedOrigins: string[];

  constructor(
    /** 引擎 */
    readonly engine: Engine,
    private readonly options: PluginManagerOptions = {},
  ) {
    const self = typeof location !== 'undefined' ? [location.origin] : [];
    this.trustedOrigins = [...self, ...(options.trustedOrigins ?? [])];
  }

  /** 引擎版本 */
  get engineVersion(): string {
    return ENGINE_VERSION;
  }

  /** 已安裝的套件 */
  list(): InstalledPlugin[] {
    return [...this.installed.values()].map((r) => ({ ...r.info }));
  }

  /** 取得已安裝的套件資訊（沒有時是 undefined） */
  get(name: string): InstalledPlugin | undefined {
    const r = this.installed.get(name);
    return r ? { ...r.info } : undefined;
  }

  /** 是否已安裝 */
  has(name: string): boolean {
    return this.installed.has(name);
  }

  /** 套件安裝或移除時通知，回傳取消監聽的函式 */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 安裝套件（從程式匯入的套件物件） */
  async install<O>(pkg: PluginPackage<O>, options?: O, source = 'local'): Promise<InstalledPlugin> {
    this.validate(pkg);
    if (this.installed.has(pkg.name))
      throw new Error(`套件「${pkg.name}」已安裝（${this.installed.get(pkg.name)!.info.version}）`);
    if (pkg.engine && !satisfies(ENGINE_VERSION, pkg.engine)) {
      throw new Error(`套件「${pkg.name}」需要引擎版本 ${pkg.engine}，目前是 ${ENGINE_VERSION}`);
    }
    const missing = (pkg.requires ?? []).filter((r) => !this.engine.hasPlugin(r) && !this.installed.has(r));
    if (missing.length) throw new Error(`套件「${pkg.name}」需要先安裝：${missing.join('、')}`);

    const modules = this.options.api ?? {};
    const ctx = new PluginContext(this.engine, makeApi(modules, pkg.name), pkg.name, this, modules);
    try {
      await pkg.setup(ctx, (options ?? {}) as O);
    } catch (error) {
      // 安裝失敗：撤銷已註冊的東西
      this.revert(ctx);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`套件「${pkg.name}」安裝失敗：${message}`, { cause: error });
    }
    const info: InstalledPlugin = {
      name: pkg.name,
      version: pkg.version,
      description: pkg.description ?? '',
      author: pkg.author ?? '',
      source,
      installedAt: new Date(),
    };
    this.installed.set(pkg.name, { pkg: pkg as PluginPackage<never>, ctx, info });
    this.emit();
    return { ...info };
  }

  /**
   * 從網址安裝（ES 模組，預設匯出套件物件，或匯出名為 plugin 的物件）。
   * 非信任來源必須提供 integrity。
   */
  async installFromUrl<O>(url: string, opts: UrlInstallOptions<O> = {}): Promise<InstalledPlugin> {
    const absolute = this.absoluteUrl(url);
    const origin = (() => {
      try {
        return new URL(absolute).origin;
      } catch {
        return '';
      }
    })();
    const trusted = this.trustedOrigins.includes(origin) || !/^[a-z]+:\/\//i.test(absolute);
    if (!trusted && !opts.integrity) {
      throw new Error(
        `拒絕安裝「${url}」：來自非信任來源（${origin}），請提供 integrity 雜湊，或把來源加入 trustedOrigins`,
      );
    }

    let module: Record<string, unknown>;
    if (opts.integrity) {
      const fetcher = this.options.fetch ?? ((u: string) => fetch(u));
      const res = await fetcher(absolute);
      if (!res.ok) throw new Error(`下載套件失敗：${url}（HTTP ${res.status}）`);
      const code = await res.text();
      await verifyIntegrity(code, opts.integrity, url);
      module = await this.importCode(absolute, code);
    } else {
      module = await (this.options.importModule ?? ((u: string) => import(/* @vite-ignore */ u)))(absolute);
    }
    const pkg = (module.default ?? module.plugin) as PluginPackage<O> | undefined;
    if (!pkg || typeof pkg !== 'object')
      throw new Error(`「${url}」沒有匯出套件（需要 export default 或 export const plugin）`);
    return this.install(pkg, opts.options, url);
  }

  /** 移除套件：自動撤銷它註冊的所有東西 */
  uninstall(name: string): void {
    const r = this.installed.get(name);
    if (!r) return;
    const dependents = [...this.installed.values()]
      .filter((o) => o.pkg.requires?.includes(name))
      .map((o) => o.pkg.name);
    if (dependents.length) throw new Error(`無法移除「${name}」：${dependents.join('、')} 需要它`);
    try {
      r.pkg.teardown?.(r.ctx);
    } finally {
      this.revert(r.ctx);
      this.installed.delete(name);
      this.emit();
    }
  }

  /** 移除全部（依安裝的相反順序） */
  uninstallAll(): void {
    for (const name of [...this.installed.keys()].reverse()) this.uninstall(name);
  }

  // ───────── 內部 ─────────

  private validate(pkg: PluginPackage<never> | PluginPackage<unknown>): void {
    if (!pkg || typeof pkg !== 'object') throw new Error('套件格式錯誤：不是物件');
    if (typeof pkg.name !== 'string' || !/^[\w@./-]+$/.test(pkg.name))
      throw new Error(`套件名稱格式錯誤：${String(pkg.name)}`);
    if (typeof pkg.version !== 'string' || !isValidVersion(pkg.version))
      throw new Error(`套件「${pkg.name}」的版本格式錯誤：${String(pkg.version)}（需要像 1.0.0）`);
    if (typeof pkg.setup !== 'function') throw new Error(`套件「${pkg.name}」缺少 setup 函式`);
    if (pkg.requires && !Array.isArray(pkg.requires)) throw new Error(`套件「${pkg.name}」的 requires 必須是陣列`);
  }

  private revert(ctx: PluginContext): void {
    for (const fn of ctx._cleanups.splice(0).reverse()) {
      try {
        fn();
      } catch (error) {
        log.error(`撤銷套件「${ctx.pluginName}」時發生錯誤：`, error);
      }
    }
  }

  private async importCode(url: string, code: string): Promise<Record<string, unknown>> {
    if (this.options.importModule) return this.options.importModule(url, code);
    // 驗證過的內容從 Blob 匯入，確保執行的就是驗證過的那一份
    const blobUrl = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    try {
      return await import(/* @vite-ignore */ blobUrl);
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
  }

  private absoluteUrl(url: string): string {
    if (typeof location === 'undefined') return url;
    return new URL(url, location.href).href;
  }

  private emit(): void {
    for (const l of [...this.listeners]) l();
  }
}

/** 驗證內容雜湊（格式：sha256-Base64，與瀏覽器的 SRI 相同） */
export async function verifyIntegrity(code: string, integrity: string, label = ''): Promise<void> {
  const m = /^(sha256|sha384|sha512)-(.+)$/.exec(integrity.trim());
  if (!m) throw new Error(`integrity 格式錯誤：${integrity}（需要像 sha256-xxxx）`);
  const algorithm = { sha256: 'SHA-256', sha384: 'SHA-384', sha512: 'SHA-512' }[m[1] as 'sha256'];
  const digest = await crypto.subtle.digest(algorithm, new TextEncoder().encode(code));
  const actual = btoa(String.fromCharCode(...new Uint8Array(digest)));
  if (actual !== m[2]) {
    throw new Error(
      `套件內容驗證失敗${label ? `：${label}` : ''}（內容可能被竄改或已更新）\n預期：${m[2]}\n實際：${actual}`,
    );
  }
}

/** 計算內容雜湊（發布套件時用來產生 integrity） */
export async function computeIntegrity(
  code: string,
  algorithm: 'sha256' | 'sha384' | 'sha512' = 'sha256',
): Promise<string> {
  const name = { sha256: 'SHA-256', sha384: 'SHA-384', sha512: 'SHA-512' }[algorithm];
  const digest = await crypto.subtle.digest(name, new TextEncoder().encode(code));
  return `${algorithm}-${btoa(String.fromCharCode(...new Uint8Array(digest)))}`;
}
