/**
 * 場景檔：描述一個場景的實體、父子關係與元件資料（3D 場景編輯器存的就是這種檔案）。
 * 可以寫成 JSON（下面的例子）或 XML（寫法見 SceneXml.ts，3D 場景編輯器預設存成 XML）；兩種內容完全相同，
 * parseSceneFile、load.sceneFile 會自動判斷。
 *
 *   {
 *     "format": "hero-scene",
 *     "version": 1,
 *     "entities": [
 *       { "id": "cam", "name": "攝影機", "components": { "Transform": { "position": [0, 2, 6] }, "Camera": { "fov": 50 } } },
 *       { "id": "box", "name": "箱子", "parent": "root", "components": { "MeshRenderer": { "geometry": { "box": 1 } } } }
 *     ]
 *   }
 *
 * - id：檔案裡的編號（同一個檔案裡不能重複），parent 用它指定父節點
 * - name：實體名稱（Name 元件），可以用 scripts.find('箱子') 找到
 * - components：元件名稱 → 資料。每種元件怎麼存、怎麼讀由「元件存讀規則」（ComponentCodec）決定，
 *   Transform 由場景外掛提供，MeshRenderer、Camera、Light 由繪製外掛提供；其他外掛可以自己登記。
 *   檔案裡出現沒有登記的元件時只會警告並略過（例如沒有安裝那個外掛）。
 * - 角度一律用「度」（Transform 的 rotation、Light 的 angle）；幾何描述裡的 rotation 照舊是弧度。
 */
import { Color, Euler, Quaternion, Vector3 } from 'three';
import type { ComponentType } from '../ecs/Component';
import type { Entity } from '../ecs/Entity';
import type { World } from '../ecs/World';
import { Hierarchy, Parent } from './Hierarchy';
import { HierarchyKey, SceneCodecsKey } from './keys';
import { Name } from './Name';
import { looksLikeXml, sceneXmlToData } from './SceneXml';
import type { Scene, SceneManager } from './SceneManager';
import { Transform, type TransformData } from './Transform';
import { createLogger } from '../core/Logger';
import { readPackedFile } from '../core/packedFiles';
import { isObject } from './json';

const log = createLogger('scene');

export { SceneCodecsKey } from './keys';

/** 場景檔的格式名稱 */
export const SCENE_FILE_FORMAT = 'hero-scene';
/** 目前的場景檔版本 */
export const SCENE_FILE_VERSION = 1;

/** 場景檔裡的一個實體 */
export interface SceneFileEntity {
  /** 檔案裡的編號（不能重複） */
  id: string;
  /** 實體名稱（Name 元件） */
  name?: string;
  /** 父節點的 id */
  parent?: string;
  /** 元件名稱 → 資料（預製物件的實例：覆蓋預製物件根節點的同名元件，例如 Transform） */
  components?: Record<string, unknown>;
  /** 預製物件的路徑（例如 'prefabs/tree.json'）：載入時展開成預製物件的內容 */
  prefab?: string;
  /**
   * 預製物件實例：覆蓋預製物件裡面的實體（鍵是預製物件裡的 id，巢狀時是「a/leaf」）。
   * components 裡的元件整個取代預製物件裡的同名元件；null 代表移除那個元件。
   */
  overrides?: Record<string, PrefabOverride>;
}

/** 預製物件內部實體的覆蓋 */
export interface PrefabOverride {
  /** 改名 */
  name?: string;
  /** 元件名稱 → 資料（整個取代）；null 代表移除 */
  components?: Record<string, unknown>;
}

/** 場景檔的內容 */
export interface SceneFileData {
  /** 固定是 "hero-scene" */
  format: typeof SCENE_FILE_FORMAT;
  /** 檔案版本（目前是 1） */
  version: number;
  /** 實體（父節點不必排在子節點前面） */
  entities: SceneFileEntity[];
  /**
   * 用到的預製物件內容（路徑 → 預製物件檔），load.sceneFile 會自動下載填入；存檔時不會寫出。
   * 自己組資料時要自己填（或用 sceneFile.prefabPaths 找出需要哪些）。
   */
  prefabs?: Record<string, SceneFileData>;
  /**
   * 場景設定（不是實體的東西）：background、fog、postfx、navGrid…。
   * 每個鍵由安裝的外掛處理（registerSetting），載入場景時套用、卸載時恢復。預製物件檔裡的 settings 不會用到。
   */
  settings?: Record<string, unknown>;
  /**
   * 這個場景搭配的介面檔（相對於 public，例如 ['ui/scene.xml', 'ui/forest/hud.xml']）：
   * 3D 場景編輯器把它們疊在畫面上預覽（第一個是底層，後面的依序疊上去）。
   * 只是給編輯器看的資訊，遊戲不會自動載入（遊戲照常用 UIScreenManager、SceneTransition 或 ui.load 載入介面）。
   */
  ui?: string[];
}

/** 讀檔時給存讀規則的資訊（錯誤、警告訊息用） */
export interface CodecContext {
  /** 目前的實體 id */
  readonly entity: string;
  /** 目前的元件名稱 */
  readonly component: string;
  /**
   * 記錄警告（不會中斷讀檔）
   * @param message 警告訊息
   */
  warn(message: string): void;
}

/**
 * 元件存讀規則：元件資料和場景檔資料（JSON）之間怎麼轉換。
 * 檔案裡用 type.name 當作元件名稱。
 */
export interface ComponentCodec<T> {
  /** 元件類型（檔案裡的元件名稱是 type.name） */
  readonly type: ComponentType<T>;
  /**
   * 檔案資料 → 元件初始值（格式錯誤時拋出錯誤，訊息會加上實體與元件名稱）
   * @param data 場景檔裡這個元件的資料
   * @param ctx 讀到哪個實體、哪個元件，以及記錄警告的函式
   */
  read(data: unknown, ctx: CodecContext): Partial<T>;
  /**
   * 元件 → 檔案資料（要能轉成 JSON）。回傳 undefined 代表這個元件不能存
   * （例如網格用的是程式建立的 three.js 物件），存檔時會略過並警告。
   * @param value 元件的資料
   */
  write(value: T): unknown;
}

