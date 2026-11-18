/** 編輯器共用的 DOM 小工具 */

/** 建立元素：h('div', 'class', '文字')（文字是空字串或省略時不設定） */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text: string | number = '',
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== '') el.textContent = String(text);
  return el;
}

/** 讓瀏覽器下載一個檔案 */
export function download(name: string, content: Blob | string, type = 'text/plain;charset=utf-8'): void {
  const blob = typeof content === 'string' ? new Blob([content], { type }) : content;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
