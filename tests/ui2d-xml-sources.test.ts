import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchUIXml, hasBundledUIXml, registerUIXml } from '../src/ui2d/xmlSources';

describe('介面 XML 來源（打包後 XML 變成 JS 模組）', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('登記過的網址直接用打包好的內容，不會再抓檔案', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    registerUIXml({ '/ui/bundled-a.xml': async () => ({ default: '<UI>A</UI>' }) });
    expect(hasBundledUIXml('ui/bundled-a.xml')).toBe(true);
    expect(hasBundledUIXml('/ui/bundled-a.xml?t=123')).toBe(true); // 查詢字串不影響
    expect(await fetchUIXml('ui/bundled-a.xml')).toBe('<UI>A</UI>');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('沒有登記的網址照常用 fetch 讀取', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, text: async () => '<UI>B</UI>' })),
    );
    expect(await fetchUIXml('ui/not-bundled.xml')).toBe('<UI>B</UI>');
  });

  it('讀取失敗時錯誤訊息包含網址與狀態碼', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404, text: async () => '' })),
    );
    await expect(fetchUIXml('ui/missing.xml')).rejects.toThrow(/ui\/missing\.xml.*404/);
  });
});
