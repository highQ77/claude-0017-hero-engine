/**
 * 頁面堆疊（UIStackView）、表格（UITable）、多樣式文字（UIRichText）。
 */
import {
  UIButton,
  UIElement,
  UILabel,
  UILayout,
  UIScrollView,
  type Attrs,
  type PointerCapture,
  type UIContext,
} from './elements';
import { bool, num, type Context2D } from './draw';
import { UIRichText, parseRichText } from './richtext';

export { UIRichText, parseRichText };
import type { XmlNode } from './xml';

const easeOut = (t: number) => 1 - (1 - t) ** 3;

// ═════════════════════════ UIStackView ═════════════════════════

/**
 * 頁面堆疊：子元件是一頁一頁，一次只顯示一頁；切換時有滑動或淡入動畫。
 * 搭配任何按鈕的 select="堆疊id:頁" 屬性就能做分頁（不用寫程式），
 * 按鈕再加 activeBackground／activeColor，對應的頁面顯示中時會變色。
 * 頁可以用索引或子元件的 id 指定。切換時觸發 change 事件（event.value 為索引）。
 * 頁面比堆疊高（橫向時比堆疊寬）時，預設縮到堆疊的大小，內容太長的 UIScrollView 頁面就能捲動；
 * 堆疊的大小依內容決定時不受影響。頁面自己寫了高度（橫向時寬度）、flex、grow、shrink 或 basis 時照自己的。
 * @example
 * <UILayout dir="h" gap="6">
 *   <UIButton text="角色" select="pages:0" activeBackground="#9acd32"/>
 *   <UIButton text="技能" select="pages:skills" activeBackground="#9acd32"/>
 * </UILayout>
 * <UIStackView id="pages" transition="slide" indicator="dots" swipe="true">
 *   <UILayout id="hero">…</UILayout>
 *   <UILayout id="skills">…</UILayout>
 * </UIStackView>
 */
export class UIStackView extends UIElement {
  private anim: { page: UIElement; dir: number; t: number } | null = null;

  override defaults(): Attrs {
    const dots = this.raw.indicator === 'dots';
    return {
      dir: 'v',
      transition: 'slide',
      duration: '0.28',
      indicator: 'none',
      swipe: 'false',
      loop: 'false',
      dotColor: 'rgba(255,255,255,0.3)',
      accent: '#9acd32',
      ...(dots ? { paddingBottom: '22' } : {}),
    };
  }

  /** 所有頁面（子元件） */
  get pages(): UIElement[] {
    return this.children;
  }

  /**
   * 子元件套用屬性後呼叫：沒寫尺寸、flex 相關屬性的頁面，比堆疊大時縮到堆疊的大小。
   * Yoga 的元件預設不會縮小：不這樣做的話，內容很長的頁面會比堆疊還高，超出的部分蓋到後面的元件，捲動區也捲不動。
   * 只允許縮小、不改基準大小（basis）：堆疊的大小依內容決定時（例如視窗裡的分頁），頁面仍然是內容的大小。
   */
  fitPages(): void {
    const horizontal = this.attrs.dir === 'h' || this.attrs.dir === 'row';
    const size = horizontal ? 'width' : 'height';
    for (const page of this.children) {
      const a = page.attrs;
      if (
        a[size] !== undefined ||
        a.flex !== undefined ||
        a.grow !== undefined ||
        a.shrink !== undefined ||
        a.basis !== undefined
      )
        continue;
      page.node.setFlexShrink(1);
    }
  }

  override get acceptsChildren(): boolean {
    return true;
  }

  /** 頁數 */
  get count(): number {
    return this.children.length;
  }

  /**
   * 把「索引或 id」換成索引（找不到為 -1）
   * @param page 頁的索引或 id
   */
  indexOf(page: string | number): number {
    if (typeof page === 'number') return page >= 0 && page < this.count ? page : -1;
    const byId = this.children.findIndex((c) => c.id === page);
    if (byId >= 0) return byId;
    const i = parseInt(page, 10);
    return Number.isFinite(i) && String(i) === page.trim() && i >= 0 && i < this.count ? i : -1;
  }

