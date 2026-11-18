/**
 * 開發伺服器外掛：讓 UI 編輯器可以列出、儲存、刪除、重新命名 public/ui/*.xml。
 * 只在開發伺服器（node hero dev）時有作用；UI 編輯器不會編譯到 dist。
 *
 * 介面檔可以分類放在一層子資料夾裡（例如每個場景一個資料夾：public/ui/forest/hud.xml），
 * 檔名就寫成「資料夾/檔名.xml」（網址裡的 / 要編碼成 %2F）。
 *
 * API（只接受 public/ui 裡、最多一層資料夾的 .xml）：
 *   GET    /__ui/files              → [{ name, size, mtime }]（name 例如 scene.xml、forest/hud.xml）
 *   GET    /__ui/files/<名稱>.xml    檔案內容（直接讀磁碟：剛建立的檔案 Vite 的靜態檔清單可能還沒更新）
 *   PUT    /__ui/files/<名稱>.xml    內容為 XML 文字（建立或覆蓋；資料夾不存在會建立）
 *   DELETE /__ui/files/<名稱>.xml
 *   POST   /__ui/rename             { from, to }（可以移到別的資料夾）
 *   GET    /__ui/folders            → [名稱]：介面檔的資料夾（有 .xml 或是空的；只放圖片的資料夾不列）
 *   POST   /__ui/folders            { name }：新增資料夾
 *   POST   /__ui/folders/rename     { from, to }
 *   DELETE /__ui/folders/<名稱>      刪除資料夾（裡面要先清空）
 *   GET    /__ui/assets             → [{ path, size, mtime }]：public/ui 底下的圖片（含子資料夾；資源管理器用）
 */
import { promises as fs } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Plugin } from 'vite';
import { listFiles, readBody as readRequestBody, sendError, sendJson as send } from './dev-http';

/** 一段名稱：英數字、中文、- _ .，不能以 . 開頭（避免 .. 這類路徑） */
const SEGMENT = '[\\w\\-㐀-鿿][\\w\\-.㐀-鿿]*';
/** 介面檔：檔名.xml 或 資料夾/檔名.xml */
const VALID_NAME = new RegExp(`^(?:${SEGMENT}/)?${SEGMENT}\\.xml$`);
const VALID_FOLDER = new RegExp(`^${SEGMENT}$`);
/** 資源管理器列出的圖片格式 */
const IMAGE_FILE = /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)$/i;
const MAX_SIZE = 2 * 1024 * 1024;

