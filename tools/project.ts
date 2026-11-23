/**
 * 遊戲專案的 Vite 設定（引擎與遊戲分開放）：
 *
 *   src/                 引擎（遊戲用 import ... from '@engine/ui2d' 引用）
 *   src/editors/         開發用的編輯器（只在 node hero dev 時使用，不會編譯到 dist）
 *     ui-editor/         UI 編輯器（index.html + editor.ts）：/ui-editor.html，編輯的是專案的 public/ui
 *     s3d-editor/        3D 場景編輯器：/s3d-editor.html，編輯的是專案的 public/scenes
 *     shader-editor/     著色器編輯器（節點式）：/shader-editor.html，編輯的是專案的 public/shaders
 *     se-editor/         音效編輯器（Tone.js 合成）：/se-editor.html，編輯的是專案的 public/sounds（.sfx.json + .wav）
 *     portal/            入口頁：/portal.html，專案列表：切換（同 node hero select）、新增、刪除專案，編輯專案說明
 *   doc/                 使用手冊：開發時在 /doc（docServerPlugin：手冊自己的 Vite 伺服器掛在這個伺服器底下）
 *   projects/<名稱>/      遊戲專案：index.html、src/、public/（介面檔、音效、模型…）
 *
 * 指令：node hero create／select／remove／dev／build／doc（見根目錄的 hero.js）
 * 開發時也可以在入口頁、3D 場景編輯器裡切換專案（projectSwitchPlugin：開發伺服器換成另一個專案後重新啟動）
 * 打包：node hero build 輸出到 dist/<名稱>/web/（public/scenes、public/prefabs、public/ui 的 .xml 與 public/shaders 的 .json 轉成保護過的 JS 模組，見 packed-files-plugin.ts）；
 *       --mac 再用 Tauri 包成 dist/<名稱>/mac/<名稱>.app（外殼範本在 tools/tauri/）
 */
import { promises as fs } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import type { Plugin, UserConfig, ViteDevServer } from 'vite';
import { DEFAULT_PROJECT, PROJECTS_DIR, ROOT, SELECTION_FILE } from './current-project.js';
import { createProject, listProjects, removeError, removeProject, removeTargets } from './project-files.js';
import { readBody, sendError, sendJson } from './dev-http';
import { ENGINE_DEPS } from './engine-deps';
import { type BuildTarget, currentBuild, isBuilding, startBuild } from './project-build';
import { handleImport } from './project-import';
import { packedFilesPlugin } from './packed-files-plugin';
import { sceneFilesPlugin } from './scene-files-plugin';
import { shaderFilesPlugin } from './shader-files-plugin';
import { soundFilesPlugin } from './sound-files-plugin';
import { uiFilesPlugin } from './ui-files-plugin';

/** 引擎根目錄（這個檔案在 tools/ 底下） */
export const ENGINE_ROOT = resolve(__dirname, '..');
const ENGINE_SRC = join(ENGINE_ROOT, 'src');
/** 開發時提供的編輯器：網址 /<名稱>.html，頁面是 src/editors/<名稱>/index.html */
const EDITORS = ['ui-editor', 's3d-editor', 'shader-editor', 'se-editor', 'portal'] as const;
const editorHtmlPath = (name: string) => join(ENGINE_SRC, 'editors', name, 'index.html');
/** transformIndexHtml 放進頁面的 Vite 用戶端（熱更新、伺服器重新啟動時整頁重新整理） */
const VITE_CLIENT = /<script type="module" src="\/@vite\/client"><\/script>\s*/;
/** 編輯器頁面的入口（和 index.html 在同一個資料夾） */
const EDITOR_ENTRY = /<script type="module" src="\.\/editor\.ts"><\/script>/;

