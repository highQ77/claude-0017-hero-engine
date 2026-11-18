/**
 * 場景設定面板（屬性面板在沒有選取時顯示）：介面（UI 層）、背景、霧、後製、尋路格子。
 * 改的是場景檔的 settings 與 ui（可以復原）；畫面由 viewport 依資料即時套用。
 *
 * 和屬性面板一樣：結構沒變（哪些區塊開著、霧的種類…）只更新欄位的值，結構變了才重建。
 */
import { create as postfxCreate } from '../../postfx';
import type { NavGridFile } from '../../ai';
import { setSetting, type SceneDoc } from './doc';
import { checkField, colorField, h, numberField, row, selectField } from './fields';
import { bakeFromBoxes, clearCells, navGridStats, newNavGrid, resizeNavGrid } from './navgrid';
import type * as THREE from 'three';

type Json = Record<string, unknown>;

/** 場景設定面板需要編輯器提供的東西 */
export interface SettingsHooks {
  /** 畫尋路格子的模式 */
  paintMode(): boolean;
  setPaintMode(on: boolean): void;
  /** 所有碰撞體的世界範圍（從碰撞體產生用） */
  colliderBoxes(): THREE.Box3[];
  /** 顯示訊息 */
  status(message: string, kind?: 'info' | 'warn' | 'error'): void;
  /** public/ui 裡所有的介面檔（遊戲裡的網址） */
  uiFiles(): Promise<string[]>;
  /** 在 UI 編輯器打開介面檔 */
  openUI(url: string): void;
}

const POSTFX = postfxCreate.postFxSettings();
const hex = (v: unknown) => {
  if (typeof v === 'number') return `#${v.toString(16).padStart(6, '0')}`;
  return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : '#000000';
};

export class SettingsPanel {
  private signature = '';
  private updaters: ((s: Json) => void)[] = [];

  constructor(
    private readonly el: HTMLElement,
    private readonly doc: SceneDoc,
    private readonly hooks: SettingsHooks,
  ) {}

  private get settings(): Json {
    return (this.doc.toFile().settings ?? {}) as Json;
  }

  /** 修改一個設定鍵；同一個欄位的連續修改合併成一步 */
  private set(key: string, value: unknown, done: boolean, field: string): void {
    this.doc.commit('修改場景設定', (d) => setSetting(d, key, value), { merge: `settings.${field}` });
    if (done) this.doc.seal();
  }

  /** 顯示或更新 */
  render(): void {
    const s = this.settings;
    const fog = s.fog as Json | null | undefined;
    const sig = [
      (this.doc.toFile().ui ?? []).join(','),
      s.background === undefined ? 'bg-default' : s.background === null ? 'bg-none' : 'bg-color',
      fog ? (fog.density !== undefined ? 'fog-exp' : 'fog-linear') : 'fog-none',
      s.postfx ? 'postfx' : '',
      s.navGrid ? 'nav' : '',
      this.hooks.paintMode() ? 'paint' : '',
    ].join('|');
    if (sig === this.signature && this.el.querySelector('.settings')) {
      for (const u of this.updaters) u(s);
      return;
    }
    this.signature = sig;
    this.build(s);
  }

  private build(s: Json): void {
    this.updaters = [];
    const root = h('div', 'settings');
    root.append(h('div', 'comp-note', '沒有選取物件時，這裡是整個場景的設定（存在場景檔的 settings）。'));
    root.append(
      this.uiSection(),
      this.backgroundSection(s),
      this.fogSection(s),
      this.postfxSection(s),
      this.navSection(s),
    );
    this.el.replaceChildren(root);
  }

  private section(title: string, enabled: boolean | null, toggle?: (on: boolean) => void): [HTMLElement, HTMLElement] {
    const box = h('section', 'comp');
    const head = h('h3');
    head.append(h('span', '', title));
    if (enabled !== null && toggle) {
      const c = checkField(enabled, (on) => toggle(on), '開啟');
      c.el.classList.add('section-toggle');
      head.append(c.el);
    }
    const body = h('div', 'comp-body');
    box.append(head, body);
    return [box, body];
  }

