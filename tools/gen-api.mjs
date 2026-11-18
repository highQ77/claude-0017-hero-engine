#!/usr/bin/env node
/**
 * 產生 API 列表：引擎所有可用的 API（從原始碼自動整理，不用手寫）。
 *
 *   node hero api                     → 寫到 tips/api.txt（平常用這個）
 *   node tools/gen-api.mjs out.txt    → 寫到指定檔案
 *
 * 分析在 api-model.mjs（使用手冊的「API 參考」也用同一份）；這裡只負責排成文字。
 */
import { writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KINDS, analyzeApi } from './api-model.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, process.argv[2] ?? 'tips/api.txt');

const { modules, total } = analyzeApi();

const out = [];
const date = new Date().toISOString().slice(0, 10);
out.push('Hero Engine API 一覽');
out.push('='.repeat(60));
out.push(`由 node hero api（tools/gen-api.mjs）從原始碼自動產生（${date}）。引擎更新後執行 node hero api 重新產生。`);
out.push("遊戲裡用 import { 名稱 } from '@engine/<模組>' 引用；套件（src/packages）用 PluginManager 安裝。");
out.push('記號：· 成員　? 可省略　// 說明（取自原始碼註解）　get 唯讀屬性');
out.push('使用手冊的「API 參考」有同樣的內容，另外有範例與原始碼位置（node hero doc）。');
out.push('');

const toc = [];
const sections = [];
for (const mod of modules) {
  const lines = ['', '━'.repeat(60), `${mod.importPath}　${mod.title}　（${mod.items.length} 項）`, '━'.repeat(60)];
  for (const [kind, title] of KINDS) {
    const items = mod.items.filter((i) => i.kind === kind);
    if (!items.length) continue;
    lines.push('', `【${title}】`);
    for (const item of items) {
      item.heads.forEach((h, i) => {
        lines.push(`  ${h}${i === 0 && item.note ? `　（${item.note}）` : ''}`);
      });
      if (item.summary) lines.push(`      ${item.summary}`);
      for (const m of item.members) lines.push(`      · ${m.text}${m.doc ? `　// ${m.doc}` : ''}`);
    }
  }
  toc.push(`  ${mod.importPath.padEnd(26)} ${String(mod.items.length).padStart(3)} 項　${mod.title}`);
  sections.push(...lines);
}
out.push('目錄', ...toc, `  ${'合計'.padEnd(25)} ${String(total).padStart(3)} 項`, ...sections, '');
writeFileSync(OUT, out.join('\n'));
console.log(`✓ 已產生 ${relative(ROOT, OUT)}：${modules.length} 個模組、${total} 項匯出、${out.length} 行`);
