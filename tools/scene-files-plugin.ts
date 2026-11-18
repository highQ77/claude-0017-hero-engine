/**
 * 開發伺服器外掛：讓 3D 場景編輯器可以列出、讀取、儲存、刪除、重新命名
 * public/scenes 裡的場景檔與 public/prefabs 裡的預製物件檔（格式和場景檔一樣）。
 * 檔案可以是 .xml（編輯器預設）或 .json，內容格式見 src/scene/SceneXml.ts、src/scene/SceneFile.ts。
 * 只在開發伺服器（node hero dev）時有作用；編輯器不會編譯到 dist，但場景檔在 public/ 裡，會照常發佈。
 *
 * 場景檔可以分類放在一層子資料夾裡（例如 public/scenes/forest/cave.xml），
 * 檔名就寫成「資料夾/檔名.xml」（網址裡的 / 要編碼成 %2F）。
 *
 * API（只接受 public/scenes 裡、最多一層資料夾的 .xml、.json）：
 *   GET    /__scenes/files             → [{ name, size, mtime }]
 *   GET    /__scenes/files/<名稱>        檔案內容（直接讀磁碟）
 *   PUT    /__scenes/files/<名稱>        內容為場景檔（建立或覆蓋；不是正確的 XML／JSON 會拒絕）
 *   DELETE /__scenes/files/<名稱>
 *   POST   /__scenes/rename            { from, to }
 *   GET    /__scenes/assets            → [{ path, size, mtime }]：public 底下的模型、貼圖、音效（素材面板用；ui/ 不列）
 *   GET    /__scenes/scripts           → [{ name, file, line, doc, props }]：專案 src/ 裡的腳本類別與參數（「加入腳本」用）
 *   預製物件：/__prefabs/files…、/__prefabs/rename，用法和場景檔一樣（public/prefabs）
 *
 * 檔案改了（存檔或手動修改）會送出 Vite 的自訂事件 hero:file-changed { path: 'scenes/forest.xml' }，
 * 遊戲裡用 load.sceneFile 載入的場景會自動重新載入。
 */
import { promises as fs } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import type { Plugin } from 'vite';
import { parseXml } from '../src/core/xml';
import { exists, httpError, listFiles, readBody, sendError, sendJson } from './dev-http';
import { scanScripts, type ScriptInfo } from './script-scan';

/** 一段名稱：英數字、中文、- _ .，不能以 . 開頭（避免 .. 這類路徑） */
const SEGMENT = '[\\w\\-㐀-鿿][\\w\\-.㐀-鿿]*';
const VALID_NAME = new RegExp(`^(?:${SEGMENT}/)?${SEGMENT}\\.(?:xml|json)$`);
/** 場景檔的副檔名 */
const SCENE_FILE = /\.(?:xml|json)$/;
const VALID_FOLDER = new RegExp(`^${SEGMENT}$`);
/** 素材面板列出的檔案：模型、貼圖、音效 */
const ASSET_FILE = /\.(glb|gltf|fbx|obj|png|jpe?g|webp|ktx2|hdr|exr|mp3|ogg|wav|m4a|shader\.json)$/i;
const MAX_SIZE = 8 * 1024 * 1024;