/** 讀寫設定時的資訊 */
export interface SettingContext {
  /** 場景所在的 world */
  readonly world: World;
  /**
   * 記錄警告（不會中斷）
   * @param message 警告訊息
   */
  warn(message: string): void;
}

/**
 * 場景設定的處理方式：場景檔 settings 裡的一個鍵（例如 background、fog、postfx、navGrid）。
 * 載入場景時呼叫 apply，回傳的函式在卸載場景時呼叫（恢復原本的狀態）。
 */
export interface SceneSettingHandler {
  /** settings 裡的鍵 */
  readonly key: string;
  /**
   * 套用設定（格式錯誤時拋出錯誤）；回傳恢復原狀的函式
   * @param value 場景檔裡這個設定的值
   * @param ctx ECS 世界、記錄警告的函式
   */
  apply(value: unknown, ctx: SettingContext): (() => void) | undefined;
}

/** 已登記的元件存讀規則與場景設定（場景外掛建立，放在 world 的資源 SceneCodecsKey） */
export class SceneCodecs {
  private readonly settingsByKey = new Map<string, SceneSettingHandler[]>();

  /**
   * 登記場景設定的處理方式；同一個鍵後登記的優先，取消後恢復前一個
   * @param handler 設定的鍵與套用的函式
   */
  registerSetting(handler: SceneSettingHandler): () => void {
    const list = this.settingsByKey.get(handler.key) ?? [];
    list.push(handler);
    this.settingsByKey.set(handler.key, list);
    return () => {
      const l = this.settingsByKey.get(handler.key);
      const i = l?.indexOf(handler) ?? -1;
      if (!l || i === -1) return;
      l.splice(i, 1);
      if (l.length === 0) this.settingsByKey.delete(handler.key);
    };
  }

  /**
   * 依鍵取得場景設定的處理方式
   * @param key 設定的鍵（例如 'postfx'）
   */
  setting(key: string): SceneSettingHandler | undefined {
    return this.settingsByKey.get(key)?.at(-1);
  }

  /** 所有已登記的場景設定鍵 */
  settingKeys(): string[] {
    return [...this.settingsByKey.keys()];
  }

  /** 同一個元件可以登記多次：用最後登記的；取消登記時恢復前一個 */
  private readonly byName = new Map<string, { codec: ComponentCodec<unknown> }[]>();

  /**
   * 登記存讀規則；同名的會暫時取代。回傳取消登記的函式（取消後恢復前一個）
   * @param codec 元件的存讀規則
   */
  register<T>(codec: ComponentCodec<T>): () => void {
    const entry = { codec: codec as ComponentCodec<unknown> };
    const name = codec.type.name;
    const stack = this.byName.get(name) ?? [];
    stack.push(entry);
    this.byName.set(name, stack);
    return () => {
      const list = this.byName.get(name);
      const i = list?.indexOf(entry) ?? -1;
      if (!list || i === -1) return;
      list.splice(i, 1);
      if (list.length === 0) this.byName.delete(name);
    };
  }

  /**
   * 依元件名稱取得存讀規則
   * @param name 元件名稱
   */
  get(name: string): ComponentCodec<unknown> | undefined {
    return this.byName.get(name)?.at(-1)?.codec;
  }

  /** 所有已登記的存讀規則（依第一次登記的順序） */
  all(): ComponentCodec<unknown>[] {
    return [...this.byName.values()].map((list) => list.at(-1)!.codec);
  }
}

/**
 * 外掛安裝時登記自己的場景設定（有安裝場景外掛時才登記）。回傳取消登記的函式
 * @param world ECS 世界
 * @param handlers 場景設定的處理方式
 */
export function registerSceneSettings(world: World, handlers: readonly SceneSettingHandler[]): () => void {
  const registry = world.getResource(SceneCodecsKey);
  if (!registry) return () => {};
  const offs = handlers.map((h) => registry.registerSetting(h));
  return () => {
    for (const off of offs) off();
  };
}

/**
 * 套用場景設定。回傳恢復原狀的函式（依相反順序恢復）與警告（沒有處理方式的鍵）。
 * 設定格式錯誤時拋出錯誤（已套用的會先恢復）。
 * @param world ECS 世界
 * @param settings 場景檔的 settings
 * @param codecs 存讀規則（裡面有場景設定的處理方式）
 */
export function applySceneSettings(
  world: World,
  settings: Record<string, unknown> | undefined,
  codecs?: SceneCodecs,
): { undo: () => void; warnings: string[] } {
  const registry = codecs ?? world.getResource(SceneCodecsKey);
  const warnings: string[] = [];
  const undos: (() => void)[] = [];
  const undo = () => {
    for (const fn of undos.splice(0).reverse()) fn();
  };
  for (const [key, value] of Object.entries(settings ?? {})) {
    const handler = registry?.setting(key);
    if (!handler) {
      warnings.push(`場景設定「${key}」沒有對應的外掛（是不是沒有安裝？），已略過`);
      continue;
    }
    try {
      const fn = handler.apply(value, { world, warn: (m) => warnings.push(`場景設定 ${key}：${m}`) });
      if (fn) undos.push(fn);
    } catch (error) {
      undo();
      throw new Error(`場景設定 ${key}：${(error as Error).message}`);
    }
  }
  return { undo, warnings };
}

/**
 * 外掛安裝時登記自己元件的存讀規則（有安裝場景外掛時才登記）。回傳取消登記的函式（解除安裝時呼叫）。
 * @param world ECS 世界
 * @param codecs 元件的存讀規則
 */
export function registerSceneCodecs(world: World, codecs: readonly ComponentCodec<never>[]): () => void {
  const registry = world.getResource(SceneCodecsKey);
  if (!registry) return () => {};
  const offs = codecs.map((c) => registry.register(c as ComponentCodec<unknown>));
  return () => {
    for (const off of offs) off();
  };
}

// ───────── 檢查格式 ─────────

