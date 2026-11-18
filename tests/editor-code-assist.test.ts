import { describe, expect, test } from 'vitest';
import { analyzeCode, suggest, type CodeContext } from '../src/editors/ui-editor/codeAssist';

/** | 代表游標 */
function at(src: string): CodeContext | null {
  const caret = src.indexOf('|');
  return analyzeCode(src.replace('|', ''), caret);
}

const components = ['UI', 'UIButton', 'UILabel', 'UISlider', 'UILayout'];

describe('原始碼提示：判斷游標在打什麼', () => {
  test('標籤名稱', () => {
    expect(at('<UI>\n  <UIBu|')).toMatchObject({ kind: 'tag', prefix: 'UIBu' });
    expect(at('<|')).toMatchObject({ kind: 'tag', prefix: '' });
  });

  test('屬性名稱：已經寫的屬性、斷點前綴', () => {
    const c = at('<UIButton text="A" |onClick="x"/>');
    expect(c).toMatchObject({ kind: 'attr', tag: 'UIButton', prefix: '' });
    expect([...(c as { existing: Set<string> }).existing].sort()).toEqual(['onClick', 'text']);
    expect(at('<UILayout md:pad|')).toMatchObject({ kind: 'attr', tag: 'UILayout', prefix: 'pad', breakpoint: 'md:' });
  });

  test('屬性值', () => {
    expect(at('<UILayout dir="|">')).toMatchObject({ kind: 'value', tag: 'UILayout', attr: 'dir', prefix: '' });
    expect(at('<UILayout md:dir="h|')).toMatchObject({ kind: 'value', attr: 'dir', prefix: 'h' });
  });

  test('不提示：標籤外、註解、結尾標籤、剛打完等號', () => {
    expect(at('<UI>文字|')).toBeNull();
    expect(at('<!-- 註解 |')).toBeNull();
    expect(at('</UIBu|')).toBeNull();
    expect(at('<UIButton text=|')).toBeNull();
  });
});

describe('原始碼提示：建議清單', () => {
  test('標籤：依前綴過濾，附說明；子元件標籤也有', () => {
    const tags = suggest(at('<UISl|')!, { components });
    expect(tags[0].label).toBe('UISlider');
    expect(tags[0].detail).toContain('拖曳');
    expect(suggest(at('<UISk|')!, { components }).map((s) => s.label)).toEqual(['UISkin']);
  });

  test('屬性：依字母 a → z 排列、已寫的不再出現、有說明與預設值', () => {
    const list = suggest(at('<UISlider value="3" |')!, { components, defaults: () => ({ min: '0', max: '100' }) });
    const labels = list.map((s) => s.label);
    const sorted = [...labels].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    expect(labels).toEqual(sorted); // 專屬屬性與通用屬性混在一起依字母排列
    expect(list.find((s) => s.label === 'orientation')!.hint).toBe('UISlider'); // 專屬屬性標示元件名稱
    expect(labels).not.toContain('value');
    expect(labels).toContain('orientation');
    expect(labels).toContain('id'); // 通用屬性
    const min = list.find((s) => s.label === 'min')!;
    expect(min.hint).toBe('預設 0');
    expect(min.detail).toBe('最小值');
    expect(suggest(at('<UISlider orien|')!, { components })[0].label).toBe('orientation');
  });

  test('屬性值：選項、樣式名稱、元件名稱、事件處理函式', () => {
    expect(suggest(at('<UISlider orientation="|')!, { components }).map((s) => s.label)).toEqual([
      'horizontal',
      'vertical',
    ]);
    expect(
      suggest(at('<UIButton style="pr|')!, { components, styles: ['primary', 'ghost'] }).map((s) => s.label),
    ).toEqual(['primary']);
    expect(suggest(at('<UISkin for="UIB|')!, { components }).map((s) => s.label)).toEqual(['UIButton']);
    expect(suggest(at('<UIButton onClick="screen.o|')!, { components })[0].label).toBe('screen.open:');
  });
});
