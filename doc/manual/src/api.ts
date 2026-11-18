/**
 * 「API 參考」：資料來自分析引擎原始碼的結果（tools/api-model.mjs，虛擬模組 virtual:engine-api），
 * 每個模組一章；內容和程式碼永遠一致，不用手寫。
 *
 * - generateApiIndex()：總覽（每個模組、項目數、有範例的比例）
 * - apiChapters()：每個模組一章（開頭總表 → 依種類分節 → 每個 API 的簽名、說明、參數、範例、成員、原始碼位置）
 * - linkApiNames()：一般章節內文裡的 <code>名稱</code> 自動連到 API 參考
 * - searchApi()：搜尋 API 名稱
 */
import { highlightTs } from './highlight';

/** 一個 API 的成員（類別的方法、屬性；介面的欄位；分類裡的函式） */
export interface ApiMember {
  name: string;
  text: string;
  doc: string;
  examples: string[];
}

/** 一個匯出的 API */
export interface ApiItem {
  name: string;
  kind: 'class' | 'function' | 'const' | 'enum' | 'interface' | 'type' | 'other';
  /** 簽名（多載時有好幾行） */
  heads: string[];
  /** 補充（例如分類的呼叫方式） */
  note: string;
  /** 說明的第一行 */
  summary: string;
  /** 完整的說明 */
  doc: string;
  params: { name: string; doc: string }[];
  returns: string;
  examples: string[];
  deprecated: string;
  source: { file: string; line: number } | null;
  members: ApiMember[];
  /** 範例與解說（doc/manual/api-examples/<模組>.md；可以執行、編輯，import 已經自動補上） */
  guides: ApiGuide[];
}

/** 一個範例與它的解說 */
export interface ApiGuide {
  /** 範例前面的解說 */
  text: string;
  /** 範例程式（含自動補上的 import） */
  code: string;
  /** 範例後面的補充 */
  after?: string;
  /** 預覽畫面的高度（只看輸出時是 0） */
  height: number;
  /** 只看輸出，不顯示畫面 */
  console: boolean;
}

/** 一個模組 */
export interface ApiModule {
  id: string;
  title: string;
  importPath: string;
  isPackage: boolean;
  items: ApiItem[];
}

export interface ApiData {
  modules: ApiModule[];
  total: number;
}

const KINDS: [ApiItem['kind'], string][] = [
  ['class', '類別'],
  ['function', '函式'],
  ['const', '常數'],
  ['enum', '列舉'],
  ['interface', '介面（型別）'],
  ['type', '型別別名'],
  ['other', '其他'],
];
const kindLabel = (k: ApiItem['kind']) => KINDS.find(([x]) => x === k)?.[1] ?? k;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 模組的章節 id（網址用）：api-scene、api-packages-perf-monitor */
export const chapterIdOf = (m: ApiModule) => `api-${m.id.replace(/\//g, '-')}`;

/** 說明文字 → HTML：空行分段；縮排的行是程式碼；`x` 是行內程式碼 */
function docHtml(text: string): string {
  if (!text) return '';
  const inline = (s: string) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>');
  const blocks: string[] = [];
  let para: string[] = [];
  let code: string[] = [];
  const flush = () => {
    if (para.length) blocks.push(`<p>${inline(para.join(' '))}</p>`);
    if (code.length) blocks.push(`<pre class="api-docpre"><code>${highlightTs(dedent(code.join('\n')))}</code></pre>`);
    para = [];
    code = [];
  };
  for (const line of text.split('\n')) {
    if (!line.trim()) {
      flush();
      continue;
    }
    // 縮排兩格以上的行：程式碼或示意
    if (/^ {2,}\S/.test(line)) {
      if (para.length) {
        blocks.push(`<p>${inline(para.join(' '))}</p>`);
        para = [];
      }
      code.push(line);
    } else if (/^\s*[-•·]\s/.test(line)) {
      // 項目符號：自成一段
      if (code.length || para.length) flush();
      blocks.push(`<p class="api-bullet">${inline(line.trim())}</p>`);
    } else {
      if (code.length) flush();
      para.push(line.trim());
    }
  }
  flush();
  return blocks.join('');
}