export function defineProject(projectDir: string): UserConfig {
  const root = resolve(projectDir);
  return {
    root,
    // 相對路徑：打包結果放在網站的任何路徑（例如 https://example.com/games/my-game/）都找得到 assets/；
    // 開發伺服器把 './' 當成 '/'，不受影響
    base: './',
    publicDir: join(root, 'public'),
    // 預先打包套件的快取：每個專案一份。Vite 的快取和專案資料夾綁在一起，共用一份時每次切換專案都要整個重新打包，
    // 重新打包到一半時伺服器又重新啟動（切換專案、改 tools/）會留下壞掉的快取（入口頁變成空白）
    cacheDir: join(ENGINE_ROOT, 'node_modules', '.vite', 'projects', basename(root)),
    // '@engine' 是總入口（src/index.ts），'@engine/模組' 是各模組
    resolve: {
      alias: [
        // 只用 WebGPU（three.js 的 WebGPURenderer）：'three' 指向 three/webgpu，WebGL 的繪製器不會被打包進來
        // （兩者共用 three.core；three/webgpu 少的只有 WebGLRenderer、ShaderChunk 這些 WebGL 專用的東西）
        { find: /^three$/, replacement: 'three/webgpu' },
        { find: /^@engine$/, replacement: join(ENGINE_SRC, 'index.ts') },
        { find: '@engine', replacement: ENGINE_SRC },
      ],
    },
    plugins: [
      uiFilesPlugin(),
      sceneFilesPlugin(),
      shaderFilesPlugin(),
      soundFilesPlugin(),
      packedFilesPlugin(),
      skipBundledDracoPlugin(),
      engineEditorPlugin(),
      docServerPlugin(),
      projectSwitchPlugin(root),
    ],
    server: { fs: { allow: [ENGINE_ROOT] } },
    // ES2022：支援頂層 await（物理引擎、排版引擎需要非同步初始化）
    build: {
      target: 'es2022',
      outDir: join(ENGINE_ROOT, 'dist', basename(root)),
      emptyOutDir: true,
      // 只編譯遊戲頁面；編輯器（src/editors）是開發工具，不會發佈
      rollupOptions: { input: { main: join(root, 'index.html') } },
    },
    // 引擎與編輯器用到的套件啟動時就先打包（tools/engine-deps.ts）：入口頁、編輯器打開時不會再發現新套件
    optimizeDeps: { include: ENGINE_DEPS, esbuildOptions: { target: 'es2022' } },
  };
}

/**
 * three.js r17x 起，DRACOLoader 用 new URL('../libs/draco/…', import.meta.url) 指向自帶的解碼器，
 * 打包時這些檔案（約 1.1 MB）會被複製到輸出資料夾。引擎只在設定 dracoDecoderPath 時才建立 DRACOLoader，
 * 而且一定會呼叫 setDecoderPath（src/assets/loaders.ts），自帶的解碼器用不到：打包時把這些網址換成空字串。
 */
function skipBundledDracoPlugin(): Plugin {
  const DRACO_URL = /new URL\(\s*'\.\.\/libs\/draco\/[^']+',\s*import\.meta\.url\s*\)\.toString\(\)/g;
  return {
    name: 'skip-bundled-draco',
    apply: 'build',
    enforce: 'pre',
    transform(code, id) {
      if (!/three\/examples\/jsm\/loaders\/DRACOLoader\.js$/.test(id.split('?')[0])) return null;
      const out = code.replace(DRACO_URL, "''");
      return out === code ? null : { code: out, map: null };
    },
  };
}

/** 專案說明所在的那一行：src/main.ts 第一個 /** 註解的第一行（[1] 是行首的「 * 」，[2] 是內容） */
const SUMMARY_LINE = /^\/\*\*[ \t]*\r?\n([ \t]*\*[ \t]*)(.+)$/m;
const mainTs = (name: string) => join(PROJECTS_DIR, name, 'src', 'main.ts');

/** 專案的一句話說明：src/main.ts 開頭註解的第一行「名稱：說明。」（沒有時是空字串） */
async function projectSummary(name: string): Promise<string> {
  try {
    const src = await fs.readFile(mainTs(name), 'utf8');
    const line = SUMMARY_LINE.exec(src)?.[2] ?? '';
    return line
      .replace(/^[\w.-]+\s*[：:]\s*/, '')
      .replace(/。$/, '')
      .trim();
  } catch {
    return '';
  }
}

