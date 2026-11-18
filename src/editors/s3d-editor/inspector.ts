/**
 * 屬性面板：顯示選取實體的名稱與元件，修改透過 SceneDoc.commit（可以復原）。
 *
 * 資料變動時：元件組成沒變就只更新欄位的值（不重建，輸入中的欄位不會被打斷）；
 * 組成變了（加減元件、切換 JSON 編輯、網格換形狀）才重建。
 */
import type { SceneCodecs, SceneFileEntity } from '../../scene';
import type { SceneDoc } from './doc';
import type { ScriptInfo } from './files';
import { overriddenOf, revertOverride, splitInnerId, writeComponent, writeName } from './prefabs';
import {
  check3Field,
  checkField,
  durationField,
  rangeField,
  colorField,
  h,
  jsonField,
  numberField,
  row,
  selectField,
  textField,
  vec3Field,
  type Field,
} from './fields';
import { meshFields } from './mesh';
import {
  NEW_COMPONENT,
  componentLabel,
  defaultOf,
  schemaOf,
  toFileValue,
  withDefaults,
  type ComponentSchema,
  type FieldDef,
  type SuggestKind,
} from './schemas';

type Json = Record<string, unknown>;

/** 屬性面板需要編輯器提供的東西 */
export interface InspectorHooks {
  /** 實體目前的內容（預製物件內部的實體是展開後、套用覆蓋後的內容） */
  entity(id: string): SceneFileEntity | undefined;
  /** 沒有選取時顯示的內容（場景設定） */
  renderEmpty(el: HTMLElement): void;
  /** 元件存讀規則（「加入元件」列出所有已登記的元件） */
  codecs(): SceneCodecs;
  /** 文字欄位的建議清單：models（模型網址）、sounds（音效網址）、clips（這個實體模型裡的動畫片段） */
  suggest(kind: SuggestKind, id: string): readonly string[];
  /** 預製物件實例的按鈕 */
  openPrefab(path: string): void;
  unpackPrefab(id: string): void;
  /** 存成預製物件 */
  makePrefab(id: string): void;
  /** 碰撞體「符合網格大小」 */
  fitCollider(id: string): void;
  /** 專案裡的腳本（「加入腳本」的選單；還沒讀到時是空陣列） */
  scripts(): readonly ScriptInfo[];
  /** 專案裡的節點圖檔網址（網格材質選「節點圖」用） */
  shaderGraphs(): readonly string[];
  /** 在著色器編輯器打開節點圖檔（空字串：打開編輯器、新增一個） */
  openShader(url: string): void;
}

interface Section {
  name: string;
  /** 用新資料更新欄位；回傳 false 代表要重建 */
  update(data: unknown): boolean;
}

export class Inspector {
  private id: string | null = null;
  private signature = '';
  private sections: Section[] = [];
  private nameField: Field<string> | null = null;
  /** 切換成 JSON 編輯的元件（實體 id:元件名稱） */
  private readonly rawMode = new Set<string>();

  constructor(
    private readonly el: HTMLElement,
    private readonly doc: SceneDoc,
    private readonly hooks: InspectorHooks,
  ) {}

  /** 選了多個時的 id（顯示摘要） */
  private many: string[] = [];

  /** 顯示選取的實體：沒有選取時顯示場景設定，多個時顯示摘要，一個時顯示它的屬性 */
  show(ids: readonly string[]): void {
    const id = ids.length === 1 ? ids[0] : null;
    if (id !== this.id || ids.length !== this.many.length) this.signature = '';
    this.id = id;
    this.many = ids.length > 1 ? [...ids] : [];
    this.refresh();
  }

  /** 資料變動後更新 */
  refresh(): void {
    if (this.many.length) return this.showMany();
    const entity = this.id !== null ? this.hooks.entity(this.id) : undefined;
    if (!entity) {
      this.id = null;
      this.signature = '';
      this.sections = [];
      this.hooks.renderEmpty(this.el);
      return;
    }
    const sig = this.signatureOf(entity);
    if (sig === this.signature && this.updateValues(entity)) return;
    this.build(entity);
  }

