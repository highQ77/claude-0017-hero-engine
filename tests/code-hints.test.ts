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

/** 看名稱就懂、不要求說明的欄位（座標、尺寸、邊界） */
const SELF_EXPLANATORY = new Set([
  'x',
  'y',
  'z',
  'w',
  'width',
  'height',
  'left',
  'right',
  'top',
  'bottom',
  'min',
  'max',
]);

/**
 * 深一層：公開 API 用到的型別裡的欄位也要有說明——選項物件（options: { … }）、設定的子欄位（bloom.strength）、
 * 描述的各種寫法（{ box: … }）、回呼拿到的物件、分類物件與清單物件的成員。
 * 從每個公開名稱的型別往下找（引擎自己的型別，最多 4 層）；three.js 等外部型別、import * 的命名空間不算。
 */
function undocumentedNested(): { fields: string[]; params: string[] } {
  const config = ts.parseJsonConfigFileContent(
    ts.readConfigFile(`${ROOT}tsconfig.json`, ts.sys.readFile).config,
    ts.sys,
    ROOT,
  );
  const program = ts.createProgram(MODULE_ENTRIES, { ...config.options, noEmit: true });
  const checker = program.getTypeChecker();
  const inSrc = (d: ts.Node | undefined): d is ts.Node => !!d && d.getSourceFile().fileName.startsWith(`${ROOT}src/`);
  const doc = (s: ts.Symbol) => ts.displayPartsToString(s.getDocumentationComment(checker)).trim();
  const where = (d: ts.Node) => {
    const sf = d.getSourceFile();
    return `${sf.fileName.replace(ROOT, '')}:${sf.getLineAndCharacterOfPosition(d.getStart()).line + 1}`;
  };
  const hidden = (d: ts.Declaration) =>
    (ts.canHaveModifiers(d) &&
      (ts.getCombinedModifierFlags(d) & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)) !== 0) ||
    ts.getJSDocTags(d).some((t) => t.tagName.text === 'internal');

  const missing = new Set<string>();
  const missingParams = new Set<string>();
  const seen = new Set<ts.Type>();
  /** 有自己說明的函式種類（回呼的型別 (x) => void 的參數寫在回呼的說明裡，不檢查） */
  const FUNCTION_KINDS = new Set([
    ts.SyntaxKind.FunctionDeclaration,
    ts.SyntaxKind.MethodDeclaration,
    ts.SyntaxKind.Constructor,
    ts.SyntaxKind.MethodSignature,
    ts.SyntaxKind.ArrowFunction,
    ts.SyntaxKind.FunctionExpression,
  ]);
  /** 參數要有 @param 或自己的說明（_ 開頭的不用；覆寫的方法沒有說明時沿用父類別的） */
  const checkParams = (decl: ts.SignatureDeclaration, path: string) => {
    if (!FUNCTION_KINDS.has(decl.kind) || hidden(decl)) return;
    const host =
      ts.isArrowFunction(decl) || ts.isFunctionExpression(decl)
        ? ts.isVariableDeclaration(decl.parent)
          ? decl.parent.parent.parent
          : decl.parent
        : decl;
    if (hidden(host as ts.Declaration)) return;
    const jsDocs = (host as { jsDoc?: ts.JSDoc[] }).jsDoc ?? [];
    const override =
      ts.canHaveModifiers(host) &&
      (ts.getCombinedModifierFlags(host as ts.Declaration) & ts.ModifierFlags.Override) !== 0;
    if (override && !jsDocs.length) return;
    for (const p of decl.parameters) {
      if (!ts.isIdentifier(p.name) || p.name.text.startsWith('_')) continue;
      const own = ((p as { jsDoc?: ts.JSDoc[] }).jsDoc ?? []).some((j) => j.comment);
      if (!own && ts.getJSDocParameterTags(p).length === 0) missingParams.add(`${where(p)} ${path}(${p.name.text})`);
    }
  };
  const walkSignature = (sig: ts.Signature, path: string) => {
    const decl = sig.getDeclaration();
    if (!inSrc(decl)) return;
    checkParams(decl, path);
    for (const p of sig.getParameters()) {
      const d = p.valueDeclaration;
      if (inSrc(d)) walk(checker.getNonNullableType(checker.getTypeOfSymbolAtLocation(p, d)), `${path}(${p.name})`, 1);
    }
  };
  const walk = (type: ts.Type, path: string, depth: number): void => {
    if (depth > 4) return;
    if (type.isUnionOrIntersection()) {
      for (const t of type.types) walk(t, path, depth);
      return;
    }
    if (!(type.flags & ts.TypeFlags.Object) || seen.has(type)) return;
    const sym = type.getSymbol() ?? type.aliasSymbol;
    if (!sym?.declarations?.some(inSrc) || sym.flags & ts.SymbolFlags.ValueModule) return;
    seen.add(type);
    for (const sig of type.getCallSignatures()) walkSignature(sig, path);
    for (let p of type.getProperties()) {
      if (p.flags & ts.SymbolFlags.Alias) p = checker.getAliasedSymbol(p);
      const d = p.declarations?.[0];
      if (!inSrc(d) || hidden(d) || p.name.startsWith('_') || p.name === '__constructor') continue;
      if (SELF_EXPLANATORY.has(p.name)) continue;
      if (!doc(p)) missing.add(`${where(d)} ${path}.${p.name}`);
      walk(checker.getNonNullableType(checker.getTypeOfSymbolAtLocation(p, d)), `${path}.${p.name}`, depth + 1);
    }
  };

  for (const entry of MODULE_ENTRIES) {
    const sf = program.getSourceFile(entry);
    const mod = sf && checker.getSymbolAtLocation(sf);
    if (!mod) continue;
    for (let sym of checker.getExportsOfModule(mod)) {
      if (sym.flags & ts.SymbolFlags.Alias) sym = checker.getAliasedSymbol(sym);
      const d = sym.declarations?.[0];
      if (!inSrc(d)) continue;
      if (sym.flags & (ts.SymbolFlags.Interface | ts.SymbolFlags.Class | ts.SymbolFlags.TypeAlias))
        walk(checker.getDeclaredTypeOfSymbol(sym), sym.name, 0);
      if (sym.flags & ts.SymbolFlags.Class)
        for (const sig of checker.getTypeOfSymbolAtLocation(sym, d).getConstructSignatures())
          walkSignature(sig, `new ${sym.name}`);
      if (sym.flags & (ts.SymbolFlags.Variable | ts.SymbolFlags.Function))
        walk(checker.getTypeOfSymbolAtLocation(sym, d), sym.name, 0);
    }
  }
  return { fields: [...missing].sort(), params: [...missingParams].sort() };
}

describe('程式碼提示：TypeScript', () => {
  const nested = (() => {
    let cached: ReturnType<typeof undocumentedNested> | null = null;
    return () => (cached ??= undocumentedNested());
  })();

  test('引擎公開的 API 都有說明（JSDoc）', () => {
    expect(undocumented()).toEqual([]);
  }, 60_000);

  test('API 裡的選項、設定、描述的欄位也都有說明（滑鼠停在欄位上看得到用途）', () => {
    expect(nested().fields).toEqual([]);
  }, 60_000);

  test('公開函式的參數都有說明（@param：打函式時的參數提示看得到）', () => {
    expect(nested().params).toEqual([]);
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
