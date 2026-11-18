/**
 * 寬鬆的 XML 解析器（介面檔與場景檔共用）：
 * - 支援 <Tag attr="v"/> 自我關閉，以及 <!-- 註解 -->
 * - 沒有內容的元件（例如 UIImage）可以不寫結尾，<UIImage src="a.png"> 也可以
 * - 屬性值可以用雙引號或單引號；屬性名稱可以含冒號（例如 sm:dir="v"）
 * - 錯誤訊息會附上行號與欄位
 */

export interface XmlNode {
  /** 標籤名稱 */
  tag: string;
  /** 屬性 */
  attrs: Record<string, string>;
  /** 子節點 */
  children: XmlNode[];
  /** 元素內的文字（已去除前後空白，多段文字以空白相連） */
  text: string;
  /** 在原始碼中的行號（從 1 開始） */
  line: number;
  /** keepComments 時：根元素前後的註解 */
  prolog?: XmlNode[];
  /** 根節點後面的註解等內容（存檔時保留） */
  epilogue?: XmlNode[];
}

/** 註解節點的 tag（keepComments 時才會出現） */
export const COMMENT_TAG = '#comment';

/** XML 格式錯誤（含行號、欄號） */
export class XmlError extends Error {
  constructor(
    message: string,
    /** 錯誤的行號 */
    readonly line: number,
    /** 錯誤的欄號 */
    readonly column: number,
  ) {
    super(`第 ${line} 行第 ${column} 欄：${message}`);
    this.name = 'XmlError';
  }
}

/** 解析 XML 的設定 */
export interface ParseOptions {
  /** 不需要結尾標籤的元素（遇到下一個標籤時自動結束） */
  voidTags?: readonly string[];
  /** 保留註解（編輯器用，存成 tag 為 #comment 的節點） */
  keepComments?: boolean;
}

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'", nbsp: ' ' };

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e] ?? m;
  });
}

export function parseXml(source: string, options: ParseOptions = {}): XmlNode {
  const voidTags = new Set(options.voidTags ?? []);
  let i = 0;
  const position = (index: number) => {
    const before = source.slice(0, index);
    const line = before.split('\n').length;
    const column = index - before.lastIndexOf('\n');
    return { line, column };
  };
  const fail = (message: string, at = i): never => {
    const p = position(at);
    throw new XmlError(message, p.line, p.column);
  };

  const root: XmlNode = { tag: '#root', attrs: {}, children: [], text: '', line: 1 };
  const stack: XmlNode[] = [root];
  const texts: string[][] = [[]];
  const top = () => stack[stack.length - 1];

  const closeTop = () => {
    const node = stack.pop()!;
    node.text = texts.pop()!.join(' ').replace(/\s+/g, ' ').trim();
  };

  while (i < source.length) {
    const lt = source.indexOf('<', i);
    const textEnd = lt === -1 ? source.length : lt;
    if (textEnd > i) {
      const text = decode(source.slice(i, textEnd)).trim();
      if (text) texts[texts.length - 1].push(text);
    }
    if (lt === -1) break;
    i = lt;

    if (source.startsWith('<!--', i)) {
      const end = source.indexOf('-->', i + 4);
      if (end === -1) fail('註解沒有結尾（缺少 -->）');
      if (options.keepComments) {
        // void 元素後面的註解屬於外層
        while (top() !== root && voidTags.has(top().tag)) closeTop();
        top().children.push({
          tag: COMMENT_TAG,
          attrs: {},
          children: [],
          text: source.slice(i + 4, end),
          line: position(i).line,
        });
      }
      i = end + 3;
      continue;
    }
    if (source.startsWith('<?', i)) {
      const end = source.indexOf('?>', i);
      if (end === -1) fail('<? 沒有結尾');
      i = end + 2;
      continue;
    }
    if (source.startsWith('<![CDATA[', i)) {
      const end = source.indexOf(']]>', i);
      if (end === -1) fail('CDATA 沒有結尾');
      texts[texts.length - 1].push(source.slice(i + 9, end));
      i = end + 3;
      continue;
    }

    // 結尾標籤
    if (source[i + 1] === '/') {
      const m = /^<\/\s*([\w:.-]+)\s*>/.exec(source.slice(i));
      if (!m) fail('結尾標籤格式錯誤');
      const tag = m![1];
      // 先結束未關閉的 void 元素
      while (top() !== root && top().tag !== tag && voidTags.has(top().tag)) closeTop();
      if (top() === root || top().tag !== tag) {
        const open = top() === root ? '（沒有對應的開頭）' : `，但目前開著的是 <${top().tag}>（第 ${top().line} 行）`;
        fail(`多出結尾標籤 </${tag}>${open}`);
      }
      closeTop();
      i += m![0].length;
      continue;
    }

    // 開頭標籤
    const start = i;
    const nameMatch = /^<\s*([\w:.-]+)/.exec(source.slice(i));
    if (!nameMatch) fail('標籤格式錯誤（< 後面應該接標籤名稱）');
    const tag = nameMatch![1];
    i += nameMatch![0].length;
    const attrs: Record<string, string> = {};
    let selfClosing = false;
    for (;;) {
      while (i < source.length && /\s/.test(source[i])) i++;
      if (i >= source.length) fail(`<${tag}> 沒有結束的 >`, start);
      if (source.startsWith('/>', i)) {
        selfClosing = true;
        i += 2;
        break;
      }
      if (source[i] === '>') {
        i++;
        break;
      }
      const am = /^([\w:.@-]+)\s*(=\s*("([^"]*)"|'([^']*)'|([^\s"'>/]+)))?/.exec(source.slice(i));
      if (!am) fail(`<${tag}> 的屬性格式錯誤`);
      const name = am![1];
      if (name in attrs) fail(`<${tag}> 有重複的屬性「${name}」`);
      attrs[name] = am![2] === undefined ? 'true' : decode(am![4] ?? am![5] ?? am![6] ?? '');
      i += am![0].length;
    }

    // 新開頭時，先結束前面未關閉的 void 元素
    while (top() !== root && voidTags.has(top().tag)) closeTop();
    const node: XmlNode = { tag, attrs, children: [], text: '', line: position(start).line };
    top().children.push(node);
    if (!selfClosing) {
      stack.push(node);
      texts.push([]);
    }
  }

  while (top() !== root && voidTags.has(top().tag)) closeTop();
  if (top() !== root) fail(`<${top().tag}>（第 ${top().line} 行）沒有結尾標籤`, source.length);
  const elements = root.children.filter((c) => c.tag !== COMMENT_TAG);
  if (elements.length === 0) fail('找不到任何元素', 0);
  if (elements.length > 1) {
    const p = elements[1].line;
    throw new XmlError('最外層只能有一個元素（可以用 <UI> 或 <UILayout> 包起來）', p, 1);
  }
  const result = elements[0];
  if (options.keepComments) {
    const at = root.children.indexOf(result);
    result.prolog = root.children.slice(0, at);
    result.epilogue = root.children.slice(at + 1);
  }
  return result;
}
