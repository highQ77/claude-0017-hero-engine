#!/usr/bin/env node
/**
 * Hero Engine 專案指令（node hero ...）：
 *
 *   node hero create <專案名稱>   建立空專案（projects/<專案名稱>/）
 *   node hero select [專案名稱]   選擇要預覽、編譯的專案（不給名稱時列出所有專案）
 *   node hero remove <專案名稱>   刪除專案（projects/、dist/、.tauri/ 裡的這個專案；刪除前會要求輸入專案名稱確認）
 *   node hero dev                 預覽目前選擇的專案（開發伺服器；入口頁 /portal 可以切換、新增、刪除專案）
 *   node hero build [--web|--mac] 檢查（格式、程式、型別、測試）後發佈目前選擇的專案：
 *                                   --web（預設）網頁版 → dist/<專案名稱>/web/
 *                                   --mac         macOS App（Tauri）→ dist/<專案名稱>/mac/<專案名稱>.app
 *                                   --mac -f      App 打開時就是全螢幕（-f 同 --fullscreen）
 *   node hero doc [build]         開啟使用手冊（doc/）；build 打包到 dist/doc/
 *   node hero api                 產生引擎的 API 列表（tips/api.txt）
 *
 * dev、build 後面的參數會交給 Vite，例如 node hero dev --port 3000
 * 暫時改用別的專案：PROJECT=名稱 node hero dev
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createInterface } from 'node:readline/promises';
import {
  DEFAULT_PROJECT,
  ROOT,
  SELECTION_FILE,
  projectDir,
  projectExists,
  selectedProject,
} from './tools/current-project.js';
import {
  TAURI_WORK,
  VALID_NAME,
  createProject,
  listProjects,
  removeError,
  removeProject,
  removeTargets,
} from './tools/project-files.js';

const bin = (pkg, file) => join(ROOT, 'node_modules', pkg, file);
const VITE = bin('vite', 'bin/vite.js');
const TSC = bin('typescript', 'bin/tsc');
const VITEST = bin('vitest', 'vitest.mjs');
const BIOME = bin('@biomejs/biome', 'bin/biome');
const TAURI = bin('@tauri-apps/cli', 'tauri.js');
/** 桌面版外殼的範本（Rust）：編譯時複製到 .tauri/<專案>/src-tauri/ */
const TAURI_TEMPLATE = join(ROOT, 'tools', 'tauri');

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

function checkName(name, command) {
  if (!name) fail(`請給專案名稱：node hero ${command} <專案名稱>`);
  if (!VALID_NAME.test(name))
    fail(`專案名稱「${name}」不合法：只能用小寫英文、數字和連字號（-），而且要以英文或數字開頭`);
}

