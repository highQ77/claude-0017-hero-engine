/**
 * 音效編輯器的檔案管理：專案 public/sounds 裡的 <名稱>.sfx.json 與 <名稱>.wav。
 * 透過開發伺服器的 API（tools/sound-files-plugin.ts）讀寫磁碟。
 */
import { request, requestText } from '../shared/http';
import { type SfxData, parseSfx } from './sfx';
import { encodeWav, toBase64 } from './wav';

/** 清單裡的一個音效檔 */
export interface SfxFileInfo {
  /** 檔名，例如 coin.sfx.json */
  name: string;
  size: number;
  mtime: number;
}

const API = '/__sounds';
const fileUrl = (name: string) => `${API}/files/${encodeURIComponent(name)}`;

/** 名稱：英數字、-、_ */
export const VALID_NAME = /^[A-Za-z0-9_-]+$/;

/** 使用者輸入的名稱 → 檔名（coin → coin.sfx.json）；不合法時回傳 null */
export function fileNameOf(input: string): string | null {
  const base = input.trim().replace(/(\.sfx)?\.json$|\.wav$/, '');
  return VALID_NAME.test(base) ? `${base}.sfx.json` : null;
}

/** 檔名 → 音效名稱（coin.sfx.json → coin） */
export const soundNameOf = (file: string) => file.replace(/\.sfx\.json$/, '');

/** 列出音效檔 */
export const listSfxFiles = () => request<SfxFileInfo[]>(`${API}/files`);

/** public/sounds 裡所有的 .wav（新增時檢查會不會覆蓋別的音檔） */
export const listWavs = () => request<string[]>(`${API}/wavs`);

/** 讀取音效檔 */
export async function readSfxFile(name: string): Promise<SfxData> {
  return parseSfx(await requestText(fileUrl(name)));
}

/** 儲存：.sfx.json 與烘焙好的 .wav 一起寫入 */
export async function writeSfxFile(
  name: string,
  sfx: SfxData,
  samples: Float32Array,
  sampleRate: number,
): Promise<void> {
  const wav = toBase64(encodeWav(samples, sampleRate));
  await requestText(fileUrl(name), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sfx, wav }),
  });
}

/** 刪除（.sfx.json 與 .wav） */
export async function deleteSfxFile(name: string): Promise<void> {
  await requestText(fileUrl(name), { method: 'DELETE' });
}