  /** 目前顯示第幾頁（從 0 開始） */
  get selectedIndex(): number {
    const i = this.indexOf(this.raw.value ?? '0');
    return Math.max(i, 0);
  }

  /** 目前顯示的頁面 */
  get selectedPage(): UIElement | null {
    return this.children[this.selectedIndex] ?? null;
  }

  /**
   * 某一頁是否顯示中（給 select 按鈕判斷要不要亮起來）
   * @param page 頁的 id
   */
  isShowing(page: string): boolean {
    return this.indexOf(page) === this.selectedIndex;
  }

  /**
   * 切換到某一頁（emit 為 true 時觸發 change 事件）
   * @param page 頁的索引或 id
   * @param emit true 時觸發 change 事件
   */
  show(page: string | number, emit = false): void {
    const to = this.indexOf(page);
    const from = this.selectedIndex;
    if (to < 0 || (to === from && this.raw.value !== undefined)) return;
    this.set('value', String(to));
    this.startTransition(to, to > from ? 1 : -1);
    if (emit) this.emit('change', { value: to });
  }

  /**
   * 下一頁（emit：是否觸發 change 事件）
   * @param emit true 時觸發 change 事件
   */
  next(emit = true): void {
    const i = this.selectedIndex + 1;
    if (i < this.count) this.show(i, emit);
    else if (bool(this.attrs.loop)) this.show(0, emit);
  }

  /**
   * 上一頁（emit：是否觸發 change 事件）
   * @param emit true 時觸發 change 事件
   */
  prev(emit = true): void {
    const i = this.selectedIndex - 1;
    if (i >= 0) this.show(i, emit);
    else if (bool(this.attrs.loop)) this.show(this.count - 1, emit);
  }

  override resolve(): void {
    super.resolve();
    const sel = this.selectedIndex;
    this.children.forEach((c, i) => (c.forceHidden = i !== sel));
    // 其他元件的 select 按鈕要跟著更新亮起狀態：它們在 resolve 時會讀 isShowing
  }

  private startTransition(index: number, dir: number): void {
    const mode = this.attrs.transition ?? 'slide';
    const page = this.children[index];
    if (!page || mode === 'none' || num(this.attrs.duration, 0.28) <= 0) return;
    if (this.anim && this.anim.page !== page) {
      this.anim.page.alpha = 1;
      this.anim.page.offsetX = 0;
    }
    this.anim = { page, dir, t: 0 };
    page.alpha = 0;
    this.ctx.animate?.(this);
  }

  override tick(dt: number): boolean {
    const a = this.anim;
    if (!a) return false;
    a.t = Math.min(1, a.t + dt / Math.max(0.01, num(this.attrs.duration, 0.28)));
    const e = easeOut(a.t);
    a.page.alpha = e;
    a.page.offsetX = this.attrs.transition === 'fade' ? 0 : (1 - e) * 40 * a.dir;
    this.ctx.damage?.(this, 48);
    if (a.t >= 1) {
      a.page.alpha = 1;
      a.page.offsetX = 0;
      this.anim = null;
      return false;
    }
    return true;
  }

  /**
   * 左右滑動換頁（swipe="true"；按在頁面的按鈕上時照常點擊）
   * @param px 指標 X（介面座標）
   */
  override pointerDown(px: number, _py: number): PointerCapture | null {
    if (!bool(this.attrs.swipe) || this.count < 2) return null;
    const page = this.selectedPage;
    return {
      move: (x) => {
        if (!page) return;
        page.offsetX = (x - px) * 0.4;
        this.ctx.damage?.(this, 48);
        this.ctx.invalidate?.();
      },
      cancel: () => {
        if (page) page.offsetX = 0;
        this.ctx.damage?.(this, 48);
        this.ctx.invalidate?.();
      },
      up: (x) => {
        if (page) page.offsetX = 0;
        const dx = x - px;
        if (dx < -50) this.next();
        else if (dx > 50) this.prev();
        this.ctx.damage?.(this, 48);
        this.ctx.invalidate?.();
      },
    };
  }

  override get interactive(): boolean {
    return bool(this.attrs.swipe) || super.interactive;
  }

