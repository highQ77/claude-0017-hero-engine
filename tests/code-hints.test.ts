/**
 * 程式碼提示完整：
 * - TypeScript：引擎公開的名稱、類別與介面的公開成員、分類物件的成員都要有說明（JSDoc），
 *   編輯器（VS Code）的提示、滑鼠停留時才看得到用途
 * - XML（UI 編輯器）：每個元件都在元件庫與屬性提示裡，提示的屬性都有說明
 * 新增 API 或屬性卻沒寫說明時，這個測試會列出是哪一個。
 */
import ts from 'typescript';
import { describe, expect, test } from 'vitest';
import { UI2D } from '../src/ui2d';
import { ATTRIBUTE_HINTS, PALETTE } from '../src/editors/ui-editor/model';
import { ATTR_DOCS } from '../src/editors/ui-editor/codeAssist';

const ROOT = decodeURIComponent(new URL('..', import.meta.url).pathname);

/** 引擎各模組的入口（src/<模組>/index.ts） */
const MODULE_ENTRIES = Object.keys(import.meta.glob('../src/*/index.ts')).map((p) => `${ROOT}${p.slice(3)}`);

/** 沒有說明的公開 API：「檔案:行 名稱」 */
function undocumented(): string[] {
  const config = ts.parseJsonConfigFileContent(
    ts.readConfigFile(`${ROOT}tsconfig.json`, ts.sys.readFile).config,
    ts.sys,
    ROOT,
  );
  const program = ts.createProgram(MODULE_ENTRIES, { ...config.options, noEmit: true });
  const checker = program.getTypeChecker();
  const doc = (s: ts.Symbol) => ts.displayPartsToString(s.getDocumentationComment(checker)).trim();
  const where = (s: ts.Symbol) => {
    const d = s.declarations?.[0];
    if (!d) return '?';
    const sf = d.getSourceFile();
    return `${sf.fileName.replace(ROOT, '')}:${sf.getLineAndCharacterOfPosition(d.getStart()).line + 1}`;
  };
  const external = (s: ts.Symbol) =>
    (s.declarations ?? []).some((d) => d.getSourceFile().fileName.includes('node_modules'));
  const hidden = (d: ts.Declaration | undefined) =>
    !!d &&
    ((ts.canHaveModifiers(d) &&
      (ts.getCombinedModifierFlags(d) &
        (ts.ModifierFlags.Private | ts.ModifierFlags.Protected | ts.ModifierFlags.Override)) !==
        0) ||
      ts.getJSDocTags(d).some((t) => t.tagName.text === 'internal'));

  const missing = new Set<string>();
  for (const entry of MODULE_ENTRIES) {
    const sf = program.getSourceFile(entry);
    const mod = sf && checker.getSymbolAtLocation(sf);
    if (!mod) continue;
    for (let sym of checker.getExportsOfModule(mod)) {
      if (sym.flags & ts.SymbolFlags.Alias) sym = checker.getAliasedSymbol(sym);
      if (external(sym)) continue; // three.js 的轉出（@engine/math、型別名稱）：three 自己有說明
      if (!doc(sym)) missing.add(`${where(sym)} ${sym.name}`);
      const decl = sym.declarations?.[0];
      let members: ts.Symbol[] = [];
      if (sym.flags & (ts.SymbolFlags.Class | ts.SymbolFlags.Interface)) members = [...(sym.members?.values() ?? [])];
      else if (decl && ts.isVariableDeclaration(decl)) {
        // 分類物件（spawn、create…）：每個成員都是函式
        const props = checker.getTypeOfSymbolAtLocation(sym, decl).getProperties();
        if (props.length && props.every((p) => checker.getTypeOfSymbolAtLocation(p, decl).getCallSignatures().length))
          members = props;
      }
      for (const m of members) {
        if (m.flags & ts.SymbolFlags.TypeParameter || m.name.startsWith('_') || m.name === '__constructor') continue;
        if (hidden(m.declarations?.[0])) continue;
        if (!doc(m)) missing.add(`${where(m)} ${sym.name}.${m.name}`);
      }
    }
  }
  return [...missing].sort();
}

describe('程式碼提示：TypeScript', () => {
  test('引擎公開的 API 都有說明（JSDoc）', () => {
    expect(undocumented()).toEqual([]);
  }, 60_000);
});

describe('程式碼提示：XML（UI 編輯器）', () => {
  test('每個元件都在元件庫與屬性提示裡', () => {
    // UI 是根元素；UIDialog 是舊名稱（改用 UIDialogue）；UITab 只能寫在 UITabs 裡
    const notInPalette = new Set(['UI', 'UIDialog', 'UITab']);
    const palette = new Set(PALETTE.map((p) => p.tag));
    const tags = [...UI2D.components.keys()];
    expect(tags.filter((t) => !notInPalette.has(t) && !palette.has(t))).toEqual([]);
    expect(tags.filter((t) => t !== 'UIDialog' && !ATTRIBUTE_HINTS[t])).toEqual([]);
  });

  test('提示的屬性都有說明', () => {
    const hinted = new Set(Object.values(ATTRIBUTE_HINTS).flat());
    expect([...hinted].filter((name) => !(name in ATTR_DOCS)).sort()).toEqual([]);
  });

  test('浮動說明、游標等共用屬性也有提示', () => {
    for (const name of [
      'tooltip',
      'tooltipTitle',
      'tooltipColor',
      'tooltipDelay',
      'tooltipFontSize',
      'tooltipWidth',
      'cursor',
    ])
      expect(ATTRIBUTE_HINTS.common).toContain(name);
  });
});