  /** 場景搭配的介面檔（場景檔的 ui）：疊在畫面上預覽，可以在 UI 編輯器打開 */
  private uiSection(): HTMLElement {
    const files = this.doc.toFile().ui ?? [];
    const [box, body] = this.section('介面（UI 層）', null);
    const setUI = (next: string[], label: string) =>
      this.doc.commit(label, (d) => {
        if (next.length) d.ui = next;
        else delete d.ui;
      });
    body.append(
      h(
        'div',
        'comp-note',
        '這個場景搭配的介面檔（public/ui）：疊在 3D 畫面上預覽，第一個是底層。只是給編輯器預覽用，遊戲裡照常由程式載入介面。',
      ),
    );
    files.forEach((url, i) => {
      const line = h('div', 'ui-file');
      const name = h('span', 'ui-file-name', url);
      name.title = url;
      const edit = h('button', 'small-btn', '編輯');
      edit.title = '在 UI 編輯器打開（另一個分頁）；修改會即時顯示在這裡，不用存檔';
      edit.addEventListener('click', () => this.hooks.openUI(url));
      const up = h('button', 'small-btn', '↑');
      up.title = '往下層移（越前面越底層）';
      up.disabled = i === 0;
      up.addEventListener('click', () => {
        const next = [...files];
        [next[i - 1], next[i]] = [next[i], next[i - 1]];
        setUI(next, '調整介面檔順序');
      });
      const del = h('button', 'small-btn', '✕');
      del.title = '從這個場景移除（不會刪除檔案）';
      del.addEventListener('click', () =>
        setUI(
          files.filter((_, j) => j !== i),
          '移除介面檔',
        ),
      );
      line.append(name, edit, up, del);
      body.append(line);
    });
    const add = h('select', 'ui-file-add');
    const placeholder = new Option('＋ 加入介面檔…', '');
    placeholder.disabled = true;
    add.append(placeholder);
    add.value = '';
    add.addEventListener('change', () => {
      const url = add.value;
      add.value = '';
      if (url && !files.includes(url)) setUI([...files, url], '加入介面檔');
    });
    this.hooks
      .uiFiles()
      .then((all) => {
        const left = all.filter((u) => !files.includes(u));
        for (const u of left) add.append(new Option(u, u));
        if (!left.length) placeholder.textContent = all.length ? '（介面檔都加入了）' : '（public/ui 裡沒有介面檔）';
      })
      .catch(() => {
        placeholder.textContent = '（讀不到介面檔清單）';
      });
    body.append(add);
    return box;
  }

  private backgroundSection(s: Json): HTMLElement {
    const [box, body] = this.section('背景', null);
    const mode = s.background === undefined ? 'default' : s.background === null ? 'none' : 'color';
    const sel = selectField(
      mode,
      [
        ['default', '預設（遊戲程式決定）'],
        ['color', '顏色'],
        ['none', '透明'],
      ],
      (v) => this.set('background', v === 'default' ? undefined : v === 'none' ? null : '#202830', true, 'bg-mode'),
    );
    body.append(row('背景', sel.el));
    if (mode === 'color') {
      const color = colorField(hex(s.background), (v, done) => this.set('background', v, done, 'bg'));
      body.append(row('顏色', color.el));
      this.updaters.push((x) => color.set(hex(x.background)));
    }
    return box;
  }

  private fogSection(s: Json): HTMLElement {
    const fog = (s.fog ?? null) as Json | null;
    const [box, body] = this.section('霧', null);
    const kind = !fog ? 'none' : fog.density !== undefined ? 'exp' : 'linear';
    const sel = selectField(
      kind,
      [
        ['none', '沒有'],
        ['linear', '線性（從近到遠）'],
        ['exp', '指數（越遠越濃）'],
      ],
      (v) =>
        this.set(
          'fog',
          v === 'none'
            ? undefined
            : v === 'linear'
              ? { color: hex(fog?.color ?? '#a0b0c0'), near: 10, far: 60 }
              : { color: hex(fog?.color ?? '#a0b0c0'), density: 0.03 },
          true,
          'fog-kind',
        ),
    );
    body.append(row('種類', sel.el));
    if (fog) {
      const patch = (k: string, v: unknown, done: boolean) =>
        this.set('fog', { ...((this.settings.fog as Json) ?? {}), [k]: v }, done, `fog.${k}`);
      const color = colorField(hex(fog.color), (v, done) => patch('color', v, done));
      body.append(row('顏色', color.el));
      this.updaters.push((x) => color.set(hex((x.fog as Json | undefined)?.color)));
      const keys: [string, string, number][] =
        kind === 'linear'
          ? [
              ['near', '開始距離', 0.5],
              ['far', '最濃距離', 1],
            ]
          : [['density', '濃度', 0.005]];
      for (const [k, label, step] of keys) {
        const f = numberField(Number(fog[k] ?? 0), (v, done) => patch(k, v, done), { step, min: 0 });
        body.append(row(label, f.el));
        this.updaters.push((x) => f.set(Number((x.fog as Json | undefined)?.[k] ?? 0)));
      }
    }
    return box;
  }

