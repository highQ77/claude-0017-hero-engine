/**
 * 入口頁的「打包」：在背景執行 node hero build（同一套檢查與輸出），回報目前的步驟與紀錄。
 *
 *   node hero.js build --web|--mac [-f]，環境變數 PROJECT=<專案>（不改 node hero select 的選擇）
 *
 * 同一時間只打包一個專案。進度存在 globalThis：開發伺服器重新啟動（切換專案）時 vite.config.ts 會重新載入，
 * 這個檔案也會重新執行，放在模組裡的狀態會不見，但打包的子程序還在跑。
 */
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { ROOT } from './current-project.js';

export type BuildTarget = 'web' | 'mac';

export interface BuildJob {
  name: string;
  target: BuildTarget;
  /** macOS App 打開時就是全螢幕（-f） */
  fullscreen: boolean;
  state: 'running' | 'done' | 'failed';
  /** 目前的步驟（node hero build 印出的「▶ …」） */
  step: string;
  /** 最後幾行輸出（已去掉顏色碼） */
  log: string[];
  /** 完成時的輸出位置（「✓ 發佈完成」下面那幾行） */
  outputs: string[];
  startedAt: number;
  endedAt?: number;
}

/** 紀錄最多保留幾行 */
const MAX_LOG = 400;
const STORE = Symbol.for('hero-engine.portal-build');
const store: { job: BuildJob | null } = ((globalThis as Record<symbol, unknown>)[STORE] ??= { job: null }) as {
  job: BuildJob | null;
};

/** 目前（或最後一次）的打包 */
export function currentBuild(): BuildJob | null {
  return store.job;
}

/** 正在打包這個專案 */
export function isBuilding(name?: string): boolean {
  const job = store.job;
  return !!job && job.state === 'running' && (name === undefined || job.name === name);
}

/** 終端機的顏色碼 */
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;

/** 開始打包；已經有打包在跑時丟出錯誤 */
export function startBuild(
  name: string,
  target: BuildTarget,
  fullscreen: boolean,
  logger: { info(msg: string): void; error(msg: string): void },
): BuildJob {
  if (isBuilding()) throw Object.assign(new Error(`正在打包 ${store.job!.name}，請等它完成`), { status: 409 });
  const job: BuildJob = {
    name,
    target,
    fullscreen: target === 'mac' && fullscreen,
    state: 'running',
    step: '準備中',
    log: [],
    outputs: [],
    startedAt: Date.now(),
  };
  store.job = job;
  const args = [join(ROOT, 'hero.js'), 'build', `--${target}`, ...(job.fullscreen ? ['-f'] : [])];
  const label = `${name}（${target === 'web' ? '網頁版' : `macOS App${job.fullscreen ? '，全螢幕' : ''}`}）`;
  logger.info(`\n▶ 打包 ${label}（入口頁）`);
  const child = spawn(process.execPath, args, {
    cwd: ROOT,
    env: { ...process.env, PROJECT: name, NO_COLOR: '1', FORCE_COLOR: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let done = false;
  let rest = '';
  const onData = (chunk: Buffer) => {
    const lines = (rest + chunk.toString('utf8')).split('\n');
    rest = lines.pop() ?? '';
    for (const raw of lines) addLine(raw);
  };
  const addLine = (raw: string) => {
    // 進度列會用 \r 覆蓋同一行：只留最後的內容
    const line = (raw.split('\r').pop() ?? '').replace(ANSI, '').trimEnd();
    job.log.push(line);
    if (job.log.length > MAX_LOG) job.log.splice(0, job.log.length - MAX_LOG);
    const step = /^▶ (.+)$/.exec(line);
    if (step && !step[1].startsWith('發佈專案')) job.step = step[1];
    if (/^✓ 發佈完成/.test(line)) done = true;
    else if (done && line.trim()) job.outputs.push(line.trim());
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  const finish = (ok: boolean, why = '') => {
    if (job.state !== 'running') return;
    if (rest) addLine(rest);
    if (why) addLine(why);
    job.state = ok ? 'done' : 'failed';
    job.endedAt = Date.now();
    const sec = Math.round((job.endedAt - job.startedAt) / 1000);
    if (ok) logger.info(`✓ 打包完成 ${label}（${sec} 秒）：${job.outputs.join('、')}`);
    else logger.error(`✗ 打包失敗 ${label}（在「${job.step}」）：用入口頁查看紀錄`);
  };
  child.on('error', (error) => finish(false, error.message));
  child.on('close', (code) => finish(code === 0 && done, code === 0 ? '' : `（結束代碼 ${code}）`));
  return job;
}
