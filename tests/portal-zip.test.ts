/**
 * 入口頁「開啟專案」的 zip 讀取（src/editors/portal/zip.ts）。
 * 測試自己組 zip 檔（用標準的 CompressionStream 壓縮），不依賴外部的壓縮工具。
 */
import { describe, expect, it } from 'vitest';
import { readZip } from '../src/editors/portal/zip';

interface Item {
  /** 檔名的原始位元組（預設 UTF-8） */
  name: string | Uint8Array;
  data?: string;
  method?: 0 | 8;
  /** 一般用途旗標：0x800 = UTF-8 檔名、0x1 = 加密 */
  flags?: number;
}

/** deflate 壓縮（zip 用的是沒有標頭的 deflate-raw） */
async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** 組一個 zip 檔 */
async function makeZip(items: Item[]): Promise<Blob> {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const it of items) {
    const name = typeof it.name === 'string' ? new TextEncoder().encode(it.name) : it.name;
    const raw = new TextEncoder().encode(it.data ?? '');
    const method = it.method ?? 8;
    const body = method === 8 ? await deflateRaw(raw) : raw;
    const flags = it.flags ?? (typeof it.name === 'string' ? 0x800 : 0);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, flags, true);
    local.setUint16(8, method, true);
    local.setUint32(18, body.length, true);
    local.setUint32(22, raw.length, true);
    local.setUint16(26, name.length, true);
    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true);
    dir.setUint16(4, 20, true);
    dir.setUint16(6, 20, true);
    dir.setUint16(8, flags, true);
    dir.setUint16(10, method, true);
    dir.setUint32(20, body.length, true);
    dir.setUint32(24, raw.length, true);
    dir.setUint16(28, name.length, true);
    dir.setUint32(42, offset, true);
    parts.push(new Uint8Array(local.buffer), name, body);
    central.push(new Uint8Array(dir.buffer), name);
    offset += 30 + name.length + body.length;
  }
  const dirSize = central.reduce((n, c) => n + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, items.length, true);
  end.setUint16(10, items.length, true);
  end.setUint32(12, dirSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)] as BlobPart[]);
}

const text = async (b: Blob) => new TextDecoder().decode(await b.arrayBuffer());

describe('readZip', () => {
  it('列出檔案（略過資料夾項目）並解壓縮 deflate 與不壓縮的檔案', async () => {
    const zip = await makeZip([
      { name: 'game/', data: '' },
      { name: 'game/index.html', data: '<!doctype html><title>t</title>'.repeat(20) },
      { name: 'game/src/main.ts', data: 'console.log(1);', method: 0 },
    ]);
    const entries = await readZip(zip);
    expect(entries.map((e) => [e.path, e.size])).toEqual([
      ['game/index.html', 31 * 20],
      ['game/src/main.ts', 15],
    ]);
    expect(await text(await entries[0].read())).toBe('<!doctype html><title>t</title>'.repeat(20));
    expect(await text(await entries[1].read())).toBe('console.log(1);');
  });

  it('中文檔名：UTF-8 標記、沒有標記的 UTF-8、Big5（Windows 繁體中文）；反斜線換成 /', async () => {
    // 「遊戲」的 Big5 編碼
    const big5 = new Uint8Array([0xb9, 0x43, 0xc0, 0xb8, 0x2e, 0x74, 0x78, 0x74]);
    const zip = await makeZip([
      { name: '專案/說明.md', data: 'a' },
      { name: new TextEncoder().encode('專案/音樂.txt'), data: 'b' },
      { name: big5, data: 'c' },
      { name: 'win\\src\\main.ts', data: 'd' },
    ]);
    expect((await readZip(zip)).map((e) => e.path)).toEqual([
      '專案/說明.md',
      '專案/音樂.txt',
      '遊戲.txt',
      'win/src/main.ts',
    ]);
  });

  it('不是 zip、加密的 zip：丟出看得懂的錯誤', async () => {
    await expect(readZip(new Blob(['hello, not a zip']))).rejects.toThrow('不是 zip 檔');
    await expect(readZip(await makeZip([{ name: 'secret.txt', data: 'x', flags: 0x801 }]))).rejects.toThrow('密碼保護');
  });
});