  private postfxSection(s: Json): HTMLElement {
    const on = s.postfx !== undefined;
    const [box, body] = this.section('後製特效', on, (v) => this.set('postfx', v ? {} : undefined, true, 'postfx-on'));
    if (!on) {
      body.append(h('div', 'comp-note', '光暈、暗角、調色、色調映射…（遊戲要安裝 PostProcessingPlugin 才有效果）'));
      return box;
    }
    /** postfx 裡某個值（沒寫時用預設值） */
    const get = (x: Json, path: string[]): unknown => {
      let v: unknown = x.postfx;
      for (const p of path) v = (v as Json | undefined)?.[p];
      if (v !== undefined) return v;
      let d: unknown = POSTFX;
      for (const p of path) d = (d as Json)[p];
      return d;
    };
    /** 設定某個值：和預設值一樣時刪掉（檔案只留改過的） */
    const put = (path: string[], value: unknown, done: boolean) => {
      const next = structuredClone((this.settings.postfx ?? {}) as Json);
      let def: unknown = POSTFX;
      for (const p of path) def = (def as Json)[p];
      if (path.length === 1) {
        if (value === def) delete next[path[0]];
        else next[path[0]] = value;
      } else {
        const obj = { ...((next[path[0]] as Json) ?? {}) };
        if (value === def) delete obj[path[1]];
        else obj[path[1]] = value;
        if (Object.keys(obj).length) next[path[0]] = obj;
        else delete next[path[0]];
      }
      this.set('postfx', next, done, `postfx.${path.join('.')}`);
    };
    const num = (label: string, path: string[], step: number, min?: number, max?: number) => {
      const f = numberField(Number(get(s, path)), (v, done) => put(path, v, done), { step, min, max });
      this.updaters.push((x) => f.set(Number(get(x, path))));
      return row(label, f.el);
    };
    const bool = (label: string, path: string[]) => {
      const f = checkField(get(s, path) === true, (v) => put(path, v, true));
      this.updaters.push((x) => f.set(get(x, path) === true));
      return row(label, f.el);
    };
    const choice = (label: string, path: string[], options: [string, string][]) => {
      const f = selectField(String(get(s, path)), options, (v) => put(path, v, true));
      this.updaters.push((x) => f.set(String(get(x, path))));
      return row(label, f.el);
    };
    body.append(
      choice(
        '色調映射',
        ['toneMapping'],
        [
          ['aces', 'ACES（電影感）'],
          ['agx', 'AgX'],
          ['neutral', 'Neutral'],
          ['reinhard', 'Reinhard'],
          ['cineon', 'Cineon'],
          ['linear', '線性'],
          ['none', '不使用'],
        ],
      ),
      num('曝光', ['exposure'], 0.05, 0),
      h('div', 'settings-sub', '光暈'),
      bool('開啟', ['bloom', 'enabled']),
      num('強度', ['bloom', 'strength'], 0.05, 0),
      num('範圍', ['bloom', 'radius'], 0.05, 0, 1),
      num('門檻', ['bloom', 'threshold'], 0.05, 0),
      h('div', 'settings-sub', '暗角'),
      bool('開啟', ['vignette', 'enabled']),
      num('範圍', ['vignette', 'offset'], 0.05, 0),
      num('暗度', ['vignette', 'darkness'], 0.05, 0),
      h('div', 'settings-sub', '調色'),
      bool('開啟', ['color', 'enabled']),
      num('亮度', ['color', 'brightness'], 0.02),
      num('對比', ['color', 'contrast'], 0.02, 0),
      num('飽和度', ['color', 'saturation'], 0.02, 0),
      h('div', 'settings-sub', '其他'),
      bool('環境光遮蔽', ['ao', 'enabled']),
      bool('底片顆粒', ['film', 'enabled']),
      choice(
        '反鋸齒',
        ['antialias'],
        [
          ['auto', '自動'],
          ['msaa', 'MSAA'],
          ['fxaa', 'FXAA'],
          ['smaa', 'SMAA'],
          ['none', '不使用'],
        ],
      ),
    );
    return box;
  }

