import { describe, expect, test } from 'vitest';
import {
  duplicateNode,
  insertNode,
  insertionPoint,
  moveNode,
  nodeAt,
  paletteNode,
  parseDocument,
  pathAtLine,
  removeNode,
  serialize,
  shiftNode,
} from '../src/editors/ui-editor/model';

const doc = () =>
  parseDocument(`<!-- 開頭註解 -->
<UI>
  <UILayout id="a">
    <UILabel>一</UILabel>
    <UILabel>二</UILabel>
  </UILayout>
  <!-- 中間註解 -->
  <UIImage src="x.png">
  <UIButton id="b" text="按"/>
</UI>`);

const tags = (node: { children: { tag: string; attrs: Record<string, string>; text: string }[] }) =>
  node.children.map((c) => c.attrs.id ?? c.text ?? c.tag);

describe('輸出', () => {
  test('保留註解、縮排整齊，再解析後結構相同', () => {
    const text = serialize(doc());
    expect(text).toBe(`<!-- 開頭註解 -->
<UI>
  <UILayout id="a">
    <UILabel>一</UILabel>
    <UILabel>二</UILabel>
  </UILayout>
  <!-- 中間註解 -->
  <UIImage src="x.png"/>
  <UIButton id="b" text="按"/>
</UI>
`);
    expect(serialize(parseDocument(text))).toBe(text);
  });

  test('特殊字元會跳脫', () => {
    const root = parseDocument('<UI><UILabel text="a &quot;b&quot; &lt;c&gt;">x &amp; y</UILabel></UI>');
    const out = serialize(root);
    expect(out).toContain('text="a &quot;b&quot; &lt;c>"');
    expect(out).toContain('>x &amp; y<');
    expect(nodeAt(parseDocument(out), [0])!.attrs.text).toBe('a "b" <c>');
  });
});

describe('結構操作', () => {
  test('插入、刪除、複製（複製時移除 id）', () => {
    const root = doc();
    const p = insertNode(root, [0], 1, paletteNode('<UILabel>新</UILabel>'));
    expect(p).toEqual([0, 1]);
    expect(tags(nodeAt(root, [0])!)).toEqual(['一', '新', '二']);
    removeNode(root, [0, 0]);
    expect(tags(nodeAt(root, [0])!)).toEqual(['新', '二']);
    const copy = duplicateNode(root, [3]);
    expect(copy).toEqual([4]);
    expect(nodeAt(root, [4])!.attrs).toEqual({ text: '按' });
    expect(() => removeNode(root, [])).toThrow(/最外層/);
  });

  test('移動：同一層往後、往前；移到其他容器；不能移到自己裡面', () => {
    const root = doc();
    // 把「一」移到「二」後面（同一層往後）
    expect(moveNode(root, [0, 0], [0], 2)).toEqual([0, 1]);
    expect(tags(nodeAt(root, [0])!)).toEqual(['二', '一']);
    // 把按鈕移進 UILayout 的最前面
    expect(moveNode(root, [3], [0], 0)).toEqual([0, 0]);
    expect(tags(nodeAt(root, [0])!)).toEqual(['b', '二', '一']);
    // 把 UILayout 移到最後（後面的節點不受影響）
    expect(moveNode(root, [0], [], 3)).toEqual([2]);
    expect(() => moveNode(root, [2], [2, 0], 0)).toThrow(/自己裡面/);
  });

  test('移動到排在前面的兄弟節點裡面時，路徑會修正', () => {
    const root = parseDocument('<UI><UILayout id="x"/><UILayout id="y"/><UILabel>t</UILabel></UI>');
    // 把 y（索引 1）移進 x（索引 0）
    expect(moveNode(root, [1], [0], 0)).toEqual([0, 0]);
    // 把 t（現在索引 1）移進 x 裡面的 y（[0, 0]）
    expect(moveNode(root, [1], [0, 0], 0)).toEqual([0, 0, 0]);
    expect(serialize(root)).toContain('<UILayout id="y">\n      <UILabel>t</UILabel>');
  });

  test('前後移動會跳過註解', () => {
    const root = doc();
    expect(shiftNode(root, [2], -1)).toEqual([0]); // 圖片往前：跳過註解，和 UILayout 交換
    expect(nodeAt(root, [0])!.tag).toBe('UIImage');
    expect(shiftNode(root, [0], -1)).toEqual([0]); // 已經最前面
  });

  test('插入位置：容器放進去，其他放在後面', () => {
    const root = doc();
    expect(insertionPoint(root, [0])).toEqual({ parent: [0], index: 2 });
    expect(insertionPoint(root, [0, 0])).toEqual({ parent: [0], index: 1 });
    expect(insertionPoint(root, null)).toEqual({ parent: [], index: 4 });
    expect(insertionPoint(root, [3])).toEqual({ parent: [], index: 4 }); // 按鈕：放在後面，不放進去
  });

  test('依行號找節點', () => {
    const root = parseDocument(serialize(doc()));
    expect(pathAtLine(root, 4)).toEqual([0, 0]);
    expect(pathAtLine(root, 9)).toEqual([3]);
    expect(pathAtLine(root, 7)).toBeNull(); // 註解那一行
  });
});
