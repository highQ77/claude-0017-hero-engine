/**
 * 目前選擇的遊戲專案（node hero select 名稱 會寫進 .selected-project）。
 * 優先順序：環境變數 PROJECT → .selected-project → official-demo-000-start。
 * node hero 指令與 vite.config.ts 共用。
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 引擎根目錄 */
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** 遊戲專案放的資料夾（projects/） */
export const PROJECTS_DIR = join(ROOT, 'projects');
/** node hero select 存的專案名稱 */
export const SELECTION_FILE = join(ROOT, '.selected-project');
/** 預設專案（還沒選過時用它；測試與使用手冊會用到，不能刪除） */
export const DEFAULT_PROJECT = 'official-demo-000-start';

/**
 * 目前選擇的專案：環境變數 PROJECT → .selected-project → 預設專案
 * @returns {string}
 */
export function selectedProject() {
  if (process.env.PROJECT) return process.env.PROJECT;
  try {
    const name = readFileSync(SELECTION_FILE, 'utf8').trim();
    if (name) return name;
  } catch {
    /* 還沒選過 */
  }
  return DEFAULT_PROJECT;
}

/**
 * 專案資料夾的完整路徑（不檢查存不存在）
 * @param {string} name 專案名稱
 * @returns {string}
 */
export function projectDir(name) {
  return join(PROJECTS_DIR, name);
}

/**
 * 專案存在（資料夾裡有 index.html）
 * @param {string} name 專案名稱
 * @returns {boolean}
 */
export function projectExists(name) {
  return existsSync(join(projectDir(name), 'index.html'));
}
