/**
 * 分析引擎公開的 API（給 node hero api 的 tips/api.txt 與使用手冊的「API 參考」共用）。
 *
 * 來源：src/<模組>/index.ts 匯出的東西（就是遊戲 import '@engine/<模組>' 拿得到的），
 * 加上 src/packages 的套件。用 TypeScript 編譯器讀型別與註解：
 * - 類別：建構式、公開的方法、屬性、getter（不列 private、protected、@internal、_ 開頭）
 * - 函式：完整的參數與回傳型別
 * - 介面：每個欄位
 * - 常數、型別別名、列舉
 * 說明取自原始碼註解（/** … *\/），另外整理 @param、@returns、@example 與原始碼的位置。
 *
 *   import { analyzeApi } from './api-model.mjs';
 *   const { modules, total } = analyzeApi();
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
/** 範例與解說（每個模組一個檔案，格式見 loadGuides） */
const GUIDES = join(ROOT, 'doc', 'manual', 'api-examples');
/** 手冊範例共用的 engine.ts（範例裡的 world、scenes…） */
const EXAMPLE_ENGINE = join(ROOT, 'doc', 'manual', 'engine.ts');

/** 模組的順序與中文名稱（沒列到的放最後） */
export const MODULES = [
  ['core', '核心：引擎、主迴圈、時間、設定'],
  ['math', '數學：向量、四元數、顏色（three.js 的數學類別）'],
  ['ecs', '實體與元件（ECS）'],
  ['scene', '場景、Transform、父子關係'],
  ['render', '繪製：攝影機、燈光、網格'],
  ['input', '輸入：鍵盤、滑鼠、觸控、手把'],
  ['scripts', '腳本'],
  ['animation', '動畫：補間、時間軸、模型動畫、狀態機'],
  ['physics', '物理（Rapier）'],
  ['particles', '粒子'],
  ['audio', '音效'],
  ['assets', '資源載入'],
  ['ui2d', '2D 介面（XML、Yoga 排版、元件、畫面管理、場景轉場）'],
  ['ui3d', '3D 介面面板'],
  ['text3d', '3D 文字'],
  ['postfx', '後製效果'],
  ['shaders', '著色器'],
  ['ai', 'AI：狀態機、行為樹、尋路、轉向'],
  ['network', '多人連線'],
  ['plugins', '套件管理'],
];

/** 種類：排序與中文名稱 */
export const KINDS = [
  ['class', '類別'],
  ['function', '函式'],
  ['const', '常數'],
  ['enum', '列舉'],
  ['interface', '介面（型別）'],
  ['type', '型別別名'],
  ['other', '其他'],
];

const MAX_TYPE = 160;

// ───────── 小工具 ─────────

const oneLine = (s) => s.replace(/\s+/g, ' ').trim();
const clip = (s, n = MAX_TYPE) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** 範例程式：去掉共同的縮排、前後的空行 */
function dedent(text) {
  const lines = text.replace(/\t/g, '  ').split('\n');
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => /^ */.exec(l)[0].length));
  return lines.map((l) => l.slice(Number.isFinite(indent) ? indent : 0)).join('\n');
}