export function sceneFilesPlugin(): Plugin {
  let publicDir = '';
  let projectRoot = '';

  /** 專案 src/ 裡的腳本（每次重新讀：改了程式馬上看得到） */
  const listScripts = async () => {
    const found: ScriptInfo[] = [];
    const walk = async (dir: string) => {
      let entries: import('node:fs').Dirent[];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (e.name.startsWith('.') || e.name === 'node_modules') continue;
        const p = join(dir, e.name);
        if (e.isDirectory()) await walk(p);
        else if (/\.tsx?$/.test(e.name) && !/\.d\.ts$/.test(e.name)) {
          const text = await fs.readFile(p, 'utf8');
          if (text.includes('extends Script'))
            found.push(...scanScripts(text, relative(projectRoot, p).split(sep).join('/')));
        }
      }
    };
    await walk(join(projectRoot, 'src'));
    // 同名的只留第一個（場景檔用名稱找腳本）
    const seen = new Set<string>();
    return found.filter((s) => !seen.has(s.name) && seen.add(s.name)).sort((a, b) => a.name.localeCompare(b.name));
  };

  /** 根目錄與一層子資料夾裡的場景檔（.xml、.json） */
  const list = (dir: string) => listFiles(dir, SCENE_FILE, VALID_FOLDER);

  /** public 底下的模型與貼圖（略過 ui/ 與 . 開頭的檔案），路徑相對於 public */
  const listAssets = async () => {
    const out: { path: string; size: number; mtime: number }[] = [];
    const walk = async (sub: string) => {
      for (const e of await fs.readdir(join(publicDir, sub), { withFileTypes: true })) {
        if (e.name.startsWith('.')) continue;
        const rel = sub ? `${sub}/${e.name}` : e.name;
        if (e.isDirectory()) {
          if (rel !== 'ui') await walk(rel);
        } else if (e.isFile() && ASSET_FILE.test(e.name)) {
          const st = await fs.stat(join(publicDir, rel));
          out.push({ path: rel, size: st.size, mtime: st.mtimeMs });
        }
      }
    };
    try {
      await walk('');
    } catch (error) {
      if ((error as { code?: string }).code !== 'ENOENT') throw error;
    }
    return out.sort((a, b) => a.path.localeCompare(b.path));
  };

  const fileOf = (dir: string, name: string) => {
    if (!VALID_NAME.test(name))
      throw httpError(400, `不合法的檔名：${name}（只能是 .xml 或 .json，最多一層資料夾，例如 forest/cave.xml）`);
    return join(dir, name);
  };

  return {
    name: 'scene-files',
    configResolved(config) {
      publicDir = resolve(config.root, config.publicDir || 'public');
      projectRoot = config.root;
    },
    // 存檔不要讓頁面整個重新整理（編輯器自己會更新）
    // 存檔（編輯器或手動修改）：通知開著的遊戲重新載入用到它的場景（src/scene/SceneFile.ts 的 notifySceneFileChanged）
    handleHotUpdate(ctx) {
      const inside = ['scenes', 'prefabs'].some((d) => ctx.file.startsWith(join(publicDir, d) + sep));
      if (!inside || !SCENE_FILE.test(ctx.file)) return;
      const path = relative(publicDir, ctx.file).split(sep).join('/');
      ctx.server.ws.send({ type: 'custom', event: 'hero:file-changed', data: { path } });
      return [];
    },
    configureServer(server) {
      for (const [route, folder] of [
        ['/__scenes', 'scenes'],
        ['/__prefabs', 'prefabs'],
      ] as const) {
        const dir = () => join(publicDir, folder);
        server.middlewares.use(route, async (req, res) => {
          try {
            const path = new URL(req.url ?? '/', 'http://x').pathname;
            if (req.method === 'GET' && path === '/files') return sendJson(res, 200, await list(dir()));
            if (req.method === 'GET' && path === '/assets' && folder === 'scenes')
              return sendJson(res, 200, await listAssets());
            if (req.method === 'GET' && path === '/scripts' && folder === 'scenes')
              return sendJson(res, 200, await listScripts());
            const m = /^\/files\/([^/]+)$/.exec(path);
            if (m) {
              const file = fileOf(dir(), decodeURIComponent(m[1]));
              if (req.method === 'GET') {
                const text = await fs.readFile(file, 'utf8');
                res.statusCode = 200;
                res.setHeader(
                  'Content-Type',
                  file.endsWith('.xml') ? 'application/xml; charset=utf-8' : 'application/json; charset=utf-8',
                );
                res.setHeader('Cache-Control', 'no-store');
                return res.end(text);
              }
              if (req.method === 'PUT') {
                const body = await readBody(req, MAX_SIZE);
                const xml = file.endsWith('.xml');
                try {
                  if (xml) parseXml(body);
                  else JSON.parse(body);
                } catch (error) {
                  throw httpError(400, `不是正確的 ${xml ? 'XML' : 'JSON'}：${(error as Error).message}`);
                }
                await fs.mkdir(dirname(file), { recursive: true });
                await fs.writeFile(file, body, 'utf8');
                return sendJson(res, 200, { ok: true, files: await list(dir()) });
              }
              if (req.method === 'DELETE') {
                await fs.unlink(file);
                return sendJson(res, 200, { ok: true, files: await list(dir()) });
              }
            }
            if (req.method === 'POST' && path === '/rename') {
              const { from, to } = JSON.parse(await readBody(req)) as { from: string; to: string };
              const target = fileOf(dir(), to);
              // 內容不會轉換：不能只改副檔名（.json ↔ .xml）
              if (from.slice(from.lastIndexOf('.')) !== to.slice(to.lastIndexOf('.')))
                return sendJson(res, 400, { error: '重新命名不能改副檔名（.xml、.json 的內容格式不同）' });
              if (await exists(fs, target)) return sendJson(res, 409, { error: `已經有檔案「${to}」` });
              await fs.mkdir(dirname(target), { recursive: true });
              await fs.rename(fileOf(dir(), from), target);
              return sendJson(res, 200, { ok: true, files: await list(dir()) });
            }
            sendJson(res, 404, { error: '沒有這個操作' });
          } catch (error) {
            sendError(res, error);
          }
        });
      }
    },
  };
}
