/**
 * 存檔：把遊戲進度存起來，下次打開還在（預設存在瀏覽器的 localStorage）。
 *
 *   interface Progress { level: number; coins: number }
 *   const save = createSave<Progress>({ name: 'my-game', version: 2, migrate: (old, from) => … });
 *   save.write('slot1', { level: 3, coins: 120 });
 *   const p = save.read('slot1');            // 沒有存檔時是 null
 *   save.list();                              // [{ slot: 'slot1', savedAt: Date, version: 2 }]
 *
 * - 每個存檔記錄版本號：遊戲改了存檔格式時把 version 加 1，舊存檔讀取時交給 migrate 轉換
 * - 存檔壞掉、比遊戲還新、轉換失敗、validate 不通過時，read 會丟出 SaveError（說明是哪個存檔、什麼問題）
 * - 瀏覽器不允許使用 localStorage 時（例如無痕模式的某些設定）改存在記憶體裡（關掉頁面就沒了），並警告一次
 */
import { createLogger } from './Logger';

const log = createLogger('save');

/** 存檔用的儲存空間（localStorage 的子集；測試或其他平台可以自己提供） */
export interface SaveStorage {
  /**
   * 讀取（沒有時回傳 null）
   * @param key 鍵
   */
  getItem(key: string): string | null;
  /**
   * 寫入
   * @param key 鍵
   * @param value 要寫入的文字
   */
  setItem(key: string, value: string): void;
  /**
   * 刪除
   * @param key 鍵
   */
  removeItem(key: string): void;
  /** 所有的鍵（list 用） */
  keys(): string[];
}

/** createSave 的設定 */
export interface SaveOptions<T> {
  /** 遊戲名稱（存檔的鍵會以它開頭，同一個網站的不同遊戲不會互相蓋掉） */
  name: string;
  /** 存檔格式的版本（預設 1）；改了格式就加 1 */
  version?: number;
  /**
   * 讀到舊版本的存檔時轉換成目前的格式（沒有提供時，舊版本的存檔會讀取失敗）
   * @param data 讀到的舊版資料
   * @param fromVersion 存檔的版本
   */
  migrate?(data: unknown, fromVersion: number): T;
  /**
   * 檢查讀到的資料（回傳 false 或丟出錯誤代表資料不對）
   * @param data 讀到的資料
   */
  validate?(data: unknown): boolean;
  /** 儲存空間（預設 localStorage） */
  storage?: SaveStorage;
}

/** 存檔的資訊（list 回傳） */
export interface SaveInfo {
  /** 存檔欄位名稱 */
  slot: string;
  /** 存檔時間 */
  savedAt: Date;
  /** 存檔格式的版本 */
  version: number;
}

/** 讀取存檔失敗（存檔壞掉、版本不對、資料不通過檢查） */
export class SaveError extends Error {
  /**
   * @param message 錯誤訊息
   */
  constructor(
    message: string,
    /** 存檔欄位 */
    readonly slot: string,
  ) {
    super(message);
    this.name = 'SaveError';
  }
}

interface Record {
  format: 'hero-save';
  version: number;
  savedAt: number;
  data: unknown;
}

/** 記憶體裡的儲存空間（localStorage 不能用時） */
export function memoryStorage(): SaveStorage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    keys: () => [...map.keys()],
  };
}

function defaultStorage(): SaveStorage {
  try {
    const ls = globalThis.localStorage;
    const probe = '__hero_save_probe__';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return {
      getItem: (k) => ls.getItem(k),
      setItem: (k, v) => ls.setItem(k, v),
      removeItem: (k) => ls.removeItem(k),
      keys: () => Array.from({ length: ls.length }, (_, i) => ls.key(i)).filter((k): k is string => k !== null),
    };
  } catch {
    log.warn('這個瀏覽器不能使用 localStorage：存檔只會留在記憶體裡（關掉頁面就沒了）');
    return memoryStorage();
  }
}

/** 存檔欄位名稱：英數字、中文、- _ */
const VALID_SLOT = /^[\w\-㐀-鿿]+$/;

/**
 * 一個遊戲的存檔（createSave 建立）：write 寫入、read 讀取、list 列出、remove 刪除。
 * @example
 * const save = createSave<{ level: number }>({ name: 'my-game' });
 * save.write('slot1', { level: 3 });
 */
export class SaveFile<T> {
  /** 存檔格式的版本 */
  readonly version: number;
  private readonly storage: SaveStorage;
  private readonly prefix: string;