function dedent(text: string): string {
  const lines = text.split('\n');
  const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => /^ */.exec(l)![0].length));
  return lines.map((l) => l.slice(Number.isFinite(indent) ? indent : 0)).join('\n');
}

/** 範例方塊（手冊的範例元件：可以看、複製、編輯；API 的範例是程式片段，不執行） */
const exampleHtml = (code: string, title: string) =>
  `<script type="text/plain" class="example" data-lang="${isXml(code) ? 'xml' : 'ts'}" data-run="false" data-title="${esc(title)}">${code.replace(/<\/script/gi, '<\\/script')}\n</script>`;

/** 可以執行的範例方塊（只看輸出的範例不顯示畫面，執行後只留下輸出） */
const runnableHtml = (g: ApiGuide, title: string) =>
  `<script type="text/plain" class="example" data-lang="ts" data-title="${esc(title)}"${g.console ? ' data-console' : ` data-height="${g.height}"`}>${g.code.replace(/<\/script/gi, '<\\/script')}\n</script>`;

/** 範例是 XML（2D 介面元件的寫法）還是 TypeScript */
export const isXml = (code: string) => code.trimStart().startsWith('<');

/** 簽名：程式碼上色 */
const sigHtml = (lines: string[]) => `<pre class="api-sig"><code>${highlightTs(lines.join('\n'))}</code></pre>`;

function itemHtml(chapter: string, item: ApiItem): string {
  const parts: string[] = [];
  const src = item.source
    ? `<span class="api-src" title="原始碼的位置">${esc(item.source.file)}:${item.source.line}</span>`
    : '';
  parts.push(
    `<h3 id="${esc(item.name)}"><a class="anchor" href="#/${chapter}/${encodeURIComponent(item.name)}" aria-label="連結到 ${esc(item.name)}">#</a>` +
      `<code>${esc(item.name)}</code><span class="api-kind api-kind-${item.kind}">${kindLabel(item.kind)}</span>` +
      `${item.deprecated ? '<span class="api-deprecated">不建議使用</span>' : ''}${src}</h3>`,
  );
  parts.push(sigHtml(item.heads));
  if (item.note) parts.push(`<p class="api-note">${esc(item.note)}</p>`);
  if (item.deprecated) parts.push(`<p class="api-warn">不建議使用：${esc(item.deprecated)}</p>`);
  parts.push(docHtml(item.doc));
  if (item.params.length || item.returns) {
    const rows = item.params.map(
      (p) => `<tr><td><code>${esc(p.name)}</code></td><td>${docHtml(p.doc) || ''}</td></tr>`,
    );
    if (item.returns) rows.push(`<tr><td class="api-ret">回傳</td><td>${docHtml(item.returns)}</td></tr>`);
    parts.push(`<table class="api-params"><tbody>${rows.join('')}</tbody></table>`);
  }
  // 範例與解說：可以執行、編輯
  item.guides.forEach((g, i) => {
    parts.push(`<div class="api-guide">${docHtml(g.text)}</div>`);
    parts.push(runnableHtml(g, item.guides.length > 1 ? `${item.name} 範例 ${i + 1}` : `${item.name} 範例`));
    if (g.after) parts.push(`<div class="api-guide">${docHtml(g.after)}</div>`);
  });
  // 原始碼註解裡的 @example：寫法的片段（不執行）
  if (item.examples.length)
    parts.push(
      `<details class="api-snippets"><summary>原始碼註解裡的寫法（${item.examples.length}）</summary>${item.examples
        .map((ex, i) => exampleHtml(ex, item.examples.length > 1 ? `${item.name} 片段 ${i + 1}` : `${item.name} 片段`))
        .join('')}</details>`,
    );
  if (item.members.length) {
    const label = item.kind === 'const' ? '函式' : item.kind === 'class' ? '成員' : '欄位';
    const list = item.members
      .map((m) => {
        const id = m.name === 'constructor' ? `${item.name}.constructor` : `${item.name}.${m.name}`;
        const exs = m.examples.map((ex) => exampleHtml(ex, `${item.name}.${m.name} 範例`)).join('');
        return `<li id="${esc(id)}"><pre class="api-msig"><code>${highlightTs(m.text)}</code></pre>${m.doc ? `<div class="api-mdoc">${docHtml(m.doc)}</div>` : ''}${exs}</li>`;
      })
      .join('');
    // 成員不多時直接展開；很多時預設收合（頁面才不會太長）
    parts.push(
      `<details class="api-members"${item.members.length <= 8 ? ' open' : ''}><summary>${label}（${item.members.length}）</summary><ul>${list}</ul></details>`,
    );
  }
  return `<section class="api-item">${parts.join('')}</section>`;
}