/**
 * 讀取 [x, y, z]（三個有限的數字）
 * @param v 檔案裡的值
 * @param field 欄位名稱（錯誤訊息用）
 */
export function readVec3(v: unknown, field: string): [number, number, number] {
  if (!Array.isArray(v) || v.length !== 3 || !v.every((n) => typeof n === 'number' && Number.isFinite(n)))
    throw new Error(`${field} 要是三個數字 [x, y, z]，收到 ${JSON.stringify(v)}`);
  return [v[0], v[1], v[2]];
}

/**
 * 去掉 -0 與浮點誤差（存檔時讓數字好讀，例如 0.30000000000000004 → 0.3）
 * @param n 數字
 */
export function tidy(n: number): number {
  const r = Math.round(n * 1e6) / 1e6;
  return r === 0 ? 0 : r;
}

/**
 * 檢查並轉換場景檔內容（JSON 或 XML 文字，或已解析的物件）。格式錯誤時拋出錯誤，說明是哪個實體、哪個欄位。
 * @param input JSON 或 XML 文字，或已解析的物件
 */
export function parseSceneFile(input: string | unknown): SceneFileData {
  let data: unknown = input;
  if (typeof input === 'string' && looksLikeXml(input)) {
    try {
      data = sceneXmlToData(input);
    } catch (error) {
      throw new Error(`場景檔不是正確的 XML：${(error as Error).message}`);
    }
  } else if (typeof input === 'string') {
    try {
      data = JSON.parse(input);
    } catch (error) {
      throw new Error(`場景檔不是正確的 JSON：${(error as Error).message}`);
    }
  }
  if (!isObject(data)) throw new Error('場景檔要是一個物件 { format, version, entities }');
  if (data.format !== SCENE_FILE_FORMAT)
    throw new Error(`這不是場景檔：format 要是 "${SCENE_FILE_FORMAT}"，收到 ${JSON.stringify(data.format)}`);
  if (typeof data.version !== 'number') throw new Error('場景檔缺少 version（版本號）');
  if (data.version > SCENE_FILE_VERSION)
    throw new Error(`場景檔版本 ${data.version} 比引擎支援的 ${SCENE_FILE_VERSION} 新，請更新引擎`);
  if (!Array.isArray(data.entities)) throw new Error('場景檔的 entities 要是陣列');

  const ids = new Set<string>();
  const entities: SceneFileEntity[] = data.entities.map((raw, i) => {
    if (!isObject(raw)) throw new Error(`entities[${i}] 要是物件`);
    const { id, name, parent, components, prefab, overrides } = raw;
    if (typeof id !== 'string' || id === '') throw new Error(`entities[${i}] 缺少 id（文字）`);
    if (id.includes('/')) throw new Error(`實體 id「${id}」不能有 /（展開預製物件時用來分隔）`);
    if (ids.has(id)) throw new Error(`實體 id「${id}」重複`);
    ids.add(id);
    if (name !== undefined && typeof name !== 'string') throw new Error(`實體「${id}」的 name 要是文字`);
    if (parent !== undefined && typeof parent !== 'string')
      throw new Error(`實體「${id}」的 parent 要是文字（父節點的 id）`);
    if (components !== undefined && !isObject(components))
      throw new Error(`實體「${id}」的 components 要是物件（元件名稱 → 資料）`);
    if (prefab !== undefined && (typeof prefab !== 'string' || prefab === ''))
      throw new Error(`實體「${id}」的 prefab 要是預製物件的路徑（例如 "prefabs/tree.json"）`);
    if (overrides !== undefined) {
      if (prefab === undefined) throw new Error(`實體「${id}」有 overrides 但不是預製物件的實例`);
      if (!isObject(overrides)) throw new Error(`實體「${id}」的 overrides 要是物件（預製物件裡的 id → 覆蓋）`);
      for (const [key, ov] of Object.entries(overrides)) {
        if (!isObject(ov)) throw new Error(`實體「${id}」的 overrides.${key} 要是物件 { name, components }`);
        if (ov.name !== undefined && typeof ov.name !== 'string')
          throw new Error(`實體「${id}」的 overrides.${key}.name 要是文字`);
        if (ov.components !== undefined && !isObject(ov.components))
          throw new Error(`實體「${id}」的 overrides.${key}.components 要是物件`);
      }
    }
    const out: SceneFileEntity = { id };
    if (name !== undefined) out.name = name;
    if (parent !== undefined) out.parent = parent;
    if (components !== undefined) out.components = components;
    if (prefab !== undefined) out.prefab = prefab;
    if (overrides !== undefined) out.overrides = overrides as Record<string, PrefabOverride>;
    return out;
  });

  // 父節點要存在、不能形成循環
  const parentOf = new Map(entities.map((e) => [e.id, e.parent]));
  for (const e of entities) {
    if (e.parent === undefined) continue;
    if (!ids.has(e.parent)) throw new Error(`實體「${e.id}」的父節點「${e.parent}」不存在`);
    const seen = new Set([e.id]);
    for (let p: string | undefined = e.parent; p !== undefined; p = parentOf.get(p)) {
      if (seen.has(p)) throw new Error(`實體「${e.id}」的父子關係形成循環`);
      seen.add(p);
    }
  }
  const out: SceneFileData = { format: SCENE_FILE_FORMAT, version: data.version, entities };
  if (data.settings !== undefined) {
    if (!isObject(data.settings)) throw new Error('settings 要是物件（例如 { "background": "#223344" }）');
    out.settings = data.settings;
  }
  if (data.ui !== undefined) {
    if (!Array.isArray(data.ui) || !data.ui.every((u) => typeof u === 'string' && u !== ''))
      throw new Error('ui 要是介面檔路徑的陣列（例如 ["ui/scene.xml"]）');
    if (data.ui.length) out.ui = [...data.ui];
  }
  if (data.prefabs !== undefined) {
    if (!isObject(data.prefabs)) throw new Error('prefabs 要是物件（路徑 → 預製物件檔）');
    out.prefabs = {};
    for (const [path, p] of Object.entries(data.prefabs)) {
      try {
        out.prefabs[path] = parseSceneFile(p);
      } catch (error) {
        throw new Error(`預製物件 ${path}：${(error as Error).message}`);
      }
    }
  }
  return out;
}