  /** 拖曳控制器時即時顯示 Transform（還沒 commit） */
  live(component: string, data: unknown): void {
    this.sections.find((s) => s.name === component)?.update(data);
  }

  /** 選了多個：列出名稱與共同的操作說明 */
  private showMany(): void {
    this.sections = [];
    this.signature = '';
    const list = h('div', 'insp-many');
    list.append(h('div', 'insp-many-title', `已選取 ${this.many.length} 個物件`));
    for (const id of this.many) {
      const e = this.hooks.entity(id);
      list.append(h('div', 'insp-many-row', `${e?.name || '（沒有名稱）'}　${id}`));
    }
    list.append(
      h(
        'div',
        'comp-note',
        '可以一起移動／旋轉／縮放（控制器在最後選的物件上）、複製（Cmd/Ctrl+D）、刪除（Delete）。要改屬性請只選一個。',
      ),
    );
    this.el.replaceChildren(list);
  }

  private signatureOf(e: SceneFileEntity): string {
    const ov = overriddenOf(this.doc.toFile(), e.id);
    return [
      e.id,
      [...ov.components].join(','),
      ...Object.keys(e.components ?? {}).map((n) => `${n}${this.rawMode.has(`${e.id}:${n}`) ? '*' : ''}`),
    ].join('|');
  }

  private updateValues(e: SceneFileEntity): boolean {
    this.nameField?.set(e.name ?? '');
    for (const s of this.sections) if (!s.update(e.components?.[s.name])) return false;
    return true;
  }

  private build(e: SceneFileEntity): void {
    const id = e.id;
    this.signature = this.signatureOf(e);
    this.sections = [];
    const parts: HTMLElement[] = [];

    // 名稱與 id
    const head = h('div', 'insp-head');
    this.nameField = textField(
      e.name ?? '',
      (v) => this.doc.commit('改名', (d) => writeName(d, id, v)),
      '（沒有名稱）',
    );
    const [instanceId, inner] = splitInnerId(id);
    head.append(
      row('名稱', this.nameField.el),
      row('id', h('code', 'insp-id', id), '場景檔裡的編號（程式用 spawned.entities.get(id) 取得）'),
    );
    const action = (label: string, title: string, fn: () => void) => {
      const b = h('button', 'small-btn', label);
      b.title = title;
      b.addEventListener('click', fn);
      return b;
    };
    if (inner !== null) {
      // 預製物件內部的實體：改的東西記在實例上
      const instance = this.doc.get(instanceId);
      const box = h('div', 'insp-prefab');
      box.append(
        h('span', 'insp-prefab-icon', '📦'),
        h('code', 'insp-prefab-path', `${instance?.name || instanceId} 裡的 ${inner}`),
      );
      const ov = overriddenOf(this.doc.toFile(), id);
      if (ov.name || ov.components.size)
        box.append(
          action('全部還原', '清掉這個物件所有的覆蓋，回到預製物件裡的樣子', () =>
            this.doc.commit('還原覆蓋', (d) => revertOverride(d, id)),
          ),
        );
      head.append(
        box,
        h('div', 'comp-note', '這是預製物件裡的物件：改的屬性只影響這個實例（標 ● 的是改過的，↺ 還原）。'),
      );
    } else if (e.prefab) {
      const path = e.prefab;
      const box = h('div', 'insp-prefab');
      box.append(
        h('span', 'insp-prefab-icon', '📦'),
        h('code', 'insp-prefab-path', path),
        action('開啟', '編輯這個預製物件（改了之後，所有用到它的地方都會跟著變）', () => this.hooks.openPrefab(path)),
        action('解除連結', '換成預製物件的內容，變成一般的物件（之後改預製物件不會影響這裡）', () =>
          this.hooks.unpackPrefab(id),
        ),
      );
      head.append(box, h('div', 'comp-note', '下面的元件會覆蓋預製物件根節點的同名元件（通常只有位置）'));
    } else {
      const actions = h('div', 'insp-actions');
      actions.append(
        action('存成預製物件', '把這個物件（連同子物件）存成預製物件，可以重複放置', () => this.hooks.makePrefab(id)),
      );
      head.append(actions);
    }
    parts.push(head);

    for (const [name, data] of Object.entries(e.components ?? {})) parts.push(this.section(id, name, data));

    // 加入元件
    const present = new Set(Object.keys(e.components ?? {}));
    const available = this.hooks
      .codecs()
      .all()
      .map((c) => c.type.name)
      .filter((n) => !present.has(n));
    if (available.length) {
      const add = h('select', 'insp-add');
      add.add(new Option('＋ 加入元件…', ''));
      for (const n of available) add.add(new Option(`${componentLabel(n)}（${n}）`, n));
      add.addEventListener('change', () => {
        const n = add.value;
        if (n) this.doc.commit(`加入${componentLabel(n)}`, (d) => writeComponent(d, id, n, NEW_COMPONENT[n] ?? {}));
      });
      parts.push(add);
    }
    this.el.replaceChildren(...parts);
  }

