/**
 * 著色器編輯器的檔案管理：專案 public/shaders 裡的節點圖檔（*.shader.json）。
 * 透過開發伺服器的 API（tools/shader-files-plugin.ts）讀寫磁碟。
 */
import { request, requestText } from '../shared/http';

/** 清單裡的一個檔案 */
export interface ShaderFileInfo {
  /** 檔名，例如 lava.shader.json */
  name: string;
  size: number;
  mtime: number;
}

const API = '/__shaders/files';

const fileUrl = (name: string) => `${API}/${encodeURIComponent(name)}`;

/** 檔名：英數字、-、_ 加上 .shader.json */
export const VALID_NAME = /^[A-Za-z0-9_-]+$/;

/** 使用者輸入的名稱 → 檔名（lava → lava.shader.json）；不合法時回傳 null */
export function fileNameOf(input: string): string | null {
  const base = input.trim().replace(/(\.shader)?\.json$/, '');
  return VALID_NAME.test(base) ? `${base}.shader.json` : null;
}

/** 檔名 → 著色器名稱（lava.shader.json → lava） */
export const shaderNameOf = (file: string) => file.replace(/\.shader\.json$/, '');

/** 列出節點圖檔 */
export const listShaderFiles = () => request<ShaderFileInfo[]>(API);

/** 讀取節點圖檔（文字） */
export const readShaderFile = (name: string) => requestText(fileUrl(name));

/** 儲存節點圖檔 */
export async function writeShaderFile(name: string, text: string): Promise<void> {
  await requestText(fileUrl(name), { method: 'PUT', body: text, headers: { 'Content-Type': 'application/json' } });
}

/** 刪除節點圖檔 */
export async function deleteShaderFile(name: string): Promise<void> {
  await requestText(fileUrl(name), { method: 'DELETE' });
}