  /**
   * @param options 存檔名稱、版本、轉換舊版、檢查資料、儲存位置
   */
  constructor(private readonly options: SaveOptions<T>) {
    if (!options.name) throw new Error('createSave：要給遊戲名稱 name');
    this.version = options.version ?? 1;
    if (!Number.isInteger(this.version) || this.version < 1) throw new Error('createSave：version 要是 1 以上的整數');
    this.storage = options.storage ?? defaultStorage();
    this.prefix = `hero-save:${options.name}:`;
  }

  private key(slot: string): string {
    if (!VALID_SLOT.test(slot)) throw new Error(`存檔欄位名稱「${slot}」不合法：只能用英數字、中文、- _`);
    return this.prefix + slot;
  }

  /**
   * 寫入存檔（資料要能轉成 JSON）
   * @param slot 存檔欄位名稱（例如 'slot1'、'auto'）
   * @param data 要存的資料（要能轉成 JSON）
   */
  write(slot: string, data: T): void {
    const record: Record = { format: 'hero-save', version: this.version, savedAt: Date.now(), data };
    let text: string;
    try {
      text = JSON.stringify(record);
    } catch (error) {
      throw new SaveError(`存檔「${slot}」的資料不能轉成 JSON：${(error as Error).message}`, slot);
    }
    try {
      this.storage.setItem(this.key(slot), text);
    } catch (error) {
      throw new SaveError(`寫入存檔「${slot}」失敗（空間可能滿了）：${(error as Error).message}`, slot);
    }
  }

  /**
   * 讀取存檔；沒有這個存檔時回傳 null，存檔有問題時丟出 SaveError
   * @param slot 存檔欄位名稱
   */
  read(slot: string): T | null {
    const record = this.readRecord(slot);
    if (!record) return null;
    let data = record.data;
    if (record.version < this.version) {
      if (!this.options.migrate)
        throw new SaveError(
          `存檔「${slot}」是第 ${record.version} 版，遊戲是第 ${this.version} 版：要提供 migrate 才能轉換`,
          slot,
        );
      try {
        data = this.options.migrate(data, record.version);
      } catch (error) {
        throw new SaveError(`存檔「${slot}」從第 ${record.version} 版轉換失敗：${(error as Error).message}`, slot);
      }
    }
    if (this.options.validate) {
      let ok = false;
      try {
        ok = this.options.validate(data);
      } catch (error) {
        throw new SaveError(`存檔「${slot}」的資料不對：${(error as Error).message}`, slot);
      }
      if (!ok) throw new SaveError(`存檔「${slot}」的資料不對（validate 沒有通過）`, slot);
    }
    return data as T;
  }

  /**
   * 有沒有這個存檔
   * @param slot 存檔欄位名稱
   */
  has(slot: string): boolean {
    return this.storage.getItem(this.key(slot)) !== null;
  }

  /**
   * 刪除存檔
   * @param slot 存檔欄位名稱
   */
  remove(slot: string): void {
    this.storage.removeItem(this.key(slot));
  }

  /** 所有存檔（新的在前面）；壞掉的存檔也會列出（savedAt 是 0、version 是 0） */
  list(): SaveInfo[] {
    const out: SaveInfo[] = [];
    for (const k of this.storage.keys()) {
      if (!k.startsWith(this.prefix)) continue;
      const slot = k.slice(this.prefix.length);
      let info: SaveInfo = { slot, savedAt: new Date(0), version: 0 };
      try {
        const r = this.readRecord(slot);
        if (r) info = { slot, savedAt: new Date(r.savedAt), version: r.version };
      } catch {
        /* 壞掉的存檔：照樣列出，讓玩家可以刪除 */
      }
      out.push(info);
    }
    return out.sort((a, b) => b.savedAt.getTime() - a.savedAt.getTime());
  }

  private readRecord(slot: string): Record | null {
    const text = this.storage.getItem(this.key(slot));
    if (text === null) return null;
    let r: Partial<Record>;
    try {
      r = JSON.parse(text);
    } catch {
      throw new SaveError(`存檔「${slot}」已損壞（不是正確的 JSON）`, slot);
    }
    if (r?.format !== 'hero-save' || typeof r.version !== 'number' || typeof r.savedAt !== 'number')
      throw new SaveError(`存檔「${slot}」已損壞（不是 Hero Engine 的存檔格式）`, slot);
    if (r.version > this.version)
      throw new SaveError(`存檔「${slot}」是第 ${r.version} 版，比遊戲（第 ${this.version} 版）還新：請更新遊戲`, slot);
    return r as Record;
  }
}

/**
 * 建立存檔（一個遊戲一個，裡面可以有多個存檔欄位）
 * @param options 存檔名稱、版本、轉換舊版、檢查資料、儲存位置
 */
export function createSave<T>(options: SaveOptions<T>): SaveFile<T> {
  return new SaveFile(options);
}