  /** 一個元件的區塊 */
  private section(id: string, name: string, data: unknown): HTMLElement {
    const box = h('section', 'comp');
    const title = h('h3');
    title.append(h('span', '', componentLabel(name)), h('span', 'comp-name', name));
    const rawKey = `${id}:${name}`;
    const raw = h('button', 'icon-btn', '{ }');
    raw.title = this.rawMode.has(rawKey) ? '改回欄位編輯' : '用 JSON 編輯';
    raw.classList.toggle('on', this.rawMode.has(rawKey));
    raw.addEventListener('click', () => {
      if (this.rawMode.has(rawKey)) this.rawMode.delete(rawKey);
      else this.rawMode.add(rawKey);
      this.refresh();
    });
    const remove = h('button', 'icon-btn', '✕');
    remove.title = '移除這個元件';
    remove.addEventListener('click', () =>
      this.doc.commit(`移除${componentLabel(name)}`, (d) => writeComponent(d, id, name, undefined)),
    );
    // 預製物件內部的實體：改過的元件可以還原
    if (id.includes('/') && overriddenOf(this.doc.toFile(), id).components.has(name)) {
      title.classList.add('overridden');
      const revert = h('button', 'icon-btn', '↺');
      revert.title = '還原成預製物件裡的樣子';
      revert.addEventListener('click', () =>
        this.doc.commit(`還原${componentLabel(name)}`, (d) => revertOverride(d, id, name)),
      );
      title.append(revert);
    }
    if (name === 'Collider') {
      const fit = h('button', 'icon-btn', '⤢');
      fit.title = '符合網格大小：依這個物件的網格或模型設定碰撞體的大小與位移';
      fit.addEventListener('click', () => this.hooks.fitCollider(id));
      title.append(fit);
    }
    title.append(raw, remove);
    box.append(title);
    const body = h('div', 'comp-body');
    box.append(body);

    /** 修改元件資料；同一個欄位的連續修改合併成一步 */
    const change = (next: unknown, done: boolean, key: string) => {
      this.doc.commit(`修改${componentLabel(name)}`, (d) => writeComponent(d, id, name, next), {
        merge: `${id}.${name}.${key}`,
      });
      if (done) this.doc.seal();
    };

    const json = (): Section => {
      const f = jsonField(data ?? {}, (v) => change(v, true, 'json'));
      body.append(f.el);
      return {
        name,
        update: (d) => {
          f.set(d ?? {});
          return true;
        },
      };
    };

    const schema = schemaOf(name);
    let section: Section;
    if (this.rawMode.has(rawKey)) section = json();
    else if (name === 'ScriptList') section = this.scriptSection(body, (data ?? {}) as Record<string, Json>, change);
    else if (name === 'MeshRenderer') {
      const mesh = meshFields((data ?? {}) as Json, change, {
        shaderGraphs: () => this.hooks.shaderGraphs(),
        openShader: (url) => this.hooks.openShader(url),
      });
      if (mesh) {
        body.append(mesh.el);
        section = { name, update: (d) => mesh.update((d ?? {}) as Json) };
      } else {
        body.append(h('div', 'comp-note', '這個網格的寫法不是一般的形狀／材質，用 JSON 編輯'));
        section = json();
      }
    } else if (schema) section = this.schemaSection(id, body, schema, data, change);
    else section = json();
    this.sections.push(section);
    return box;
  }

