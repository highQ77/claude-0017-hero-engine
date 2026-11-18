/**
 * 建立、刪除專案的檔案操作：node hero create／remove 與入口頁（tools/project.ts 的 /__projects）共用，
 * 兩邊的結果一樣。這裡只做檔案操作、失敗時丟出錯誤；訊息與確認由呼叫的一方處理。
 */
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_PROJECT, PROJECTS_DIR, ROOT, SELECTION_FILE, projectDir, projectExists } from './current-project.js';

const TEMPLATE_DIR = join(ROOT, 'tools', 'templates', 'empty');
const PLACEHOLDER = /__PROJECT_NAME__/g;
const TEXT_FILE = /\.(html|ts|js|json|xml|css|md|txt|svg)$/i;
/** 專案名稱：小寫英文、數字、連字號（會用在資料夾、網址與輸出路徑） */
export const VALID_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
/** 桌面版的暫存資料夾（每個專案一個外殼） */
export const TAURI_WORK = join(ROOT, '.tauri');

/** 每個專案的 tsconfig.json */
const PROJECT_TSCONFIG = `{
  // 這個專案的 TypeScript 設定：沿用引擎根目錄的設定（@engine 的路徑、嚴格檢查）。
  // 單獨用 VS Code 打開這個資料夾時，程式碼提示也找得到 @engine/...
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    // import.meta.env、import.meta.glob 等 Vite 功能的型別
    "types": ["vite/client"]
  },
  "include": ["src"]
}
`;

/**
 * 專案名稱有問題時回傳錯誤訊息，可以用時回傳 null
 * @param {string} name
 * @returns {string | null}
 */
export function nameError(name) {
  if (!name) return '請輸入專案名稱';
  if (!VALID_NAME.test(name))
    return `專案名稱「${name}」不合法：只能用小寫英文、數字和連字號（-），而且要以英文或數字開頭`;
  return null;
}

/**
 * projects/ 裡的專案（有 index.html 的資料夾），依名稱排序
 * @returns {string[]}
 */
export function listProjects() {
  if (!existsSync(PROJECTS_DIR)) return [];
  return readdirSync(PROJECTS_DIR)
    .filter((n) => !n.startsWith('.') && statSync(projectDir(n)).isDirectory() && projectExists(n))
    .sort();
}

/**
 * 用範本（tools/templates/empty）建立空專案 projects/<name>/；名稱不合法或已經存在時丟出錯誤
 * @param {string} name
 */
export function createProject(name) {
  const error = nameError(name);
  if (error) throw new Error(error);
  const dir = projectDir(name);
  if (existsSync(dir)) throw new Error(`projects/${name}/ 已經存在`);
  if (!existsSync(TEMPLATE_DIR)) throw new Error('找不到專案範本：tools/templates/empty');
  cpSync(TEMPLATE_DIR, dir, { recursive: true });
  // 範本裡的 __PROJECT_NAME__ 換成專案名稱
  const fill = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, entry.name);
      if (entry.isDirectory()) fill(p);
      else if (TEXT_FILE.test(entry.name)) writeFileSync(p, readFileSync(p, 'utf8').replace(PLACEHOLDER, name));
    }
  };
  fill(dir);
  // TypeScript 設定（沿用引擎根目錄的設定）：單獨用 VS Code 打開專案資料夾時，程式碼提示也找得到 @engine
  // （不放在範本裡：範本在 tools/templates/ 時 extends 的相對路徑不對）
  writeFileSync(join(dir, 'tsconfig.json'), PROJECT_TSCONFIG);
}

/**
 * 資料夾裡的檔案數量（刪除前顯示）
 * @param {string} dir
 * @returns {number}
 */
function countFiles(dir) {
  let n = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true }))
    n += entry.isDirectory() ? countFiles(join(dir, entry.name)) : 1;
  return n;
}

/**
 * 刪除專案會刪掉的資料夾（projects/、dist/、.tauri/ 裡存在的）與各自的檔案數量
 * @param {string} name
 * @returns {{ dir: string; files: number }[]}
 */
export function removeTargets(name) {
  return [projectDir(name), join(ROOT, 'dist', name), join(TAURI_WORK, name)]
    .filter((d) => existsSync(d))
    .map((dir) => ({ dir, files: countFiles(dir) }));
}

/**
 * 為什麼不能刪除這個專案（可以刪時回傳 null）
 * @param {string} name
 * @returns {string | null}
 */
export function removeError(name) {
  const error = nameError(name);
  if (error) return error;
  if (!projectExists(name)) return `找不到專案「${name}」`;
  if (name === DEFAULT_PROJECT) return `${DEFAULT_PROJECT} 是引擎的範例專案（測試與使用手冊會用到），不能刪除`;
  return null;
}

/**
 * 刪除專案（無法復原）。刪的是 node hero select 選的專案時，改選預設專案。
 * 回傳刪除前選擇的專案是不是它（呼叫的一方用來顯示「目前選擇改為…」）。
 * @param {string} name
 * @returns {boolean}
 */
export function removeProject(name) {
  const error = removeError(name);
  if (error) throw new Error(error);
  let selected = '';
  try {
    selected = readFileSync(SELECTION_FILE, 'utf8').trim();
  } catch {
    /* 還沒選過 */
  }
  for (const { dir } of removeTargets(name)) rmSync(dir, { recursive: true, force: true });
  if (selected !== name) return false;
  if (projectExists(DEFAULT_PROJECT)) writeFileSync(SELECTION_FILE, `${DEFAULT_PROJECT}\n`);
  else rmSync(SELECTION_FILE, { force: true });
  return true;
}
