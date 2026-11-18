/**
 * 檢查場景檔、存檔資料的小工具（scene、render、postfx、shaders、scripts 的存讀規則共用）。
 */

/** 物件（不是 null、不是陣列） */
export const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** 用 {} 寫出來的一般物件（不是陣列、Date、類別的實例） */
export const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  isObject(v) && Object.getPrototypeOf(v) === Object.prototype;

/** 可以原樣存成 JSON 的值（遞迴檢查；數字要是有限的，物件要是一般物件） */
export const isPlainJson = (v: unknown): boolean => {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return true;
  if (typeof v === 'number') return Number.isFinite(v);
  if (Array.isArray(v)) return v.every(isPlainJson);
  return isPlainObject(v) && Object.values(v).every(isPlainJson);
};
