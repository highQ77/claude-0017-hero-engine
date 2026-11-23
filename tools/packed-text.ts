/**
 * 保護文字（打包工具用）：UTF-8 → deflate 壓縮 → XOR 混淆 → base64。
 * 反向是 src/core/packedFiles.ts 的 unpackText（遮罩的算法兩邊要一樣）。
 * 只用標準的 Web API（CompressionStream、btoa），Node 和瀏覽器都能用，測試也能直接 import。
 */

/** 第 i 個位元組的遮罩：金鑰循環使用，再混入位置（同樣的內容在不同位置不會變成同樣的位元組） */
export const maskAt = (key: Uint8Array, i: number) => key[i % key.length] ^ ((i * 151 + 7) & 0xff);

/** 每次打包隨機產生的金鑰（16 位元組） */
export function randomKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(16));
}

export function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** 保護一段文字 */
export async function packText(text: string, key: Uint8Array): Promise<string> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  for (let i = 0; i < bytes.length; i++) bytes[i] ^= maskAt(key, i);
  return toBase64(bytes);
}
