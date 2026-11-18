/**
 * 預製物件：快取讀過的預製物件檔，給畫面展開用；以及「存成預製物件」「解除連結」的資料處理。
 */
import {
  expandPrefabs,
  parseSceneFile,
  prefabPaths,
  prefabRoot,
  type PrefabOverride,
  type SceneFileData,
  type SceneFileEntity,
} from '../../scene';
import { renameEntity, setComponent, uniqueId, withDescendants } from './doc';
import { FOLDER, prefabName, readFile } from './files';

/** 預製物件檔的快取：缺的會在背景讀取，讀好後呼叫 onLoaded（畫面重新展開） */
export class PrefabCache {
  private readonly loaded = new Map<string, SceneFileData>();
  private readonly failed = new Map<string, string>();
  private readonly loading = new Set<string>();

  constructor(private readonly onLoaded: () => void) {}

  /** 已讀到的預製物件 */
  get(path: string): SceneFileData | undefined {
    return this.loaded.get(path);
  }

  /** 讀取失敗的原因 */
  errorOf(path: string): string | undefined {
    return this.failed.get(path);
  }

  /** 存檔後更新快取（用到它的地方會跟著變） */
  set(path: string, data: SceneFileData): void {
    this.loaded.set(path, data);
    this.failed.delete(path);
  }

  /** 丟掉快取（重新讀取場景時） */
  clear(): void {
    this.loaded.clear();
    this.failed.clear();
  }

  /** 把需要的預製物件填進資料（複本）；還沒讀到的開始讀 */
  attach(data: SceneFileData): SceneFileData {
    const out: SceneFileData = { ...data, prefabs: {} };
    // prefabPaths 只會往下找已經填進去的預製物件：一直填到沒有新的為止
    for (let grew = true; grew; ) {
      grew = false;
      for (const path of prefabPaths(out)) {
        const p = this.loaded.get(path);
        if (p && !out.prefabs![path]) {
          out.prefabs![path] = p;
          grew = true;
        } else if (!p) this.load(path);
      }
    }
    return out;
  }

  private load(path: string): void {
    if (this.loading.has(path) || this.failed.has(path)) return;
    this.loading.add(path);
    const name = prefabName(path);
    const job = name
      ? readFile('prefab', name)
      : fetch(path).then(async (r) => {
          if (!r.ok) throw new Error(`讀取 ${path} 失敗（${r.status}）`);
          return parseSceneFile(await r.text()); // JSON 或 XML
        });
    job
      .then((data) => {
        prefabRoot(data, path); // 檢查：剛好一個最上層的實體
        this.loaded.set(path, data);
      })
      .catch((error: Error) => this.failed.set(path, error.message))
      .finally(() => {
        this.loading.delete(path);
        this.onLoaded();
      });
  }
}

/** 預製物件的路徑（場景檔裡的寫法）：prefabs/<檔名> */
export const prefabPath = (name: string) => `${FOLDER.prefab}/${name}`;

/**
 * 把一個實體（連同子孫）做成預製物件檔：根節點不存 Transform（放置的位置留在實例上）。
 * 回傳預製物件的內容，以及要放回場景的實例。
 */
export function makePrefab(
  data: SceneFileData,
  id: string,
  path: string,
): { prefab: SceneFileData; instance: SceneFileEntity } {
  const family = withDescendants(data, [id]);
  const items = structuredClone(data.entities.filter((e) => family.has(e.id)));
  const root = items.find((e) => e.id === id)!;
  const { Transform, ...rest } = root.components ?? {};
  const instance: SceneFileEntity = { id, prefab: path };
  if (root.name) instance.name = root.name;
  if (root.parent !== undefined) instance.parent = root.parent;
  if (Transform !== undefined) instance.components = { Transform };
  delete root.parent;
  if (Object.keys(rest).length) root.components = rest;
  else delete root.components;
  return { prefab: { format: 'hero-scene', version: 1, entities: items }, instance };
}

/**
 * 解除連結：把實例換成預製物件的內容（變成一般實體，之後改預製物件不會再影響這裡）。
 * 展開後的 id（tree1/leaf）裡的 / 換成 -，並避開已經用過的 id。回傳是否成功（預製物件還沒讀到時失敗）。
 */