  /**
   * 腳本（ScriptList）：每個腳本一塊，參數依專案原始碼找到的預設值決定欄位（數字、文字、勾選）；
   * 只存和預設值不同的參數。下面的選單加入其他腳本。
   */
  private scriptSection(
    body: HTMLElement,
    data: Record<string, Json>,
    change: (next: unknown, done: boolean, key: string) => void,
  ): Section {
    const infos = this.hooks.scripts();
    const known = new Map(infos.map((s) => [s.name, s]));
    const names = Object.keys(data);
    let current = data;
    const write = (next: Record<string, Json>, done: boolean, key: string) => change(next, done, key);
    /** 每個參數欄位：資料改了（例如復原、拖曳中）時更新顯示的值 */
    const setters: ((d: Record<string, Json>) => void)[] = [];

    if (!names.length)
      body.append(
        h(
          'div',
          'comp-note',
          '還沒有腳本：用下面的選單加入。遊戲裡要先 scripts.register({ 腳本 })，載入場景時才會掛上。',
        ),
      );
    for (const name of names) {
      const props = data[name] ?? {};
      const info = known.get(name);
      const card = h('div', 'script-card');
      const head = h('div', 'script-head');
      head.append(h('b', '', name));
      if (info) head.title = `${info.file}:${info.line}${info.doc ? `\n${info.doc}` : ''}`;
      const del = h('button', 'icon-btn', '✕');
      del.title = `移除腳本 ${name}`;
      del.addEventListener('click', () => {
        const next = { ...current };
        delete next[name];
        write(next, true, `remove-${name}`);
      });
      head.append(del);
      card.append(head);
      if (!info) {
        card.append(
          h(
            'div',
            'comp-note',
            `專案的 src/ 裡找不到 class ${name} extends Script（改名或刪掉了？）；參數用 JSON 編輯`,
          ),
        );
        const f = jsonField(props, (v) => write({ ...current, [name]: (v ?? {}) as Json }, true, `json-${name}`));
        setters.push((d) => f.set(d[name] ?? {}));
        card.append(f.el);
      } else {
        if (info.doc) card.append(h('div', 'comp-note', info.doc));
        if (!info.props.length) card.append(h('div', 'comp-note', '這個腳本沒有可以設定的參數'));
        for (const p of info.props) {
          const valueIn = (d: Record<string, Json>) => d[name]?.[p.name] ?? p.default;
          const value = valueIn(data);
          const set = (v: unknown, done: boolean) => {
            const next = { ...(current[name] ?? {}) };
            if (v === p.default) delete next[p.name];
            else next[p.name] = v;
            write({ ...current, [name]: next }, done, `${name}.${p.name}`);
          };
          if (p.type === 'number') {
            const f = numberField(Number(value), set, { step: Number.isInteger(p.default) ? 1 : 0.1 });
            setters.push((d) => f.set(Number(valueIn(d))));
            card.append(row(p.name, f.el, p.doc ?? ''));
          } else if (p.type === 'boolean') {
            const f = checkField(value === true, (v) => set(v, true));
            setters.push((d) => f.set(valueIn(d) === true));
            card.append(row(p.name, f.el, p.doc ?? ''));
          } else {
            const f = textField(String(value), set);
            setters.push((d) => f.set(String(valueIn(d))));
            card.append(row(p.name, f.el, p.doc ?? ''));
          }
        }
        // 檔案裡有、原始碼裡已經沒有的參數
        const stale = Object.keys(props).filter((k) => !info.props.some((p) => p.name === k));
        if (stale.length)
          card.append(h('div', 'comp-note', `原始碼裡已經沒有的參數（載入時照樣會設定）：${stale.join('、')}`));
      }
      body.append(card);
    }
    const left = infos.filter((s) => !(s.name in data));
    const add = h('select', 'insp-add');
    add.add(new Option(infos.length ? '＋ 加入腳本…' : '（專案的 src/ 裡沒有找到腳本）', ''));
    for (const s of left) add.add(new Option(`${s.name}（${s.file}）`, s.name));
    add.disabled = !left.length;
    add.addEventListener('change', () => {
      if (add.value) write({ ...current, [add.value]: {} }, true, `add-${add.value}`);
    });
    body.append(add);
    const key = names.join(',');
    return {
      name: 'ScriptList',
      update: (d) => {
        const next = (d ?? {}) as Record<string, Json>;
        if (Object.keys(next).join(',') !== key) return false; // 加入、移除腳本：重建
        current = next;
        for (const s of setters) s(next);
        return true;
      },
    };
  }

