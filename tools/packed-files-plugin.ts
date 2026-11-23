/**
 * 打包外掛：保護場景檔、預製物件、介面檔、著色器的明文（包含子資料夾）：
 *   public/scenes、public/prefabs、public/ui 裡的 .xml，public/shaders 裡的 .json（節點圖）。
 *
 * - 每個檔案變成 assets/ 裡的一個 JS 模組（檔名不含原本的名稱），內容是「deflate 壓縮 → XOR 混淆 → base64」的字串
 *   （packed-text.ts）；
 *   金鑰每次打包隨機產生。壓縮後通常比原本的 XML 還小。
 * - 每個頁面最前面先登記「網址 → 模組」對照表（src/core/packedFiles.ts）：load.sceneFile、ui.load、screens.open、
 *   loadShaderGraph、材質描述的 shaderGraph…
 *   讀這些網址時，用到才載入、解開，遊戲程式不用修改。
 * - public 複製過去的明文檔案從輸出刪掉；最後把輸出資料夾裡的空資料夾都刪掉。
 * - 只在打包時作用；開發時照樣直接讀 public 的檔案（編輯器存檔後馬上生效）。
 *
 * 注意：這是「不讓人直接看到內容」，不是加密。金鑰和解法都在頁面的程式裡，有心人一步一步追還是解得開；
 * 瀏覽器要能讀的東西，沒辦法真正藏起來。
 */
import { promises as fs } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import type { Plugin } from 'vite';
import { packText, randomKey, toBase64 } from './packed-text';

/** 要保護的資料夾（相對於 public）與副檔名 */
export const PACKED_FOLDERS: { folder: string; ext: string }[] = [
  { folder: 'scenes', ext: '.xml' },
  { folder: 'prefabs', ext: '.xml' },
  { folder: 'ui', ext: '.xml' },
  { folder: 'shaders', ext: '.json' },
];

const ENTRY_ID = 'virtual:packed-files';
const RESOLVED_ENTRY = '\0packed-files';
/** 每個檔案的模組 id：用編號（輸出的檔名不會透露原本的檔名） */
const FILE_PREFIX = '\0packed-file/';
const REGISTRY = resolve(__dirname, '..', 'src', 'core', 'packedFiles.ts');

/** 資料夾裡所有這個副檔名的檔案（遞迴，略過 . 開頭的），路徑用 / 分隔、相對於 dir */
async function filesWithExt(dir: string, ext: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (d: string) => {
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile() && e.name.endsWith(ext)) out.push(relative(dir, p).split('\\').join('/'));
    }
  };
  await walk(dir);
  return out.sort();
}

/** 刪掉 dir 底下所有的空資料夾（由深到淺，刪完子資料夾後變空的也刪）；dir 本身不刪 */
export async function removeEmptyFolders(dir: string): Promise<string[]> {
  const removed: string[] = [];
  const walk = async (d: string): Promise<boolean> => {
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(d, { withFileTypes: true });
    } catch {
      return false;
    }
    let empty = true;
    for (const e of entries) {
      if (e.isDirectory() && (await walk(join(d, e.name)))) {
        await fs.rmdir(join(d, e.name));
        removed.push(relative(dir, join(d, e.name)).split('\\').join('/'));
      } else empty = false;
    }
    return empty;
  };
  await walk(dir);
  return removed;
}

export function packedFilesPlugin(): Plugin {
  let publicDir = '';
  let base = '/';
  let outDir = '';
  /** 這次打包的檔案：公開路徑（scenes/main.xml） */
  let files: string[] = [];
  const key = randomKey();

  return {
    name: 'packed-files',
    apply: 'build',
    enforce: 'pre',
    async configResolved(config) {
      publicDir = config.publicDir;
      base = config.base || '/';
      outDir = resolve(config.root, config.build.outDir);
    },
    async buildStart() {
      files = [];
      if (!publicDir) return;
      for (const { folder, ext } of PACKED_FOLDERS)
        for (const f of await filesWithExt(join(publicDir, folder), ext)) files.push(`${folder}/${f}`);
    },
    resolveId(source) {
      if (source === ENTRY_ID) return RESOLVED_ENTRY;
      if (source.startsWith(FILE_PREFIX)) return source;
      return null;
    },
    async load(id) {
      if (id === RESOLVED_ENTRY) {
        const entries = files.map(
          (path, i) => `  ${JSON.stringify(`${base}${path}`)}: () => import(${JSON.stringify(`${FILE_PREFIX}${i}`)}),`,
        );
        return `import { registerPackedFiles } from ${JSON.stringify(REGISTRY)};\nregisterPackedFiles(${JSON.stringify(toBase64(key))}, {\n${entries.join('\n')}\n});\n`;
      }
      if (id.startsWith(FILE_PREFIX)) {
        const path = files[Number(id.slice(FILE_PREFIX.length))];
        const file = join(publicDir, path);
        this.addWatchFile(file);
        return `export default ${JSON.stringify(await packText(await fs.readFile(file, 'utf8'), key))};\n`;
      }
      return null;
    },
    // 檔名不透露原本的名稱（預設會用模組 id 當名稱）
    outputOptions(options) {
      const original = options.chunkFileNames;
      return {
        ...options,
        chunkFileNames: (chunk) =>
          chunk.facadeModuleId?.startsWith(FILE_PREFIX)
            ? 'assets/d-[hash].js'
            : typeof original === 'function'
              ? original(chunk)
              : (original ?? 'assets/[name]-[hash].js'),
      };
    },
    // 每個頁面最前面先登記對照表（要比遊戲程式早執行）
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        if (!files.length) return html;
        const tag = `<script type="module">import '${ENTRY_ID}';</script>`;
        return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => `${m}\n    ${tag}`) : `${tag}\n${html}`;
      },
    },
    // public 複製過去的明文 .xml 刪掉，最後刪掉整個輸出資料夾裡的空資料夾
    async writeBundle() {
      for (const path of files) await fs.rm(join(outDir, path), { force: true });
      await removeEmptyFolders(outDir);
    },
  };
}