export function unpackPrefab(draft: SceneFileData, id: string, cache: PrefabCache): boolean {
  const i = draft.entities.findIndex((e) => e.id === id);
  const instance = draft.entities[i];
  if (!instance?.prefab) return false;
  const single = cache.attach({ format: 'hero-scene', version: 1, entities: [{ ...instance, parent: undefined }] });
  const expanded = expandPrefabs(single, { missing: 'skip' });
  if (expanded.missing.length) return false;
  const others = new Set(draft.entities.filter((e) => e.id !== id).map((e) => e.id));
  const rename = new Map<string, string>([[id, id]]);
  for (const e of expanded.data.entities) {
    if (rename.has(e.id)) continue;
    const next = uniqueId({ ...draft, entities: [] }, e.id.replaceAll('/', '-'), others);
    others.add(next);
    rename.set(e.id, next);
  }
  const items = expanded.data.entities.map((e) => {
    const c: SceneFileEntity = { ...e, id: rename.get(e.id)! };
    if (e.parent !== undefined) c.parent = rename.get(e.parent)!;
    else if (instance.parent !== undefined) c.parent = instance.parent;
    else delete c.parent;
    return c;
  });
  draft.entities.splice(i, 1, ...items);
  return true;
}

// ───────── 預製物件內部的實體（id 是「實例/內部」） ─────────

/** 展開後的 id → [實例 id, 內部路徑]；不是預製物件內部時內部路徑是 null */
export function splitInnerId(id: string): [string, string | null] {
  const i = id.indexOf('/');
  return i === -1 ? [id, null] : [id.slice(0, i), id.slice(i + 1)];
}

/** 取得（必要時建立）實例對內部實體的覆蓋 */
function overrideOf(draft: SceneFileData, id: string): PrefabOverride | null {
  const [instanceId, inner] = splitInnerId(id);
  const instance = draft.entities.find((e) => e.id === instanceId);
  if (!instance || inner === null) return null;
  instance.overrides ??= {};
  instance.overrides[inner] ??= {};
  return instance.overrides[inner];
}

/** 覆蓋變空時清掉（不留下空物件） */
function tidyOverrides(draft: SceneFileData, id: string): void {
  const [instanceId, inner] = splitInnerId(id);
  const instance = draft.entities.find((e) => e.id === instanceId);
  if (!instance?.overrides || inner === null) return;
  const ov = instance.overrides[inner];
  if (ov?.components && Object.keys(ov.components).length === 0) delete ov.components;
  if (ov && Object.keys(ov).length === 0) delete instance.overrides[inner];
  if (Object.keys(instance.overrides).length === 0) delete instance.overrides;
}

/**
 * 設定元件：一般實體直接改；預製物件內部的實體記成實例的覆蓋（value 為 undefined 時代表移除這個元件）。
 */
export function writeComponent(draft: SceneFileData, id: string, component: string, value: unknown): void {
  const ov = overrideOf(draft, id);
  if (!ov) return setComponent(draft, id, component, value);
  ov.components ??= {};
  ov.components[component] = value === undefined ? null : structuredClone(value);
  tidyOverrides(draft, id);
}

/** 改名：預製物件內部的實體記成覆蓋 */
export function writeName(draft: SceneFileData, id: string, name: string): void {
  const ov = overrideOf(draft, id);
  if (!ov) return renameEntity(draft, id, name);
  ov.name = name.trim();
  tidyOverrides(draft, id);
}

/** 還原預製物件內部實體的覆蓋：component 省略時全部還原（名稱也是） */
export function revertOverride(draft: SceneFileData, id: string, component?: string): void {
  const ov = overrideOf(draft, id);
  if (!ov) return;
  if (component === undefined) {
    delete ov.name;
    delete ov.components;
  } else if (ov.components) delete ov.components[component];
  tidyOverrides(draft, id);
}

/** 預製物件內部實體目前覆蓋了哪些東西 */
export function overriddenOf(data: SceneFileData, id: string): { name: boolean; components: Set<string> } {
  const [instanceId, inner] = splitInnerId(id);
  const ov = inner !== null ? data.entities.find((e) => e.id === instanceId)?.overrides?.[inner] : undefined;
  return { name: ov?.name !== undefined, components: new Set(Object.keys(ov?.components ?? {})) };
}
