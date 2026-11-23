/**
 * 打包時保護的場景檔、介面檔（tools/packed-text.ts 打包、src/core/packedFiles.ts 解開）。
 * 打包後實際載入的檢查：用 node hero build 打包專案，在瀏覽器確認（見 tools/packed-files-plugin.ts）。
 */
import { describe, expect, test } from 'vitest';
import { hasPackedFile, readPackedFile, registerPackedFiles, unpackText } from '../src/core/packedFiles';
import { packText, randomKey, toBase64 } from '../tools/packed-text';

const XML = `<Scene format="hero-scene" version="1">
  <Entity id="box" name="方塊（中文、emoji 🎮、&amp; 跳脫）">
    <Transform position="0 0.5 0"/>
  </Entity>
</Scene>
`;

describe('保護場景檔、介面檔的明文', () => {
  test('打包後解得回原本的文字；結果看不到明文，也不是單純的 base64', async () => {
    const key = randomKey();
    const packed = await packText(XML, key);
    expect(await unpackText(packed, key)).toBe(XML);
    expect(packed).not.toContain('Entity');
    // 直接 base64 解碼也看不到內容
    expect(atob(packed)).not.toContain('Entity');
    expect(new TextDecoder().decode(Uint8Array.from(atob(packed), (c) => c.charCodeAt(0)))).not.toContain('方塊');
  });

  test('同樣的內容、不同的金鑰：結果不同；金鑰錯了解不開', async () => {
    const a = randomKey();
    const b = randomKey();
    expect(await packText(XML, a)).not.toBe(await packText(XML, b));
    await expect(unpackText(await packText(XML, a), b)).rejects.toThrow();
  });

  test('壓縮後比原本的 XML 小（重複多的介面檔、場景檔）', async () => {
    const big = XML.repeat(50);
    expect((await packText(big, randomKey())).length).toBeLessThan(big.length / 5);
  });

  test('登記後依網址讀取（相對、絕對、./ 開頭都對應到同一個檔案）；沒登記的回傳 null', async () => {
    const key = randomKey();
    const packed = await packText(XML, key);
    registerPackedFiles(toBase64(key), { './scenes/test-packed.xml': async () => ({ default: packed }) });
    expect(hasPackedFile('scenes/test-packed.xml')).toBe(true);
    expect(await readPackedFile('/scenes/test-packed.xml')).toBe(XML);
    expect(await readPackedFile('./scenes/test-packed.xml?v=2')).toBe(XML);
    expect(readPackedFile('scenes/other.xml')).toBeNull();
  });
});
