/**
 * 階層面板：樹狀列出實體。
 * - 點選選取；Cmd/Ctrl+點 加選／取消，Shift+點 選一段（依畫面上的順序）
 * - 雙擊改名（Enter 確定、Esc 取消）
 * - 拖曳：放在一列的上半／下半 → 排到它前面／後面；放在中間 → 變成它的子節點；放到空白處 → 最上層
 *   換父節點時保留世界位置（Transform 換算成相對新父節點的數值，由 keepWorld 計算）
 * - 三角形收合子節點；預製物件的實例預設收合，展開後列出預製物件裡的物件（灰色，可以選取、覆蓋屬性，不能拖曳）
 */
import type { SceneFileData, SceneFileEntity } from '../../scene';
import { moveEntity, setComponent, type SceneDoc } from './doc';
import { h } from './fields';
import { writeName } from './prefabs';

/** 依元件判斷圖示 */
function iconOf(e: SceneFileEntity): string {
  const c = e.components ?? {};
  if (e.prefab) return '📦';
  if ('Model' in c) return '▲';
  if ('ParticleEmitter' in c) return '✦';
  if ('Camera' in c) return '🎥';
  if ('Light' in c) return '💡';
  if ('MeshRenderer' in c) return '◆';
  if ('AudioSource' in c) return '♪';
  return '○';
}

export interface HierarchyHooks {
  /** 選取改變（最後一個是主要選取） */
  onSelect(ids: string[]): void;
  /** 換父節點時，讓物件留在原地的 Transform（場景檔寫法）；回傳 undefined 代表不改 */
  keepWorld(id: string, parent: string | null): unknown;
  /** 預製物件內部、某個實體底下的子實體（展開後的 id；parent 是實例 id 或內部 id） */
  innerChildren(parent: string): SceneFileEntity[];
  /** 滑鼠移到某一列上（null：移出階層面板）：畫面上顯示那個物件的提示框 */
  onHover?(id: string | null): void;
}

export class HierarchyPanel {
  private readonly collapsed = new Set<string>();
  /** 展開的預製物件實例（預設收合） */
  private readonly openPrefabs = new Set<string>();
  private dragId: string | null = null;
  private selection: string[] = [];
  private editing: string | null = null;
  /** 畫面上的順序（Shift 選一段用） */
  private visible: string[] = [];

  constructor(
    private readonly el: HTMLElement,
    private readonly doc: SceneDoc,
    private readonly hooks: HierarchyHooks,
  ) {
    // 拖到空白處：移到最上層的最後面
    el.addEventListener('dragover', (e) => {
      if (this.dragId && e.target === el) {
        e.preventDefault();
        el.classList.add('drop-root');
      }
    });
    el.addEventListener('dragleave', () => el.classList.remove('drop-root'));
    el.addEventListener('drop', (e) => {
      el.classList.remove('drop-root');
      if (!this.dragId || e.target !== el) return;
      e.preventDefault();
      const id = this.dragId;
      this.doc.commit('移動', (d) => this.move(d, id, null));
    });
    el.addEventListener('mouseleave', () => this.hooks.onHover?.(null));
    el.addEventListener('click', (e) => {
      if (e.target === el) this.hooks.onSelect([]);
    });
  }

  /** 設定選取並重畫 */
  select(ids: readonly string[]): void {
    this.selection = [...ids];
    // 展開祖先（預製物件內部的也展開實例），讓選到的看得見
    for (const id of ids) {
      const instance = id.split('/')[0];
      if (id.includes('/')) this.openPrefabs.add(instance);
      for (let p = this.doc.get(instance)?.parent; p !== undefined; p = this.doc.get(p)?.parent)
        this.collapsed.delete(p);
      for (let i = id.lastIndexOf('/'); i > 0; i = id.lastIndexOf('/', i - 1)) this.collapsed.delete(id.slice(0, i));
    }
    this.render();
    this.el.querySelector('.tree-row.primary')?.scrollIntoView({ block: 'nearest' });
  }

  /** 開始改名（F2） */
  rename(id: string): void {
    this.editing = id;
    this.render();
  }

  render(): void {
    if (this.doc.entities.length === 0) {
      this.el.innerHTML = '<div class="empty">場景是空的，用上面的「＋」加入物件</div>';
      return;
    }
    const rows: HTMLElement[] = [];
    this.visible = [];
    const walkInner = (parent: string, depth: number) => {
      for (const item of this.hooks.innerChildren(parent)) {
        rows.push(this.row(item, depth, true));
        this.visible.push(item.id);
        if (!this.collapsed.has(item.id)) walkInner(item.id, depth + 1);
      }
    };
    const walk = (parent: string | null, depth: number) => {
      for (const item of this.doc.childrenOf(parent)) {
        rows.push(this.row(item, depth, false));
        this.visible.push(item.id);
        if (this.collapsed.has(item.id)) continue;
        if (item.prefab && this.openPrefabs.has(item.id)) walkInner(item.id, depth + 1);
        walk(item.id, depth + 1);
      }
    };
    walk(null, 0);
    this.el.replaceChildren(...rows);
    this.el.querySelector<HTMLInputElement>('.tree-rename')?.select();
  }

