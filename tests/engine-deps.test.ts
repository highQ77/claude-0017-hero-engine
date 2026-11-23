/**
 * 引擎、編輯器、遊戲專案 import 的第三方套件都要列在 tools/engine-deps.ts：
 * 沒列出的套件要等頁面用到時才預先打包，入口頁會停在空白畫面（見 engine-deps.ts 的說明）。
 */
import { expect, test } from 'vitest';
import { ENGINE_DEPS } from '../tools/engine-deps';

const sources = {
  ...import.meta.glob('../src/**/*.ts', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('../projects/*/src/**/*.ts', { query: '?raw', import: 'default', eager: true }),
} as Record<string, string>;

test('import 的第三方套件都列在 ENGINE_DEPS', () => {
  const missing = new Set<string>();
  for (const [file, code] of Object.entries(sources)) {
    // 只看執行期的 import（import type 不會載入套件）
    for (const m of code.matchAll(
      /(?:^|\n)\s*(?:import(?!\s+type\b)[^'"]*?from\s*|import\s*\(\s*|import\s+)['"]([^'"./][^'"]*)['"]/g,
    )) {
      const spec = m[1];
      if (spec.startsWith('@engine') || spec.startsWith('virtual:') || spec.startsWith('node:')) continue;
      if (!ENGINE_DEPS.includes(spec)) missing.add(`${spec}（${file.replace('../', '')}）`);
    }
  }
  expect([...missing]).toEqual([]);
});