/** 改專案說明：改寫 src/main.ts 開頭註解的第一行（沒有開頭註解時加一個） */
async function setProjectSummary(name: string, summary: string): Promise<void> {
  const text = summary.trim().replace(/。$/, '');
  if (!text) throw new Error('請輸入說明');
  if (/[\r\n]/.test(text) || text.includes('*/')) throw new Error('說明只能一行，而且不能有 */');
  if (text.length > 80) throw new Error('說明最多 80 個字');
  const file = mainTs(name);
  const src = await fs.readFile(file, 'utf8');
  const line = `${name}：${text}。`;
  const m = SUMMARY_LINE.exec(src);
  const next = m
    ? src.slice(0, m.index) + m[0].replace(/[^\n]*$/, `${m[1]}${line}`) + src.slice(m.index + m[0].length)
    : `/**\n * ${line}\n */\n${src}`;
  await fs.writeFile(file, next);
}

/** node hero select 存的專案（.selected-project；沒有時是空字串） */
async function savedProject(): Promise<string> {
  try {
    return (await fs.readFile(SELECTION_FILE, 'utf8')).trim();
  } catch {
    return '';
  }
}

/**
 * 開發時在編輯器裡切換專案（只影響這次執行的開發伺服器；要改預設的專案用 node hero select）：
 *   GET  /__projects          → { current, saved, default, platform, projects: [名稱], details: [{ name, summary }] }
 *   POST /__projects/select   { name, save? }：開發伺服器換成這個專案並重新啟動（開著的頁面會自動重新整理）；
 *                             save: true 時也寫進 .selected-project（等同 node hero select 名稱，入口頁用）
 *   POST /__projects/create   { name }：用範本建立空專案（等同 node hero create 名稱）
 *   POST /__projects/summary  { name, summary }：改專案說明（src/main.ts 開頭註解的第一行）
 *   GET  /__projects/remove?name=  → { targets: [{ path, files }], selected, switchTo }：刪除前顯示會刪掉什麼
 *   POST /__projects/remove   { name }：刪除專案（等同 node hero remove 名稱，確認由入口頁負責）；
 *                             刪的是這次執行正在用的專案時，先換成預設專案、重新啟動後再刪（回傳 restarting: true）
 *   POST /__projects/build    { name, target: 'web'|'mac', fullscreen? }：在背景打包這個專案（等同 PROJECT=名稱 node hero build；
 *                             不切換專案）。同一時間只能打包一個（tools/project-build.ts）
 *   GET  /__projects/build    → { job }：目前（或最後一次）打包的狀態：步驟、紀錄、輸出位置
 *   /__projects/import/…      匯入別人的專案：把瀏覽器選的資料夾或 zip 的內容傳到 projects/<名稱>/（tools/project-import.ts）
 * 做法：改這個程序的環境變數 PROJECT（vite.config.ts 用它決定專案），再讓 Vite 重新讀取設定。
 */
