/**
 * 入口頁的「匯入專案」：把別人的專案（瀏覽器選的資料夾，或在入口頁解開的 zip）傳到 projects/<名稱>/。
 *
 *   POST /__projects/import/begin   { name }                → { token }：檢查名稱，建立暫存資料夾 projects/.import-<token>/
 *   PUT  /__projects/import/file?token=&path=  內容是檔案本身   → 寫進暫存資料夾（path 是專案裡的相對路徑）
 *   POST /__projects/import/commit  { token }               → 有 index.html 才改名成 projects/<名稱>/
 *   POST /__projects/import/cancel  { token }               → 刪掉暫存資料夾
 *
 * 檔案都傳完、確認是專案後才放進 projects/，傳到一半失敗或取消時列表不會出現半個專案。
 * 暫存資料夾是 . 開頭（listProjects 不會列出）；超過一小時沒完成的會在下次開始時清掉。
 */
import { randomBytes } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname, join, relative, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { PROJECTS_DIR, projectDir } from './current-project.js';
import { finishImport, nameError, skipImportSegment } from './project-files.js';
import { readBody, sendJson } from './dev-http';

const PREFIX = '.import-';
/** 單一檔案最大多少（模型、音樂可能很大） */
const MAX_FILE = 512 * 1024 * 1024;
/** 一個專案最多幾個檔案 */
const MAX_FILES = 20000;
/** 多久沒完成就當作放棄 */
const STALE_MS = 60 * 60 * 1000;

interface Pending {
  name: string;
  dir: string;
  files: number;
  touched: number;
}
const pending = new Map<string, Pending>();

/** 回應錯誤（回傳 true：這個網址已經處理了） */
const fail = (res: ServerResponse, status: number, error: string): true => {
  sendJson(res, status, { error });
  return true;
};
/** 回應成功 */
const ok = (res: ServerResponse, body: unknown): true => {
  sendJson(res, 200, body);
  return true;
};

/** 清掉太久沒完成的暫存資料夾（包含開發伺服器重新啟動前留下的） */
function sweep(): void {
  if (!existsSync(PROJECTS_DIR)) return;
  const now = Date.now();
  for (const n of readdirSync(PROJECTS_DIR)) {
    if (!n.startsWith(PREFIX)) continue;
    const dir = join(PROJECTS_DIR, n);
    const job = pending.get(n.slice(PREFIX.length));
    const last = job?.touched ?? statSync(dir).mtimeMs;
    if (now - last > STALE_MS) {
      rmSync(dir, { recursive: true, force: true });
      pending.delete(n.slice(PREFIX.length));
    }
  }
}

/** 專案裡的相對路徑 → 暫存資料夾裡的完整路徑；不合法（..、絕對路徑、要略過的）時回傳 null */
function target(dir: string, path: string): string | null {
  const parts = path.split('/');
  if (!path || path.startsWith('/') || path.includes('\\') || path.includes('\0')) return null;
  if (parts.some((p) => !p || p === '.' || p === '..' || skipImportSegment(p))) return null;
  const full = resolve(dir, ...parts);
  return relative(dir, full).startsWith('..') ? null : full;
}

/** 處理 /__projects/import/…；回傳 false 表示不是這裡的網址 */
export async function handleImport(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  log: { info(msg: string): void },
): Promise<boolean> {
  if (!path.startsWith('/import/')) return false;
  const action = path.slice('/import/'.length);
  const url = new URL(req.url ?? '/', 'http://x');

  if (req.method === 'POST' && action === 'begin') {
    const { name } = JSON.parse(await readBody(req)) as { name?: string };
    const n = String(name ?? '').trim();
    const error = nameError(n) ?? (existsSync(projectDir(n)) ? `已經有專案 ${n}` : null);
    if (error) return fail(res, 400, error);
    sweep();
    const token = randomBytes(8).toString('hex');
    const dir = join(PROJECTS_DIR, PREFIX + token);
    mkdirSync(dir, { recursive: true });
    pending.set(token, { name: n, dir, files: 0, touched: Date.now() });
    return ok(res, { token });
  }

  const token = (action === 'file' ? url.searchParams.get('token') : null) ?? '';
  if (req.method === 'PUT' && action === 'file') {
    const job = pending.get(token);
    if (!job) return fail(res, 404, '這次匯入已經結束，請重新匯入');
    const file = target(job.dir, url.searchParams.get('path') ?? '');
    if (!file) return fail(res, 400, `不能放的路徑：${url.searchParams.get('path')}`);
    if (++job.files > MAX_FILES) return fail(res, 413, `檔案太多（最多 ${MAX_FILES} 個）`);
    if (Number(req.headers['content-length'] ?? 0) > MAX_FILE)
      return fail(res, 413, `檔案太大（最大 ${MAX_FILE / 1024 / 1024} MB）`);
    job.touched = Date.now();
    mkdirSync(dirname(file), { recursive: true });
    await pipeline(req, createWriteStream(file));
    return ok(res, { ok: true });
  }

  if (req.method === 'POST' && (action === 'commit' || action === 'cancel')) {
    const body = JSON.parse(await readBody(req)) as { token?: string };
    const job = pending.get(String(body.token ?? ''));
    if (!job) return fail(res, 404, '這次匯入已經結束，請重新匯入');
    pending.delete(String(body.token));
    if (action === 'cancel') {
      rmSync(job.dir, { recursive: true, force: true });
      return ok(res, { ok: true });
    }
    try {
      finishImport(job.dir, job.name);
    } catch (error) {
      rmSync(job.dir, { recursive: true, force: true });
      return fail(res, 400, (error as Error).message);
    }
    log.info(`\n✓ 已匯入專案 projects/${job.name}/（入口頁，${job.files} 個檔案）`);
    return ok(res, { ok: true, name: job.name, files: job.files });
  }

  return fail(res, 404, '沒有這個操作');
}
