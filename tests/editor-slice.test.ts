import { describe, expect, test } from 'vitest';
import { formatEdges, parseEdges } from '../src/editors/ui-editor/sliceEditor';

describe('九宮格編輯器：bgSlice 的讀寫', () => {
  test('讀取：和引擎相同的簡寫規則（上 右 下 左）', () => {
    expect(parseEdges('16')).toEqual([16, 16, 16, 16]);
    expect(parseEdges('8 12')).toEqual([8, 12, 8, 12]);
    expect(parseEdges('4 8 12')).toEqual([4, 8, 12, 8]);
    expect(parseEdges('1 2 3 4')).toEqual([1, 2, 3, 4]);
    expect(parseEdges(' 10.6  -3 ')).toEqual([11, 0, 11, 0]); // 四捨五入、不能是負數
    expect(parseEdges('')).toBeNull();
    expect(parseEdges(undefined)).toBeNull();
  });

  test('寫回：用最短的寫法', () => {
    expect(formatEdges([16, 16, 16, 16])).toBe('16');
    expect(formatEdges([8, 12, 8, 12])).toBe('8 12');
    expect(formatEdges([4, 8, 12, 8])).toBe('4 8 12');
    expect(formatEdges([1, 2, 3, 4])).toBe('1 2 3 4');
    for (const v of ['16', '8 12', '4 8 12', '1 2 3 4']) expect(formatEdges(parseEdges(v)!)).toBe(v);
  });
});