function projectSwitchPlugin(root: string): Plugin {
  const current = basename(root);
  return {
    name: 'project-switch',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__projects', async (req, res) => {
        try {
          const path = new URL(req.url ?? '/', 'http://x').pathname;
          if (req.method === 'GET' && path === '/') {
            const projects = listProjects();
            const details = await Promise.all(
              projects.map(async (name) => ({ name, summary: await projectSummary(name) })),
            );
            return sendJson(res, 200, {
              current,
              saved: await savedProject(),
              default: DEFAULT_PROJECT,
              platform: process.platform,
              projects,
              details,
            });
          }
          if (req.method === 'POST' && path === '/select') {
            const { name, save } = JSON.parse(await readBody(req)) as { name?: string; save?: boolean };
            if (typeof name !== 'string' || !listProjects().includes(name))
              return sendJson(res, 400, { error: `找不到專案「${name}」（projects/${name}/index.html）` });
            if (save) await fs.writeFile(SELECTION_FILE, `${name}\n`);
            if (name === current) return sendJson(res, 200, { ok: true, restarting: false });
            process.env.PROJECT = name;
            sendJson(res, 200, { ok: true, restarting: true });
            // 回應送出後再重新啟動（重新讀取 vite.config.ts → 新的專案）
            setTimeout(() => {
              server.config.logger.info(`\n▶ 切換專案：${current} → ${name}（編輯器要求）`);
              void server.restart();
            }, 50);
            return;
          }
          if (await handleImport(req, res, path, server.config.logger)) return;
          if (path === '/build') {
            if (req.method === 'GET') return sendJson(res, 200, { job: currentBuild() });
            if (req.method === 'POST') {
              const { name, target, fullscreen } = JSON.parse(await readBody(req)) as {
                name?: string;
                target?: string;
                fullscreen?: boolean;
              };
              if (typeof name !== 'string' || !listProjects().includes(name))
                return sendJson(res, 400, { error: `找不到專案「${name}」` });
              if (target !== 'web' && target !== 'mac')
                return sendJson(res, 400, { error: '要打包成 web（網頁版）或 mac（macOS App）' });
              if (target === 'mac' && process.platform !== 'darwin')
                return sendJson(res, 400, { error: 'macOS App 只能在 macOS 上打包' });
              const job = startBuild(name, target as BuildTarget, !!fullscreen, server.config.logger);
              return sendJson(res, 200, { job });
            }
          }
          if (req.method === 'POST' && path === '/create') {
            const { name } = JSON.parse(await readBody(req)) as { name?: string };
            try {
              createProject(String(name ?? '').trim());
            } catch (error) {
              return sendJson(res, 400, { error: (error as Error).message });
            }
            server.config.logger.info(`\n✓ 已建立專案 projects/${name}/（入口頁）`);
            return sendJson(res, 200, { ok: true });
          }
          if (req.method === 'POST' && path === '/summary') {
            const { name, summary } = JSON.parse(await readBody(req)) as { name?: string; summary?: string };
            if (typeof name !== 'string' || !listProjects().includes(name))
              return sendJson(res, 400, { error: `找不到專案「${name}」` });
            try {
              await setProjectSummary(name, String(summary ?? ''));
            } catch (error) {
              return sendJson(res, 400, { error: (error as Error).message });
            }
            return sendJson(res, 200, { ok: true, summary: await projectSummary(name) });
          }
          if (path === '/remove') {
            const name =
              req.method === 'GET'
                ? (new URL(req.url ?? '/', 'http://x').searchParams.get('name') ?? '')
                : String((JSON.parse(await readBody(req)) as { name?: string }).name ?? '');
            const error = removeError(name) || (isBuilding(name) ? `正在打包 ${name}，等打包完成再刪除` : '');
            if (error) return sendJson(res, 400, { error });
            /** 刪的是正在用的專案：先換成這個專案 */
            const switchTo = name === current ? DEFAULT_PROJECT : '';
            if (req.method === 'GET') {
              const targets = removeTargets(name).map(({ dir, files }) => ({ path: `${relative(ROOT, dir)}/`, files }));
              return sendJson(res, 200, { targets, selected: (await savedProject()) === name, switchTo });
            }
            if (req.method === 'POST' && switchTo) {
              // 開發伺服器還在用這些檔案：先換成預設專案、重新啟動完成後再刪
              process.env.PROJECT = switchTo;
              sendJson(res, 200, { ok: true, restarting: true, switchTo });
              setTimeout(async () => {
                const log = server.config.logger;
                log.info(`\n▶ 切換專案：${current} → ${switchTo}（要刪除 ${current}）`);
                try {
                  await server.restart();
                  removeProject(name);
                  log.info(`✓ 已刪除專案 ${name}（入口頁）`);
                } catch (e) {
                  log.error(`✗ 刪除專案 ${name} 失敗：${(e as Error).message}`);
                }
              }, 50);
              return;
            }
            if (req.method === 'POST') {
              const reselected = removeProject(name);
              server.config.logger.info(`\n✓ 已刪除專案 ${name}（入口頁）`);
              return sendJson(res, 200, { ok: true, reselected: reselected ? DEFAULT_PROJECT : '' });
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

/** 編輯器共用的外觀（所有編輯器與入口頁一致的色票、按鈕、面板…） */
const EDITOR_THEME = join(ENGINE_SRC, 'editors', 'shared', 'theme.css');
/** 頁面裡放共用外觀的位置（在頁面自己的 <style> 之前，頁面可以覆蓋） */
const THEME_SLOT = '<!-- editor-theme -->';

/**
 * 讀取引擎的編輯器頁面：放進共用外觀（shared/theme.css），入口改成透過 @engine 別名引用
 * （專案資料夾裡不用放一份編輯器）
 */
async function editorHtml(name: string): Promise<string> {
  const html = await fs.readFile(editorHtmlPath(name), 'utf8');
  if (!EDITOR_ENTRY.test(html))
    throw new Error(`src/editors/${name}/index.html 找不到編輯器入口 <script src="./editor.ts">`);
  if (!html.includes(THEME_SLOT)) throw new Error(`src/editors/${name}/index.html 找不到共用外觀的位置 ${THEME_SLOT}`);
  const theme = await fs.readFile(EDITOR_THEME, 'utf8');
  return html
    .replace(THEME_SLOT, () => `<style data-editor-theme>\n${theme}</style>`)
    .replace(EDITOR_ENTRY, `<script type="module">import '@engine/editors/${name}/editor.ts';</script>`);
}

/**
 * 開發時讓每個專案都有編輯器頁面（/ui-editor.html、/s3d-editor.html），內容來自引擎的 src/editors/<名稱>/index.html。
 * 網址刻意放在根目錄：編輯器用相對路徑（ui/、scenes/）讀取專案的檔案與圖片。只在開發伺服器作用，不會編譯到 dist。
 */
function engineEditorPlugin(): Plugin {
  return {
    name: 'engine-editor',
    apply: 'serve',
    configureServer(server) {
      for (const name of EDITORS) server.watcher.add(editorHtmlPath(name));
      server.watcher.add(EDITOR_THEME);
      server.middlewares.use(async (req, res, next) => {
        const path = (req.url ?? '').split('?')[0];
        const name = EDITORS.find((n) => path === `/${n}.html` || path === `/${n}`);
        if (!name) return next();
        try {
          let html = await server.transformIndexHtml(`/${name}.html`, await editorHtml(name), req.originalUrl);
          // 入口頁切換專案時開發伺服器會重新啟動：不放 Vite 的用戶端（它會在重新連線時整頁重新整理，畫面會跳一下），
          // 入口頁自己等伺服器換好專案後就地更新列表
          if (name === 'portal') html = html.replace(VITE_CLIENT, '');
          res.statusCode = 200;
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.end(html);
        } catch (error) {
          next(error);
        }
      });
    },
  };
}

/** 使用手冊在開發伺服器上的網址 */
const DOC_BASE = '/doc/';
const DOC_CONFIG = join(ENGINE_ROOT, 'doc', 'vite.config.ts');

/**
 * 使用手冊（doc/）：node hero dev 時在 /doc 提供，不用另開伺服器。
 * 手冊有自己的 Vite 設定（doc/vite.config.ts：根目錄、public/、執行範例的外掛、API 參考），
 * 所以用中介層模式另建一個 Vite 伺服器（base /doc/），/doc/ 底下的請求都交給它；
 * 熱更新的 WebSocket 共用這個伺服器的連接埠（路徑 /doc/，和遊戲的 / 分開）。
 * 第一次打開 /doc 才建立（不看手冊時不花時間）；開發伺服器關閉、重新啟動（切換專案）時一起關掉。
 */
function docServerPlugin(): Plugin {
  return {
    name: 'engine-doc',
    apply: 'serve',
    configureServer(server) {
      let doc: Promise<ViteDevServer> | undefined;
      // 關閉後（重新啟動的過程中）不要再建立手冊的伺服器，否則會留下一個沒人關的
      let closed = false;
      const start = async () => {
        const { createServer } = await import('vite');
        return createServer({
          configFile: DOC_CONFIG,
          base: DOC_BASE,
          appType: 'mpa',
          clearScreen: false,
          server: { middlewareMode: true, hmr: server.httpServer ? { server: server.httpServer } : false },
        });
      };
      const close = server.close.bind(server);
      server.close = async () => {
        closed = true;
        const running = doc;
        doc = undefined;
        if (running) await (await running).close().catch(() => {});
        return close();
      };
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? '';
        const path = url.split('?')[0];
        if (path === '/doc' || path === DOC_BASE) {
          // 入口直接轉到使用手冊
          res.statusCode = 302;
          res.setHeader('Location', `${DOC_BASE}manual/${url.slice(path.length)}`);
          return res.end();
        }
        if (!path.startsWith(DOC_BASE)) return next();
        if (closed) {
          res.statusCode = 503;
          return res.end('開發伺服器正在重新啟動，請稍後重新整理');
        }
        try {
          doc ??= start().catch((error) => {
            doc = undefined;
            throw error;
          });
          const docServer = await doc;
          docServer.middlewares(req, res, next);
        } catch (error) {
          next(error);
        }
      });
    },
  };
}
