/**
 * 文件網站的 Vite 設定（node hero doc 啟動）。
 *
 *   doc/index.html           入口（轉到使用手冊）
 *   doc/manual/              使用手冊：章節在 manual/chapters/*.html
 *   doc/manual/runner.html   範例的執行環境（放在預覽框 iframe 裡）
 *   doc/public/              範例用的圖片、音效（網址從根目錄起算，例如 ui/coin.png）
 *
 * TypeScript 範例：頁面把程式碼 POST 到 /__doc/run，伺服器暫存成虛擬模組 /__run/<編號>.ts，
 * 預覽框再 import 它。這樣範例和真正的遊戲專案一樣經過 Vite 編譯，可以 import '@engine/...'、'three'。
 * 範例裡的 import … from './engine' 對應到手冊共用的 doc/manual/engine.ts（和遊戲專案的 engine.ts 一樣的寫法）。
 * 打包後（node hero doc build）沒有伺服器：XML 範例照常執行，TypeScript 範例只能閱讀、編輯。
 * 打包結果可以放到任何網站的任何路徑，也可以直接在檔案總管雙擊 dist/doc/index.html 打開（file://）：
 * 網址用相對路徑（base './'），程式打包成一般的 <script>（classicScriptPlugin；瀏覽器不允許 file:// 載入 module）。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { IncomingMessage } from 'node:http';
import { defineConfig, type Plugin } from 'vite';
// API 參考的資料：分析引擎原始碼（和 node hero api 共用）
import { analyzeApi } from '../tools/api-model.mjs';

const DOC_ROOT = __dirname;
const ENGINE_ROOT = resolve(DOC_ROOT, '..');
/** 虛擬模組的網址前綴與對應的（不存在的）檔案位置；放在 doc 底下，'three' 等套件才找得到 node_modules */
const RUN_URL = '/__run/';
const RUN_DIR = `${join(DOC_ROOT, '__run')}/`;
/** 最多保留幾份範例程式（舊的丟掉） */
const MAX_MODULES = 50;
const MAX_SIZE = 256 * 1024;
/** 範例共用的 engine.ts（範例寫 import { world } from './engine'） */
const EXAMPLE_ENGINE = join(DOC_ROOT, 'manual', 'engine.ts');

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((ok, fail) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_SIZE) fail(new Error('範例程式太大'));
      else chunks.push(c);
    });
    req.on('end', () => ok(Buffer.concat(chunks).toString('utf8')));
    req.on('error', fail);
  });
}

/**
 * 打包時把每個頁面的程式改成一般的 <script defer>（不是 type="module"）：
 * 瀏覽器不允許從 file:// 載入 module，直接雙擊打開 HTML 時頁面會是空的。
 * 每個頁面只有一個入口檔（沒有共用的分塊），所以不需要 import／export；
 * 程式包在 async 函式裡（保留嚴格模式與頂層 await），import.meta.url 換成目前 script 的網址。
 */
function classicScriptPlugin(): Plugin {
  return {
    name: 'doc-classic-script',
    apply: 'build',
    renderChunk(code, chunk) {
      if (chunk.imports.length || chunk.exports.length || !chunk.isEntry)
        this.error(
          `${chunk.fileName}：使用手冊的程式要打包成單一檔案（不能有共用分塊、import 或 export），才能用一般的 <script> 載入`,
        );
      const out = code.replace(/\bimport\.meta\.url\b/g, '(__docScript ? __docScript.src : location.href)');
      if (/\bimport\.meta\b/.test(out)) this.error(`${chunk.fileName}：一般的 <script> 不能用 import.meta`);
      // document.currentScript 只有在同步執行的期間有值：先記下來
      return {
        code: `(async () => {\n'use strict';\nconst __docScript = document.currentScript;\n${out}\n})();\n`,
        map: null,
      };
    },
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        return html
          .replace(/<script\b([^>]*?)\btype="module"([^>]*)>/g, (_m, a: string, b: string) => {
            const attrs = `${a}${b}`.replace(/\s*\b(?:crossorigin|async|defer)\b/g, '');
            return `<script defer${attrs}>`;
          })
          .replace(/<link rel="modulepreload"[^>]*>\s*/g, '')
          .replace(/ crossorigin(?=[ >])/g, '');
      },
    },
  };
}

/**
 * API 參考：虛擬模組 virtual:engine-api 是分析引擎原始碼的結果（tools/api-model.mjs）。
 * 開發時引擎的原始碼改了就重新分析、重新整理頁面，API 參考永遠和程式碼一致；打包時分析一次放進手冊。
 */
function apiDocPlugin(): Plugin {
  const ID = 'virtual:engine-api';
  const RESOLVED = `\0${ID}`;
  let cache: string | null = null;
  return {
    name: 'doc-api',
    resolveId: (id) => (id === ID ? RESOLVED : null),
    load(id) {
      if (id !== RESOLVED) return null;
      cache ??= JSON.stringify(analyzeApi());
      return `export default ${cache};`;
    },
    configureServer(server) {
      const src = join(ENGINE_ROOT, 'src');
      let timer: ReturnType<typeof setTimeout> | undefined;
      server.watcher.on('change', (file) => {
        if (!file.startsWith(src) || !file.endsWith('.ts') || file.includes(`${join('src', 'editors')}`)) return;
        clearTimeout(timer);
        timer = setTimeout(() => {
          cache = null;
          const mod = server.moduleGraph.getModuleById(RESOLVED);
          if (!mod) return;
          server.moduleGraph.invalidateModule(mod);
          server.ws.send({ type: 'full-reload' });
        }, 400);
      });
    },
  };
}

