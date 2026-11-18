/**
 * 數字欄位：可以直接輸入，也可以在欄位上左右拖曳調整（Shift 慢、Alt 快），↑↓ 鍵加減。
 * 輸入框也接受簡單算式，例如 1.5*2、10/3。
 */
import { h, type Field, type OnChange } from './types';

export interface NumberOptions {
  step?: number;
  min?: number;
  max?: number;
  /** 小數位數（顯示用，預設依 step） */
  digits?: number;
  /** 顯示在左邊的小標籤（例如 X、Y、Z） */
  tag?: string;
  /** 小標籤的顏色 class（x、y、z） */
  tagClass?: string;
}

/** 算簡單算式：數字、+ - * /、括號（例如 1.5*2、-(3+1)/2）；看不懂時回傳 null */
export function evalNumber(text: string): number | null {
  const src = text.replace(/\s+/g, '');
  let i = 0;
  const num = (): number => {
    if (src[i] === '(') {
      i++;
      const v = sum();
      if (src[i++] !== ')') throw new Error();
      return v;
    }
    if (src[i] === '-' || src[i] === '+') return src[i++] === '-' ? -num() : num();
    const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(src.slice(i));
    if (!m) throw new Error();
    i += m[0].length;
    return Number(m[0]);
  };
  const product = (): number => {
    let v = num();
    while (src[i] === '*' || src[i] === '/') v = src[i++] === '*' ? v * num() : v / num();
    return v;
  };
  const sum = (): number => {
    let v = product();
    while (src[i] === '+' || src[i] === '-') v = src[i++] === '+' ? v + product() : v - product();
    return v;
  };
  try {
    if (src === '') return null;
    const v = sum();
    return i === src.length && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

const decimals = (step: number) => Math.max(0, Math.min(6, Math.ceil(-Math.log10(step))));

export function numberField(value: number, onChange: OnChange<number>, options: NumberOptions = {}): Field<number> {
  const step = options.step ?? 0.1;
  const digits = options.digits ?? decimals(step);
  const clamp = (v: number) => Math.min(options.max ?? Infinity, Math.max(options.min ?? -Infinity, v));
  const round = (v: number) => Number(v.toFixed(Math.max(digits, 3)));

  const wrap = h('div', 'f-num');
  if (options.tag) wrap.append(h('span', `f-tag ${options.tagClass ?? ''}`, options.tag));
  const input = h('input');
  input.type = 'text';
  input.inputMode = 'decimal';
  input.spellcheck = false;
  wrap.append(input);

  let current = value;
  const show = () => {
    input.value = Number.isFinite(current) ? String(Number(current.toFixed(digits))) : '';
  };
  show();

  const emit = (v: number, done: boolean) => {
    current = clamp(round(v));
    show();
    onChange(current, done);
  };

  // 拖曳調整：按下後移動超過 3px 才算拖曳，否則當作點進輸入框
  let drag: { x: number; start: number; moved: boolean } | null = null;
  input.addEventListener('pointerdown', (e) => {
    if (document.activeElement === input || e.button !== 0) return;
    e.preventDefault();
    drag = { x: e.clientX, start: current, moved: false };
    input.setPointerCapture(e.pointerId);
  });
  input.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    if (!drag.moved && Math.abs(dx) < 3) return;
    drag.moved = true;
    wrap.classList.add('dragging');
    const speed = e.shiftKey ? 0.1 : e.altKey ? 10 : 1;
    emit(drag.start + Math.round(dx / 2) * step * speed, false);
  });
  const endDrag = (e: PointerEvent) => {
    if (!drag) return;
    const moved = drag.moved;
    drag = null;
    wrap.classList.remove('dragging');
    if (input.hasPointerCapture(e.pointerId)) input.releasePointerCapture(e.pointerId);
    if (moved) onChange(current, true);
    else {
      input.focus();
      input.select();
    }
  };
  input.addEventListener('pointerup', endDrag);
  input.addEventListener('pointercancel', endDrag);

  const commitText = () => {
    const v = evalNumber(input.value);
    if (v === null) show();
    else if (v !== current) emit(v, true);
    else show();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      commitText();
      input.blur();
    } else if (e.key === 'Escape') {
      show();
      input.blur();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const speed = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
      emit(current + (e.key === 'ArrowUp' ? step : -step) * speed, true);
    }
  });
  input.addEventListener('blur', commitText);

  return {
    el: wrap,
    set(v) {
      current = v;
      if (document.activeElement !== input && !drag) show();
    },
  };
}

/** 三個數字（位置、旋轉、縮放） */
export function vec3Field(
  value: readonly number[],
  onChange: OnChange<[number, number, number]>,
  options: Omit<NumberOptions, 'tag' | 'tagClass'> = {},
): Field<readonly number[]> {
  const v: [number, number, number] = [value[0], value[1], value[2]];
  const wrap = h('div', 'f-vec3');
  const fields = (['X', 'Y', 'Z'] as const).map((tag, i) =>
    numberField(
      v[i],
      (n, done) => {
        v[i] = n;
        onChange([v[0], v[1], v[2]], done);
      },
      { ...options, tag, tagClass: tag.toLowerCase() },
    ),
  );
  wrap.append(...fields.map((f) => f.el));
  return {
    el: wrap,
    set(next) {
      for (let i = 0; i < 3; i++) {
        v[i] = next[i];
        fields[i].set(next[i]);
      }
    },
  };
}

/** 範圍：最小、最大兩個數字（一樣時代表固定值）；value 是一個數字或 [最小, 最大] */
export function rangeField(
  value: number | readonly number[],
  onChange: OnChange<[number, number]>,
  options: Omit<NumberOptions, 'tag' | 'tagClass'> = {},
): Field<number | readonly number[]> {
  const pair = (v: number | readonly number[]): [number, number] => (typeof v === 'number' ? [v, v] : [v[0], v[1]]);
  const v = pair(value);
  const wrap = h('div', 'f-range');
  const fields = (['最小', '最大'] as const).map((tag, i) =>
    numberField(
      v[i],
      (n, done) => {
        v[i] = n;
        // 最小不能大於最大：拖過頭時另一個跟著動
        if (v[0] > v[1]) {
          if (i === 0) v[1] = v[0];
          else v[0] = v[1];
          fields[1 - i].set(v[1 - i]);
        }
        onChange([v[0], v[1]], done);
      },
      { ...options, tag: tag === '最小' ? '↓' : '↑' },
    ),
  );
  fields[0].el.title = '最小';
  fields[1].el.title = '最大';
  wrap.append(...fields.map((f) => f.el));
  return {
    el: wrap,
    set(next) {
      const [a, b] = pair(next);
      v[0] = a;
      v[1] = b;
      fields[0].set(a);
      fields[1].set(b);
    },
  };
}

/** 秒數或不停止：輸入數字，空白或 ∞ 代表不停止（null） */
export function durationField(value: number | null, onChange: OnChange<number | null>): Field<number | null> {
  const input = h('input', 'f-text');
  input.type = 'text';
  input.inputMode = 'decimal';
  let current = value;
  const show = () => {
    input.value = current === null ? '∞' : String(current);
  };
  show();
  const commit = () => {
    const t = input.value.trim();
    const next = t === '' || t === '∞' || /^inf/i.test(t) ? null : evalNumber(t);
    if (next !== null && !(next >= 0)) return show();
    if (next !== current) {
      current = next;
      onChange(next, true);
    }
    show();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') {
      show();
      input.blur();
    }
  });
  input.addEventListener('blur', commit);
  return {
    el: input,
    set(v) {
      current = v;
      if (document.activeElement !== input) show();
    },
  };
}
