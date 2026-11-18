import { describe, expect, test } from 'vitest';
import { highlightXml } from '../src/editors/ui-editor/highlight';

/** 去掉標記後要和原文完全一樣（位置才會對齊） */
const plain = (html: string) =>
  html
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

describe('XML 語法高亮', () => {
  const src = `<?xml version="1.0"?>
<!-- 說明 -->
<UI padding="10" md:padding="16">
  <UIButton id="b" onClick="openMenu" text="選單 &amp; 設定"/>
  <UIList items="{rows}"><UITemplate><UILabel>{label} 分</UILabel></UITemplate></UIList>
  <Custom a='1'>文字 &lt; 3</Custom>
</UI>
`;
  const html = highlightXml(src);

  test('去掉顏色標記後與原文一字不差', () => {
    expect(plain(html)).toBe(src);
  });

  test('各種語法都有對應的顏色', () => {
    expect(html).toContain('<span class="hl-d">&lt;?xml version="1.0"?&gt;</span>');
    expect(html).toContain('<span class="hl-c">&lt;!-- 說明 --&gt;</span>');
    expect(html).toContain('<span class="hl-tu">UIButton</span>');
    expect(html).toContain('<span class="hl-t">Custom</span>');
    expect(html).toContain('<span class="hl-bp">md:</span><span class="hl-a">padding</span>');
    expect(html).toContain('<span class="hl-ev">onClick</span>');
    expect(html).toContain('<span class="hl-s">"openMenu"</span>');
    expect(html).toContain('<span class="hl-b">{rows}</span>');
    expect(html).toContain('<span class="hl-b">{label}</span>');
    expect(html).toContain('<span class="hl-e">&amp;amp;</span>');
    expect(html).toContain('<span class="hl-e">&amp;lt;</span>');
  });

  test('打到一半的 XML 也不會出錯、內容不會遺失', () => {
    for (const partial of [
      '<UILabel text="abc',
      '<UI',
      '<!-- 未結束',
      '<UILayout dir="h"\n  gap=',
      'a < b > c',
      '<a b="x\ny">',
    ]) {
      expect(plain(highlightXml(partial))).toBe(partial);
    }
  });
});
