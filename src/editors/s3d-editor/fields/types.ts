/**
 * 屬性面板的輸入欄位（自己用 DOM 寫，不使用 lil-gui）。
 * 每個欄位：el 放進頁面，set() 從外面更新顯示的值；使用者修改時呼叫 onChange(值, done)。
 * done 為 true 代表這次操作結束（放開滑鼠、按 Enter、離開欄位），編輯器用它切分復原步驟。
 */
export type OnChange<T> = (value: T, done: boolean) => void;

export interface Field<T> {
  readonly el: HTMLElement;
  set(value: T): void;
}

import { h } from '../../shared/dom';
/** 建立元素的小工具（編輯器共用） */
export { h };

/** 一列：左邊標籤、右邊欄位 */
export function row(label: string, field: HTMLElement, hint = ''): HTMLElement {
  const r = h('div', 'f-row');
  const l = h('label', 'f-label', label);
  if (hint) l.title = hint;
  r.append(l, field);
  return r;
}