/** 一個模組的章節 HTML */
function moduleHtml(mod: ApiModule): string {
  const chapter = chapterIdOf(mod);
  const out: string[] = [`<!-- group: ${mod.isPackage ? '套件' : '模組'} -->`];
  out.push(`<h1>${esc(mod.importPath)}</h1>`);
  out.push(
    `<p class="lead">${esc(mod.title)}。${
      mod.isPackage
        ? '這是套件：用 PluginManager 安裝（見〈套件管理〉）。'
        : `遊戲裡用 <code>import { 名稱 } from '${esc(mod.importPath)}'</code> 引用。`
    }共 ${mod.items.length} 項。</p>`,
  );
  // 總表
  const rows = mod.items
    .map(
      (i) =>
        `<tr><td><a href="#/${chapter}/${encodeURIComponent(i.name)}"><code>${esc(i.name)}</code></a></td><td class="api-kind-cell">${kindLabel(i.kind)}</td><td>${esc(i.summary)}${i.examples.length ? ' <span class="api-has-ex" title="有範例">範例</span>' : ''}</td></tr>`,
    )
    .join('');
  out.push(
    `<table class="api-index"><thead><tr><th>名稱</th><th>種類</th><th>說明</th></tr></thead><tbody>${rows}</tbody></table>`,
  );
  for (const [kind, label] of KINDS) {
    const items = mod.items.filter((i) => i.kind === kind);
    if (!items.length) continue;
    out.push(`<h2>${label}</h2>`);
    for (const item of items) out.push(itemHtml(chapter, item));
  }
  return out.join('\n');
}

/** 每個模組一章：{ id, html }（交給手冊和一般章節一樣處理） */
export function apiChapters(data: ApiData): { id: string; html: string }[] {
  return data.modules.map((m) => ({ id: chapterIdOf(m), html: moduleHtml(m) }));
}

/** 有沒有範例的統計：函式與類別（介面、型別通常不需要範例） */
export function exampleStats(data: ApiData): { withExamples: number; total: number } {
  let withExamples = 0;
  let total = 0;
  for (const m of data.modules)
    for (const i of m.items) {
      if (i.kind !== 'class' && i.kind !== 'function') continue;
      total++;
      if (i.examples.length || i.members.some((x) => x.examples.length)) withExamples++;
    }
  return { withExamples, total };
}

/** 總覽：每個模組一列 */
export function generateApiIndex(data: ApiData): string {
  const rows = data.modules
    .map((m) => {
      const ex = m.items.filter((i) => i.examples.length).length;
      return `<tr><td><a href="#/${chapterIdOf(m)}"><code>${esc(m.importPath)}</code></a></td><td>${esc(m.title)}</td><td class="num">${m.items.length}</td><td class="num">${ex}</td></tr>`;
    })
    .join('');
  const s = exampleStats(data);
  return (
    `<table class="api-index api-modules"><thead><tr><th>模組</th><th>內容</th><th class="num">項目</th><th class="num">有範例</th></tr></thead><tbody>${rows}</tbody>` +
    `<tfoot><tr><td>合計</td><td></td><td class="num">${data.total}</td><td class="num"></td></tr></tfoot></table>` +
    `<p class="api-note">函式與類別有範例的：${s.withExamples}／${s.total}。範例取自原始碼註解的 <code>@example</code>，會持續補上。</p>`
  );
}

