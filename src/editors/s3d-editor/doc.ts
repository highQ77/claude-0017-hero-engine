/**
 * 編輯中的場景檔與復原／重做。
 *
 * 場景檔資料是唯一的真實來源：所有修改都透過 commit() 改這份資料，畫面再依資料同步（sync.ts）。
 * 每次 commit 記下修改前、後的完整快照（場景檔不大，簡單又不會出錯）。
 * 同一個 merge 鍵的連續修改（例如拖曳數字欄位）合併成一個復原步驟，直到 seal()。
 */
import type { SceneFileData, SceneFileEntity } from '../../scene';

interface HistoryEntry {
  label: string;
  before: SceneFileData;
  after: SceneFileData;
  merge?: string;
}

/** 修改的種類：load（開新檔）、edit（一般修改）、undo、redo */
export type DocChangeKind = 'load' | 'edit' | 'undo' | 'redo';

const clone = <T>(v: T): T => structuredClone(v);
const empty = (): SceneFileData => ({ format: 'hero-scene', version: 1, entities: [] });

/** 復原紀錄最多保留幾步 */
const MAX_HISTORY = 200;

export class SceneDoc {
  private data: SceneFileData = empty();
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private sealed = true;
  private savedJson = JSON.stringify(this.data);
  private readonly listeners = new Set<(kind: DocChangeKind) => void>();

  /** 目前的實體（依檔案順序；請勿直接修改，用 commit） */
  get entities(): readonly SceneFileEntity[] {
    return this.data.entities;
  }

  /** 依 id 取得實體 */
  get(id: string): SceneFileEntity | undefined {
    return this.data.entities.find((e) => e.id === id);
  }

  /** 子實體（依檔案順序）；parent 為 null 時是最上層 */
  childrenOf(parent: string | null): SceneFileEntity[] {
    return this.data.entities.filter((e) => (e.parent ?? null) === parent);
  }