/** 型別文字：去掉絕對路徑（import("…/src/core/index") → import("@engine/core")） */
const cleanPaths = (s) =>
  s
    .replace(/import\("[^"]*\/node_modules\/((?:@[^/"]+\/)?[^/"]+)[^"]*"\)/g, 'import("$1")')
    .replace(/import\("[^"]*\/src\/([\w-]+)\/index"\)/g, 'import("@engine/$1")')
    .replace(/import\("[^"]*\/src\/([^"]+)"\)/g, 'import("@engine/$1")');
/** 可省略的欄位不用再寫 | undefined */
const optionalType = (t, optional) => (optional ? t.replace(/ \| undefined$/, '') : t);

/**
 * 分析整個引擎的公開 API。
 * @returns modules：每個模組（id、標題、引用方式、項目），total：項目總數
 */
export function analyzeApi() {
  const entries = readdirSync(SRC)
    .filter((d) => existsSync(join(SRC, d, 'index.ts')))
    .sort((a, b) => {
      const ia = MODULES.findIndex(([m]) => m === a);
      const ib = MODULES.findIndex(([m]) => m === b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
    });
  const packages = existsSync(join(SRC, 'packages'))
    ? readdirSync(join(SRC, 'packages'))
        .filter((f) => f.endsWith('.ts'))
        .sort()
    : [];
  const files = [...entries.map((d) => join(SRC, d, 'index.ts')), ...packages.map((f) => join(SRC, 'packages', f))];
  const configPath = join(ROOT, 'tsconfig.json');
  const config = ts.parseJsonConfigFileContent(ts.readConfigFile(configPath, ts.sys.readFile).config, ts.sys, ROOT);
  const program = ts.createProgram(files, { ...config.options, noEmit: true });
  const checker = program.getTypeChecker();

  const typeText = (type, node) =>
    clip(
      cleanPaths(
        oneLine(
          checker.typeToString(
            type,
            node,
            ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope,
          ),
        ),
      ),
    );

  function signatureText(sig, node) {
    const params = sig.getParameters().map((p) => {
      const decl = p.valueDeclaration;
      const optional = decl && ts.isParameter(decl) && (decl.questionToken || decl.initializer);
      const rest = decl && ts.isParameter(decl) && decl.dotDotDotToken ? '...' : '';
      const t = typeText(checker.getTypeOfSymbolAtLocation(p, node), node);
      return `${rest}${p.name}${optional ? '?' : ''}: ${t}`;
    });
    const ret = typeText(sig.getReturnType(), node);
    const tps = sig.getTypeParameters?.();
    const generics = tps?.length ? `<${tps.map((t) => checker.typeToString(t)).join(', ')}>` : '';
    return `${generics}(${params.join(', ')}): ${ret}`;
  }

  /** 註解：第一行（summary）、全文、@param、@returns、@example、@deprecated */
  function docOf(symbol) {
    const empty = { summary: '', doc: '', params: [], returns: '', examples: [], deprecated: '' };
    if (!symbol) return empty;
    const text = ts.displayPartsToString(symbol.getDocumentationComment(checker)).trim();
    const out = { ...empty, doc: text, summary: oneLine(text.split('\n').find((l) => l.trim()) ?? '') };
    for (const tag of symbol.getJsDocTags(checker)) {
      const parts = tag.text ?? [];
      const body = ts.displayPartsToString(parts);
      if (tag.name === 'param') {
        const name = parts.find((p) => p.kind === 'parameterName')?.text ?? body.split(/\s/)[0];
        const desc = parts
          .filter((p) => p.kind !== 'parameterName')
          .map((p) => p.text)
          .join('')
          .replace(/^\s*-?\s*/, '');
        out.params.push({ name, doc: oneLine(desc) });
      } else if (tag.name === 'returns' || tag.name === 'return') out.returns = oneLine(body);
      // 有些套件（three.js）的範例包在 Markdown 的 ``` 裡：去掉
      else if (tag.name === 'example') out.examples.push(dedent(body.replace(/^\s*```\w*\s*\n|\n\s*```\s*$/g, '\n')));
      else if (tag.name === 'deprecated') out.deprecated = oneLine(body) || '已不建議使用';
    }
    return out;
  }

  const isInternal = (symbol) => symbol.getJsDocTags(checker).some((t) => t.name === 'internal');
  const isHidden = (decl, name) => {
    const mods = ts.getCombinedModifierFlags(decl);
    return (
      mods & ts.ModifierFlags.Private ||
      mods & ts.ModifierFlags.Protected ||
      name.startsWith('_') ||
      name.startsWith('#')
    );
  };
  const sourceOf = (decl) => {
    const sf = decl.getSourceFile();
    return {
      file: relative(ROOT, sf.fileName).replace(/\\/g, '/'),
      line: sf.getLineAndCharacterOfPosition(decl.getStart()).line + 1,
    };
  };
  const member = (name, text, sym) => {
    const d = docOf(sym);
    return { name, text, doc: d.summary, examples: d.examples };
  };

  // ───────── 各種宣告 ─────────

  function classMembers(name, decl) {
    const lines = [];
    for (const m of decl.members) {
      const mName = m.name ? m.name.getText() : '';
      if (ts.isConstructorDeclaration(m)) {
        if (ts.getCombinedModifierFlags(m) & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)) continue;
        const sig = checker.getSignatureFromDeclaration(m);
        // 建構式自己的註解（沒有就不寫，類別的說明已經在上面）
        const ctorDoc = oneLine(
          ts
            .getJSDocCommentsAndTags(m)
            .map((d) => (typeof d.comment === 'string' ? d.comment : ''))
            .join(' ')
            .split('\n')[0] ?? '',
        );
        lines.push({
          name: 'constructor',
          text: `new ${name}${signatureText(sig, m).replace(/: [^:]*$/, '')}`,
          doc: ctorDoc,
          examples: [],
        });
        continue;
      }
      if (!mName || isHidden(m, mName)) continue;
      const mSym = m.name && checker.getSymbolAtLocation(m.name);
      if (mSym && isInternal(mSym)) continue;
      const isStatic = ts.getCombinedModifierFlags(m) & ts.ModifierFlags.Static ? 'static ' : '';
      const readonly = ts.getCombinedModifierFlags(m) & ts.ModifierFlags.Readonly ? 'readonly ' : '';
      if (ts.isMethodDeclaration(m)) {
        const sig = checker.getSignatureFromDeclaration(m);
        lines.push(member(mName, `${isStatic}${mName}${signatureText(sig, m)}`, mSym));
      } else if (ts.isPropertyDeclaration(m)) {
        const t = mSym ? typeText(checker.getTypeOfSymbolAtLocation(mSym, m), m) : '';
        lines.push(member(mName, `${isStatic}${readonly}${mName}: ${t}`, mSym));
      } else if (ts.isGetAccessorDeclaration(m)) {
        const hasSetter = decl.members.some((x) => ts.isSetAccessorDeclaration(x) && x.name.getText() === mName);
        const t = typeText(checker.getTypeAtLocation(m), m);
        const sig = checker.getSignatureFromDeclaration(m);
        lines.push(
          member(
            mName,
            `${isStatic}${hasSetter ? '' : 'get '}${mName}: ${sig ? typeText(sig.getReturnType(), m) : t}`,
            mSym,
          ),
        );
      } else if (ts.isSetAccessorDeclaration(m)) {
        if (decl.members.some((x) => ts.isGetAccessorDeclaration(x) && x.name.getText() === mName)) continue;
        lines.push(member(mName, `${isStatic}set ${mName}`, mSym));
      }
    }
    // 方法簽章相同（多載）的只列一次
    const seen = new Set();
    return lines.filter((l) => !seen.has(l.text) && seen.add(l.text));
  }

  function interfaceMembers(decls) {
    const out = [];
    for (const d of decls) {
      for (const m of d.members) {
        const mName = m.name
          ? m.name.getText()
          : ts.isCallSignatureDeclaration(m)
            ? '(呼叫)'
            : ts.isIndexSignatureDeclaration(m)
              ? '[索引]'
              : '';
        if (!mName || mName.startsWith('_')) continue;
        const mSym = m.name && checker.getSymbolAtLocation(m.name);
        if (mSym && isInternal(mSym)) continue;
        const opt = m.questionToken ? '?' : '';
        const ro = ts.getCombinedModifierFlags(m) & ts.ModifierFlags.Readonly ? 'readonly ' : '';
        let text;
        if (ts.isMethodSignature(m) || ts.isCallSignatureDeclaration(m)) {
          const sig = checker.getSignatureFromDeclaration(m);
          text = `${ts.isCallSignatureDeclaration(m) ? '' : mName}${opt}${signatureText(sig, m)}`;
        } else if (ts.isIndexSignatureDeclaration(m)) {
          text = oneLine(m.getText()).replace(/;$/, '');
        } else {
          const t = mSym ? typeText(checker.getTypeOfSymbolAtLocation(mSym, m), m) : oneLine(m.type?.getText() ?? '');
          text = `${ro}${mName}${opt}: ${optionalType(t, !!opt)}`;
        }
        out.push(member(mName, text, mSym));
      }
    }
    return out;
  }

  /** 一個匯出的項目 */
  function describe(name, symbol) {
    const decls = symbol.getDeclarations() ?? [];
    const decl = decls[0];
    const base = { name, kind: 'other', heads: [name], members: [], note: '', source: null, ...docOf(symbol) };
    if (!decl) return base;
    const item = { ...base, source: sourceOf(decl) };
    if (ts.isClassDeclaration(decl)) {
      const heritage = (decl.heritageClauses ?? []).map((h) => oneLine(h.getText())).join(' ');
      const abstract = ts.getCombinedModifierFlags(decl) & ts.ModifierFlags.Abstract ? 'abstract ' : '';
      return {
        ...item,
        kind: 'class',
        heads: [`${abstract}class ${name}${heritage ? ` ${heritage}` : ''}`],
        members: classMembers(name, decl),
      };
    }
    if (ts.isInterfaceDeclaration(decl)) {
      const ext = (decl.heritageClauses ?? []).map((h) => oneLine(h.getText())).join(' ');
      const tps = decl.typeParameters?.length ? `<${decl.typeParameters.map((t) => t.getText()).join(', ')}>` : '';
      return {
        ...item,
        kind: 'interface',
        heads: [`interface ${name}${tps}${ext ? ` ${ext}` : ''}`],
        members: interfaceMembers(decls.filter(ts.isInterfaceDeclaration)),
      };
    }
    if (ts.isFunctionDeclaration(decl)) {
      const sigs = checker.getTypeOfSymbolAtLocation(symbol, decl).getCallSignatures();
      return { ...item, kind: 'function', heads: sigs.map((sig) => `function ${name}${signatureText(sig, decl)}`) };
    }
    if (ts.isTypeAliasDeclaration(decl)) {
      const tps = decl.typeParameters?.length ? `<${decl.typeParameters.map((t) => t.getText()).join(', ')}>` : '';
      return { ...item, kind: 'type', heads: [`type ${name}${tps} = ${clip(oneLine(decl.type.getText()))}`] };
    }
    if (ts.isEnumDeclaration(decl)) {
      return {
        ...item,
        kind: 'enum',
        heads: [`enum ${name} { ${clip(decl.members.map((m) => m.name.getText()).join(', '))} }`],
      };
    }
    if (ts.isVariableDeclaration(decl) || ts.isExportAssignment(decl)) {
      const c = { ...item, kind: 'const' };
      const type = checker.getTypeOfSymbolAtLocation(symbol, decl);
      // 字串、數字等基本型別的常數
      if (type.flags & (ts.TypeFlags.StringLike | ts.TypeFlags.NumberLike | ts.TypeFlags.BooleanLike)) {
        const t = typeText(type, decl);
        return {
          ...c,
          heads: [`const ${name}: ${t.length > 60 ? checker.typeToString(checker.getBaseTypeOfLiteralType(type)) : t}`],
        };
      }
      // 元件、資源鍵：顯示型別名稱（例如 ResourceKey<PerfStats>），不要展開成物件
      const alias = type.aliasSymbol?.name ?? type.symbol?.name;
      if (alias === 'ComponentType' || alias === 'ResourceKey')
        return { ...c, heads: [`const ${name}: ${typeText(type, decl)}`] };
      if (
        decl.initializer &&
        ts.isCallExpression(decl.initializer) &&
        /^(define(Resource|Component|Tag)|define\.(resource|component|tag))$/.test(
          decl.initializer.expression.getText(),
        )
      ) {
        const fn = decl.initializer.expression.getText();
        const arg = decl.initializer.typeArguments?.[0]?.getText();
        const kind = /^define(Resource|\.resource)$/.test(fn) ? 'ResourceKey' : 'ComponentType';
        return { ...c, heads: [`const ${name}: ${kind}<${clip(oneLine(arg ?? '…'), 120)}>`] };
      }
      const sigs = type.getCallSignatures();
      // 用 const 定義的函式
      if (sigs.length && !type.getProperties().length)
        return { ...c, kind: 'function', heads: sigs.map((sig) => `const ${name}${signatureText(sig, decl)}`) };
      // 小工具函式的分類（例如 spawn、create、math）：每個成員都是函式 → 逐一列出參數與說明
      const props = type.getProperties();
      const memberFns = props.map((p) => [p, checker.getTypeOfSymbolAtLocation(p, decl).getCallSignatures()]);
      if (props.length && memberFns.every(([, s]) => s.length)) {
        const members = [];
        for (const [p, s] of memberFns)
          for (const sig of s) members.push(member(p.name, `${p.name}${signatureText(sig, decl)}`, p));
        return { ...c, heads: [`const ${name}`], note: `分類：${name}.${props[0].name}(…) 這樣呼叫`, members };
      }
      // 物件常數：列出鍵（例如 Easing、ParticlePresets），比整個型別好讀
      const full = oneLine(checker.typeToString(type, decl, ts.TypeFormatFlags.NoTruncation));
      if (props.length && !/^ComponentType|^ResourceKey|^Readonly<Record|^Record</.test(full)) {
        let init = decl.initializer;
        while (
          init &&
          (ts.isAsExpression(init) || ts.isSatisfiesExpression(init) || ts.isParenthesizedExpression(init))
        )
          init = init.expression;
        const isObjLiteral =
          init &&
          (ts.isObjectLiteralExpression(init) ||
            (ts.isCallExpression(init) && init.expression.getText() === 'Object.freeze'));
        if (isObjLiteral || full.length > MAX_TYPE)
          return { ...c, heads: [`const ${name}: { ${clip(props.map((p) => p.name).join(', '), 240)} }`] };
      }
      return { ...c, heads: [`const ${name}: ${typeText(type, decl)}`] };
    }
    if (ts.isModuleDeclaration(decl)) return { ...item, heads: [`namespace ${name}`] };
    return item;
  }

  /** 匯出的符號（解開 export { A } from './x' 的別名） */
  function exportsOf(file) {
    const sf = program.getSourceFile(file);
    const mod = sf && checker.getSymbolAtLocation(sf);
    if (!mod) return [];
    return checker.getExportsOfModule(mod).map((exp) => {
      const target = exp.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exp) : exp;
      return { name: exp.name, symbol: target };
    });
  }

  const kindIndex = (k) => KINDS.findIndex(([x]) => x === k);
  let total = 0;
  const modules = files.map((file) => {
    const rel = relative(SRC, file).replace(/\\/g, '/');
    const isPkg = rel.startsWith('packages/');
    const id = isPkg ? rel.replace(/\.ts$/, '') : rel.split('/')[0];
    const title = isPkg ? '套件' : (MODULES.find(([m]) => m === id)?.[1] ?? '');
    const items = exportsOf(file)
      .filter((e) => !e.name.startsWith('_'))
      .map((e) => describe(e.name, e.symbol))
      .sort((a, b) => kindIndex(a.kind) - kindIndex(b.kind) || a.name.localeCompare(b.name));
    total += items.length;
    return { id, title, importPath: isPkg ? id : `@engine/${id}`, isPackage: isPkg, items };
  });
  attachGuides(modules);
  return { modules, total };
}

// ───────── 範例與解說（doc/manual/api-examples/<模組>.md） ─────────

/**
 * 讀取一個模組的範例檔：
 *
 *   ## 名稱
 *   解說（可以好幾行；`程式碼`）
 *
 *   ```ts                     ← 可以加 height=360（預覽畫面的高度）或 console（只看輸出，不顯示畫面）
 *   範例程式（不用寫 import：手冊會依用到的名稱自動補上）
 *   ```
 *
 * 一個名稱可以有好幾個 ```ts 區塊；解說寫在區塊前面。沒寫 height 也沒寫 console 時：
 * 有 engine.start() 的範例顯示畫面，其他只看輸出。
 * @returns 名稱 → [{ text, code, height, console }]
 */
export function parseGuides(text) {
  const out = new Map();
  const sections = text.split(/^## +/m).slice(1);
  for (const sec of sections) {
    const nl = sec.indexOf('\n');
    const name = sec.slice(0, nl < 0 ? undefined : nl).trim();
    const body = nl < 0 ? '' : sec.slice(nl + 1);
    const list = [];
    let pending = [];
    const re = /```(\w*)([^\n]*)\n([\s\S]*?)```/g;
    let last = 0;
    for (let m = re.exec(body); m; m = re.exec(body)) {
      pending.push(body.slice(last, m.index));
      last = m.index + m[0].length;
      const info = m[2];
      const code = m[3].replace(/\s+$/, '');
      const height = Number(/height=(\d+)/.exec(info)?.[1]) || 0;
      const consoleOnly = /\bconsole\b/.test(info) || (!height && !/engine\.start\(/.test(code));
      list.push({
        text: pending.join('\n').trim(),
        code,
        height: height || (consoleOnly ? 0 : 300),
        console: consoleOnly,
      });
      pending = [];
    }
    const rest = body.slice(last).trim();
    if (rest && list.length) list[list.length - 1].after = rest;
    if (list.length) out.set(name, list);
  }
  return out;
}

/** 範例檔：模組 id → 檔名（packages/perf-monitor → packages-perf-monitor.md） */
export const guideFileOf = (moduleId) => join(GUIDES, `${moduleId.replace(/\//g, '-')}.md`);

/**
 * 範例裡用到的名稱自動補上 import：範例所在模組的 API 優先，其次是 engine.ts（world、scenes…），
 * 再來是其他模組的 API（同名時用依模組順序第一個定義它的）；THREE → import * as THREE from 'three'。
 */
export function makeImporter(modules) {
  const engineSrc = existsSync(EXAMPLE_ENGINE) ? readFileSync(EXAMPLE_ENGINE, 'utf8') : '';
  const engineNames = new Set([...engineSrc.matchAll(/^export (?:const|let|function|class) (\w+)/gm)].map((m) => m[1]));
  const home = new Map();
  const homeIsOwn = new Set();
  for (const m of modules)
    for (const i of m.items) {
      if (m.isPackage) continue;
      const own = i.source?.file.startsWith(`src/${m.id}/`);
      if (!home.has(i.name) || (own && !homeIsOwn.has(i.name))) home.set(i.name, m.importPath);
      if (own) homeIsOwn.add(i.name);
    }
  const exportsOf = new Map(modules.map((m) => [m.importPath, new Set(m.items.map((i) => i.name))]));
  // 好幾個模組都有的分類（create、math、spawn…）：用總入口 '@engine' 合在一起的版本（各模組的只有一部分）
  const indexSrc = existsSync(join(ROOT, 'src/index.ts')) ? readFileSync(join(ROOT, 'src/index.ts'), 'utf8') : '';
  const merged = new Set(
    [...indexSrc.matchAll(/^export const (\w+) = \/\* @__PURE__ \*\/ \(\(\) =>\s*\(\{\s*\.\.\./gm)].map((m) => m[1]),
  );
  return (code, ownModule) => {
    // 去掉字串與註解再找名稱（避免把字串裡的字當成名稱）。一次掃描、依出現順序判斷：
    // 字串裡的 // （例如網址）不是註解，註解裡的引號也不是字串
    const bare = code
      .replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\/|`(?:\\.|[^`\\])*`|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"/g, (str) =>
        str[0] === '/'
          ? ' '
          : // 樣板字串保留 ${…} 裡的運算式（裡面用到的名稱也要匯入）
            str[0] === '`'
            ? ` ${[...str.matchAll(/\$\{([^}]*)\}/g)].map((m) => m[1]).join(' ; ')} `
            : '""',
      )
      .replace(/\.\.\./g, ' ');
    const declared = new Set(
      [
        ...bare.matchAll(
          /\b(?:const|let|var|class|function|type|interface)\s+(\w+)|\bimport\s+(?:\w+\s*,\s*)?\{([^}]*)\}|\bimport\s+(?:\*\s+as\s+)?(\w+)\s*(?:,|from\b)/g,
        ),
      ].flatMap((m) =>
        m[1]
          ? [m[1]]
          : m[3]
            ? [m[3]]
            : m[2].split(',').map((x) =>
                x
                  .trim()
                  .split(/\s+as\s+/)
                  .pop(),
              ),
      ),
    );
    const used = new Set([...bare.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)/g)].map((m) => m[1]));
    const fromEngine = [];
    const fromApi = new Map();
    let three = false;
    const add = (mod, id) => {
      if (!fromApi.has(mod)) fromApi.set(mod, []);
      fromApi.get(mod).push(id);
    };
    for (const id of used) {
      if (declared.has(id)) continue;
      if (id === 'THREE') three = true;
      else if (merged.has(id)) add('@engine', id);
      else if (ownModule && exportsOf.get(ownModule)?.has(id)) add(ownModule, id);
      else if (engineNames.has(id)) fromEngine.push(id);
      else if (home.get(id)) add(home.get(id), id);
    }
    const sorted = (a) => [...a].sort((x, y) => x.localeCompare(y));
    const lines = [
      three ? "import * as THREE from 'three';" : '',
      ...[...fromApi]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([mod, ids]) => `import { ${sorted(ids).join(', ')} } from '${mod}';`),
      fromEngine.length ? `import { ${sorted(fromEngine).join(', ')} } from './engine';` : '',
    ].filter(Boolean);
    return lines.length ? `${lines.join('\n')}\n\n${code}` : code;
  };
}

/** 把範例檔的範例附到每個 API（item.guides）；同一個東西從好幾個模組匯出時共用範例 */
function attachGuides(modules) {
  const importer = makeImporter(modules);
  const bySource = new Map();
  for (const m of modules) {
    const file = guideFileOf(m.id);
    const guides = existsSync(file) ? parseGuides(readFileSync(file, 'utf8')) : new Map();
    for (const i of m.items) {
      const list = guides.get(i.name) ?? [];
      i.guides = list.map((g) => ({ ...g, code: importer(g.code, m.isPackage ? null : m.importPath) }));
      const key = i.source ? `${i.source.file}:${i.source.line}` : null;
      if (key && i.guides.length && !bySource.has(key)) bySource.set(key, i.guides);
    }
  }
  for (const m of modules)
    for (const i of m.items) {
      const key = i.source ? `${i.source.file}:${i.source.line}` : null;
      if (!i.guides.length && key && bySource.has(key)) i.guides = bySource.get(key);
    }
}
