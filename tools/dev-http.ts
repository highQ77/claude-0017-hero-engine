/**
 * 開發伺服器外掛共用的小工具：讀取請求內容、回傳 JSON。
 */
import { promises as nodeFs, type Dirent } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';

/** 讀取請求內容（文字）；超過 maxSize 時以 413 失敗 */
export function readBody(req: IncomingMessage, maxSize = 2 * 1024 * 1024): Promise<string> {
  return new Promise<string>((ok, fail) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > maxSize) fail(Object.assign(new Error('檔案太大'), { status: 413 }));
      else chunks.push(c);
    });
    req.on('end', () => ok(Buffer.concat(chunks).toString('utf8')));
    req.on('error', fail);
  });
}

/** 回傳 JSON */
export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

/** 錯誤轉成回應：有 status 用它，找不到檔案是 404，其他是 500 */
export function sendError(res: ServerResponse, error: unknown): void {
  const e = error as Error & { status?: number; code?: string };
  sendJson(res, e.status ?? (e.code === 'ENOENT' ? 404 : 500), { error: e.message });
}

/** 帶有 HTTP 狀態碼的錯誤 */
export const httpError = (status: number, message: string) => Object.assign(new Error(message), { status });

/** 檔案是否存在 */
export async function exists(fs: typeof import('node:fs').promises, path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

/** 清單裡的一個檔案 */
export interface FileEntry {
  /** 相對於資料夾的檔名（子資料夾裡的是「資料夾/檔名」） */
  name: string;
  size: number;
  mtime: number;
}

/**
 * 列出資料夾裡符合 file 規則的檔案（依名稱排序）；給 folder 規則時也列出一層子資料夾裡的。
 * 略過 . 開頭的檔案與資料夾；資料夾還不存在時回傳空陣列。
 */
export async function listFiles(dir: string, file: RegExp, folder?: RegExp): Promise<FileEntry[]> {
  const fs = nodeFs;
  let entries: Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') return [];
    throw error;
  }
  const names: string[] = [];
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    if (e.isFile() && file.test(e.name)) names.push(e.name);
    else if (folder && e.isDirectory() && folder.test(e.name)) {
      for (const f of await fs.readdir(join(dir, e.name), { withFileTypes: true }))
        if (f.isFile() && file.test(f.name) && !f.name.startsWith('.')) names.push(`${e.name}/${f.name}`);
    }
  }
  names.sort();
  return Promise.all(
    names.map(async (name) => {
      const st = await fs.stat(join(dir, name));
      return { name, size: st.size, mtime: st.mtimeMs };
    }),
  );
}