// ───────── 預製物件 ─────────

/**
 * 場景檔（包含用到的預製物件裡）需要的所有預製物件路徑
 * @param data 場景檔
 */
export function prefabPaths(data: SceneFileData): string[] {
  const out = new Set<string>();
  const visit = (d: SceneFileData) => {
    for (const e of d.entities) {
      if (e.prefab === undefined || out.has(e.prefab)) continue;
      out.add(e.prefab);
      const p = data.prefabs?.[e.prefab];
      if (p) visit(p);
    }
  };
  visit(data);
  return [...out];
}

/**
 * 預製物件檔的根節點（預製物件檔要剛好有一個最上層的實體）
 * @param prefab 預製物件檔
 * @param path 預製物件檔的路徑（錯誤訊息用）
 */
export function prefabRoot(prefab: SceneFileData, path = '預製物件'): SceneFileEntity {
  const roots = prefab.entities.filter((e) => e.parent === undefined);
  if (roots.length !== 1) throw new Error(`${path} 要剛好有一個最上層的實體（現在有 ${roots.length} 個）`);
  return roots[0];
}

/** expandPrefabs 的結果 */
export interface ExpandedScene {
  /** 展開後的場景檔（沒有 prefab 欄位） */
  data: SceneFileData;
  /** 找不到內容的預製物件路徑（missing: 'skip' 時） */
  missing: string[];
  /** 對不到的覆蓋（預製物件改過、裡面的實體不見了）等警告 */
  warnings: string[];
}

/**
 * 展開預製物件：實例換成預製物件的內容。
 * - 實例的 id 給預製物件的根節點；其他實體的 id 是「實例 id/原本的 id」（例如 tree1/leaf）
 * - 實例的 name、parent 取代根節點的；實例的 components 逐一覆蓋根節點的同名元件
 * - 預製物件裡可以再用預製物件（不能互相包含）
 * missing：'error'（預設）找不到內容時拋出錯誤；'skip' 只留下實例本身（編輯器載入中用）
 * @param data 場景檔（prefabs 要先填好，loadSceneFile 會處理）
 * @param options 找不到預製物件時拋出錯誤或略過
 */
export function expandPrefabs(
  data: SceneFileData,
  options: {
    /** 找不到預製物件的內容時：'error'（預設）拋出錯誤；'skip' 只留下實例本身 */
    missing?: 'error' | 'skip';
  } = {},
): ExpandedScene {
  const missing = new Set<string>();
  const warnings: string[] = [];
  const out: SceneFileEntity[] = [];
  const expand = (entities: readonly SceneFileEntity[], prefix: string, stack: string[]) => {
    const rename = (id: string) => (prefix ? `${prefix}/${id}` : id);
    for (const e of entities) {
      const id = rename(e.id);
      const parent = e.parent !== undefined ? rename(e.parent) : undefined;
      if (e.prefab === undefined) {
        const { prefab: _, overrides: __, ...plain } = e;
        out.push({ ...plain, id, ...(parent !== undefined ? { parent } : {}) });
        continue;
      }
      const path = e.prefab;
      const prefab = data.prefabs?.[path];
      if (stack.includes(path)) throw new Error(`預製物件 ${path} 包含了自己（${[...stack, path].join(' → ')}）`);
      if (!prefab) {
        if (options.missing !== 'skip')
          throw new Error(`實體「${id}」用到的預製物件 ${path} 沒有載入（用 load.sceneFile 載入場景檔會自動下載）`);
        missing.add(path);
        const { prefab: _, overrides: __, ...plain } = e;
        out.push({ ...plain, id, ...(parent !== undefined ? { parent } : {}) });
        continue;
      }
      const root = prefabRoot(prefab, path);
      const inner = prefab.entities.map((x): SceneFileEntity => {
        if (x !== root) return x;
        // 根節點：實例的 id、名稱、父節點、覆蓋的元件
        const merged: SceneFileEntity = { ...x, id: x.id };
        const name = e.name ?? x.name;
        if (name !== undefined) merged.name = name;
        else delete merged.name;
        const components = { ...(x.components ?? {}), ...(e.components ?? {}) };
        if (Object.keys(components).length) merged.components = components;
        return merged;
      });
      const start = out.length;
      expand(inner, id, [...stack, path]);
      // 根節點的 id 改成實例 id，父節點改成實例的父節點
      const rootId = `${id}/${root.id}`;
      for (let i = start; i < out.length; i++) {
        const x = out[i];
        if (x.id === rootId) {
          x.id = id;
          if (parent !== undefined) x.parent = parent;
        } else if (x.parent === rootId) x.parent = id;
      }
      // 覆蓋預製物件裡面的實體
      for (const [inner, ov] of Object.entries(e.overrides ?? {})) {
        const target = out.slice(start).find((x) => x.id === `${id}/${inner}`);
        if (!target) {
          warnings.push(`實體「${id}」的覆蓋「${inner}」在預製物件 ${path} 裡找不到，已略過`);
          continue;
        }
        if (ov.name !== undefined) target.name = ov.name;
        if (ov.components) {
          const components = { ...(target.components ?? {}) };
          for (const [c, v] of Object.entries(ov.components)) {
            if (v === null) delete components[c];
            else components[c] = v;
          }
          if (Object.keys(components).length) target.components = components;
          else delete target.components;
        }
      }
    }
  };
  expand(data.entities, '', []);
  const flat: SceneFileData = { format: SCENE_FILE_FORMAT, version: data.version, entities: out };
  if (data.settings !== undefined) flat.settings = data.settings;
  return { data: flat, missing: [...missing], warnings };
}

// ───────── 讀檔：建立實體 ─────────

