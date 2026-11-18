/**
 * 使用手冊的頁面：側邊目錄、章節切換（網址 #/章節/小節）、搜尋、上一章／下一章。
 *
 * 章節放在 chapters/*.html，依檔名排序（01-、02-…）。檔案第一行可以寫分組：<!-- group: 入門 -->
 * 章節的標題取自 <h1>，小節取自 <h2>（自動產生 id，可以直接連結）。
 * 範例寫法見 example.ts；<div data-generate="ui-reference"></div> 會換成自動產生的元件參考（reference.ts）。
 * 「API 參考」：每個模組一章，從引擎原始碼自動產生（api.ts）；放在 chapters/90-api.html（總覽）後面。
 * 一般章節內文裡的 <code>API 名稱</code> 會自動連到 API 參考；搜尋也找得到 API 名稱。
 */
import apiData from 'virtual:engine-api';
import { apiChapters, generateApiIndex, linkApiNames, searchApi } from './api';
import { mountExamples, stopRunning, type Example } from './example';
import { generateUIReference } from './reference';
import './style.css';

/** 手冊的兩個分頁：說明文件、API 參考 */
type Tab = 'guide' | 'api';

interface Chapter {
  id: string;
  tab: Tab;
  title: string;
  group: string;
  html: string;
  /** 搜尋用的純文字 */
  text: string;
  sections: { id: string; title: string }[];
}

const files = import.meta.glob('../chapters/*.html', { query: '?raw', import: 'default', eager: true }) as Record<
  string,
  string
>;

const GENERATORS: Record<string, () => string> = {
  'ui-reference': generateUIReference,
  'api-index': () => generateApiIndex(apiData),
};

/** 小節標題 → 網址用的 id（保留中文） */
function slug(text: string): string {
  return (
    text
      .trim()
      .toLowerCase()
      .replace(/[\s/／、，。：:（）()「」『』.?？!！,]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'section'
  );
}

function plainText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
}

/** 章節的 HTML → 章節（標題、分組、小節的 id 與連結、搜尋用的文字） */
function makeChapter(id: string, source: string): Chapter {
  let html = source.replace(/<div data-generate="([\w-]+)"><\/div>/g, (m, name: string) => GENERATORS[name]?.() ?? m);
  const group = /^\s*<!--\s*group:\s*(.+?)\s*-->/.exec(html)?.[1] ?? '';
  const title =
    /<h1[^>]*>([\s\S]*?)<\/h1>/
      .exec(html)?.[1]
      .replace(/<[^>]+>/g, '')
      .trim() ?? id;
  const used = new Set<string>();
  const sections: Chapter['sections'] = [];
  html = html.replace(/<h2([^>]*)>([\s\S]*?)<\/h2>/g, (_m, attrs: string, inner: string) => {
    const t = inner.replace(/<[^>]+>/g, '').trim();
    let sid = /id="([^"]+)"/.exec(attrs)?.[1] ?? slug(t);
    while (used.has(sid)) sid += '-2';
    used.add(sid);
    sections.push({ id: sid, title: t });
    const rest = attrs.replace(/\s*id="[^"]*"/, '');
    return `<h2 id="${sid}"${rest}><a class="anchor" href="#/${id}/${encodeURIComponent(sid)}" aria-label="連結到這一節">#</a>${inner}</h2>`;
  });
  const tab: Tab = id === 'api' || id.startsWith('api-') ? 'api' : 'guide';
  return { id, tab, title, group, html, text: plainText(html), sections };
}

const chapters: Chapter[] = [];
for (const path of Object.keys(files).sort()) {
  const id = /\/\d*-?([\w-]+)\.html$/.exec(path)![1];
  chapters.push(makeChapter(id, files[path]));
  // API 參考的總覽後面：每個模組一章
  if (id === 'api') for (const c of apiChapters(apiData)) chapters.push(makeChapter(c.id, c.html));
}

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const content = $<HTMLElement>('#content');
const nav = $<HTMLElement>('#nav');
const search = $<HTMLInputElement>('#search');
const results = $<HTMLElement>('#search-results');

let current: Chapter | null = null;
/** 目前顯示的分頁（側邊目錄只列這個分頁的章節） */
let tab: Tab | null = null;
/** 每個分頁最後看的章節（切換分頁時回到那裡） */
const lastOf: Record<Tab, string> = { guide: '', api: '' };
const tabChapters = (t: Tab) => chapters.filter((c) => c.tab === t);
let examples: Example[] = [];

// ───────── 目錄 ─────────

function buildNav(): void {
  nav.replaceChildren();
  let group = '';
  let list: HTMLOListElement | null = null;
  for (const ch of tabChapters(tab ?? 'guide')) {
    if (ch.group !== group || !list) {
      group = ch.group;
      const h = document.createElement('div');
      h.className = 'nav-group';
      h.textContent = group;
      list = document.createElement('ol');
      nav.append(h, list);
    }
    const li = document.createElement('li');
    li.dataset.id = ch.id;
    const a = document.createElement('a');
    a.href = `#/${ch.id}`;
    a.textContent = ch.title;
    const sub = document.createElement('ol');
    sub.className = 'nav-sections';
    for (const s of ch.sections) {
      const sli = document.createElement('li');
      const sa = document.createElement('a');
      sa.href = `#/${ch.id}/${encodeURIComponent(s.id)}`;
      sa.textContent = s.title;
      sa.dataset.section = s.id;
      sli.append(sa);
      sub.append(sli);
    }
    li.append(a, sub);
    list.append(li);
  }
}