  /** 是否有沒存檔的修改 */
  get dirty(): boolean {
    return JSON.stringify(this.data) !== this.savedJson;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** 下一個復原／重做步驟的名稱（顯示在按鈕提示） */
  get undoLabel(): string | null {
    return this.undoStack.at(-1)?.label ?? null;
  }

  get redoLabel(): string | null {
    return this.redoStack.at(-1)?.label ?? null;
  }

  /** 資料變動時呼叫 */
  onChange(fn: (kind: DocChangeKind) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(kind: DocChangeKind): void {
    for (const fn of [...this.listeners]) fn(kind);
  }

  /** 開啟場景檔：清空復原紀錄，視為已存檔 */
  load(data: SceneFileData): void {
    this.data = clone(data);
    this.undoStack = [];
    this.redoStack = [];
    this.sealed = true;
    this.savedJson = JSON.stringify(this.data);
    this.emit('load');
  }

  /** 目前的資料（複本，可以拿去存檔） */
  toFile(): SceneFileData {
    return clone(this.data);
  }

  /** 標記為已存檔 */
  markSaved(): void {
    this.savedJson = JSON.stringify(this.data);
    this.emit('edit');
  }

  /**
   * 修改資料：mutate 收到一份可以直接修改的複本。沒有任何變化時不記錄。
   * merge：和上一步的 merge 鍵相同且還沒 seal() 時，合併成同一個復原步驟。
   */
  commit(label: string, mutate: (draft: SceneFileData) => void, options: { merge?: string } = {}): boolean {
    const before = this.data;
    const draft = clone(before);
    mutate(draft);
    if (JSON.stringify(draft) === JSON.stringify(before)) return false;
    const top = this.undoStack.at(-1);
    if (options.merge !== undefined && !this.sealed && top?.merge === options.merge) {
      top.after = clone(draft);
    } else {
      this.undoStack.push({ label, before, after: clone(draft), merge: options.merge });
      if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    }
    this.sealed = options.merge === undefined;
    this.redoStack = [];
    this.data = draft;
    this.emit('edit');
    return true;
  }

  /** 結束目前的合併（例如放開滑鼠、離開欄位） */
  seal(): void {
    this.sealed = true;
  }

  undo(): boolean {
    const entry = this.undoStack.pop();
    if (!entry) return false;
    this.redoStack.push(entry);
    this.data = clone(entry.before);
    this.sealed = true;
    this.emit('undo');
    return true;
  }

  redo(): boolean {
    const entry = this.redoStack.pop();
    if (!entry) return false;
    this.undoStack.push(entry);
    this.data = clone(entry.after);
    this.sealed = true;
    this.emit('redo');
    return true;
  }
}

// ───────── 修改用的小工具（給 commit 的 mutate 用） ─────────

/** 找實體（找不到時拋出錯誤） */
export function entityIn(draft: SceneFileData, id: string): SceneFileEntity {
  const e = draft.entities.find((x) => x.id === id);
  if (!e) throw new Error(`找不到實體「${id}」`);
  return e;
}

/** 實體與所有子孫的 id（不含不存在的） */
export function withDescendants(data: SceneFileData, ids: readonly string[]): Set<string> {
  const out = new Set(ids.filter((id) => data.entities.some((e) => e.id === id)));
  let grew = true;
  while (grew) {
    grew = false;
    for (const e of data.entities)
      if (e.parent !== undefined && out.has(e.parent) && !out.has(e.id)) {
        out.add(e.id);
        grew = true;
      }
  }
  return out;
}

/** 產生沒用過的 id：依名稱或種類加流水號（box、box2、box3…） */
export function uniqueId(data: SceneFileData, base: string, taken: ReadonlySet<string> = new Set()): string {
  const clean = base.replace(/[^\w-]+/g, '').toLowerCase() || 'entity';
  const used = (id: string) => taken.has(id) || data.entities.some((e) => e.id === id);
  if (!used(clean)) return clean;
  for (let i = 2; ; i++) if (!used(`${clean}${i}`)) return `${clean}${i}`;
}

/**
 * 加入實體：放在父節點的子節點最後面（或 before 那個兄弟之前）。回傳實體的 id。
 * entity.id 已被使用時會自動換一個。
 */
export function insertEntity(draft: SceneFileData, entity: SceneFileEntity, before?: string): string {
  const item = clone(entity);
  item.id = uniqueId(draft, item.id);
  placeEntity(draft, item, before);
  return item.id;
}

/** 把實體放進陣列：before 之前，否則放在父節點最後一個子孫之後（沒有父節點時放最後） */
function placeEntity(draft: SceneFileData, item: SceneFileEntity, before?: string): void {
  const list = draft.entities;
  if (before !== undefined) {
    const i = list.findIndex((e) => e.id === before);
    if (i !== -1) {
      list.splice(i, 0, item);
      return;
    }
  }
  if (item.parent !== undefined) {
    const family = withDescendants(draft, [item.parent]);
    let last = -1;
    list.forEach((e, i) => {
      if (family.has(e.id)) last = i;
    });
    if (last !== -1) {
      list.splice(last + 1, 0, item);
      return;
    }
  }
  list.push(item);
}

/** 刪除實體（連同子孫） */
export function removeEntities(draft: SceneFileData, ids: readonly string[]): void {
  const gone = withDescendants(draft, ids);
  draft.entities = draft.entities.filter((e) => !gone.has(e.id));
}

/**
 * 複製實體（連同子孫），放在原本的實體後面。已經被選的祖先一起複製時，子孫不會重複複製。
 * 回傳新的最上層實體 id（依 ids 的順序）。
 */
export function duplicateEntities(draft: SceneFileData, ids: readonly string[]): string[] {
  const selected = new Set(ids);
  // 祖先也被選到的不另外複製
  const roots = ids.filter((id) => {
    for (let p = draft.entities.find((e) => e.id === id)?.parent; p !== undefined; ) {
      if (selected.has(p)) return false;
      p = draft.entities.find((e) => e.id === p)?.parent;
    }
    return draft.entities.some((e) => e.id === id);
  });
  const out: string[] = [];
  for (const root of roots) {
    const family = withDescendants(draft, [root]);
    const items = draft.entities.filter((e) => family.has(e.id));
    const taken = new Set<string>();
    const rename = new Map<string, string>();
    for (const e of items) {
      const id = uniqueId(draft, e.id.replace(/\d+$/, ''), taken);
      taken.add(id);
      rename.set(e.id, id);
    }
    const copies = items.map((e) => {
      const c = clone(e);
      c.id = rename.get(e.id)!;
      if (c.parent !== undefined && rename.has(c.parent)) c.parent = rename.get(c.parent);
      return c;
    });
    // 放在原本那一家子的最後面
    let last = -1;
    draft.entities.forEach((e, i) => {
      if (family.has(e.id)) last = i;
    });
    draft.entities.splice(last + 1, 0, ...copies);
    out.push(rename.get(root)!);
  }
  return out;
}

/**
 * 改變父節點與順序：parent 為 null 代表最上層；before 是新的兄弟（放在它前面），省略時放最後。
 * 不能放進自己或自己的子孫（回傳 false）。只改父子關係，Transform 的數值不變（相對新的父節點）。
 */
export function moveEntity(draft: SceneFileData, id: string, parent: string | null, before?: string): boolean {
  if (before === id) return false;
  if (parent !== null && withDescendants(draft, [id]).has(parent)) return false;
  const i = draft.entities.findIndex((e) => e.id === id);
  if (i === -1) return false;
  const [item] = draft.entities.splice(i, 1);
  if (parent === null) delete item.parent;
  else item.parent = parent;
  placeEntity(draft, item, before);
  return true;
}

/** 設定元件資料（檔案格式）；value 為 undefined 時移除元件 */
export function setComponent(draft: SceneFileData, id: string, component: string, value: unknown): void {
  const e = entityIn(draft, id);
  const components = { ...(e.components ?? {}) };
  if (value === undefined) delete components[component];
  else components[component] = clone(value);
  if (Object.keys(components).length > 0) e.components = components;
  else delete e.components;
}

/** 改名（空字串代表沒有名稱） */
export function renameEntity(draft: SceneFileData, id: string, name: string): void {
  const e = entityIn(draft, id);
  const trimmed = name.trim();
  if (trimmed) e.name = trimmed;
  else delete e.name;
}

/** 設定場景設定的一個鍵（value 為 undefined 時移除；全部移除時不留下 settings） */
export function setSetting(draft: SceneFileData, key: string, value: unknown): void {
  const settings = { ...(draft.settings ?? {}) };
  if (value === undefined) delete settings[key];
  else settings[key] = clone(value);
  if (Object.keys(settings).length) draft.settings = settings;
  else delete draft.settings;
}
