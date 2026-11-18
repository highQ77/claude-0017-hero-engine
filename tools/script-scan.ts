/**
 * 從遊戲的原始碼找出腳本類別與它們的參數（3D 場景編輯器「加入腳本」用）：
 *
 *   export class Coin extends Script {
 *     /** 撿到時加幾分 *\/
 *     value = 1;                 ← 參數：名稱 value、預設值 1、說明「撿到時加幾分」
 *     private collected = false; ← private、protected、readonly、static、_ 開頭的不算參數
 *   }
 *
 * 只看類別本身那一層的欄位，預設值是數字、文字、true／false 的才算參數（物件、陣列、算式不列出）。
 * 只是讀文字找出來，不會執行遊戲的程式。
 */

/** 腳本的一個參數 */
export interface ScriptPropInfo {
  name: string;
  /** 預設值 */
  default: number | string | boolean;
  type: 'number' | 'string' | 'boolean';
  /** 欄位上面的註解（說明） */
  doc?: string;
}

/** 找到的一個腳本 */
export interface ScriptInfo {
  /** 類別名稱（場景檔與 scripts.register 用的名稱） */
  name: string;
  /** 檔案（相對於專案） */
  file: string;
  /** 類別所在的行（1 開始） */
  line: number;
  /** 類別上面的註解 */
  doc?: string;
  props: ScriptPropInfo[];
}

/** 把 /** … *\/ 註解整理成一行文字 */
const cleanDoc = (raw: string) =>
  raw
    .replace(/^\/\*\*|\*\/$/g, '')
    .split('\n')
    .map((l) => l.replace(/^\s*\*\s?/, '').trim())
    .filter((l) => l && !l.startsWith('@'))
    .join(' ')
    .trim() || undefined;

/** 預設值：數字、'文字'、"文字"、true／false；其他回傳 undefined */
function literal(text: string): number | string | boolean | undefined {
  const t = text.trim();
  if (/^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(t)) return Number(t);
  if (t === 'true') return true;
  if (t === 'false') return false;
  const m = /^(['"])((?:\\.|(?!\1)[^\\])*)\1$/.exec(t);
  if (m) return m[2].replace(/\\(.)/g, '$1');
  return undefined;
}

const SKIP_MODIFIER = /^(?:private|protected|static|readonly|declare|abstract|override\s+readonly|#)/;

/** 從一個檔案的原始碼找出腳本 */
export function scanScripts(source: string, file: string): ScriptInfo[] {
  const out: ScriptInfo[] = [];
  const re =
    /(\/\*\*(?:(?!\*\/)[\s\S])*\*\/\s*)?(export\s+)?(abstract\s+)?class\s+([A-Za-z_$][\w$]*)\s+extends\s+Script\b[^{]*\{/g;
  for (let m = re.exec(source); m; m = re.exec(source)) {
    if (m[3]) continue; // 抽象類別不能直接掛
    const name = m[4];
    const bodyStart = m.index + m[0].length;
    // 找到類別的結尾（略過字串與註解裡的大括號）
    let depth = 1;
    let i = bodyStart;
    const lines: { text: string; depth: number }[] = [];
    let lineStart = i;
    let lineDepth = 1;
    while (i < source.length && depth > 0) {
      const c = source[i];
      if (c === '/' && source[i + 1] === '/') {
        while (i < source.length && source[i] !== '\n') i++;
        continue;
      }
      if (c === '/' && source[i + 1] === '*') {
        const end = source.indexOf('*/', i + 2);
        i = end === -1 ? source.length : end + 2;
        continue;
      }
      if (c === "'" || c === '"' || c === '`') {
        i++;
        while (i < source.length && source[i] !== c) i += source[i] === '\\' ? 2 : 1;
        i++;
        continue;
      }
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '\n') {
        lines.push({ text: source.slice(lineStart, i), depth: lineDepth });
        lineStart = i + 1;
        lineDepth = depth;
      }
      i++;
    }
    const body = lines;
    const props: ScriptPropInfo[] = [];
    let pendingDoc: string[] = [];
    let inDoc = false;
    for (const { text, depth: d } of body) {
      const t = text.trim();
      if (d !== 1) {
        pendingDoc = [];
        continue;
      }
      // 欄位上面的 /** 說明 */（可以跨好幾行）
      if (t.startsWith('/**') || inDoc) {
        pendingDoc.push(t);
        inDoc = !t.endsWith('*/');
        continue;
      }
      const field = /^(?:public\s+)?([A-Za-z][\w$]*)\s*(?::\s*[^=;]+?)?\s*=\s*(.+?);\s*(?:\/\/\s*(.*))?$/.exec(t);
      if (field && !SKIP_MODIFIER.test(t) && !/^(?:get|set|async)\s/.test(t)) {
        const value = literal(field[2]);
        if (value !== undefined)
          props.push({
            name: field[1],
            default: value,
            type: typeof value as ScriptPropInfo['type'],
            doc: (pendingDoc.length ? cleanDoc(pendingDoc.join('\n')) : undefined) ?? field[3]?.trim() ?? undefined,
          });
      }
      pendingDoc = [];
    }
    out.push({
      name,
      file,
      line: source.slice(0, m.index + (m[1]?.length ?? 0)).split('\n').length,
      doc: m[1] ? cleanDoc(m[1].trim()) : undefined,
      props,
    });
  }
  return out;
}
