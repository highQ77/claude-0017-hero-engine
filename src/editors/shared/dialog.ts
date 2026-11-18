/**
 * 編輯器的對話框（取代瀏覽器原生的 alert／confirm／prompt，外觀和編輯器一致）：
 *
 *   await showAlert('已經有資料夾「forest」');
 *   if (!(await showConfirm('要刪除 forest.xml 嗎？', { ok: '刪除', danger: true }))) return;
 *   const name = await showPrompt('新場景的名稱', 'scene1', { validate: (v) => (v ? null : '請輸入名稱') });
 *
 * - Enter 確定、Esc 取消；點背景也是取消（警告視窗是關閉）
 * - 對話框開著時，鍵盤不會觸發編輯器的快速鍵
 * - 同時要求好幾個對話框時依序顯示
 * 樣式在 shared/theme.css 的「對話框」。
 */
import { h } from './dom';

interface DialogOptions {
  /** 標題（省略時不顯示） */
  title?: string;
  /** 確定按鈕的文字 */
  ok?: string;
  /** 取消按鈕的文字 */
  cancel?: string;
  /** 危險的動作（刪除、覆蓋）：確定按鈕用紅色 */
  danger?: boolean;
}

/** showPrompt 的選項 */
interface PromptOptions extends DialogOptions {
  /** 輸入框裡的淡色提示 */
  placeholder?: string;
  /** 檢查輸入：回傳錯誤訊息時顯示在框裡、不關閉；回傳 null 代表可以 */
  validate?: (value: string) => string | null;
}

let open = 0;
let queue: Promise<unknown> = Promise.resolve();
/** 目前對話框的鍵盤處理（沒有對話框時是 null） */
let activeKey: ((e: KeyboardEvent) => void) | null = null;

// 模組載入時就在 window 註冊（capture）：比編輯器自己的快速鍵更早收到，對話框開著時攔下所有按鍵
if (typeof window !== 'undefined')
  window.addEventListener(
    'keydown',
    (e) => {
      if (activeKey) activeKey(e);
    },
    true,
  );

/** 目前有沒有對話框開著（編輯器的快速鍵用它判斷要不要略過） */
export const dialogOpen = () => open > 0;

/** 依序顯示（前一個關掉才顯示下一個） */
function enqueue<T>(run: () => Promise<T>): Promise<T> {
  const next = queue.then(run, run);
  queue = next.catch(() => undefined);
  return next;
}

function show<T>(
  kind: 'alert' | 'confirm' | 'prompt',
  message: string,
  opts: PromptOptions,
  initial: string,
  result: (ok: boolean, value: string) => T,
): Promise<T> {
  return enqueue(
    () =>
      new Promise<T>((resolve) => {
        open++;
        const before = document.activeElement as HTMLElement | null;
        const backdrop = h('div', 'dlg-backdrop');
        const box = h('div', `dlg dlg-${kind}`);
        box.setAttribute('role', kind === 'alert' ? 'alertdialog' : 'dialog');
        box.setAttribute('aria-modal', 'true');
        if (opts.title) box.append(h('div', 'dlg-title', opts.title));
        const msg = h('div', 'dlg-message', message);
        box.append(msg);
        let input: HTMLInputElement | null = null;
        const error = h('div', 'dlg-error');
        if (kind === 'prompt') {
          input = h('input', 'dlg-input');
          input.type = 'text';
          input.value = initial;
          input.spellcheck = false;
          if (opts.placeholder) input.placeholder = opts.placeholder;
          input.addEventListener('input', () => {
            error.textContent = '';
            input!.classList.remove('invalid');
          });
          box.append(input, error);
        }
        const actions = h('div', 'dlg-actions');
        const okBtn = h('button', opts.danger ? 'danger-fill' : 'primary', opts.ok ?? '確定');
        if (kind !== 'alert') {
          const cancelBtn = h('button', '', opts.cancel ?? '取消');
          cancelBtn.addEventListener('click', () => finish(false));
          actions.append(cancelBtn);
        }
        actions.append(okBtn);
        box.append(actions);
        backdrop.append(box);
        document.body.append(backdrop);

        const finish = (ok: boolean) => {
          if (ok && input && opts.validate) {
            const problem = opts.validate(input.value);
            if (problem) {
              error.textContent = problem;
              input.classList.add('invalid');
              input.focus();
              input.select();
              return;
            }
          }
          backdrop.classList.add('closing');
          activeKey = null;
          setTimeout(() => backdrop.remove(), 120);
          open--;
          before?.focus?.();
          resolve(result(ok || kind === 'alert', input?.value ?? ''));
        };
        okBtn.addEventListener('click', () => finish(true));
        backdrop.addEventListener('pointerdown', (e) => {
          if (e.target === backdrop) finish(false);
        });
        // 在最外層攔下鍵盤：Enter 確定、Esc 取消，其他按鍵不交給編輯器的快速鍵
        const onKey = (e: KeyboardEvent) => {
          // 先攔下：不管後面發生什麼，編輯器的快速鍵都收不到
          e.stopImmediatePropagation();
          if (e.key === 'Escape') {
            e.preventDefault();
            finish(false);
          } else if (e.key === 'Enter' && !e.isComposing) {
            e.preventDefault();
            finish(true);
          } else if (e.key === 'Tab') {
            // 焦點留在對話框裡
            const items = [...box.querySelectorAll<HTMLElement>('input, button')];
            const i = items.indexOf(document.activeElement as HTMLElement);
            e.preventDefault();
            items[(i + (e.shiftKey ? -1 : 1) + items.length) % items.length]?.focus();
          } else if (!(e.target instanceof Node) || !box.contains(e.target)) e.preventDefault(); // 對話框外的按鍵不做事
        };
        activeKey = onKey;
        requestAnimationFrame(() => {
          if (input) {
            input.focus();
            input.select();
          } else okBtn.focus();
        });
      }),
  );
}

/** 訊息（只有「確定」） */
export function showAlert(message: string, opts: DialogOptions = {}): Promise<void> {
  return show('alert', message, opts, '', () => undefined);
}

/** 確認：按確定回傳 true，取消（或 Esc、點背景）回傳 false */
export function showConfirm(message: string, opts: DialogOptions = {}): Promise<boolean> {
  return show('confirm', message, opts, '', (ok) => ok);
}

/** 輸入文字：回傳輸入的文字，取消時是 null */
export function showPrompt(message: string, initial = '', opts: PromptOptions = {}): Promise<string | null> {
  return show('prompt', message, opts, initial, (ok, value) => (ok ? value : null));
}
