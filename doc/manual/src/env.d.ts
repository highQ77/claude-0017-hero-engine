/** 使用手冊用到的虛擬模組（doc/vite.config.ts 提供） */
declare module 'virtual:engine-api' {
  import type { ApiData } from './api';
  const data: ApiData;
  export default data;
}

declare module 'virtual:doc-ui-xml' {
  /** doc/public/ui/*.xml：檔名 → 內容 */
  const files: Record<string, string>;
  export default files;
}