  override paintContent(ctx: Context2D, x: number, y: number, w: number, h: number): void {
    if (this.attrs.indicator !== 'dots' || this.count < 2) return;
    const n = this.count;
    const sel = this.selectedIndex;
    const gap = 12;
    const cy = y + h - 10;
    const x0 = x + w / 2 - ((n - 1) * gap) / 2;
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = i === sel ? (this.attrs.accent ?? '#9acd32') : (this.attrs.dotColor ?? 'rgba(255,255,255,0.3)');
      ctx.beginPath();
      ctx.arc(x0 + i * gap, cy, i === sel ? 4 : 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// ═════════════════════════ UITabs（標籤列 + UIStackView） ═════════════════════════

/** 分頁的一頁：放在 UITabs 裡，title 為分頁標籤上的文字 */
export class UITab extends UIElement {
  override defaults(): Attrs {
    return { dir: 'v', gap: '10' };
  }

  override get acceptsChildren(): boolean {
    return true;
  }

  /** 分頁標題（title 屬性） */
  get title(): string {
    return this.attrs.title ?? this.raw.title ?? '分頁';
  }

  /** 所屬的分頁元件 */
  get owner(): UITabs | null {
    const p = this.parent?.parent;
    return p instanceof UITabs ? p : null;
  }
}

/**
 * 分頁：上方是分頁標籤，下方是一個 UIStackView 顯示選取的那一頁。
 * 切換有動畫（transition="slide"｜"fade"｜"none"），swipe="true" 可以左右滑動換頁；
 * 切換時觸發 change 事件（event.value 為索引）。value 可以是索引、分頁 id 或標題。
 * @example
 * <UITabs value="0" onChange="tabChanged">
 *   <UITab title="畫面">…</UITab>
 *   <UITab title="聲音">…</UITab>
 * </UITabs>
 */
export class UITabs extends UIElement {
  /** 分頁標籤列 */
  readonly bar: UILayout;
  /** 放分頁內容的頁面堆疊 */
  readonly content: UIStackView;
  private buttons: UIButton[] = [];

  /**
   * @param ctx 所屬介面的環境（排版引擎、樣式、圖片載入…；UI2D 建立元件時給）
   * @param type 元件類型（XML 標籤名稱）
   * @param raw XML 寫的屬性
   */
  constructor(ctx: UIContext, type: string, raw: Attrs = {}, _text = '') {
    super(ctx, type, raw);
    this.bar = new UILayout(ctx, 'UITabBar', { dir: 'h', gap: '4' });
    this.content = new UIStackView(ctx, 'UITabContent', { grow: '1', transition: 'fade' });
    // 在內容區滑動換頁時，標籤跟著換
    this.content.on('change', (e) => {
      this.raw.value = String(e.value);
      this.styleButtons();
      this.ctx.requestLayout(true);
      this.emit('change', { value: e.value });
    });
    this.add(this.bar);
    this.add(this.content);
  }

  override defaults(): Attrs {
    return {
      dir: 'v',
      gap: '12',
      accent: '#3a7bfd',
      tabBackground: 'rgba(255,255,255,0.06)',
      tabHoverBackground: 'rgba(255,255,255,0.12)',
      tabColor: '#c8d0dc',
      activeColor: '#ffffff',
      fontSize: '14',
      transition: 'fade',
      swipe: 'false',
    };
  }

  override get contentParent(): UIElement {
    return this.content;
  }

  /** 所有分頁 */
  get tabs(): UITab[] {
    return this.content.children.filter((c): c is UITab => c instanceof UITab);
  }

  /** 選取的索引（value 可以是索引、分頁 id 或標題） */
  get selectedIndex(): number {
    const v = this.raw.value ?? '0';
    const tabs = this.tabs;
    const byId = tabs.findIndex((t) => t.id === v || t.title === v);
    if (byId >= 0) return byId;
    const i = parseInt(v, 10);
    return Number.isFinite(i) ? Math.min(Math.max(0, i), Math.max(0, tabs.length - 1)) : 0;
  }

  /** 目前選中的分頁 */
  get selectedTab(): UITab | null {
    return this.tabs[this.selectedIndex] ?? null;
  }

  /**
   * 切換分頁（不會觸發 change 事件；有切換動畫）
   * @param index 分頁的索引
   */
  select(index: number): void {
    if (index === this.selectedIndex && this.raw.value !== undefined) return;
    this.raw.value = String(index);
    this.content.show(index);
    this.styleButtons();
    this.ctx.requestLayout(true);
  }

  override onBuilt(): void {
    this.rebuildBar();
  }

  /** 依分頁重建標籤列（新增、移除分頁後呼叫） */
  rebuildBar(): void {
    for (const b of this.buttons) b.destroy();
    this.buttons = this.tabs.map((tab, i) => {
      const b = new UIButton(
        this.ctx,
        'UIButton',
        { padding: '7 14', radius: '8', fontSize: this.attrs.fontSize ?? '14' },
        tab.title,
      );
      b.on('click', () => {
        if (i === this.selectedIndex) return;
        this.select(i);
        this.emit('change', { value: i });
      });
      this.bar.add(b);
      return b;
    });
    this.styleButtons();
    this.ctx.requestLayout(true);
  }

  override resolve(): void {
    super.resolve();
    // 把設定交給內容區的頁面堆疊（它在之後才 resolve）
    const c = this.content.raw;
    c.value = String(this.selectedIndex);
    c.transition = this.attrs.transition ?? 'fade';
    c.swipe = this.attrs.swipe ?? 'false';
    if (this.attrs.duration) c.duration = this.attrs.duration;
    this.styleButtons();
  }

  private styleButtons(): void {
    const a = this.attrs;
    const sel = this.selectedIndex;
    this.buttons.forEach((b, i) => {
      const on = i === sel;
      Object.assign(b.raw, {
        background: on ? (a.accent ?? '#3a7bfd') : (a.tabBackground ?? 'rgba(255,255,255,0.06)'),
        hoverBackground: on ? (a.accent ?? '#3a7bfd') : (a.tabHoverBackground ?? 'rgba(255,255,255,0.12)'),
        pressedBackground: on ? (a.accent ?? '#3a7bfd') : 'rgba(255,255,255,0.18)',
        color: on ? (a.activeColor ?? '#ffffff') : (a.tabColor ?? '#c8d0dc'),
        fontWeight: on ? 'bold' : 'normal',
      });
    });
  }
}

// ═════════════════════════ UITable ═════════════════════════

/** 表格的欄位設定 */
export interface TableColumn {
  /** 資料的欄位名稱（每一列的 row[key]） */
  key: string;
  /** 欄位標題 */
  title: string;
  /** 固定寬度（像素）；沒有時依 flex 平分 */
  width?: string;
  /** 寬度比例（flex，例如 '2'） */
  flex?: string;
  /** 文字對齊 */
  align: 'left' | 'center' | 'right';
  /** 排序方式：number、text；none 不能排序 */
  sort: 'number' | 'text' | 'none' | 'auto';
}

/** 表格的一列資料：欄位名稱 → 值 */
export type TableRow = Record<string, unknown>;

/**
 * 表格：標題列＋可捲動的資料列。點標題排序，點資料列選取（觸發 select 事件，event.item 為該列資料）。
 * 欄位用 <UIColumn>，資料可以寫 <UIRow> 或用程式 table.setRows([...])。
 * @example
 * <UITable id="rank" height="220" onSelect="showPlayer">
 *   <UIColumn key="rank" title="#" width="44" align="center"/>
 *   <UIColumn key="name" title="玩家"/>
 *   <UIColumn key="score" title="分數" width="90" align="right" sort="number"/>
 *   <UIRow rank="1" name="小明" score="1200"/>
 * </UITable>
 */
export class UITable extends UIElement {
  /** 欄位設定（用 setColumns 修改） */
  columns: TableColumn[] = [];
  /** 所有資料列（用 ui.setItems 設定） */
  rows: TableRow[] = [];
  /** 標題列 */
  readonly header: UILayout;
  /** 資料區（可以捲動） */
  readonly body: UIScrollView;
  /** 依哪個欄位排序（null：不排序） */
  sortKey: string | null = null;
  /** 排序方向：1 由小到大，-1 由大到小 */
  sortDir: 1 | -1 = 1;
  /** 目前選中的資料列 */
  selectedRow: TableRow | null = null;
  private rowEls: UILayout[] = [];
  private headerCells: UILabel[] = [];

  /**
   * @param ctx 所屬介面的環境（排版引擎、樣式、圖片載入…；UI2D 建立元件時給）
   * @param type 元件類型（XML 標籤名稱）
   * @param raw XML 寫的屬性
   */
  constructor(ctx: UIContext, type: string, raw: Attrs = {}, _text = '') {
    super(ctx, type, raw);
    this.header = new UILayout(ctx, 'UITableHeader', { dir: 'h' });
    this.body = new UIScrollView(ctx, 'UITableBody', { scroll: 'v', gap: '0', grow: '1', shrink: '1' });
    this.add(this.header);
    this.add(this.body);
  }

  override defaults(): Attrs {
    return {
      dir: 'v',
      background: 'rgba(255,255,255,0.03)',
      radius: '10',
      border: '1 rgba(255,255,255,0.08)',
      headerBackground: 'rgba(255,255,255,0.06)',
      headerColor: '#b8c0ae',
      color: '#e4e8de',
      fontSize: '14',
      cellPadding: '9 12',
      stripeBackground: 'rgba(255,255,255,0.03)',
      rowHoverBackground: 'rgba(154,205,50,0.10)',
      selectedBackground: 'rgba(154,205,50,0.22)',
      accent: '#9acd32',
      striped: 'true',
      sortable: 'true',
      selectable: 'true',
      emptyText: '沒有資料',
    };
  }

  /**
   * XML 裡的 <UIColumn>、<UIRow>
   * @param node XML 子節點
   */
  override consumeChild(node: XmlNode): boolean {
    if (node.tag === 'UIColumn') {
      const a = node.attrs;
      const key = a.key ?? `c${this.columns.length}`;
      this.columns.push({
        key,
        title: a.title ?? node.text ?? key,
        width: a.width,
        flex: a.flex,
        align: a.align === 'center' || a.align === 'right' ? a.align : 'left',
        sort: a.sort === 'number' || a.sort === 'text' || a.sort === 'none' ? a.sort : 'auto',
      });
      return true;
    }
    if (node.tag === 'UIRow') {
      this.rows.push({ ...node.attrs });
      return true;
    }
    return false;
  }

  override onBuilt(): void {
    this.rebuild();
  }

  /**
   * 設定欄位（沒寫的設定用預設值）
   * @param columns 欄位：key（資料的欄位名稱）、標題、寬度、比例、對齊、能否排序
   */
  setColumns(columns: (Partial<TableColumn> & { key: string })[]): void {
    this.columns = columns.map((c) => ({ title: c.key, align: 'left', sort: 'auto', ...c }));
    this.rebuild();
  }

  /**
   * 換掉所有資料
   * @param rows 資料：每一列是一個物件
   */
  setRows(rows: readonly TableRow[]): void {
    this.rows = rows.map((r) => ({ ...r }));
    if (this.selectedRow && !this.rows.includes(this.selectedRow)) this.selectedRow = null;
    this.rebuild();
  }

  /** 顯示順序（排序後）的資料 */
  get displayRows(): TableRow[] {
    const key = this.sortKey;
    if (!key) return this.rows;
    const col = this.columns.find((c) => c.key === key);
    const numeric =
      col?.sort === 'number' ||
      (col?.sort !== 'text' &&
        this.rows.every((r) => r[key] === undefined || r[key] === '' || Number.isFinite(Number(r[key]))));
    const dir = this.sortDir;
    return [...this.rows].sort((a, b) => {
      const va = a[key];
      const vb = b[key];
      const cmp = numeric
        ? Number(va ?? 0) - Number(vb ?? 0)
        : String(va ?? '').localeCompare(String(vb ?? ''), 'zh-Hant');
      return cmp * dir;
    });
  }

  /**
   * 依某欄排序（再呼叫一次同一欄會反過來；dir 指定方向）
   * @param key 欄位的 key
   * @param dir 1 由小到大、-1 由大到小；省略時同一欄再呼叫會反過來
   */
  sortBy(key: string | null, dir?: 1 | -1): void {
    if (key === null) this.sortKey = null;
    else {
      this.sortDir = dir ?? (this.sortKey === key ? (-this.sortDir as 1 | -1) : 1);
      this.sortKey = key;
    }
    this.rebuild();
    this.emit('sort', { value: { key: this.sortKey, dir: this.sortDir } });
  }

  /**
   * 選取顯示順序中的第幾列（-1 取消選取；不會觸發事件）
   * @param index 顯示順序中的第幾列；-1 取消選取
   */
  select(index: number): void {
    this.selectedRow = this.displayRows[index] ?? null;
    this.styleRows();
    this.ctx.requestLayout(true);
  }

  /** 目前選中第幾列（沒有選中時是 -1） */
  get selectedIndex(): number {
    return this.selectedRow ? this.displayRows.indexOf(this.selectedRow) : -1;
  }

  private cellAttrs(col: TableColumn): Attrs {
    const a: Attrs = { padding: this.attrs.cellPadding ?? '9 12', textAlign: col.align };
    if (col.width) {
      a.width = col.width;
      a.shrink = '0';
    } else {
      a.flex = col.flex ?? '1';
      a.minWidth = '0';
    }
    return a;
  }

  /** 依欄位與資料重建標題列與資料列 */
  rebuild(): void {
    for (const c of [...this.header.children]) c.destroy();
    for (const c of [...this.body.children]) c.destroy();
    this.headerCells = this.columns.map((col) => {
      const arrow = this.sortKey === col.key ? (this.sortDir === 1 ? ' ▲' : ' ▼') : '';
      const cell = new UILabel(this.ctx, 'UILabel', { ...this.cellAttrs(col), fontWeight: 'bold' }, col.title + arrow);
      if (bool(this.attrs.sortable ?? 'true') && col.sort !== 'none') {
        cell.raw.cursor = 'pointer';
        cell.raw.hoverBackground = 'rgba(255,255,255,0.06)';
        cell.on('click', () => this.sortBy(col.key));
      }
      this.header.add(cell);
      return cell;
    });
    const rows = this.displayRows;
    this.rowEls = rows.map((row, i) => {
      const el = new UILayout(this.ctx, 'UITableRow', { dir: 'h', align: 'center' });
      el.item = row;
      el.index = i;
      for (const col of this.columns) {
        const v = row[col.key];
        el.add(new UILabel(this.ctx, 'UILabel', this.cellAttrs(col), v === undefined || v === null ? '' : String(v)));
      }
      if (bool(this.attrs.selectable ?? 'true')) {
        el.on('click', () => {
          this.selectedRow = row;
          this.styleRows();
          this.ctx.requestLayout(true);
          this.emit('select', { item: row, index: i, value: row });
        });
      }
      this.body.add(el);
      return el;
    });
    if (rows.length === 0) {
      this.body.add(
        new UILabel(
          this.ctx,
          'UILabel',
          { padding: '16', textAlign: 'center', color: '#838b78' },
          this.attrs.emptyText ?? '沒有資料',
        ),
      );
    }
    this.styleRows();
    this.ctx.requestLayout(true);
  }

  override resolve(): void {
    super.resolve();
    this.styleRows();
  }

  /** 把表格的外觀屬性寫進列與儲存格（子元件之後才 resolve） */
  private styleRows(): void {
    const a = this.attrs;
    const r = num(a.radius, 10);
    Object.assign(this.header.raw, { background: a.headerBackground ?? 'transparent', radius: `${r} ${r} 0 0` });
    for (const cell of this.headerCells) {
      cell.raw.color = a.headerColor ?? '#b8c0ae';
      cell.raw.fontSize = a.fontSize ?? '14';
    }
    const striped = bool(a.striped ?? 'true');
    this.rowEls.forEach((row, i) => {
      const selected = row.item === this.selectedRow && this.selectedRow !== null;
      row.raw.background = selected
        ? (a.selectedBackground ?? 'transparent')
        : striped && i % 2 === 1
          ? (a.stripeBackground ?? 'transparent')
          : 'transparent';
      if (bool(a.selectable ?? 'true')) {
        row.raw.hoverBackground = selected ? (a.selectedBackground ?? '') : (a.rowHoverBackground ?? '');
        row.raw.cursor = 'pointer';
      }
      for (const cell of row.children) {
        cell.raw.color = selected ? (a.selectedColor ?? a.color ?? '#e4e8de') : (a.color ?? '#e4e8de');
        cell.raw.fontSize = a.fontSize ?? '14';
      }
    });
  }
}

/**
 * FPS 顯示（內建）：自己量測畫面更新率，每 interval 秒更新一次文字。
 * 預設 pointerEvents="none"：只是疊在畫面上的資訊，滑鼠點擊、滾輪會穿透到後面的遊戲。
 * - format：顯示格式，{fps} 每秒幀數、{ms} 平均每幀毫秒，預設 "FPS {fps}"
 * - interval：更新間隔（秒），預設 0.5
 * - 沒有指定 color 時依 FPS 變色：≥ 50 綠、≥ 30 黃、其他紅
 * @example <UIFpsMeter position="absolute" right="16" top="16"/>
 */
export class UIFpsMeter extends UILabel {
  /** 最近一次量到的 FPS（還沒量到是 0） */
  fps = 0;
  private frames = 0;
  private since = 0;

  /**
   * @param ctx 所屬介面的環境（排版引擎、樣式、圖片載入…；UI2D 建立元件時給）
   * @param type 元件類型（XML 標籤名稱）
   * @param raw XML 寫的屬性
   * @param text 一開始的文字
   */
  constructor(ctx: UIContext, type: string, raw: Attrs = {}, text = '') {
    super(ctx, type, raw, text || 'FPS --');
    ctx.animate?.(this);
  }

  override defaults(): Attrs {
    return {
      ...super.defaults(),
      fontSize: '12',
      fontWeight: 'bold',
      color: '#9be29b',
      padding: '3 9',
      radius: '6',
      background: 'rgba(8,11,8,0.72)',
      border: '1 rgba(255,255,255,0.08)',
      pointerEvents: 'none',
    };
  }

  override tick(): boolean {
    if (this.isDestroyed) return false;
    const now = performance.now();
    // 第一幀只記下起點（之後每一幀算一個幀間隔）
    if (!this.since) {
      this.since = now;
      return true;
    }
    this.frames++;
    const elapsed = (now - this.since) / 1000;
    if (elapsed >= Math.max(0.1, num(this.attrs.interval, 0.5))) {
      this.fps = Math.round(this.frames / elapsed);
      const ms = (elapsed * 1000) / this.frames;
      const text = (this.attrs.format ?? 'FPS {fps}')
        .replace(/\{fps\}/g, String(this.fps))
        .replace(/\{ms\}/g, ms.toFixed(1));
      // 沒有指定顏色：依 FPS 變色
      if (this.raw.color === undefined) {
        const color = this.fps >= 50 ? '#9be29b' : this.fps >= 30 ? '#ffd75e' : '#ff8a80';
        if (this.attrs.color !== color) {
          this.attrs = { ...this.attrs, color };
          this.ctx.damage?.(this);
        }
      }
      if (text !== this.text) this.setText(text);
      this.frames = 0;
      this.since = now;
    }
    return true; // 一直量測
  }
}

/** 進階元件第二批（UI2D 會自動註冊） */
export const WIDGET2_COMPONENTS = {
  /** 頁面堆疊：一次只顯示一頁，切換有動畫 */
  UIStackView,
  /** 分頁：上方標籤、下方內容 */
  UITabs,
  /** 分頁的一頁（放在 UITabs 裡） */
  UITab,
  /** 表格：標題列＋可捲動的資料列，可以排序、選取 */
  UITable,
  /** 多樣式文字：粗體、顏色、大小、圖示混用 */
  UIRichText,
  /** FPS 顯示 */
  UIFpsMeter,
} as const;
