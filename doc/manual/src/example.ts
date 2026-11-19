/**
 * 範例區塊：可以編輯、高亮的程式碼 + 執行結果。
 *
 * 章節裡這樣寫（<script type="text/plain"> 裡的內容不用跳脫 < > &）：
 *
 *   <script type="text/plain" class="example" data-lang="ts" data-title="旋轉的方塊">
 *   import { Engine } from '@engine/core';
 *   ...
 *   </script>
 *
 * 屬性：
 * - data-lang：ts（預設）、xml、sh、text、canvas（UICanvas 繪圖範例，見 canvasExample.ts）
 * - data-title：標題
 * - data-height：預覽高度（像素），XML 預設 240、TypeScript 預設 320
 * - data-run="false"：只能編輯不能執行（程式片段）
 * - data-console：只看輸出（API 參考的範例）：不顯示預覽畫面，執行後只留下輸出
 * - data-readonly：不能編輯（例如終端機指令）
 *
 * 執行方式：
 * - XML：直接在頁面裡用 UI2D 排版顯示，邊打邊更新；onClick 等事件會記錄到下方的輸出。
 * - canvas：在頁面裡用共用的 <UICanvas> 執行，旁邊是原生 Canvas 2D 的對照（data-native="false" 時沒有）。
 * - TypeScript：放進預覽框（iframe）執行，和遊戲專案一樣可以 import '@engine/...'、'three'。
 *   同一時間只執行一個 TypeScript 範例（WebGL 畫面數量有限），執行另一個時前一個會停止。
 */
import { CanvasExample } from './canvasExample';
import { CodeEditor } from './editor';
import type { Lang } from './highlight';
import { UI2D, uiXml, type UIEvent } from '@engine/ui2d';
import exampleXml from 'virtual:doc-ui-xml';

/**
 * 範例的圖片、內嵌 XML 的位置（doc/public/ui）：相對於手冊頁面算出的路徑（不含網域；引擎的路徑合併只處理路徑），
 * 打包後放在網站的任何路徑、或直接用 file:// 打開都找得到。
 */
const XML_BASE = new URL('../ui/', location.href).pathname;

// 範例內嵌、匯入的 XML（<UIImport src="theme.xml">、<UIComponent src="coin-badge.xml">）直接打包進手冊：
// 用 file:// 打開時瀏覽器不允許讀取其他檔案（圖片可以），先登記內容就不用讀檔
// （內容由 doc/vite.config.ts 的虛擬模組提供：Vite 不允許直接 import public/ 裡的檔案）
uiXml.register(
  Object.fromEntries(Object.entries(exampleXml).map(([name, text]) => [`${XML_BASE}${name}`, async () => text])),
);

/** 去掉共同的縮排與前後空行 */
export function dedent(text: string): string {
  const lines = text.replace(/\t/g, '  ').split('\n');
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => /^ */.exec(l)![0].length));
  return lines.map((l) => l.slice(Number.isFinite(indent) ? indent : 0)).join('\n');
}

function button(label: string, title: string, cls = ''): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `ex-btn ${cls}`.trim();
  b.innerHTML = label;
  b.title = title;
  return b;
}

/** 範例的種類：程式語言，加上 UICanvas 繪圖範例（TypeScript 高亮、在頁面裡執行） */
type ExampleLang = Lang | 'canvas';

const LANG_LABEL: Record<ExampleLang, string> = {
  ts: 'TypeScript',
  xml: 'XML 介面',
  sh: '終端機',
  text: '文字',
  canvas: 'UICanvas',
};

/** 目前在執行的 TypeScript 範例 */
let runningTs: Example | null = null;

