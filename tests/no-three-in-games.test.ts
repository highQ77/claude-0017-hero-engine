/**
 * 遊戲程式不直接 import three.js：數學類別用 @engine/math，網格、材質、貼圖用描述與 spawn、create 小工具。
 * 範圍：遊戲專案（projects/*／src）、新專案範本、使用手冊的程式範例。
 *
 * 真的需要 three.js 的進階用途（自訂繪製、特殊載入器…）可以用，但要加進下面的 ALLOWED，
 * 讓「一般遊戲不需要 three.js」這件事不會慢慢失守。
 */
import { describe, expect, test } from 'vitest';

/** 允許直接 import three 的檔案或範例（路徑、或「章節檔名#範例標題」） */
const ALLOWED: string[] = [];

/** import three（包含 three/examples/…）；import type 也算：型別名稱請從 @engine/render 引用 */
const IMPORTS_THREE = /^\s*import\s[^;]*?from\s+['"]three(?:\/[^'"]*)?['"]/m;

const read = (files: Record<string, unknown>) =>
  Object.entries(files).map(([path, text]) => [path.replace(/^\.\.\//, ''), text as string] as const);

const projectFiles = read(
  import.meta.glob(['../projects/*/src/**/*.ts', '../tools/templates/**/*.ts'], {
    query: '?raw',
    import: 'default',
    eager: true,
  }),
);
const chapters = read(
  import.meta.glob('../doc/manual/chapters/*.html', { query: '?raw', import: 'default', eager: true }),
);

/** 手冊裡的 TypeScript 範例（含不能執行的片段） */
function examples(): { id: string; code: string }[] {
  const out: { id: string; code: string }[] = [];
  for (const [path, html] of chapters) {
    const re = /<script type="text\/plain" class="example" data-lang="ts"([^>]*)>\n([\s\S]*?)<\/script>/g;
    for (let m = re.exec(html); m; m = re.exec(html)) {
      const title = /data-title="([^"]*)"/.exec(m[1])?.[1] ?? '';
      out.push({ id: `${path.split('/').pop()}#${title}`, code: m[2] });
    }
  }
  return out;
}

describe('遊戲程式不直接使用 three.js', () => {
  test('找得到要檢查的檔案', () => {
    expect(projectFiles.length).toBeGreaterThan(3);
    expect(examples().length).toBeGreaterThan(20);
  });

  test('遊戲專案與範本：沒有 import three', () => {
    const bad = projectFiles.filter(([path, text]) => IMPORTS_THREE.test(text) && !ALLOWED.includes(path));
    expect(bad.map(([path]) => `${path}：請改用 @engine/math、描述或 spawn／create 小工具`)).toEqual([]);
  });

  test('使用手冊的範例：沒有 import three', () => {
    const bad = examples().filter((e) => IMPORTS_THREE.test(e.code) && !ALLOWED.includes(e.id));
    expect(bad.map((e) => `${e.id}：請改用 @engine/math、描述或 spawn／create 小工具`)).toEqual([]);
  });
});