function markNav(): void {
  for (const li of nav.querySelectorAll<HTMLElement>('li[data-id]')) {
    li.classList.toggle('current', li.dataset.id === current?.id);
  }
}

// ───────── 章節 ─────────

/** 切換分頁：頂端的頁籤、側邊目錄 */
function setTab(t: Tab): void {
  if (t === tab) return;
  tab = t;
  for (const a of document.querySelectorAll<HTMLAnchorElement>('#tabs a'))
    a.setAttribute('aria-current', a.dataset.tab === t ? 'page' : 'false');
  buildNav();
}

function render(ch: Chapter): void {
  for (const ex of examples) ex.dispose();
  stopRunning();
  current = ch;
  lastOf[ch.tab] = ch.id;
  setTab(ch.tab);
  content.innerHTML = ch.html;
  // 一般章節：內文的 API 名稱連到 API 參考
  if (!ch.id.startsWith('api')) linkApiNames(content, apiData);
  examples = mountExamples(content);

  // 上一章／下一章（同一個分頁裡）
  const list = tabChapters(ch.tab);
  const i = list.indexOf(ch);
  const pager = document.createElement('nav');
  pager.className = 'pager';
  const prev = list[i - 1];
  const next = list[i + 1];
  pager.innerHTML =
    `${prev ? `<a class="prev" href="#/${prev.id}"><small>上一章</small>${prev.title}</a>` : '<span></span>'}` +
    `${next ? `<a class="next" href="#/${next.id}"><small>下一章</small>${next.title}</a>` : '<span></span>'}`;
  content.append(pager);

  document.title = `${ch.title}｜Hero Engine 使用手冊`;
  markNav();
  observeSections();
}

/** 捲動時標出目前讀到的小節 */
let sectionObserver: IntersectionObserver | null = null;
function observeSections(): void {
  sectionObserver?.disconnect();
  const links = nav.querySelectorAll<HTMLElement>(`li[data-id="${current!.id}"] a[data-section]`);
  const mark = (sid: string) => links.forEach((a) => a.classList.toggle('active', a.dataset.section === sid));
  sectionObserver = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((e) => e.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible[0]) mark(visible[0].target.id);
    },
    { rootMargin: '0px 0px -70% 0px' },
  );
  content.querySelectorAll('h2[id]').forEach((h) => sectionObserver!.observe(h));
}

function route(): void {
  const [, chapterId = '', section = ''] = /^#\/([^/]*)\/?(.*)$/.exec(location.hash) ?? [];
  const ch = chapters.find((c) => c.id === chapterId) ?? chapters[0];
  if (ch !== current) render(ch);
  document.body.classList.remove('nav-open');
  const target = section ? document.getElementById(decodeURIComponent(section)) : null;
  if (target) target.scrollIntoView();
  else if (!section) window.scrollTo(0, 0);
}

// ───────── 搜尋 ─────────

function runSearch(): void {
  const q = search.value.trim().toLowerCase();
  results.replaceChildren();
  results.hidden = !q;
  nav.hidden = !!q;
  if (!q) return;
  let count = 0;
  // API 名稱：直接連到那個 API
  for (const hit of searchApi(apiData, q)) {
    const a = document.createElement('a');
    a.href = hit.href;
    a.className = 'api-hit';
    a.innerHTML = '<strong></strong><small></small>';
    a.querySelector('strong')!.textContent = `API › ${hit.module} › ${hit.name}`;
    a.querySelector('small')!.textContent = hit.summary;
    a.addEventListener('click', () => {
      search.value = '';
      runSearch();
    });
    results.append(a);
    count++;
  }
  for (const ch of chapters) {
    const at = ch.text.toLowerCase().indexOf(q);
    if (at < 0 && !ch.title.toLowerCase().includes(q)) continue;
    // 符合的小節
    const hits = ch.sections.filter((s) => s.title.toLowerCase().includes(q));
    const a = document.createElement('a');
    a.href = `#/${ch.id}${hits[0] ? `/${encodeURIComponent(hits[0].id)}` : ''}`;
    const from = Math.max(0, at - 20);
    const snippet = at >= 0 ? `${from > 0 ? '…' : ''}${ch.text.slice(from, at + q.length + 40)}…` : '';
    a.innerHTML = `<strong></strong><small></small>`;
    a.querySelector('strong')!.textContent = hits[0] ? `${ch.title} › ${hits[0].title}` : ch.title;
    a.querySelector('small')!.textContent = snippet;
    a.addEventListener('click', () => {
      search.value = '';
      runSearch();
    });
    results.append(a);
    count++;
  }
  if (!count) results.innerHTML = '<p class="empty">找不到符合的內容</p>';
}

search.addEventListener('input', runSearch);
search.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') results.querySelector('a')?.click();
  if (e.key === 'Escape') {
    search.value = '';
    runSearch();
  }
});
// 「/」聚焦搜尋框（不在輸入框裡時）
window.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement;
  if (e.key === '/' && !/INPUT|TEXTAREA/.test(t.tagName)) {
    e.preventDefault();
    search.focus();
  }
});

// 頁籤：回到那個分頁最後看的章節
for (const a of document.querySelectorAll<HTMLAnchorElement>('#tabs a'))
  a.addEventListener('click', (e) => {
    e.preventDefault();
    const t = a.dataset.tab as Tab;
    location.hash = `#/${lastOf[t] || tabChapters(t)[0].id}`;
  });

$('#menu-toggle').addEventListener('click', () => document.body.classList.toggle('nav-open'));
$('#scrim').addEventListener('click', () => document.body.classList.remove('nav-open'));

window.addEventListener('hashchange', route);
route();
