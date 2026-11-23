/**
 * 範例的執行環境（runner.html，放在範例的預覽框 iframe 裡）。
 *
 * 1. 告訴外層頁面「準備好了」（ready）
 * 2. 收到程式碼後 POST 到開發伺服器（文件網站根目錄的 __doc/run），拿到虛擬模組的網址
 * 3. import 那個網址：Vite 會編譯 TypeScript、處理 '@engine/...' 和 'three'
 * 範例的 RenderPlugin 預設開啟攝影機繞轉控制（RenderPlugin.defaults）。
 * console 的輸出與錯誤都轉給外層頁面顯示。每次執行都是一個新的預覽框（狀態不會互相干擾）。
 */

import { RenderPlugin } from '@engine/render';

// 範例裡的相對網址（'models/robot.gltf'、'sounds/jump.wav'）和遊戲專案一樣，從網站根目錄（doc/public/）算起：
// 預覽框在 manual/runner.html，沒有這一行會變成 manual/models/…（拿到 HTML 頁面，載入失敗）
const base = document.createElement('base');
base.href = new URL('../', location.href).href;
document.head.prepend(base);

// 所有範例預設可以用滑鼠轉動攝影機（拖曳轉動、右鍵平移；滾輪要先點一下範例才會縮放，捲動手冊時不會誤觸）。
// 範例自己的攝影機動畫在第一次操作前照常運作。不想要的範例寫 new RenderPlugin({ orbitControls: false })。
RenderPlugin.defaults.orbitControls = { wheelNeedsFocus: true };

type Level = 'log' | 'info' | 'warn' | 'error';

function format(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error)
    return value.stack?.includes(value.message) ? value.stack : `${value.name}: ${value.message}`;
  try {
    const seen = new WeakSet();
    return (
      JSON.stringify(value, (_k, v) => {
        if (typeof v === 'object' && v !== null) {
          if (seen.has(v)) return '[循環參照]';
          seen.add(v);
          if (v.isVector3 || v.isVector2)
            return `(${[v.x, v.y, v.z]
              .filter((n) => n !== undefined)
              .map((n: number) => +n.toFixed(3))
              .join(', ')})`;
        }
        if (typeof v === 'number' && !Number.isInteger(v)) return +v.toFixed(4);
        return v;
      }) ?? String(value)
    );
  } catch {
    return String(value);
  }
}

function send(level: Level, args: unknown[]): void {
  parent.postMessage({ type: 'log', level, text: args.map(format).join(' ') }, '*');
}

for (const level of ['log', 'info', 'warn', 'error'] as const) {
  const original = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    original(...args);
    send(level, args);
  };
}
window.addEventListener('error', (e) => send('error', [e.error ?? e.message]));
window.addEventListener('unhandledrejection', (e) => send('error', [e.reason]));

/** 把錯誤訊息裡的虛擬模組網址換成「範例」，比較好讀 */
function cleanStack(error: unknown): unknown {
  if (error instanceof Error && error.stack) {
    error.stack = error.stack.replace(/https?:\/\/[^\s)]+\/__run\/example-\d+\.ts(\?[^:\s)]*)?/g, '範例');
  }
  return error;
}

async function run(code: string): Promise<void> {
  let url: string;
  try {
    // 相對於上面的 <base>（文件網站的根目錄：npm run dev 時是 /doc/，範例檢查另開伺服器時是 /）
    const res = await fetch('__doc/run', { method: 'POST', body: code });
    if (!res.ok) throw new Error(res.status === 404 ? '' : await res.text());
    url = ((await res.json()) as { url: string }).url;
  } catch {
    send('error', [
      'TypeScript 範例需要文件的開發伺服器才能執行：在引擎目錄執行 npm run dev，再打開 http://localhost:5173/doc',
    ]);
    return;
  }
  try {
    await import(/* @vite-ignore */ url);
  } catch (error) {
    send('error', [cleanStack(error)]);
  }
}

window.addEventListener('message', (e) => {
  if (e.source !== parent) return;
  const msg = e.data as { type: string; code?: string };
  if (msg.type === 'run' && typeof msg.code === 'string') void run(msg.code);
});

// 測試用：不經過外層頁面直接執行（node doc/scripts/check-examples.mjs --run）
Object.assign(window, { __runExample: run });

parent.postMessage({ type: 'ready' }, '*');
