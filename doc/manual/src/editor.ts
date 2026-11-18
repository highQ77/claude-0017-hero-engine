/**
 * 輕量的程式碼編輯器：透明的 textarea 疊在高亮後的 <pre> 上面（兩者放在同一個格子，大小一致）。
 *
 * - Tab／Shift+Tab：縮排、取消縮排（可選取多行）
 * - Enter：保留上一行的縮排，在 { ( [ 或開始標籤後面多縮一層
 * - Ctrl／⌘ + Enter：執行（onRun）
 * - Esc：離開編輯器（之後 Tab 可以移到下一個元件）
 * 修改都用 insertText，瀏覽器內建的復原（⌘Z）可以正常使用。
 */
import { highlight, type Lang } from './highlight';

const INDENT = '  ';

export interface CodeEditorOptions {
  lang: Lang;
  readOnly?: boolean;
  onChange?: (code: string) => void;
  onRun?: () => void;
}

export class CodeEditor {
  readonly element: HTMLDivElement;
  private readonly textarea: HTMLTextAreaElement;
  private readonly pre: HTMLPreElement;
  private readonly gutter: HTMLDivElement;
  private lineCount = 0;

  constructor(
    code: string,
    private readonly options: CodeEditorOptions,
  ) {
    this.element = document.createElement('div');
    this.element.className = 'code-editor';
    this.element.dataset.lang = options.lang;

    this.gutter = document.createElement('div');
    this.gutter.className = 'code-gutter';
    this.gutter.setAttribute('aria-hidden', 'true');

    const body = document.createElement('div');
    body.className = 'code-body';
    this.pre = document.createElement('pre');
    this.pre.className = 'code-hl';
    this.pre.setAttribute('aria-hidden', 'true');
    this.textarea = document.createElement('textarea');
    this.textarea.className = 'code-input';
    this.textarea.spellcheck = false;
    this.textarea.autocapitalize = 'off';
    this.textarea.setAttribute('autocomplete', 'off');
    this.textarea.setAttribute('autocorrect', 'off');
    this.textarea.wrap = 'off';
    this.textarea.readOnly = !!options.readOnly;
    this.textarea.setAttribute(
      'aria-label',
      options.readOnly ? '程式碼' : '範例程式碼（可以編輯，Ctrl 或 ⌘ + Enter 執行）',
    );
    this.textarea.value = code;
    body.append(this.pre, this.textarea);
    this.element.append(this.gutter, body);

    this.textarea.addEventListener('input', () => {
      this.render();
      this.options.onChange?.(this.value);
    });
    this.textarea.addEventListener('keydown', (e) => this.onKey(e));
    this.render();
  }

  get value(): string {
    return this.textarea.value;
  }

  /** 換掉全部內容（例如「還原」）；用 insertText 讓這個動作也能復原 */
  setValue(code: string): void {
    this.textarea.focus();
    this.textarea.select();
    if (!document.execCommand('insertText', false, code)) this.textarea.value = code;
    this.textarea.setSelectionRange(0, 0);
    this.render();
    this.options.onChange?.(this.value);
  }

  focus(): void {
    this.textarea.focus();
  }

  private render(): void {
    const code = this.textarea.value;
    // 結尾是換行時補一個空白，<pre> 才會多出那一行（和 textarea 的高度一致）
    this.pre.innerHTML = highlight(code, this.options.lang) + (code.endsWith('\n') || code === '' ? ' ' : '');
    const lines = code.split('\n').length;
    if (lines !== this.lineCount) {
      this.lineCount = lines;
      this.gutter.textContent = Array.from({ length: lines }, (_, i) => i + 1).join('\n');
    }
  }

  /** 插入文字（保留復原紀錄） */
  private insert(text: string): void {
    if (!document.execCommand('insertText', false, text)) {
      const ta = this.textarea;
      ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, 'end');
      ta.dispatchEvent(new Event('input'));
    }
  }

  private onKey(e: KeyboardEvent): void {
    const ta = this.textarea;
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      this.options.onRun?.();
      return;
    }
    if (e.key === 'Escape') {
      ta.blur();
      return;
    }
    if (ta.readOnly || e.isComposing) return;

    if (e.key === 'Tab') {
      e.preventDefault();
      const { selectionStart: start, selectionEnd: end, value } = ta;
      const multiLine = value.slice(start, end).includes('\n');
      if (!multiLine && !e.shiftKey) {
        this.insert(INDENT);
        return;
      }
      // 選取的每一行一起縮排／取消縮排
      const lineStart = value.lastIndexOf('\n', start - 1) + 1;
      const block = value.slice(lineStart, end);
      const changed = e.shiftKey ? block.replace(/^( {1,2}|\t)/gm, '') : block.replace(/^(?=.)/gm, INDENT);
      if (changed === block) return;
      ta.setSelectionRange(lineStart, end);
      this.insert(changed);
      ta.setSelectionRange(lineStart, lineStart + changed.length);
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
      const { selectionStart: start, value } = ta;
      const lineStart = value.lastIndexOf('\n', start - 1) + 1;
      const line = value.slice(lineStart, start);
      const indent = /^\s*/.exec(line)![0];
      const before = line.trimEnd();
      const next = value[ta.selectionEnd] ?? '';
      const opens =
        /[{([]$/.test(before) ||
        (this.options.lang === 'xml' && /<[A-Za-z][^<>]*[^/]>$/.test(before) && !/<\//.test(before));
      e.preventDefault();
      if (opens && /^[})\]<]/.test(next)) {
        // 在成對的括號中間按 Enter：括號拆成兩行，游標放在中間那行
        this.insert(`\n${indent}${INDENT}\n${indent}`);
        const pos = ta.selectionStart - indent.length - 1;
        ta.setSelectionRange(pos, pos);
      } else {
        this.insert(`\n${indent}${opens ? INDENT : ''}`);
      }
      return;
    }

    // 在一行只有縮排時打結尾括號：自動退一層
    if ((e.key === '}' || e.key === ')' || e.key === ']') && ta.selectionStart === ta.selectionEnd) {
      const { selectionStart: start, value } = ta;
      const lineStart = value.lastIndexOf('\n', start - 1) + 1;
      const line = value.slice(lineStart, start);
      if (line.length >= INDENT.length && /^\s+$/.test(line)) {
        e.preventDefault();
        ta.setSelectionRange(start - INDENT.length, start);
        this.insert(e.key);
      }
    }
  }
}
