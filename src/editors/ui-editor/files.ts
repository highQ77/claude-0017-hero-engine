/**
 * UI 編輯器的檔案管理：public/ui 裡的 XML 檔。
 * - 開發時（npm run dev）透過 tools/ui-files-plugin.ts 的 API 讀寫磁碟
 * - 打包後只能讀取（ui/manifest.json 列出檔案），存檔改為下載
 * - 每個檔案沒存檔的修改（草稿）放在瀏覽器的 localStorage，重新整理也不會不見
 */
import { fetchUIXml } from '../../ui2d/xmlSources';
import { requestText } from '../shared/http';
import { storage } from '../shared/storage';

/** 資源管理器：public/ui 底下的一張圖片 */
export interface UIAssetInfo {
  /** 相對於 public/ui 的路徑（例如 coin.png、icons/sword.svg），也是 XML 裡 src 的寫法 */
  path: string;
  size: number;
  mtime?: number;
}

export type UIAssetKind = 'xml' | 'image' | 'audio' | 'font' | 'data' | 'other';

/** 依副檔名判斷資源類型 */
export function assetKind(path: string): UIAssetKind {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  if (ext === 'xml') return 'xml';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp', 'ico'].includes(ext)) return 'image';
  if (['wav', 'mp3', 'ogg', 'm4a', 'aac', 'flac'].includes(ext)) return 'audio';
  if (['ttf', 'otf', 'woff', 'woff2'].includes(ext)) return 'font';
  if (['json', 'txt', 'csv', 'md'].includes(ext)) return 'data';
  return 'other';
}

export interface UIFileInfo {
  name: string;
  size: number;
  mtime?: number;
  /** 只存在瀏覽器裡（還沒存到磁碟的新檔案） */
  localOnly?: boolean;
}

const DRAFT_PREFIX = 'ui2d-editor-draft:';
const LOCAL_FILES_KEY = 'ui2d-editor-local-files';
/** 一段名稱：英數字、中文、- _ .，不能以 . 開頭 */
const SEGMENT = '[\\w\\-㐀-鿿][\\w\\-.㐀-鿿]*';
/** 介面檔：檔名.xml 或 資料夾/檔名.xml（例如每個場景一個資料夾：forest/hud.xml） */
export const VALID_FILE_NAME = new RegExp(`^(?:${SEGMENT}/)?${SEGMENT}\\.xml$`);
export const VALID_FOLDER_NAME = new RegExp(`^${SEGMENT}$`);

/** 檔案所在的資料夾（根目錄是 ''） */
export function folderOf(name: string): string {
  const i = name.lastIndexOf('/');
  return i < 0 ? '' : name.slice(0, i);
}

/** 不含資料夾的檔名 */
export function baseName(name: string): string {
  return name.slice(name.lastIndexOf('/') + 1);
}

/** 資料夾名稱：去掉不合法的字元；不合法時回傳 null */
export function normalizeFolderName(input: string): string | null {
  const name = input.trim().replace(/\s+/g, '-').replace(/\/+$/, '');
  return VALID_FOLDER_NAME.test(name) ? name : null;
}

/** 檔名：補上 .xml、去掉不合法的字元；可以寫「資料夾/檔名」 */
export function normalizeFileName(input: string): string | null {
  let name = input.trim().replace(/\s+/g, '-').replace(/^\/+/, '');
  if (!name) return null;
  if (!name.toLowerCase().endsWith('.xml')) name += '.xml';
  return VALID_FILE_NAME.test(name) ? name : null;
}

export class UIFileStore {
  /** 開發伺服器的檔案 API 可以用（可以直接存檔） */
  writable = false;
  private diskNames = new Set<string>();

  constructor(private readonly base = 'ui/') {}

  // ───────── 磁碟 ─────────

  /** public/ui 底下的圖片（資源管理器）；沒有開發伺服器時回傳 null */
  async listAssets(): Promise<UIAssetInfo[] | null> {
    try {
      const res = await fetch('/__ui/assets', { cache: 'no-store' });
      if (!res.ok) return null;
      return ((await res.json()) as UIAssetInfo[]).filter((a) => assetKind(a.path) === 'image');
    } catch {
      return null;
    }
  }

  /** 介面檔的資料夾（場景分類）；沒有開發伺服器時從檔名推算 */
  async listFolders(files: readonly UIFileInfo[] = []): Promise<string[]> {
    const fromFiles = files.map((f) => folderOf(f.name)).filter(Boolean);
    let disk: string[] = [];
    if (this.writable) {
      try {
        const res = await fetch('/__ui/folders', { cache: 'no-store' });
        if (res.ok) disk = await res.json();
      } catch {
        /* 略過 */
      }
    }
    return [...new Set([...disk, ...fromFiles])].sort((a, b) => a.localeCompare(b));
  }

  async createFolder(name: string): Promise<void> {
    if (!this.writable) throw new Error('目前不能新增資料夾（不是開發伺服器）');
    await this.call('POST', '/__ui/folders', JSON.stringify({ name }));
  }

