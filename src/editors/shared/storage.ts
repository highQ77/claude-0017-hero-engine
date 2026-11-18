/**
 * 不會丟出錯誤的 localStorage（無痕模式、停用儲存空間時讀到 null、寫入略過）。
 * 只用在記住編輯器的偏好（上次開的檔案、面板大小），不放重要資料。
 */
export const storage = {
  /** 讀取文字；沒有或不能讀時是 null */
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  /** 寫入文字 */
  set(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* 無法儲存時略過 */
    }
  },
  /** 刪除 */
  remove(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {
      /* 略過 */
    }
  },
  /** 讀取 JSON；沒有、不能讀或格式錯誤時是 fallback */
  getJson<T>(key: string, fallback: T): T {
    const text = storage.get(key);
    if (text === null) return fallback;
    try {
      return JSON.parse(text) as T;
    } catch {
      return fallback;
    }
  },
  /** 寫入 JSON */
  setJson(key: string, value: unknown): void {
    storage.set(key, JSON.stringify(value));
  },
};