// ───────── 內文自動連結 ─────────

interface Target {
  chapter: string;
  item: ApiItem;
  mod: ApiModule;
}

let index: Map<string, Target[]> | null = null;
function nameIndex(data: ApiData): Map<string, Target[]> {
  if (index) return index;
  index = new Map();
  for (const mod of data.modules)
    for (const item of mod.items) {
      const list = index.get(item.name) ?? [];
      list.push({ chapter: chapterIdOf(mod), item, mod });
      index.set(item.name, list);
    }
  return index;
}

/** 名稱（可以是「名稱.成員」，結尾可以有 () 或 (…)）→ API 參考的網址；找不到或不確定時是 null */
export function apiLinkOf(data: ApiData, text: string): string | null {
  const m = /^([A-Za-z_$][\w$]*)(?:\.([A-Za-z_$][\w$]*))?(?:\(\)|\(…\))?$/.exec(text.trim());
  if (!m) return null;
  const [, name, memberName] = m;
  let targets = nameIndex(data).get(name) ?? [];
  if (memberName) targets = targets.filter((t) => t.item.members.some((x) => x.name === memberName));
  if (!targets.length) return null;
  // 同一個名稱從好幾個模組匯出：優先用定義它的模組（原始碼在 src/<模組>/ 裡）
  const home = targets.filter((t) => t.item.source?.file.startsWith(`src/${t.mod.id}/`));
  const pick = home[0] ?? targets[0];
  // 不同的東西用同一個名稱（不是同一個原始碼位置）：不確定，不連結
  const where = (t: Target) => `${t.item.source?.file}:${t.item.source?.line}`;
  if (!home.length && targets.some((t) => where(t) !== where(pick))) return null;
  const anchor = memberName ? `${name}.${memberName}` : name;
  return `#/${pick.chapter}/${encodeURIComponent(anchor)}`;
}

/**
 * 一般章節的內文：<code>名稱</code>、<code>名稱.成員</code>、<code>名稱()</code> 連到 API 參考。
 * 範例程式、程式碼區塊、標題、已經是連結的不處理。
 */
export function linkApiNames(root: HTMLElement, data: ApiData): void {
  for (const code of root.querySelectorAll('code')) {
    if (code.closest('pre, a, .example, h1, h2, h3, .ex')) continue;
    const href = apiLinkOf(data, code.textContent ?? '');
    if (!href) continue;
    const a = document.createElement('a');
    a.href = href;
    a.className = 'api-link';
    a.title = '看 API 參考';
    code.replaceWith(a);
    a.append(code);
  }
}

// ───────── 搜尋 ─────────

/** 搜尋 API 名稱：完全相同 → 開頭相同 → 包含（最多 limit 筆） */
export function searchApi(
  data: ApiData,
  query: string,
  limit = 8,
): { href: string; name: string; module: string; summary: string }[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const hits: { score: number; href: string; name: string; module: string; summary: string }[] = [];
  for (const mod of data.modules)
    for (const item of mod.items) {
      const n = item.name.toLowerCase();
      const score = n === q ? 0 : n.startsWith(q) ? 1 : n.includes(q) ? 2 : -1;
      if (score < 0) continue;
      hits.push({
        score,
        href: `#/${chapterIdOf(mod)}/${encodeURIComponent(item.name)}`,
        name: item.name,
        module: mod.importPath,
        summary: item.summary,
      });
    }
  return hits.sort((a, b) => a.score - b.score || a.name.length - b.name.length).slice(0, limit);
}
