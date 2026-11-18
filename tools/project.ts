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
 *   projects/<名稱>/      遊戲專案：index.html、src/、public/（介面檔、音效、模型…）
 *
 * 指令：node hero create／select／remove／dev／build／doc（見根目錄的 hero.js）
 * 開發時也可以在入口頁、3D 場景編輯器裡切換專案（projectSwitchPlugin：開發伺服器換成另一個專案後重新啟動）
 * 打包：node hero build 輸出到 dist/<名稱>/web/（public/ui 的 .xml 會轉成 assets/ 裡的 JS 檔）；
 *       --mac 再用 Tauri 包成 dist/<名稱>/mac/<名稱>.app（外殼範本在 tools/tauri/）
 */
import { promises as fs } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import type { Plugin, UserConfig } from 'vite';
import { DEFAULT_PROJECT, PROJECTS_DIR, ROOT, SELECTION_FILE } from './current-project.js';
import { createProject, listProjects, removeError, removeProject, removeTargets } from './project-files.js';
import { readBody, sendError, sendJson } from './dev-http';
import { sceneFilesPlugin } from './scene-files-plugin';
import { shaderFilesPlugin } from './shader-files-plugin';
import { soundFilesPlugin } from './sound-files-plugin';
import { uiFilesPlugin } from './ui-files-plugin';
import { uiXmlBundlePlugin } from './ui-xml-bundle';

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
    publicDir: join(root, 'public'),
    // '@engine' 是總入口（src/index.ts），'@engine/模組' 是各模組
    resolve: {
      alias: [
        { find: /^@engine$/, replacement: join(ENGINE_SRC, 'index.ts') },
        { find: '@engine', replacement: ENGINE_SRC },
      ],
    },
    plugins: [
      uiFilesPlugin(),
      sceneFilesPlugin(),
      shaderFilesPlugin(),
      soundFilesPlugin(),
      uiXmlBundlePlugin(),
      engineEditorPlugin(),
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
    optimizeDeps: { esbuildOptions: { target: 'es2022' } },
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
 *   GET  /__projects          → { current, saved, default, projects: [名稱], details: [{ name, summary }] }
 *   POST /__projects/select   { name, save? }：開發伺服器換成這個專案並重新啟動（開著的頁面會自動重新整理）；
 *                             save: true 時也寫進 .selected-project（等同 node hero select 名稱，入口頁用）
 *   POST /__projects/create   { name }：用範本建立空專案（等同 node hero create 名稱）
 *   POST /__projects/summary  { name, summary }：改專案說明（src/main.ts 開頭註解的第一行）
 *   GET  /__projects/remove?name=  → { targets: [{ path, files }], selected, switchTo }：刪除前顯示會刪掉什麼
 *   POST /__projects/remove   { name }：刪除專案（等同 node hero remove 名稱，確認由入口頁負責）；
 *                             刪的是這次執行正在用的專案時，先換成預設專案、重新啟動後再刪（回傳 restarting: true）
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
            const error = removeError(name);
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
