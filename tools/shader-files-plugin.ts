/**
 * 開發伺服器外掛：讓著色器編輯器列出、讀取、儲存、刪除專案 public/shaders 裡的節點圖檔（*.shader.json）。
 * 檔案格式見 src/shaders/graph/file.ts；遊戲用 loadShaderGraph('shaders/名稱.shader.json') 載入。
 * 只在開發伺服器（node hero dev）時有作用；檔案在 public/ 裡，會照常發佈。
 *
 * API（只接受 public/shaders 裡的 <名稱>.shader.json，名稱是英數字、-、_）：
 *   GET    /__shaders/files            → [{ name, size, mtime }]
 *   GET    /__shaders/files/<名稱>      檔案內容
 *   PUT    /__shaders/files/<名稱>      內容為節點圖檔（建立或覆蓋；不是正確的節點圖會拒絕）
 *   DELETE /__shaders/files/<名稱>
 *
 * 檔案改了（存檔或手動修改）會送出 Vite 的自訂事件 hero:file-changed { path: 'shaders/lava.shader.json' }，
 * 開著的遊戲、3D 場景編輯器裡用 { shaderGraph } 材質描述的物件會自動更新（src/shaders/graph/material.ts）。
 */
import { promises as fs } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import type { Plugin } from 'vite';
import { parseShaderGraphFile } from '../src/shaders/graph/file';
import { httpError, listFiles, readBody, sendError, sendJson } from './dev-http';

/** 節點圖檔最大 16MB（圖片以 data URL 存在檔案裡） */
const MAX_SIZE = 16 * 1024 * 1024;
/** 檔名：英數字、-、_ 加上 .shader.json */
const VALID = /^[A-Za-z0-9_-]+\.shader\.json$/;

export function shaderFilesPlugin(): Plugin {
  let dir = '';
  let publicDir = '';
  const fileOf = (name: string) => {
    if (!VALID.test(name)) throw httpError(400, `檔名「${name}」不合法：要是 英數字-_.shader.json`);
    return join(dir, name);
  };
  const list = () => listFiles(dir, VALID);
  return {
    name: 'hero-shader-files',
    apply: 'serve',
    configResolved(config) {
      publicDir = resolve(config.root, config.publicDir || 'public');
      dir = join(publicDir, 'shaders');
    },
    // 存檔：通知開著的頁面重新載入用到它的材質，不要整頁重新整理
    handleHotUpdate(ctx) {
      if (!ctx.file.startsWith(dir + sep) || !VALID.test(ctx.file.slice(dir.length + 1))) return;
      const path = relative(publicDir, ctx.file).split(sep).join('/');
      ctx.server.ws.send({ type: 'custom', event: 'hero:file-changed', data: { path } });
      return [];
    },
    configureServer(server) {
      server.middlewares.use('/__shaders', async (req, res) => {
        try {
          const path = new URL(req.url ?? '/', 'http://x').pathname;
          if (req.method === 'GET' && path === '/files') return sendJson(res, 200, await list());
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
              const body = await readBody(req, MAX_SIZE);
              try {
                parseShaderGraphFile(body);
              } catch (error) {
                throw httpError(400, `不是正確的節點圖檔：${(error as Error).message}`);
              }
              await fs.mkdir(dir, { recursive: true });
              await fs.writeFile(file, body, 'utf8');
              return sendJson(res, 200, { ok: true, files: await list() });
            }
            if (req.method === 'DELETE') {
              await fs.unlink(file);
              return sendJson(res, 200, { ok: true, files: await list() });
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
