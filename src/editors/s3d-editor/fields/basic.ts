/** 文字、勾選、下拉選單、顏色欄位 */
import { h, type Field, type OnChange } from './types';

let nextListId = 1;

/** 文字（按 Enter 或離開欄位時送出）；suggestions 會在輸入時顯示建議清單 */
export function textField(
  value: string,
  onChange: OnChange<string>,
  placeholder = '',
  suggestions?: () => readonly string[],
): Field<string> {
  const input = h('input', 'f-text');
  input.type = 'text';
  input.value = value;
  input.placeholder = placeholder;
  if (suggestions) {
    const list = h('datalist');
    list.id = `f-list-${nextListId++}`;
    input.setAttribute('list', list.id);
    const fill = () => list.replaceChildren(...suggestions().map((s) => new Option(s, s)));
    input.addEventListener('focus', fill);
    fill();
    const wrap = h('div', 'f-text-wrap');
    wrap.append(input, list);
    // datalist 選了建議之後馬上送出
    input.addEventListener('input', (e) => {
      if (!(e instanceof InputEvent) || e.inputType === 'insertReplacementText') input.blur();
    });
    return withInput(wrap, input, value, onChange);
  }
  return withInput(input, input, value, onChange);
}

function withInput(el: HTMLElement, input: HTMLInputElement, value: string, onChange: OnChange<string>): Field<string> {
  let current = value;
  const commit = () => {
    if (input.value !== current) {
      current = input.value;
      onChange(current, true);
    }
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') {
      input.value = current;
      input.blur();
    }
  });
  input.addEventListener('blur', commit);
  return {
    el,
    set(v) {
      current = v;
      if (document.activeElement !== input) input.value = v;
    },
  };
}

/** 三個勾選（例如剛體可旋轉的軸） */
export function check3Field(
  value: readonly boolean[],
  onChange: OnChange<[boolean, boolean, boolean]>,
): Field<readonly boolean[]> {
  const v: [boolean, boolean, boolean] = [value[0], value[1], value[2]];
  const wrap = h('div', 'f-check3');
  const boxes = (['X', 'Y', 'Z'] as const).map((tag, i) =>
    checkField(
      v[i],
      (b) => {
        v[i] = b;
        onChange([v[0], v[1], v[2]], true);
      },
      tag,
    ),
  );
  wrap.append(...boxes.map((b) => b.el));
  return {
    el: wrap,
    set(next) {
      for (let i = 0; i < 3; i++) {
        v[i] = next[i];
        boxes[i].set(next[i]);
      }
    },
  };
}

/** 勾選 */
export function checkField(value: boolean, onChange: OnChange<boolean>, label = ''): Field<boolean> {
  const wrap = h('label', 'f-check');
  const input = h('input');
  input.type = 'checkbox';
  input.checked = value;
  input.addEventListener('change', () => onChange(input.checked, true));
  wrap.append(input);
  if (label) wrap.append(h('span', '', label));
  return {
    el: wrap,
    set(v) {
      input.checked = v;
    },
  };
}

/** 下拉選單：options 是 [值, 顯示文字] */
export function selectField<T extends string>(
  value: T,
  options: readonly (readonly [T, string])[],
  onChange: OnChange<T>,
): Field<T> {
  const select = h('select', 'f-select');
  for (const [v, label] of options) select.add(new Option(label, v));
  select.value = value;
  select.addEventListener('change', () => onChange(select.value as T, true));
  return {
    el: select,
    set(v) {
      select.value = v;
    },
  };
}

/** 顏色：色塊（拖曳時即時更新）＋ 十六進位文字 */
export function colorField(value: string, onChange: OnChange<string>): Field<string> {
  const wrap = h('div', 'f-color');
  const picker = h('input');
  picker.type = 'color';
  const text = h('input', 'f-hex');
  text.type = 'text';
  text.spellcheck = false;
  const show = (v: string) => {
    picker.value = /^#[0-9a-f]{6}$/i.test(v) ? v : '#000000';
    if (document.activeElement !== text) text.value = v;
  };
  show(value);
  picker.addEventListener('input', () => {
    text.value = picker.value;
    onChange(picker.value, false);
  });
  picker.addEventListener('change', () => onChange(picker.value, true));
  const commit = () => {
    let v = text.value.trim().toLowerCase();
    if (/^[0-9a-f]{6}$/.test(v)) v = `#${v}`;
    if (/^#[0-9a-f]{3}$/.test(v)) v = `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
    if (/^#[0-9a-f]{6}$/.test(v)) {
      show(v);
      onChange(v, true);
    } else text.value = picker.value;
  };
  text.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') text.blur();
  });
  text.addEventListener('blur', commit);
  wrap.append(picker, text);
  return { el: wrap, set: show };
}

/** JSON（進階編輯）：離開欄位時檢查，格式錯誤顯示紅框、不送出 */
export function jsonField(value: unknown, onChange: OnChange<unknown>): Field<unknown> {
  const area = h('textarea', 'f-json');
  area.spellcheck = false;
  let current = JSON.stringify(value, null, 2);
  area.value = current;
  const fit = () => {
    area.style.height = 'auto';
    area.style.height = `${Math.min(320, area.scrollHeight + 2)}px`;
  };
  area.addEventListener('input', () => {
    area.classList.remove('error');
    fit();
  });
  area.addEventListener('blur', () => {
    if (area.value === current) return;
    try {
      const parsed = JSON.parse(area.value) as unknown;
      current = area.value;
      area.title = '';
      onChange(parsed, true);
    } catch (error) {
      area.classList.add('error');
      area.title = (error as Error).message;
    }
  });
  area.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      area.value = current;
      area.classList.remove('error');
      area.blur();
    }
  });
  requestAnimationFrame(fit);
  return {
    el: area,
    set(v) {
      if (document.activeElement === area) return;
      current = JSON.stringify(v, null, 2);
      area.value = current;
      area.classList.remove('error');
      fit();
    },
  };
}
