/**
 * 開發伺服器外掛：讓音效編輯器列出、讀取、儲存、刪除專案 public/sounds 裡的音效檔。
 * 每個音效是兩個檔案：<名稱>.sfx.json（合成參數，可以再編輯）與 <名稱>.wav（烘焙好的聲音，遊戲播放這個）。
 * 檔案格式見 src/editors/se-editor/sfx.ts。只在開發伺服器（node hero dev）時有作用；檔案在 public/ 裡，會照常發佈。
 *
 * API（名稱是英數字、-、_）：
 *   GET    /__sounds/files             → [{ name, size, mtime }]：所有 .sfx.json
 *   GET    /__sounds/wavs              → ['bounce.wav', …]：所有 .wav（新增時檢查會不會覆蓋別的音檔）
 *   GET    /__sounds/files/<名稱>.sfx.json   檔案內容
 *   PUT    /__sounds/files/<名稱>.sfx.json   內容 { sfx: 音效檔, wav: .wav 的 base64 }：兩個檔案一起寫入
 *   DELETE /__sounds/files/<名稱>.sfx.json   兩個檔案一起刪除
 */
import { promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Plugin } from 'vite';
import { parseSfx, stringifySfx } from '../src/editors/se-editor/sfx';
import { wavInfo } from '../src/editors/se-editor/wav';
import { httpError, listFiles, readBody, sendError, sendJson } from './dev-http';

/** 最大 16MB（.wav 以 base64 放在 JSON 裡） */
const MAX_SIZE = 16 * 1024 * 1024;
/** 檔名：英數字、-、_ 加上 .sfx.json */
const VALID = /^[A-Za-z0-9_-]+\.sfx\.json$/;

export function soundFilesPlugin(): Plugin {
  let dir = '';
  const fileOf = (name: string) => {
    if (!VALID.test(name)) throw httpError(400, `檔名「${name}」不合法：要是 英數字-_.sfx.json`);
    return join(dir, name);
  };
  const wavOf = (sfxFile: string) => sfxFile.replace(/\.sfx\.json$/, '.wav');
  return {
    name: 'hero-sound-files',
    apply: 'serve',
    configResolved(config) {
      dir = join(resolve(config.root, config.publicDir || 'public'), 'sounds');
    },
    configureServer(server) {
      server.middlewares.use('/__sounds', async (req, res) => {
        try {
          const path = new URL(req.url ?? '/', 'http://x').pathname;
          if (req.method === 'GET' && path === '/files') return sendJson(res, 200, await listFiles(dir, VALID));
          if (req.method === 'GET' && path === '/wavs')
            return sendJson(
              res,
              200,
              (await listFiles(dir, /\.wav$/i)).map((f) => f.name),
            );
          const m = /^\/files\/([^/]+)$/.exec(path);
          if (m) {
            const file = fileOf(decodeURIComponent(m[1]));
            if (req.method === 'GET') {
              res.statusCode = 200;
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.setHeader('Cache-Control', 'no-store');
              return res.end(await fs.readFile(file, 'utf8'));
            }
            if (req.method === 'PUT') {
              const body = JSON.parse(await readBody(req, MAX_SIZE)) as { sfx?: unknown; wav?: unknown };
              let text: string;
              let wav: Buffer;
              try {
                text = stringifySfx(parseSfx(body.sfx));
                if (typeof body.wav !== 'string') throw new Error('缺少 wav（base64）');
                wav = Buffer.from(body.wav, 'base64');
                wavInfo(new Uint8Array(wav.buffer, wav.byteOffset, wav.byteLength));
              } catch (error) {
                throw httpError(400, `不是正確的音效：${(error as Error).message}`);
              }
              await fs.mkdir(dir, { recursive: true });
              await fs.writeFile(file, text, 'utf8');
              await fs.writeFile(wavOf(file), wav);
              return sendJson(res, 200, { ok: true, files: await listFiles(dir, VALID) });
            }
            if (req.method === 'DELETE') {
              await fs.unlink(file);
              await fs.rm(wavOf(file), { force: true });
              return sendJson(res, 200, { ok: true, files: await listFiles(dir, VALID) });
            }
          }
          sendJson(res, 404, { error: '沒有這個操作' });
        } catch (error) {
          sendError(res, error);
        }
      });
    },
  };
}
