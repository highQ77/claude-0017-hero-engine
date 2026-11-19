#!/usr/bin/env node
/**
 * 檢查使用手冊的範例：
 *
 *   node doc/scripts/check-examples.mjs          型別檢查所有可以執行的 TypeScript 範例（tsc）
 *   node doc/scripts/check-examples.mjs --run    另外用 Chrome（無畫面模式）實際執行每個範例，
 *                                                收集錯誤訊息（需要安裝 Google Chrome）
 *
 * 只檢查完整的範例；data-run="false" 的程式片段不檢查。
 *
 * 另外檢查「API 參考」（doc/manual/api-examples/<模組>.md，tools/api-model.mjs）：
 * - 每個 API 都要有範例（沒有時失敗）
 * - 範例都要通過型別檢查（import 由手冊自動補上：engine.ts、引擎的 API、three）
 *   --api-todo   列出所有沒有範例的 API（預設列 30 個）
 *   --run-api    另外用 Chrome 實際執行 API 參考的每個範例（很多，要幾十分鐘）
 *   --api-only   只檢查 API 參考（略過章節的範例）
 *   --api-module=core,scene   只執行這些模組的 API 範例（搭配 --run-api）
 *
 * UICanvas 繪圖範例（data-lang="canvas"）在 --run 時打開章節頁面，依序執行並收集錯誤輸出；
 * 另外打開 manual/canvas-shared-check.html，確認共用模式（借用 three.js 的 WebGL）和獨立模式逐像素相同。
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeApi } from '../../tools/api-model.mjs';

const DOC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = resolve(DOC, '..');
const CHAPTERS = join(DOC, 'manual', 'chapters');
const OUT = join(DOC, '.check');

function dedent(text) {
  const lines = text.replace(/\t/g, '  ').split('\n');
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => /^ */.exec(l)[0].length));
  return `${lines.map((l) => l.slice(Number.isFinite(indent) ? indent : 0)).join('\n')}\n`;
}

/** 找出章節裡的範例 */
function examples() {
  const list = [];
  for (const file of readdirSync(CHAPTERS)
    .filter((f) => f.endsWith('.html'))
    .sort()) {
    const html = readFileSync(join(CHAPTERS, file), 'utf8');
    const chapter = /^\d*-?(.+)\.html$/.exec(file)[1];
    let i = 0;
    for (const m of html.matchAll(/<script type="text\/plain" class="example"([^>]*)>([\s\S]*?)<\/script>/g)) {
      const attrs = m[1];
      const lang = /data-lang="(\w+)"/.exec(attrs)?.[1] ?? 'ts';
      const runnable = !/data-run="false"/.test(attrs) && !/data-readonly/.test(attrs);
      const title = /data-title="([^"]*)"/.exec(attrs)?.[1] ?? '';
      list.push({ file, chapter, index: i++, lang, runnable, title, code: dedent(m[2]) });
    }
  }
  return list;
}