  /** 重新命名資料夾：裡面的檔案（含草稿）一起改名 */
  async renameFolder(from: string, to: string, names: readonly string[]): Promise<void> {
    if (!this.writable) throw new Error('目前不能重新命名資料夾（不是開發伺服器）');
    await this.call('POST', '/__ui/folders/rename', JSON.stringify({ from, to }));
    for (const name of names) {
      if (folderOf(name) !== from) continue;
      const next = `${to}/${baseName(name)}`;
      if (this.diskNames.delete(name)) this.diskNames.add(next);
      const draft = this.draft(name);
      this.clearDraft(name);
      if (draft !== null) this.setDraft(next, draft);
      if (this.localFiles().includes(name)) {
        this.removeLocal(name);
        this.addLocal(next);
      }
    }
  }

  /** 刪除資料夾（裡面要是空的） */
  async removeFolder(name: string): Promise<void> {
    if (!this.writable) throw new Error('目前不能刪除資料夾（不是開發伺服器）');
    await this.call('DELETE', `/__ui/folders/${encodeURIComponent(name)}`);
  }

  async list(): Promise<UIFileInfo[]> {
    let disk: UIFileInfo[] = [];
    try {
      const res = await fetch('/__ui/files', { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      disk = await res.json();
      this.writable = true;
    } catch {
      this.writable = false;
      try {
        const res = await fetch(`${this.base}manifest.json`, { cache: 'no-store' });
        if (res.ok) disk = await res.json();
      } catch {
        /* 沒有清單 */
      }
    }
    this.diskNames = new Set(disk.map((f) => f.name));
    // 只在瀏覽器裡的新檔案
    const local = this.localFiles().filter((n) => !this.diskNames.has(n));
    return [...disk, ...local.map((name) => ({ name, size: (this.draft(name) ?? '').length, localOnly: true }))].sort(
      (a, b) => a.name.localeCompare(b.name),
    );
  }

  /** 磁碟上的內容 */
  async read(name: string): Promise<string> {
    // 開發伺服器：直接從磁碟讀（剛建立的檔案，Vite 的靜態檔清單可能還沒更新，會回傳網頁）
    // 打包後：XML 已經變成 assets/ 裡的 JS 模組（fetchUIXml 會用它）
    const url = this.writable
      ? `/__ui/files/${encodeURIComponent(name)}`
      : `${this.base}${name.split('/').map(encodeURIComponent).join('/')}?t=${Date.now()}`;
    let text: string;
    try {
      text = await fetchUIXml(url, { cache: 'no-store' });
    } catch (error) {
      throw new Error(`讀取 ${name} 失敗（${(error as Error).message}）`);
    }
    // 找不到檔案時有些伺服器會回傳網頁（SPA 預設頁面），不能當成 XML
    if (/^\s*<!doctype html/i.test(text)) throw new Error(`讀取 ${name} 失敗（伺服器回傳的不是 XML）`);
    return text;
  }

  existsOnDisk(name: string): boolean {
    return this.diskNames.has(name);
  }

  /** 存到磁碟（開發伺服器）；不能寫入時丟出例外 */
  async save(name: string, text: string): Promise<void> {
    if (!this.writable) throw new Error('目前不能直接存檔（不是開發伺服器），請用「下載 XML」');
    await this.call('PUT', `/__ui/files/${encodeURIComponent(name)}`, text);
    this.diskNames.add(name);
    this.clearDraft(name);
    this.removeLocal(name);
  }

  async remove(name: string): Promise<void> {
    if (this.diskNames.has(name)) {
      if (!this.writable) throw new Error('目前不能刪除磁碟上的檔案（不是開發伺服器）');
      await this.call('DELETE', `/__ui/files/${encodeURIComponent(name)}`);
      this.diskNames.delete(name);
    }
    this.clearDraft(name);
    this.removeLocal(name);
  }

  async rename(from: string, to: string): Promise<void> {
    if (this.diskNames.has(from)) {
      if (!this.writable) throw new Error('目前不能重新命名磁碟上的檔案（不是開發伺服器）');
      await this.call('POST', '/__ui/rename', JSON.stringify({ from, to }));
      this.diskNames.delete(from);
      this.diskNames.add(to);
    } else {
      this.addLocal(to);
      this.removeLocal(from);
    }
    const draft = this.draft(from);
    this.clearDraft(from);
    if (draft !== null) this.setDraft(to, draft);
  }

  private async call(method: string, url: string, body?: string): Promise<void> {
    await requestText(url, {
      method,
      body,
      headers: body ? { 'Content-Type': 'text/plain; charset=utf-8' } : undefined,
    });
  }

  // ───────── 草稿（沒存檔的修改）與只在瀏覽器的新檔案 ─────────

  draft(name: string): string | null {
    return storage.get(DRAFT_PREFIX + name);
  }

  setDraft(name: string, text: string): void {
    storage.set(DRAFT_PREFIX + name, text);
  }

  clearDraft(name: string): void {
    storage.remove(DRAFT_PREFIX + name);
  }

  /** 新增一個只在瀏覽器裡的檔案（還沒存到磁碟） */
  createLocal(name: string, text: string): void {
    this.addLocal(name);
    this.setDraft(name, text);
  }

  private localFiles(): string[] {
    return storage.getJson<string[]>(LOCAL_FILES_KEY, []);
  }

  private addLocal(name: string): void {
    const list = this.localFiles();
    if (!list.includes(name)) storage.setJson(LOCAL_FILES_KEY, [...list, name]);
  }

  private removeLocal(name: string): void {
    storage.setJson(
      LOCAL_FILES_KEY,
      this.localFiles().filter((n) => n !== name),
    );
  }
}