/** spawnSceneFile 的結果 */
export interface SpawnedScene {
  /** 檔案 id → 建立的實體 */
  readonly entities: ReadonlyMap<string, Entity>;
  /** 讀檔時的警告（沒有登記的元件等），沒有時是空陣列 */
  readonly warnings: readonly string[];
  /**
   * 替場景檔裡某個 id 的實體加上元件（遊戲邏輯），回傳那個實體。
   * 找不到這個 id 時（例如在編輯器裡改了 id、刪掉了）印出警告並略過，回傳 undefined。
   * @param id 場景檔裡的實體 id
   * @param type 元件
   * @param init 初始值（其他欄位用預設值）
   * @example
   * spawned.add('box', Spin, { speed: 0.8 });
   */
  add<T>(id: string, type: ComponentType<T>, init?: Partial<T>): Entity | undefined;
}

/**
 * 依場景檔建立實體。存讀規則預設用 world 的資源 SceneCodecsKey（安裝場景外掛時建立）。
 * 父子關係需要 Hierarchy（場景外掛提供）；沒有時用暫時的 Hierarchy 設定。
 * 元件資料錯誤會拋出錯誤，已建立的實體會先銷毀，不會留下一半的場景。
 * @param world ECS 世界
 * @param file 場景檔
 * @param codecs 存讀規則（預設用 world 的資源 SceneCodecsKey）
 */
export function spawnSceneFile(world: World, file: SceneFileData, codecs?: SceneCodecs): SpawnedScene {
  const registry = codecs ?? world.getResource(SceneCodecsKey);
  if (!registry) throw new Error('沒有元件存讀規則：請先安裝 ScenePlugin，或傳入 SceneCodecs');
  const expanded = expandPrefabs(parseSceneFile(file));
  const data = expanded.data;
  const warnings: string[] = [...expanded.warnings];
  const entities = new Map<string, Entity>();
  try {
    for (const item of data.entities) {
      const e = world.create();
      entities.set(item.id, e);
      if (item.name !== undefined) world.add(e, Name, { value: item.name });
      for (const [component, value] of Object.entries(item.components ?? {})) {
        const codec = registry.get(component);
        if (!codec) {
          warnings.push(`實體「${item.id}」：沒有元件「${component}」的存讀規則（是不是沒有安裝對應的外掛？），已略過`);
          continue;
        }
        const ctx: CodecContext = {
          entity: item.id,
          component,
          warn: (m) => warnings.push(`實體「${item.id}」的 ${component}：${m}`),
        };
        let init: Partial<unknown>;
        try {
          init = codec.read(value, ctx);
        } catch (error) {
          throw new Error(`實體「${item.id}」的 ${component}：${(error as Error).message}`);
        }
        world.add(e, codec.type, init);
      }
    }
    const existing = world.getResource(HierarchyKey);
    const temporary = existing ? null : new Hierarchy(world);
    const hierarchy = existing ?? temporary!;
    for (const item of data.entities) {
      if (item.parent !== undefined) hierarchy.setParent(entities.get(item.id)!, entities.get(item.parent)!);
    }
    // 暫時的 Hierarchy：只用來設定父子，設定完就移除（Parent 元件留著）
    temporary?.dispose();
  } catch (error) {
    for (const e of entities.values()) if (world.isAlive(e)) world.destroy(e);
    throw error;
  }
  return {
    entities,
    warnings,
    add(id, type, init) {
      const e = entities.get(id);
      if (e === undefined) {
        log.warn(`場景檔裡沒有 id「${id}」（改了 id 或刪掉了？），略過加上 ${type.name}`);
        return undefined;
      }
      world.add(e, type, init);
      return e;
    },
  };
}

// ───────── 存檔：實體 → 場景檔 ─────────

/** writeSceneFile 的設定 */
export interface WriteSceneOptions {
  /** 存讀規則（預設用 world 的資源 SceneCodecsKey） */
  codecs?: SceneCodecs;
  /** 實體的檔案 id（預設依序編為 e1、e2…）；編輯器用它保留原本的 id */
  idOf?: (entity: Entity) => string | undefined;
  /** 不能存的元件會呼叫這裡（預設忽略） */
  warn?: (message: string) => void;
}

/**
 * 把實體存成場景檔。父節點不在清單裡的實體會存成最上層。
 * 只存有存讀規則的元件；SceneMember、Parent、Name 由檔案格式本身處理。
 * @param world ECS 世界
 * @param entities 要存的實體
 * @param options 存讀規則、實體的 id、記錄警告的函式
 */
export function writeSceneFile(
  world: World,
  entities: readonly Entity[],
  options: WriteSceneOptions = {},
): SceneFileData {
  const registry = options.codecs ?? world.getResource(SceneCodecsKey);
  if (!registry) throw new Error('沒有元件存讀規則：請先安裝 ScenePlugin，或傳入 SceneCodecs');
  const ids = new Map<Entity, string>();
  const used = new Set<string>();
  for (const e of entities) {
    const id = options.idOf?.(e);
    if (id !== undefined && !used.has(id)) {
      ids.set(e, id);
      used.add(id);
    }
  }
  let next = 1;
  for (const e of entities) {
    if (ids.has(e)) continue;
    while (used.has(`e${next}`)) next++;
    ids.set(e, `e${next}`);
    used.add(`e${next}`);
  }

  const out: SceneFileEntity[] = [];
  for (const e of entities) {
    const item: SceneFileEntity = { id: ids.get(e)! };
    const name = world.get(e, Name)?.value;
    if (name) item.name = name;
    const parent = world.get(e, Parent)?.entity;
    if (parent !== undefined && ids.has(parent)) item.parent = ids.get(parent)!;
    const components: Record<string, unknown> = {};
    for (const codec of registry.all()) {
      const value = world.get(e, codec.type);
      if (value === undefined) continue;
      const written = codec.write(value);
      if (written === undefined) {
        options.warn?.(`實體「${item.id}」的 ${codec.type.name} 不能存成檔案，已略過`);
        continue;
      }
      components[codec.type.name] = written;
    }
    if (Object.keys(components).length > 0) item.components = components;
    out.push(item);
  }
  return { format: SCENE_FILE_FORMAT, version: SCENE_FILE_VERSION, entities: out };
}

