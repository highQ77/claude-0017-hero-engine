/**
 * 文件網站的 Vite 設定。
 *
 *   npm run dev（node hero dev）時掛在遊戲開發伺服器的 /doc/ 底下（tools/project.ts 的 docServerPlugin）：
 *   http://localhost:5173/doc。手冊只在開發伺服器上提供（不另外打包）。
 *   範例檢查（doc/scripts/check-examples.mjs）會用這份設定另開一個伺服器（網址從根目錄起算）。
 *
 *   doc/index.html           入口（轉到使用手冊）
 *   doc/manual/              使用手冊：章節在 manual/chapters/*.html
 *   doc/manual/runner.html   範例的執行環境（放在預覽框 iframe 裡）
 *   doc/public/              範例用的圖片、音效（網址從根目錄起算，例如 ui/coin.png）
 *
 * TypeScript 範例：頁面把程式碼 POST 到 <base>__doc/run，伺服器暫存成虛擬模組 <base>__run/<編號>.ts（<base> 是 /doc/；範例檢查另開時是 /），
 * 預覽框再 import 它。這樣範例和真正的遊戲專案一樣經過 Vite 編譯，可以 import '@engine/...'、'three'。
 * 範例裡的 import … from './engine' 對應到手冊共用的 doc/manual/engine.ts（和遊戲專案的 engine.ts 一樣的寫法）。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { IncomingMessage } from 'node:http';
import { defineConfig, type Plugin } from 'vite';
// API 參考的資料：分析引擎原始碼（和 node hero api 共用）
import { analyzeApi } from '../tools/api-model.mjs';
// 預先打包的套件（和遊戲專案共用的列表）
import { ENGINE_DEPS } from '../tools/engine-deps';

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
 * API 參考：虛擬模組 virtual:engine-api 是分析引擎原始碼的結果（tools/api-model.mjs）。
 * 引擎的原始碼改了就重新分析、重新整理頁面，API 參考永遠和程式碼一致。
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

/**
 * 執行 TypeScript 範例：POST <base>__doc/run（內容為程式碼）→ { url }。
 * <base> 是網站的根目錄：掛在遊戲開發伺服器時是 /doc/，範例檢查另開伺服器時是 /。
 */
function docRunPlugin(): Plugin {
  const modules = new Map<string, string>();
  let counter = 0;
  return {
    name: 'doc-run',
    apply: 'serve',
    resolveId(id, importer) {
      // 瀏覽器要的是 <base>__run/…；Vite 去掉 <base> 後是 /__run/…（兩種都接受）
      const at = id.indexOf(RUN_URL);
      if (at >= 0 && !id.slice(0, at).includes('?')) return RUN_DIR + id.slice(at + RUN_URL.length).split('?')[0];
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
      // 外掛的中介層排在 Vite 去掉 base 之前：比對完整的網址
      const base = server.config.base;
      const endpoint = `${base}__doc/run`;
      server.middlewares.use(async (req, res, next) => {
        if ((req.url ?? '').split('?')[0] !== endpoint) return next();
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
          res.end(JSON.stringify({ url: `${base}${RUN_URL.slice(1)}${name}` }));
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
  publicDir: join(DOC_ROOT, 'public'),
  // 預先打包套件的快取和遊戲專案分開（都放 node_modules/.vite 會互相覆蓋；node hero dev 時兩個在同一個程序裡）
  cacheDir: join(ENGINE_ROOT, 'node_modules', '.vite-doc'),
  // '@engine' 是總入口（src/index.ts），'@engine/模組' 是各模組
  resolve: {
    alias: [
      // 只用 WebGPU：'three' 指向 three/webgpu（和遊戲專案一樣，見 tools/project.ts）
      { find: /^three$/, replacement: 'three/webgpu' },
      { find: /^@engine$/, replacement: join(ENGINE_ROOT, 'src', 'index.ts') },
      { find: '@engine', replacement: join(ENGINE_ROOT, 'src') },
    ],
  },
  plugins: [apiDocPlugin(), docUiXmlPlugin(), docRunPlugin()],
  server: {
    fs: { allow: [ENGINE_ROOT] },
    // 範例檢查的暫存資料夾（型別檢查、Chrome 設定檔）：變動時不要重新整理頁面
    watch: { ignored: ['**/.check-*/**'] },
  },
  optimizeDeps: {
    // 範例可能用到的套件先預先打包：執行到一半才發現新套件，Vite 會重新整理頁面
    entries: ['index.html', 'manual/index.html', 'manual/runner.html'],
    // （引擎用到的套件：tools/engine-deps.ts；引擎新增套件時加在那裡）
    include: ENGINE_DEPS,
    esbuildOptions: { target: 'es2022' },
  },
});
