/**
 * XML 語法高亮：把原始碼轉成帶顏色標記的 HTML（給編輯器原始碼面板使用）。
 * 只做掃描、不做驗證：打到一半、不完整的 XML 也能正常著色。
 *
 * 產生的 class：
 * - hl-c 註解　hl-p 標點（< > / =）　hl-t 標籤名稱　hl-tu 標籤名稱（UI 元件）
 * - hl-a 屬性名稱　hl-bp 斷點前綴（md: 等）　hl-ev 事件屬性（onClick 等）
 * - hl-s 屬性值　hl-b 資料綁定 {name}　hl-e 實體 &amp;　hl-x 文字內容
 * - hl-d 宣告 <?xml ?>、<!DOCTYPE>
 */

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const span = (cls: string, s: string) => (s ? `<span class="${cls}">${escape(s)}</span>` : '');

/** 文字或屬性值裡的 {綁定} 與 &實體; 另外著色 */
function inner(cls: string, s: string): string {
  let out = '';
  const re = /\{[^{}\n]*\}|&(?:#\d+|#x[0-9a-f]+|[a-z]+);/gi;
  let last = 0;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    out += span(cls, s.slice(last, m.index));
    out += span(m[0][0] === '{' ? 'hl-b' : 'hl-e', m[0]);
    last = m.index + m[0].length;
  }
  return out + span(cls, s.slice(last));
}

function attrName(name: string): string {
  const colon = name.lastIndexOf(':');
  const prefix = colon >= 0 ? name.slice(0, colon + 1) : '';
  const base = name.slice(prefix.length);
  const cls = /^on[A-Z]/.test(base) ? 'hl-ev' : 'hl-a';
  return span('hl-bp', prefix) + span(cls, base);
}

export function highlightXml(src: string): string {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    if (src.startsWith('<!--', i)) {
      const end = src.indexOf('-->', i + 4);
      const stop = end < 0 ? n : end + 3;
      out += span('hl-c', src.slice(i, stop));
      i = stop;
      continue;
    }
    if (src.startsWith('<?', i) || src.startsWith('<!', i)) {
      const end = src.indexOf('>', i);
      const stop = end < 0 ? n : end + 1;
      out += span('hl-d', src.slice(i, stop));
      i = stop;
      continue;
    }
    if (src[i] === '<') {
      // 標籤：<  /  名稱  屬性…  /  >
      let j = i + 1;
      out += span('hl-p', src[j] === '/' ? '</' : '<');
      if (src[j] === '/') j++;
      const name = /^[\w:.-]*/.exec(src.slice(j))![0];
      out += span(/^UI/.test(name) ? 'hl-tu' : 'hl-t', name);
      j += name.length;
      while (j < n && src[j] !== '>' && src[j] !== '<') {
        const c = src[j];
        if (/\s/.test(c)) {
          const ws = /^\s+/.exec(src.slice(j))![0];
          out += ws;
          j += ws.length;
        } else if (c === '"' || c === "'") {
          const end = src.indexOf(c, j + 1);
          // 沒有結尾引號：著色到行尾
          const lineEnd = src.indexOf('\n', j);
          const stop = end < 0 ? (lineEnd < 0 ? n : lineEnd) : end + 1;
          out += inner('hl-s', src.slice(j, stop));
          j = stop;
        } else if (c === '=' || c === '/') {
          out += span('hl-p', c);
          j++;
        } else {
          const attr = /^[^\s=/>"'<]+/.exec(src.slice(j))![0];
          out += attrName(attr);
          j += attr.length;
        }
      }
      if (src[j] === '>') {
        out += span('hl-p', '>');
        j++;
      }
      i = j;
      continue;
    }
    const next = src.indexOf('<', i);
    const stop = next < 0 ? n : next;
    out += inner('hl-x', src.slice(i, stop));
    i = stop;
  }
  return out;
}
