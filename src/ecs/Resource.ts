/**
 * 資源鍵：不依賴任何東西的小檔案。
 * 各模組的 keys.ts 只引用這裡，讓其他模組取得資源鍵時不會連帶包含整個模組。
 */

/** 資源：全域唯一的資料（例如輸入狀態、設定、攝影機），不屬於任何實體 */
export interface ResourceKey<T> {
  /** 資源名稱（除錯、錯誤訊息用） */
  readonly name: string;
  /** 只用於型別推導 */
  readonly __type?: T;
}

/*#__NO_SIDE_EFFECTS__*/
/**
 * @param name 資源名稱（找不到時的錯誤訊息用）
 */
export function defineResource<T>(name: string): ResourceKey<T> {
  return Object.freeze({ name }) as ResourceKey<T>;
}
