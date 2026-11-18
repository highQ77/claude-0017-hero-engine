/**
 * 打包外掛：把專案 public/ui 裡的 .xml 介面檔轉成 JS 模組，放在 assets/ 底下（檔名含雜湊，可以長期快取）。
 *
 * - 每個 XML 一個 JS 檔（assets/ui-<名稱>-<雜湊>.js），用到才載入；一層子資料夾（例如場景資料夾 forest/hud.xml）也會打包。
 * - 每個頁面（遊戲、編輯器）啟動時先登記「網址 → 模組」對照表（@engine/ui2d/xmlSources），
 *   之後 ui.load('ui/scene.xml')、screens.open(...)、編輯器讀檔都會直接用打包好的內容，不會再抓 .xml。
 * - public 複製過去的 ui/*.xml 會從輸出刪掉（圖片等其他檔案照常保留）。
 * - 只在打包時作用；開發時照樣直接讀 public/ui 的檔案（編輯器存檔後馬上生效）。
 */
import { promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Plugin } from 'vite';

const ENTRY_ID = 'virtual:ui-xml-bundle';
const RESOLVED_ENTRY = '\0ui-xml-bundle';
/** 每個 XML 的模組 id（名稱會變成輸出的檔名 ui-<名稱>） */
const XML_PREFIX = '\0ui-xml/';
const REGISTRY = resolve(__dirname, '..', 'src', 'ui2d', 'xmlSources.ts');

export function uiXmlBundlePlugin(options: { dir?: string } = {}): Plugin {
  let dir = '';
  let base = '/';
  let outDir = '';

  /** public/ui 與一層子資料夾裡的 .xml（例如 scene.xml、forest/hud.xml） */
  const xmlFiles = async () => {
    const out: string[] = [];
    try {
      for (const e of await fs.readdir(dir, { withFileTypes: true })) {
        if (e.name.startsWith('.')) continue;
        if (e.isFile() && e.name.endsWith('.xml')) out.push(e.name);
        else if (e.isDirectory()) {
          for (const f of await fs.readdir(join(dir, e.name)))
            if (f.endsWith('.xml') && !f.startsWith('.')) out.push(`${e.name}/${f}`);
        }
      }
    } catch {
      return [];
    }
    return out.sort();
  };

  return {
    name: 'ui-xml-bundle',
    apply: 'build',
    enforce: 'pre',
    configResolved(config) {
      dir = resolve(config.root, options.dir ?? join(config.publicDir || 'public', 'ui'));
      base = config.base || '/';
      outDir = resolve(config.root, config.build.outDir);
    },
    resolveId(source) {
      if (source === ENTRY_ID) return RESOLVED_ENTRY;
      if (source.startsWith(XML_PREFIX)) return source;
      return null;
    },
    async load(id) {
      if (id === RESOLVED_ENTRY) {
        const files = await xmlFiles();
        const entries = files.map((name) => {
          const url = `${base}ui/${name}`;
          // 資料夾的 / 換成 ~（檔名不會有 ~），輸出的檔名是 ui-orbit~hud-<雜湊>.js
          const mod = `${XML_PREFIX}ui-${name.replace('/', '~')}`;
          return `  ${JSON.stringify(url)}: () => import(${JSON.stringify(mod)}),`;
        });
        return `import { registerUIXml } from ${JSON.stringify(REGISTRY)};\nregisterUIXml({\n${entries.join('\n')}\n});\n`;
      }
      if (id.startsWith(XML_PREFIX)) {
        const name = id.slice(XML_PREFIX.length).replace(/^ui-/, '').replace('~', '/');
        const file = join(dir, name);
        this.addWatchFile(file);
        return `export default ${JSON.stringify(await fs.readFile(file, 'utf8'))};\n`;
      }
      return null;
    },
    // 每個頁面最前面先登記對照表（要比遊戲程式早執行）
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        const tag = `<script type="module">import '${ENTRY_ID}';</script>`;
        return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => `${m}\n    ${tag}`) : `${tag}\n${html}`;
      },
    },
    // public 複製過去的 .xml 已經打包成 JS，刪掉
    async writeBundle() {
      const uiOut = join(outDir, 'ui');
      const folders = new Set<string>();
      for (const name of await xmlFiles()) {
        await fs.rm(join(uiOut, name), { force: true });
        if (name.includes('/')) folders.add(name.slice(0, name.indexOf('/')));
      }
      // 場景資料夾裡只有 XML 時，刪完會留下空資料夾
      for (const folder of folders) await fs.rmdir(join(uiOut, folder)).catch(() => {});
    },
  };
}