function typecheck(list) {
  const ts = list.filter((e) => e.lang === 'ts' && e.runnable);
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  // 範例共用的 engine.ts（範例寫 import { world } from './engine'）
  writeFileSync(join(OUT, 'engine.ts'), readFileSync(join(DOC, 'manual', 'engine.ts'), 'utf8'));
  const files = ['engine.ts'];
  for (const e of ts) {
    const name = `${e.chapter}-${e.index}.ts`;
    writeFileSync(join(OUT, name), e.code);
    files.push(name);
  }
  writeFileSync(
    join(OUT, 'tsconfig.json'),
    JSON.stringify(
      {
        extends: '../../tsconfig.json',
        compilerOptions: { noEmit: true, noUnusedLocals: false },
        include: files,
      },
      null,
      2,
    ),
  );
  console.log(`▶ 型別檢查 ${ts.length} 個 TypeScript 範例（加上共用的 engine.ts）`);
  const result = spawnSync(
    process.execPath,
    [join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', join(OUT, 'tsconfig.json')],
    { cwd: ROOT, encoding: 'utf8' },
  );
  const out = (result.stdout + result.stderr).trim();
  if (result.status !== 0) {
    // 把暫存檔名換回章節與標題
    console.log(
      out.replace(/doc\/\.check\/([\w-]+)-(\d+)\.ts/g, (_m, ch, i) => {
        const e = ts.find((x) => x.chapter === ch && String(x.index) === i);
        return `[${ch}#${i} ${e?.title ?? ''}]`;
      }),
    );
    return false;
  }
  rmSync(OUT, { recursive: true, force: true });
  console.log('✓ 型別檢查通過');
  return true;
}

// ───────── 實際執行（Chrome DevTools Protocol） ─────────

const CHROME = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].find((p) => existsSync(p));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return res;
    } catch {
      /* 還沒好 */
    }
    await sleep(250);
  }
  throw new Error(`等不到 ${url}`);
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = [];
    ws.addEventListener('message', (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { ok, fail } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) fail(new Error(msg.error.message));
        else ok(msg.result);
      } else if (msg.method) {
        for (const l of this.listeners) l(msg);
      }
    });
  }

  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((ok, fail) => {
      ws.addEventListener('open', ok, { once: true });
      ws.addEventListener('error', fail, { once: true });
    });
    return new Cdp(ws);
  }

  send(method, params = {}, sessionId) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((ok, fail) => this.pending.set(id, { ok, fail }));
  }
}