  /** 點一列：一般點選、Cmd/Ctrl 加選或取消、Shift 選一段 */
  private click(id: string, e: MouseEvent): void {
    if (e.metaKey || e.ctrlKey) {
      const next = this.selection.filter((x) => x !== id);
      if (next.length === this.selection.length) next.push(id);
      this.hooks.onSelect(next);
    } else if (e.shiftKey && this.selection.length) {
      const anchor = this.visible.indexOf(this.selection.at(-1)!);
      const target = this.visible.indexOf(id);
      if (anchor === -1 || target === -1) return this.hooks.onSelect([id]);
      const [a, b] = anchor < target ? [anchor, target] : [target, anchor];
      const range = this.visible.slice(a, b + 1);
      // 點的那個當主要選取（放最後）
      this.hooks.onSelect([...new Set([...this.selection, ...range.filter((x) => x !== id), id])]);
    } else this.hooks.onSelect([id]);
  }

  /** 移動；父節點換了時保留世界位置 */
  private move(d: SceneFileData, id: string, parent: string | null, before?: string): void {
    const old = d.entities.find((e) => e.id === id)?.parent ?? null;
    const transform =
      old !== parent && d.entities.find((e) => e.id === id)?.components?.Transform !== undefined
        ? this.hooks.keepWorld(id, parent)
        : undefined;
    if (moveEntity(d, id, parent, before) && transform !== undefined) setComponent(d, id, 'Transform', transform);
  }

  private row(item: SceneFileEntity, depth: number, inner: boolean): HTMLElement {
    const selected = this.selection.includes(item.id);
    const row = h(
      'div',
      `tree-row${selected ? ' selected' : ''}${item.id === this.selection.at(-1) ? ' primary' : ''}`,
    );
    row.style.paddingLeft = `${4 + depth * 14}px`;
    row.draggable = !inner && this.editing !== item.id;
    if (item.prefab) row.classList.add('prefab');
    if (inner) row.classList.add('inner');

    // 三角形：一般子節點，或預製物件實例的內部
    const isPrefab = !inner && item.prefab !== undefined;
    const hasKids =
      (inner ? this.hooks.innerChildren(item.id).length : this.doc.childrenOf(item.id).length) > 0 ||
      (isPrefab && this.hooks.innerChildren(item.id).length > 0);
    const closed = isPrefab
      ? !this.openPrefabs.has(item.id) || this.collapsed.has(item.id)
      : this.collapsed.has(item.id);
    const twisty = h('span', `twisty${hasKids ? (closed ? ' closed' : ' open') : ''}`);
    twisty.addEventListener('click', (e) => {
      e.stopPropagation();
      if (isPrefab) {
        this.collapsed.delete(item.id);
        if (this.openPrefabs.has(item.id)) this.openPrefabs.delete(item.id);
        else this.openPrefabs.add(item.id);
      } else if (this.collapsed.has(item.id)) this.collapsed.delete(item.id);
      else this.collapsed.add(item.id);
      this.render();
    });
    row.append(twisty, h('span', 'tree-icon', iconOf(item)));

    if (this.editing === item.id) {
      const input = h('input', 'tree-rename');
      input.value = item.name ?? '';
      let finished = false;
      const finish = (save: boolean) => {
        if (finished) return;
        finished = true;
        this.editing = null;
        if (save) this.doc.commit('改名', (d) => writeName(d, item.id, input.value));
        this.render();
      };
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(true);
        if (e.key === 'Escape') finish(false);
      });
      input.addEventListener('blur', () => finish(true));
      input.addEventListener('click', (e) => e.stopPropagation());
      row.append(input);
    } else {
      row.append(
        h('span', `tree-name${item.name ? '' : ' unnamed'}`, item.name || '（沒有名稱）'),
        h('span', 'id', inner ? item.id.slice(item.id.indexOf('/') + 1) : item.id),
      );
    }

    row.addEventListener('click', (e) => this.click(item.id, e));
    row.addEventListener('mouseenter', () => this.hooks.onHover?.(item.id));
    row.addEventListener('dblclick', () => this.rename(item.id));
    if (inner) return row; // 預製物件內部：不能拖曳、不能當放下的目標

    // 拖曳
    row.addEventListener('dragstart', (e) => {
      this.dragId = item.id;
      e.dataTransfer?.setData('text/plain', item.id);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      row.classList.add('dragging');
    });
    row.addEventListener('dragend', () => {
      this.dragId = null;
      row.classList.remove('dragging');
    });
    const zone = (e: DragEvent): 'before' | 'inside' | 'after' => {
      const r = row.getBoundingClientRect();
      const y = (e.clientY - r.top) / r.height;
      return y < 0.3 ? 'before' : y > 0.7 ? 'after' : 'inside';
    };
    const clear = () => row.classList.remove('drop-before', 'drop-inside', 'drop-after');
    row.addEventListener('dragover', (e) => {
      if (!this.dragId || this.dragId === item.id) return;
      e.preventDefault();
      clear();
      row.classList.add(`drop-${zone(e)}`);
    });
    row.addEventListener('dragleave', clear);
    row.addEventListener('drop', (e) => {
      clear();
      const id = this.dragId;
      if (!id || id === item.id) return;
      e.preventDefault();
      e.stopPropagation();
      const where = zone(e);
      const parent = item.parent ?? null;
      this.doc.commit('移動', (d) => {
        if (where === 'inside') {
          this.move(d, id, item.id);
          return;
        }
        if (where === 'before') {
          this.move(d, id, parent, item.id);
          return;
        }
        // 後面：排在下一個兄弟之前；沒有下一個就放最後
        const siblings = d.entities.filter((x) => (x.parent ?? null) === parent && x.id !== id);
        const next = siblings[siblings.findIndex((x) => x.id === item.id) + 1];
        this.move(d, id, parent, next?.id);
      });
      if (where === 'inside') this.collapsed.delete(item.id);
    });
    return row;
  }
}
