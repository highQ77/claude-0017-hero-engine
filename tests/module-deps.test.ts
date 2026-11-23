/**
 * 模組相依規則：引擎的模組只能往「下層」引用，不能有循環。
 * 新增 import 違反規則時這個測試會失敗（node hero build 也會停止），並說明是哪一行。
 *
 * 只檢查執行期的 import；import type 只影響型別檢查，不會進到打包結果，所以不限制。
 */
import { describe, expect, test } from 'vitest';

/** src/ 底下所有 .ts 的內容（路徑相對於 src/，例如 'physics/Physics.ts'） */
const SOURCES: Record<string, string> = Object.fromEntries(
  Object.entries(import.meta.glob('../src/**/*.ts', { query: '?raw', import: 'default', eager: true })).map(
    ([path, text]) => [path.replace(/^\.\.\/src\//, ''), text as string],
  ),
);

/** 'a/b/../c' → 'a/c' */
function normalize(path: string): string {
  const out: string[] = [];
  for (const part of path.split('/')) {
    if (part === '..') out.pop();
    else if (part !== '.' && part !== '') out.push(part);
  }
  return out.join('/');
}
const dirOf = (path: string) => path.split('/').slice(0, -1).join('/');

/**
 * 每個模組可以引用的模組（整個模組）。
 * keys：只能引用那些模組的 keys.ts（資源鍵），不會連帶包含整個模組。
 * files：只能引用特定的小檔案。
 */
const RULES: Record<string, { deps: string[]; keys?: string[]; files?: string[] }> = {
  core: { deps: [] },
  // 數學：three.js 數學類別的轉出，不依賴引擎其他模組
  math: { deps: [] },
  ecs: { deps: ['core'] },
  scene: { deps: ['core', 'ecs'] },
  // 第 3 層：建立在場景上，彼此不互相依賴
  render: { deps: ['core', 'ecs', 'scene'] },
  physics: { deps: ['core', 'ecs', 'scene'] },
  input: { deps: ['core', 'ecs', 'scene'] },
  network: { deps: ['core', 'ecs', 'scene'] },
  // 第 4 層：需要繪製（把東西放進 3D 場景）
  assets: { deps: ['core', 'ecs', 'scene', 'render'] },
  particles: { deps: ['core', 'ecs', 'scene', 'render'] },
  shaders: { deps: ['core', 'ecs', 'scene', 'render'] },
  postfx: { deps: ['core', 'ecs', 'scene', 'render', 'shaders'] },
  ui2d: { deps: ['core', 'ecs', 'scene', 'render'] },
  audio: { deps: ['core', 'ecs', 'scene', 'render', 'assets'] },
  animation: { deps: ['core', 'ecs', 'scene', 'render', 'assets'] },
  text3d: { deps: ['core', 'ecs', 'scene', 'render', 'assets'] },
  // 第 5 層
  ui3d: { deps: ['core', 'ecs', 'scene', 'render', 'ui2d'] },
  ai: { deps: ['core', 'ecs', 'scene', 'physics'] },
  scripts: { deps: ['core', 'ecs', 'scene'], keys: ['render', 'input', 'audio', 'physics', 'animation', 'assets'] },
  // 最上層：套件管理只需要資源鍵與註冊用的小檔案（完整的引擎 API 在 api.ts，由遊戲決定要不要用）
  plugins: { deps: ['core', 'ecs'], keys: ['assets', 'shaders'], files: ['ui2d/registry'] },
};
/** 例外：給第三方套件的完整 API，本來就要引用所有模組 */
const ANY_IMPORT_FILES = ['plugins/api.ts'];
/** 不是執行期的模組（開發工具、套件、總入口），不檢查 */
const SKIP = ['editors', 'packages', 'index.ts'];

interface Edge {
  from: string;
  file: string;
  line: number;
  target: string; // 例如 'render/keys'、'render'（index）
}

function edges(): Edge[] {
  const out: Edge[] = [];
  for (const [rel, text] of Object.entries(SOURCES)) {
    const mod = rel.split('/')[0];
    if (SKIP.includes(mod) || SKIP.includes(rel)) continue;
    const re = /^(?:import|export)\s+(type\s+)?(?:[^;]*?\s+from\s+)?'(\.[^']+)';/gms;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      if (m[1]) continue; // import type
      // import { type A, type B }：全部都是型別
      const names = /\{([^}]*)\}/.exec(m[0])?.[1];
      if (names?.split(',').every((n) => !n.trim() || n.trim().startsWith('type '))) continue;
      const target = normalize(`${dirOf(rel)}/${m[2]}`).replace(/\.ts$/, '');
      if (target.split('/')[0] === mod) continue;
      out.push({ from: mod, file: rel, line: text.slice(0, m.index).split('\n').length, target });
    }
  }
  return out;
}

const all = edges();

describe('模組相依規則', () => {
  test('每個模組只引用允許的模組（違規時列出檔案與行號）', () => {
    const violations = all
      .filter((e) => !ANY_IMPORT_FILES.includes(e.file))
      .filter((e) => {
        const rule = RULES[e.from];
        if (!rule) return true; // 新模組：要先在 RULES 裡寫好它能依賴誰
        const [mod, ...rest] = e.target.split('/');
        const sub = rest.join('/');
        if (rule.deps.includes(mod)) return false;
        if (rule.keys?.includes(mod) && sub === 'keys') return false;
        if (rule.files?.includes(e.target)) return false;
        return true;
      })
      .map((e) => `${e.file}:${e.line} 引用了 ${e.target}（${e.from} 不能依賴它）`);
    expect(violations).toEqual([]);
  });

  test('所有模組都有規則', () => {
    const dirs = Object.keys(SOURCES)
      .filter((p) => p.includes('/'))
      .map((p) => p.split('/')[0]);
    const mods = [...new Set(dirs)].filter((d) => !SKIP.includes(d));
    expect(mods.filter((m) => !RULES[m])).toEqual([]);
  });

  test('沒有循環相依', () => {
    const graph = new Map<string, Set<string>>();
    for (const e of all) {
      if (ANY_IMPORT_FILES.includes(e.file)) continue;
      const set = graph.get(e.from) ?? new Set<string>();
      set.add(e.target.split('/')[0]);
      graph.set(e.from, set);
    }
    const cycles: string[] = [];
    const visit = (node: string, path: string[]) => {
      for (const next of graph.get(node) ?? []) {
        if (path.includes(next)) cycles.push([...path.slice(path.indexOf(next)), next].join(' → '));
        else visit(next, [...path, next]);
      }
    };
    for (const m of graph.keys()) visit(m, [m]);
    expect(cycles).toEqual([]);
  });

  test('keys.ts 只放資源鍵：除了 ecs/Resource 之外不引用任何程式', () => {
    const bad = all.filter((e) => e.file.endsWith('/keys.ts') && e.target !== 'ecs/Resource');
    expect(bad.map((e) => `${e.file}:${e.line} 引用了 ${e.target}`)).toEqual([]);
  });
});
