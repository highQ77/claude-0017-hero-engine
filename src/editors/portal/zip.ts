/**
 * 讀取 .zip（入口頁「匯入專案」用）：只讀目錄，檔案內容要用時才解壓縮。
 * 解壓縮用瀏覽器內建的 DecompressionStream('deflate-raw')，不需要額外的套件。
 *
 * 支援：不壓縮（stored）與 deflate 兩種方式（一般的壓縮工具都是這兩種）、ZIP64（超過 4 GB 或 65535 個檔案）。
 * 不支援：加密的 zip（丟出錯誤）。
 * 檔名：有 UTF-8 標記或本身就是 UTF-8 時照用；否則當成 Big5（Windows 繁體中文的壓縮工具），
 * 反斜線換成 /。
 */

export interface ZipEntry {
  /** zip 裡的路徑（用 / 分隔，不含資料夾本身的項目） */
  path: string;
  /** 解壓縮後的大小 */
  size: number;
  /** 解壓縮後的內容 */
  read(): Promise<Blob>;
}

const EOCD = 0x06054b50;
const ZIP64_LOCATOR = 0x07064b50;
const ZIP64_EOCD = 0x06064b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

const view = async (blob: Blob, start: number, end: number) => new DataView(await blob.slice(start, end).arrayBuffer());
const u64 = (v: DataView, at: number) => Number(v.getBigUint64(at, true));

const utf8 = new TextDecoder('utf-8', { fatal: true });
const big5 = new TextDecoder('big5');
function decodeName(bytes: Uint8Array, isUtf8: boolean): string {
  if (isUtf8) return new TextDecoder().decode(bytes);
  try {
    return utf8.decode(bytes);
  } catch {
    return big5.decode(bytes);
  }
}

/** 讀出 zip 裡的檔案列表；不是 zip 或格式壞掉時丟出錯誤 */
export async function readZip(file: Blob): Promise<ZipEntry[]> {
  // 結尾的目錄資訊（後面可能還有最多 65535 字的註解）
  const tailStart = Math.max(0, file.size - 22 - 0xffff);
  const tail = await view(file, tailStart, file.size);
  let at = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--)
    if (tail.getUint32(i, true) === EOCD) {
      at = i;
      break;
    }
  if (at < 0) throw new Error('不是 zip 檔（或檔案不完整）');
  let count = tail.getUint16(at + 10, true);
  let dirSize = tail.getUint32(at + 12, true);
  let dirOffset = tail.getUint32(at + 16, true);
  // ZIP64：上面的數字放不下時是 0xFFFF／0xFFFFFFFF，真正的值在前面的 ZIP64 結尾
  if (at >= 20 && tail.getUint32(at - 20, true) === ZIP64_LOCATOR) {
    const z64At = u64(tail, at - 20 + 8);
    const z64 = await view(file, z64At, z64At + 56);
    if (z64.getUint32(0, true) !== ZIP64_EOCD) throw new Error('zip 檔的格式壞掉了（ZIP64）');
    count = u64(z64, 32);
    dirSize = u64(z64, 40);
    dirOffset = u64(z64, 48);
  }

  const dir = await view(file, dirOffset, dirOffset + dirSize);
  const entries: ZipEntry[] = [];
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (dir.getUint32(p, true) !== CENTRAL) throw new Error('zip 檔的格式壞掉了（目錄）');
    const flags = dir.getUint16(p + 8, true);
    const method = dir.getUint16(p + 10, true);
    let compressed = dir.getUint32(p + 20, true);
    let size = dir.getUint32(p + 24, true);
    const nameLen = dir.getUint16(p + 28, true);
    const extraLen = dir.getUint16(p + 30, true);
    const commentLen = dir.getUint16(p + 32, true);
    let local = dir.getUint32(p + 42, true);
    const nameBytes = new Uint8Array(dir.buffer, dir.byteOffset + p + 46, nameLen);
    const name = decodeName(nameBytes, (flags & 0x800) !== 0).replace(/\\/g, '/');
    // ZIP64 的額外欄位：依序放「放不下」的大小、壓縮後大小、位置
    for (let e = p + 46 + nameLen; e + 4 <= p + 46 + nameLen + extraLen; ) {
      const id = dir.getUint16(e, true);
      const len = dir.getUint16(e + 2, true);
      if (id === 0x0001) {
        let q = e + 4;
        if (size === 0xffffffff) {
          size = u64(dir, q);
          q += 8;
        }
        if (compressed === 0xffffffff) {
          compressed = u64(dir, q);
          q += 8;
        }
        if (local === 0xffffffff) local = u64(dir, q);
      }
      e += 4 + len;
    }
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue; // 資料夾
    if (flags & 0x1) throw new Error(`zip 檔有密碼保護，不能匯入（${name}）`);
    if (method !== 0 && method !== 8) throw new Error(`不支援的壓縮方式（${name}）：請用一般的 zip 壓縮`);
    entries.push({
      path: name,
      size,
      async read() {
        // 本地標頭的檔名、額外欄位長度可能和目錄裡的不一樣：以本地標頭為準
        const head = await view(file, local, local + 30);
        if (head.getUint32(0, true) !== LOCAL) throw new Error(`zip 檔的格式壞掉了（${name}）`);
        const start = local + 30 + head.getUint16(26, true) + head.getUint16(28, true);
        const data = file.slice(start, start + compressed);
        if (method === 0) return data;
        const out = await new Response(data.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob();
        if (out.size !== size) throw new Error(`解壓縮失敗（${name}）`);
        return out;
      },
    });
  }
  return entries;
}