  /** 依欄位說明建立欄位 */
  private schemaSection(
    id: string,
    body: HTMLElement,
    schema: ComponentSchema,
    data: unknown,
    change: (next: unknown, done: boolean, key: string) => void,
  ): Section {
    let given = (data ?? {}) as Json;
    let full = withDefaults(schema, given);
    const rows: { def: FieldDef; row: HTMLElement; field: Field<never> }[] = [];

    const setValue = (def: FieldDef, value: unknown, done: boolean) => {
      const next: Json = { ...given };
      const fileValue = toFileValue(schema, def, value);
      if (JSON.stringify(fileValue) === JSON.stringify(toFileValue(schema, def, defaultOf(schema, def))))
        delete next[def.key];
      else next[def.key] = fileValue;
      change(next, done, def.key);
    };

    for (const def of schema.fields) {
      const v = full[def.key];
      const on = (value: unknown, done: boolean) => setValue(def, value, done);
      let field: Field<never>;
      switch (def.kind) {
        case 'vec3':
          field = vec3Field(v as number[], on, { step: def.step }) as Field<never>;
          break;
        case 'number':
        case 'angle':
          field = numberField(v as number, on, { step: def.step, min: def.min, max: def.max }) as Field<never>;
          break;
        case 'color':
          field = colorField(v as string, on) as Field<never>;
          break;
        case 'bool':
          field = checkField(v as boolean, on) as Field<never>;
          break;
        case 'select':
          field = selectField(v as string, def.options ?? [], on) as Field<never>;
          break;
        case 'text': {
          const kind = def.suggest;
          field = textField(
            v as string,
            (t) => on(t, true),
            def.placeholder,
            kind ? () => this.hooks.suggest(kind, id) : undefined,
          ) as Field<never>;
          break;
        }
        case 'bool3':
          field = check3Field(v as boolean[], on) as Field<never>;
          break;
        case 'range':
          field = rangeField(v as number | number[], on, {
            step: def.step,
            min: def.min,
            max: def.max,
          }) as Field<never>;
          break;
        case 'duration':
          field = durationField(v as number | null, on) as Field<never>;
          break;
      }
      const r = row(def.label, field.el, def.hint);
      body.append(r);
      rows.push({ def, row: r, field });
    }
    const applyWhen = () => {
      for (const r of rows) r.row.hidden = r.def.when ? !r.def.when(full) : false;
    };
    applyWhen();

    return {
      name: schema.name,
      update(d) {
        given = (d ?? {}) as Json;
        full = withDefaults(schema, given);
        for (const r of rows) r.field.set(full[r.def.key] as never);
        applyWhen();
        return true;
      },
    };
  }
}
