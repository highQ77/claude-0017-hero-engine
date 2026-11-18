/**
 * 3D 場景編輯器的檔案管理：專案 public/scenes 裡的場景檔、public/prefabs 裡的預製物件檔（格式一樣）。
 * 透過開發伺服器的 API（tools/scene-files-plugin.ts）讀寫磁碟。
 * 檔案可以是 .xml（新檔案的預設）或 .json：依副檔名決定存檔格式，讀檔時自動判斷。
 */
import { request } from '../shared/http';
import { parseSceneFile, stringifySceneFile, stringifySceneXml, type SceneFileData } from '../../scene';

/** 文件種類：場景、預製物件 */
export type DocKind = 'scene' | 'prefab';

/** 清單裡的一個檔案 */
export interface SceneFileInfo {
  /** 相對於 public/scenes（或 public/prefabs）的檔名，例如 forest.xml、levels/cave.json */
  name: string;
  size: number;
  mtime: number;
}

/** 素材：public 底下的模型、貼圖 */
export interface AssetInfo {
  /** 相對於 public 的路徑，也是遊戲裡的網址（例如 models/tree.glb） */
  path: string;
  size: number;
  mtime: number;
}

const API: Record<DocKind, string> = { scene: '/__scenes', prefab: '/__prefabs' };
/** 遊戲裡的網址開頭（相對於 public） */
export const FOLDER: Record<DocKind, string> = { scene: 'scenes', prefab: 'prefabs' };

const fileUrl = (kind: DocKind, name: string) => `${API[kind]}/files/${encodeURIComponent(name)}`;

/** 列出檔案 */
export const listFiles = (kind: DocKind) => request<SceneFileInfo[]>(`${API[kind]}/files`);

/** 腳本的一個參數（tools/script-scan.ts 從原始碼找出來的） */
export interface ScriptPropInfo {
  name: string;
  default: number | string | boolean;
  type: 'number' | 'string' | 'boolean';
  doc?: string;
}

/** 專案裡的一個腳本類別 */
export interface ScriptInfo {
  name: string;
  /** 檔案（相對於專案，例如 src/coin.ts） */
  file: string;
  line: number;
  doc?: string;
  props: ScriptPropInfo[];
}

/** 列出專案 src/ 裡的腳本（class X extends Script）與參數 */
export const listScripts = () => request<ScriptInfo[]>(`${API.scene}/scripts`);

/** 列出素材（模型、貼圖） */
export const listAssets = () => request<AssetInfo[]>(`${API.scene}/assets`);

/** public/ui 裡的介面檔（遊戲裡的網址，例如 ui/scene.xml、ui/orbit/hud.xml；UI 層的選單用） */
export async function listUIFiles(): Promise<string[]> {
  const list = await request<{ name: string }[]>('/__ui/files');
  return list.map((f) => `ui/${f.name}`);
}

/** 讀取並檢查檔案 */
export async function readFile(kind: DocKind, name: string): Promise<SceneFileData> {
  const res = await fetch(fileUrl(kind, name), { cache: 'no-store' });
  if (!res.ok) throw new Error(`讀取 ${FOLDER[kind]}/${name} 失敗（${res.status}）`);
  return parseSceneFile(await res.text());
}

/** 依副檔名轉成文字：.xml 存成 XML，其他存成 JSON */
export function stringifyFor(name: string, data: SceneFileData): string {
  return isXmlName(name) ? stringifySceneXml(data) : stringifySceneFile(data);
}

/** 檔名是 .xml */
export const isXmlName = (name: string) => /\.xml$/i.test(name);

/** 儲存檔案（建立或覆蓋），回傳新的清單 */
export async function saveFile(kind: DocKind, name: string, data: SceneFileData): Promise<SceneFileInfo[]> {
  const r = await request<{ files: SceneFileInfo[] }>(fileUrl(kind, name), {
    method: 'PUT',
    headers: { 'Content-Type': isXmlName(name) ? 'application/xml' : 'application/json' },
    body: stringifyFor(name, data),
  });
  return r.files;
}

/**
 * 直接存文字（素材預覽視窗編輯原始碼用）：先確認是正確的場景檔格式，回傳讀出來的內容與新的清單。
 * 格式錯誤時丟出錯誤（不會寫入）。
 */
export async function saveFileText(
  kind: DocKind,
  name: string,
  text: string,
): Promise<{ data: SceneFileData; files: SceneFileInfo[] }> {
  const data = parseSceneFile(text);
  const r = await request<{ files: SceneFileInfo[] }>(fileUrl(kind, name), {
    method: 'PUT',
    headers: { 'Content-Type': isXmlName(name) ? 'application/xml' : 'application/json' },
    body: text,
  });
  return { data, files: r.files };
}

/** 預製物件的路徑（場景檔裡 prefab 欄位的寫法）→ 檔名；不是 prefabs/ 開頭時回傳 null */
export function prefabName(path: string): string | null {
  return path.startsWith(`${FOLDER.prefab}/`) ? path.slice(FOLDER.prefab.length + 1) : null;
}

/**
 * 檔名檢查：英數字、中文、- _ .，最多一層資料夾。
 * 自動補上副檔名：沒寫時用 .xml（寫了 .json 就存成 JSON）
 */
export function normalizeSceneName(input: string): string | null {
  const trimmed = input.trim();
  const ext = /\.json$/i.test(trimmed) ? '.json' : '.xml';
  const name = trimmed.replace(/\.(?:json|xml)$/i, '');
  const seg = '[\\w\\-㐀-鿿][\\w\\-.㐀-鿿]*';
  return new RegExp(`^(?:${seg}/)?${seg}$`).test(name) ? `${name}${ext}` : null;
}

/** 新場景的內容：攝影機、環境光、平行光、地面 */
export function newSceneTemplate(): SceneFileData {
  return {
    format: 'hero-scene',
    version: 1,
    entities: [
      {
        id: 'camera',
        name: '攝影機',
        components: { Transform: { position: [0, 3, 8], rotation: [-15, 0, 0] }, Camera: {} },
      },
      { id: 'ambient', name: '環境光', components: { Light: { kind: 'hemisphere', intensity: 0.6 } } },
      {
        id: 'sun',
        name: '太陽',
        components: {
          Transform: { position: [5, 10, 5], rotation: [-60, 30, 0] },
          Light: { intensity: 2, castShadow: true },
        },
      },
      {
        id: 'ground',
        name: '地面',
        components: {
          Transform: { rotation: [-90, 0, 0] },
          MeshRenderer: { geometry: { plane: 20 }, material: '#5a6b52', receiveShadow: true },
          Collider: { halfExtents: [10, 10, 0.05] },
        },
      },
    ],
  };
}
