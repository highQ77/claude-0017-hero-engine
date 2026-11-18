/**
 * 聲音樣本 → .wav 檔（16 位元 PCM，單聲道）。不用其他套件；開發伺服器、測試也能用。
 */

/**
 * 把 -1..1 的樣本編碼成 .wav 檔的位元組。
 * @param samples 單聲道樣本（超過 -1..1 的會被截掉）
 * @param sampleRate 取樣率（例如 44100）
 */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt 區塊長度
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // 單聲道
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // 每秒位元組
  view.setUint16(32, 2, true); // 每個樣本的位元組
  view.setUint16(34, 16, true); // 位元數
  text(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return bytes;
}

/** 讀回 .wav 的基本資訊（測試、開發伺服器檢查用）；不是 16 位元 PCM 的 .wav 時丟出錯誤 */
export function wavInfo(bytes: Uint8Array): { sampleRate: number; channels: number; samples: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (bytes.length < 44 || text(0) !== 'RIFF' || text(8) !== 'WAVE') throw new Error('不是 .wav 檔');
  if (view.getUint16(20, true) !== 1 || view.getUint16(34, true) !== 16) throw new Error('只支援 16 位元 PCM 的 .wav');
  const channels = view.getUint16(22, true);
  return { sampleRate: view.getUint32(24, true), channels, samples: view.getUint32(40, true) / 2 / channels };
}

/** 位元組 ↔ base64（存檔時放在 JSON 裡送給開發伺服器） */
export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