export class Example {
  readonly element: HTMLElement;
  private readonly editor: CodeEditor;
  private readonly original: string;
  private readonly lang: ExampleLang;
  private readonly runnable: boolean;
  private readonly height: number;
  /** 只看輸出（不顯示預覽畫面） */
  private readonly consoleOnly: boolean;
  private readonly resetBtn: HTMLButtonElement;
  private readonly runBtn: HTMLButtonElement | null = null;
  private readonly stopBtn: HTMLButtonElement | null = null;
  private readonly output: HTMLElement;
  private readonly stage: HTMLElement;
  private readonly log: HTMLElement;
  private frame: HTMLIFrameElement | null = null;
  private canvas: CanvasExample | null = null;
  private ui: UI2D | null = null;
  private uiCreating: Promise<UI2D> | null = null;
  private xmlTimer = 0;
  private xmlVisible = false;
  private readonly sizeInfo = document.createElement('span');

  constructor(source: HTMLElement) {
    this.lang = (source.dataset.lang as ExampleLang) || 'ts';
    this.original = dedent(source.textContent ?? '');
    const readOnly = source.hasAttribute('data-readonly');
    this.runnable =
      source.dataset.run !== 'false' &&
      !readOnly &&
      (this.lang === 'ts' || this.lang === 'xml' || this.lang === 'canvas');
    this.consoleOnly = source.hasAttribute('data-console');
    this.height = this.consoleOnly ? 44 : Number(source.dataset.height) || (this.lang === 'xml' ? 240 : 320);

    const el = (this.element = document.createElement('figure'));
    el.className = `example lang-${this.lang}${readOnly ? ' readonly' : ''}`;

    // ── 標題列 ──
    const bar = document.createElement('figcaption');
    bar.className = 'ex-bar';
    const title = document.createElement('span');
    title.className = 'ex-title';
    title.textContent = source.dataset.title ?? '';
    const lang = document.createElement('span');
    lang.className = 'ex-lang';
    lang.textContent = LANG_LABEL[this.lang];
    const tools = document.createElement('span');
    tools.className = 'ex-tools';
    this.resetBtn = button('還原', '還原成原本的範例', 'ex-reset');
    this.resetBtn.hidden = true;
    this.resetBtn.addEventListener('click', () => {
      this.editor.setValue(this.original);
      if (this.lang === 'ts' && this.frame) this.run();
      if (this.canvas) void this.canvas.run();
    });
    const copyBtn = button('複製', '複製程式碼');
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(this.editor.value);
        copyBtn.textContent = '已複製';
      } catch {
        copyBtn.textContent = '複製失敗';
      }
      setTimeout(() => (copyBtn.textContent = '複製'), 1200);
    });
    tools.append(this.resetBtn, copyBtn);
    if (this.runnable && this.lang === 'ts') {
      this.stopBtn = button('■ 停止', '停止執行', 'ex-stop');
      this.stopBtn.hidden = true;
      this.stopBtn.addEventListener('click', () => this.stop());
      this.runBtn = button('▶ 執行', '執行（Ctrl 或 ⌘ + Enter）', 'ex-run');
      this.runBtn.addEventListener('click', () => this.run());
      tools.append(this.stopBtn, this.runBtn);
    }
    if (this.runnable && this.lang === 'canvas') {
      const run = button('▶ 執行', '執行（Ctrl 或 ⌘ + Enter）', 'ex-run');
      run.addEventListener('click', () => void this.canvas?.run());
      tools.append(run);
    }
    bar.append(lang, title, tools);

    // ── 編輯器 ──
    this.editor = new CodeEditor(this.original, {
      lang: this.lang === 'canvas' ? 'ts' : this.lang,
      readOnly,
      onChange: (code) => {
        this.resetBtn.hidden = code === this.original;
        if (this.lang === 'xml' && this.runnable) this.scheduleXml();
        this.canvas?.schedule();
      },
      onRun: () => {
        if (!this.runnable) return;
        if (this.lang === 'xml') void this.renderXml();
        else if (this.canvas) void this.canvas.run();
        else this.run();
      },
    });

    // ── 執行結果 ──
    this.output = document.createElement('div');
    this.output.className = 'ex-output';
    this.stage = document.createElement('div');
    this.stage.className = 'ex-stage';
    this.stage.style.height = `${this.height}px`;
    this.log = document.createElement('pre');
    this.log.className = 'ex-log';
    this.log.hidden = true;
    this.output.append(this.stage, this.log);

    el.append(bar, this.editor.element);
    if (this.runnable) {
      el.append(this.output);
      if (this.lang === 'xml') this.setupXml();
      else if (this.lang === 'canvas') this.setupCanvas(source.dataset.native !== 'false');
      else this.showPlaceholder();
    }
  }

  // ───────── 輸出 ─────────

  private clearLog(): void {
    this.log.textContent = '';
    this.log.hidden = true;
  }

  private print(level: string, text: string): void {
    const line = document.createElement('div');
    line.className = `log-${level}`;
    line.textContent = text;
    this.log.append(line);
    while (this.log.childElementCount > 200) this.log.firstElementChild!.remove();
    this.log.hidden = false;
    this.log.scrollTop = this.log.scrollHeight;
  }

  // ───────── TypeScript：預覽框 ─────────

  private showPlaceholder(): void {
    this.stage.replaceChildren();
    const ph = document.createElement('button');
    ph.type = 'button';
    ph.className = 'ex-placeholder';
    ph.innerHTML = '<span class="ex-play">▶</span><span>按一下執行範例</span>';
    ph.addEventListener('click', () => this.run());
    this.stage.append(ph);
  }

  run(): void {
    if (runningTs && runningTs !== this) runningTs.stop();
    runningTs = this;
    this.clearLog();
    this.frame?.remove();
    const frame = (this.frame = document.createElement('iframe'));
    frame.className = 'ex-frame';
    frame.title = '範例執行結果';
    frame.src = new URL('runner.html', location.href).href;
    const code = this.editor.value;
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.contentWindow) return;
      const msg = e.data as { type: string; level?: string; text?: string };
      if (msg.type === 'ready') frame.contentWindow!.postMessage({ type: 'run', code }, '*');
      else if (msg.type === 'log') this.print(msg.level ?? 'log', msg.text ?? '');
    };
    window.addEventListener('message', onMessage);
    frame.addEventListener('load', () => {
      // 點預覽框才能接收鍵盤：先幫忙聚焦
      frame.contentWindow?.focus();
    });
    (frame as HTMLIFrameElement & { _off?: () => void })._off = () => window.removeEventListener('message', onMessage);
    this.stage.replaceChildren(frame);
    // 只看輸出：預覽框照常執行，但不佔空間
    if (this.consoleOnly) {
      this.stage.classList.add('ex-stage-hidden');
    }
    this.runBtn!.innerHTML = '↻ 重新執行';
    this.stopBtn!.hidden = false;
    this.element.classList.add('running');
  }

  stop(): void {
    if (this.frame) {
      (this.frame as HTMLIFrameElement & { _off?: () => void })._off?.();
      this.frame.remove();
      this.frame = null;
    }
    if (runningTs === this) runningTs = null;
    if (this.runBtn) this.runBtn.innerHTML = '▶ 執行';
    if (this.stopBtn) this.stopBtn.hidden = true;
    this.element.classList.remove('running');
    this.stage.classList.remove('ex-stage-hidden');
    if (this.runnable && this.lang === 'ts') this.showPlaceholder();
  }

  // ───────── UICanvas：頁面內執行 ─────────

  private setupCanvas(native: boolean): void {
    this.stage.classList.add('ex-stage-canvas');
    this.stage.style.height = '';
    this.canvas = new CanvasExample(
      () => this.editor.value,
      (level, text) => this.print(level, text),
      () => this.clearLog(),
      native,
    );
    this.stage.append(this.canvas.element);
    // 捲到畫面附近才執行（一頁有很多範例）
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && this.canvas && !this.canvas.ran) {
          io.disconnect();
          void this.canvas.run();
        }
      },
      { rootMargin: '300px 0px' },
    );
    io.observe(this.element);
  }

  /** 離開章節：停止執行、釋放介面 */
  dispose(): void {
    this.canvas?.dispose();
    this.canvas = null;
    clearTimeout(this.xmlTimer);
    if (this.frame) this.stop();
    this.xmlVisible = true; // 還沒建立的不要再建立
    void this.uiCreating?.then((ui) => ui.destroy());
    this.ui = null;
  }

  // ───────── XML：頁面內即時預覽 ─────────

  private setupXml(): void {
    this.stage.classList.add('ex-stage-xml');
    // 寬度切換：看看不同螢幕寬度（RWD 斷點）的排版
    const sizes = document.createElement('div');
    sizes.className = 'ex-sizes';
    const options: [string, string][] = [
      ['全寬', ''],
      ['平板 768', '768px'],
      ['手機 375', '375px'],
    ];
    for (const [label, width] of options) {
      const b = button(label, `預覽寬度：${label}`);
      if (!width) b.classList.add('active');
      b.addEventListener('click', () => {
        sizes.querySelectorAll('.active').forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        this.stage.style.maxWidth = width;
      });
      sizes.append(b);
    }
    this.sizeInfo.className = 'ex-size-info';
    sizes.append(this.sizeInfo);
    this.output.prepend(sizes);
    new ResizeObserver(() => this.updateSizeInfo()).observe(this.stage);

    // 捲到畫面附近才建立介面（一頁可能有很多範例）
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !this.xmlVisible) {
          this.xmlVisible = true;
          io.disconnect();
          this.renderXml();
        }
      },
      { rootMargin: '400px 0px' },
    );
    io.observe(this.element);
  }

  private scheduleXml(): void {
    clearTimeout(this.xmlTimer);
    this.xmlTimer = window.setTimeout(() => this.renderXml(), 250);
  }

  /** 預覽尺寸與目前套用的斷點（排版完成後更新，斷點才是最新的） */
  private updateSizeInfo(): void {
    const bp = this.ui?.breakpoint.join(' ') ?? '';
    this.sizeInfo.textContent = `${Math.round(this.stage.clientWidth)} × ${Math.round(this.stage.clientHeight)}　斷點：${bp || '無'}`;
  }

  private async getUI(): Promise<UI2D> {
    if (this.ui) return this.ui;
    this.uiCreating ??= UI2D.create({ container: this.stage }).then((ui) => {
      this.ui = ui;
      ui.onLayout(() => this.updateSizeInfo());
      return ui;
    });
    return this.uiCreating;
  }

  private async renderXml(): Promise<void> {
    const xml = this.editor.value;
    try {
      const ui = await this.getUI();
      // XML 裡用到的事件處理函式：都接到輸出區，點了就知道觸發了什麼
      for (const m of xml.matchAll(/\bon[A-Z]\w*\s*=\s*"([^"]+)"/g)) {
        const name = m[1];
        if (ui.handlers[name]) continue;
        ui.setHandler(name, (e: UIEvent) => {
          const detail: string[] = [];
          if (e.value !== undefined) detail.push(`value=${JSON.stringify(e.value)}`);
          if (e.checked !== undefined) detail.push(`checked=${e.checked}`);
          if (e.index !== undefined) detail.push(`index=${e.index}`);
          if (e.item !== undefined) detail.push(`item=${JSON.stringify(e.item)}`);
          const who = e.target ? `${e.target.type}${e.target.id ? `#${e.target.id}` : ''}` : '';
          this.print('event', `${e.type} → ${name}(${detail.join(', ')})　${who}`);
        });
      }
      await ui.preloadComponents(xml, XML_BASE);
      ui.loadString(xml, XML_BASE);
      this.element.classList.remove('has-error');
      this.log.querySelectorAll('.log-error').forEach((l) => l.remove());
      if (!this.log.childElementCount) this.log.hidden = true;
    } catch (error) {
      this.element.classList.add('has-error');
      this.log.querySelectorAll('.log-error').forEach((l) => l.remove());
      this.print('error', (error as Error).message);
    }
  }
}

/** 把頁面裡所有 <script type="text/plain" class="example"> 換成範例區塊 */
export function mountExamples(root: HTMLElement): Example[] {
  const list: Example[] = [];
  for (const source of root.querySelectorAll<HTMLElement>('script.example')) {
    const ex = new Example(source);
    source.replaceWith(ex.element);
    list.push(ex);
  }
  return list;
}

/** 換章節時停止正在執行的範例 */
export function stopRunning(): void {
  runningTs?.stop();
}