export function uiFilesPlugin(options: { dir?: string } = {}): Plugin {
  let dir = '';

  /** 根目錄與一層子資料夾裡的 .xml */
  const list = () => listFiles(dir, /\.xml$/, VALID_FOLDER);

  /** 介面檔的資料夾：有 .xml 或是空的（只放圖片的資料夾不算） */
  const listFolders = async () => {
    const out: string[] = [];
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      if (!e.isDirectory() || !VALID_FOLDER.test(e.name)) continue;
      const inner = (await fs.readdir(join(dir, e.name))).filter((n) => !n.startsWith('.'));
      if (inner.length === 0 || inner.some((n) => n.endsWith('.xml'))) out.push(e.name);
    }
    return out.sort();
  };

  const folderOf = (name: string) => {
    if (!VALID_FOLDER.test(name)) throw Object.assign(new Error(`不合法的資料夾名稱：${name}`), { status: 400 });
    return join(dir, name);
  };

  /** public/ui 底下的圖片（含子資料夾；略過 . 開頭的隱藏檔），路徑以 / 分隔、相對於 public/ui */
  const listAssets = async () => {
    const out: { path: string; size: number; mtime: number }[] = [];
    const walk = async (sub: string) => {
      const entries = await fs.readdir(join(dir, sub), { withFileTypes: true });
      for (const e of entries) {
        if (e.name.startsWith('.')) continue;
        const rel = sub ? `${sub}/${e.name}` : e.name;
        if (e.isDirectory()) await walk(rel);
        else if (e.isFile() && IMAGE_FILE.test(e.name)) {
          const st = await fs.stat(join(dir, rel));
          out.push({ path: rel, size: st.size, mtime: st.mtimeMs });
        }
      }
    };
    try {
      await walk('');
    } catch (error) {
      if ((error as { code?: string }).code !== 'ENOENT') throw error; // 還沒有 ui 資料夾：清單是空的
    }
    return out.sort((a, b) => a.path.localeCompare(b.path));
  };

  const fileOf = (name: string) => {
    const decoded = decodeURIComponent(name);
    if (!VALID_NAME.test(decoded))
      throw Object.assign(new Error(`不合法的檔名：${decoded}（只能是 .xml，最多一層資料夾，例如 forest/hud.xml）`), {
        status: 400,
      });
    return join(dir, decoded);
  };

  const readBody = (req: Parameters<typeof readRequestBody>[0]) => readRequestBody(req, MAX_SIZE);

  return {
    name: 'ui-files',
    configResolved(config) {
      dir = resolve(config.root, options.dir ?? join(config.publicDir || 'public', 'ui'));
    },
    // 存檔不要讓頁面整個重新整理（編輯器自己會更新）
    handleHotUpdate(ctx) {
      if (ctx.file.startsWith(dir) && ctx.file.endsWith('.xml')) return [];
    },
    configureServer(server) {
      server.middlewares.use('/__ui', async (req, res) => {
        try {
          const url = new URL(req.url ?? '/', 'http://x');
          const path = url.pathname;
          if (req.method === 'GET' && path === '/files') return send(res, 200, await list());
          if (req.method === 'GET' && path === '/assets') return send(res, 200, await listAssets());
          const m = /^\/files\/([^/]+)$/.exec(path);
          if (m && req.method === 'GET') {
            const text = await fs.readFile(fileOf(m[1]), 'utf8');
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/xml; charset=utf-8');
            res.setHeader('Cache-Control', 'no-store');
            return res.end(text);
          }
          if (m && req.method === 'PUT') {
            const file = fileOf(m[1]);
            await fs.mkdir(dirname(file), { recursive: true });
            await fs.writeFile(file, await readBody(req), 'utf8');
            return send(res, 200, { ok: true, files: await list() });
          }
          if (m && req.method === 'DELETE') {
            await fs.unlink(fileOf(m[1]));
            return send(res, 200, { ok: true, files: await list() });
          }
          // 除錯紀錄（遊戲網址加 ?debug=pointer 時送來）：寫到專案的 .debug/pointer.log
          if (req.method === 'POST' && path === '/log') {
            const logDir = resolve(dir, '..', '..', '.debug');
            await fs.mkdir(logDir, { recursive: true });
            const body = await readBody(req);
            await fs.appendFile(join(logDir, 'pointer.log'), body.endsWith('\n') ? body : `${body}\n`, 'utf8');
            return send(res, 200, { ok: true });
          }
          if (req.method === 'POST' && path === '/rename') {
            const { from, to } = JSON.parse(await readBody(req)) as { from: string; to: string };
            const target = fileOf(encodeURIComponent(to));
            try {
              await fs.access(target);
              return send(res, 409, { error: `已經有檔案「${to}」` });
            } catch {
              /* 不存在才能改名 */
            }
            await fs.mkdir(dirname(target), { recursive: true }); // 移到別的資料夾
            await fs.rename(fileOf(encodeURIComponent(from)), target);
            return send(res, 200, { ok: true, files: await list() });
          }
          // ───── 資料夾 ─────
          if (req.method === 'GET' && path === '/folders') return send(res, 200, await listFolders());
          if (req.method === 'POST' && path === '/folders') {
            const { name } = JSON.parse(await readBody(req)) as { name: string };
            const target = folderOf(name);
            try {
              await fs.access(target);
              return send(res, 409, { error: `已經有資料夾「${name}」` });
            } catch {
              /* 不存在才能新增 */
            }
            await fs.mkdir(target, { recursive: true });
            return send(res, 200, { ok: true, folders: await listFolders() });
          }
          if (req.method === 'POST' && path === '/folders/rename') {
            const { from, to } = JSON.parse(await readBody(req)) as { from: string; to: string };
            const target = folderOf(to);
            try {
              await fs.access(target);
              return send(res, 409, { error: `已經有資料夾「${to}」` });
            } catch {
              /* 不存在才能改名 */
            }
            await fs.rename(folderOf(from), target);
            return send(res, 200, { ok: true, folders: await listFolders(), files: await list() });
          }
          const fm = /^\/folders\/([^/]+)$/.exec(path);
          if (fm && req.method === 'DELETE') {
            const name = decodeURIComponent(fm[1]);
            try {
              await fs.rmdir(folderOf(name)); // 只能刪空的資料夾
            } catch (error) {
              if ((error as { code?: string }).code === 'ENOTEMPTY')
                return send(res, 409, { error: `資料夾「${name}」裡還有檔案，請先移走或刪除` });
              throw error;
            }
            return send(res, 200, { ok: true, folders: await listFolders() });
          }
          send(res, 404, { error: '沒有這個操作' });
        } catch (error) {
          sendError(res, error);
        }
      });
    },
  };
}
