/**
 * 打包時保護的文字檔（場景檔、預製物件、介面檔的 XML，著色器節點圖的 JSON）：打包工具（tools/packed-files-plugin.ts）把它們轉成 JS 模組，
 * 內容是「deflate 壓縮 → XOR 混淆 → base64」的字串，頁面啟動時先登記「網址 → 模組」對照表，
 * 讀取這些網址時（load.sceneFile、ui.load…）用到才載入、解開。
 *
 * 輸出的資料夾裡沒有明文的 .xml，打開 JS 檔或用 base64 解碼也看不到內容；
 * 但金鑰和解法都在頁面的程式裡，有心人一步一步追還是解得開：這是「不讓人直接看到」，不是加密。
 * 開發時沒有登記任何檔案，照常直接讀 public/ 的檔案。
 */

/** 打包好的檔案：載入後是保護過的字串 */
type PackedModule = () => Promise<string | { default: string }>;

const packed = new Map<string, PackedModule>();
let mask: Uint8Array = new Uint8Array(0);

/** 網址 → 登記用的鍵（網站根目錄起算的路徑，不含查詢字串）；和 fetch 一樣以文件的基準網址算 */
function keyOf(url: string): string {
  try {
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

/** 登記打包好的檔案（打包工具產生的程式呼叫）；key 是 base64 的混淆金鑰 */
export function registerPackedFiles(key: string, files: Record<string, PackedModule>): void {
  mask = fromBase64(key);
  for (const [url, load] of Object.entries(files)) packed.set(keyOf(url), load);
}

/** 這個網址有打包好的檔案 */
export function hasPackedFile(url: string): boolean {
  return packed.has(keyOf(url));
}

/** 讀取打包好的檔案；沒有登記這個網址時回傳 null（呼叫的一方照常用網址抓） */
export function readPackedFile(url: string): Promise<string> | null {
  const load = packed.get(keyOf(url));
  if (!load) return null;
  return load().then((m) => unpackText(typeof m === 'string' ? m : m.default, mask));
}

function fromBase64(text: string): Uint8Array {
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 解開保護過的字串：base64 → XOR 還原 → deflate 解壓縮 → UTF-8 文字（tools/packed-text.ts 的 packText 的反向） */
export async function unpackText(text: string, key: Uint8Array): Promise<string> {
  const bytes = fromBase64(text);
  // 每個位置的遮罩：金鑰循環使用，再混入位置（同樣的內容在不同位置不會變成同樣的位元組）
  for (let i = 0; i < bytes.length; i++) bytes[i] ^= key[i % key.length] ^ ((i * 151 + 7) & 0xff);
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).text();
}