/**
 * 範例內嵌、匯入的 XML（doc/public/ui/*.xml）：虛擬模組 virtual:doc-ui-xml（檔名 → 內容）。
 * Vite 不允許從程式 import public/ 裡的檔案（會一直警告），所以由這裡讀檔提供；檔案改了重新整理頁面。
 */
function docUiXmlPlugin(): Plugin {
  const ID = 'virtual:doc-ui-xml';
  const RESOLVED = `\0${ID}`;
  const dir = join(DOC_ROOT, 'public', 'ui');
  return {
    name: 'doc-ui-xml',
    resolveId: (id) => (id === ID ? RESOLVED : null),
    load(id) {
      if (id !== RESOLVED) return null;
      const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.xml')) : [];
      for (const f of files) this.addWatchFile(join(dir, f));
      const map = Object.fromEntries(files.map((f) => [f, readFileSync(join(dir, f), 'utf8')]));
      return `export default ${JSON.stringify(map)};`;
    },
    configureServer(server) {
      const reload = (file: string) => {
        if (!file.startsWith(dir) || !file.endsWith('.xml')) return;
        const mod = server.moduleGraph.getModuleById(RESOLVED);
        if (mod) server.moduleGraph.invalidateModule(mod);
        server.ws.send({ type: 'full-reload' });
      };
      server.watcher.on('add', reload);
      server.watcher.on('unlink', reload);
    },
  };
}

/** 執行 TypeScript 範例：POST /__doc/run（內容為程式碼）→ { url } */
function docRunPlugin(): Plugin {
  const modules = new Map<string, string>();
  let counter = 0;
  return {
    name: 'doc-run',
    apply: 'serve',
    resolveId(id, importer) {
      if (id.startsWith(RUN_URL)) return RUN_DIR + id.slice(RUN_URL.length).split('?')[0];
      // 範例的 './engine' → 手冊共用的 engine.ts
      if (importer?.startsWith(RUN_DIR) && /^\.\/engine(\.ts)?$/.test(id)) return EXAMPLE_ENGINE;
      return null;
    },
    load(id) {
      if (!id.startsWith(RUN_DIR)) return null;
      const code = modules.get(id.slice(RUN_DIR.length));
      if (code === undefined) throw new Error('範例程式已過期，請重新執行');
      return code;
    },
    configureServer(server) {
      server.middlewares.use('/__doc/run', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          return res.end();
        }
        try {
          const code = await readBody(req);
          const name = `example-${++counter}.ts`;
          modules.set(name, code);
          while (modules.size > MAX_MODULES) modules.delete(modules.keys().next().value!);
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ url: RUN_URL + name }));
        } catch (error) {
          res.statusCode = 400;
          res.end(String((error as Error).message));
        }
      });
    },
  };
}

export default defineConfig({
  root: DOC_ROOT,
  // 相對路徑：打包結果放在任何路徑（或直接用 file:// 打開）都能找到 assets/
  base: './',
  publicDir: join(DOC_ROOT, 'public'),
  // '@engine' 是總入口（src/index.ts），'@engine/模組' 是各模組
  resolve: {
    alias: [
      { find: /^@engine$/, replacement: join(ENGINE_ROOT, 'src', 'index.ts') },
      { find: '@engine', replacement: join(ENGINE_ROOT, 'src') },
    ],
  },
  plugins: [apiDocPlugin(), docUiXmlPlugin(), docRunPlugin(), classicScriptPlugin()],
  server: {
    // 手冊固定用 5174（遊戲的 node hero dev 用 5173），兩個可以同時開；被占用時 Vite 會自動往後找
    port: 5174,
    fs: { allow: [ENGINE_ROOT] },
    // 範例檢查的暫存資料夾（型別檢查、Chrome 設定檔）：變動時不要重新整理頁面
    watch: { ignored: ['**/.check-*/**'] },
  },
  optimizeDeps: {
    // 範例可能用到的套件先預先打包：執行到一半才發現新套件，Vite 會重新整理頁面
    entries: ['index.html', 'manual/index.html', 'manual/runner.html'],
    // （引擎用到的套件都列在這裡；引擎新增套件時記得加上）
    include: [
      'three',
      'yoga-layout/load',
      'lil-gui',
      '@dimforge/rapier3d-compat',
      ...[
        'geometries/TextGeometry.js',
        'loaders/FontLoader.js',
        'loaders/GLTFLoader.js',
        'loaders/DRACOLoader.js',
        'loaders/RGBELoader.js',
        'loaders/TTFLoader.js',
        'libs/meshopt_decoder.module.js',
        'postprocessing/BokehPass.js',
        'postprocessing/EffectComposer.js',
        'postprocessing/FilmPass.js',
        'postprocessing/GTAOPass.js',
        'postprocessing/OutputPass.js',
        'postprocessing/Pass.js',
        'postprocessing/RenderPass.js',
        'postprocessing/ShaderPass.js',
        'postprocessing/SMAAPass.js',
        'postprocessing/UnrealBloomPass.js',
        'shaders/FXAAShader.js',
        'utils/SkeletonUtils.js',
      ].map((p) => `three/examples/jsm/${p}`),
    ],
    esbuildOptions: { target: 'es2022' },
  },
  build: {
    target: 'es2022',
    outDir: join(ENGINE_ROOT, 'dist', 'doc'),
    emptyOutDir: true,
    // 一般的 <script> 用不到 modulepreload（也不要多一個共用的 polyfill 檔）
    modulePreload: false,
    rollupOptions: {
      input: {
        index: join(DOC_ROOT, 'index.html'),
        manual: join(DOC_ROOT, 'manual', 'index.html'),
        runner: join(DOC_ROOT, 'manual', 'runner.html'),
      },
    },
  },
});
