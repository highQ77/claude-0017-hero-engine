/**
 * 2D 介面元件的註冊表（XML 標籤 → 類別）。
 * 獨立成小檔案：套件管理等只需要「註冊元件」的地方引用這裡，不會連帶包含整個 UI2D。
 */
import type { ComponentConstructor } from './elements';

/** 標籤名稱 → 元件類別（UI2D.components 就是這一份） */
export const uiComponents = new Map<string, ComponentConstructor>();

/** 註冊元件：之後 XML 裡就能寫 <tag> */
export function registerUIComponent(tag: string, component: ComponentConstructor): void {
  uiComponents.set(tag, component);
}
