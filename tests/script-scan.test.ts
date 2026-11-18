/// <reference types="vite/client" />
import { describe, expect, test } from 'vitest';
import { scanScripts } from '../tools/script-scan';

describe('找出腳本與參數（3D 場景編輯器「加入腳本」）', () => {
  test('範例專案的 Coin', () => {
    const src = Object.values(
      import.meta.glob('../projects/official-demo-000-start/src/coin.ts', {
        query: '?raw',
        import: 'default',
        eager: true,
      }),
    )[0] as string;
    const [coin] = scanScripts(src, 'src/coin.ts');
    expect(coin.name).toBe('Coin');
    expect(coin.props).toEqual([{ name: 'value', default: 1, type: 'number', doc: undefined }]);
  });

  test('各種寫法：說明、型別、private／static／readonly、方法裡的變數、抽象類別', () => {
    const src = `
import { Script } from '@engine/scripts';
/** 會轉的東西 */
export class Spinner extends Script {
  /** 每秒轉幾度 */
  speed = 90;
  label: string = 'hi {not a brace}';
  enabled2 = true; // 一開始就轉
  /**
   * 多行的
   * 說明
   */
  axis = "y";
  private secret = 3;
  protected guarded = 1;
  static count = 0;
  readonly fixed = 2;
  _internal = 5;
  target = new Vector3();
  handler = () => { const inner = 9; };
  onUpdate(dt: number) {
    const local = 1;
    if (dt > 0) { this.x = 2; }
  }
}
abstract class Base extends Script { a = 1; }
class Other extends Script {}
class NotAScript extends Thing { b = 1; }
`;
    const found = scanScripts(src, 'x.ts');
    expect(found.map((s) => s.name)).toEqual(['Spinner', 'Other']);
    const [s] = found;
    expect(s.doc).toBe('會轉的東西');
    expect(s.props).toEqual([
      { name: 'speed', default: 90, type: 'number', doc: '每秒轉幾度' },
      { name: 'label', default: 'hi {not a brace}', type: 'string', doc: undefined },
      { name: 'enabled2', default: true, type: 'boolean', doc: '一開始就轉' },
      { name: 'axis', default: 'y', type: 'string', doc: '多行的 說明' },
    ]);
    expect(s.line).toBe(4); // 第 1 行是空的：class 在第 4 行
  });
});