/** 執行子程式（繼承終端機輸出），失敗就結束 */
function run(label, file, args, env = {}, cwd = ROOT) {
  if (!existsSync(file)) fail(`找不到 ${relative(ROOT, file)}，請先執行 npm install`);
  if (label) console.log(`\n▶ ${label}`);
  const result = spawnSync(process.execPath, [file, ...args], {
    cwd,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
  if (result.error) fail(result.error.message);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

/** 目前專案（不存在就提示） */
function currentProject() {
  const name = selectedProject();
  if (!projectExists(name)) fail(`找不到專案「${name}」。用 node hero select 查看並選擇專案`);
  return name;
}

// ───────── 指令 ─────────

function create(name) {
  checkName(name, 'create');
  try {
    createProject(name);
  } catch (error) {
    fail(error.message);
  }
  console.log(`✓ 已建立專案 projects/${name}/`);
  console.log('    index.html          頁面');
  console.log('    tsconfig.json       TypeScript 設定（VS Code 程式碼提示）');
  console.log('    src/engine.ts       引擎與外掛設定（要用哪些外掛）');
  console.log('    src/main.ts         遊戲程式');
  console.log('    public/scenes/main.xml 場景檔（3D 場景編輯器：/s3d-editor.html）');
  console.log('    public/ui/scene.xml 介面檔（UI 編輯器：/ui-editor.html）');
  console.log(`\n下一步：node hero select ${name}，然後 node hero dev`);
}

function select(name) {
  if (!name) {
    const current = selectedProject();
    const projects = listProjects();
    if (!projects.length) return console.log('還沒有任何專案。用 node hero create <專案名稱> 建立');
    console.log('專案（● 目前選擇）：');
    for (const p of projects) console.log(`  ${p === current ? '●' : ' '} ${p}`);
    if (process.env.PROJECT) console.log(`\n（環境變數 PROJECT=${process.env.PROJECT} 優先）`);
    return;
  }
  checkName(name, 'select');
  if (!projectExists(name)) {
    const projects = listProjects();
    fail(`找不到專案「${name}」。現有專案：${projects.join('、') || '（無）'}`);
  }
  writeFileSync(SELECTION_FILE, `${name}\n`);
  console.log(`✓ 已選擇專案 ${name}（node hero dev 預覽、node hero build 編譯）`);
}

/** 刪除專案：列出要刪除的東西，輸入專案名稱確認後才刪除（無法復原） */
async function remove(name) {
  checkName(name, 'remove');
  if (!projectExists(name)) {
    const projects = listProjects();
    fail(`找不到專案「${name}」。現有專案：${projects.join('、') || '（無）'}`);
  }
  const error = removeError(name);
  if (error) fail(error);

  let selected = '';
  try {
    selected = readFileSync(SELECTION_FILE, 'utf8').trim();
  } catch {
    /* 還沒選過 */
  }
  console.log(`即將刪除專案「${name}」：`);
  for (const { dir, files } of removeTargets(name)) console.log(`  ${relative(ROOT, dir)}/（${files} 個檔案）`);
  if (selected === name) console.log(`\n這是目前選擇的專案：刪除後改選 ${DEFAULT_PROJECT}`);
  console.log('\n⚠ 刪除後無法復原（不會放進垃圾桶）。');

  if (!process.stdin.isTTY) fail('需要在終端機裡執行才能確認刪除（已取消）');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  // Ctrl+C、Ctrl+D 也算取消（不要印出錯誤）
  const abort = new AbortController();
  rl.on('SIGINT', () => abort.abort());
  let answer = '';
  try {
    answer = (
      await rl.question(`請輸入專案名稱「${name}」確認刪除（直接按 Enter 取消）：`, { signal: abort.signal })
    ).trim();
  } catch {
    answer = '';
    console.log('');
  } finally {
    rl.close();
  }
  if (answer !== name) {
    console.log('已取消，沒有刪除任何檔案');
    return;
  }

  removeProject(name);
  console.log(`✓ 已刪除專案 ${name}${selected === name ? `（目前選擇改為 ${DEFAULT_PROJECT}）` : ''}`);
}

function dev(args) {
  const name = currentProject();
  console.log(`▶ 預覽專案 ${name}`);
  console.log('    /               遊戲進行畫面');
  console.log('    /portal         專案選擇的入口頁');
  console.log('    /s3d-editor     遊戲 3D 編輯器');
  console.log('    /ui-editor      遊戲 2D 介面編輯器');
  console.log('    /shader-editor  著色器編輯器');
  console.log('    /se-editor      音效編輯器');
  run('', VITE, args, { PROJECT: name });
}

/** 發佈的平台：--web（預設）、--mac */
const BUILD_TARGETS = ['web', 'mac'];
/** 還沒支援的平台（給清楚的說明，而不是當成 Vite 的參數） */
const LATER_TARGETS = ['windows', 'window', 'win', 'ios', 'android', 'linux'];
/** 桌面版選項：App 打開時就是全螢幕 */
const FULLSCREEN_FLAGS = ['-f', '--fullscreen'];

function build(args) {
  const flags = args.filter((a) => a.startsWith('--') && [...BUILD_TARGETS, ...LATER_TARGETS].includes(a.slice(2)));
  const later = flags.map((a) => a.slice(2)).filter((t) => LATER_TARGETS.includes(t));
  if (later.length) fail(`還不支援發佈到 ${later.join('、')}（目前可以用 --web、--mac）`);
  const targets = flags.length ? [...new Set(flags.map((a) => a.slice(2)))] : ['web'];
  const fullscreen = args.some((a) => FULLSCREEN_FLAGS.includes(a));
  if (fullscreen && !targets.includes('mac'))
    fail('-f（全螢幕）只用在桌面版：node hero build --mac -f（網頁版請在遊戲裡用 Fullscreen API）');
  const viteArgs = args.filter((a) => !flags.includes(a) && !FULLSCREEN_FLAGS.includes(a));
  const name = currentProject();
  // 先檢查桌面版需要的工具：不要等網頁版編譯完才發現不能做
  if (targets.includes('mac')) checkMacTools();
  const labels = targets.map((t) => (t === 'web' ? '網頁版' : `macOS App${fullscreen ? '，全螢幕' : ''}`));
  console.log(`▶ 發佈專案 ${name}（${labels.join('、')}）`);
  // 格式與程式檢查（Biome）：格式不符或有錯誤時停止；修正用 npm run fix
  run('格式與程式檢查', BIOME, ['ci']);
  run('型別檢查', TSC, ['--noEmit']);
  run('測試', VITEST, ['run']);
  // 網頁版：macOS App 也是用它包起來的，所以一定會先編譯
  const webDir = join(ROOT, 'dist', name, 'web');
  run('打包網頁版', VITE, ['build', '--outDir', webDir, '--emptyOutDir', ...viteArgs], { PROJECT: name });
  const done = [`網頁版：dist/${name}/web/（index.html，放到網站的根目錄）`];
  if (targets.includes('mac'))
    done.push(`macOS App${fullscreen ? '（全螢幕）' : ''}：${relative(ROOT, buildMac(name, webDir, { fullscreen }))}`);
  console.log(`\n✓ 發佈完成\n${done.map((d) => `    ${d}`).join('\n')}`);
}

/** macOS App 需要的工具：macOS、Rust（cargo）、Tauri CLI */
function checkMacTools() {
  if (process.platform !== 'darwin') fail('--mac 只能在 macOS 上編譯');
  const cargo = spawnSync('cargo', ['--version'], { encoding: 'utf8' });
  if (cargo.error || cargo.status !== 0)
    fail('--mac 需要 Rust：請先安裝（https://rustup.rs 或 brew install rust），裝好後重新開終端機');
  if (!existsSync(TAURI)) fail('找不到 Tauri CLI（@tauri-apps/cli），請先執行 npm install');
}

/** 頁面的標題（視窗標題用）；沒有時用專案名稱 */
function pageTitle(name) {
  const html = readFileSync(join(projectDir(name), 'index.html'), 'utf8');
  return /<title>([^<]*)<\/title>/i.exec(html)?.[1].trim() || name;
}

/**
 * 用 Tauri 把網頁版包成 macOS App：
 * 1. 在 .tauri/<專案>/src-tauri/ 放好外殼（tools/tauri/ 的範本、這個專案的設定與圖示）
 * 2. tauri build（第一次要下載、編譯 Rust 套件，比較久；之後很快）
 * 3. 把 <專案>.app 複製到 dist/<專案>/mac/
 * fullscreen：App 打開時就是全螢幕（macOS 原生全螢幕；玩家可以用 ⌃⌘F 或選單「顯示方式」離開）
 */
function buildMac(name, webDir, { fullscreen = false } = {}) {
  const work = join(TAURI_WORK, name);
  const shell = join(work, 'src-tauri');
  mkdirSync(join(shell, 'src'), { recursive: true });
  for (const f of ['Cargo.toml', 'build.rs', 'src/main.rs']) cpSync(join(TAURI_TEMPLATE, f), join(shell, f));
  const conf = {
    $schema: 'https://schema.tauri.app/config/2',
    productName: name,
    version: JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version ?? '0.1.0',
    identifier: `com.heroengine.${name}`,
    build: { frontendDist: relative(shell, webDir) },
    app: {
      windows: [
        {
          title: pageTitle(name),
          width: 1280,
          height: 720,
          minWidth: 640,
          minHeight: 360,
          center: true,
          // 全螢幕：離開全螢幕時回到上面的 1280×720 視窗
          fullscreen,
        },
      ],
      security: { csp: null },
    },
    bundle: {
      active: true,
      targets: ['app'],
      icon: ['icons/32x32.png', 'icons/128x128.png', 'icons/128x128@2x.png', 'icons/icon.icns', 'icons/icon.png'],
      category: 'Game',
    },
  };
  writeFileSync(join(shell, 'tauri.conf.json'), `${JSON.stringify(conf, null, 2)}\n`);
  // 圖示：專案有 icon.png（建議 1024×1024）就用它，沒有就用引擎預設的
  const icon = existsSync(join(projectDir(name), 'icon.png'))
    ? join(projectDir(name), 'icon.png')
    : join(TAURI_TEMPLATE, 'icon.png');
  run('產生 App 圖示', TAURI, ['icon', icon, '--output', join(shell, 'icons')], {}, work);
  const target = join(TAURI_WORK, 'target');
  run(
    '編譯 macOS App（第一次要下載、編譯 Rust 套件，可能要幾分鐘）',
    TAURI,
    ['build', '--bundles', 'app'],
    {
      CARGO_TARGET_DIR: target,
      // 依「這台電腦的 Rust 版本」挑套件版本：Rust 比較舊時自動用還支援它的舊版（不用升級 Rust）
      CARGO_RESOLVER_INCOMPATIBLE_RUST_VERSIONS: 'fallback',
    },
    work,
  );
  const app = join(target, 'release', 'bundle', 'macos', `${name}.app`);
  if (!existsSync(app)) fail(`編譯完成但找不到 ${relative(ROOT, app)}`);
  const outDir = join(ROOT, 'dist', name, 'mac');
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const out = join(outDir, `${name}.app`);
  cpSync(app, out, { recursive: true, verbatimSymlinks: true });
  return out;
}

/** 使用手冊：doc/（範例可以編輯、執行） */
function doc(args) {
  const config = join(ROOT, 'doc', 'vite.config.ts');
  if (!existsSync(config)) fail('找不到 doc/vite.config.ts');
  if (args[0] === 'build') {
    run('打包使用手冊', VITE, ['build', '--config', config, ...args.slice(1)]);
    console.log(
      '\n✓ 打包完成：dist/doc/（直接雙擊 dist/doc/index.html 就能閱讀；TypeScript 範例要執行請用 node hero doc）',
    );
    return;
  }
  console.log('▶ 使用手冊：/manual/');
  run('', VITE, ['--config', config, '--open', '/manual/', ...args]);
}

/** API 列表：從原始碼整理引擎所有可用的 API，寫到 tips/api.txt */
function api() {
  const script = join(ROOT, 'tools', 'gen-api.mjs');
  if (!existsSync(script)) fail('找不到 tools/gen-api.mjs');
  run('', script, []);
}

function help() {
  console.log(`Hero Engine 專案指令

  node hero create <專案名稱>   建立空專案（projects/<專案名稱>/）
  node hero select [專案名稱]   選擇要預覽、編譯的專案（不給名稱時列出所有專案）
  node hero remove <專案名稱>   刪除專案（刪除前會要求輸入專案名稱確認）
  node hero dev                 預覽目前選擇的專案（入口頁 /portal 可以切換、新增、刪除專案）
  node hero build               發佈網頁版（預設，同 --web）→ dist/<專案名稱>/web/
  node hero build --mac         發佈 macOS App（Tauri，需要 Rust）→ dist/<專案名稱>/mac/
  node hero build --mac -f      同上，App 打開時就是全螢幕（-f 同 --fullscreen）
  node hero doc [build]         開啟使用手冊；build 打包到 dist/doc/
  node hero api                 產生引擎的 API 列表（tips/api.txt）

目前選擇：${selectedProject()}${existsSync(SELECTION_FILE) ? '' : `（預設 ${DEFAULT_PROJECT}）`}`);
}

const [command, ...rest] = process.argv.slice(2);
switch (command) {
  case 'create':
    create(rest[0]);
    break;
  case 'select':
    select(rest[0]);
    break;
  case 'remove':
    await remove(rest[0]);
    break;
  case 'dev':
    dev(rest);
    break;
  case 'build':
    build(rest);
    break;
  case 'doc':
    doc(rest);
    break;
  case 'api':
    api();
    break;
  case undefined:
  case 'help':
  case '-h':
  case '--help':
    help();
    break;
  default:
    console.error(`不認識的指令「${command}」\n`);
    help();
    process.exit(1);
}