/**
 * 場景檔轉成 JSON 文字（兩格縮排，結尾換行）；XML 用 stringifySceneXml
 * @param data 場景檔
 */
export function stringifySceneFile(data: SceneFileData): string {
  const { prefabs: _, ...rest } = data;
  return `${JSON.stringify(rest, null, 2)}\n`;
}

// ───────── 和場景管理搭配 ─────────

/** sceneFromFile 的設定 */
export interface SceneFromFileOptions {
  /**
   * 建立完場景檔的實體之後呼叫（例如加上腳本、遊戲邏輯）
   * @param world ECS 世界
   * @param spawned 這次建立的實體（依 id 找）與加元件的函式 add
   * @param scenes 場景管理器
   */
  setup?(world: World, spawned: SpawnedScene, scenes: SceneManager): void;
  /**
   * 卸載時呼叫
   * @param world ECS 世界
   */
  teardown?(world: World): void;
  /**
   * 開發時，場景檔（或用到的預製物件）存檔後自動重新載入這個場景。
   * 預設：用 load.sceneFile 載入的資料會自動開啟（網址就是當初載入的網址）；給網址可以指定，false 關閉。
   * 只在 Vite 開發伺服器（node hero dev）有作用，打包後不會包含。
   */
  hotReload?: string | false;
}

// ───────── 開發時自動重新載入 ─────────

/** load.sceneFile 載入的資料 → 網址（給 sceneFromFile 自動開啟重新載入） */
const sourceUrls = new WeakMap<SceneFileData, string>();
const fileWatchers = new Set<(path: string) => void>();
/** 場景檔（相對於 public）→ 用它建立的場景名稱（sceneFromFile 登記；預覽時找要進入的場景） */
const scenesByFile = new Map<string, string>();
/** 3D 場景編輯器還沒存檔的內容（只在預覽頁面使用）：路徑 → 資料 */
const drafts = new Map<string, SceneFileData>();

/** 網址整理成相對於 public 的路徑：'./scenes/a.json'、'/scenes/a.json' → 'scenes/a.json' */
const normalizeFilePath = (path: string) => path.replace(/^(\.\/|\/)+/, '');

/**
 * 通知場景檔改了（path 相對於 public，例如 'scenes/forest.json'、'prefabs/tree.json'）：
 * 用到它的場景會重新下載、重新載入。開發伺服器存檔時會自動呼叫；測試或自訂的開發工具也可以呼叫。
 * @param path 場景檔的路徑（相對於 public，例如 'scenes/forest.json'）
 */
export function notifySceneFileChanged(path: string): void {
  const normalized = normalizeFilePath(path);
  for (const watch of [...fileWatchers]) watch(normalized);
}

// ───────── 3D 場景編輯器的預覽 ─────────

/** 3D 場景編輯器與預覽中的遊戲溝通的頻道（同一個瀏覽器，BroadcastChannel） */
export const SCENE_PREVIEW_CHANNEL = 'hero-scene-editor';

/**
 * 預覽頻道的訊息：
 * - draft：編輯中的內容（還沒存檔也會送；path 相對於 public，例如 'scenes/forest.xml'）
 * - saved：存檔或放棄修改，改回讀磁碟上的檔案（reload 為 false：剛存檔，開發伺服器會另外通知重新載入）
 * - request：預覽的遊戲剛開啟，請編輯器送出還沒存檔的內容
 */
export type ScenePreviewMessage =
  | {
      /** 還沒存檔的內容 */
      type: 'draft';
      /** 場景檔的路徑 */
      path: string;
      /** 場景檔的內容 */
      data: SceneFileData;
    }
  | {
      /** 存檔或放棄修改：改回讀磁碟上的檔案 */
      type: 'saved';
      /** 場景檔的路徑 */
      path: string;
      /** false：剛存檔，開發伺服器會另外通知重新載入 */
      reload?: boolean;
    }
  | {
      /** 預覽的遊戲剛開啟，請編輯器送出還沒存檔的內容 */
      type: 'request';
    };

/** 網址參數：3D 場景編輯器的「預覽」用 ?heroPreview=scenes/forest.xml 打開遊戲 */
const PREVIEW_PARAM = 'heroPreview';

/** 這個頁面是 3D 場景編輯器的預覽時，預覽的場景檔（相對於 public）；不是預覽時是 null */
function previewFile(): string | null {
  if (!import.meta.hot || typeof location === 'undefined') return null; // 只在開發伺服器
  const v = new URLSearchParams(location.search).get(PREVIEW_PARAM);
  return v ? normalizeFilePath(v) : null;
}

/**
 * 3D 場景編輯器按「預覽」打開遊戲時，要進入的場景名稱（用 sceneFromFile 建立、而且是那個場景檔的場景）；
 * 不是預覽、或找不到對應的場景時是 null。遊戲在註冊場景之後用它決定第一個場景：
 *
 *   const start = previewScene() ?? 'title';
 *   scenes.load(start);
 *
 * 預覽中，編輯器還沒存檔的修改也會即時套用（場景自動重新載入）。只在 node hero dev 時有作用。
 */
export function previewScene(): string | null {
  const file = previewFile();
  return file !== null ? (scenesByFile.get(file) ?? null) : null;
}

// Vite 開發伺服器：tools/scene-files-plugin.ts 在場景檔、預製物件存檔時送出（打包後 import.meta.hot 是 undefined，整段會被去掉）
if (import.meta.hot) {
  import.meta.hot.on('hero:file-changed', (data: { path: string }) => notifySceneFileChanged(data.path));
  // 編輯器的預覽頁面：接收還沒存檔的內容
  if (previewFile() !== null && typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel(SCENE_PREVIEW_CHANNEL);
    channel.addEventListener('message', (e: MessageEvent<ScenePreviewMessage>) => {
      const msg = e.data;
      if (!msg || typeof msg !== 'object' || msg.type === 'request' || typeof msg.path !== 'string') return;
      const path = normalizeFilePath(msg.path);
      if (msg.type === 'draft') {
        try {
          drafts.set(path, parseSceneFile(msg.data));
        } catch (error) {
          log.warn(`預覽：${path} 的內容有錯誤，先不套用（${(error as Error).message}）`);
          return;
        }
      } else if (msg.type === 'saved') {
        if (!drafts.delete(path) || msg.reload === false) return;
      } else return;
      notifySceneFileChanged(path);
    });
    channel.postMessage({ type: 'request' } satisfies ScenePreviewMessage);
  }
}

