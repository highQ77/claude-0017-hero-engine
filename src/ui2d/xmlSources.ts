/**
 * 介面 XML 的來源。
 * 開發時直接用網址讀 public/ui 裡的檔案；打包後介面檔是保護過的 JS 模組（core/packedFiles.ts，用到才解開）。
 * 也可以用 registerUIXml（uiXml.register）登記「網址 → 內容」，讀取時就不用再抓 .xml 檔（例如使用手冊的範例）。
 */

import { readPackedFile } from '../core/packedFiles';

type XmlModule = () => Promise<string | { default: string }>;

const bundled = new Map<string, XmlModule>();
/** 開發工具給的內容（取代檔案，例如 UI 編輯器還沒存檔的修改） */
const overrides = new Map<string, string>();

/** 網址 → 登記用的鍵（網站根目錄起算的路徑，不含查詢字串），例如 'ui/scene.xml' → '/ui/scene.xml' */
function keyOf(url: string): string {
  try {
    // 和 fetch 一樣以文件的基準網址算（頁面有 <base> 時不是 location.href）
    const base =
      typeof document !== 'undefined'
        ? document.baseURI
        : typeof location !== 'undefined'
          ? location.href
          : 'http://localhost/';
    return decodeURIComponent(new URL(url, base).pathname);
  } catch {
    return url.split(/[?#]/)[0];
  }
}

/** 登記打包好的 XML（鍵是網站根目錄起算的路徑，例如 '/ui/scene.xml'） */
export function registerUIXml(modules: Record<string, XmlModule>): void {
  for (const [path, load] of Object.entries(modules)) bundled.set(keyOf(path), load);
}

/** 這個網址有打包好的 XML */
export function hasBundledUIXml(url: string): boolean {
  return bundled.has(keyOf(url));
}

// ───────── 快取（<UIComponent src> 內嵌的檔案用） ─────────

const cache = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();

/** 已經讀過的 XML（沒有讀過回傳 undefined）：內嵌元件可以同步建立，不用等 */
export function cachedUIXml(url: string): string | undefined {
  return cache.get(keyOf(url));
}

/** 讀取 XML 並快取（同一個檔案同時要求多次只會讀一次） */
export function loadUIXml(url: string): Promise<string> {
  const key = keyOf(url);
  const override = overrides.get(key);
  if (override !== undefined) return Promise.resolve(override);
  const hit = cache.get(key);
  if (hit !== undefined) return Promise.resolve(hit);
  let pending = inflight.get(key);
  if (!pending) {
    pending = fetchUIXml(url)
      .then((text) => {
        cache.set(key, text);
        return text;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, pending);
  }
  return pending;
}

/** 清除快取（例如編輯器存檔後，下次內嵌會讀到新內容） */
export function clearUIXmlCache(url?: string): void {
  if (url === undefined) cache.clear();
  else cache.delete(keyOf(url));
}

/**
 * 開發工具用：讀取這個網址時改用這份文字（例如 3D 場景編輯器預覽 UI 編輯器還沒存檔的修改）；null 取消。
 * 會同時清除這個網址的快取。
 */
export function setUIXmlOverride(url: string, xml: string | null): void {
  const key = keyOf(url);
  if (xml === null) overrides.delete(key);
  else overrides.set(key, xml);
  cache.delete(key);
}

/** 讀取介面 XML：有開發工具給的內容就用它，再來是登記過的、打包時保護過的，都沒有就用網址抓 */
export async function fetchUIXml(url: string, init?: RequestInit): Promise<string> {
  const override = overrides.get(keyOf(url));
  if (override !== undefined) return override;
  const packed = readPackedFile(url);
  if (packed) return packed;
  const load = bundled.get(keyOf(url));
  if (load) {
    const mod = await load();
    return typeof mod === 'string' ? mod : mod.default;
  }
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`讀取介面檔失敗：${url}（HTTP ${res.status}）`);
  return res.text();
}