  private navSection(s: Json): HTMLElement {
    const nav = s.navGrid as NavGridFile | undefined;
    const [box, body] = this.section('尋路格子', nav !== undefined, (v) => {
      if (!v) this.hooks.setPaintMode(false);
      this.set('navGrid', v ? newNavGrid() : undefined, true, 'nav-on');
    });
    if (!nav) {
      body.append(
        h('div', 'comp-note', 'AI 角色找路用的格子（AIPlugin 的 navGrid）。開啟後可以在畫面上畫出擋住的地方。'),
      );
      return box;
    }
    const current = () => this.settings.navGrid as NavGridFile;
    const change = (next: NavGridFile, done: boolean, field: string) => this.set('navGrid', next, done, `nav.${field}`);
    const pair = (label: string, key: 'min' | 'max') => {
      const wrap = h('div', 'f-range');
      const fields = [0, 1].map((i) =>
        numberField(
          nav[key][i],
          (v, done) => {
            const p: [number, number] = [...current()[key]] as [number, number];
            p[i] = v;
            change(resizeNavGrid(current(), { [key]: p }), done, `${key}${i}`);
          },
          { step: 0.5, tag: i === 0 ? 'X' : 'Z', tagClass: i === 0 ? 'x' : 'z' },
        ),
      );
      wrap.append(...fields.map((f) => f.el));
      this.updaters.push((x) => {
        const n = x.navGrid as NavGridFile | undefined;
        if (n) fields.forEach((f, i) => f.set(n[key][i]));
      });
      return row(label, wrap);
    };
    const cell = numberField(
      nav.cellSize ?? 0.5,
      (v, done) => change(resizeNavGrid(current(), { cellSize: v }), done, 'cell'),
      {
        step: 0.05,
        min: 0.05,
      },
    );
    const y = numberField(nav.y ?? 0, (v, done) => change({ ...current(), y: v }, done, 'y'), { step: 0.1 });
    const stats = h('div', 'comp-note');
    const showStats = (n: NavGridFile) => {
      try {
        const st = navGridStats(n);
        stats.textContent = `${st.cols} × ${st.rows} 格，擋住 ${st.blocked} 格`;
      } catch (error) {
        stats.textContent = (error as Error).message;
      }
    };
    showStats(nav);
    this.updaters.push((x) => {
      const n = x.navGrid as NavGridFile | undefined;
      if (!n) return;
      cell.set(n.cellSize ?? 0.5);
      y.set(n.y ?? 0);
      showStats(n);
    });

    const paint = h(
      'button',
      `small-btn${this.hooks.paintMode() ? ' on' : ''}`,
      this.hooks.paintMode() ? '畫格子中…（再按結束）' : '畫擋住的格子',
    );
    paint.title = '在畫面上用左鍵拖曳畫出擋住的地方，按住 Shift 擦掉（畫的時候不能轉動攝影機，右鍵可以平移）';
    paint.addEventListener('click', () => {
      this.hooks.setPaintMode(!this.hooks.paintMode());
      this.signature = '';
      this.render();
    });
    const bake = h('button', 'small-btn', '從碰撞體產生');
    bake.title = '碰撞體擋住的地方（地板除外，高度 1.8 以內）標成擋住，會取代目前畫的內容';
    bake.addEventListener('click', () => {
      const boxes = this.hooks.colliderBoxes();
      this.set('navGrid', bakeFromBoxes(current(), boxes), true, 'bake');
      this.hooks.status(`依 ${boxes.length} 個碰撞體產生了尋路格子`);
    });
    const clear = h('button', 'small-btn', '全部可走');
    clear.addEventListener('click', () => this.set('navGrid', clearCells(current()), true, 'clear'));
    const actions = h('div', 'settings-actions');
    actions.append(paint, bake, clear);

    body.append(
      pair('範圍最小', 'min'),
      pair('範圍最大', 'max'),
      row('格子大小', cell.el),
      row('高度', y.el, '路徑點的高度（地面的 y）'),
      stats,
      actions,
    );
    return box;
  }
}
