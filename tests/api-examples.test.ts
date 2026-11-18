/**
 * 使用手冊的 API 參考：每個 API 都要有可以執行的範例（doc/manual/api-examples/<模組>.md）。
 * 新增 API 卻沒寫範例、範例的標題打錯（對不到任何 API）時，這個測試會失敗並列出名稱。
 *
 * 範例能不能通過型別檢查、在瀏覽器裡能不能執行，用 node doc/scripts/check-examples.mjs --api-only --run-api 檢查。
 */
import { describe, expect, test } from 'vitest';

interface Guide {
  text: string;
  code: string;
}
interface Item {
  name: string;
  guides: Guide[];
}
interface Module {
  id: string;
  importPath: string;
  items: Item[];
}
interface ApiModel {
  analyzeApi(): { modules: Module[] };
  parseGuides(text: string): Map<string, Guide[]>;
  guideFileOf(moduleId: string): string;
}

/** 範例檔：檔名 → 內容 */
const FILES: Record<string, string> = Object.fromEntries(
  Object.entries(
    import.meta.glob('../doc/manual/api-examples/*.md', { query: '?raw', import: 'default', eager: true }),
  ).map(([path, text]) => [path.split('/').pop()!, text as string]),
);

describe('API 參考的範例', async () => {
  const modelPath = '../tools/api-model.mjs'; // 用變數：型別檢查不去找 .mjs 的型別宣告
  const model = (await import(/* @vite-ignore */ modelPath)) as ApiModel;
  const { modules } = model.analyzeApi();

  test('每個 API 都有範例（有說明、有程式碼）', () => {
    const missing = modules.flatMap((m) =>
      m.items
        .filter((i) => !i.guides.some((g) => g.code.trim() && g.text.trim()))
        .map((i) => `${m.importPath} ${i.name}`),
    );
    expect(missing, `這些 API 沒有範例，請寫在 doc/manual/api-examples/<模組>.md：\n${missing.join('\n')}`).toEqual([]);
  });

  test('範例檔的每個標題都對得到 API（沒有打錯、沒有過時的）', () => {
    const files = new Set(Object.keys(FILES));
    const unknown: string[] = [];
    for (const m of modules) {
      const file = model.guideFileOf(m.id).split(/[\\/]/).pop()!;
      files.delete(file);
      const names = new Set(m.items.map((i) => i.name));
      const text = FILES[file] ?? '';
      for (const name of model.parseGuides(text).keys()) if (!names.has(name)) unknown.push(`${file}：## ${name}`);
    }
    expect(unknown, '這些標題對不到 API（名稱打錯，或 API 已經改名、移除）').toEqual([]);
    expect([...files], '這些範例檔對不到任何模組').toEqual([]);
  });
});