/**
 * 用場景檔建立場景，交給 scenes.register()：
 *
 *   const data = await load.sceneFile('scenes/forest.json');
 *   scenes.register(create.sceneFromFile('forest', data)).load('forest');
 *
 * 讀檔警告會用記錄器顯示（[scene] 開頭的警告）。
 * @param name 場景名稱（scenes.load 用）
 * @param file 場景檔（load.sceneFile 載入的）
 * @param options 建立後、卸載時呼叫的函式、開發時自動重新載入
 */
export function sceneFromFile(name: string, file: SceneFileData, options: SceneFromFileOptions = {}): Scene {
  let data = parseSceneFile(file);
  let manager: SceneManager | null = null;
  let undoSettings: (() => void) | null = null;
  const url = options.hotReload === false ? undefined : (options.hotReload ?? sourceUrls.get(file));
  const loadedFrom = sourceUrls.get(file);
  if (loadedFrom !== undefined) scenesByFile.set(normalizeFilePath(loadedFrom), name);
  if (url !== undefined) {
    const self = normalizeFilePath(url);
    fileWatchers.add((path) => {
      if (path !== self && !prefabPaths(data).map(normalizeFilePath).includes(path)) return;
      loadSceneFile(url)
        .then((next) => {
          data = parseSceneFile(next);
          if (!manager?.isLoaded(name)) return;
          // 只有這個場景時照常載入；有疊加的場景時只換掉這一個
          if (manager.loadedScenes.length === 1) manager.load(name);
          else {
            manager.unload(name);
            manager.load(name, { additive: true });
          }
          log.info(`場景「${name}」：${path} 改了，已重新載入`);
        })
        .catch((error: Error) => log.warn(`場景「${name}」重新載入失敗：${error.message}`));
    });
  }
  return {
    name,
    setup(world, scenes) {
      manager = scenes;
      const spawned = spawnSceneFile(world, data);
      const settings = applySceneSettings(world, data.settings);
      undoSettings = settings.undo;
      for (const w of [...spawned.warnings, ...settings.warnings]) log.warn(`場景「${name}」：${w}`);
      options.setup?.(world, spawned, scenes);
    },
    teardown(world) {
      undoSettings?.();
      undoSettings = null;
      options.teardown?.(world);
    },
  };
}

/** 下載並檢查一個檔案（場景檔或預製物件檔）；預覽中有編輯器還沒存檔的內容時用它 */
async function fetchSceneFile(url: string, label: string): Promise<SceneFileData> {
  const draft = drafts.get(normalizeFilePath(url));
  if (draft) return structuredClone(draft);
  // 打包時保護過的檔案（scenes/、prefabs/ 的 .xml）：用到才解開；其他照常下載
  let text = await readPackedFile(url);
  if (text === null) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`讀取${label} ${url} 失敗（${res.status}）`);
    text = await res.text();
  }
  try {
    return parseSceneFile(text);
  } catch (error) {
    throw new Error(`${label} ${url}：${(error as Error).message}`);
  }
}

/**
 * 下載並檢查場景檔，連同用到的預製物件（填進 prefabs）。
 * 網址相對於頁面：'scenes/forest.xml' 對應專案的 public/scenes/forest.xml；預製物件的路徑也一樣（'prefabs/tree.xml'）。
 * JSON、XML 都可以（依內容自動判斷）。
 * @param url 場景檔的網址（相對於頁面，例如 'scenes/forest.xml'）
 */
export async function loadSceneFile(url: string): Promise<SceneFileData> {
  const data = await fetchSceneFile(url, '場景檔');
  const prefabs: Record<string, SceneFileData> = {};
  data.prefabs = prefabs;
  // 一層一層下載：預製物件裡可能又用到別的預製物件
  for (let todo = prefabPaths(data); todo.length; todo = prefabPaths(data).filter((p) => !(p in prefabs))) {
    const loaded = await Promise.all(todo.map((p) => fetchSceneFile(p, '預製物件')));
    todo.forEach((p, i) => {
      prefabs[p] = loaded[i];
    });
  }
  sourceUrls.set(data, url);
  return data;
}

// ───────── Transform 的存讀規則 ─────────

const _euler = new Euler();
const DEG = 180 / Math.PI;

/**
 * Transform：{ position: [x, y, z], rotation: [x, y, z]（度，XYZ 順序）, scale: [x, y, z] }，
 * 都可以省略（位置 0、不旋轉、縮放 1）；存檔時也會省略預設值。
 */
export const transformCodec: ComponentCodec<TransformData> = {
  type: Transform,
  read(data) {
    if (data === null || data === undefined) return {};
    if (!isObject(data)) throw new Error('要是物件 { position, rotation, scale }');
    const out: Partial<TransformData> = {};
    if (data.position !== undefined) out.position = new Vector3(...readVec3(data.position, 'position'));
    if (data.rotation !== undefined) {
      const [x, y, z] = readVec3(data.rotation, 'rotation');
      out.rotation = new Quaternion().setFromEuler(_euler.set(x / DEG, y / DEG, z / DEG, 'XYZ'));
    }
    if (data.scale !== undefined) out.scale = new Vector3(...readVec3(data.scale, 'scale'));
    for (const key of Object.keys(data))
      if (key !== 'position' && key !== 'rotation' && key !== 'scale') throw new Error(`不認識的欄位「${key}」`);
    return out;
  },
  write(t) {
    const out: Record<string, number[]> = {};
    const p = t.position.toArray().map(tidy);
    if (p.some((n) => n !== 0)) out.position = p;
    const e = _euler.setFromQuaternion(t.rotation, 'XYZ');
    const r = [e.x, e.y, e.z].map((n) => tidy(n * DEG));
    if (r.some((n) => n !== 0)) out.rotation = r;
    const s = t.scale.toArray().map(tidy);
    if (s.some((n) => n !== 1)) out.scale = s;
    return out;
  },
};

