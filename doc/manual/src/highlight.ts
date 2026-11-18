/**
 * 語法高亮：把原始碼轉成帶顏色標記的 HTML。
 * XML 沿用 UI 編輯器的 highlightXml（class 為 hl-*），這裡補上 TypeScript／JavaScript 與終端機指令。
 * 只做掃描、不做驗證：打到一半的程式也能正常著色。
 *
 * TypeScript 產生的 class：
 * hl-c 註解　hl-k 關鍵字　hl-s 字串　hl-n 數字　hl-f 函式呼叫　hl-ty 類別／型別（大寫開頭）
 * hl-pr 屬性（.後面的名稱）　hl-o 運算子與標點　hl-lit true／false／null／this　hl-r 正規表示式
 */
import { highlightXml } from '@engine/editors/ui-editor/highlight';

export type Lang = 'ts' | 'xml' | 'sh' | 'text';

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const span = (cls: string, s: string) => (s ? `<span class="${cls}">${escape(s)}</span>` : '');

const KEYWORDS = new Set([
  'abstract',
  'as',
  'async',
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'declare',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'export',
  'extends',
  'finally',
  'for',
  'from',
  'function',
  'get',
  'if',
  'implements',
  'import',
  'in',
  'instanceof',
  'interface',
  'keyof',
  'let',
  'new',
  'of',
  'private',
  'protected',
  'public',
  'readonly',
  'return',
  'satisfies',
  'set',
  'static',
  'super',
  'switch',
  'throw',
  'try',
  'type',
  'typeof',
  'var',
  'void',
  'while',
  'yield',
]);
const LITERALS = new Set(['true', 'false', 'null', 'undefined', 'this', 'NaN', 'Infinity']);
const BUILTIN_TYPES = new Set(['string', 'number', 'boolean', 'unknown', 'any', 'never', 'object', 'symbol', 'bigint']);

/** 前一個有意義的字元能不能接正規表示式（/ 是除號還是正規表示式的開頭） */
function regexAllowed(prev: string): boolean {
  return (
    prev === '' ||
    /[(,=:[!&|?{};+\-*%<>~^]$/.test(prev) ||
    /\b(return|typeof|case|do|else|in|of|yield|await)$/.test(prev)
  );
}

export function highlightTs(src: string): string {
  let out = '';
  let i = 0;
  const n = src.length;
  /** 上一個非空白的內容（判斷 / 的意思） */
  let prev = '';
  /** 上一個符號是 .（後面是屬性） */
  let afterDot = false;

  while (i < n) {
    const c = src[i];
    const rest = src.slice(i);
    // 空白
    if (/\s/.test(c)) {
      const ws = /^\s+/.exec(rest)![0];
      out += ws;
      i += ws.length;
      continue;
    }
    // 註解
    if (rest.startsWith('//')) {
      const end = src.indexOf('\n', i);
      const stop = end < 0 ? n : end;
      out += span('hl-c', src.slice(i, stop));
      i = stop;
      continue;
    }
    if (rest.startsWith('/*')) {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? n : end + 2;
      out += span('hl-c', src.slice(i, stop));
      i = stop;
      continue;
    }
    // 字串
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      const stop = Math.min(n, j + 1);
      out += span('hl-s', src.slice(i, stop));
      i = stop;
      prev = 'x';
      afterDot = false;
      continue;
    }
    // 樣板字串：${...} 裡面再遞迴著色
    if (c === '`') {
      let j = i + 1;
      let seg = '`';
      while (j < n && src[j] !== '`') {
        if (src[j] === '\\') {
          seg += src.slice(j, j + 2);
          j += 2;
        } else if (src.startsWith('${', j)) {
          out += span('hl-s', seg);
          seg = '';
          let depth = 1;
          let k = j + 2;
          while (k < n && depth > 0) {
            if (src[k] === '{') depth++;
            else if (src[k] === '}') depth--;
            if (depth > 0) k++;
          }
          out += span('hl-o', '${') + highlightTs(src.slice(j + 2, k)) + span('hl-o', k < n ? '}' : '');
          j = Math.min(n, k + 1);
        } else {
          seg += src[j++];
        }
      }
      if (j < n) {
        seg += '`';
        j++;
      }
      out += span('hl-s', seg);
      i = j;
      prev = 'x';
      afterDot = false;
      continue;
    }
    // 正規表示式
    if (c === '/' && regexAllowed(prev)) {
      const m = /^\/(?:\\.|\[(?:\\.|[^\]\n])*\]|[^/\\\n[])+\/[a-z]*/.exec(rest);
      if (m) {
        out += span('hl-r', m[0]);
        i += m[0].length;
        prev = 'x';
        continue;
      }
    }
    // 數字
    const num = /^(?:0[xX][\da-fA-F_]+|0[bB][01_]+|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d+)?n?)/.exec(rest);
    if (num && /[\d.]/.test(c) && !(c === '.' && !/\d/.test(src[i + 1] ?? ''))) {
      out += span('hl-n', num[0]);
      i += num[0].length;
      prev = 'x';
      afterDot = false;
      continue;
    }
    // 名稱
    const word = /^[A-Za-z_$À-￿][\w$À-￿]*/.exec(rest);
    if (word) {
      const w = word[0];
      const after = src.slice(i + w.length);
      let cls: string;
      if (afterDot) cls = /^\s*\(/.test(after) ? 'hl-f' : 'hl-pr';
      else if (KEYWORDS.has(w)) cls = 'hl-k';
      else if (LITERALS.has(w)) cls = 'hl-lit';
      else if (BUILTIN_TYPES.has(w)) cls = 'hl-ty';
      else if (/^[A-Z]/.test(w)) cls = 'hl-ty';
      else if (/^\s*(<[^<>()]*>)?\s*\(/.test(after)) cls = 'hl-f';
      else cls = 'hl-id';
      out += span(cls, w);
      i += w.length;
      prev = w;
      afterDot = false;
      continue;
    }
    // 標點與運算子
    const op = /^(?:\?\.|\.\.\.|=>|[=!]==?|[<>]=?|&&|\|\||\?\?|[-+*/%&|^~!?:;,.()[\]{}<>=@#])/.exec(rest);
    const tok = op ? op[0] : c;
    out += span('hl-o', tok);
    afterDot = tok === '.' || tok === '?.';
    prev = tok;
    i += tok.length;
  }
  return out;
}

/** 終端機指令：# 註解、指令名稱、參數 */
export function highlightShell(src: string): string {
  return src
    .split('\n')
    .map((line) => {
      const hash = line.search(/(^|\s)#/);
      const code = hash < 0 ? line : line.slice(0, hash);
      const comment = hash < 0 ? '' : line.slice(hash);
      const m = /^(\s*)(\$\s+)?(\S+)(.*)$/.exec(code);
      let body = escape(code);
      if (m) {
        const args = m[4].replace(/(\s)(--?[\w-]+)/g, '$1\u0000$2\u0001');
        body =
          escape(m[1]) +
          span('hl-o', m[2] ?? '') +
          span('hl-f', m[3]) +
          escape(args).replace(/\u0000([^\u0001]*)\u0001/g, '<span class="hl-k">$1</span>');
      }
      return body + span('hl-c', comment);
    })
    .join('\n');
}

export function highlight(src: string, lang: Lang): string {
  switch (lang) {
    case 'ts':
      return highlightTs(src);
    case 'xml':
      return highlightXml(src);
    case 'sh':
      return highlightShell(src);
    default:
      return escape(src);
  }
}