async function runInBrowser(list) {
  if (!CHROME) {
    console.log('✗ 找不到 Chrome，略過實際執行');
    return false;
  }
  const port = 5900 + Math.floor(Math.random() * 90);
  const vite = spawn(
    process.execPath,
    [
      join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'),
      '--config',
      join(DOC, 'vite.config.ts'),
      '--port',
      String(port),
      '--strictPort',
    ],
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let viteLog = '';
  vite.stdout.on('data', (d) => (viteLog += d));
  vite.stderr.on('data', (d) => (viteLog += d));
  const debugPort = 9300 + Math.floor(Math.random() * 90);
  const profile = join(DOC, '.check-chrome');
  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--autoplay-policy=no-user-gesture-required',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  let failed = 0;
  try {
    const base = `http://localhost:${port}`;
    await waitFor(`${base}/manual/`);
    const version = await (await waitFor(`http://127.0.0.1:${debugPort}/json/version`)).json();
    const cdp = await Cdp.connect(version.webSocketDebuggerUrl);

    /** 開一個分頁，收集錯誤 */
    const openPage = async (url) => {
      const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
      const errors = [];
      const logs = [];
      cdp.listeners.push((msg) => {
        if (msg.sessionId !== sessionId) return;
        if (msg.method === 'Runtime.exceptionThrown')
          errors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
        if (msg.method === 'Runtime.consoleAPICalled') {
          const text = msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
          if (msg.params.type === 'error') errors.push(text);
          else if (!text.startsWith('[vite]')) logs.push(text);
        }
        // 要的是素材（有副檔名、不是 .html），拿到的卻是 HTML：找不到檔案時的退回頁面（網址寫錯、相對路徑算錯）
        if (msg.method === 'Network.responseReceived') {
          const { url: u, mimeType } = msg.params.response;
          const path = new URL(u).pathname;
          if (
            !/not-found/.test(path) &&
            mimeType === 'text/html' &&
            /\.[a-z0-9]+$/i.test(path) &&
            !/\.html?$/i.test(path)
          )
            errors.push(`找不到檔案（伺服器回傳 HTML）：${path}`);
          else if (msg.params.response.status >= 400 && !/favicon/.test(path))
            errors.push(`HTTP ${msg.params.response.status}：${path}`);
        }
      });
      await cdp.send('Runtime.enable', {}, sessionId);
      await cdp.send('Network.enable', {}, sessionId);
      await cdp.send('Page.enable', {}, sessionId);
      await cdp.send(
        'Emulation.setDeviceMetricsOverride',
        { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false },
        sessionId,
      );
      await cdp.send('Page.navigate', { url }, sessionId);
      const evaluate = async (expression) =>
        (await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId)).result
          .value;
      const close = () => cdp.send('Target.closeTarget', { targetId });
      return { errors, logs, evaluate, close };
    };

    // TypeScript：在 runner.html 直接執行
    const ts = process.argv.includes('--api-only') ? [] : list.filter((e) => e.lang === 'ts' && e.runnable);
    // --run-api：另外執行 API 參考的每個範例（只看輸出的範例等短一點）
    const api = process.argv.includes('--run-api')
      ? apiGuides().list.map((g, index) => ({
          chapter: 'api',
          index,
          title: g.label,
          code: g.code,
          wait: g.console ? 1500 : 2500,
        }))
      : [];
    console.log(
      `▶ 執行 ${ts.length} 個 TypeScript 範例（每個 4 秒）${api.length ? `與 API 參考的 ${api.length} 個範例` : ''}`,
    );
    for (const e of process.argv.includes('--xml-only') ? [] : [...ts, ...api]) {
      const page = await openPage(`${base}/manual/runner.html`);
      await sleep(1200);
      await page.evaluate(`window.__runExample(${JSON.stringify(e.code)})`);
      await sleep(e.wait ?? 4000);
      const canvas = await page.evaluate('document.querySelectorAll("canvas").length');
      const label = `${e.chapter}#${e.index} ${e.title}`;
      // 範例自己示範 logger.error 時：記錄器印出的「[模組] …」不算失敗（例外照樣算）
      const errs = (/\.error\(/.test(e.code) ? page.errors.filter((t) => !/^\[[\w-]+\] /.test(t)) : page.errors).filter(
        // 範例故意示範載入失敗（網址裡有 not-found）
        (t) => !/not-found/.test(t),
      );
      if (errs.length) {
        failed++;
        console.log(`✗ ${label}\n    ${errs.join('\n    ')}`);
      } else {
        console.log(
          `✓ ${label}（畫布 ${canvas}）${page.logs.length ? `\n    ${page.logs.slice(0, 3).join('\n    ')}` : ''}`,
        );
      }
      await page.close();
    }

    // XML：打開每個章節，捲動到底讓所有範例建立，再檢查錯誤
    // 有 XML 範例的章節，加上自動產生內容的章節（元件參考）
    const generated = readdirSync(CHAPTERS)
      .filter((f) => readFileSync(join(CHAPTERS, f), 'utf8').includes('data-generate='))
      .map((f) => /^\d*-?(.+)\.html$/.exec(f)[1]);
    // 只看可以執行的 XML 範例（data-run="false"、data-readonly 的只是程式片段，例如場景檔的寫法）
    const chapters = [
      ...new Set([...list.filter((e) => e.lang === 'xml' && e.runnable).map((e) => e.chapter), ...generated]),
    ];
    if (process.argv.includes('--api-only')) chapters.length = 0;
    console.log(`▶ 檢查 ${chapters.length} 個章節的 XML 範例`);
    for (const ch of chapters) {
      const page = await openPage(`${base}/manual/#/${ch}`);
      await sleep(1500);
      // 逐一把每個 XML 範例捲到畫面上，等它的預覽建立（最多 3 秒），不靠固定的捲動間隔
      await page.evaluate(`(async () => {
        const list = [...document.querySelectorAll('.example.lang-xml:not(.readonly)')];
        for (const ex of list) {
          ex.scrollIntoView({ block: 'center' });
          for (let t = 0; t < 60 && !ex.querySelector('canvas') && !ex.classList.contains('has-error'); t++) await new Promise((r) => setTimeout(r, 50));
        }
      })()`);
      await sleep(1500);
      const report =
        await page.evaluate(`JSON.stringify([...document.querySelectorAll('.example.lang-xml:not(.readonly)')].map((ex) => ({
        title: ex.querySelector('.ex-title')?.textContent,
        error: ex.classList.contains('has-error') ? ex.querySelector('.log-error')?.textContent : null,
        canvas: !!ex.querySelector('canvas'),
      })))`);
      const items = JSON.parse(report);
      const bad = items.filter((x) => x.error || !x.canvas);
      if (bad.length || page.errors.length) {
        failed += bad.length + page.errors.length;
        console.log(`✗ ${ch}：${items.length} 個 XML 範例`);
        for (const b of bad) console.log(`    [${b.title}] ${b.error ?? '沒有建立畫布'}`);
        for (const err of page.errors) console.log(`    ${err}`);
      } else {
        console.log(`✓ ${ch}：${items.length} 個 XML 範例`);
      }
      await page.close();
    }

    // UICanvas 共用模式（借用 three.js 的 WebGL）：每個繪圖範例和獨立模式逐像素比較
    if (!process.argv.includes('--api-only')) {
      const page = await openPage(`${base}/manual/canvas-shared-check.html`);
      let result = null;
      for (let t = 0; t < 120 && !result; t++) {
        await sleep(500);
        result = await page.evaluate('window.__sharedCheck ? JSON.stringify(window.__sharedCheck) : null');
      }
      const items = result ? JSON.parse(result).filter((x) => !x.skipped) : [];
      const bad = items.filter((x) => x.error || !(x.mean < 0.5));
      if (!result || bad.length || page.errors.length) {
        failed += bad.length + page.errors.length + (result ? 0 : 1);
        console.log(`✗ UICanvas 共用模式：${items.length} 個範例${result ? '' : '（逾時）'}`);
        for (const b of bad) console.log(`    [${b.title}] ${b.error ?? `平均差異 ${b.mean.toFixed(3)}`}`);
        for (const err of page.errors) console.log(`    ${err}`);
      } else {
        console.log(`✓ UICanvas 共用模式：${items.length} 個範例和獨立模式逐像素相同`);
      }
      await page.close();
    }

    // UICanvas 繪圖範例（data-lang="canvas"）：在章節頁面裡依序執行，收集錯誤輸出
    const canvasChapters = process.argv.includes('--api-only')
      ? []
      : [...new Set(list.filter((e) => e.lang === 'canvas' && e.runnable).map((e) => e.chapter))];
    for (const ch of canvasChapters) {
      const page = await openPage(`${base}/manual/#/${ch}`);
      await sleep(2000);
      const items = JSON.parse(await page.evaluate('window.__runCanvasExamples().then((r) => JSON.stringify(r))'));
      const bad = items.filter((x) => x.errors.length);
      if (bad.length || page.errors.length || !items.length) {
        failed += bad.length + page.errors.length + (items.length ? 0 : 1);
        console.log(`✗ ${ch}：${items.length} 個 UICanvas 範例`);
        for (const b of bad) console.log(`    [${b.title}] ${b.errors.join('；')}`);
        for (const err of page.errors) console.log(`    ${err}`);
      } else {
        console.log(`✓ ${ch}：${items.length} 個 UICanvas 範例`);
      }
      await page.close();
    }
    cdp.ws.close();
  } catch (error) {
    failed++;
    console.log('✗', error.message);
    console.log(viteLog);
  } finally {
    chrome.kill();
    vite.kill();
    await sleep(300);
    rmSync(profile, { recursive: true, force: true });
  }
  if (!failed) console.log('✓ 所有範例都能執行');
  return failed === 0;
}

// ───────── API 參考的範例（doc/manual/api-examples/*.md） ─────────

/** 每個 API 的範例（import 已經補好）；同一個東西從好幾個模組匯出時只算一次 */
function apiGuides() {
  const { modules } = analyzeApi();
  const seen = new Set();
  const missing = [];
  const list = [];
  for (const m of modules)
    for (const i of m.items) {
      const key = i.source ? `${i.source.file}:${i.source.line}` : `${m.id}:${i.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!i.guides.length) missing.push(`${m.importPath} ${i.name}`);
      i.guides.forEach((g, k) =>
        list.push({
          label: `${m.importPath} ${i.name}${i.guides.length > 1 ? ` #${k + 1}` : ''}`,
          code: g.code,
          console: g.console,
        }),
      );
    }
  // --api-module=core,scene：只看這些模組（實際執行時用；全部要很久）
  const only = process.argv
    .find((a) => a.startsWith('--api-module='))
    ?.split('=')[1]
    .split(',');
  const pick = only
    ? list.filter((g) => only.some((m) => g.label.startsWith(`@engine/${m} `) || g.label.startsWith(`${m} `)))
    : list;
  return { list: pick, missing, total: seen.size };
}

/** 每個 API 都要有範例；範例都要通過型別檢查（失敗時回傳 false） */
function checkApiGuides() {
  const OUT_API = join(DOC, '.check-api');
  const { list, missing, total } = apiGuides();
  let ok = true;
  if (missing.length) {
    ok = false;
    console.log(`✗ ${missing.length}／${total} 個 API 沒有範例（寫在 doc/manual/api-examples/<模組>.md）：`);
    for (const name of missing.slice(0, process.argv.includes('--api-todo') ? undefined : 30))
      console.log(`    ${name}`);
    if (missing.length > 30 && !process.argv.includes('--api-todo')) console.log('    …（加上 --api-todo 列出全部）');
  } else console.log(`✓ ${total} 個 API 都有範例`);
  rmSync(OUT_API, { recursive: true, force: true });
  mkdirSync(OUT_API, { recursive: true });
  writeFileSync(join(OUT_API, 'engine.ts'), readFileSync(join(DOC, 'manual', 'engine.ts'), 'utf8'));
  const files = ['engine.ts'];
  list.forEach((g, n) => {
    g.file = `api-${n}.ts`;
    writeFileSync(join(OUT_API, g.file), `${g.code}\nexport {};\n`);
    files.push(g.file);
  });
  writeFileSync(
    join(OUT_API, 'tsconfig.json'),
    JSON.stringify({
      extends: '../../tsconfig.json',
      compilerOptions: { noEmit: true, noUnusedLocals: false, noUnusedParameters: false },
      include: files,
    }),
  );
  console.log(`▶ 型別檢查 API 參考的 ${list.length} 個範例`);
  const result = spawnSync(
    process.execPath,
    [join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', join(OUT_API, 'tsconfig.json')],
    { cwd: ROOT, encoding: 'utf8' },
  );
  const errors = [];
  for (const line of (result.stdout + result.stderr).split('\n')) {
    const m = /doc\/\.check-api\/(api-\d+)\.ts\((\d+),\d+\): error TS\d+: (.*)/.exec(line);
    if (!m) continue;
    const g = list.find((x) => x.file === `${m[1]}.ts`);
    errors.push(`    ${g.label}　第 ${m[2]} 行：${m[3]}`);
  }
  rmSync(OUT_API, { recursive: true, force: true });
  if (errors.length || result.status !== 0) {
    ok = false;
    console.log(`✗ API 參考的範例沒通過型別檢查（${errors.length} 個錯誤）：`);
    console.log(errors.slice(0, 80).join('\n') || (result.stdout + result.stderr).slice(0, 2000));
  } else console.log('✓ API 參考的範例都通過型別檢查');
  return ok;
}

const list = examples();
const apiOnly = process.argv.includes('--api-only');
let ok = apiOnly ? true : typecheck(list);
ok = checkApiGuides() && ok;
if (process.argv.includes('--run') || process.argv.includes('--run-api')) ok = (await runInBrowser(list)) && ok;
process.exit(ok ? 0 : 1);