// ───────── 一般元件的存讀規則 ─────────

/** plainCodec 的設定（K 是元件欄位名稱） */
export interface PlainCodecOptions<K extends string> {
  /** 存檔時用「度」的欄位（元件裡是弧度） */
  angles?: readonly K[];
  /** 顏色欄位：檔案裡寫 '#rrggbb'（讀檔也接受數字 0xff8800 與 CSS 顏色名稱） */
  colors?: readonly K[];
  /** 只能是這些值的文字欄位（例如燈光種類） */
  choices?: { readonly [P in K]?: readonly string[] };
  /** 可以是 null 的文字欄位（例如 Animator 的 play：null 代表不播放） */
  nullable?: readonly K[];
  /** { x, y, z } 欄位：檔案裡寫成 [x, y, z]（數字或布林，依預設值） */
  triples?: readonly K[];
  /** 不存的欄位（執行期才有的資料） */
  skip?: readonly K[];
}

const hexOf = (c: unknown) => `#${new Color(c as string).getHexString()}`;
const typeName = (t: string) => (t === 'number' ? '數字' : t === 'string' ? '文字' : 'true 或 false');

/**
 * 一般元件的存讀規則：欄位都是數字、文字、布林（或顏色、角度、{ x, y, z }）時用這個。
 * 欄位名稱與型別依元件的預設值檢查；存檔時省略和預設值一樣的欄位。
 *
 *   sceneCodecs.register(plainCodec(Health));   // { max: 100, current: 100 }
 * @param type 元件
 * @param options 角度、顏色、限定值、可為 null、{ x, y, z } 欄位，以及不存的欄位
 */
export function plainCodec<T extends object>(
  type: ComponentType<T>,
  options: PlainCodecOptions<Extract<keyof T, string>> = {},
): ComponentCodec<T> {
  type K = Extract<keyof T, string>;
  const defaults = type.create() as Record<string, unknown>;
  const skip = new Set<string>(options.skip ?? []);
  const angles = new Set<string>(options.angles ?? []);
  const colors = new Set<string>(options.colors ?? []);
  const nullable = new Set<string>(options.nullable ?? []);
  const triples = new Set<string>(options.triples ?? []);
  const choices = (options.choices ?? {}) as Record<string, readonly string[] | undefined>;
  const fields = Object.keys(defaults).filter((k) => !skip.has(k)) as K[];
  const isScalar = (v: unknown) => typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean';
  /** 每個欄位應該是什麼型別（{ x, y, z } 是裡面的型別） */
  const kindOf = new Map<string, string>();
  for (const k of fields) {
    const v = defaults[k];
    if (triples.has(k)) {
      const t = v as Record<string, unknown> | null;
      if (!t || !isScalar(t.x) || typeof t.x !== typeof t.y || typeof t.x !== typeof t.z)
        throw new Error(`plainCodec(${type.name})：triples 的欄位「${k}」要是 { x, y, z }`);
      kindOf.set(k, typeof t.x);
    } else if (nullable.has(k)) kindOf.set(k, 'string');
    else if (colors.has(k)) kindOf.set(k, 'color');
    else if (isScalar(v)) kindOf.set(k, typeof v);
    else throw new Error(`plainCodec(${type.name})：欄位「${k}」不是數字、文字或布林，請自己寫存讀規則或放進 skip`);
  }
  const fileValue = (k: string, v: unknown): unknown => {
    if (triples.has(k)) {
      const t = v as Record<'x' | 'y' | 'z', unknown>;
      return [t.x, t.y, t.z].map((n) => (typeof n === 'number' ? tidy(n) : n));
    }
    if (colors.has(k)) return hexOf(v);
    if (angles.has(k)) return tidy((v as number) * DEG);
    return typeof v === 'number' ? tidy(v) : v;
  };
  const same = (a: unknown, b: unknown) => (Array.isArray(a) ? JSON.stringify(a) === JSON.stringify(b) : a === b);

  return {
    type,
    read(data) {
      if (data === null || data === undefined) return {};
      if (!isObject(data)) throw new Error('要是物件');
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(data)) {
        if (!fields.includes(k as K)) throw new Error(`不認識的欄位「${k}」（可用：${fields.join('、')}）`);
        const expected = kindOf.get(k)!;
        if (triples.has(k)) {
          const ok = (n: unknown) => typeof n === expected && (typeof n !== 'number' || Number.isFinite(n));
          if (!Array.isArray(v) || v.length !== 3 || !v.every(ok))
            throw new Error(`${k} 要是三個${typeName(expected)} [x, y, z]，收到 ${JSON.stringify(v)}`);
          out[k] = { x: v[0], y: v[1], z: v[2] };
          continue;
        }
        if (colors.has(k)) {
          if (typeof v !== 'string' && typeof v !== 'number') throw new Error(`${k} 要是顏色（'#rrggbb' 或數字）`);
          out[k] = v;
          continue;
        }
        if (v === null && nullable.has(k)) {
          out[k] = null;
          continue;
        }
        if (typeof v !== expected || (typeof v === 'number' && !Number.isFinite(v)))
          throw new Error(
            `${k} 要是${typeName(expected)}${nullable.has(k) ? '或 null' : ''}，收到 ${JSON.stringify(v)}`,
          );
        const allowed = choices[k];
        if (allowed && !allowed.includes(v as string))
          throw new Error(`${k} 只能是 ${allowed.join('、')}，收到 ${JSON.stringify(v)}`);
        out[k] = angles.has(k) ? (v as number) / DEG : v;
      }
      return out as Partial<T>;
    },
    write(value) {
      const out: Record<string, unknown> = {};
      for (const k of fields) {
        const v = fileValue(k, (value as Record<string, unknown>)[k]);
        if (!same(v, fileValue(k, defaults[k]))) out[k] = v;
      }
      return out;
    },
  };
}
